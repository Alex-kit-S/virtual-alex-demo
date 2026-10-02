#!/usr/bin/env node
// scripts/tests/test-close-out-online.mjs - characterization of scripts/close-out-online.sh, the last
// command of four Routines and of every interactive session's Close-Out online.
//
// WHAT. Pins the flag set, the six step lines in order, the verdict line a Routine prompt quotes ("Quote
// its last line"), the exit codes 0/1/2, and the remaining defects as they behave today. Deleted, it would
// let a change reorder the steps, lose a step's line, swallow a flag slip's save, reword a lesson's
// none-screen, or fix a pinned defect silently, with nothing else in CI noticing.
//
// HOW. Each case runs the REAL script and its REAL children (status-rotate, outputs-ledger, run-log,
// lessons.js, autosave.sh) copied into a throwaway git repository whose origin is a bare repository in the
// same temp folder. Git runs with no system or global config. A test named "PINNED DEFECT <id>" asserts
// behaviour known to be wrong; the fix flips exactly that assertion.
//
// NEVER. Touches the checkout: every tree lives in one temp folder this file removes at the end. Reaches
// the network, or depends on the clock beyond the shape of `at`. Flips a PINNED DEFECT assertion on its
// own: each pins today's behaviour, and only a FIX row in the ratchet flips one. CO-D2: a file the autosave
// REFUSED still yields "COMPLETE, every step ok". CO-D4: an unknown lesson class is written as process.
// CO-D6: outside a cloud session it still writes the run-log row and creates outputs/ and vault/.
//
// Usage: node scripts/tests/test-close-out-online.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findBash } from './fixtures/find-bash.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-closeout-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

const BASH = findBash();

const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  CLAUDE_CODE_REMOTE: '',
  ALEX_ROUTINE: '',
  ALEX_UNTRUSTED_LANE: ''
};
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return (r.stdout || '').trim();
};

const FILES = [
  'scripts/close-out-online.sh',
  'scripts/status-rotate.js',
  'scripts/lib/write-lock.js',
  'scripts/outputs-ledger.js',
  'scripts/run-log.mjs',
  'scripts/lib/json-writer.js',
  'scripts/lib/run-log-read.js',
  'scripts/lib/args.js',
  'scripts/lib/errors.js',
  'scripts/lib/exit-codes.js',
  'system/recall/lib/lessons.js',
  'scripts/autosave.sh',
  'scripts/untrusted-lane-guard.js',
  'system/manifest.json',
  '.gitattributes'
];
// the online .gitignore: under variants/online/ in the Kit, at the root of the online tree
const ONLINE_GITIGNORE = [path.join(KIT, 'variants', 'online', '.gitignore'), path.join(KIT, '.gitignore')].find((p) =>
  fs.existsSync(p)
);

let n = 0;
function repo({ remote = true } = {}) {
  const dir = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main', '.']);
  for (const rel of FILES) {
    const d = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), d);
  }
  fs.copyFileSync(ONLINE_GITIGNORE, path.join(dir, '.gitignore'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'seed']);
  if (remote) {
    const bare = path.join(TMP, `origin-${n}.git`);
    git(TMP, ['init', '-q', '--bare', '-b', 'main', bare]);
    git(dir, ['remote', 'add', 'origin', bare]);
    git(dir, ['push', '-q', 'origin', 'main']);
  }
  return dir;
}
function closeOut(dir, args, env = {}) {
  const r = spawnSync(BASH, [path.join(dir, 'scripts', 'close-out-online.sh'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...ENV, ...env },
    timeout: 180000
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const lines = (s) => s.split('\n').filter((l) => l.length);
const lastLine = (s) => lines(s).pop();
const CLOUD = { CLAUDE_CODE_REMOTE: 'true' };
const SHA = /[0-9a-f]{7,12}/g;

test('outside a cloud session: six step lines in order, the save is the one FAIL, INCOMPLETE, exit 1', () => {
  const dir = repo();
  const r = closeOut(dir, ['--job', 'session', '--lesson', 'L: none']);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, '');
  const out = lines(r.stdout);
  assert.equal(out.length, 7, r.stdout);
  assert.match(
    out[0],
    /^close-out: ok {3}status-rotate: status-rotate: 0 block\(s\) moved across 0 status file\(s\), budget \d+ B$/
  );
  assert.equal(
    out[1],
    'close-out: ok   ledger reconcile: reconcile: 0 row(s) added, 0 total. INDEX.md + vault/outputs-index.md rendered.'
  );
  assert.equal(out[2], 'close-out: ok   ledger render: 0 rows.');
  assert.equal(out[3], 'close-out: ok   lesson: L: none, no row written');
  assert.match(
    out[4],
    /^close-out: ok {3}run-log: appended \{"at":"[0-9T:-]+Z","canary":null,"job":"session","missed":null,"model":null,"reason":null,"repo":null,"session_url":null,"sha":null,"status":"COMPLETE"\}$/
  );
  assert.equal(
    out[5],
    'close-out: FAIL autosave: skipped (CLAUDE_CODE_REMOTE is not true; this save runs only in a cloud session)'
  );
  assert.equal(
    out[6],
    'close-out: INCOMPLETE for session, 1 step(s) failed: autosave (the save ran last; see the lines above)'
  );
});

test('PINNED DEFECT CO-D6: outside a cloud session it still writes the run-log row and creates outputs/ and vault/', () => {
  const dir = repo();
  closeOut(dir, ['--job', 'session', '--lesson', 'L: none']);
  assert.equal(fs.existsSync(path.join(dir, 'system', 'run-log.jsonl')), true);
  assert.equal(fs.existsSync(path.join(dir, 'outputs')), true);
  assert.equal(fs.existsSync(path.join(dir, 'vault')), true);
});

test('in a cloud session on main with a reachable origin: COMPLETE, exit 0, the run-log row committed, pushed and read back', () => {
  const dir = repo();
  const r = closeOut(
    dir,
    [
      '--job',
      'triage',
      '--status',
      'COMPLETE',
      '--canary',
      'ok',
      '--missed',
      '0',
      '--model',
      'claude-sonnet-4-6',
      '--lesson',
      'L: none'
    ],
    CLOUD
  );
  assert.equal(r.code, 0, r.stdout);
  const out = lines(r.stdout);
  assert.equal(out.length, 7);
  assert.match(
    out[4],
    /^close-out: ok {3}run-log: appended \{.*"canary":"ok","job":"triage","missed":0,"model":"claude-sonnet-4-6",.*"status":"COMPLETE"\}$/
  );
  assert.equal(
    out[5].replace(SHA, '<sha>'),
    'close-out: ok   autosave: committed <sha>; main at <sha> pushed to origin/main and read back'
  );
  assert.equal(out[6], 'close-out: COMPLETE for triage, every step ok');
  assert.equal(git(dir, ['rev-parse', 'HEAD']), git(dir, ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0]);
  assert.match(git(dir, ['show', '--name-only', '--format=', 'HEAD']), /system\/run-log\.jsonl/);
  assert.equal(git(dir, ['status', '--porcelain']), '');
});

test('the forwarded flags land in the run-log row; a bad value fails the run-log step and the save still runs last', () => {
  const dir = repo();
  const r = closeOut(
    dir,
    [
      '--job',
      'brief',
      '--status',
      'PARTIAL',
      '--reason',
      'calendar connector missing',
      '--canary',
      'missing',
      '--missed',
      '2',
      '--model',
      'claude-sonnet-4-6',
      '--session-url',
      'https://claude.ai/code/s1',
      '--lesson',
      'L: none'
    ],
    CLOUD
  );
  assert.equal(r.code, 0);
  const row = JSON.parse(/appended (\{.*\})$/m.exec(r.stdout)[1]);
  assert.deepEqual(
    { ...row, at: '<at>' },
    {
      at: '<at>',
      canary: 'missing',
      job: 'brief',
      missed: 2,
      model: 'claude-sonnet-4-6',
      reason: 'calendar connector missing',
      repo: null,
      session_url: 'https://claude.ai/code/s1',
      sha: null,
      status: 'PARTIAL'
    }
  );

  const bad = closeOut(dir, ['--job', 'brief', '--status', 'GREEN', '--lesson', 'L: none'], CLOUD);
  assert.equal(bad.code, 1);
  const out = lines(bad.stdout);
  assert.equal(
    out[4],
    'close-out: FAIL run-log exit 2: run-log: REFUSED - --status must be one of COMPLETE | PARTIAL | BLOCKED | SKIPPED | RED (got "GREEN")'
  );
  assert.match(out[5], /^close-out: ok {3}autosave: /, 'the save ran after the failed step');
  assert.equal(
    out[6],
    'close-out: INCOMPLETE for brief, 1 step(s) failed: run-log (the save ran last; see the lines above)'
  );
});

test('end to end, a --reason value that starts with -- reaches run-log.mjs as one piece and lands in the row, COMPLETE', () => {
  const dir = repo();
  const r = closeOut(
    dir,
    ['--job', 'triage', '--status', 'COMPLETE', '--reason', '--dry-run was used', '--lesson', 'L: none'],
    CLOUD
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for triage, every step ok');
  const row = JSON.parse(/appended (\{.*\})$/m.exec(r.stdout)[1]);
  assert.equal(
    row.reason,
    '--dry-run was used',
    'close-out-online.sh did not mistake the dash-led value for a missing one'
  );
  const rows = fs
    .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(
    rows[rows.length - 1].reason,
    '--dry-run was used',
    'and it is really in the file, not only in the printed line'
  );
});

test('end to end, --model with no value still reports COMPLETE, and the saved row shows model: null, not the value silently swallowed from somewhere else', () => {
  const dir = repo();
  const r = closeOut(
    dir,
    ['--job', 'triage', '--status', 'COMPLETE', '--canary', 'ok', '--model', '--lesson', 'L: none'],
    CLOUD
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for triage, every step ok');
  const row = JSON.parse(/appended (\{.*\})$/m.exec(r.stdout)[1]);
  assert.deepEqual(
    { ...row, at: '<at>' },
    {
      at: '<at>',
      canary: 'ok',
      job: 'triage',
      missed: null,
      model: null,
      reason: null,
      repo: null,
      session_url: null,
      sha: null,
      status: 'COMPLETE'
    }
  );
  const rows = fs
    .readFileSync(path.join(dir, 'system', 'run-log.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(rows[rows.length - 1].model, null, 'the file agrees with the printed row');
});

test('a failed or deferred status rotation never stops the steps after it', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.alex-lock-alex-surfaces'));
  fs.writeFileSync(
    path.join(dir, '.alex-lock-alex-surfaces', 'holder.json'),
    JSON.stringify({ label: 'fixture', pid: 1, since: '2026-01-01T00:00:00.000Z' })
  );
  const deferred = closeOut(dir, ['--job', 'session', '--lesson', 'L: none'], CLOUD);
  assert.equal(
    lines(deferred.stdout)[0],
    'close-out: ok   status-rotate deferred (another writer holds the lock): status-rotate: deferred - held by fixture (pid 1) since 2026-01-01T00:00:00.000Z'
  );
  assert.equal(deferred.code, 0);
  fs.rmSync(path.join(dir, '.alex-lock-alex-surfaces'), { recursive: true, force: true });

  fs.rmSync(path.join(dir, 'scripts', 'status-rotate.js'));
  const failed = closeOut(dir, ['--job', 'session', '--lesson', 'L: none'], CLOUD);
  const out = lines(failed.stdout);
  assert.match(out[0], /^close-out: FAIL status-rotate exit 1: /);
  assert.equal(out.length, 7, 'every later step still reports');
  assert.equal(
    out[6],
    'close-out: INCOMPLETE for session, 1 step(s) failed: status-rotate (the save ran last; see the lines above)'
  );
  assert.equal(failed.code, 1);
});

test('the lesson step: none given, a parseable L-line appends one canonical row, an unparseable one fails the step', () => {
  const dir = repo();
  const none = closeOut(dir, ['--job', 'session']);
  assert.equal(
    lines(none.stdout)[3],
    'close-out: ok   lesson: none given (pass --lesson "L: none" to say so explicitly)'
  );

  const good = closeOut(
    dir,
    ['--job', 'radar', '--lesson', 'L: class=verification lesson="read the row back" evidence=radar.md:60'],
    CLOUD
  );
  assert.equal(good.code, 0, good.stdout);
  const file = path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl');
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(rows.length, 1);
  const row = JSON.parse(rows[0]);
  assert.deepEqual(Object.keys(row), ['at', 'class', 'evidence', 'job', 'lesson']);
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(
    { ...row, at: '<at>' },
    { at: '<at>', class: 'verification', evidence: 'radar.md:60', job: 'radar', lesson: 'read the row back' }
  );
  assert.equal(lines(good.stdout)[3], `close-out: ok   lesson: appended ${rows[0]}`);
  assert.match(
    git(dir, ['show', '--name-only', '--format=', 'HEAD']),
    /vault\/projects\/self-review\/lessons\.jsonl/,
    'the lesson rides the save'
  );

  const bad = closeOut(dir, ['--job', 'radar', '--lesson', 'a lesson with no shape'], CLOUD);
  assert.equal(bad.code, 1);
  assert.equal(
    lines(bad.stdout)[3],
    'close-out: FAIL lesson exit 2: the L-line did not parse; expected: L: class=<propagation|verification|cost|security|process> lesson="<one sentence>" evidence=<file:line or runid>'
  );
  assert.equal(
    lines(bad.stdout)[6],
    'close-out: INCOMPLETE for radar, 1 step(s) failed: lesson (the save ran last; see the lines above)'
  );
  assert.equal(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1, 'no row for the unparseable line');
});

test('a real lesson whose own text mentions "L: none", or "-l none", is appended, never dropped as none; an exact "L: none" line (any case, whitespace trimmed) still writes nothing', () => {
  const dir = repo();
  const { parseLLine } = createRequire(import.meta.url)(path.join(dir, 'system', 'recall', 'lib', 'lessons.js'));
  const cases = [
    [
      'L: class=process lesson="a run that prints L: none still owes its row" evidence=brief.md:82',
      { class: 'process', evidence: 'brief.md:82', lesson: 'a run that prints L: none still owes its row' }
    ],
    [
      'L: class=process lesson="Use -l nonetheless in the grep" evidence=x',
      { class: 'process', evidence: 'x', lesson: 'Use -l nonetheless in the grep' }
    ]
  ];
  for (const [lesson] of cases) {
    assert.notEqual(parseLLine(lesson), null, 'the parser reads it as a real lesson');
    const r = closeOut(dir, ['--job', 'radar', '--lesson', lesson], CLOUD);
    assert.equal(r.code, 0, lesson);
    assert.match(lines(r.stdout)[3], /^close-out: ok {3}lesson: appended \{.*\}$/, lesson);
  }
  const rows = fs
    .readFileSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(
    rows.length,
    cases.length,
    'both mentions of the phrase were appended as real lessons, never screened out'
  );
  for (const [i, [, expected]] of cases.entries())
    assert.deepEqual({ ...rows[i], at: '<at>' }, { at: '<at>', job: 'radar', ...expected });
  // the screen itself still works: an EXACT "L: none" line, any case, whitespace padded, still writes nothing
  for (const none of ['L: none', 'l: none', '  L: NONE  ']) {
    const before = fs.readFileSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl'), 'utf8');
    const r = closeOut(dir, ['--job', 'radar', '--lesson', none], CLOUD);
    assert.equal(lines(r.stdout)[3], 'close-out: ok   lesson: L: none, no row written', none);
    assert.equal(
      fs.readFileSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl'), 'utf8'),
      before,
      'no new row for an exact none'
    );
  }
});

test('the none-screen also reads no colon, no space, trailing punctuation, a trailing dash-led comment, and a lessons that opens on "L: none" and carries a second line, as none - not a failed unparseable step', () => {
  const dir = repo();
  const shapes = ['L:none', 'L none', 'L: none.', 'L: none - nothing new', 'L: none\nsecond line, ignored'];
  for (const lesson of shapes) {
    const r = closeOut(dir, ['--job', 'radar', '--lesson', lesson], CLOUD);
    assert.equal(r.code, 0, JSON.stringify(lesson));
    assert.equal(lines(r.stdout)[3], 'close-out: ok   lesson: L: none, no row written', JSON.stringify(lesson));
    assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for radar, every step ok', JSON.stringify(lesson));
  }
  assert.equal(
    fs.existsSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl')),
    false,
    'none of the shapes above ever wrote a lesson row'
  );
  // A real lesson that merely mentions one of the none shapes in its own text is never screened, because it carries class=.
  const real = 'L: class=process lesson="the fix restored L: none - nothing new as a screened shape" evidence=x';
  const r = closeOut(dir, ['--job', 'radar', '--lesson', real], CLOUD);
  assert.equal(r.code, 0, r.stdout);
  assert.match(lines(r.stdout)[3], /^close-out: ok {3}lesson: appended \{.*\}$/);
  assert.equal(
    fs
      .readFileSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl'), 'utf8')
      .trim()
      .split('\n').length,
    1
  );
});

test('PINNED DEFECT CO-D4: an unknown lesson class is written as process', () => {
  const dir = repo();
  closeOut(dir, ['--job', 'radar', '--lesson', 'L: class=weird lesson="an odd class" evidence=x']);
  const row = JSON.parse(fs.readFileSync(path.join(dir, 'vault', 'projects', 'self-review', 'lessons.jsonl'), 'utf8'));
  assert.equal(row.class, 'process');
});

test('PINNED DEFECT CO-D2: a file the autosave refused still yields COMPLETE, exit 0, and the file is left unsaved', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, 'vault'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'vault', 'big-note.md'), Buffer.alloc(10485761, 0x41));
  const r = closeOut(dir, ['--job', 'session', '--lesson', 'L: none'], CLOUD);
  const out = lines(r.stdout);
  assert.equal(
    out[5].replace(SHA, '<sha>'),
    'close-out: ok   autosave: committed <sha>; main at <sha> pushed to origin/main and read back; refused 1: vault/big-note.md'
  );
  assert.equal(out[6], 'close-out: COMPLETE for session, every step ok');
  assert.equal(r.code, 0);
  assert.equal(git(dir, ['status', '--porcelain', '--', 'vault/big-note.md']), '?? vault/big-note.md');
});

test('a save that ended off main is a failed step (save-off-main)', () => {
  const dir = repo();
  git(dir, ['checkout', '-q', '-b', 'claude/session-x']);
  const r = closeOut(dir, ['--job', 'session', '--lesson', 'L: none'], CLOUD);
  assert.equal(r.code, 1);
  const out = lines(r.stdout);
  assert.match(out[5], /^close-out: FAIL autosave: OFF-MAIN on claude\/session-x, not main /);
  assert.equal(
    out[6],
    'close-out: INCOMPLETE for session, 1 step(s) failed: save-off-main (the save ran last; see the lines above)'
  );
});

test('refusals exit 2 before any step: no --job, not inside a git repository', () => {
  const dir = repo();
  const r = closeOut(dir, ['--status', 'COMPLETE'], CLOUD);
  assert.deepEqual(r, {
    code: 2,
    stdout: '',
    stderr: 'close-out: REFUSED - --job <name> is required (a session passes session; a Routine its own name)\n'
  });
  assert.equal(fs.existsSync(path.join(dir, 'system', 'run-log.jsonl')), false, 'a refusal writes nothing');
  const outside = fs.mkdtempSync(path.join(TMP, 'not-a-repo-'));
  const r2 = spawnSync(BASH, [path.join(dir, 'scripts', 'close-out-online.sh'), '--job', 'x'], {
    cwd: outside,
    encoding: 'utf8',
    env: ENV
  });
  assert.equal(r2.status, 2);
  assert.equal(r2.stdout, '');
  assert.equal(r2.stderr, 'close-out: REFUSED - not inside a git repository\n');
});

test('an unknown flag warns, is dropped with the bare word right after it when there is one, and the close-out still saves and reports COMPLETE', () => {
  const dir = repo();
  const withValue = closeOut(
    dir,
    ['--job', 'triage', '--status', 'COMPLETE', '--lesson', 'L: none', '--foo', 'bar'],
    CLOUD
  );
  assert.equal(withValue.code, 0, withValue.stdout);
  assert.equal(withValue.stderr, 'close-out: WARNING - ignored --foo bar: unknown flag --foo\n');
  assert.equal(lastLine(withValue.stdout), 'close-out: COMPLETE for triage, every step ok');

  const alone = closeOut(dir, ['--job', 'triage', '--status', 'COMPLETE', '--lesson', 'L: none', '--bogus'], CLOUD);
  assert.equal(alone.code, 0, alone.stdout);
  assert.equal(alone.stderr, 'close-out: WARNING - ignored --bogus: unknown flag --bogus\n');
  assert.equal(lastLine(alone.stdout), 'close-out: COMPLETE for triage, every step ok');
});

test("the brief Routine's own close-out line, plus an appended --foo bar, still saves and reports COMPLETE", () => {
  const dir = repo();
  const r = closeOut(
    dir,
    [
      '--job',
      'brief',
      '--status',
      'COMPLETE',
      '--canary',
      'ok',
      '--missed',
      '0',
      '--model',
      'claude-sonnet-4-6',
      '--lesson',
      'L: none',
      '--foo',
      'bar'
    ],
    CLOUD
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.stderr, 'close-out: WARNING - ignored --foo bar: unknown flag --foo\n');
  assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for brief, every step ok');
  assert.equal(git(dir, ['status', '--porcelain']), '');
});

test('--repo and --sha forward to run-log.mjs like the other five flags, instead of refusing', () => {
  const dir = repo();
  const sha = '0'.repeat(40);
  const r = closeOut(
    dir,
    ['--job', 'snapshot', '--status', 'COMPLETE', '--repo', 'o/n', '--sha', sha, '--lesson', 'L: none'],
    CLOUD
  );
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.stderr, '');
  const row = JSON.parse(/appended (\{.*\})$/m.exec(r.stdout)[1]);
  assert.equal(row.repo, 'o/n');
  assert.equal(row.sha, sha);
  assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for snapshot, every step ok');
});

test('--job and --status refuse fast, no hang, whether they are the last argument or their value is a deleted placeholder; every other value-taking flag warns, drops, and the close-out still saves', () => {
  const dir = repo();
  const fast = [
    [['--job'], 'close-out: REFUSED - --job needs a value\n'],
    [['--job', 'x', '--status'], 'close-out: REFUSED - --status needs a value\n'],
    [['--status', 'COMPLETE', '--job'], 'close-out: REFUSED - --job needs a value\n'],
    [['--job', 'x', '--status', '--canary', 'ok'], 'close-out: REFUSED - --status needs a value\n'],
    [['--job', '--status', 'COMPLETE'], 'close-out: REFUSED - --job needs a value\n']
  ];
  for (const [args, stderr] of fast) {
    const r = closeOut(dir, args, CLOUD);
    assert.deepEqual(r, { code: 2, stdout: '', stderr }, args.join(' '));
  }
  assert.equal(
    fs.existsSync(path.join(dir, 'system', 'run-log.jsonl')),
    false,
    'none of the refusals above wrote a row'
  );

  const dangling = [
    ['--job', 'x', '--lesson'],
    ['--job', 'x', '--reason'],
    ['--job', 'x', '--canary'],
    ['--job', 'triage', '--status', 'COMPLETE', '--model'],
    ['--job', 'x', '--missed'],
    ['--job', 'x', '--session-url'],
    ['--job', 'x', '--repo'],
    ['--job', 'x', '--sha']
  ];
  for (const args of dangling) {
    const r = closeOut(dir, args, CLOUD);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stdout}`);
    assert.match(r.stderr, /^close-out: WARNING - ignored --\S+: no value given\n$/, args.join(' '));
    assert.match(lastLine(r.stdout), /^close-out: COMPLETE for /, args.join(' '));
  }
  assert.equal(
    fs.existsSync(path.join(dir, 'system', 'run-log.jsonl')),
    true,
    'the dangling-flag runs above all saved a row'
  );
});

test('--status is recognised as a deleted placeholder for a FORWARDED flag too, not just --lesson and --model - --reason immediately followed by --status still warns and drops, and --status is read fresh on its own next turn', () => {
  const dir = repo();
  const r = closeOut(dir, ['--job', 'brief', '--reason', '--status', 'PARTIAL', '--lesson', 'L: none'], CLOUD);
  assert.equal(r.code, 0, r.stdout);
  assert.equal(
    r.stderr,
    'close-out: WARNING - ignored --reason: no value given (the next argument, --status, is a flag)\n'
  );
  const row = JSON.parse(/appended (\{.*\})$/m.exec(r.stdout)[1]);
  assert.deepEqual(
    [row.status, row.reason],
    ['PARTIAL', null],
    "--status was never swallowed as --reason's literal value"
  );
  assert.equal(lastLine(r.stdout), 'close-out: COMPLETE for brief, every step ok');
});
