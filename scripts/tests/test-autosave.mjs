#!/usr/bin/env node
// scripts/tests/test-autosave.mjs - the Virtual Alex autosave and the run log, each guard shown
// refusing before the pass.
//
// WHAT. The Virtual Alex autosave (scripts/autosave.sh) and the run log (scripts/run-log.mjs), each
// guard shown REFUSING a synthetic violation before the pass:
//
//   T1  NEGATIVE the gate: without CLAUDE_CODE_REMOTE=true the save does nothing and says so
//   T2  NEGATIVE a page holding a fake AKIA key is refused (stub scanner), left unstaged, named on
//       stderr, absent from the commit; the clean page in the same run commits and is pushed
//   T3  NEGATIVE a file one byte over 10 MB is refused by the size guard; the small file commits
//   T4  two clones append one line each to vault/log.md: the second plain push is REJECTED (the
//       negative), its --stop rebase completes through merge=union, and origin's file has both lines
//   T5  a forced conflict on vault/index.md aborts the rebase and lands on claude/rescue-<ts>,
//       which git ls-remote --heads lists; main is untouched
//   T6  NEGATIVE without ALEX_ROUTINE a CLAUDE.md edit commits; with ALEX_ROUTINE=1 it is reverted
//       before the commit, the line says so, and a NEW file under scripts/hooks/ is refused
//   T7  run-log: append then last prints the row; last on an unknown job prints none; a status
//       outside the enum and a non-integer --missed refuse (exit 2)
//   T8  NEGATIVE a save on a branch other than main still commits and pushes that branch, and its
//       result line opens with OFF-MAIN naming the branch; a save on main carries no OFF-MAIN
//   T8c the SessionStart switch: a FRESH claude/ branch (no commits of its own, clean tree) moves to
//       main, also when main moved after the branch was cut; own work or a dirty tree NEVER moves
//   T8d NEGATIVE a stale, unrelated cached local main: the session lands on GitHub's main, the first
//       screen names it, and the cached commit survives on claude/rescue-stale-main-<utc>-<commit>
//   T8e a session started ON a main behind GitHub is fast-forwarded before the tree is read
//   T8f NEGATIVE a rescue push that fails moves nothing and drops nothing
//   T8h NEGATIVE a rescue whose time-only name is already taken (two rescues in one second) is still
//       kept, because the name carries the commit
//   T9  DOC (not a negative) without --json a refusal exits 0 with stdout the model never parses, which
//       is the 2026-09-23 defect restated. It passes before AND after the --json fix by construction
//       (fleet review F25), so it documents the mechanism and guards nothing; T9b-T9g are the guards
//   T9b --json on PostToolUse prints one {"systemMessage": ...} naming the refused file, and the
//       clean file in the same run still commits
//   T9c a clean save in --json mode prints NOTHING (a note per write turn is noise)
//   T9d a commit the pre-commit gate REFUSES is surfaced, not reported as a save
//   T9e --stop --json returns {"decision":"block","reason":...}, and stop_hook_active=true on stdin
//       blocks nothing, so the hook cannot loop, whether the payload is compact, spaced or
//       pretty-printed
//   T9f DRIFT the shipped online settings.json actually passes --json on both hooks
//   T9g NEGATIVE json_escape turns an ANSI colour and every other C0 control byte into a string
//       that still parses as JSON, so a refusal that quotes a coloured gate line is not dropped
//   T10 NEGATIVE the version floor: the online SessionStart hook runs scripts/lib/cli-version.js, which
//       says CLI-OLD below 2.1.227 (where a hook's systemMessage never reaches the model) and
//       CLI-UNKNOWN when the version cannot be read (garbage, a hang, not on PATH), prints nothing at
//       or above it, and exits 0 on every path
//
// HOW. It runs against throwaway clones of a fixture under the OS temp dir, with a local bare repo
// as origin and CLAUDE_CODE_REMOTE=true exported.
//   node scripts/tests/test-autosave.mjs [--tree <dir>] [--keep]
// --tree <dir>   use that directory's files (a generated Virtual Alex tree) as the fixture instead
//                of the minimal one built here; the scripts under test are then the tree's own
// --keep         leave the temp directory in place and print its path
// Exit 0 = all pass, 1 = any failure.
//
// NEVER. Nothing here touches the Kit or any remote: every clone, and the bare repo it pushes to,
// sits in the temp directory.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const TREE = argv.includes('--tree') ? path.resolve(argv[argv.indexOf('--tree') + 1]) : null;

// WHERE THE ONLINE settings.json LIVES, which is not one place. In the Kit it is the variant source
// under variants/online/; in the generated template, and in any tree passed with --tree, it is the
// real .claude/settings.json. This file SHIPS into the template and runs in its CI, where
// variants/ is a drop row and therefore absent, so a hard-coded Kit path is an ENOENT crash rather
// than a failed assertion. It was written correctly once and then copied twice without the
// fallback; this is the one resolver all three call sites use.
// (Found 2026-09-23 by the template CI, run 35917054586.)
const onlineSettings = () => [
  TREE && path.join(TREE, '.claude', 'settings.json'),
  path.join(KIT, 'variants', 'online', '.claude', 'settings.json'),
  path.join(KIT, '.claude', 'settings.json'),
].find((p) => p && fs.existsSync(p));
const KEEP = argv.includes('--keep');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};
const show = (label, text) => {
  const t = String(text || '').trim();
  if (t) console.log(`      ${label}: ${t.split(/\r?\n/).join(`\n      ${' '.repeat(label.length)}  `)}`);
};

// ---------------------------------------------------------------- tools
// On Windows `bash` on PATH is WSL's launcher; the hook runs under Git's own bash, so use that.
function findBash() {
  if (process.env.ALEX_BASH) return process.env.ALEX_BASH;
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const gitExe = line.trim();
    if (!gitExe) continue;
    const cand = path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe');
    if (fs.existsSync(cand)) return cand;
  }
  throw new Error('Git bash not found next to git.exe; set ALEX_BASH');
}
const BASH = findBash();

function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`git ${args.join(' ')} in ${cwd} failed (${r.status}): ${r.stderr}`);
  }
  return r;
}
const out = (cwd, args) => git(cwd, args).stdout.trim();

function autosave(cwd, args = [], env = {}) {
  const r = spawnSync(BASH, [path.join(cwd, 'scripts', 'autosave.sh'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', ALEX_ROUTINE: '', ...env },
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}
function runLog(cwd, args) {
  const r = spawnSync(process.execPath, [path.join(cwd, 'scripts', 'run-log.mjs'), ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}
const write = (cwd, rel, text) => {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const append = (cwd, rel, text) => fs.appendFileSync(path.join(cwd, rel), text);
const read = (cwd, rel) => fs.readFileSync(path.join(cwd, rel), 'utf8');
const treeHas = (cwd, ref, rel) => git(cwd, ['cat-file', '-e', `${ref}:${rel}`], { allowFail: true }).status === 0;

// ---------------------------------------------------------------- fixture
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-autosave-'));
const BARE = path.join(TMP, 'origin.git');
const SEED = path.join(TMP, 'seed');

function copyTree(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); }
    else fs.copyFileSync(s, d);
  }
}

git(TMP, ['init', '-q', '--bare', '-b', 'main', BARE]);
fs.mkdirSync(SEED);
git(TMP, ['init', '-q', '-b', 'main', SEED]);
if (TREE) {
  copyTree(TREE, SEED);
} else {
  fs.mkdirSync(path.join(SEED, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'autosave.sh'), path.join(SEED, 'scripts', 'autosave.sh'));
  fs.copyFileSync(path.join(KIT, 'scripts', 'run-log.mjs'), path.join(SEED, 'scripts', 'run-log.mjs'));
  // the routine identity reset reads its path list from the guard (--identity-paths), so the fixture carries it
  fs.copyFileSync(path.join(KIT, 'scripts', 'untrusted-lane-guard.js'), path.join(SEED, 'scripts', 'untrusted-lane-guard.js'));
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'json-writer.js'), path.join(SEED, 'scripts', 'lib', 'json-writer.js'));
  // the SessionStart branch step (T8b to T8f) runs the fixture's own copy
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'session-branch.sh'), path.join(SEED, 'scripts', 'lib', 'session-branch.sh'));
  fs.copyFileSync(path.join(KIT, '.gitattributes'), path.join(SEED, '.gitattributes'));
  write(SEED, 'CLAUDE.md', '# Alex\n\nThe constitution.\n');
  write(SEED, 'soul.md', '# Soul\n');
  write(SEED, 'vault/log.md', '# Log\n\n## [2026-09-22 08:00] seed | first line\n');
  write(SEED, 'vault/index.md', 'line one\nline two\n');
  write(SEED, 'vault/projects/x/status.md', '# x\n');
  write(SEED, 'scripts/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  write(SEED, '.gitignore', 'outputs/logs/*\n');
}
const ident = ['-c', 'user.name=Alex Kit', '-c', 'user.email=alex-kit@localhost'];
git(SEED, ['config', 'core.autocrlf', 'false']);
git(SEED, ['add', '-A']);
git(SEED, [...ident, 'commit', '-qm', 'seed']);
git(SEED, ['remote', 'add', 'origin', BARE]);
git(SEED, ['push', '-q', 'origin', 'main']);

let n = 0;
function clone(name) {
  const dir = path.join(TMP, `${name}-${++n}`);
  // -c on the clone itself: the checkout must not run under the system autocrlf, or every LF file
  // reads as modified before the first test
  git(TMP, ['clone', '-q', '-c', 'core.autocrlf=false', BARE, dir]);
  git(dir, ['config', 'user.name', 'Alex Kit']);
  git(dir, ['config', 'user.email', 'alex-kit@localhost']);
  return dir;
}
const remoteHead = (ref = 'refs/heads/main') => {
  const r = git(TMP, ['ls-remote', BARE, ref]).stdout.trim();
  return r ? r.split(/\s+/)[0] : '';
};

console.log(`fixture: ${TREE ? `tree ${TREE}` : 'minimal'} in ${TMP} (bash: ${BASH})`);

// ---------------------------------------------------------------- T1: the gate
{
  const a = clone('gate');
  write(a, 'vault/gate.md', 'a page written with the gate closed\n');
  const r = autosave(a, [], { CLAUDE_CODE_REMOTE: '' });
  show('stdout', r.stdout);
  ok(r.status === 0 && /skipped/.test(r.stdout), 'T1 NEGATIVE without CLAUDE_CODE_REMOTE=true the save skips and says so', `exit ${r.status}`);
  ok(out(a, ['status', '--porcelain', '--untracked-files=all']).startsWith('?? vault/gate.md'), 'T1 nothing was staged or committed', out(a, ['status', '--porcelain', '--untracked-files=all']));
  ok(remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T1 origin/main unchanged');
}

// ---------------------------------------------------------------- T2: the fake key
{
  const a = clone('secret');
  // stub scanner: seat 4 ships the real scripts/secret-scan.mjs with the same contract
  // (--file <path>; exit 0 clean, 2 hit). The marker is assembled at runtime so this test file
  // never carries the shape itself.
  const marker = ['AK', 'IA'].join('');
  write(a, 'scripts/secret-scan.mjs',
    `import fs from 'node:fs';\nconst f = process.argv[process.argv.indexOf('--file') + 1];\n` +
    `const marker = ['AK', 'IA'].join('');\n` +
    `const hit = fs.readFileSync(f, 'utf8').split(/\\r?\\n/).findIndex((l) => l.includes(marker));\n` +
    `if (hit >= 0) { console.log('secret-scan: ' + f + ':' + (hit + 1) + ' aws-access-key'); process.exit(2); }\n`);
  write(a, 'vault/leak.md', `# Notes\n\naws key ${marker}${'0123456789ABCDEF'}\n`);
  write(a, 'vault/clean.md', '# Clean\n\nA page with nothing in it.\n');
  const r = autosave(a);
  show('stdout', r.stdout); show('stderr', r.stderr);
  const head = out(a, ['rev-parse', 'HEAD']);
  ok(r.status === 0, 'T2 the hook exits 0 even with a refusal', `exit ${r.status}`);
  ok(/refused vault\/leak\.md/.test(r.stderr), 'T2 NEGATIVE the AKIA page is refused and named on stderr');
  ok(/refused 1: vault\/leak\.md/.test(r.stdout), 'T2 the result line counts and names it');
  ok(out(a, ['status', '--porcelain', '--', 'vault/leak.md']) === '?? vault/leak.md', 'T2 the AKIA page is left unstaged', out(a, ['status', '--porcelain', '--', 'vault/leak.md']));
  ok(!treeHas(a, 'HEAD', 'vault/leak.md'), 'T2 the autosave commit does not contain the AKIA page');
  ok(treeHas(a, 'HEAD', 'vault/clean.md'), 'T2 the clean page in the same run committed');
  ok(/^alex: autosave \d{4}-\d{2}-\d{2}T/.test(out(a, ['log', '-1', '--format=%s'])), 'T2 commit subject is alex: autosave <utc>', out(a, ['log', '-1', '--format=%s']));
  ok(remoteHead() === head, 'T2 read-back: origin/main is the autosave commit', `${remoteHead().slice(0, 12)} == ${head.slice(0, 12)}`);
  ok(!treeHas(a, 'origin/main', 'vault/leak.md'), 'T2 the pushed tree does not contain the AKIA page');
}

// ---------------------------------------------------------------- T3: the size guard
{
  const a = clone('size');
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41);
  fs.writeFileSync(path.join(a, 'vault', 'scan.pdf'), big);
  write(a, 'vault/small.md', '# Small\n');
  const r = autosave(a);
  show('stdout', r.stdout); show('stderr', r.stderr);
  ok(/refused vault\/scan\.pdf: 10485761 bytes is over the 10485760 byte size guard/.test(r.stderr), 'T3 NEGATIVE the 10 MB + 1 file is refused by the size guard');
  ok(out(a, ['status', '--porcelain', '--', 'vault/scan.pdf']) === '?? vault/scan.pdf', 'T3 the big file is left unstaged');
  ok(!treeHas(a, 'HEAD', 'vault/scan.pdf') && treeHas(a, 'HEAD', 'vault/small.md'), 'T3 the commit has the small file and not the big one');
  ok(remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T3 read-back: pushed');
}

// ---------------------------------------------------------------- T4: two writers, union merge
{
  const a = clone('writer-a');
  const b = clone('writer-b');   // cloned before A pushes, so B is behind
  append(a, 'vault/log.md', '## [2026-09-22 09:00] session-a | line from A\n');
  const ra = autosave(a);
  show('A stdout', ra.stdout);
  ok(remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T4 A pushed its line');
  append(b, 'vault/log.md', '## [2026-09-22 09:01] routine-b | line from B\n');
  const rb1 = autosave(b);
  show('B stdout (plain)', rb1.stdout);
  ok(rb1.status === 0 && /push of main FAILED/.test(rb1.stdout) && /rejected/.test(rb1.stdout), 'T4 NEGATIVE B\'s plain push is rejected (behind origin), exit 0, loud line');
  ok(remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T4 origin/main still A\'s commit after the rejected push');
  const rb2 = autosave(b, ['--stop']);
  show('B stdout (--stop)', rb2.stdout);
  ok(/pushed to origin\/main and read back/.test(rb2.stdout), 'T4 B\'s --stop rebase completed and pushed');
  ok(remoteHead() === out(b, ['rev-parse', 'HEAD']), 'T4 read-back: origin/main is B\'s rebased commit');
  const merged = git(b, ['show', 'origin/main:vault/log.md']).stdout;
  ok(merged.includes('line from A') && merged.includes('line from B'), 'T4 origin\'s vault/log.md carries both lines (merge=union)');
  ok(!/[<>=]{7}/.test(merged), 'T4 no conflict markers in the merged file');
  ok(git(b, ['status', '--porcelain']).stdout.trim() === '', 'T4 B\'s tree is clean after the rebase');
}

// ---------------------------------------------------------------- T5: a true conflict -> rescue branch
{
  const a = clone('conflict-a');
  const b = clone('conflict-b');
  write(a, 'vault/index.md', 'line one changed by A\nline two\n');
  autosave(a);
  const mainBefore = remoteHead();
  write(b, 'vault/index.md', 'line one changed by B\nline two\n');
  const rb = autosave(b, ['--stop']);
  show('B stdout (--stop)', rb.stdout);
  const m = /pushed to (claude\/rescue-\d{8}T\d{6}Z)/.exec(rb.stdout);
  ok(rb.status === 0 && /CONFLICT on main, rebase aborted/.test(rb.stdout) && m, 'T5 the conflicting --stop aborts the rebase and names a rescue branch');
  const heads = git(TMP, ['ls-remote', '--heads', BARE]).stdout;
  show('ls-remote --heads', heads);
  ok(m && heads.includes(`refs/heads/${m[1]}`), 'T5 git ls-remote --heads lists the rescue branch');
  ok(m && remoteHead(`refs/heads/${m[1]}`) === out(b, ['rev-parse', 'HEAD']), 'T5 the rescue branch is B\'s HEAD');
  ok(remoteHead() === mainBefore, 'T5 origin/main is untouched (still A\'s commit)');
  ok(!fs.existsSync(path.join(b, '.git', 'rebase-merge')) && !fs.existsSync(path.join(b, '.git', 'rebase-apply')), 'T5 no rebase left in progress in B');
  ok(read(b, 'vault/index.md').startsWith('line one changed by B'), 'T5 B\'s working tree still holds B\'s version');
}

// ---------------------------------------------------------------- T6: the routine identity reset
{
  const a = clone('routine');
  const original = read(a, 'CLAUDE.md');
  // NEGATIVE first: no ALEX_ROUTINE, an identity edit commits like any other file
  write(a, 'CLAUDE.md', original + '\nAn owner edit.\n');
  const r0 = autosave(a);
  show('stdout (owner)', r0.stdout);
  ok(!/identity reset/.test(r0.stdout) && out(a, ['diff', '--name-only', 'HEAD~1', 'HEAD']).includes('CLAUDE.md'), 'T6 NEGATIVE without ALEX_ROUTINE the CLAUDE.md edit commits (the reset is gated on the variable)');
  const ownerHead = read(a, 'CLAUDE.md');
  // now the routine
  write(a, 'CLAUDE.md', ownerHead + '\nA routine tried to rewrite its own rules.\n');
  write(a, 'vault/projects/x/status.md', '# x\n\nlast_run: 2026-09-22\n');
  write(a, 'scripts/hooks/evil', '#!/bin/sh\necho no\n');
  const r1 = autosave(a, [], { ALEX_ROUTINE: '1' });
  show('stdout (routine)', r1.stdout); show('stderr (routine)', r1.stderr);
  ok(/routine identity reset reverted: CLAUDE\.md/.test(r1.stdout), 'T6 the line says CLAUDE.md was reverted');
  ok(read(a, 'CLAUDE.md') === ownerHead, 'T6 CLAUDE.md is back to HEAD before the commit');
  const changed = out(a, ['diff', '--name-only', 'HEAD~1', 'HEAD']).split(/\r?\n/);
  ok(changed.includes('vault/projects/x/status.md') && !changed.includes('CLAUDE.md'), 'T6 the commit has the status page and no CLAUDE.md change', changed.join(', '));
  ok(/refused scripts\/hooks\/evil: new file under an identity path in a routine session/.test(r1.stderr), 'T6 NEGATIVE a new file under scripts/hooks/ is refused in a routine session');
  ok(!treeHas(a, 'HEAD', 'scripts/hooks/evil') && out(a, ['status', '--porcelain', '--', 'scripts/hooks/evil']) === '?? scripts/hooks/evil', 'T6 the new hook file is left unstaged and uncommitted');
  ok(remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T6 read-back: pushed');
}

// ---------------------------------------------------------------- T7: run-log append and last
{
  const a = clone('runlog');
  const bad = runLog(a, ['append', '--job', 'triage', '--status', 'GREEN']);
  show('bad status', bad.stderr);
  ok(bad.status === 2 && /status/.test(bad.stderr), 'T7 NEGATIVE a status outside the enum refuses (exit 2)');
  const badMissed = runLog(a, ['append', '--job', 'triage', '--status', 'COMPLETE', '--missed', 'two']);
  ok(badMissed.status === 2 && /missed/.test(badMissed.stderr), 'T7 NEGATIVE a non-integer --missed refuses (exit 2)');
  ok(!fs.existsSync(path.join(a, 'system', 'run-log.jsonl')), 'T7 a refused append writes no row');
  const none = runLog(a, ['last', 'triage']);
  ok(none.status === 0 && none.stdout === 'none', 'T7 last on a job with no rows prints none', none.stdout);
  const add = runLog(a, ['append', '--job', 'triage', '--status', 'COMPLETE', '--canary', 'ok', '--model', 'claude-sonnet-4-6', '--missed', '0', '--session-url', 'https://claude.ai/code/session/abc']);
  show('append', add.stdout);
  const add2 = runLog(a, ['append', '--job', 'brief', '--status', 'BLOCKED', '--reason', 'no calendar connector']);
  const last = runLog(a, ['last', 'triage']);
  show('last triage', last.stdout);
  let row = null;
  try { row = JSON.parse(last.stdout); } catch { row = null; }
  ok(add.status === 0 && add2.status === 0 && row && row.job === 'triage' && row.status === 'COMPLETE' && row.canary === 'ok' && row.missed === 0 && row.model === 'claude-sonnet-4-6' && row.session_url === 'https://claude.ai/code/session/abc', 'T7 last triage prints the row append just wrote');
  ok(row && Object.keys(row).join(',') === 'at,canary,job,missed,model,reason,repo,session_url,sha,status', 'T7 the row carries the ten keys in the writer\'s order', row ? Object.keys(row).join(',') : '');
  ok(row && row.reason === null && row.repo === null && row.sha === null, 'T7 an option not given is null, never absent');
  const badSha = runLog(a, ['append', '--job', 'snapshot', '--status', 'COMPLETE', '--repo', 'o/n', '--sha', 'not-a-sha']);
  ok(badSha.status === 2 && /--sha/.test(badSha.stderr), 'T7 NEGATIVE a --sha that is not a commit sha refuses (exit 2)', badSha.stderr);
  const file = read(a, 'system/run-log.jsonl');
  ok(file.split('\n').filter(Boolean).length === 2 && file.endsWith('\n') && !file.includes('\r'), 'T7 two rows, one per line, LF, trailing newline');
  const all = runLog(a, ['last']);
  show('last (all)', all.stdout);
  ok(all.status === 0 && all.stdout.split('\n').length === 2 && all.stdout.includes('"job":"brief"') && all.stdout.includes('"job":"triage"'), 'T7 last with no job prints the newest row per job');
  const r = autosave(a);
  ok(treeHas(a, 'HEAD', 'system/run-log.jsonl') && remoteHead() === out(a, ['rev-parse', 'HEAD']), 'T7 the run log autosaves like any other file', r.stdout);
}

// ---------------------------------------------------------------- T8: a session that is not on main
// Review finding 1, 2026-09-23: the next session starts from main, so a save on any other branch is
// invisible to it. The save must still happen (the work is never dropped) and must say OFF-MAIN.
{
  const a = clone('offmain');
  const mainBefore = remoteHead();
  git(a, ['checkout', '-q', '-b', 'claude/session-x']);
  write(a, 'vault/offmain.md', '# Written on a side branch\n');
  const r = autosave(a, ['--stop']);
  show('stdout', r.stdout);
  ok(r.status === 0, 'T8 the hook still exits 0 off main', `exit ${r.status}`);
  ok(/^autosave: OFF-MAIN on claude\/session-x, not main/.test(r.stdout), 'T8 NEGATIVE a save on claude/session-x opens with OFF-MAIN and names the branch');
  ok(/pushed to origin\/claude\/session-x and read back/.test(r.stdout), 'T8 the work is still pushed to its own branch and read back');
  ok(remoteHead('refs/heads/claude/session-x') === out(a, ['rev-parse', 'HEAD']), 'T8 read-back: origin/claude/session-x is the autosave commit');
  ok(remoteHead() === mainBefore, 'T8 origin/main is untouched');
  const b = clone('onmain');
  write(b, 'vault/onmain.md', '# Written on main\n');
  const rb = autosave(b, ['--stop']);
  ok(!/OFF-MAIN/.test(rb.stdout) && /main at [0-9a-f]+ pushed to origin\/main and read back/.test(rb.stdout), 'T8 a save on main carries no OFF-MAIN', rb.stdout);

  // T8b: the SessionStart hook is what the MODEL sees (autosave's lines reach only the log and the
  // close-out), so it must name a side branch on the first screen. The online settings live under
  // variants/online/ in the Kit and at .claude/ on the online tree.
  const settingsPath = onlineSettings();
  const startCmd = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks.SessionStart[0].hooks[0].command;
  const start = (cwd) => spawnSync(BASH, ['-c', startCmd], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }).stdout || '';
  const sa = start(a);
  const sb = start(b);
  ok(/---BRANCH-NOT-MAIN--- This session is on claude\/session-x, not main/.test(sa), 'T8b NEGATIVE the first screen of a session on claude/session-x says BRANCH-NOT-MAIN and names it');
  ok(/^BRANCH: main$/m.test(sb) && !/BRANCH-NOT-MAIN/.test(sb), 'T8b the first screen of a session on main says BRANCH: main');

  // T8c: the switch (check 2b, measured live 2026-09-23: a claude.ai/code session starts on a
  // platform branch claude/<name> cut from main, and a session CAN check out and push main). The
  // SessionStart hook moves a FRESH platform branch to main before the card is built; a branch
  // with work of its own, or a dirty tree, is never moved, and says BRANCH-NOT-MAIN instead.
  const cur = (cwd) => out(cwd, ['branch', '--show-current']);
  const c1 = clone('fresh');
  git(c1, ['checkout', '-q', '-b', 'claude/fresh-1']);
  const s1 = start(c1);
  ok(/^BRANCH: main \(switched from claude\/fresh-1, a fresh platform branch with no work of its own\)$/m.test(s1) && cur(c1) === 'main', 'T8c a fresh claude/ branch is switched to main and the first screen says so', `${cur(c1)} :: ${s1.split('\n').find((l) => /BRANCH/.test(l)) || ''}`);
  const c2 = clone('ownwork');
  git(c2, ['checkout', '-q', '-b', 'claude/work-2']);
  write(c2, 'vault/own.md', '# work of its own\n');
  git(c2, ['add', '-A']); git(c2, ['commit', '-qm', 'own work']);
  const s2 = start(c2);
  ok(/---BRANCH-NOT-MAIN--- This session is on claude\/work-2/.test(s2) && cur(c2) === 'claude/work-2', 'T8c NEGATIVE a claude/ branch with a commit of its own is never moved (it warns instead)');
  const c3 = clone('dirty');
  git(c3, ['checkout', '-q', '-b', 'claude/dirty-3']);
  write(c3, 'vault/unsaved.md', '# not committed\n');
  const s3 = start(c3);
  ok(/---BRANCH-NOT-MAIN--- This session is on claude\/dirty-3/.test(s3) && cur(c3) === 'claude/dirty-3' && fs.existsSync(path.join(c3, 'vault', 'unsaved.md')), 'T8c NEGATIVE a dirty tree is never moved, and the unsaved file is still there');
  const c4 = clone('behind');
  git(c4, ['checkout', '-q', '-b', 'claude/behind-4']);
  const mover = clone('mover');
  write(mover, 'vault/moved.md', '# main moved after the branch was cut\n');
  git(mover, ['add', '-A']); git(mover, ['commit', '-qm', 'main moves']); git(mover, ['push', '-q', 'origin', 'main']);
  const s4 = start(c4);
  ok(/switched from claude\/behind-4/.test(s4) && cur(c4) === 'main' && out(c4, ['rev-parse', 'HEAD']) === remoteHead(), 'T8c a platform branch BEHIND main switches and fast-forwards to origin/main');

  // T8d: the STALE cached main (measured live 2026-09-23 after a repository was deleted and made
  // again): the local main is an unrelated history. The switch must land on GitHub's main, never
  // on the cached ref, and the cached commit must survive on a rescue branch.
  const c5 = clone('stale');
  git(c5, ['checkout', '-q', '--orphan', 'old-root']);
  git(c5, ['rm', '-rq', '--cached', '.']);
  write(c5, 'OLD.md', '# the deleted repository\n');
  git(c5, ['add', 'OLD.md']); git(c5, ['commit', '-qm', 'Initial commit (the deleted repo)']);
  const staleSha = out(c5, ['rev-parse', 'HEAD']);
  git(c5, ['branch', '-q', '-f', 'main', 'old-root']);
  git(c5, ['clean', '-fdxq']);
  git(c5, ['checkout', '-q', '-f', '-b', 'claude/stale-5', 'origin/main']);
  git(c5, ['branch', '-q', '-D', 'old-root']);
  const s5 = start(c5);
  const r5 = /kept on (claude\/rescue-stale-main-\d{8}T\d{6}Z-([0-9a-f]{12}))/.exec(s5);
  ok(/^BRANCH: main \(switched from claude\/stale-5, a fresh platform branch with no work of its own; the cached local main had 1 commit\(s\) that GitHub's main lacks, kept on claude\/rescue-stale-main-/m.test(s5), 'T8d NEGATIVE a stale unrelated local main is named on the first screen, not hidden under a plain BRANCH: main', (s5.split('\n').find((l) => /BRANCH/.test(l)) || '').slice(0, 160));
  ok(cur(c5) === 'main' && out(c5, ['rev-parse', 'HEAD']) === remoteHead() && !fs.existsSync(path.join(c5, 'OLD.md')), 'T8d the session lands on GitHub\'s main, not on the cached history');
  ok(r5 && remoteHead(`refs/heads/${r5[1]}`) === staleSha && staleSha.startsWith(r5[2]), 'T8d the cached commit survives on the rescue branch on origin, and the name carries that commit', r5 ? r5[1] : 'no rescue name');

  // T8e: a session the platform starts ON main, with a cached main behind GitHub's
  const c6 = clone('onmain-behind');
  const mover2 = clone('mover2');
  write(mover2, 'vault/moved2.md', '# main moved again\n');
  git(mover2, ['add', '-A']); git(mover2, ['commit', '-qm', 'main moves again']); git(mover2, ['push', '-q', 'origin', 'main']);
  const s6 = start(c6);
  ok(/^BRANCH: main \(fast-forwarded to GitHub's main\)$/m.test(s6) && out(c6, ['rev-parse', 'HEAD']) === remoteHead(), 'T8e a session started on a main behind GitHub is fast-forwarded before anything reads the tree');

  // T8f: cached commits that cannot be kept (the rescue push fails) are never dropped: nothing moves
  const c7 = clone('norescue');
  write(c7, 'vault/unpushed.md', '# a save that never reached GitHub\n');
  git(c7, ['add', '-A']); git(c7, ['commit', '-qm', 'unpushed save']);
  const keep = out(c7, ['rev-parse', 'HEAD']);
  git(c7, ['checkout', '-q', '-b', 'claude/norescue-7', 'origin/main']);
  git(c7, ['remote', 'set-url', '--push', 'origin', path.join(TMP, 'no-such-remote.git')]);
  const s7 = start(c7);
  ok(/---BRANCH-NOT-MAIN--- This session is on claude\/norescue-7, not main \(the cached local main has commits that GitHub's main lacks and they could not be kept/.test(s7) && cur(c7) === 'claude/norescue-7' && out(c7, ['rev-parse', 'refs/heads/main']) === keep, 'T8f NEGATIVE a rescue push that fails moves nothing and the cached commit is untouched');
}

// ---------------------------------------------------------------- T8g: on main, but not GitHub's main
// The 2026-09-23 defect: a session opened on the platform's cached copy of a DELETED repository,
// the sync failed, the screen said a plain `BRANCH: main`, and the model read a tree with no
// identity in it while believing it was current. A note after the word main is not read. A marker
// is: ---BRANCH-NOT-MAIN--- is quoted in first replies, so the stale case gets one of its own.
{
  const settingsPath = onlineSettings();
  const startCmd = JSON.parse(fs.readFileSync(settingsPath, 'utf8')).hooks.SessionStart[0].hooks[0].command;
  const start = (cwd) => spawnSync(BASH, ['-c', startCmd], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } }).stdout || '';

  // a: on main, GitHub unreachable. The tree was never compared with anything.
  {
    const a = clone('diverged-fetch');
    git(a, ['remote', 'set-url', 'origin', path.join(TMP, 'no-such-remote.git')]);
    const s = start(a);
    ok(/---BRANCH-DIVERGED---/.test(s) && /could not be fetched/.test(s),
      'T8g a session on main that cannot reach GitHub says BRANCH-DIVERGED, not a plain BRANCH: main',
      (s.split(/\r?\n/).find((l) => /BRANCH/.test(l)) || s).slice(0, 150));
    ok(!/^BRANCH: main/m.test(s), 'T8g NEGATIVE and it does not also print a bare BRANCH: main line');
  }

  // b: on main with unsaved files. Nothing was synced, so the tree is whatever it was.
  {
    const b = clone('diverged-dirty');
    write(b, 'vault/unsaved.md', '# a file the previous session left behind\n');
    const s = start(b);
    ok(/---BRANCH-DIVERGED---/.test(s) && /unsaved files/.test(s),
      'T8g a session on main with unsaved files says BRANCH-DIVERGED',
      (s.split(/\r?\n/).find((l) => /BRANCH/.test(l)) || s).slice(0, 150));
  }

  // c: the healthy case still says the plain line, so the marker keeps meaning something.
  {
    const c = clone('diverged-clean');
    const s = start(c);
    ok(/^BRANCH: main$/m.test(s) && !/BRANCH-DIVERGED/.test(s),
      'T8g a copy that IS GitHub\'s main still says the plain BRANCH: main',
      (s.split(/\r?\n/).find((l) => /BRANCH/.test(l)) || s).slice(0, 120));
  }

  // d: local main carries commits GitHub's main lacks, and they are kept before anything moves.
  {
    const d = clone('diverged-rescue');
    write(d, 'vault/only-here.md', '# a commit only the cached local main has\n');
    git(d, ['add', '-A']); git(d, ['commit', '-qm', 'cached-only work']);
    const kept = out(d, ['rev-parse', 'HEAD']);
    const s = start(d);
    const branches = git(TMP, ['ls-remote', '--heads', BARE]).stdout;
    ok(/claude\/rescue-stale-main-/.test(branches),
      'T8g a cached-only commit is pushed to a rescue branch before main moves',
      branches.trim().split(/\r?\n/).join(' | '));
    ok(git(BARE, ['cat-file', '-e', `${kept}^{commit}`], { allowFail: true }).status === 0,
      'T8g NEGATIVE the commit itself is never reset away: it is on the remote before main moves', kept.slice(0, 12));
    ok(/kept on claude\/rescue-stale-main-/.test(s),
      'T8g and the line names where it went', (s.split(/\r?\n/).find((l) => /BRANCH/.test(l)) || s).slice(0, 170));
  }
  // T8h (2026-09-24, fleet seat 4): a rescue whose name is already taken. The name carried only the
  // UTC second, so a second rescue within the same second collided with the first, the push was
  // refused, and the cached commit was not kept. On a fast Ubuntu runner T8d and T8g above did exactly
  // that and failed seed CI run 35930435845, while the same code passed template CI. Here every name
  // the old scheme could produce in the next 30 seconds is taken by a divergent commit first, so the
  // collision is certain rather than a matter of timing. (A PATH shim for `date` cannot do this on
  // Windows: Git's bash.exe puts /usr/bin ahead of the inherited path.)
  {
    const blocker = clone('rescue-name-taken');
    write(blocker, 'vault/blocker.md', '# a commit that is on nobody\'s main\n');
    git(blocker, ['add', '-A']); git(blocker, ['commit', '-qm', 'divergent blocker']);
    git(blocker, ['push', '-q', 'origin', 'HEAD:refs/heads/claude/blocker']);
    const blockSha = out(blocker, ['rev-parse', 'HEAD']);
    const t0 = Date.now();
    for (let i = 0; i < 30; i++) {
      const ts = new Date(t0 + i * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      git(BARE, ['update-ref', `refs/heads/claude/rescue-stale-main-${ts}`, blockSha]);
    }
    const two = clone('rescue-second');
    write(two, 'vault/two.md', '# the cached-only commit that must be kept\n');
    git(two, ['add', '-A']); git(two, ['commit', '-qm', 'cached-only, rescued second']);
    const kept2 = out(two, ['rev-parse', 'HEAD']);
    const s = start(two);
    ok(git(BARE, ['cat-file', '-e', `${kept2}^{commit}`], { allowFail: true }).status === 0 && /kept on claude\/rescue-stale-main-/.test(s),
      'T8h NEGATIVE a rescue whose time-only name is already taken is kept too: the name carries the commit',
      (s.split(/\r?\n/).find((l) => /BRANCH/.test(l)) || s).slice(0, 170));
  }
}

// ---------------------------------------------------------------- T9: the refusal reaches the model
// The 2026-09-23 defect: the script exits 0 by design and a hook's plain stdout does not reach
// Claude, so a REFUSED commit was indistinguishable from a successful save. A real install lost an
// afternoon of memory to it and nobody could see why. --json is the fix, and the shape is per event
// (Claude Code hooks reference): PostToolUse cannot block and uses systemMessage, Stop blocks with
// a decision and a reason, once per turn.
{
  const marker = ['AK', 'IA'].join('');
  const stub =
    `import fs from 'node:fs';\nconst f = process.argv[process.argv.indexOf('--file') + 1];\n` +
    `const marker = ['AK', 'IA'].join('');\n` +
    `const hit = fs.readFileSync(f, 'utf8').split(/\\r?\\n/).findIndex((l) => l.includes(marker));\n` +
    `if (hit >= 0) { console.log('secret-scan: ' + f + ':' + (hit + 1) + ' aws-access-key'); process.exit(2); }\n`;

  // --- the defect, restated: no --json, and the model is told nothing ---
  // A DOCUMENTATION leg, labelled as one since 2026-09-24 (fleet review F25). It reads the plain mode,
  // which the fix left unchanged on purpose, so it passes with the fix reverted and cannot catch that.
  // It stays because it shows WHY --json exists; the legs that fail on the defect are T9b to T9g.
  {
    const a = clone('json-off');
    write(a, 'scripts/secret-scan.mjs', stub);
    write(a, 'vault/leak.md', `# Notes\n\naws key ${marker}${'0123456789ABCDEF'}\n`);
    const r = autosave(a);
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
    ok(r.status === 0 && parsed === null,
      'T9 DOC without --json a refusal exits 0 and stdout is not machine-readable: the model is told nothing (the mechanism, not a guard)',
      `exit ${r.status}, stdout ${r.stdout.slice(0, 60)}`);
  }

  // --- PostToolUse: systemMessage, which the reference says Claude sees in the conversation ---
  {
    const a = clone('json-post');
    write(a, 'scripts/secret-scan.mjs', stub);
    write(a, 'vault/leak.md', `# Notes\n\naws key ${marker}${'0123456789ABCDEF'}\n`);
    write(a, 'vault/clean.md', '# Clean\n');
    const r = autosave(a, ['--json']);
    show('stdout', r.stdout);
    let o = null;
    try { o = JSON.parse(r.stdout); } catch { o = null; }
    ok(o !== null, 'T9b --json prints ONE parseable JSON object and nothing beside it', r.stdout.slice(0, 120));
    ok(o !== null && typeof o.systemMessage === 'string',
      'T9b PostToolUse uses systemMessage (exit 2 is not honored for this event)');
    ok(o !== null && /refused 1: vault\/leak\.md/.test(o.systemMessage || ''),
      'T9b the message names the refused file', o && o.systemMessage);
    ok(treeHas(a, 'HEAD', 'vault/clean.md'),
      'T9b the clean page still committed: surfacing a refusal never blocks the save');
  }

  // --- a clean save says nothing: a note after every write is noise, and noise is not read ---
  {
    const a = clone('json-clean');
    write(a, 'vault/fine.md', '# A page with nothing wrong with it\n');
    const r = autosave(a, ['--json']);
    ok(r.stdout === '', 'T9c a clean save in --json mode prints NOTHING to the model', `stdout ${r.stdout.slice(0, 80)}`);
    ok(treeHas(a, 'HEAD', 'vault/fine.md'), 'T9c and it still committed');
  }

  // --- the commit-blocked case, which is exactly what happened on 2026-09-23 ---
  {
    const a = clone('json-gate');
    write(a, 'scripts/hooks/pre-commit', '#!/bin/sh\necho "pre-commit: BLOCKED by the clone-scrub leg" >&2\nexit 1\n');
    git(a, ['config', 'core.hooksPath', 'scripts/hooks']);
    fs.chmodSync(path.join(a, 'scripts', 'hooks', 'pre-commit'), 0o755);
    write(a, 'vault/memory.md', '# what this session learned\n');
    const r = autosave(a, ['--json']);
    show('stdout', r.stdout);
    let o = null;
    try { o = JSON.parse(r.stdout); } catch { o = null; }
    ok(o !== null && /commit blocked/.test(o.systemMessage || ''),
      'T9d a commit the gate refuses is surfaced, not reported as a save', o && o.systemMessage);
    ok(!treeHas(a, 'HEAD', 'vault/memory.md'), 'T9d and the page really was not committed');
  }

  // --- Stop: a block decision, and only once per turn ---
  {
    const a = clone('json-stop');
    write(a, 'scripts/secret-scan.mjs', stub);
    write(a, 'vault/leak.md', `# Notes\n\naws key ${marker}${'0123456789ABCDEF'}\n`);
    const r = spawnSync(BASH, [path.join(a, 'scripts', 'autosave.sh'), '--stop', '--json'], {
      cwd: a, encoding: 'utf8', input: '{"session_id":"x","stop_hook_active":false}',
      env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', ALEX_ROUTINE: '' },
    });
    show('stdout', (r.stdout || '').trim());
    let o = null;
    try { o = JSON.parse((r.stdout || '').trim()); } catch { o = null; }
    ok(o !== null && o.decision === 'block' && typeof o.reason === 'string',
      'T9e Stop returns a block decision with a reason', o ? JSON.stringify(o).slice(0, 110) : (r.stdout || '').slice(0, 110));
    ok(r.status === 0, 'T9e and it still exits 0: the JSON decides, never the exit code', `exit ${r.status}`);

    const again = spawnSync(BASH, [path.join(a, 'scripts', 'autosave.sh'), '--stop', '--json'], {
      cwd: a, encoding: 'utf8', input: '{"session_id":"x","stop_hook_active":true}',
      env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', ALEX_ROUTINE: '' },
    });
    ok((again.stdout || '').trim() === '',
      'T9e NEGATIVE stop_hook_active=true blocks nothing, so the hook can never loop',
      (again.stdout || '').trim().slice(0, 80));

    // The harness decides the payload's spacing, not us. A spaced or pretty-printed object is the
    // same JSON, so it must stop the loop too. Before 2026-09-24 the guard was a byte match on the
    // compact form and blocked again on these, which is the loop the guard exists to prevent.
    for (const [label, input] of [
      ['spaced', '{"session_id": "x", "stop_hook_active": true}'],
      ['pretty-printed', ['{', '  "session_id": "x",', '  "stop_hook_active":', '    true', '}'].join(String.fromCharCode(10))],
    ]) {
      const re = spawnSync(BASH, [path.join(a, 'scripts', 'autosave.sh'), '--stop', '--json'], {
        cwd: a, encoding: 'utf8', input,
        env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', ALEX_ROUTINE: '' },
      });
      ok((re.stdout || '').trim() === '',
        `T9e NEGATIVE a ${label} stop_hook_active: true blocks nothing either`,
        (re.stdout || '').trim().slice(0, 80));
    }
    const spacedFalse = spawnSync(BASH, [path.join(a, 'scripts', 'autosave.sh'), '--stop', '--json'], {
      cwd: a, encoding: 'utf8', input: '{"session_id": "x", "stop_hook_active": false}',
      env: { ...process.env, CLAUDE_CODE_REMOTE: 'true', ALEX_ROUTINE: '' },
    });
    let sf = null;
    try { sf = JSON.parse((spacedFalse.stdout || '').trim()); } catch { sf = null; }
    ok(sf !== null && sf.decision === 'block',
      'T9e a spaced stop_hook_active: false still blocks (the tolerance did not swallow the real case)',
      (spacedFalse.stdout || '').trim().slice(0, 80));
  }

  // --- the escaper: every C0 control byte, not only tab, LF and CR ---
  // A gate's last line can carry an ANSI colour (gitleaks prints them) or a control character from
  // a filename. JSON forbids raw C0 bytes inside a string, and Claude Code treats an object that
  // does not parse as plain text, which it ignores: the refusal is invisible again. The leg runs the
  // script's OWN json_escape, lifted out of the file under test, so it cannot drift from it.
  {
    const a = clone('json-escape');
    const C = (n) => String.fromCharCode(n);
    const input = `gate said ${C(27)}[31mBLOCKED${C(27)}[0m bell${C(7)} vt${C(11)} ff${C(12)} us${C(31)}`
      + ` tab${C(9)}lf${C(10)}cr${C(13)} "quoted" back${C(92)}slash`;
    // over stdin, so the bytes reach the function exactly as given, with no command-line quoting
    const r = spawnSync(BASH, ['-c',
      'eval "$(sed -n \'/^json_escape() {/,/^}/p\' scripts/autosave.sh)"; x="$(cat)"; printf \'{"m":"%s"}\' "$(json_escape "$x")"'],
      { cwd: a, encoding: 'utf8', input });
    let o = null;
    let err = '';
    try { o = JSON.parse(r.stdout || ''); } catch (e) { err = e.message; }
    ok(o !== null, 'T9g NEGATIVE an ANSI colour and other C0 bytes still yield a message that parses as JSON',
      o ? JSON.stringify(o.m).slice(0, 90) : `INVALID JSON: ${err}`);
    ok(o !== null && !/[\u0000-\u001f]/.test(o.m) && /BLOCKED/.test(o.m) && o.m.includes(`"quoted" back${C(92)}slash`),
      'T9g and the readable text survives, quote and backslash intact, no control byte left',
      o ? o.m.slice(0, 90) : '');
  }

  // --- DRIFT: the shipped settings must actually pass the flag ---
  {
    const settingsPath = onlineSettings();
    const cfg = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (group) => (cfg.hooks[group] || []).flatMap((m) => (m.hooks || []).map((h) => h.command || ''));
    const post = cmds('PostToolUse').filter((c) => /autosave\.sh/.test(c));
    const stop = cmds('Stop').filter((c) => /autosave\.sh/.test(c));
    ok(post.length === 1 && /--json/.test(post[0]) && !/--stop/.test(post[0]),
      'T9f the shipped PostToolUse hook passes --json', post[0] || 'no autosave hook found');
    ok(stop.length === 1 && /--stop/.test(stop[0]) && /--json/.test(stop[0]),
      'T9f the shipped Stop hook passes --stop --json', stop[0] || 'no autosave hook found');
  }
}

// ---------------------------------------------------------------- T10: the version floor
// Every refusal above reaches the model through a hook's systemMessage or a Stop block, and Claude
// Code honours systemMessage only from 2.1.227 (fleet RUN-STATE 21:55, review finding F14). On an
// older CLI the refusal is invisible again and looks exactly like a working guard. The cloud VM's CLI
// is not ours to pin, so the session says so on its first screen. FAIL-OPEN: the check never blocks,
// never errors, and an unreadable version is said, never taken as healthy.
{
  const tree = TREE || KIT;
  const probe = path.join(tree, 'scripts', 'lib', 'cli-version.js');
  const binDir = path.join(TMP, 'fake-bin');
  fs.mkdirSync(binDir, { recursive: true });
  const fakeClaude = (body) => {
    if (process.platform === 'win32') fs.writeFileSync(path.join(binDir, 'claude.cmd'), `@echo off\r\n${body.win}\r\n`);
    else { fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\n${body.sh}\n`); fs.chmodSync(path.join(binDir, 'claude'), 0o755); }
  };
  const runProbe = (pathVar, extra = {}) => spawnSync(process.execPath, [probe, ...(extra.args || [])], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, PATH: pathVar, Path: pathVar, ALEX_CLI_VERSION_TIMEOUT_MS: '1500', ...(extra.env || {}) },
  });
  const withFake = `${binDir}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;

  const settings = JSON.parse(fs.readFileSync(onlineSettings(), 'utf8'));
  const start = (settings.hooks.SessionStart || []).flatMap((m) => (m.hooks || []).map((h) => h.command || '')).join(' ');
  ok(/scripts\/lib\/cli-version\.js/.test(start), 'T10a NEGATIVE the shipped SessionStart hook checks the Claude Code version',
    /cli-version/.test(start) ? 'present' : 'ABSENT from the online SessionStart hook');

  fakeClaude({ win: 'echo 2.1.100 (Claude Code)', sh: 'echo "2.1.100 (Claude Code)"' });
  const old = runProbe(withFake);
  ok(old.status === 0 && /---CLI-OLD--- Claude Code 2\.1\.100 is older than 2\.1\.227/.test(old.stdout),
    'T10b NEGATIVE an older CLI prints the CLI-OLD line, and exits 0', `exit ${old.status}: ${(old.stdout || old.stderr || '').trim().slice(0, 110)}`);

  for (const v of ['2.1.227', '2.1.259', '3.0.1']) {
    fakeClaude({ win: `echo ${v} (Claude Code)`, sh: `echo "${v} (Claude Code)"` });
    const cur = runProbe(withFake);
    ok(cur.status === 0 && cur.stdout.trim() === '', `T10c a CLI at ${v} prints nothing (a healthy line would be noise)`, `exit ${cur.status}: "${cur.stdout.trim().slice(0, 80)}"`);
  }

  fakeClaude({ win: 'echo not a version', sh: 'echo "not a version"' });
  const junk = runProbe(withFake);
  ok(junk.status === 0 && /---CLI-UNKNOWN---/.test(junk.stdout), 'T10d an unreadable version is said (CLI-UNKNOWN), never taken as healthy', junk.stdout.trim().slice(0, 90));

  // exec, so the sleep IS the process spawnSync kills: a forked grandchild would hold the pipe open past
  // the kill, which is a property of the stub, not of the probe
  fakeClaude({ win: 'ping -n 30 127.0.0.1 >nul', sh: 'exec sleep 30' });
  const t0 = Date.now();
  const hung = runProbe(withFake);
  ok(hung.status === 0 && /---CLI-UNKNOWN---/.test(hung.stdout) && Date.now() - t0 < 15000,
    'T10e a CLI that hangs is cut off: CLI-UNKNOWN, exit 0, well inside the hook budget', `${Date.now() - t0} ms, exit ${hung.status}`);

  const empty = path.join(TMP, 'empty-bin');
  fs.mkdirSync(empty, { recursive: true });
  const none = runProbe(empty);
  ok(none.status === 0 && /---CLI-UNKNOWN---/.test(none.stdout), 'T10f claude not on PATH: CLI-UNKNOWN and exit 0, never an error',
    `exit ${none.status}: ${(none.stdout + none.stderr).trim().slice(0, 90)}`);

  fakeClaude({ win: 'echo 2.1.259 (Claude Code)', sh: 'echo "2.1.259 (Claude Code)"' });
  const show = runProbe(withFake, { args: ['--show'] });
  ok(show.status === 0 && /claude --version: 2\.1\.259 \(Claude Code\)/.test(show.stdout) && /at or above 2\.1\.227/.test(show.stdout),
    'T10g --show prints the raw version and the verdict, for a person or a test reading it on the VM', show.stdout.trim().slice(0, 110));
}

// ---------------------------------------------------------------- verdict
console.log('');
if (KEEP) console.log(`kept: ${TMP}`);
else fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
if (failures === 0) {
  console.log('test-autosave: ALL PASS');
  process.exit(0);
} else {
  console.log(`test-autosave: ${failures} FAILURE(S)`);
  process.exit(1);
}
