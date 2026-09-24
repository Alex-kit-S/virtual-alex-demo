#!/usr/bin/env node
// scripts/tests/test-build-online-template.mjs - the guards of the Virtual Alex template generator,
// each shown REFUSING a synthetic violation before the pass. A guard that passes because it tests
// nothing is indistinguishable from one that passes because the tree is healthy; the N cases are what
// tell them apart.
//
//   N1  a manifest row without an online value refuses
//   N2  a row with an online value outside ship | drop | variant refuses
//   N3  a tracked path no row claims refuses
//   N4  a path two rows name refuses
//   N5  a file under variants/online/ whose row is ship refuses
//   N6  a diff touching .claude/settings.json with an EMPTY flagged list refuses
//   N7  a diff touching a privileged path the flagged list leaves out refuses
//   N8  --seed against the generic remote refuses
//   N9  a seed source's INSTALL-<NAME>.md never lands (the online tree carries INSTALL-ONLINE.md)
//   N10 a seed source without starter/ refuses
//   P1  the exact claim beats the directory claim; drop rows drop; a variant file lands at its real path
//   P2  flaggedOf keeps only the privileged paths; a matching flagged list passes; no privileged change passes
//   P3  a symlink entry is skipped, never written
//   P4  the REAL manifest resolves and every tracked path of this Kit is claimed (the live proof)
//   P5  a seed carries starter/** and the two owner docs, and nothing else
//   P6  the online command set: /cron-setup dropped by its manifest row, /alex-status added by one
//   P7  no online-authored surface tells an owner to type /status, which the web page swallows
//   P8  online, the triage's memory (rules.md, tally, thread ledgers, label map, style notes) is kept and
//       its credentials folder and raw draft text are not; NEGATIVE an approved sender rule goes to
//       rules.md in a cloud session, never to config/, which the online tree drops
//   P9  every "section N" in INSTALL-ONLINE.md points at the heading it MEANS, not merely one that
//       exists; NEGATIVE the headings renumbered in memory, and a reference no row declares
//   B0-B6  END TO END, Kit only (fleet Fix A, review findings F01, F02, F12, F44): the real script in a
//       throwaway clone. B0b the pushed template keeps every executable bit (macOS CI caught a loss);
//       B1/B2 NEGATIVE a working-tree edit git status cannot see never ships and is
//       reported by content; B3 NEGATIVE a committed CRLF shell script refuses; B4 NEGATIVE so does a
//       CRLF script under a -text path; B5 the tree carries template-source.json and a true VERSION;
//       B6 a seed names the generic template and its CRLF text lands LF over an existing CRLF blob
//
// Exit 0 = all pass, 1 = any failure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  Refusal, resolveRows, claimFor, classify, planTree, flaggedOf, assertFlagged, parseArgs,
  loadManifest, trackedEntries, rowText, changelogRow, seedFiles, KIT, DEFAULT_REMOTE,
} from '../build-online-template.mjs';
import * as B from '../build-online-template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

// THIS FILE SHIPS INTO THE GENERATED TEMPLATE AND RUNS IN ITS CI TOO. Nearly all of it is fixture
// work that holds in any tree, but a few assertions are about the KIT's own layout: the command the
// template dropped is still here, the command the template received is NOT here, and the directory
// the variants are read from exists. In the generated tree every one of those is false, and false
// there is the generator having done its job, not a defect. So they run where they mean something
// and say so where they do not. `variants/` is a drop row, so its absence is the marker.
// (Found 2026-09-23 by the template CI failing on build 18, which was the first build to carry
// these legs: they were written and measured in the Kit only.)
const IS_KIT = fs.existsSync(path.join(path.resolve(HERE, '..', '..'), 'variants', 'online'));
const kitOnly = (cond, name, detail = '') => {
  if (IS_KIT) return ok(cond, name, detail);
  console.log(`SKIP  ${name} - this is a generated tree, not the Kit`);
};
/** Runs fn, returns the Refusal it threw or null. */
const refusal = (fn) => {
  try { fn(); return null; } catch (e) { return e instanceof Refusal ? e : { notRefusal: e }; }
};
const refused = (fn, name, mustMention) => {
  const r = refusal(fn);
  const hit = r && !r.notRefusal && (!mustMention || r.message.includes(mustMention));
  ok(Boolean(hit), name, r ? (r.notRefusal ? `threw a non-Refusal: ${r.notRefusal.message}` : `REFUSED (exit ${r.exitCode}): ${r.message}`) : 'did NOT refuse');
};

const manifest = (rows) => ({ components: rows });
const row = (id, paths, online) => (online === undefined ? { id, paths } : { id, paths, online });

// ---- negatives first ------------------------------------------------------------------------
refused(() => resolveRows(manifest([row('constitution', ['CLAUDE.md'], 'variant'), row('docs', ['docs/'])])),
  'N1 a row stripped of online refuses', 'row "docs" has no online value');

refused(() => resolveRows(manifest([row('docs', ['docs/'], 'maybe')])),
  'N2 an online value outside the three refuses', 'row "docs" has no online value');

{
  const claims = resolveRows(manifest([row('docs', ['docs/'], 'ship')]));
  refused(() => classify(['docs/a.md', 'zzz/unclaimed.md'], claims),
    'N3 a tracked path no row claims refuses', 'zzz/unclaimed.md');
}

refused(() => resolveRows(manifest([row('a', ['scripts/x.ps1'], 'drop'), row('b', ['scripts/x.ps1'], 'ship')])),
  'N4 a path two rows name refuses', 'claimed by both "a" and "b"');

{
  const claims = resolveRows(manifest([row('scripts', ['scripts/'], 'ship'), row('variants', ['variants/'], 'drop')]));
  const entries = [
    { mode: '100644', path: 'scripts/hooks/pre-commit' },
    { mode: '100644', path: 'variants/online/scripts/hooks/pre-commit' },
  ];
  refused(() => planTree(entries, claims, '/kit'),
    'N5 a variants/online file whose row is ship refuses', 'its row "scripts" is ship');
}

refused(() => assertFlagged(['.claude/settings.json', 'docs/x.md'], []),
  'N6 a diff touching .claude/settings.json with an EMPTY flagged list refuses', 'flags NOTHING');

refused(() => assertFlagged(['scripts/hooks/pre-commit', 'CLAUDE.md'], ['CLAUDE.md']),
  'N7 a flagged list that leaves out a privileged path refuses', 'scripts/hooks/pre-commit');

refused(() => parseArgs(['--push', '--seed', '/somewhere/alex-someone']),
  'N8 --seed against the generic remote refuses', 'never goes to the generic template');

// ---- positives ------------------------------------------------------------------------------
{
  const claims = resolveRows(manifest([
    row('constitution', ['CLAUDE.md'], 'variant'),
    row('scripts', ['scripts/'], 'ship'),
    row('wrappers', ['scripts/run-job.mjs', 'launchd/'], 'drop'),
    row('launchers', ['Install-Alex.cmd'], 'drop'),
    row('variants', ['variants/'], 'drop'),
    row('online-install', ['INSTALL-ONLINE.md'], 'ship'),
  ]));
  ok(claimFor('scripts/lib/x.js', claims).id === 'scripts', 'P1a a file under a directory row resolves to that row');
  ok(claimFor('scripts/run-job.mjs', claims).id === 'wrappers', 'P1b the exact claim beats the directory claim');
  ok(claimFor('nothing/here.md', claims) === null, 'P1c an unclaimed path resolves to null');
  const entries = [
    { mode: '100644', path: 'CLAUDE.md' },
    { mode: '100644', path: 'variants/online/CLAUDE.md' },
    { mode: '100644', path: 'scripts/lib/x.js' },
    { mode: '100755', path: 'scripts/hooks/pre-commit' },
    { mode: '100644', path: 'scripts/run-job.mjs' },
    { mode: '100644', path: 'Install-Alex.cmd' },
  ];
  const plan = planTree(entries, claims, '/kit');
  const dsts = plan.files.map((f) => f.dst).sort();
  ok(JSON.stringify(dsts) === JSON.stringify(['CLAUDE.md', 'scripts/hooks/pre-commit', 'scripts/lib/x.js']),
    'P1d ship files copy, drop files vanish, the variant lands at its real path', dsts.join(', '));
  const variant = plan.files.find((f) => f.dst === 'CLAUDE.md');
  ok(variant && variant.src.replace(/\\/g, '/').endsWith('/variants/online/CLAUDE.md'),
    'P1e the variant is read from variants/online/, not from the Kit', variant && variant.src);
  const hook = plan.files.find((f) => f.dst === 'scripts/hooks/pre-commit');
  ok(hook && hook.mode === '100755', 'P1f the executable bit rides with the file', hook && hook.mode);
  ok(plan.counts.ship === 2 && plan.counts.variant === 1 && plan.counts.drop === 2,
    'P1g the counts say what happened', JSON.stringify(plan.counts));
  const absent = plan.reports.filter((r) => r.startsWith('ABSENT'));
  ok(absent.length === 2 && absent.some((r) => r.includes('INSTALL-ONLINE.md')) && absent.some((r) => r.includes('launchd/')),
    'P1h a listed path that is absent is reported, not fatal', absent.join(' | '));
}

{
  const f = flaggedOf(['docs/x.md', '.claude/settings.json', 'scripts/lib/a.js', 'scripts/x.js', 'scheduler/routines/brief.md']);
  ok(JSON.stringify(f) === JSON.stringify(['.claude/settings.json', 'scheduler/routines/brief.md', 'scripts/lib/a.js']),
    'P2a flaggedOf keeps only the privileged paths, sorted', f.join(', '));
  ok(refusal(() => assertFlagged(['.claude/settings.json', 'docs/x.md'], ['.claude/settings.json'])) === null,
    'P2b a flagged list that covers the diff passes');
  ok(refusal(() => assertFlagged(['docs/x.md', 'vault/y.md'], [])) === null,
    'P2c no privileged change and an empty list passes');
  const r = changelogRow({ kitCommit: 'abc', kitDirty: false, previous: null, files: 3, changed: ['a', 'b'], flagged: ['CLAUDE.md'] });
  const line = rowText(r);
  ok(!line.includes('\n') && line.startsWith('{"at":') && line.includes('"kit_commit":"abc"') && line.includes('"previous_template_commit":null'),
    'P2d the changelog row is one line in the JSON writer\'s key order', line);

  // P2e-P2g, the explicit build number (2026-09-24, fleet seat 4). Before it, "build 23" was true
  // only as a row count, and a count moves when a row is deleted or inserted without anyone seeing.
  // From build 24 each row carries its own number and a row that does not sit at its number refuses
  // the push, so a shifted history stops the writer instead of mislabelling every build after it.
  const legacy = ['{"at":"2026-01-01T00:00:00Z"}', '{"at":"2026-01-02T00:00:00Z"}'].join('\n') + '\n';
  const nb = typeof B.nextBuild === 'function' ? B.nextBuild : () => { throw new Error('nextBuild is not exported'); };
  let shifted = null;
  try { nb(legacy + '{"at":"2026-01-03T00:00:00Z","build":4}\n'); } catch (e) { shifted = e; }
  ok(shifted instanceof Refusal && /row 3 says build 4/.test(shifted.message),
    'P2e NEGATIVE a row whose build is not its position refuses the next push', shifted ? shifted.message : 'no refusal');
  let n = null; try { n = nb(legacy + '{"at":"2026-01-03T00:00:00Z","build":3}\n'); } catch (e) { n = e.message; }
  ok(n === 4, 'P2f legacy rows count by position and an explicit build is honoured: the next build is 4', String(n));
  const r2 = changelogRow({ kitCommit: 'abc', kitDirty: false, previous: null, files: 3, changed: [], flagged: [], build: 24 });
  const line2 = rowText(r2);
  ok(line2.startsWith('{"at":') && line2.includes('"build":24'), 'P2g the row carries its build, and "at" stays first for /update\'s sed', line2);
}

{
  const claims = resolveRows(manifest([row('skills', ['.claude/'], 'ship')]));
  const plan = planTree([{ mode: '120000', path: '.claude/skills/xlsx' }, { mode: '100644', path: '.claude/commands/x.md' }], claims, '/kit');
  ok(plan.files.length === 1 && plan.files[0].dst === '.claude/commands/x.md', 'P3 a .claude/skills/ link is never written', JSON.stringify(plan.files.map((f) => f.dst)));
}

{
  let liveOk = false; let detail = '';
  try {
    const claims = resolveRows(loadManifest());
    const entries = trackedEntries(KIT);
    const plan = planTree(entries, claims);
    liveOk = plan.files.length > 0;
    detail = `${entries.length} tracked path(s) all claimed; ${plan.counts.ship} ship, ${plan.counts.variant} variant, ${plan.counts.drop} dropped, ${plan.reports.filter((r) => r.startsWith('ABSENT')).length} absent`;
  } catch (e) { detail = e.message; }
  ok(liveOk, 'P4 the real manifest claims every tracked path of this Kit', detail);
  ok(DEFAULT_REMOTE.startsWith('https://github.com/'), 'P4b the default remote is a GitHub url', DEFAULT_REMOTE);
}

// ---- P6: the online command set ---------------------------------------------------------------
// What an owner can type is part of the product, so it is pinned rather than left to whichever row
// happens to claim a path. A command the online lane cannot run must not be offered there: every
// one of its paths fails, and the owner has no way to know that before typing it.
{
  const plan = planTree(trackedEntries(), resolveRows(loadManifest()));
  const online = plan.files.map((f) => f.dst)
    .filter((p) => p.startsWith('.claude/commands/'))
    .map((p) => p.slice('.claude/commands/'.length));

  // /cron-setup registers a local scheduler job: Windows Task Scheduler, launchd or systemd. A
  // cloud session has none of the three. The online schedule is Routines created by hand in the
  // claude.ai app from docs/ROUTINES-FORMS.md (2026-09-23).
  ok(!online.includes('cron-setup.md'),
    'P6 /cron-setup is absent from the online tree (no Task Scheduler, no launchd, no systemd there)',
    online.includes('cron-setup.md') ? 'it still ships' : `${online.length} commands online`);
  kitOnly(fs.existsSync(path.join(KIT, '.claude', 'commands', 'cron-setup.md')),
    'P6 and it is still on the laptop: this is a manifest drop row, never a deleted file');

  // The claude.ai web session has a built-in /status of its own. Typing /status there answers
  // "Session info is available once the session starts" and Alex's command file is never read
  // (measured on the first real install, 2026-09-23). Online the command is /alex-status.
  // Reads the PLAN, so it needs the variant source, which only the Kit has.
  kitOnly(online.includes('alex-status.md'), 'P6 /alex-status ships online', online.join(' '));
  ok(online.includes('status.md'),
    'P6 and status.md ships too: it is where the behaviour is written, in one copy, and alex-status.md sends the reader to it');
  kitOnly(!fs.existsSync(path.join(KIT, '.claude', 'commands', 'alex-status.md')),
    'P6 the laptop keeps /status alone: there is no clash there and no second name to learn');
}

// ---- P7: no online-authored surface tells an owner to type /status -----------------------------
// The rename is only worth anything if the documents moved with it. This scans the surfaces written
// FOR a cloud owner or read BY a cloud session. It deliberately does not scan the laptop install
// guides (docs/GETTING-STARTED.md, docs/UPDATING.md, docs/README.md, docs/ARCHITECTURE.md,
// docs/projects/, docs/constitution-annex/): they describe the laptop, where /status is the correct
// command, and rewriting them would make the laptop docs wrong. The online CLAUDE.md names that
// gap and tells the session what to do when an owner meets one of those pages.
{
  const surfaces = [];
  const walk = (rel) => {
    const abs = path.join(KIT, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isFile()) { surfaces.push(rel); return; }
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      walk(`${rel}/${e.name}`);
    }
  };
  ['variants/online', 'INSTALL-ONLINE.md', 'docs/ROUTINES-FORMS.md', '.claude/commands/update.md',
    'scheduler/routines', 'scripts/autosave.sh', 'docs/WHAT-IS-ALEX.md', 'docs/ARCHITECTURE-ONLINE.md'].forEach(walk);

  // /status as a COMMAND: not inside a path (no word char, slash, dot or dash before it) and not the
  // head of a longer name or path (a word char, dash or slash after it, or a dot FOLLOWED by a word
  // char, as in status.md). A dot followed by anything else ends a sentence, and "Type /status." is
  // the command (F16, fleet review; the old lookahead excluded every dot).
  const asCommand = /(?<![\w/.-])\/status(?![\w/-]|\.\w)/;
  const hits = [];
  for (const rel of surfaces) {
    const lines = fs.readFileSync(path.join(KIT, rel), 'utf8').split(/\r?\n/);
    // A PARAGRAPH that names /alex-status as well is explaining the clash; one that names only
    // /status is sending the owner to a command the web page eats. The scope is the paragraph and
    // NOT the file, so no document gets a blanket pass: the alias command file has to keep giving
    // the right name beside every mention of the wrong one, and so does anything written later.
    let from = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && lines[i].trim() !== '') continue;
      const block = lines.slice(from, i);
      if (!block.some((l) => l.includes('/alex-status'))) {
        block.forEach((l, k) => { if (asCommand.test(l)) hits.push(`${rel}:${from + k + 1}`); });
      }
      from = i + 1;
    }
  }
  ok(hits.length === 0,
    'P7 no online-authored surface tells an owner to type /status',
    hits.length ? hits.join(', ') : `${surfaces.length} surfaces scanned, all clean`);
  // F16 (fleet review): the pattern's lookahead once excluded ANY following dot, so "Stuck? Type
  // /status." passed P7 while "Type /status and read..." failed it. Held on the pattern itself, both
  // ways, because no shipped line happens to carry the case today and a scan of clean files cannot
  // show the pattern can see it.
  const sentenceEnds = ['Stuck? Type /status.', 'type /status!', 'then /status?'];
  const filenames = ['vault/projects/x/status.md', 'open /status.md first', 'see /status-report', 'the /status/ folder'];
  ok(sentenceEnds.every((s) => asCommand.test(s)), 'P7 NEGATIVE a sentence that ends on /status is read as the command', sentenceEnds.filter((s) => !asCommand.test(s)).join(' | ') || 'all three');
  ok(!filenames.some((s) => asCommand.test(s)), 'P7 a status.md filename, a /status- word and a /status/ path are not', filenames.filter((s) => asCommand.test(s)).join(' | ') || 'none matched');
  // The floor differs by tree because the surface list does: the Kit adds all of variants/online,
  // which the generated tree does not have. The guard's job is the same in both, catch a scan that
  // silently found nothing and passed for that reason.
  const floor = IS_KIT ? 15 : 5;
  ok(surfaces.length > floor, 'P7 the scan actually found the surfaces',
    `${surfaces.length} files (floor ${floor}, ${IS_KIT ? 'Kit' : 'generated tree'})`);
}

// ---- P8: the triage's memory survives a cloud session, and no secret does ------------------------
// Online the repository IS the disk: a path the online .gitignore swallows is gone when the session
// ends. The triage keeps non-secret state in five places and must find all five next session; its
// credentials folder and its raw draft text must never be committed. And the rules an owner approves
// (the noise killer's suppressions) went to work/07-email-triage/config/sender-rules.json, which the
// credential-folder rule swallows online, so every approval evaporated (fleet Fix B finding 4, Fix C).
// Asked of git itself, against the online .gitignore alone, with no global excludes.
{
  const ignoreFile = IS_KIT ? path.join(KIT, 'variants', 'online', '.gitignore') : path.join(KIT, '.gitignore');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'va-ignore-'));
  const empty = path.join(tmp, 'no-excludes');
  fs.writeFileSync(empty, '');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.copyFileSync(ignoreFile, path.join(repo, '.gitignore'));
  const ignored = (p) => spawnSync('git', ['-c', `core.excludesFile=${empty}`, 'check-ignore', '-q', '--no-index', p], { cwd: repo }).status === 0;
  const kept = ['work/07-email-triage/rules.md', 'work/07-email-triage/state/sender-tally.json', 'work/07-email-triage/state/job-threads.json',
    'system/waiting-on-them.jsonl', 'vault/projects/email-triage/status.md', 'vault/me/writing-style-notes.md'];
  const out = ['work/07-email-triage/config/sender-rules.json', 'work/07-email-triage/state/staged-drafts.json'];
  const lost = kept.filter(ignored);
  const leaked = out.filter((p) => !ignored(p));
  ok(lost.length === 0 && leaked.length === 0, 'P8a online, the triage keeps its memory and drops its credentials folder and raw draft text',
    `lost at session end: ${lost.join(', ') || 'none'}; would be committed: ${leaked.join(', ') || 'none'}`);
  const cmd = fs.readFileSync(path.join(KIT, '.claude', 'commands', 'email-triage.md'), 'utf8');
  const approval = cmd.split(/\r?\n/).find((l) => /on approval/i.test(l)) || '';
  ok(/CLAUDE_CODE_REMOTE/.test(approval) && /rules\.md/.test(approval) && !ignored('work/07-email-triage/rules.md'),
    'P8b NEGATIVE in a cloud session an approved sender rule goes to rules.md, which the online tree keeps, not to config/, which it drops',
    approval.trim().slice(0, 150) || 'no approval line found');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- P9: every "section N" in INSTALL-ONLINE.md points at the heading it means ------------------
// Fleet Fix E, review finding F09. Two references in the install guide pointed at the wrong heading
// after a renumbering ("section 11" for Pro or Max, which is 12, and "section 8" for updates, which is
// 7), and both wrong numbers still named a heading that EXISTED. A check that only asks "does heading
// N exist" passes that page. So each reference is pinned to the TITLE it means, found by a phrase
// right next to it, and the page's own numbering has to agree. A reference no row declares fails too:
// a new one is declared here, never guessed. The NEGATIVE legs renumber the headings in memory, the
// exact way the two defects were made, and add an undeclared reference; both must fail.
{
  const SECTION_REFS = [
    // [a phrase within 40 characters of the reference, the title of the heading it means]
    ['says when Max is worth it', 'Pro or Max'],
    ['says who else can read them', 'Who can read your notes'],
    ['your repository at all.', 'The rule about who writes in your repository'],
    ['which is what step 4 and', 'Your copies, and the one thing that was lost'],
    ['says what each one does', 'Who can read your notes'],
    ['says what to send instead', 'When something goes wrong'],
    ['accept each one with a yes', 'Getting updates later'],
    ['why support works the way', 'When something goes wrong'],
    ['text you copy out', 'When something goes wrong'],
    ['share link as support', 'Who can read your notes'],
    ['is for); same-day help', 'Your copies, and the one thing that was lost'],
  ];
  const sectionRefFailures = (text) => {
    const headings = new Map();
    for (const m of text.matchAll(/^## (\d+)\. (.+)$/gm)) headings.set(Number(m[1]), m[2].trim());
    const flat = text.replace(/\s+/g, ' ');
    const bad = [];
    const used = new Set();
    let refs = 0;
    for (const m of flat.matchAll(/\bsection (\d+)\b/gi)) {
      refs++;
      const n = Number(m[1]);
      const around = flat.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
      const where = `"...${flat.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25).trim()}..."`;
      const rows = SECTION_REFS.filter(([near]) => around.includes(near));
      if (rows.length !== 1) {
        bad.push(`${where}: ${rows.length ? `${rows.length} rows claim it` : 'no row in P9 declares which heading it means'}`);
        continue;
      }
      used.add(rows[0][0]);
      const title = headings.get(n);
      if (title !== rows[0][1]) bad.push(`${where}: means "${rows[0][1]}", but section ${n} is ${title ? `"${title}"` : 'not a heading'}`);
    }
    for (const [near] of SECTION_REFS) if (!used.has(near)) bad.push(`the row "${near}" matched no reference (reworded? move the row with it)`);
    return { bad, refs, headings: headings.size };
  };
  const guide = path.join(KIT, 'INSTALL-ONLINE.md');
  const text = fs.readFileSync(guide, 'utf8');
  const live = sectionRefFailures(text);
  ok(live.bad.length === 0, 'P9 every "section N" in INSTALL-ONLINE.md points at the heading it means',
    live.bad.length ? live.bad.join(' | ') : `${live.refs} references, ${live.headings} numbered headings, all agree`);
  ok(live.refs >= SECTION_REFS.length && live.headings >= 10, 'P9 the scan actually found the references and the headings',
    `${live.refs} references (floor ${SECTION_REFS.length}), ${live.headings} headings (floor 10)`);
  // A section inserted above section 5 shifts every later number by one: the class that made both
  // defects. Every reference in the page points at 5 or later, so every one must now fail.
  const shifted = text.replace(/^## (\d+)\. /gm, (m, n) => (Number(n) >= 5 ? `## ${Number(n) + 1}. ` : m));
  const neg = sectionRefFailures(shifted);
  ok(shifted !== text && neg.bad.length >= 2 && neg.bad.some((b) => b.includes('"Pro or Max"')),
    'P9 NEGATIVE the headings renumbered in memory: the references that now point at the wrong heading fail',
    `${neg.bad.length} failure(s): ${neg.bad.slice(0, 2).join(' | ')}`);
  const undeclared = sectionRefFailures(`${text}\n\nThe steps are in section 3.\n`);
  ok(undeclared.bad.some((b) => b.includes('no row in P9 declares')),
    'P9 NEGATIVE a reference no row declares fails, even though section 3 exists',
    undeclared.bad.join(' | ') || 'nothing failed');
}

// ---- the seed ---------------------------------------------------------------------------------
// A per-person seed is an install directory: starter/ plus the owner docs Install-Alex left beside
// it. INSTALL-<NAME>.md is the USB-and-Terminal laptop guide; the online tree carries
// INSTALL-ONLINE.md, and a seed that shipped both would mislead its owner on the first page.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-seed-'));
  fs.mkdirSync(path.join(dir, 'starter'));
  for (const [rel, text] of [
    ['starter/ABOUT-X.md', '# About X\n'],
    ['INSTALL-X.md', '# Installing Alex on a laptop\n'],
    ['HOW-SHARING-WORKS.md', '# Sharing\n'],
    ['WHAT-ALEX-CAN-DO.md', '# Inventory\n'],
  ]) fs.writeFileSync(path.join(dir, rel), text);
  try {
    const s = seedFiles(dir);
    const dsts = s.files.map((f) => f.dst).sort();
    ok(!dsts.includes('INSTALL-X.md'),
      'N9 a seed source\'s INSTALL-<NAME>.md never lands in the online tree (it carries INSTALL-ONLINE.md)', dsts.join(', '));
    ok(JSON.stringify(dsts) === JSON.stringify(['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md', 'starter/ABOUT-X.md']),
      'P5 a seed carries starter/** and the two owner docs, and nothing else', dsts.join(', '));
    ok(JSON.stringify(s.docs) === JSON.stringify(['HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md']),
      'P5b the docs list names the two owner docs', s.docs.join(', '));
    fs.rmSync(path.join(dir, 'starter'), { recursive: true, force: true });
    refused(() => seedFiles(dir), 'N10 a seed source without starter/ refuses', 'no starter/ directory');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- B: the build is the commit, and it ships no carriage return (fleet Fix A, 2026-09-24) -----
// Review finding F01: the build copied WORKING-TREE bytes, so template build 29 carried 30 CRLF files
// no Kit commit contains, and `git status` could not see it (the stat cache hides a line ending).
// F02: nothing refused a CR, so a default Git for Windows clone would have shipped CRLF shell scripts
// to the Linux VM. These legs run the REAL build script end to end in a throwaway clone of this Kit's
// HEAD, against a throwaway bare repository standing in for the template. Kit only: a generated tree
// has no donor scanner, so the build cannot run there by design.
if (!IS_KIT) {
  for (const n of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) console.log(`SKIP  ${n} the end-to-end build legs - this is a generated tree, not the Kit`);
} else {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'va-blobs-'));
  const clone = path.join(T, 'kit');
  const bare = path.join(T, 'template.git');
  const out = path.join(T, 'build');
  const sh = (cmd, args, cwd = clone, input) => spawnSync(cmd, args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const g = (...args) => sh('git', args);
  // A GitHub-shaped template address: the build writes it into the tree, and a temp path there would
  // trip the donor scrub's machine-path rule on this very machine.
  const TEMPLATE = 'https://github.com/example/virtual-alex';
  const build = (...args) => {
    const r = sh(process.execPath, [path.join(clone, 'scripts', 'build-online-template.mjs'), ...args, '--remote', bare, '--out', out, '--template-remote', TEMPLATE]);
    return { status: r.status, text: `${r.stdout}${r.stderr}` };
  };
  const tail = (t) => t.trim().split('\n').slice(-2).join(' | ');
  try {
    const c = sh('git', ['clone', '-q', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-c', 'core.symlinks=false', KIT, clone], T);
    sh('git', ['init', '-q', '--bare', bare], T);
    sh('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], bare);
    g('config', 'user.name', 'Alex Kit test');
    g('config', 'user.email', 'alex-kit-test@localhost');
    // The build reads a COMMIT, so a clone of HEAD would test the last committed build script, not the
    // one in this checkout. This checkout's uncommitted edits to tracked files are committed in the
    // clone first; in CI there are none. Nothing is written to this checkout.
    const edits = sh('git', ['diff', '--name-only', '-z', 'HEAD'], KIT).stdout.split('\0').filter(Boolean);
    for (const rel of edits) {
      const from = path.join(KIT, rel);
      const to = path.join(clone, rel);
      if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); } else fs.rmSync(to, { force: true });
    }
    if (edits.length) { g('add', '-A'); g('commit', '-q', '-m', 'test: this checkout\'s uncommitted edits'); }
    const base = build('--push');
    const committed = g('commit', '-q', '-m', 'test: the build row', '--', 'system/template-changelog.jsonl');
    const baseline = c.status === 0 && base.status === 0 && committed.status === 0;
    ok(baseline, 'B0 a clean clone of HEAD builds and pushes a first template', baseline ? tail(base.text) : `clone ${c.status} ${c.stderr}; push ${base.status}: ${tail(base.text)}; commit ${committed.status} ${committed.stderr}`);
    // B0b. The push must carry every executable bit of the shipped files. A second `git add -A` in
    // --push re-read the modes from disk, where the blob writer had left 0644, so on macOS and Linux
    // (core.filemode=true) the template lost +x on its hooks (macOS CI run 35983565511, B1 drift).
    if (baseline) {
      const modes = (cwd, rev) => new Map(sh('git', ['ls-tree', '-r', rev], cwd).stdout.trim().split('\n').filter(Boolean).map((l) => [l.split('\t')[1], l.split(' ')[0]]));
      const kit = modes(clone, 'HEAD');
      const tpl = modes(bare, 'main');
      const lost = [...kit].filter(([p, m]) => m === '100755' && tpl.has(p) && tpl.get(p) !== '100755').map(([p]) => p);
      const shipped = [...kit].filter(([p, m]) => m === '100755' && tpl.has(p)).length;
      ok(shipped > 0 && lost.length === 0, 'B0b the pushed template keeps every executable bit the Kit commit has',
        lost.length ? `lost +x: ${lost.join(', ')}` : `${shipped} executable file(s), all 100755`);
    }

    if (baseline) {
      // B1 NEGATIVE. A working-tree edit that `git status` cannot see (assume-unchanged stands in for
      // the stat cache here; the real F01 shape needs a Windows ctime to stage, which CI cannot) must
      // not reach the tree, and must be reported as uncommitted.
      const victim = 'scripts/lib/log.js';
      fs.appendFileSync(path.join(clone, victim), '\n// a working-tree edit nobody committed\n');
      g('update-index', '--assume-unchanged', victim);
      const hidden = g('status', '--porcelain', '--untracked-files=no').stdout.trim() === '';
      const r1 = build('--check');
      ok(hidden && r1.status === 0 && /CHECK OK/.test(r1.text),
        'B1 NEGATIVE a working-tree edit git status cannot see does not reach the generated tree', `git status clean: ${hidden}; exit ${r1.status}: ${tail(r1.text)}`);
      ok(new RegExp(`uncommitted[^\\n]*${victim.replace(/[.]/g, '\\.')}`).test(r1.text),
        'B2 NEGATIVE and the same edit is reported as uncommitted, by content', (r1.text.split('\n').find((l) => /uncommitted/.test(l)) || 'no uncommitted line').trim());
      g('update-index', '--no-assume-unchanged', victim);
      g('checkout', '-q', '--', victim);

      // B3 NEGATIVE. A shell script committed with CRLF (a blob can come from anywhere: another clone,
      // an old commit, a merge) must be refused before anything is reported or pushed.
      const plant = (rel, text, mode) => {
        fs.mkdirSync(path.dirname(path.join(clone, rel)), { recursive: true });
        fs.writeFileSync(path.join(clone, rel), text);
        const sha = sh('git', ['hash-object', '-w', '--no-filters', '--stdin'], clone, text).stdout.trim();
        g('update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`);
        g('commit', '-q', '-m', `test: plant ${rel}`);
      };
      plant('scripts/planted-crlf.sh', '#!/usr/bin/env bash\r\necho planted\r\n', '100755');
      const r3 = build('--check');
      ok(r3.status === 2 && /carriage return/.test(r3.text) && r3.text.includes('scripts/planted-crlf.sh'),
        'B3 NEGATIVE a committed CRLF shell script is refused', `exit ${r3.status}: ${tail(r3.text)}`);
      g('reset', '-q', '--hard', 'HEAD~1');

      // B4 NEGATIVE. Skill content is -text (byte-pinned by skills-lock.json) and may carry CR, but not
      // in anything that is executed: a script under .agents/skills/ opening with #! is refused too.
      plant('.agents/skills/zz-planted/run.sh', '#!/bin/sh\r\necho planted\r\n', '100644');
      const r4 = build('--check');
      ok(r4.status === 2 && /carriage return/.test(r4.text) && r4.text.includes('.agents/skills/zz-planted/run.sh'),
        'B4 NEGATIVE a CRLF script is refused even under a -text path', `exit ${r4.status}: ${tail(r4.text)}`);
      g('reset', '-q', '--hard', 'HEAD~1');

      // B5. What the build writes that the Kit does not track: where /update fetches from, and the
      // version stamp, both readable in the pushed template.
      const shown = (rel) => sh('git', ['show', `main:${rel}`], bare);
      const src = shown('system/template-source.json');
      let srcOk = false; try { const j = JSON.parse(src.stdout); srcOk = j.template_remote === TEMPLATE && j._schema === 'template-source@1'; } catch { /* reported below */ }
      const ver = shown('VERSION').stdout;
      const rows = g('show', 'HEAD:system/template-changelog.jsonl').stdout.trim().split('\n').length;
      ok(srcOk, 'B5 the template carries system/template-source.json naming its own address', src.stdout.trim().replace(/\s+/g, ' ') || src.stderr.trim());
      ok(new RegExp(`build ${rows}\\b`).test(ver), 'B5b VERSION is stamped with the build the tree is', ver.trim() || '(absent)');

      // B6. A seed names the GENERIC template (owners update from it, never from their seed), and a
      // seed's own CRLF text (a folder on disk, not a commit) lands LF. The seed repository already
      // holds that file as a CRLF blob, which is a real owner's case: git keeps an existing CRLF blob
      // CRLF under text=auto, so only the build's own normalising can move it.
      const seed = path.join(T, 'alex-zed');
      const aboutCrlf = '# About Zed\r\n\r\nZed writes on Windows.\r\n';
      fs.mkdirSync(path.join(seed, 'starter'), { recursive: true });
      fs.writeFileSync(path.join(seed, 'starter', 'ABOUT-ZED.md'), aboutCrlf);
      const seedBare = path.join(T, 'seed.git');
      const seedOld = path.join(T, 'seed-old');
      sh('git', ['init', '-q', '--bare', seedBare], T);
      sh('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], seedBare);
      fs.mkdirSync(path.join(seedOld, 'starter'), { recursive: true });
      fs.writeFileSync(path.join(seedOld, 'starter', 'ABOUT-ZED.md'), aboutCrlf);
      for (const args of [['init', '-q'], ['symbolic-ref', 'HEAD', 'refs/heads/main'], ['-c', 'core.autocrlf=false', 'add', '.'],
        ['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'an older seed build'], ['push', '-q', seedBare, 'main']]) sh('git', args, seedOld);
      const oldBlob = sh('git', ['show', 'main:starter/ABOUT-ZED.md'], seedBare).stdout;
      const rs = sh(process.execPath, [path.join(clone, 'scripts', 'build-online-template.mjs'), '--push', '--seed', seed, '--remote', seedBare, '--out', path.join(T, 'seed-build')]);
      const seedSrc = sh('git', ['show', 'main:system/template-source.json'], seedBare).stdout;
      const about = sh('git', ['show', 'main:starter/ABOUT-ZED.md'], seedBare).stdout;
      ok(oldBlob.includes('\r') && rs.status === 0 && seedSrc.includes(`"template_remote": "${DEFAULT_REMOTE}"`) && about.length > 0 && !about.includes('\r'),
        'B6 a seed names the generic template, and its CRLF text lands LF over an existing CRLF blob',
        `older blob carried CR: ${oldBlob.includes('\r')}; exit ${rs.status}; ${seedSrc.includes(DEFAULT_REMOTE) ? 'names the generic template' : 'does NOT name the generic template'}; ABOUT carries CR now: ${about.includes('\r')}; ${tail(`${rs.stdout}${rs.stderr}`)}`);
    }
  } finally {
    fs.rmSync(T, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall pass');
process.exit(failures ? 1 : 0);
