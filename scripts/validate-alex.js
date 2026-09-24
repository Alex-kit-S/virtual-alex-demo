#!/usr/bin/env node
// validate-alex.js - the validation layer (Layer 6). PHASE 3 DELIVERABLE (P3-S1).
//
// Runs as the final step of every generate-alex.js run, standalone on the CLI, and from the git
// pre-commit hook (P3-S3). Six checks (V1-V6, spec table + amendments A3/A5) plus the structural
// guards G1-G4 from Phase 1, plus V9 first-fire aging (upgrade P4, 2026-07-12; WARNING-only),
// plus V7 lifecycle-state drift lint and V8 HQ hex scan (upgrade P5, 2026-07-12, design 1.5/1.6),
// plus V10 protected-file guard (2026-07-15, context-engineering run; COMMIT-TIME ONLY, enforces
// vault/me/NEVER-TOUCH.md against the staged changeset - runs in pre-commit context with --changed),
// plus V11 forced-add guard (2026-07-17, three-plan validation P0a; COMMIT-TIME ONLY, blocks a
// `git add -f` of a gitignored path from being committed to the public repo),
// plus V12 trifecta gate (2026-07-17, three-plan validation P3; every invocation, pure file checks:
// a manifest project with all three trifecta legs true MUST declare a gate that is echoed in its CLAUDE.md).
// Any failure exits 1 and names exactly what drifted and where.
//
// plus V13 local wrapper model-pin contract (2026-07-25, stress-test F4; the local twin of V6,
// COMPLETE by construction: every scripts/run-*.ps1 + auth-check.ps1 must be declared in the contract).
//
// plus V14 Alex gender-neutrality contract (2026-07-28; the code behind work/12 HARD RULE 15 and
//      the soul.md law of the same date. Two narrow scans: unpublished episode BODIES, and the
//      pinned locked line. Published episodes are archive and are skipped by construction).
// plus V19 Routine prompt files bound to system/manifest.json routines[] (2026-09-23, Virtual Alex
//      plan Phase 4: an orphan prompt file or a row naming a missing file fails; a drift leg online).
// plus V21 the JSON standard holds on the files it is enforced for (2026-09-23, Virtual Alex fleet
//      seat 3, ported from upstream): scoped to system/kit-manifest.json json_standard.enforced[],
//      a RATCHET; a CONTENT leg, so it blocks under CLAUDE_CODE_REMOTE too. See docs/json-standard.md.
// The full suite (SUITE_RANGE below, derived from V_MAX - never restate the number here) runs on EVERY invocation (V10/V11 are
// commit-time only) - generate-alex.js --only=X limits what is staged/applied, never what is checked
// (c7 fix, upgrade P5). V_MAX is the ONE declared suite number; every consumer derives from it (F-10).
//
// Contract with generate-alex.js (orchestration step 3):
//   const { runAll } = require('./validate-alex');
//   const result = await runAll({ stagedDir });          // ASYNC since Phase 3 (V6 does live HTTP)
//   result = { ok: boolean, failures: ['FAILED Vx: ...'], warnings: ['WARNING ...'] }
// A file present in stagedDir is validated as the ABOUT-TO-SHIP version; for files not staged the
// current repo copy is checked. Any failure -> the caller deletes staging and touches nothing real.
//
// Parse contracts are REUSED from scripts/lib/read-sources.js and scripts/lib/gen-docs.js /
// gen-scheduler.js, so the generator and the validator can never disagree about how a source or a
// surface is read (Phase 1 handoff requirement).
//
// Contexts (P3-S3 pre-commit design):
//   context: 'generator'  (default) - reality checks are STRICT: missing env creds, an unreachable
//            n8n API, or a failing schtasks query are hard FAILs (ground rule 7: fail loudly).
//   context: 'pre-commit' - same checks, but V6 (n8n) and the live half of V2 (schtasks) degrade to
//            a LOUD WARNING SKIP when creds/network/schtasks are unavailable, so an offline machine
//            or the nightly headless git-backup commit is never blocked by a remote outage.
//            A REAL mismatch (rule model != live model, doc drift, job drift) still blocks in both
//            contexts (the n8n-key sentence that used to end here described a hook block removed on
//            2026-08-17 with V6), EXCEPT under CLAUDE_CODE_REMOTE=true in the pre-commit context (2026-09-23,
//            Virtual Alex plan Phase 3, seat 5 C13): there the DRIFT legs (REMOTE_DRIFT_LEGS below)
//            are degraded to warnings after they run, because every autosave commits through the
//            gate and an autosave that cannot commit is a vault page that dies with the VM. The
//            content legs (G1-G4, V10, V11, V16, V18's control-byte and script legs) block there too.
//
// Standalone CLI:  node scripts/validate-alex.js [--staged=DIR] [--context=generator|pre-commit]
// Exit 0 = pass (warnings allowed), 1 = fail.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');                              // V18 leg (f): temp file for the PS parse sweep
const { execFileSync } = require('child_process');     // V18 leg (f): ask the PowerShell parser itself

const { parseScheduleJobs, parseMcpList, parseColorTokens, computeCounts } = require('./lib/read-sources');
const { scheduledJobsRows } = require('./lib/gen-docs');
const { routineRows, ROUTINES_DIR } = require('./lib/gen-routines');   // V19: the Routine prompt contract
const { liveJobs, backendName, notRegisterable } = require('./lib/gen-scheduler');
const genTokens = require('./lib/gen-tokens');

const REPO = path.join(__dirname, '..');

// The double-clickable installer for THIS platform. A message that tells a Mac owner to run a
// .cmd file is worse than no message: it sends a non-technical person to a file their machine
// cannot open. The Kit ships the pair, Install-Alex.cmd and Install-Alex.command, at the root.
const INSTALLER_NAME = () => (process.platform === 'darwin' ? 'Install-Alex.command' : 'Install-Alex.cmd');

// --- suite range: ONE declared number, every consumer derives (stress-test fix F-10, 2026-07-25) ---
// The generator used to hand-write its own "G1-G4 + V1-V9" label in two places and rotted four rules
// behind the real suite. A label that restates a fact it does not own is the same class as a validator
// deriving its expectation from prose (the V6 lesson): so V_MAX is declared HERE, once, and
// generate-alex.js + the recall h-validators harvester + narrative-drift-check.py all read THIS
// declaration (a structured `const V_MAX = <n>`), never a printed string or a prose claim.
const V_MAX = 21;
// V6 (live n8n model routing) and V8 (the Alex HQ app hex scan) are RETIRED in this system:
// there is no n8n instance and no HQ app, so both checked a subject that does not exist. The
// numbers are NOT reused - V13 means the local wrapper pins here exactly as it does anywhere,
// and renumbering a suite silently changes what every existing reference points at.
// V20 joins them for the same reason (2026-09-23): upstream it is a parity check between two job
// search lanes, a subject this Kit does not have. V21, the JSON standard, keeps its upstream number
// so docs/json-standard.md means the same check in both places.
const V_RETIRED = [6, 8, 20];

// REMOTE_DRIFT_LEGS (2026-09-23, Virtual Alex plan Phase 3): the legs that compare a GENERATED or
// DERIVED surface with its source (docs counts, the jobs table, retired rows in docs, the MCP list,
// hex tokens, state words, the trifecta echo in work/NN/CLAUDE.md, wrapper pins, command headers,
// skill links). Under CLAUDE_CODE_REMOTE=true in context=pre-commit their failures become warnings
// AFTER they run (runAll, below), so the transcript still names the drift and the weekly check.mjs
// can turn a persisting one red, while the commit (an autosave) goes through. A missing or
// unparseable source file is never drift (a broken registry blocks everywhere), and V18 is split:
// its dangling-command, cut-project-pointer and dead-link legs are drift, its control-byte, .cmd
// guard and .ps1 parse legs are content and block.
// V19 (the Routine prompt files against routines[]) joined the set on 2026-09-23: scheduler/routines/
// is identity-denied in every unattended session, so an orphan there is an owner's edit, never a
// Routine's, and an autosave must not die on a registry row somebody forgot.
const REMOTE_DRIFT_LEGS = new Set(['V1', 'V2', 'V3', 'V4', 'V5', 'V7', 'V12', 'V13', 'V15', 'V17', 'V19']);
const REMOTE_NEVER_DRIFT = /not found|not valid JSON|cannot parse|is required/;
const REMOTE_V18_DRIFT = /names `\/|points at `|links to '/;
function isRemoteDrift(failure) {
  const m = /^FAILED (G\d+|V\d+):/.exec(failure);
  if (!m) return false;
  if (REMOTE_NEVER_DRIFT.test(failure)) return false;
  if (m[1] === 'V18') return REMOTE_V18_DRIFT.test(failure);
  return REMOTE_DRIFT_LEGS.has(m[1]);
}
const SUITE_RANGE = `G1-G4 + V1-V${V_MAX} (V${V_RETIRED.join(', V')} retired)`;

const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g; // must match render-templates.js
const RT_BEGIN = '<!-- ROUTING-TABLE:BEGIN';
const RT_END = '<!-- ROUTING-TABLE:END -->';
const CZ_START = '<!-- CUSTOM_START -->';
const CZ_END = '<!-- CUSTOM_END -->';
const PT_BEGIN = '<!-- PROJECT-TABLE:BEGIN';
const PT_END = '<!-- PROJECT-TABLE:END -->';

const pad = n => String(n).padStart(2, '0');

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

// Prefer the staged copy (the version about to ship); fall back to the live repo copy.
function effective(stagedDir, rel) {
  const staged = stagedDir && path.join(stagedDir, rel);
  if (staged && fs.existsSync(staged)) return { text: fs.readFileSync(staged, 'utf8'), from: 'staged' };
  const real = path.join(REPO, rel);
  if (fs.existsSync(real)) return { text: fs.readFileSync(real, 'utf8'), from: 'repo' };
  return null;
}

function countOf(text, marker) { return text.split(marker).length - 1; }

// Slice a "## ..." section (heading line matching headingRe) up to the next "## " heading or EOF.
function mdSection(text, headingRe) {
  const m = text.match(headingRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

async function fetchJson(url, headers, ms = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------------------------------
// G1-G4 - structural guards (Phase 1, unchanged behavior)
// ---------------------------------------------------------------------------------------------
function structuralGuards({ stagedDir }, failures) {
  // G1 - no unresolved {{PLACEHOLDER}} in any staged output.
  if (stagedDir && fs.existsSync(stagedDir)) {
    for (const f of listFiles(stagedDir)) {
      const left = fs.readFileSync(f, 'utf8').match(PLACEHOLDER_RE);
      if (left) failures.push(`FAILED G1: unresolved placeholder(s) ${[...new Set(left)].join(', ')} in staged ${path.relative(stagedDir, f)}`);
    }
  }

  // G2 - routing-region markers in CLAUDE.md present and well-formed (exactly one, ordered).
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) failures.push('FAILED G2: CLAUDE.md not found (staged or repo)');
  else {
    const b = countOf(claude.text, RT_BEGIN), e = countOf(claude.text, RT_END);
    if (b !== 1 || e !== 1) failures.push(`FAILED G2: CLAUDE.md (${claude.from}) must contain exactly one ROUTING-TABLE BEGIN/END pair - found BEGIN=${b}, END=${e}`);
    else if (claude.text.indexOf(RT_END) < claude.text.indexOf(RT_BEGIN)) failures.push(`FAILED G2: CLAUDE.md (${claude.from}) routing markers out of order (END before BEGIN)`);
  }

  // G3 - custom-zone markers in docs/README.md present exactly once, ordered.
  const readme = effective(stagedDir, 'docs/README.md');
  if (!readme) failures.push('FAILED G3: docs/README.md not found (staged or repo) - the hand-written welcome block is required (D8)');
  else {
    const s = countOf(readme.text, CZ_START), e = countOf(readme.text, CZ_END);
    if (s !== 1 || e !== 1) failures.push(`FAILED G3: docs/README.md (${readme.from}) must contain exactly one custom zone - found START=${s}, END=${e}`);
    else if (readme.text.indexOf(CZ_END) < readme.text.indexOf(CZ_START)) failures.push(`FAILED G3: docs/README.md (${readme.from}) custom-zone markers out of order`);
  }

  // G4 - project-table markers in docs/projects/README.md present exactly once, ordered.
  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (!proj) failures.push('FAILED G4: docs/projects/README.md not found (staged or repo)');
  else {
    const b = countOf(proj.text, PT_BEGIN), e = countOf(proj.text, PT_END);
    if (b !== 1 || e !== 1) failures.push(`FAILED G4: docs/projects/README.md (${proj.from}) must contain exactly one PROJECT-TABLE BEGIN/END pair - found BEGIN=${b}, END=${e}`);
    else if (proj.text.indexOf(PT_END) < proj.text.indexOf(PT_BEGIN)) failures.push(`FAILED G4: docs/projects/README.md (${proj.from}) project-table markers out of order`);
  }
}

// ---------------------------------------------------------------------------------------------
// V1 - automation count: generated GETTING-STARTED.md (and docs/README.md quick start) vs the
//      count of non-retired NUMBERED entries in system/manifest.json (computeCounts contract).
// ---------------------------------------------------------------------------------------------
function v1AutomationCount({ stagedDir, manifest }, failures) {
  const counts = computeCounts(manifest);
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) { failures.push('FAILED V1: docs/GETTING-STARTED.md not found (staged or repo)'); return; }

  const h = gs.text.match(/^## \d+\. The automations \((\d+) registered, non-retired\)\s*$/m);
  if (!h) {
    failures.push('FAILED V1: docs/GETTING-STARTED.md has no "## N. The automations (<count> registered, non-retired)" heading - the count contract is broken');
  } else if (parseInt(h[1], 10) !== counts.automationCount) {
    const names = manifest.projects.filter(p => p.state !== 'RETIRED').map(p => p.work_dir);
    failures.push(`FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (${gs.from}) says ${h[1]}, system/manifest.json says ${counts.automationCount}; manifest non-retired: ${names.join(', ')}`);
  }

  // The list itself: one "- **NN Title**" row per non-retired numbered project.
  const sec = mdSection(gs.text, /^## \d+\. The automations[^\n]*$/m);
  if (sec) {
    const rows = sec.match(/^- \*\*\d{2} /gm) || [];
    if (rows.length !== counts.automationCount)
      failures.push(`FAILED V1: docs/GETTING-STARTED.md (${gs.from}) automation list has ${rows.length} numbered rows but system/manifest.json has ${counts.automationCount} non-retired numbered projects`);
  }

  // docs/README.md quick-start counts (same generation run, same source).
  const rd = effective(stagedDir, 'docs/README.md');
  if (rd) {
    const m = rd.text.match(/\*\*(\d+) non-retired automations\*\* \((\d+) LIVE\)/);
    if (!m) failures.push('FAILED V1: docs/README.md quick start has no "**<n> non-retired automations** (<n> LIVE)" line - the count contract is broken');
    else {
      if (parseInt(m[1], 10) !== counts.automationCount)
        failures.push(`FAILED V1: automation count mismatch - docs/README.md (${rd.from}) says ${m[1]}, system/manifest.json says ${counts.automationCount}`);
      if (parseInt(m[2], 10) !== counts.liveCount)
        failures.push(`FAILED V1: LIVE count mismatch - docs/README.md (${rd.from}) says ${m[2]}, system/manifest.json says ${counts.liveCount}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V2 - scheduled jobs, reality-aware (A3):
//      (a) doc side: the jobs table in generated GETTING-STARTED.md must equal the rows the
//          generator derives from scheduler/schedule.md (scheduledJobsRows contract);
//      (b) reality side: every documented Alex-* job (parseScheduleJobs contract, retry-*
//          excluded by convention) must exist in live Windows Task Scheduler, and every live
//          Alex-* job must be documented. Transient tasks (schedule.md "## Transient tasks"
//          section, e.g. the self-removing QRA poller) are exempt from must-exist-live but count
//          as documented if armed (2026-07-13). schtasks unavailable: FAIL in generator context,
//          LOUD SKIP in pre-commit context (a clone on another machine can still commit).
// ---------------------------------------------------------------------------------------------
function v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings) {
  // (a) docs vs source
  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V2: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const expected = scheduledJobsRows(schedule).split('\n');
    const secStart = gs.text.indexOf('### The scheduled jobs');
    if (secStart < 0) failures.push(`FAILED V2: docs/GETTING-STARTED.md (${gs.from}) has no "### The scheduled jobs" table`);
    else {
      const sec = gs.text.slice(secStart).split(/^## /m)[0];
      const actual = sec.split(/\r?\n/).filter(l => l.startsWith('| ') && !l.startsWith('| Job |') && !/^\|-+/.test(l.replace(/\s/g, '')) && !l.startsWith('|---'));
      const firstCol = r => r.split(' | ')[0].replace(/^\| /, '').trim();
      const expNames = expected.map(firstCol), actNames = actual.map(firstCol);
      const missing = expNames.filter(n => !actNames.includes(n));
      const extra = actNames.filter(n => !expNames.includes(n));
      if (missing.length || extra.length)
        failures.push(`FAILED V2: scheduled-jobs table drift - scheduler/schedule.md entries missing from docs/GETTING-STARTED.md (${gs.from}): [${missing.join('; ') || 'none'}]; rows in the doc with no schedule.md entry: [${extra.join('; ') || 'none'}]`);
      else {
        for (let i = 0; i < expected.length; i++) {
          if (actual[i] !== expected[i]) {
            failures.push(`FAILED V2: scheduled-jobs table row for '${expNames[i]}' in docs/GETTING-STARTED.md (${gs.from}) does not match scheduler/schedule.md (command/frequency drift)`);
            break; // one named row is enough to act on; regenerate fixes all
          }
        }
      }
    }
  }

  // (b) live Task Scheduler
  // No scheduler backend on this platform (anything but win32 and darwin, which in practice is the
  // Claude Code cloud VM, where the Routines are the scheduler) means there is nothing to compare,
  // and gen-scheduler's own run() SKIPS on the same condition. Until 2026-09-23 this fell through to
  // the catch below and became a hard FAILED in the generator context, so generate-alex.js failed at
  // step 3 on every Linux run: /new, /setup and /update online all run it. A backend that exists but
  // whose query fails still falls through and still fails. Test: test-validate-v2-platform.mjs.
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    warnings.push(`WARNING V2 SKIPPED (live half): ${backendName()}. There is no local scheduler to compare on this platform, so only the documentation half above was checked.`);
    return;
  }
  let live;
  try {
    live = liveJobs();
  } catch (e) {
    const msg = `V2 (live half): ${backendName()} query unavailable - ${e.message}`;
    if (context === 'pre-commit') { warnings.push(`WARNING V2 SKIPPED (live half, pre-commit): ${msg}`); return; }
    failures.push(`FAILED V2: ${msg}`);
    return;
  }
  const liveSet = new Set(live), docSet = new Set(schedule.allJobNames);
  const transientSet = new Set(schedule.transientJobNames || []); // documented one-shots, live only while armed
  // A job this PLATFORM deliberately cannot register is not a missing job. On macOS gen-launchd
  // refuses the recovery sweep by design, because it has no port yet. Counting a by-design refusal
  // as a fault would paint V2 permanently red on every Mac install, and a check that is always red
  // is a check nobody reads. It is reported as a WARNING that names the reason instead, so the gap
  // stays visible without being a fault. (2026-09-20, with the liveJobs platform dispatch.)
  const refusedHere = notRegisterable();
  for (const [job, reason] of Object.entries(refusedHere))
    if (!liveSet.has(job))
      warnings.push(`WARNING V2: ${job} is documented in scheduler/schedule.md but CANNOT be registered on this platform - ${reason}. It will never run here, by design.`);
  // The REGISTERABLE set is what 'all of them' means on this platform. Comparing against the full
  // documented set instead would mean a fresh Mac clone (zero agents, one by-design refusal) never
  // matches the not-installed-yet branch and lands in the partial-registration FAILURE below - a
  // brand new install failing its own validator. Caught by the darwin probe, not by reasoning.
  const registerable = schedule.allJobNames.filter(j => !refusedHere[j]);
  const notRegistered = registerable.filter(j => !liveSet.has(j));

  // SCOPE THE UNDOCUMENTED-JOB CHECK TO THIS FOLDER. A machine can hold more than one copy of this
  // system, or an older one, and a Alex-* task whose action points at a DIFFERENT folder is
  // not this checkout's business: complaining about it makes another folder's state able to fail
  // this build. Measured 2026-08-17 on the machine this kit was built on, which carried 18 such
  // jobs belonging to the original system; without this scoping the kit could never validate clean
  // there, and the only way to make it pass would have been to delete somebody else's jobs.
  // Fail OPEN on an unreadable action path: an unreadable task is not evidence of anything.
  const ownsJob = (name) => {
    // macOS answers this WITHOUT shelling out. This checkout's agents are symlinks from
    // ~/Library/LaunchAgents into its own launchd/ dir (gen-launchd writes them that way on
    // purpose), so resolving the link says which folder owns the agent. Same fail-open rule as
    // the Windows leg below: an agent that cannot be read is not evidence of anything.
    if (process.platform === 'darwin') {
      try {
        const link = path.join(os.homedir(), 'Library', 'LaunchAgents', `${name}.plist`);
        return fs.realpathSync(link).toLowerCase().startsWith(REPO.toLowerCase());
      } catch (_) {
        return true;   // cannot read it -> do not accuse it
      }
    }
    const { execFileSync } = require('child_process');
    try {
      // Read the raw bytes and sniff. schtasks DECLARES encoding="UTF-16" inside the document but
      // what actually arrives down a pipe is single-byte on this platform, so decoding as utf16le
      // returns confident garbage rather than an error - the worst kind of wrong, because the
      // regex then matches nothing and every job looks like somebody else's.
      const raw = execFileSync('schtasks', ['/query', '/tn', name, '/xml', 'ONE'],
        { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
      let xml = raw.toString('utf8');
      // N-04 fix 2026-08-17. This read `new RegExp('<Task\b', 'i')`, and in a JavaScript string
      // literal `\b` is the BACKSPACE escape, not a regex word boundary - so the pattern compiled to
      // the bytes 60,84,97,115,107,8 and could never match real schtasks XML. Proven by evaluation:
      // .test() returned false on genuine output. Consequence: the utf16le fallback ran EVERY time,
      // ownsJob() always returned false, and one V2 leg was permanently dead while reporting pass.
      // Same eaten-escape class as the 0x01 in the installer and the split path in security-sweep.
      // A regex built from a string needs the backslash doubled; a literal needs none, so use one.
      if (!/<Task\b/i.test(xml)) xml = raw.toString('utf16le');
      const m = xml.match(/<Arguments>([\s\S]*?)<\/Arguments>/i);
      const args = m ? m[1] : '';
      const here = REPO.replace(/\\/g, '/').toLowerCase();
      return args.replace(/\\/g, '/').toLowerCase().includes(here);
    } catch (_) {
      return true;   // cannot read it -> do not accuse it
    }
  };
  const unknown = live.filter(j => !docSet.has(j) && !transientSet.has(j)).filter(ownsJob);

  if (notRegistered.length === registerable.length && registerable.length > 0) {
    // NOT INSTALLED, which is a state rather than a fault. A fresh clone, a CI checkout and the
    // build machine itself all legitimately have zero jobs registered, and failing the build for
    // that would mean the validator could only ever pass on one specific installed machine.
    warnings.push(`WARNING V2: none of the ${notRegistered.length} documented job(s) are registered in ${backendName()}, so this checkout has not been installed yet. That is expected for a fresh clone. ${INSTALLER_NAME()} registers them, or: node scripts/generate-alex.js --only=scheduler`);
  } else if (notRegistered.length) {
    // PARTIAL registration is the real thing this check exists for: somebody deleted a task, or a
    // job was added to the documentation and never created. Either way a promise is being made that
    // nothing keeps.
    failures.push(`FAILED V2: job(s) documented in scheduler/schedule.md but MISSING from live ${backendName()}, while others ARE registered: ${notRegistered.join(', ')} - a job that is documented and not registered never runs and never says so. Register them with: node scripts/generate-alex.js --only=scheduler`);
  }
  if (unknown.length)
    failures.push(`FAILED V2: live ${backendName()} job(s) pointing at THIS folder but not documented in scheduler/schedule.md: ${unknown.join(', ')}`);
}

// ---------------------------------------------------------------------------------------------
// V3 - no retired-as-live: every RETIRED manifest entry must be absent from the GETTING-STARTED
//      automation list entirely, and carry the RETIRED state wherever a row for it exists
//      (CLAUDE.md routing region, docs/projects/README.md table).
// ---------------------------------------------------------------------------------------------
function v3NoRetiredAsLive({ stagedDir, manifest }, failures) {
  const retiredNumbered = manifest.projects.filter(p => p.state === 'RETIRED');
  const retiredUnnumbered = (manifest.meta.unnumbered || []).filter(u => u.state === 'RETIRED');
  if (retiredNumbered.length + retiredUnnumbered.length === 0) return;

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (gs) {
    for (const p of retiredNumbered)
      if (gs.text.includes(`- **${pad(p.num)} `))
        failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`);
    for (const u of retiredUnnumbered)
      if (gs.text.includes(`- **${u.title}**`))
        failures.push(`FAILED V3: retired system '${u.title}' (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (${gs.from}) automation list`);
  }

  const claude = effective(stagedDir, 'CLAUDE.md');
  if (claude && claude.text.includes(RT_BEGIN) && claude.text.includes(RT_END)) {
    const region = claude.text.slice(claude.text.indexOf(RT_BEGIN), claude.text.indexOf(RT_END));
    for (const p of retiredNumbered) {
      const row = region.split(/\r?\n/).find(l => l.startsWith(`| ${pad(p.num)} |`));
      if (row && !row.includes('RETIRED'))
        failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} listed WITHOUT the RETIRED state in the CLAUDE.md (${claude.from}) routing region`);
    }
  }

  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (proj) {
    for (const p of retiredNumbered) {
      const row = proj.text.split(/\r?\n/).find(l => l.startsWith(`| ${pad(p.num)} |`));
      if (row) {
        const state = row.split('|')[3];
        if (!state || state.trim() !== 'RETIRED')
          failures.push(`FAILED V3: retired project ${pad(p.num)} ${p.title} listed with state '${(state || '').trim()}' instead of RETIRED in docs/projects/README.md (${proj.from})`);
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
  if (!claude) { failures.push('FAILED V4: CLAUDE.md not found (staged or repo)'); return; }
  let canonical;
  try { canonical = parseMcpList(claude.text); }
  catch (e) { failures.push(`FAILED V4: cannot parse the MCP Reference of CLAUDE.md (${claude.from}): ${e.message}`); return; }
  const canonSet = new Set(canonical);

  const diff = (list, whereName) => {
    const set = new Set(list);
    const missing = canonical.filter(n => !set.has(n));
    const extra = list.filter(n => !canonSet.has(n));
    if (missing.length || extra.length)
      failures.push(`FAILED V4: MCP set difference between CLAUDE.md and ${whereName} - in CLAUDE.md but not there: [${missing.join(', ') || 'none'}]; there but not in CLAUDE.md: [${extra.join(', ') || 'none'}]`);
  };

  const arch = effective(stagedDir, 'docs/ARCHITECTURE.md');
  if (!arch) failures.push('FAILED V4: docs/ARCHITECTURE.md not found (staged or repo)');
  else {
    try { diff(parseMcpList(arch.text), `docs/ARCHITECTURE.md (${arch.from})`); }
    catch (e) { failures.push(`FAILED V4: cannot parse the embedded MCP Reference of docs/ARCHITECTURE.md (${arch.from}): ${e.message}`); }
  }

  const gs = effective(stagedDir, 'docs/GETTING-STARTED.md');
  if (!gs) failures.push('FAILED V4: docs/GETTING-STARTED.md not found (staged or repo)');
  else {
    const sec = mdSection(gs.text, /^## \d+\. The tools Alex reaches \(MCP\)\s*$/m);
    if (!sec) failures.push(`FAILED V4: docs/GETTING-STARTED.md (${gs.from}) has no "The tools Alex reaches (MCP)" section`);
    else diff((sec.match(/^- (.+)$/gm) || []).map(l => l.replace(/^- /, '').trim()), `docs/GETTING-STARTED.md section 5 (${gs.from})`);
  }
}

// ---------------------------------------------------------------------------------------------
// V5 - tokens, not stray hexes (softened per A5): any hex value found OUTSIDE the law file
//      (brand/config/color-system.md) must match a hex the law file defines (parseColorTokens
//      allHexes contract: palette + extended palette + the law file's own semantic values).
//
// SCOPE (deliberate, documented for the architect):
//   Scanned surfaces = the identity-carrying documentation the refactor owns:
//     - CLAUDE.md (the constitution; S1.6 removed its inline hexes)
//     - docs/**/*.md (generated docs + hand docs; .md only, so the gitignored local-only
//       docs/n8n/*/workflow.json exports - mirrors of live n8n state, not brand surfaces - are out)
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
  if (x.length === 4) return '#' + x[1] + x[1] + x[2] + x[2] + x[3] + x[3];
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
      failures.push(`FAILED V5: hex value(s) outside ${LAW_FILE} matching no defined token in ${rel} (${eff.from}): ${detail}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V7 - lifecycle-state drift lint (upgrade P5, 2026-07-12, design 1.5.2): deterministic,
//      zero-token. For every registry row (projects[] + meta.unnumbered) scan the hand-maintained
//      prose surfaces for lifecycle-state words that CONTRADICT the manifest state, with exact
//      file:line output.
//
//      Scanned assertion locations ONLY (state words inside dated history notes / body prose are
//      narrative, not claims - deliberately out of scope):
//        - scheduler/schedule.md: the "### " section title line + "- Status:"/"- State:" lines of
//          sections associated to a project (by title containing the project title, a "(#NN)"
//          tag, or the "- Command:" line naming one of the project's /commands). ERROR-tier:
//          the scheduler is an execution surface, a wrong state there mis-runs things (c5/M3).
//        - the project's vault status.md YAML frontmatter `state:` / `status:` value. WARNING.
//        - the project's docs/projects/{docs} markdown heading lines. WARNING.
//
//      False-positive guards (tuned against the real repo, 2026-07-12):
//        - schedule.md matching is UPPERCASE-ONLY: the repo convention writes real state
//          assertions there in caps ("State PARKED", "PAUSED 2026-06-18") while lowercase
//          "parked"/"retired"/"live" are ordinary English inside explanatory prose. Frontmatter
//          values and docs headers stay case-insensitive (their convention is lowercase:
//          "status: on-demand", "# 11 - ... (paused)");
//        - hyphenated compounds are not claims ("Event-driven", "phase-2-live");
//        - "A -> B" transition phrases are narrative (both sides skipped) - the current state,
//          if asserted, appears standalone elsewhere on the surface;
//        - DISABLED next to Task Scheduler wording is a fact about the JOB, not the project
//          ("Status: DISABLED in Task Scheduler" describes schtasks state);
//        - PAUSED is accepted as equivalent to a manifest PARKED (same "deliberately stopped"
//          class); every other word must equal the manifest state exactly.
// ---------------------------------------------------------------------------------------------
const STATE_WORDS = 'ON-DEMAND|LIVE|EVENT|DORMANT|PARKED|RETIRED|PAUSED|DISABLED';
const STATE_RE_CI = new RegExp(`\\b(${STATE_WORDS})\\b`, 'gi'); // frontmatter + docs headers
const STATE_RE_UC = new RegExp(`\\b(${STATE_WORDS})\\b`, 'g');  // schedule.md (uppercase-only)

function stateWordsIn(line, re = STATE_RE_CI) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(line)) !== null) {
    const word = m[1].toUpperCase();
    const before = line.slice(0, m.index);
    const after = line.slice(m.index + m[1].length);
    if (/[A-Za-z0-9]-$/.test(before)) continue;              // compound: phase-2-live
    if (/^-[A-Za-z0-9]/.test(after)) continue;               // compound: Event-driven
    if (/(->|→)\s*$/.test(before.slice(-8))) continue;       // transition target: "PARKED -> X"
    if (/^\s*(->|→)/.test(after.slice(0, 8))) continue;      // transition source: "X -> ON-DEMAND"
    if (word === 'DISABLED' && /task scheduler|schtasks|scheduledtask/i.test(line)) continue;
    out.push(word);
  }
  return out;
}

function stateContradicts(word, manifestState) {
  const s = String(manifestState || '').toUpperCase();
  if (word === s) return false;
  if (word === 'PAUSED' && s === 'PARKED') return false; // same "deliberately stopped" class
  return true;
}

function v7StateDriftLint({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // --- scheduler/schedule.md (ERROR-tier) --------------------------------------------------
  const sched = effective(stagedDir, 'scheduler/schedule.md');
  if (sched) {
    const lines = sched.text.split(/\r?\n/);
    // sections: [startIdx, endIdx) of each "### " block
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('### ')) {
        if (sections.length) sections[sections.length - 1].end = i;
        sections.push({ start: i, end: lines.length });
      }
    }
    for (const sec of sections) {
      const title = lines[sec.start];
      const body = lines.slice(sec.start, sec.end);
      const cmdLine = body.find(l => /^\s*-\s*Command:/i.test(l)) || '';
      // associate the section to registry rows
      const owners = rows.filter(p => {
        if (p.title && new RegExp(`\\b${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title)) return true;
        if (p.num != null && new RegExp(`\\(#0?${p.num}\\)`).test(title)) return true;
        return (p.commands || []).some(c => new RegExp(`/${c}\\b`).test(cmdLine));
      });
      if (owners.length === 0) continue;
      // assertion lines: the title + Status/State lines
      const assertionIdx = [sec.start];
      for (let i = sec.start + 1; i < sec.end; i++)
        if (/^\s*-\s*\*{0,2}(Status|State)\b/i.test(lines[i])) assertionIdx.push(i);
      for (const idx of assertionIdx) {
        for (const word of stateWordsIn(lines[idx], STATE_RE_UC)) {
          for (const p of owners) {
            if (stateContradicts(word, p.state))
              failures.push(`FAILED V7: scheduler/schedule.md:${idx + 1} asserts ${word} but system/manifest.json says ${p.name} is ${p.state}`);
          }
        }
      }
    }
  }

  // --- vault status.md frontmatter + docs/projects headers (WARNING-tier) -------------------
  for (const p of rows) {
    if (p.status_md) {
      const st = effective(stagedDir, p.status_md);
      if (st) {
        const fmLines = st.text.split(/\r?\n/);
        if (fmLines[0] === '---') {
          for (let i = 1; i < fmLines.length && fmLines[i] !== '---'; i++) {
            const kv = fmLines[i].match(/^(state|status):\s*(.+)$/i);
            if (!kv) continue;
            for (const word of stateWordsIn(kv[2]))
              if (stateContradicts(word, p.state))
                warnings.push(`WARNING V7: ${p.status_md}:${i + 1} frontmatter says ${word} but system/manifest.json says ${p.name} is ${p.state}`);
          }
        }
      }
    }
    if (p.docs) {
      const rel = `docs/projects/${p.docs}`;
      const doc = effective(stagedDir, rel);
      if (doc) {
        const dLines = doc.text.split(/\r?\n/);
        for (let i = 0; i < dLines.length; i++) {
          if (!/^#{1,6}\s/.test(dLines[i])) continue;
          for (const word of stateWordsIn(dLines[i]))
            if (stateContradicts(word, p.state))
              warnings.push(`WARNING V7: ${rel}:${i + 1} heading says ${word} but system/manifest.json says ${p.name} is ${p.state}`);
        }
      }
    }
  }
}


// ---------------------------------------------------------------------------------------------
// V18 - shipped executables and command files (added 2026-08-17, after an external review found
//       SIX defects, every one of them on a surface no checker read).
//
//       That is the finding worth encoding. The manifest had a checker. The docs had a checker.
//       The vault links had a checker. The .cmd files, the command-file prose and the relative
//       markdown links had none, so that is exactly where everything broke: a 0x01 control byte
//       inside a path, six pre-flight guards that printed a warning and then carried on, a first-run
//       wizard listing five commands that do not exist, and a pointer to a deleted project's status
//       page inside the one scheduled unattended job.
//
//       Four legs, each one derived from a real defect rather than imagined:
//         (a) CONTROL BYTES. A .cmd file is executed by a parser with no syntax checking worth the
//             name; a stray byte inside a path produces a silent no-op, and output is usually
//             redirected to a log nobody reads.
//         (b) NON-TERMINATING GUARDS. `exit /b 1` inside a CALLed label pops the subroutine and
//             returns. Any `call :<label>` whose label ends in `exit /b 1` and is not immediately
//             followed by its own exit is a guard that does not guard.
//         (c) DANGLING COMMANDS. A /command named in a shipping file must exist as a command file.
//             The product teaches its users that "unknown command" means they opened the wrong
//             folder, so naming a command that does not exist manufactures the single most
//             confusing failure the product has.
//         (d) CUT-PROJECT PATHS. A shipping file must not point at a work/ or vault/projects/ path
//             belonging to a project that is not in the registry. This is the class that left a
//             never-send safety gate sourced from a deleted project.
// ---------------------------------------------------------------------------------------------
const V18_CMD_EXT = new Set(['.cmd', '.bat']);
const NEWLINE_RE = new RegExp('\\r?\\n');
const MD_LINK_RE = new RegExp('\\]\\(([^)\\s#]+\\.md)(?:#[^)]*)?\\)', 'g');
const EXTERNAL_URL_RE = new RegExp('^[a-z]+://', 'i');

// Claude Code ships these; this repo does not define them and must not be asked to.
// `skills` and `schedule` added 2026-09-23 (Virtual Alex plan Phase 4): the housekeeping Routine
// snapshots the claude.ai skills list, and the routines doc names the CLI's custom-cron path.
const V18_BUILTINS = new Set(['mcp', 'voice', 'clear', 'help', 'login', 'logout', 'config', 'doctor',
  'compact', 'resume', 'agents', 'plugin', 'review', 'init', 'model', 'cost', 'memory', 'terminal-setup',
  'vim', 'permissions', 'add-dir', 'bug', 'exit', 'quit', 'skills', 'schedule',
  // web-setup is the Claude Code built-in that stores a GitHub token at Anthropic. The Virtual Alex
  // /setup names it in order to say NEVER use it (2026-09-23), and a name that is a warning has to
  // resolve, or the warning itself reads as a dangling command.
  'web-setup']);
// Command-line switches that a slash-command regex cannot tell from a command.
const V18_CLI_SWITEMP = null;
const V18_CLI_SWITCHES = new Set(['change', 'query', 'create', 'xml', 'one', 'inheritance', 'grant',
  'sc', 'st', 'mo', 'tn', 'tr', 'delay', 'b', 'v', 'c', 'f', 'd', 'g', 'i', 'e', 's', 'n', 'p',
  'silent', 'accept-package-agreements', 'accept-source-agreements', 'fo', 'nul', 'dev']);

function v18ShippedExecutables({ stagedDir, manifest }, failures, warnings) {
  // TWO command trees since 2026-09-23. The Kit's own .claude/commands/ is the laptop set, and
  // variants/online/.claude/commands/ carries the online variant's: a file there lands at its real
  // path in the generated template, so a name that resolves in either tree is a real command
  // somewhere this product runs. The first online-only command is /alex-status, which exists
  // because the claude.ai web session has a built-in /status of its own that swallows Alex's.
  // Reading one tree would have made every mention of it read as a dangling command.
  const cmdDirs = [
    path.join(REPO, '.claude', 'commands'),
    path.join(REPO, 'variants', 'online', '.claude', 'commands'),
  ];
  const commandNames = new Set(
    cmdDirs.flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d) : []))
      .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
  );

  // ---- (a) control bytes in ANY shipped text file ---------------------------------------------
  // Deliberately NOT limited to .cmd. This check was written after a 0x01 byte was found inside a
  // path in the installer, and then immediately caught a SECOND instance in a JavaScript regex,
  // where word boundaries had been collapsed into literal backspace characters. Both looked
  // perfectly correct in an editor and in `cat`. A control byte is invisible in every normal view
  // and changes behaviour silently, which makes it precisely the kind of defect that only a machine
  // will ever find. Scanning one file type would have missed the second one.
  const textExt = new Set(['.cmd', '.bat', '.js', '.ps1', '.py', '.json', '.md', '.sh']);
  const scanCtrl = (abs, rel) => {
    const raw = fs.readFileSync(abs);
    const bad = [];
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b < 9 || (b >= 11 && b <= 12) || (b >= 14 && b <= 31)) {
        bad.push(`byte 0x${b.toString(16)} at offset ${i}`);
        if (bad.length >= 3) break;
      }
    }
    if (bad.length)
      failures.push(`FAILED V18: ${rel} contains control byte(s) (${bad.join(', ')}) - almost always a backslash escape eaten by whatever wrote the file. It is invisible in an editor and it changes behaviour silently.`);
  };
  const walkCtrl = (absDir, relDir) => {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.agents' || e.name === '.claude') continue;
      const abs = path.join(absDir, e.name);
      const rel = relDir ? relDir + '/' + e.name : e.name;
      if (e.isDirectory()) { walkCtrl(abs, rel); continue; }
      if (textExt.has(path.extname(e.name).toLowerCase())) scanCtrl(abs, rel);
    }
  };
  walkCtrl(REPO, '');

  // ---- (f) EVERY .ps1 must PARSE (added 2026-08-17, leg (a) missed two blockers) -----------------
  // Leg (a) scans for control bytes and must exclude 0x0A/0x0D or it would flag every newline. That
  // is a structural hole: when an eaten escape lands on a NEWLINE instead of a control byte, leg (a)
  // cannot see it. Two blockers lived in exactly that hole and both shipped past a full green suite:
  //   N-01  git-backup.ps1 stopped parsing (an orphaned brace left by the de-donoring pass). A parse
  //         error kills the script BEFORE its own run-status write, so the job died with no RED row,
  //         no toast and no log - invisible to the very failure signal built to catch dead jobs.
  //   N-02  security-sweep.ps1 had `\r` eaten into a real line break, splitting a path literal across
  //         two lines. Legal PowerShell, impossible path, whole sweep dead on first dot-source.
  // The generic instrument is to ASK THE PARSER instead of pattern-matching for known corruptions.
  // JS and Python already had this (node --check, py_compile); PowerShell was the gap, and it is
  // where every .ps1 in this system runs unattended. Windows-only by nature; skipped elsewhere.
  if (process.platform === 'win32') {
    const psFiles = [];
    const walkPs = (absDir) => {
      for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const abs = path.join(absDir, e.name);
        if (e.isDirectory()) { walkPs(abs); continue; }
        if (path.extname(e.name).toLowerCase() === '.ps1') psFiles.push(abs);
      }
    };
    walkPs(REPO);
    if (psFiles.length) {
      const listFile = path.join(os.tmpdir(), `alex-v18-ps-${process.pid}.txt`);
      fs.writeFileSync(listFile, psFiles.join('\n'), 'utf8');
      try {
        const ps = `$bad=@(); foreach($f in (Get-Content -LiteralPath '${listFile.replace(/'/g, "''")}')) { ` +
          `$e=$null;$t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e); ` +
          `if($e.Count){ $bad += ($f + ' line ' + $e[0].Extent.StartLineNumber + ': ' + $e[0].Message) } }; ` +
          `$bad -join "\`n"`;
        const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
          { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
        if (out) {
          for (const line of out.split('\n').map(s => s.replace(/\r$/, '')).filter(Boolean)) {
            failures.push(`FAILED V18: PowerShell parse error - ${line.replace(REPO, '').replace(/^[\\/]/, '')}. ` +
              `A .ps1 that does not parse never runs, and never reaches its own failure reporting, so it fails SILENTLY.`);
          }
        }
      } catch (e) {
        warnings.push(`WARNING V18: could not run the PowerShell parse sweep (${String(e.message).slice(0, 120)}) - ${psFiles.length} .ps1 file(s) unchecked`);
      } finally {
        try { fs.unlinkSync(listFile); } catch (_) { /* best effort */ }
      }
    }
  }

  // ---- (b) non-terminating guards in the .cmd files ---------------------------------------------
  for (const f of fs.readdirSync(REPO)) {
    if (!V18_CMD_EXT.has(path.extname(f).toLowerCase())) continue;
    const abs = path.join(REPO, f);
    const text = fs.readFileSync(abs).toString('utf8');
    const lines = text.split(/\r?\n/);

    // A label that ends in `exit /b 1` is a failure path. Reaching it with CALL returns to the
    // caller and the script carries on, which is the defect. Require `goto :<label>` instead.
    const failLabels = new Set();
    let current = null;
    for (const line of lines) {
      const lab = line.match(/^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (lab) { current = lab[1]; continue; }
      if (current && /^\s*exit\s*\/b\s*[1-9]/i.test(line)) failLabels.add(current);
    }
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*call\s+:([A-Za-z_][A-Za-z0-9_]*)/i);
      if (!m || !failLabels.has(m[1])) continue;
      const next = (lines[i + 1] || '').trim();
      if (!/^exit\s*\/b\s*[1-9]/i.test(next) && !/^goto\s+:/i.test(next))
        failures.push(`FAILED V18: ${f}:${i + 1} uses \`call :${m[1]}\`, but :${m[1]} is a failure path ending in \`exit /b\`. \`exit /b\` inside a CALLed label RETURNS to the caller, so this guard prints its warning and then carries on. Use \`goto :${m[1]}\`, or follow the call with its own \`exit /b 1\`.`);
    }
  }

  // ---- (e) relative markdown links in docs/ resolve --------------------------------------------
  // C6 covers [[wiki links]] inside the vault. NOTHING covered ordinary [text](file.md) links, and
  // docs/projects/ shipped with ten of them pointing at pages for deleted projects. That is the
  // human-readable layer, the one a non-technical owner is most likely to open, so it was both the
  // least true part of the repository and the least likely to be noticed: a dead link does not
  // error, the reader simply finds nothing and quietly trusts the system a bit less.
  const walkDocs = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = rel + '/' + e.name;
      if (e.isDirectory()) { walkDocs(a, r); continue; }
      if (!e.name.endsWith('.md')) continue;
      const lines = fs.readFileSync(a, 'utf8').split(NEWLINE_RE);
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(MD_LINK_RE)) {
          const target = m[1];
          if (EXTERNAL_URL_RE.test(target)) continue;
          if (!fs.existsSync(path.resolve(path.dirname(a), target)))
            failures.push(`FAILED V18: ${r}:${i + 1} links to '${target}', which does not exist`);
        }
      }
    }
  };
  walkDocs(path.join(REPO, 'docs'), 'docs');

  // ---- (c) + (d): the shipping markdown surfaces ------------------------------------------------
  const liveWorkDirs = new Set(manifest.projects.map(p => (p.work_dir || '').replace(/\\/g, '/')));
  const liveStatus = new Set(manifest.projects.map(p => (p.status_md || '').replace(/\\/g, '/')));
  const utility = new Set(manifest.meta.utility_commands || []);
  const known = new Set([...commandNames, ...utility]);

  // EACH PAGE AGAINST THE WORLD IT SHIPS TO (2026-09-24, fleet Fix C, review finding F37). The union
  // above let a laptop-only page name /alex-status and an online-only page name /cron-setup. In the
  // Kit (variants/online present) three sets now apply: a page under variants/online/ is online-only
  // and resolves against the ONLINE commands (the Kit's own minus the drop rows, plus the variants);
  // a Kit page that a drop row or a variant replaces is laptop-only and resolves against the LAPTOP
  // commands; a page shipped to both keeps the union, because it speaks to both worlds (update.md
  // tells a laptop owner to stop and double-click instead). A generated tree has one set: `known`.
  const variantsDir = path.join(REPO, 'variants', 'online');
  const inKit = fs.existsSync(variantsDir);
  const dropped = kitManifestDropClaim(stagedDir);
  const namesIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  const laptopKnown = new Set([...namesIn(cmdDirs[0]), ...utility]);
  const onlineKnown = new Set([
    ...namesIn(cmdDirs[0]).filter(n => !dropped(`.claude/commands/${n}.md`)),
    ...namesIn(cmdDirs[1]),
  ]);
  const knownFor = (rel) => {
    if (!inKit) return { set: known, world: 'in this system' };
    if (rel.startsWith('variants/online/')) return { set: onlineKnown, world: 'online, where this page ships alone' };
    if (dropped(rel) || fs.existsSync(path.join(variantsDir, rel))) return { set: laptopKnown, world: 'on a laptop, where this page ships alone' };
    return { set: known, world: 'in either world' };
  };

  const surfaces = [];
  const pushDir = (rel, recurse) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel + '/' + e.name;
      if (e.isDirectory()) { if (recurse) pushDir(r, recurse); continue; }
      if (e.name.endsWith('.md')) surfaces.push(r);
    }
  };
  pushDir('.claude/commands', false);
  pushDir('work', true);
  surfaces.push('CLAUDE.md');
  if (inKit) {
    // the online-only pages, read against the online commands (they were not read at all before)
    pushDir('variants/online/.claude/commands', false);
    surfaces.push('variants/online/CLAUDE.md');
  }

  for (const rel of surfaces) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    const { set: pageKnown, world } = knownFor(rel);
    const lines = eff.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(#|>)?\s*(RETIRED|CUT|removed)\b/i.test(line)) continue;

      // (c) every /command token must resolve
      for (const m of line.matchAll(/(?:^|[\s(`"'*])\/([a-z][a-z0-9-]{2,})\b/g)) {
        const name = m[1];
        if (pageKnown.has(name)) continue;
        // Claude Code's own built-ins are real commands that this repo does not define. They are
        // listed rather than pattern-matched, because "anything I do not recognise is probably a
        // built-in" is how a checker learns to pass.
        if (V18_BUILTINS.has(name)) continue;
        // CLI switches read as commands to a regex: `schtasks /change`, `icacls /grant`, `/sc DAILY`.
        // A switch is preceded by a command word on the same line, so require the token to start a
        // line or follow punctuation that a prose mention would use.
        if (V18_CLI_SWITCHES.has(name)) continue;
        // An absolute POSIX path is not a command. A slash command has exactly one slash
        // (/cron-setup); a path has another one right after the first segment (/var/db/...,
        // /usr/local/bin, /Library/LaunchAgents). Added 2026-09-20: the Kit runs on macOS now,
        // so absolute POSIX paths appear in its docs, and backticks are in the allowed prefix
        // set above - so every one of them read as an unknown command. Narrow on purpose: it
        // skips ONLY when a slash follows immediately, which no real command reference does.
        if (line[m.index + m[0].length] === "/") continue;
        // A line saying the command does not exist is warning the reader off it, never telling them
        // to type it (the online constitution: "`/cron-setup` does not exist here"). Narrow on
        // purpose: the exact backticked name followed by "does not exist".
        if (line.includes('`/' + name + '` does not exist')) continue;
        if (/\.(md|json|js|ps1|cmd|py|txt)$/.test(name)) continue;
        failures.push(`FAILED V18: ${rel}:${i + 1} names \`/${name}\`, which is not a command ${world}. Telling a user to type a command that does not exist produces "unknown command", and this product teaches its users that "unknown command" means they opened the wrong folder.`);
      }

      // (d) no path belonging to a project that is not registered
      for (const m of line.matchAll(/\b(work\/[0-9]{2}-[a-z0-9-]+)/g))
        if (!liveWorkDirs.has(m[1]))
          failures.push(`FAILED V18: ${rel}:${i + 1} points at \`${m[1]}\`, which is not a project in system/manifest.json`);
      for (const m of line.matchAll(/\b(vault\/projects\/[a-z0-9-]+\/status\.md)/g))
        if (!liveStatus.has(m[1]))
          failures.push(`FAILED V18: ${rel}:${i + 1} points at \`${m[1]}\`, the status page of a project that does not exist here. If that pointer carries a RULE, the rule now has no source.`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V19 - Routine prompt files bound to the registry (2026-09-23, Virtual Alex plan Phase 4, seat 5).
//       Online the scheduler is five Routines on the owner's claude.ai account, each a form whose
//       prompt is one line pointing at a committed file under scheduler/routines/. The rows in
//       system/manifest.json routines[] are what the generator renders into docs/ROUTINES-FORMS.md
//       and what the weekly sweep (work/18-recovery-layer/check.mjs) reads back against the run
//       log. A prompt file with no row is an order nobody scheduled and nobody checks; a row naming
//       a missing file is a form that points at nothing and a Routine that fails on its first
//       line. Both FAIL. The row shape is gen-routines.js's own contract (routineRows), so the
//       generator and this leg cannot disagree about what a row must carry. Pure file reads, every
//       context. A drift leg under CLAUDE_CODE_REMOTE (REMOTE_DRIFT_LEGS): scheduler/routines/ is
//       identity-denied in every unattended session, so an orphan there is an owner's edit, and an
//       autosave is never blocked on it; the persisting one is the weekly sweep's to name.
// ---------------------------------------------------------------------------------------------
function v19RoutinePrompts({ manifest }, failures, warnings) {
  let rows;
  try { rows = routineRows(manifest); }
  catch (e) { failures.push(`FAILED V19: system/manifest.json routines[] is malformed - ${e.message}`); return; }
  const dir = path.join(REPO, ...ROUTINES_DIR.split('/'));
  const onDisk = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${ROUTINES_DIR}/${f}`)
    : [];
  const named = new Set(rows.map(r => r.prompt_file));
  for (const r of rows) {
    if (!fs.existsSync(path.join(REPO, ...r.prompt_file.split('/'))))
      failures.push(`FAILED V19: routines[] row "${r.name}" names ${r.prompt_file}, which does not exist - a form pointing at a missing file is a Routine that fails on its first line`);
  }
  for (const f of onDisk) {
    if (!named.has(f))
      failures.push(`FAILED V19: ${f} has no routines[] row in system/manifest.json - a prompt file nobody scheduled is an order nobody checks; add the row (${['name', 'prompt_file', 'preset', 'time_local', 'cadence_hours', 'environment', 'connectors', 'repositories', 'model', 'first_run_check'].join(', ')}) or remove the file`);
  }
  const def = manifest.meta && manifest.meta.model_routing && manifest.meta.model_routing.default;
  for (const r of rows) {
    if (def && r.model !== def)
      warnings.push(`WARNING V19: routines[] row "${r.name}" carries model ${r.model} while meta.model_routing.default is ${def} - a deliberate override is allowed, an accidental one is the cost-leak class V13 exists for`);
  }
}

// ---------------------------------------------------------------------------------------------
// V9 - first-fire aging (upgrade P4, 2026-07-12, design 1.4/MR2-5): every LIVE/EVENT registry
//      row (numbered + meta.unnumbered) that has NEVER fired (first_fire null) is listed as a
//      WARNING - never a failure (the aging rule blocks nothing; it makes scaffold-masquerade
//      visible). The registry rule (manifest states_doc) allows 14 days from the project's
//      status.md frontmatter `created:` date; rows past that window are marked OVERDUE (check.ps1
//      C13 goes amber on the same condition). ON-DEMAND/DORMANT/PARKED/RETIRED are exempt by
//      rule - they have no promise to fire. A documented drill counts (first_fire_kind=drill).
// ---------------------------------------------------------------------------------------------
function v9FirstFireAging({ stagedDir, manifest }, failures, warnings) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];

  // (a) FUTURE first_fire = FAILURE (added 2026-07-28, command-layer review F-8). first_fire is the
  //     registry's proof-of-life record: "has this project ever actually produced for real". Both this
  //     check's aging half and check.ps1 C13 branch on first_fire being NULL, so a populated FUTURE date
  //     passes every check while asserting a fire that has not happened - the claim sits inside the
  //     structure but outside what the structure validates. It also permanently disables the 14-day
  //     aging clock, so a project that never fires can never be flagged. #31 carried "2026-07-29" on
  //     2026-07-28 and nothing caught it. The design already makes honesty easy (first_fire_kind:"drill"
  //     lets a documented test run count AND be marked as such), so a future date is never the right answer.
  const today = new Date().toISOString().slice(0, 10);
  for (const p of rows) {
    if (!p.first_fire || !/^\d{4}-\d{2}-\d{2}$/.test(p.first_fire)) continue;
    if (p.first_fire > today) {
      const label = p.num != null ? `#${pad(p.num)} ${p.name}` : p.name;
      failures.push(`FAILED V9: ${label} has first_fire "${p.first_fire}", which is in the FUTURE (today ${today}) - first_fire records a fire that ALREADY happened; set the real date, or null to let the 14-day aging clock run (a documented drill counts, first_fire_kind=drill)`);
    }
  }

  // (b) aging half: never-fired LIVE/EVENT rows, WARNING only (the aging rule blocks nothing).
  //
  // THE CLOCK IS THE status.md `created:` DATE, AND AN ABSENT ONE IS NOT EVIDENCE (2026-09-23,
  // Virtual Alex fleet). Until now a row with no created date was filed as OVERDUE, which reads as
  // a measurement and is not one: with no start date there is no elapsed time, and the check was
  // asserting a window it had not measured. The cost is not theoretical. /setup is what writes
  // `created:`, so on the FIRST day of any install not one project has a date, and every new owner
  // opened their brand new Alex to a list of projects "PAST the 14-day window" (measured on a real
  // install, 2026-09-23). A guard that cries on day one is a guard its owner learns to scroll past.
  //
  // So: an unknown date is reported as unknown, never as overdue, and a whole install younger than
  // the window it is measuring says nothing at all. Install age is the OLDEST created date in the
  // tree; a day-one install has none, and one set up last week has none older than 14 days.
  const WINDOW_DAYS = 14;
  const createdAge = (p) => {
    if (!p.status_md) return null;
    const st = effective(stagedDir, p.status_md);
    const m = st && st.text.match(/^created:\s*(\d{4}-\d{2}-\d{2})/m);
    if (!m) return null;
    return Math.floor((Date.now() - new Date(`${m[1]}T00:00:00Z`).getTime()) / 86400000);
  };

  const flagged = [];
  let installAge = null;
  for (const p of rows) {
    const age = createdAge(p);
    if (age !== null && (installAge === null || age > installAge)) installAge = age;
    if (p.state !== 'LIVE' && p.state !== 'EVENT') continue;
    if (p.first_fire) continue;
    flagged.push({ label: p.num != null ? `#${pad(p.num)} ${p.name}` : p.name, ageDays: age });
  }
  if (flagged.length === 0) return;

  // No status page carries a created: date, so the pages cannot age the install. Until 2026-09-24
  // that made an install of ANY age silent forever (review finding F17). Two other clocks, each a
  // LOWER bound on the install's age, so neither can make a day-one install cry again:
  //   the install record's stamp date: the install is at least as old as the day it was last
  //     stamped, whatever the lane;
  //   online only, the repository's first commit: the owner's repository begins at install. On a
  //     laptop the first commit is the Kit's own history, weeks older than any install, so it is
  //     never read there.
  if (installAge === null) installAge = installAgeFallback(stagedDir);

  // A fresh install: nothing here has had time to fire, so there is nothing to say.
  if (installAge === null || installAge <= WINDOW_DAYS) return;

  const fmt = f => `${f.label} (${f.ageDays === null ? 'created date unknown' : `${f.ageDays}d since created`})`;
  const overdue = flagged.filter(f => f.ageDays !== null && f.ageDays > WINDOW_DAYS);
  const within = flagged.filter(f => f.ageDays !== null && f.ageDays <= WINDOW_DAYS);
  const undated = flagged.filter(f => f.ageDays === null);
  if (overdue.length)
    warnings.push(`WARNING V9: LIVE/EVENT project(s) never fired (first_fire null) PAST the ${WINDOW_DAYS}-day window: ${overdue.map(fmt).join(', ')} - fire it (a documented drill counts, first_fire_kind=drill) or re-state it with a reason`);
  if (within.length)
    warnings.push(`WARNING V9: LIVE/EVENT project(s) never fired (first_fire null), still inside the ${WINDOW_DAYS}-day window: ${within.map(fmt).join(', ')}`);
  if (undated.length)
    warnings.push(`WARNING V9: LIVE/EVENT project(s) never fired (first_fire null) and with no created: date to age them against: ${undated.map(f => f.label).join(', ')} - stamp created: in the status page, or fire it`);
}

// V9's install age when no status page is dated: the older of two lower bounds, or null. Never throws.
function installAgeFallback(stagedDir) {
  const dayAge = (d) => Math.floor((Date.now() - new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getTime()) / 86400000);
  const ages = [];
  const st = effective(stagedDir, 'system/install-state.json');
  if (st) {
    try {
      const j = JSON.parse(st.text);
      const d = j.template_updated_at || j.updatedAt;   // the legacy key reads too, as install-state.js does
      if (/^\d{4}-\d{2}-\d{2}/.test(String(d || ''))) ages.push(dayAge(d));
    } catch (_) { /* an unreadable record is no clock */ }
  }
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    try {
      const roots = execFileSync('git', ['log', '--max-parents=0', '--format=%cI', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(String.fromCharCode(10)).map(x => x.trim()).filter(x => /^\d{4}-\d{2}-\d{2}/.test(x));
      for (const r of roots) ages.push(dayAge(r));
    } catch (_) { /* no git here: the record alone decides */ }
  }
  const valid = ages.filter(a => Number.isFinite(a) && a >= 0);
  return valid.length ? Math.max(...valid) : null;
}

// ---------------------------------------------------------------------------------------------
// V10 - protected-file guard (context-engineering run, 2026-07-15). Enforces vault/me/NEVER-TOUCH.md
//       at COMMIT TIME. A CHANGESET question (git's staged diff), not a content question, so it
//       reads git directly and runs ONLY in pre-commit context with --changed (armed by
//       scripts/hooks/pre-commit); a no-op in the generator context, so generate-alex.js is
//       untouched.
//
//       Rule per protected path (kinds: immutable | append-only | flagged):
//         - delete / rename-away of a protected path -> FAIL (immutable, append), WARNING (flagged)
//         - modify of an immutable path              -> FAIL
//         - modify of an append-only path            -> FAIL unless the staged diff is pure addition
//                                                       (numstat removed-lines == 0)
//         - modify of a flagged path                 -> WARNING
//         - add (new file), incl. under an immutable dir -> allowed
//       Override: git commit --no-verify (documented in NEVER-TOUCH.md; no custom flag).
//
//       V10_PROTECTED below is the canonical machine list; the human doc is vault/me/NEVER-TOUCH.md
//       (keep the two in sync - short, low-churn set).
//
//       HONESTY NOTE (the privacy scrub reality): a commit guard can only see git-TRACKED files.
//       All of vault/** and outputs/** are gitignored (local-only, encrypted-backup-covered), so
//       those entries NEVER appear in a staged diff - the guard cannot enforce them at commit time;
//       they are protected by policy + the encrypted vault backup, and are listed here (tracked:false)
//       so the set stays canonical and the guard auto-covers any entry that ever becomes tracked.
//       The entries the guard ACTIVELY enforces are the tracked ones (tracked:true):
//       system/landscape-log.jsonl and brand/config/color-system.md.
// ---------------------------------------------------------------------------------------------
const V10_PROTECTED = [
  { path: 'vault/sources/', kind: 'immutable', dir: true, tracked: false },
  { path: 'vault/log.md', kind: 'append', tracked: false },
  { path: 'vault/projects/self-review/close-out-log.md', kind: 'append', tracked: false },
  { path: 'vault/projects/sprint-tracker/velocity.md', kind: 'append', tracked: false },
  { path: 'outputs/ledger.jsonl', kind: 'append', tracked: false },
  { path: 'system/human-actions.jsonl', kind: 'append', tracked: false },   // BUG-07 fix 2026-07-15: the two queues NEVER-TOUCH.md
  { path: 'system/pending-writes.jsonl', kind: 'append', tracked: false },  // lists as append-only were absent from V10_PROTECTED; added so the set matches the doc
  { path: 'system/landscape-log.jsonl', kind: 'append', tracked: true },
  { path: 'vault/identity.md', kind: 'flagged', tracked: false },
  { path: 'brand/config/color-system.md', kind: 'flagged', tracked: true },
];

function matchProtected(rel, list = V10_PROTECTED) {
  const p = String(rel || '').split(path.sep).join('/');
  for (const entry of list) {
    if (entry.dir) { if (p === entry.path.replace(/\/$/, '') || p.startsWith(entry.path)) return entry; }
    else if (p === entry.path) return entry;
  }
  return null;
}

// PURE evaluator (unit-tested directly): changeset = [{status, path, oldPath?, removed}], status a
// single git letter (A/M/D/R/C); removed is the numstat removed-line count (consulted for M only).
function evaluateProtectedChangeset(changeset, list = V10_PROTECTED) {
  const failures = [], warnings = [];
  for (const ch of changeset) {
    const st = String(ch.status || '').toUpperCase();
    if (st === 'D' || st.startsWith('R')) {
      // judged on the path that LEAVES its protected home (old path for a rename)
      const gone = st.startsWith('R') ? (ch.oldPath || ch.path) : ch.path;
      const hit = matchProtected(gone, list);
      if (hit) {
        const verb = st === 'D' ? 'deletes' : 'renames away';
        const msg = `commit ${verb} protected ${hit.kind} path ${gone} (NEVER-TOUCH.md)`;
        if (hit.kind === 'flagged') warnings.push(`WARNING V10: ${msg} - surfaced, not blocked`);
        else failures.push(`FAILED V10: ${msg} - use 'git commit --no-verify' to override deliberately`);
      }
      continue;
    }
    if (st === 'M') {
      const hit = matchProtected(ch.path, list);
      if (!hit) continue;
      if (hit.kind === 'immutable')
        failures.push(`FAILED V10: commit modifies immutable ${ch.path} (NEVER-TOUCH.md) - content is read-only; --no-verify to override`);
      else if (hit.kind === 'flagged')
        warnings.push(`WARNING V10: commit modifies flagged ${ch.path} (NEVER-TOUCH.md) - surfaced, not blocked`);
      else if (hit.kind === 'append') {
        const removed = Number(ch.removed);
        if (!Number.isFinite(removed) || removed > 0)
          failures.push(`FAILED V10: commit modifies append-only ${ch.path} with ${Number.isFinite(removed) ? removed : 'non-text/unknown'} removed line(s) (NEVER-TOUCH.md) - append-only files may only grow; --no-verify to override`);
      }
    }
    // A (add) and any other status: allowed
  }
  return { failures, warnings };
}

// Reads git's staged changeset (name-status + numstat, both -z for robust paths). Only called in
// pre-commit context, so git shelling never happens on the generator path.
function readStagedChangeset() {
  const { execFileSync } = require('child_process');
  const run = args => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });
  const changeset = [];
  const ns = run(['diff', '--cached', '--name-status', '-z']).split('\0');
  for (let i = 0; i < ns.length; i++) {
    const status = ns[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = ns[++i], newPath = ns[++i];
      changeset.push({ status: status[0], oldPath, path: newPath });
    } else {
      const p = ns[++i];
      if (p == null) break;
      changeset.push({ status: status[0], path: p });
    }
  }
  // numstat removed-line counts for modified files (rename records skipped: those FAIL via name-status)
  const removedByPath = new Map();
  const num = run(['diff', '--cached', '--numstat', '-z']).split('\0');
  for (let i = 0; i < num.length; i++) {
    const tok = num[i];
    if (!tok) continue;
    const parts = tok.split('\t');
    if (parts.length === 3 && parts[2] !== '') removedByPath.set(parts[2], parts[1]); // '-' for binary
    else if (parts.length === 3 && parts[2] === '') i += 2; // rename record: skip old+new tokens
  }
  for (const ch of changeset)
    if (ch.status === 'M') ch.removed = removedByPath.has(ch.path) ? removedByPath.get(ch.path) : '0';
  return changeset;
}

function v10ProtectedFileGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  let changeset;
  try { changeset = readStagedChangeset(); }
  catch (e) { warnings.push(`WARNING V10 SKIPPED: could not read the staged changeset via git - ${e.message}`); return; }
  const res = evaluateProtectedChangeset(changeset);
  for (const f of res.failures) failures.push(f);
  for (const w of res.warnings) warnings.push(w);
}

// V11 - the forced-add guard (2026-07-17, three-plan validation run, plan phase P0a). COMMIT-TIME ONLY.
// Lists every tracked-but-ignored path: a `git add -f` of a .gitignore'd file. On the PUBLIC repo where
// .gitignore is the SOLE privacy barrier, one forced-added secret pushed at 21:30 is world-visible and
// permanently cacheable even after deletion. This is the machine behind .gitignore's own "rotate it
// immediately" line, fired at the only cadence that beats the nightly push: commit time. It lists ALL
// such paths (not just this commit's), so a historical forced add surfaces on the next commit too.
// The hook wrapper (scripts/hooks/pre-commit) fires this on interactive AND nightly-backup commits.
function v11IgnoredStagedGuard({ context, changed }, failures, warnings) {
  if (context !== 'pre-commit' || !changed) return; // armed only by the commit hook
  const { execFileSync } = require('child_process');
  let out;
  try {
    out = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard'],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24 });
  } catch (e) {
    warnings.push(`WARNING V11 SKIPPED: could not list tracked-vs-ignored paths via git - ${e.message}`);
    return;
  }
  const paths = out.split('\n').map(s => s.trim()).filter(Boolean);
  if (paths.length) {
    failures.push(
      `FAILED V11: ${paths.length} gitignored path(s) are TRACKED (a forced 'git add -f' of an ignored file). ` +
      `On the PUBLIC repo this PUBLISHES them at the next push: ${paths.join(', ')}. ` +
      `Fix: 'git rm --cached <path>' (keeps the local file) or correct .gitignore. ` +
      `Deliberate override: 'git commit --no-verify'.`);
  }
}

// V12 - the trifecta gate (2026-07-17, three-plan validation P3). Pure file checks, no network.
// The agent-security Rule-of-Two made a validated invariant. Each manifest project carries a
// `trifecta` block {private_data, untrusted_content, external_comm} (raw capability/exposure) + a
// `gate` (the mitigation). Rule: any project with ALL THREE legs true MUST declare a non-null gate
// from the vocab, and that gate string MUST appear on a `## Trifecta` line in its work/NN/CLAUDE.md.
// Any declared gate (even without all three) must be in the vocab and echoed in its CLAUDE.md.
// v1 DROPS the read-only-vs-write integrations assertion (F7, master res 8: the manifest carries no
// integrations data). meta.trifecta_doc holds the vocab + rules; vault/research/trifecta-map.md the map.
const TRIFECTA_GATES = new Set(['draft-only', 'human-posts', 'queue-only', 'read-only']);
function v12TrifectaGate({ stagedDir, manifest }, failures, warnings) {
  for (const p of manifest.projects) {
    const t = p.trifecta;
    if (!t) { warnings.push(`WARNING V12: project ${pad(p.num)} ${p.title} has no trifecta block - classify it in system/manifest.json`); continue; }
    const allThree = t.private_data && t.untrusted_content && t.external_comm;
    const hasGate = t.gate != null && t.gate !== '';
    // (a) all three legs true => a non-null gate is mandatory
    if (allThree && !hasGate) {
      failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} has all three trifecta legs true but no gate - it MUST declare one of {${[...TRIFECTA_GATES].join(', ')}}`);
      continue;
    }
    // (b) any declared gate must be in the vocab
    if (hasGate && !TRIFECTA_GATES.has(t.gate)) {
      failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" not in the vocab {${[...TRIFECTA_GATES].join(', ')}}`);
      continue;
    }
    // (c) a declared gate must appear in a `## Trifecta` section of the project's work/NN/CLAUDE.md
    if (hasGate) {
      if (!p.work_dir) { failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but has no work_dir to hold its ## Trifecta line`); continue; }
      const rel = p.work_dir.replace(/\\/g, '/') + '/CLAUDE.md';
      const cm = effective(stagedDir, rel);
      if (!cm) { failures.push(`FAILED V12: project ${pad(p.num)} ${p.title} declares gate "${t.gate}" but ${rel} was not found`); continue; }
      const sec = mdSection(cm.text, /^##\s+Trifecta\b/m);
      if (sec === null) { failures.push(`FAILED V12: ${rel} is missing a "## Trifecta" section (project ${pad(p.num)} declares gate "${t.gate}")`); continue; }
      // The gate must appear on a `Gate:` DECLARATION line, not merely somewhere in the section.
      // TIGHTENED 2026-07-29: this was `sec.includes(t.gate)`, a substring match over the whole
      // section, which any prose mention of a different gate word defeats. Found by negative-testing
      // the #31 reclassification: #31's section legitimately explains why the DRAFTING half (#32)
      // keeps `draft-only`, so flipping #31's declared gate to draft-only still PASSED - the check
      // could not tell a declaration from an explanation. Every spec already writes
      // `Gate: **<gate>**` (#28 writes `Gate: read-only` unbolded), so requiring the declaration line
      // costs nothing and closes the hole. Same principle as the CMD-HEADER work: assert the
      // structured claim, never free prose.
      const gateLine = sec.split(/\r?\n/).some(l =>
        new RegExp(`\\bGate:\\s*\\**\\s*${t.gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(l));
      if (!gateLine) failures.push(`FAILED V12: the "## Trifecta" section of ${rel} has no "Gate: ${t.gate}" declaration line (a passing mention elsewhere in the section does not count, tightened 2026-07-29)`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V13 - local wrapper model-pin contract (2026-07-25, stress-test fix F4). The LOCAL twin of V6.
//       V6 asserts n8n node models against meta.model_routing; V13 asserts the scheduled `claude -p`
//       wrappers under scripts/ against meta.model_routing.local_wrappers. Pure file reads, no
//       network, so it runs in EVERY context (generator + pre-commit) - unlike V6 which is async/
//       n8n-bound and SKIPs when n8n is unreachable. Root fix for "a wrapper omits --model and
//       inherits the global opus default" (the 2026-07-16 cost cut was convention-only until now).
//       COMPLETE by construction: every scripts/run-*.ps1 (+ auth-check.ps1) that makes a real
//       `claude -p` call MUST be in `pins` (with the matching model) or `deterministic_no_pin`
//       (makes no claude call), else FAIL - so a new/copied wrapper cannot slip through uncovered.
//       This is the bidirectional shape V2 uses for scheduled jobs, applied to the model contract.
// ---------------------------------------------------------------------------------------------
function v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings) {
  const lw = manifest.meta && manifest.meta.model_routing && manifest.meta.model_routing.local_wrappers;
  if (!lw || !lw.pins) {
    warnings.push('WARNING V13: system/manifest.json meta.model_routing.local_wrappers.pins is not set - the local wrapper model-pin contract is unenforced (add it to enable V13)');
    return;
  }
  const pins = lw.pins;
  const detNoPin = new Set(lw.deterministic_no_pin || []);
  const scriptsDir = path.join(REPO, 'scripts');
  let files;
  try {
    files = fs.readdirSync(scriptsDir).filter(f => /^run-.*\.ps1$/.test(f) || f === 'auth-check.ps1');
  } catch (e) { failures.push(`FAILED V13: cannot read scripts/ to enforce the wrapper pin contract - ${e.message}`); return; }

  // The real reasoning-call line: a non-comment line that invokes claude (claude.ps1 / $ClaudeCmd /
  // a bare `claude`) with the -p prompt flag. (mcp-list warmups use `& claude.ps1 mcp list` with no
  // -p, so they are correctly ignored.)
  // HARDENED 2026-07-25 (stress-test T07/F-07): the original matcher required the `&` call operator
  // on the SAME single line, so a PowerShell backtick continuation or a `Start-Process`/bare-command
  // invocation evaded it silently. Two changes: (1) logical lines are joined across backtick
  // continuations and the `&` requirement is dropped; (2) COVERAGE no longer depends on this parser
  // at all - see the declaration-completeness rule below - so a future unparseable shape can cost a
  // model assertion but can never create an UNDECLARED wrapper.
  const logicalLines = text => {
    const out = [];
    let buf = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = buf === null ? raw : buf + ' ' + raw.trim();
      if (/`\s*$/.test(line)) { buf = line.replace(/`\s*$/, ''); continue; } // PS line continuation
      buf = null;
      out.push(line);
    }
    if (buf !== null) out.push(buf);
    return out;
  };
  const claudeCallLine = text => {
    for (const line of logicalLines(text)) {
      if (/^\s*#/.test(line)) continue;                        // skip comments
      if (!/claude/i.test(line)) continue;                     // names claude.ps1 / $ClaudeCmd / claude
      if (!/(^|\s)-p(\s|$)/.test(line)) continue;              // the prompt flag
      return line;
    }
    return null;
  };
  const modelOf = line => { const m = line.match(/--model\s+([A-Za-z0-9._-]+)/); return m ? m[1] : null; };

  for (const f of files) {
    const eff = effective(stagedDir, `scripts/${f}`);
    if (!eff) continue;
    const line = claudeCallLine(eff.text);
    const inPins = Object.prototype.hasOwnProperty.call(pins, f);
    const inDet = detNoPin.has(f);

    // COMPLETENESS, parser-independent (2026-07-25): every wrapper the glob finds MUST be declared,
    // whether or not a claude call is detected. This is what makes V13 complete by construction - a
    // new or copied wrapper cannot slip through on a call shape the matcher cannot read.
    if (!inPins && !inDet) {
      failures.push(`FAILED V13: scripts/${f} is in NEITHER meta.model_routing.local_wrappers.pins NOR deterministic_no_pin - every scheduled wrapper must be declared (an unlisted wrapper that calls claude inherits the global model default); add it to the contract`);
      continue;
    }
    if (inPins && inDet)
      failures.push(`FAILED V13: scripts/${f} is declared in BOTH pins and deterministic_no_pin - the contract must say exactly one`);

    if (line) {
      if (inDet)
        failures.push(`FAILED V13: scripts/${f} is declared deterministic_no_pin but makes a real 'claude -p' call - move it to pins with its model, or the flag is a bug`);
      if (!inPins) continue;
      const want = pins[f], got = modelOf(line);
      if (!got) failures.push(`FAILED V13: scripts/${f} 'claude -p' call has no --model (the contract wants ${want}; without it the wrapper inherits the global default)`);
      else if (got !== want) failures.push(`FAILED V13: scripts/${f} pins --model ${got} but meta.model_routing.local_wrappers wants ${want}`);
    } else if (inPins) {
      warnings.push(`WARNING V13: scripts/${f} is in local_wrappers.pins but has no 'claude -p' call - stale pin entry (remove it, or the wrapper lost its reasoning call)`);
    }
  }
  // A pin whose file is ABSENT here AND whose path a `drop` row in system/kit-manifest.json claims
  // is skipped (2026-09-23, Virtual Alex plan Phase 4, the RUN-STATE ruling). The online tree ships
  // the registry as is while every scheduled wrapper is a drop row and never exists there, so
  // without this every autosave online printed six V13 lines for files that are absent by design.
  // On a laptop the files exist and are checked exactly as before. A pin naming an absent file that
  // NO drop row claims still FAILS: that is a stale contract, not a dropped one. Silent on purpose:
  // a permanent warning for a by-design absence is the amber-blindness class.
  const dropped = kitManifestDropClaim(stagedDir);
  for (const f of Object.keys(pins)) {
    if (files.includes(f) || dropped(`scripts/${f}`)) continue;
    failures.push(`FAILED V13: local_wrappers.pins names scripts/${f} which does not exist`);
  }
  for (const f of detNoPin) {
    if (files.includes(f) || dropped(`scripts/${f}`)) continue;
    warnings.push(`WARNING V13: local_wrappers.deterministic_no_pin names scripts/${f} which does not exist`);
  }
}

// The most specific claim in system/kit-manifest.json for a path, the generator's own rule (an exact
// name beats a directory, a longer prefix beats a shorter one; scripts/build-online-template.mjs
// claimFor). Returns a predicate: true when that claim is a `drop` row. An absent or unreadable
// kit-manifest drops nothing, so V13 falls back to its old behaviour rather than guessing.
function kitManifestDropClaim(stagedDir) {
  const eff = effective(stagedDir, 'system/kit-manifest.json');
  if (!eff) return () => false;
  let rows;
  try { rows = JSON.parse(eff.text).components || []; } catch (_) { return () => false; }
  const claims = [];
  for (const r of rows) for (const p of (r && Array.isArray(r.paths) ? r.paths : [])) if (typeof p === 'string') claims.push({ online: r.online, prefix: p, isDir: p.endsWith('/') });
  return rel => {
    let best = null;
    for (const c of claims) {
      const hit = c.isDir ? rel.startsWith(c.prefix) : rel === c.prefix;
      if (hit && (!best || c.prefix.length > best.prefix.length)) best = c;
    }
    return Boolean(best && best.online === 'drop');
  };
}

// V14 - Alex gender-neutrality contract (2026-07-28, the owner's standing voice law: "I do not want
//       to give Alex a gender, I want you to not use HE/HIM at all"). The code behind work/12
//       HARD RULE 15 and the soul.md My Words entry of the same date.
//
//       WHY IT EXISTS: the rule was actually first called on 2026-07-05 (see templates/
//       architecture.template.md and docs/ARCHITECTURE.md) and NOTHING enforced it, so episodes 02
//       to 06 published with "he" anyway. A convention that only an agent remembers to run is not a
//       gate. This is the same lesson as V6: expectations live as DATA and are machine-checked, not
//       as prose someone is trusted to have read.
//
//       TWO NARROW SCANS, deliberately not one blanket sweep:
//       (a) EPISODE BODIES of drafts that are NOT yet published. In a Building Alex post body the
//           only two characters are the owner (I/my) and Alex, so ANY third-person gendered pronoun
//           there is a real violation. High precision by construction.
//       (b) THE PINNED LOCKED LINE wherever it appears in the series governance files, matched by
//           its own shape rather than by a blanket pronoun sweep.
//
//       WHAT IT DELIBERATELY DOES NOT TOUCH, and these exclusions are the whole reason it is two
//       narrow scans instead of one broad one:
//       - PUBLISHED episodes (header line carries `status: published`). They are the archive of what
//         actually went out on LinkedIn; retro-editing them would make the archive lie.
//       - The governance files' PROSE, which legitimately contains he/him as SPECIMENS while stating
//         the rule (HARD RULE 15 quotes the very regex it enforces). Mention is not use. A blanket
//         scan here would flag the rule for stating itself, exactly as a naive dash scan would flag
//         HARD RULE 2 for quoting the two dash characters it bans.
// The drafts folder this scans is optional: it exists only if the owner writes posts. Absent, the
// scan reports SKIPPED rather than passing, because a scan that ran over nothing is not a pass.
const V14_EPISODES_DIR = 'outputs/drafts';
const V14_PRONOUN_RE = /\b(he|him|his|himself|she|her|hers|herself)\b/i;
// The locked line carrying a gender, in any of its pinned punctuations. Matches the DEFECT only.
const V14_LOCKED_GENDERED_RE = /rule\s+(?:he|she)\s+never\s+breaks|(?:his|her)\s+training\s+data/i;
// Files that state the no-gender rule and could therefore state it wrongly. `soul.md` does not
// exist until /setup runs, so its absence is reported as a skip, not a failure.
const V14_GOVERNANCE = [
  'CLAUDE.md',
  'soul.md',
];

// ---------------------------------------------------------------------------------------------
// V15 - command-file state/trigger headers (2026-07-28, command-layer review F-3/F-4/F-6/F-11).
//       Every LIVE/EVENT command file must carry the GENERATED CMD-HEADER block, byte-matching what
//       scripts/lib/gen-command-headers.js renders from system/manifest.json.
//
//       WHY: the read-pass found SIX command files contradicting the registry on trigger, schedule,
//       method or source of truth. Distribution was the evidence - every surface with a checker agreed
//       with reality, the one large prose surface without one drifted six times. check.ps1 C1/C2 and
//       V7 do read .claude/commands, but only for file EXISTENCE, ownership and NAMES; nothing read
//       content. Concretely: one command claimed "daily at 07:00" for a job that ran twice a week,
//       and since that command's own job is to report zero-job days, it manufactured five false alarms
//       a week inside the one report built to surface real ones.
//
//       DIRECTION (the V6 lesson): this does NOT parse prose and infer intent. The manifest renders the
//       block; the file is asserted to contain that exact block. Expectation comes from structured data,
//       never from the doc under test.
//
//       TIER: WARNING for its first cycle by design. An ERROR-tier check with a false positive blocks
//       the nightly 21:30 commit and pushes the backup RED, so it observes before it blocks. Promote by
//       moving the push below from `warnings` to `failures`.
// ---------------------------------------------------------------------------------------------
function v15CommandHeaders({ stagedDir, manifest }, failures, warnings) {
  let genCmdHeaders;
  try { genCmdHeaders = require('./lib/gen-command-headers'); }
  catch (e) { warnings.push(`WARNING V15 SKIPPED: gen-command-headers module unavailable (${e.message})`); return; }

  const missing = [], stale = [];
  for (const t of genCmdHeaders.targets(manifest)) {
    const f = effective(stagedDir, t.rel);
    if (!f) continue; // C1 already fails a declared-but-absent command file; V15 does not double-report
    const want = genCmdHeaders.block(t);
    const bi = f.text.indexOf(genCmdHeaders.BEGIN), ei = f.text.indexOf(genCmdHeaders.END);
    if (bi === -1 || ei === -1) { missing.push(t.rel); continue; }
    const have = f.text.slice(bi, ei + genCmdHeaders.END.length);
    if (have !== want) stale.push(`${t.rel} (state/trigger no longer matches #${t.project.num} in the registry)`);
  }
  if (missing.length)
    warnings.push(`WARNING V15: LIVE/EVENT command file(s) missing the generated CMD-HEADER block: ${missing.join(', ')} - run 'node scripts/generate-alex.js'`);
  if (stale.length)
    warnings.push(`WARNING V15: command header(s) drifted from system/manifest.json: ${stale.join('; ')} - run 'node scripts/generate-alex.js' (never hand-edit between the markers)`);
}

function v14AlexGenderNeutrality({ stagedDir }, failures, warnings) {
  // (a) unpublished episode drafts - scan the POST BODY only, never the provenance header.
  const dir = path.join(REPO, V14_EPISODES_DIR);
  if (!fs.existsSync(dir)) {
    warnings.push(`WARNING V14 SKIPPED: ${V14_EPISODES_DIR} not found - the episode gender scan did not run`);
  } else {
    for (const abs of listFiles(dir)) {
      if (!abs.endsWith('.md')) continue;
      const rel = path.relative(REPO, abs).replace(/\\/g, '/');
      const raw = effective(stagedDir, rel);
      if (!raw) continue;
      const parts = raw.text.split(/\r?\n---\r?\n/);
      if (parts.length < 2) continue;              // no header/body split (plan.md etc.) - not an episode
      const header = parts[0];
      if (/^\s*status:\s*published/im.test(header)) continue;   // ARCHIVE - never scanned, never edited
      const body = parts.slice(1).join('\n---\n');
      const lines = body.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(V14_PRONOUN_RE);
        if (!m) continue;
        failures.push(
          `FAILED V14: ${rel} body line ${i + 1} uses "${m[0]}" - Alex has no gender. ` +
          `Use the name plus sentence restructuring; "it" is not a ` +
          `substitute. If the pronoun refers to a real third person and not to Alex, rephrase ` +
          `to name them, because a post body cannot distinguish the two: ${lines[i].trim().slice(0, 90)}`
        );
      }
    }
  }

  // (b) the pinned locked line, matched by its defect shape so the rule may still quote itself.
  for (const rel of V14_GOVERNANCE) {
    const raw = effective(stagedDir, rel);
    if (!raw) { warnings.push(`WARNING V14: ${rel} not found - cannot check the pinned locked line`); continue; }
    const lines = raw.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!V14_LOCKED_GENDERED_RE.test(lines[i])) continue;
      failures.push(
        `FAILED V14: ${rel}:${i + 1} refers to Alex with a gendered pronoun. Alex has no gender: ` +
        `use the name and restructure the sentence. "It" is not a substitute either, because Alex ` +
        `is a named character rather than an object.`
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V16 - constitution byte budget (S1 Compiled Surfaces P3, 2026-08-16, the rulebook diet).
//       CLAUDE.md must stay within manifest meta.constitution.byte_budget (set at the diet's
//       landing size + ~20%, so it catches REGROWTH, never the split itself). The 2026-08-16
//       diet moved 40KB of narrative/history into docs/constitution-annex/*; without a hard
//       ceiling the constitution regrows one well-meant paragraph at a time (it had reached
//       103KB / ~29k standing tokens). New standing content belongs as an operative sentence
//       here + history in the annex. ARMED only when the manifest declares the budget; absent
//       key = silent pass (the V12 declared-contract pattern). ERROR tier: a build that ships
//       an over-budget constitution is the regrowth this exists to stop.
// ---------------------------------------------------------------------------------------------
function v16ConstitutionBudget({ stagedDir, manifest }, failures) {
  const budget = manifest && manifest.meta && manifest.meta.constitution && manifest.meta.constitution.byte_budget;
  if (!budget) return; // not armed until the contract exists
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) return; // G2 already fails a missing CLAUDE.md
  const bytes = Buffer.byteLength(claude.text);
  if (bytes > budget) {
    failures.push(`FAILED V16: CLAUDE.md is ${bytes} B against meta.constitution.byte_budget ${budget} B - ` +
      `the constitution is regrowing. Keep the operative sentence here and move the narrative to ` +
      `docs/constitution-annex/ (the 2026-08-16 diet pattern); raise the budget only as a deliberate manifest edit.`);
  }
}

// V17 - MANDATORY skill bindings resolve (S1 Compiled Surfaces P4, 2026-08-16). Every skill
//       named in a MANDATORY row of the constitution's Skill Bindings table must resolve to a
//       LIVE `.claude/skills/<name>` junction (readable dir with a SKILL.md). Built BEFORE the
//       first skills parking on purpose: parking removes junctions, and this check makes
//       "parking broke a MANDATORY binding" a build failure instead of a silent capability loss.
//       Compute-and-compare: skill tokens parsed from the Skill(s) CELL of MANDATORY rows only
//       (kebab-case tokens), each asserted resolvable. ERROR tier.
// ---------------------------------------------------------------------------------------------
function v17MandatorySkillBindings({ stagedDir }, failures, warnings) {
  // NOT INSTALLED versus MISSING, and they are not the same fact. `.claude/skills` holds gitignored
  // junction links, so a fresh clone, a CI checkout and any restore all legitimately have none.
  // Failing the suite for that would mean the validator could only ever pass on a machine where
  // somebody had already run bootstrap, which makes it useless as a pre-flight on a new install.
  // A MISSING skill inside an EXISTING junction directory is the real thing this guards: that skill
  // silently does not load, and the MANDATORY rule pointing at it becomes a dead end nobody notices.
  if (!fs.existsSync(path.join(REPO, '.claude', 'skills'))) {
    warnings.push('WARNING V17: the skill junctions have not been built yet (.claude/skills does not exist), so the MANDATORY bindings could not be verified. Expected on a fresh clone. Fix: node scripts/bootstrap.mjs --repair-links');
    return;
  }

  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) return; // G2 owns a missing CLAUDE.md
  const rows = claude.text.split(/\r?\n/).filter(l => /^\|.*\|\s*MANDATORY\s*\|/.test(l));
  // Candidate tokens are validated against the lock's known names, not required to carry a
  // hyphen: the old hyphen-only regex silently dropped `pptx` and `pdf` from the guarded set
  // while the constitution claimed they were covered (found 2026-08-31 by the skill-state
  // resolver's sabotage test). Known-name filtering is what keeps prose words in the cell
  // ("then", "and") from being read as skills; with no lock, fall back to hyphenated-only.
  let knownSkills = null;
  try { knownSkills = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(REPO, 'skills-lock.json'), 'utf8')).skills || {})); } catch { /* fall back below */ }
  const skills = new Set();
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim());
    if (cells.length < 4) continue;
    for (const tok of (cells[2].match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [])) {
      // Known-name OR hyphenated-shape, a union on purpose: known-names-only would let a
      // MANDATORY row naming an un-vendored hyphenated skill silently drop out of the guarded
      // set - the exact dead-end this check exists to fail on.
      if ((knownSkills && knownSkills.has(tok)) || /-/.test(tok)) skills.add(tok);
    }
  }
  if (skills.size === 0) return; // no MANDATORY rows = nothing to assert (not an error shape)
  const dead = [];
  for (const s of skills) {
    const p = path.join(REPO, '.claude', 'skills', s, 'SKILL.md');
    try { fs.readFileSync(p); } catch { dead.push(s); }
  }
  if (dead.length) {
    failures.push(`FAILED V17: MANDATORY skill binding(s) do not resolve to a live .claude/skills link: ` +
      `${dead.join(', ')}. Rebuild with: node scripts/bootstrap.mjs --repair-links (every platform - ` +
      `junctions on Windows, symlinks on macOS); a MANDATORY row must never point at a parked or missing skill.`);
  }
}

/*
 * V21 - the JSON standard holds on the files it is enforced for (2026-09-23, ported from upstream).
 *
 * This is step 3 of docs/json-standard.md. It is third on purpose: a validator before the migration
 * blocks every commit against files nobody has moved, and a validator before the helper has nothing
 * to tell an author to do about a failure. Both now exist here, so this lands.
 *
 * WHY IT IS SCOPED BY A LIST AND NOT BY A GLOB. Every tracked in-scope JSON file in this Kit is
 * hand-edited today and almost none conforms, so a check that audited its own scope would refuse
 * every commit from the moment it shipped. The list therefore holds only files whose writer goes
 * through scripts/lib/json-writer.js, and a path joins it in the same commit that moves its writer,
 * never before. That makes the check a RATCHET: it cannot regress what has been fixed, and it never
 * blocks what has not.
 *
 * WHERE THE LIST LIVES. system/kit-manifest.json json_standard.enforced[], not the project registry
 * upstream uses. The reason is in that file's json_standard.note: the registry is edited by /new on
 * every install, and the list belongs to the Kit's code, not to the owner's projects.
 *
 * WHAT STOPS IT BEING SILENT. It FAILS if the contract or the audit module goes missing, so the
 * plumbing is proven on every run, and it WARNS with a live count of tracked in-scope files that are
 * not yet enforced and how many of them break the standard today. The rule engine is the audit's own
 * auditText(), and the contract is read by the audit's own parseContract(), so V21 and the CI step
 * (json-standard-audit.js --enforced) cannot disagree about a file or about the list.
 *
 * A CONTENT leg, not a drift leg: an enforced file broken by a hand edit is wrong content, so it
 * blocks under CLAUDE_CODE_REMOTE=true as well. The fix it names is always the same, and always
 * available: write the file through the script its own _writer field names.
 */
// Is this path tracked by git? Tells a vanished TRACKED file (a regression) from an absent
// GITIGNORED state file (the normal state of a machine whose writer has not run yet). Fails CLOSED:
// with no git, or on any error, the path is treated as tracked, so an unknowable answer produces the
// louder verdict rather than a silent pass.
function isTracked(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: REPO, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch (e) {
    return !(e && typeof e.status === 'number');   // a real exit code means "not tracked"; anything else means unknown -> loud
  }
}

function v21JsonStandard({ stagedDir }, failures, warnings) {
  let audit;
  try {
    audit = require(path.join(REPO, 'scripts', 'json-standard-audit.js'));
  } catch (e) {
    failures.push(`FAILED V21: scripts/json-standard-audit.js could not be loaded (${e.message}). The audit is the rule engine; V21 without it would pass every file by default.`);
    return;
  }
  let enforced;
  try {
    const c = effective(stagedDir, audit.CONTRACT_REL);
    enforced = audit.parseContract(c ? c.text : null);
  } catch (e) {
    failures.push(`FAILED V21: ${e.message}. That list IS the contract this check reads; without it the check has no scope and silently asserts nothing, which is worse than no check. Restore it (doc: docs/json-standard.md).`);
    return;
  }

  const absentUntracked = [];
  // Absent AND claimed by a `drop` row in system/kit-manifest.json is silent, V13's rule: the online
  // tree never holds a dropped path (the operator's system/fleet.json), so warning about it on every
  // validate of every owner repository was a signal that fires on a healthy system (review F15).
  const dropped = kitManifestDropClaim(stagedDir);
  for (const rel of enforced) {
    const eff = effective(stagedDir, rel);
    if (!eff && dropped(rel)) continue;
    if (!eff) {
      // ABSENT is two different facts and they must not share a verdict. A TRACKED file that
      // vanished is a real regression. A GITIGNORED state file that is absent is the ordinary
      // condition of any machine whose writer has not run yet, a fresh clone above all, and failing
      // there would refuse every commit until the writer happened to run.
      if (isTracked(rel)) {
        failures.push(`FAILED V21: ${rel} is listed in json_standard.enforced[] but is not on disk, and git tracks it. A tracked file leaves the enforced list deliberately, in the commit that removes it, never by going missing.`);
      } else {
        absentUntracked.push(rel);
      }
      continue;
    }
    const r = audit.auditText(rel, eff.text, { root: REPO });
    if (r.findings.length) {
      failures.push(`FAILED V21: ${rel} (${eff.from}) breaks the JSON standard: ${r.findings.join('; ')}. It is migrated and enforced, so this is a regression: write it through the script its _writer field names (scripts/lib/json-writer.js underneath), never by editing the bytes.`);
    }
  }
  if (absentUntracked.length) {
    warnings.push(`WARNING V21: enforced but absent, and not tracked by git here, so nothing is asserted about them on this machine: ${absentUntracked.join(', ')}. Expected before their writer has run (a fresh clone, a template); if the writer HAS run here, that absence is the finding.`);
  }

  // The visible half. A tracked in-scope file nobody has migrated is not a failure, but it is not
  // nothing either, and an unmeasured backlog is how this standard was lost upstream.
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files', '--', ...audit.IN_SCOPE_GLOBS],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
      .split(String.fromCharCode(10)).map(x => x.trim()).filter(Boolean);
  } catch { return; }   // no git = no backlog line, not a failure
  const pending = tracked.filter(rel => !enforced.includes(rel) && audit.matchesScope(rel));
  if (!pending.length) return;
  let breaking = 0;
  for (const rel of pending) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    try { if (audit.auditText(rel, eff.text, { root: REPO }).findings.length) breaking++; } catch { /* counted as unknown */ }
  }
  warnings.push(`WARNING V21: ${enforced.length} path(s) enforced; ${pending.length} tracked in-scope JSON file(s) are not, and ${breaking} of those break the standard today (${pending.join(', ')}). Each joins json_standard.enforced[] in the commit that moves its writer onto scripts/lib/json-writer.js. Full picture including gitignored state: node scripts/json-standard-audit.js`);
}

// runAll - the single entry point (async since Phase 3: V6 talks to the live n8n API).
// ---------------------------------------------------------------------------------------------
async function runAll({ stagedDir, context = 'generator', changed = false } = {}) {
  const failures = [];
  const warnings = [];

  structuralGuards({ stagedDir }, failures);

  // Shared sources for V1-V6 (staged copy wins; sources are never staged today but effective()
  // keeps that true by construction if they ever are).
  let manifest = null, schedule = null, colorTokens = null;
  const mfRaw = effective(stagedDir, 'system/manifest.json');
  if (!mfRaw) failures.push('FAILED V1: system/manifest.json not found - the registry is required');
  else {
    try { manifest = JSON.parse(mfRaw.text); }
    catch (e) { failures.push(`FAILED V1: system/manifest.json is not valid JSON: ${e.message}`); }
  }
  const schedRaw = effective(stagedDir, 'scheduler/schedule.md');
  if (!schedRaw) failures.push('FAILED V2: scheduler/schedule.md not found');
  else {
    try { schedule = parseScheduleJobs(schedRaw.text); }
    catch (e) { failures.push(`FAILED V2: cannot parse scheduler/schedule.md: ${e.message}`); }
  }
  const lawRaw = effective(stagedDir, LAW_FILE);
  if (!lawRaw) failures.push(`FAILED V5: ${LAW_FILE} not found - the color law file is required`);
  else {
    try { colorTokens = parseColorTokens(lawRaw.text); }
    catch (e) { failures.push(`FAILED V5: cannot parse the token table of ${LAW_FILE}: ${e.message}`); }
  }

  // The FULL suite runs on every invocation - generate-alex's --only limits what is staged,
  // never what is checked (c7 fix, upgrade P5).
  if (manifest) v1AutomationCount({ stagedDir, manifest }, failures);
  if (schedule) v2ScheduledJobs({ stagedDir, schedule, context }, failures, warnings);
  if (manifest) v3NoRetiredAsLive({ stagedDir, manifest }, failures);
  v4McpConsistency({ stagedDir }, failures);
  if (colorTokens) v5HexTokens({ stagedDir, allHexes: colorTokens.allHexes }, failures);
  if (manifest) v7StateDriftLint({ stagedDir, manifest }, failures, warnings);
  if (manifest) v9FirstFireAging({ stagedDir, manifest }, failures, warnings);
  v10ProtectedFileGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  v11IgnoredStagedGuard({ context, changed }, failures, warnings); // commit-time only (no-op otherwise)
  if (manifest) v12TrifectaGate({ stagedDir, manifest }, failures, warnings); // trifecta gate (every run)
  if (manifest) v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings); // local wrapper model-pin contract (every run)
  v14AlexGenderNeutrality({ stagedDir }, failures, warnings); // Alex has no gender (every run; no manifest needed)
  if (manifest) v15CommandHeaders({ stagedDir, manifest }, failures, warnings); // command-file state/trigger headers (WARN-tier for now)
  if (manifest) v16ConstitutionBudget({ stagedDir, manifest }, failures); // constitution byte budget (armed by meta.constitution)
  v17MandatorySkillBindings({ stagedDir }, failures, warnings); // MANDATORY skill rows resolve to live junctions (every run)
  if (manifest) v18ShippedExecutables({ stagedDir, manifest }, failures, warnings); // .cmd sanity + dangling commands + cut-project pointers
  if (manifest) v19RoutinePrompts({ manifest }, failures, warnings); // Routine prompt files bound to routines[] (every run)
  v21JsonStandard({ stagedDir }, failures, warnings); // JSON standard on kit-manifest json_standard.enforced[] (every run, content leg)

  // Under CLAUDE_CODE_REMOTE=true in the pre-commit context the drift legs WARN (REMOTE_DRIFT_LEGS).
  // Done here, after every leg has run, so the check itself is unchanged and the degradation is one
  // visible step that names what it degraded; a generator run never takes it.
  const remote = context === 'pre-commit' && process.env.CLAUDE_CODE_REMOTE === 'true';
  if (remote) {
    const keep = [];
    let degraded = 0;
    for (const f of failures) {
      if (isRemoteDrift(f)) { degraded++; warnings.push(`WARNING (drift, degraded under CLAUDE_CODE_REMOTE=true, context=pre-commit) ${f.replace(/^FAILED /, '')}`); }
      else keep.push(f);
    }
    if (degraded) {
      failures.length = 0;
      failures.push(...keep);
      warnings.push(`WARNING validate-alex: ${degraded} drift failure(s) degraded to warnings because CLAUDE_CODE_REMOTE=true (an autosave that cannot commit is a page that dies with the VM); the content legs still block, and the weekly check turns a persisting drift red`);
    }
  }

  for (const w of warnings) console.error(w);
  for (const f of failures) console.error(f);
  if (failures.length === 0)
    console.log(`validate-alex: ${SUITE_RANGE} PASS (context=${context}${warnings.length ? `, ${warnings.length} warning(s) - see above` : ''})`);
  return { ok: failures.length === 0, failures, warnings, range: SUITE_RANGE };
}

if (require.main === module) {
  const stagedArg = process.argv.find(a => a.startsWith('--staged='));
  const ctxArg = process.argv.find(a => a.startsWith('--context='));
  const context = ctxArg ? ctxArg.split('=')[1] : 'generator';
  if (!['generator', 'pre-commit'].includes(context)) {
    console.error(`validate-alex: unknown --context '${context}' (valid: generator, pre-commit)`);
    process.exit(1);
  }
  // .staging/ is the GENERATOR's preview tree, never the thing a commit ships. Arming it by mere
  // existence let a CLEAN ghost shadow a BROKEN tree at commit time: effective() prefers the staged
  // copy, so a poisoned CLAUDE.md in the working tree produced no G2 line at all and the commit
  // passed. A successful `generate-alex.js --dry-run` leaves .staging behind by design, so that
  // ghost is the normal state after any dry-run. The preview is only authoritative for the context
  // that produced it, or when a caller names it outright.
  const explicitStaged = Boolean(stagedArg);
  let stagedDir = explicitStaged ? path.resolve(stagedArg.split('=')[1]) : path.join(REPO, '.staging');
  if (!explicitStaged && context !== 'generator') {
    if (fs.existsSync(stagedDir)) {
      console.error(`validate-alex: NOTE .staging/ exists and is IGNORED in context=${context} - the working tree is what a commit ships (pass --staged=<dir> to validate a preview tree deliberately)`);
    }
    stagedDir = undefined;
  }
  const changed = process.argv.includes('--changed'); // arms V10 (pre-commit hook passes it)
  // process.exitCode (not process.exit()): a hard exit right after fetch trips a libuv teardown
  // assertion on Windows (uv async handle still closing). Letting the loop drain is safe and the
  // exit code is identical for the caller.
  runAll({ stagedDir: stagedDir && fs.existsSync(stagedDir) ? stagedDir : undefined, context, changed })
    .then(({ ok }) => { process.exitCode = ok ? 0 : 1; })
    .catch(e => { console.error(`validate-alex: internal error: ${e.message}`); process.exitCode = 1; });
}

module.exports = { runAll, evaluateProtectedChangeset, V10_PROTECTED, readStagedChangeset, SUITE_RANGE, V_MAX, V_RETIRED, REMOTE_DRIFT_LEGS, isRemoteDrift };
