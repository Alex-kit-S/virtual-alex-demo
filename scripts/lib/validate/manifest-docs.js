// scripts/lib/validate/manifest-docs.js - V1 through V5, the generated-docs-against-registry legs,
// split from scripts/validate-alex.js.
//
// WHAT. Five checks that a generated surface still says what its source says: V1 the automation count
// (docs/GETTING-STARTED.md and docs/README.md against system/manifest.json), V2 the scheduled-jobs table
// against scheduler/schedule.md AND, where a local scheduler exists, against the live Task Scheduler or
// launchd, V3 that a RETIRED project never reads as live, V4 the MCP Reference list held the same way in
// three surfaces, and V5 that every hex colour outside the law file matches a defined token.
//
// HOW. Each leg is exported as a function taking the same shape runAll already builds (stagedDir plus
// whatever shared object the leg needs) and the failures/warnings arrays to push onto, exactly as before.
// V2's live-scheduler half asks scripts/lib/gen-scheduler.js the same way the generator does, so the two
// can never disagree about what is registered; its per-job ownership check (ownsJob) is scoped to THIS
// checkout by folder prefix, fail-open on an unreadable action path, documented at the call site.
//
// NEVER. Assumes a scheduler backend on a platform that has none (V2 skips its live half there, a
// WARNING, never a FAILED). Treats a by-design refusal (a project a platform cannot register) as a fault.
// Returns true from ownsJob's unreadable-task catch: an unreadable task is not evidence of anything,
// so the catch returns false; returning true again makes V2 accuse the one task it promises not to
// (test-validate-v2-live.mjs pins this). Drops the unreadable name on the floor instead: a bare
// true/false made "not accused" indistinguishable from "never existed", so ownsJob returns
// { owns, readable } and an unreadable live job is named once in a WARNING (ownership unknown), never
// silently absorbed and never FAILED on evidence nobody has. Accuses a task on a bare substring:
// ownsJob compares every <Exec> block's <Command> and <Arguments> on a path BOUNDARY
// ((norm + '/').includes(here + '/'); macOS
// startsWith(REPO + path.sep)), so a sibling folder whose name starts with this one ("tree-old", the
// Windows Explorer "Alex - Copy" shape) is never accused just because "here" is a prefix of its name.
// Three shapes still go unrecognised, named rather than silently missed: a single-byte OEM (cp850) XML
// whose folder name holds an accented byte, a truncated XML with no closing </Arguments>, and this
// folder named by its 8.3 short name.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { parseMcpList, computeCounts } = require('../read-sources');
const { scheduledJobsRows } = require('../gen-docs');
const { liveJobs, backendName, notRegisterable } = require('../gen-scheduler');
const { REPO, effective, listFiles, pad, mdSection, RT_BEGIN, RT_END } = require('./structure');

// The double-clickable installer for THIS platform. A message that tells a Mac owner to run a
// .cmd file is worse than no message: it sends a non-technical person to a file their machine
// cannot open. The Kit ships the pair, Install-Alex.cmd and Install-Alex.command, at the root.
const INSTALLER_NAME = () => (process.platform === 'darwin' ? 'Install-Alex.command' : 'Install-Alex.cmd');

// ---------------------------------------------------------------------------------------------
// V1 - automation count: generated GETTING-STARTED.md (and docs/README.md quick start) vs the
//      count of non-retired NUMBERED entries in system/manifest.json (computeCounts contract).
// ---------------------------------------------------------------------------------------------
function v1AutomationCount({ stagedDir, manifest }, failures) {
  const counts = computeCounts(manifest);
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) {
    failures.push('FAILED V1: docs/GETTING-STARTED.md not found (staged or repo)');
    return;
  }

  const h = gs.text.match(/^## \d+\. The automations \((\d+) registered, non-retired\)\s*$/m);
  if (!h) {
    failures.push(
      'FAILED V1: docs/GETTING-STARTED.md has no "## N. The automations (<count> registered, non-retired)" heading - the count contract is broken'
    );
  } else if (parseInt(h[1], 10) !== counts.automationCount) {
    const names = manifest.projects.filter((p) => p.state !== 'RETIRED').map((p) => p.work_dir);
    failures.push(
      `FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (${gs.from}) says ${h[1]}, system/manifest.json says ${counts.automationCount}; manifest non-retired: ${names.join(', ')}`
    );
  }

  // The list itself: one "- **NN Title**" row per non-retired numbered project.
  const sec = mdSection(gs.text, /^## \d+\. The automations[^\n]*$/m);
  if (sec) {
    const rows = sec.match(/^- \*\*\d{2} /gm) || [];
    if (rows.length !== counts.automationCount)
      failures.push(
        `FAILED V1: docs/GETTING-STARTED.md (${gs.from}) automation list has ${rows.length} numbered rows but system/manifest.json has ${counts.automationCount} non-retired numbered projects`
      );
  }

  // docs/README.md quick-start counts (same generation run, same source).
  const rd = effective(stagedDir, 'docs/README.md');
  if (rd) {
    const m = rd.text.match(/\*\*(\d+) non-retired automations\*\* \((\d+) LIVE\)/);
    if (!m)
      failures.push(
        'FAILED V1: docs/README.md quick start has no "**<n> non-retired automations** (<n> LIVE)" line - the count contract is broken'
      );
    else {
      if (parseInt(m[1], 10) !== counts.automationCount)
        failures.push(
          `FAILED V1: automation count mismatch - docs/README.md (${rd.from}) says ${m[1]}, system/manifest.json says ${counts.automationCount}`
        );
      if (parseInt(m[2], 10) !== counts.liveCount)
        failures.push(
          `FAILED V1: LIVE count mismatch - docs/README.md (${rd.from}) says ${m[2]}, system/manifest.json says ${counts.liveCount}`
        );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V2 - scheduled jobs, reality-aware:
//      (a) doc side: the jobs table in generated GETTING-STARTED.md must equal the rows the
//          generator derives from scheduler/schedule.md (scheduledJobsRows contract);
//      (b) reality side: every documented Alex-* job (parseScheduleJobs contract, retry-*
//          excluded by convention) must exist in the live scheduler (Windows Task Scheduler or
//          macOS launchd), and every live Alex-* job must be documented. Transient tasks
//          (schedule.md "## Transient tasks" section, e.g. a one-shot self-removing poller) are
//          exempt from must-exist-live but count as documented if armed. An unavailable scheduler:
//          FAIL in generator context, LOUD SKIP in pre-commit context (a clone on another machine
//          can still commit).
// ---------------------------------------------------------------------------------------------
function v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings) {
  // (a) docs vs source
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V2: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const expected = scheduledJobsRows(schedule).split('\n');
    const secStart = gs.text.indexOf('### The scheduled jobs');
    if (secStart < 0)
      failures.push(`FAILED V2: docs/GETTING-STARTED.md (${gs.from}) has no "### The scheduled jobs" table`);
    else {
      const sec = gs.text.slice(secStart).split(/^## /m)[0];
      const actual = sec
        .split(/\r?\n/)
        .filter(
          (l) =>
            l.startsWith('| ') &&
            !l.startsWith('| Job |') &&
            !/^\|-+/.test(l.replace(/\s/g, '')) &&
            !l.startsWith('|---')
        );
      const firstCol = (r) => r.split(' | ')[0].replace(/^\| /, '').trim();
      const expNames = expected.map(firstCol),
        actNames = actual.map(firstCol);
      const missing = expNames.filter((n) => !actNames.includes(n));
      const extra = actNames.filter((n) => !expNames.includes(n));
      if (missing.length || extra.length)
        failures.push(
          `FAILED V2: scheduled-jobs table drift - scheduler/schedule.md entries missing from docs/GETTING-STARTED.md (${gs.from}): [${missing.join('; ') || 'none'}]; rows in the doc with no schedule.md entry: [${extra.join('; ') || 'none'}]; regenerate: node scripts/generate-alex.js --only=docs (--only=scheduler also regenerates this table, outside the online tree)`
        );
      else {
        for (let i = 0; i < expected.length; i++) {
          if (actual[i] !== expected[i]) {
            failures.push(
              `FAILED V2: scheduled-jobs table row for '${expNames[i]}' in docs/GETTING-STARTED.md (${gs.from}) does not match scheduler/schedule.md (command/frequency drift)`
            );
            break; // one named row is enough to act on; regenerate fixes all
          }
        }
      }
    }
  }

  // (b) live Task Scheduler
  // No scheduler backend on this platform (anything but win32 and darwin, which in practice is the
  // Claude Code cloud VM, where the Routines are the scheduler) means there is nothing to compare,
  // and gen-scheduler's own run() SKIPS on the same condition. Falling through to
  // the catch below instead would become a hard FAILED in the generator context, so generate-alex.js
  // would fail at step 3 on every Linux run: /new, /setup and /update online all run it. A backend
  // that exists but whose query fails still falls through and still fails. Test: test-validate-v2-platform.mjs.
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    warnings.push(
      `WARNING V2 SKIPPED (live half): ${backendName()}. There is no local scheduler to compare on this platform, so only the documentation half above was checked.`
    );
    return;
  }
  let live;
  try {
    live = liveJobs();
  } catch (e) {
    const msg = `V2 (live half): ${backendName()} query unavailable - ${e.message}`;
    if (context === 'pre-commit') {
      warnings.push(`WARNING V2 SKIPPED (live half, pre-commit): ${msg}`);
      return;
    }
    failures.push(`FAILED V2: ${msg}`);
    return;
  }
  const liveSet = new Set(live),
    docSet = new Set(schedule.allJobNames);
  const transientSet = new Set(schedule.transientJobNames || []); // documented one-shots, live only while armed
  // A job this PLATFORM deliberately cannot register is not a missing job. On macOS gen-launchd
  // refuses the recovery sweep by design, because it has no port yet. Counting a by-design refusal
  // as a fault would paint V2 permanently red on every Mac install, and a check that is always red
  // is a check nobody reads. It is reported as a WARNING that names the reason instead, so the gap
  // stays visible without being a fault.
  const refusedHere = notRegisterable();
  for (const [job, reason] of Object.entries(refusedHere))
    if (!liveSet.has(job))
      warnings.push(
        `WARNING V2: ${job} is documented in scheduler/schedule.md but CANNOT be registered on this platform - ${reason}. It will never run here, by design.`
      );
  // The REGISTERABLE set is what 'all of them' means on this platform. Comparing against the full
  // documented set instead would mean a fresh Mac clone (zero agents, one by-design refusal) never
  // matches the not-installed-yet branch and lands in the partial-registration FAILURE below - a
  // brand new install failing its own validator. Caught by the darwin probe, not by reasoning.
  const registerable = schedule.allJobNames.filter((j) => !refusedHere[j]);
  const notRegistered = registerable.filter((j) => !liveSet.has(j));

  // SCOPE THE UNDOCUMENTED-JOB CHECK TO THIS FOLDER. A machine can hold more than one copy of this
  // system, or an older one, and a Alex-* task whose action points at a DIFFERENT folder is
  // not this checkout's business: complaining about it makes another folder's state able to fail
  // this build; without this scoping a machine carrying another checkout's jobs could never
  // validate clean, and the only way to make it pass would have been to delete somebody else's jobs.
  // Fail OPEN on an unreadable action path: an unreadable task is not evidence of anything, so it
  // is never accused - but it is not nothing either, and returning false from the catch alone made
  // it INVISIBLE, not merely unaccused. ownsJob returns { owns, readable } so the caller can tell the
  // two apart and name the unreadable ones instead of dropping them silently.
  const ownsJob = (name) => {
    // macOS answers this WITHOUT shelling out. This checkout's agents are symlinks from
    // ~/Library/LaunchAgents into its own launchd/ dir (gen-launchd writes them that way on
    // purpose), so resolving the link says which folder owns the agent. Same fail-open rule as
    // the Windows leg below: an agent that cannot be read is not evidence of anything.
    if (process.platform === 'darwin') {
      try {
        const link = path.join(os.homedir(), 'Library', 'LaunchAgents', `${name}.plist`);
        // A BOUNDARY, never a bare prefix: startsWith(REPO) alone would also accuse a sibling
        // checkout whose folder name starts with this one's ("tree-old", "Alex - Copy").
        const owns = fs
          .realpathSync(link)
          .toLowerCase()
          .startsWith(REPO.toLowerCase() + path.sep);
        return { owns, readable: true };
      } catch (_) {
        return { owns: false, readable: false }; // cannot read it -> do not accuse it (see the header NEVER. paragraph)
      }
    }
    const { execFileSync } = require('node:child_process');
    try {
      // Read the raw bytes and sniff. schtasks DECLARES encoding="UTF-16" inside the document but
      // what actually arrives down a pipe is single-byte on this platform, so decoding as utf16le
      // returns confident garbage rather than an error - the worst kind of wrong, because the
      // regex then matches nothing and every job looks like somebody else's.
      const raw = execFileSync('schtasks', ['/query', '/tn', name, '/xml', 'ONE'], {
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      let xml = raw.toString('utf8');
      // Use a regex LITERAL here, never `new RegExp('<Task\b', 'i')`: in a JavaScript string
      // literal `\b` is the BACKSPACE escape, not a regex word boundary, so a string-built version of
      // this pattern can never match real schtasks XML, the utf16le fallback then always runs, and
      // ownsJob() silently returns false forever while the leg still reports a pass. A regex built
      // from a string needs the backslash doubled; a literal needs none, so use one.
      if (!/<Task\b/i.test(xml)) xml = raw.toString('utf16le');
      // Read EVERY <Exec> block's <Command> AND <Arguments>, never <Arguments> alone: a task can
      // carry more than one action, and this checkout's own path can sit in either element of any
      // of them (a task with no <Arguments> at all, or whose SECOND action is the one that points
      // here, must still be caught). Compared on a path BOUNDARY, never a bare substring: a sibling
      // folder whose name starts with this one ("tree-old", the shape Windows Explorer produces for
      // "Alex - Copy") must not be accused just because "here" is a prefix of its name.
      const here = REPO.replace(/\\/g, '/').toLowerCase();
      for (const block of xml.match(/<Exec>[\s\S]*?<\/Exec>/gi) || []) {
        const cmd = (block.match(/<Command>([\s\S]*?)<\/Command>/i) || [])[1] || '';
        const args = (block.match(/<Arguments>([\s\S]*?)<\/Arguments>/i) || [])[1] || '';
        const norm = `${cmd} ${args}`.replace(/\\/g, '/').toLowerCase();
        if (`${norm}/`.includes(`${here}/`)) return { owns: true, readable: true };
      }
      return { owns: false, readable: true };
    } catch (_) {
      return { owns: false, readable: false }; // cannot read it -> do not accuse it (see the header NEVER. paragraph)
    }
  };
  const unknown = [],
    unreadable = [];
  for (const j of live.filter((j) => !docSet.has(j) && !transientSet.has(j))) {
    const { owns, readable } = ownsJob(j);
    if (!readable) unreadable.push(j);
    else if (owns) unknown.push(j);
  }
  if (unreadable.length)
    warnings.push(
      `WARNING V2: live ${backendName()} job(s) whose definition could not be read, so ownership is unknown: ${unreadable.join(', ')}`
    );

  if (notRegistered.length === registerable.length && registerable.length > 0) {
    // NOT INSTALLED, which is a state rather than a fault. A fresh clone, a CI checkout and the
    // build machine itself all legitimately have zero jobs registered, and failing the build for
    // that would mean the validator could only ever pass on one specific installed machine.
    // The hint is tree-aware: in an online (Virtual Alex) tree, one without
    // variants/online (the same test V18 uses), the installer does not ship and the generator's
    // scheduler step skips, so naming either would send the reader to something that does nothing.
    const hint = fs.existsSync(path.join(REPO, 'variants', 'online'))
      ? `${INSTALLER_NAME()} registers them, or: node scripts/generate-alex.js --only=scheduler`
      : 'An online (Virtual Alex) tree registers none of them: its schedule is the Routines, and node scripts/generate-alex.js --only=scheduler skips the scheduler here.';
    warnings.push(
      `WARNING V2: none of the ${notRegistered.length} documented job(s) are registered in ${backendName()}, so this checkout has not been installed yet. That is expected for a fresh clone. ${hint}`
    );
  } else if (notRegistered.length) {
    // PARTIAL registration is the real thing this check exists for: somebody deleted a task, or a
    // job was added to the documentation and never created. Either way a promise is being made that
    // nothing keeps.
    // In the generator context this used to be a FAILURE unconditionally, which
    // wedged the machine - the documented fix (--only=scheduler) itself runs the full validator
    // first, so it failed on the exact same partial-registration line it was invoked to repair, on a
    // fresh machine and an installed one alike. It is a WARNING here instead, naming every missing
    // job in the same words, so nothing about the gap disappears from the output; the generator then
    // runs its steps, including the scheduler step that actually registers what is missing. A bare
    // `node scripts/validate-alex.js` with no --context flag defaults to context='generator' too (the
    // same default runAll and main() both use), so it gets the same warning - there is no separate
    // "standalone" context value in this file. The pre-commit context (the hook, and CLAUDE_CODE_REMOTE
    // degrade on top of it) is the one that still hard-blocks, byte-identical to before.
    const msg = `job(s) documented in scheduler/schedule.md but MISSING from live ${backendName()}, while others ARE registered: ${notRegistered.join(', ')} - a job that is documented and not registered never runs and never says so. Register them with: node scripts/generate-alex.js --only=scheduler`;
    if (context === 'generator') warnings.push(`WARNING V2: ${msg}`);
    else failures.push(`FAILED V2: ${msg}`);
  }
  if (unknown.length)
    failures.push(
      `FAILED V2: live ${backendName()} job(s) pointing at THIS folder but not documented in scheduler/schedule.md: ${unknown.join(', ')}`
    );
}

// ---------------------------------------------------------------------------------------------
// V3 - no retired-as-live: every RETIRED manifest entry must be absent from the GETTING-STARTED
//      automation list entirely, and carry the RETIRED state wherever a row for it exists
//      (CLAUDE.md routing region, docs/projects/README.md table).
// ---------------------------------------------------------------------------------------------
function v3NoRetiredAsLive({ stagedDir, manifest }, failures) {
  const retiredNumbered = manifest.projects.filter((p) => p.state === 'RETIRED');
  const retiredUnnumbered = (manifest.meta.unnumbered || []).filter((u) => u.state === 'RETIRED');
  if (retiredNumbered.length + retiredUnnumbered.length === 0) return;

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (gs) {
    for (const p of retiredNumbered)
      if (gs.text.includes(`- **${pad(p.num)} `))
        failures.push(
          `FAILED V3: retired project ${pad(p.num)} ${p.title} (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`
        );
    for (const u of retiredUnnumbered)
      if (gs.text.includes(`- **${u.title}**`))
        failures.push(
          `FAILED V3: retired system '${u.title}' (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`
        );
  }

  const claude = effective(stagedDir, 'CLAUDE.md');
  if (claude?.text.includes(RT_BEGIN) && claude.text.includes(RT_END)) {
    const region = claude.text.slice(claude.text.indexOf(RT_BEGIN), claude.text.indexOf(RT_END));
    for (const p of retiredNumbered) {
      const row = region.split(/\r?\n/).find((l) => l.startsWith(`| ${pad(p.num)} |`));
      if (row && !row.includes('RETIRED'))
        failures.push(
          `FAILED V3: retired project ${pad(p.num)} ${p.title} listed WITHOUT the RETIRED state in the CLAUDE.md (${claude.from}) routing region`
        );
    }
  }

  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (proj) {
    for (const p of retiredNumbered) {
      const row = proj.text.split(/\r?\n/).find((l) => l.startsWith(`| ${pad(p.num)} |`));
      if (row) {
        const state = row.split('|')[3];
        if (state?.trim() !== 'RETIRED')
          failures.push(
            `FAILED V3: retired project ${pad(p.num)} ${p.title} listed with state '${(state || '').trim()}' instead of RETIRED in docs/projects/README.md (${proj.from})`
          );
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V4 - MCP consistency: the MCP surfaces named in generated docs (ARCHITECTURE.md embedded
//      MCP Reference, GETTING-STARTED.md section 5 list) vs the MCP Reference section of
//      CLAUDE.md, all read with the SAME parseMcpList contract. Any set difference fails.
// ---------------------------------------------------------------------------------------------
function v4McpConsistency({ stagedDir }, failures) {
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) {
    failures.push('FAILED V4: CLAUDE.md not found (staged or repo)');
    return;
  }
  let canonical;
  try {
    canonical = parseMcpList(claude.text);
  } catch (e) {
    failures.push(`FAILED V4: cannot parse the MCP Reference of CLAUDE.md (${claude.from}): ${e.message}`);
    return;
  }
  const canonSet = new Set(canonical);

  const diff = (list, whereName) => {
    const set = new Set(list);
    const missing = canonical.filter((n) => !set.has(n));
    const extra = list.filter((n) => !canonSet.has(n));
    if (missing.length || extra.length)
      failures.push(
        `FAILED V4: MCP set difference between CLAUDE.md and ${whereName} - in CLAUDE.md but not there: [${missing.join(', ') || 'none'}]; there but not in CLAUDE.md: [${extra.join(', ') || 'none'}]`
      );
  };

  const arch = effective(stagedDir, 'docs/ARCHITECTURE.md');
  if (!arch) failures.push('FAILED V4: docs/ARCHITECTURE.md not found (staged or repo)');
  else {
    try {
      diff(parseMcpList(arch.text), `docs/ARCHITECTURE.md (${arch.from})`);
    } catch (e) {
      failures.push(
        `FAILED V4: cannot parse the embedded MCP Reference of docs/ARCHITECTURE.md (${arch.from}): ${e.message}`
      );
    }
  }

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V4: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const sec = mdSection(gs.text, /^## \d+\. The tools Alex reaches \(MCP\)\s*$/m);
    if (!sec)
      failures.push(`FAILED V4: docs/GETTING-STARTED.md (${gs.from}) has no "The tools Alex reaches (MCP)" section`);
    else
      diff(
        (sec.match(/^- (.+)$/gm) || []).map((l) => l.replace(/^- /, '').trim()),
        `docs/GETTING-STARTED.md section 5 (${gs.from})`
      );
  }
}

// ---------------------------------------------------------------------------------------------
// V5 - tokens, not stray hexes: any hex value found OUTSIDE the law file
//      (brand/config/color-system.md) must match a hex the law file defines (parseColorTokens
//      allHexes contract: palette + extended palette + the law file's own semantic values).
//
// SCOPE (deliberate):
//   Scanned surfaces = the identity-carrying documentation this product ships:
//     - CLAUDE.md (the constitution; its inline hexes were removed)
//     - docs/**/*.md (generated docs + hand docs; .md only, so a non-markdown file under docs/ is out)
//     - templates/**/*.md (generation inputs)
//     - brand/**/*.md EXCEPT brand/config/color-system.md (the law file itself)
//     - system/manifest.json + scheduler/schedule.md (hand-edited sources)
//     - every file in .staging/ (any generated output about to ship)
//   NOT scanned: work/** (application code, and any project's own LOCKED visual system, which is
//   explicitly allowed its own palette), vault/** (personal,
//   local-only), outputs/**, scripts/** (code), refactor/** (working notes), node_modules.
//   3-digit shorthand hexes are normalized (#fff -> #ffffff) before the token match.
// ---------------------------------------------------------------------------------------------
const HEX_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
const LAW_FILE = 'brand/config/color-system.md';

function normalizeHex(h) {
  const x = h.toLowerCase();
  if (x.length === 4) return `#${x[1]}${x[1]}${x[2]}${x[2]}${x[3]}${x[3]}`;
  return x;
}

function v5HexTokens({ stagedDir, allHexes }, failures) {
  const rels = new Set(['CLAUDE.md', 'system/manifest.json', 'scheduler/schedule.md']);
  for (const dir of ['docs', 'templates', 'brand']) {
    const abs = path.join(REPO, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of listFiles(abs)) {
      const rel = path.relative(REPO, f).split(path.sep).join('/');
      if (rel.toLowerCase().endsWith('.md')) rels.add(rel);
    }
  }
  if (stagedDir && fs.existsSync(stagedDir))
    for (const f of listFiles(stagedDir)) rels.add(path.relative(stagedDir, f).split(path.sep).join('/'));
  rels.delete(LAW_FILE);

  for (const rel of [...rels].sort()) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    const bad = new Map(); // hex -> first line number
    const lines = eff.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].match(HEX_RE) || []) {
        const hex = normalizeHex(m);
        if (!allHexes.has(hex) && !bad.has(m)) bad.set(m, i + 1);
      }
    }
    if (bad.size) {
      const detail = [...bad.entries()].map(([h, ln]) => `${h} (line ${ln})`).join(', ');
      failures.push(
        `FAILED V5: hex value(s) outside ${LAW_FILE} matching no defined token in ${rel} (${eff.from}): ${detail}`
      );
    }
  }
}

module.exports = {
  LAW_FILE,
  v1AutomationCount,
  v2ScheduledJobs,
  v3NoRetiredAsLive,
  v4McpConsistency,
  v5HexTokens
};
