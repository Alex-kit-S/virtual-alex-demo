#!/usr/bin/env node
// @ts-check
// scripts/tests/test-heartbeat-paths.mjs - the heartbeat check's edges, and its known defects as they are.
//
// WHAT. Characterizes scripts/heartbeat-check.mjs beyond test-heartbeat-check.mjs: the no-argument call
// the heartbeat workflow makes, --file resolved against the repository root and never CLAUDE_PROJECT_DIR,
// the inclusive window edge, the refusals, which stream each line goes to, how blank, CRLF and unparseable
// lines are passed over, that only an object with a string at counts as a row, and every defect known in
// it, pinned as it behaves today. A test named PINNED DEFECT <id> asserts behaviour known to be wrong;
// its fix flips exactly that assertion, and the defect ledger lists it. Deleted, it would let a rewrite
// move a default, a stream or an edge, let a null row crash the alarm or another project's log pass it,
// or quietly fix or worsen a defect, with every other test green.
//
// HOW. Runs the script as a child against fixtures in a temp folder. Time is pinned through --now, the
// argument the script already reads; the one no-argument case writes a row one hour before the real
// clock. The cases that need the script's own defaults or its own root run a copy of it, beside the
// libraries it imports, in a temp tree.
//
// NEVER. Writes outside its temp folder, which it removes at the end, or reaches the network. Flips a
// PINNED DEFECT assertion on its own: each pins today's behaviour, and only a FIX row in the ratchet
// flips one. HB-D1: a sweep row, or any job but session, keeps the heartbeat alive while every Routine
// is dead. HB-D2: at is compared as a string, so a malformed at masks a fresh row and a future at
// passes for ever. HB-D3 and HB-D4 are FIXED (scripts/lib/args.js on the operator edge): --file with no
// value and an unknown flag each refuse, exit 2, in this file's own words, never a Node stack and never a
// silent default. HB-D5: the remedy text says "two days" whatever --max-hours is. HB-D6: a row
// whose job is not a string counts as a Routine row.
//
// Usage: node scripts/tests/test-heartbeat-paths.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(KIT, 'scripts', 'heartbeat-check.mjs');
// The script and the libraries it imports, which a copy of the script needs beside it to run.
const CLI_FILES = [
  'scripts/heartbeat-check.mjs',
  'scripts/lib/repo-root.js',
  'scripts/lib/run-log-read.js',
  'scripts/lib/args.js',
  'scripts/lib/errors.js',
  'scripts/lib/exit-codes.js'
];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-hb-paths-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

const NOW = '2026-09-23T07:00:00Z';
/**
 * @param {string} at
 * @param {string} [job]
 */
const row = (at, job = 'triage') =>
  JSON.stringify({ at, canary: 'ok', job, missed: 0, model: null, reason: null, status: 'COMPLETE' });
let n = 0;
/**
 * @param {string[]} lines
 * @param {string} [eol]
 */
const fileWith = (lines, eol = '\n') => {
  const f = path.join(TMP, `rows-${++n}.jsonl`);
  fs.writeFileSync(f, lines.join(eol) + eol);
  return f;
};
/**
 * @param {string[]} args
 * @param {{ script?: string, cwd?: string }} [opts]
 */
const run = (args, opts = {}) => {
  const r = spawnSync(process.execPath, [opts.script || SCRIPT, ...args], { encoding: 'utf8', cwd: opts.cwd || TMP });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
/**
 * @param {string} file
 * @param {string[]} [extra]
 */
const check = (file, extra = []) => run(['--file', file, '--now', NOW, ...extra]);
/**
 * Copies the script and its libraries into `tree`, each at its place in the Kit.
 * @param {string} tree
 * @returns {string} the copied script
 */
function copyCli(tree) {
  for (const rel of CLI_FILES) {
    const to = path.join(tree, ...rel.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), to);
  }
  return path.join(tree, 'scripts', 'heartbeat-check.mjs');
}

test('the workflow call: no arguments reads system/run-log.jsonl beside the script, whatever the cwd', () => {
  // the heartbeat workflow runs exactly `node scripts/heartbeat-check.mjs`, so the default path and
  // the default window are the whole contract of that call
  const tree = path.join(TMP, 'tree');
  const script = copyCli(tree);
  const elsewhere = fs.mkdtempSync(path.join(TMP, 'cwd-'));

  const absent = run([], { script, cwd: elsewhere });
  assert.equal(absent.code, 1);
  assert.equal(
    absent.stdout,
    'heartbeat: FAIL - system/run-log.jsonl is absent: no Routine has ever written a row on this branch\n'
  );
  assert.equal(absent.stderr, '');

  fs.mkdirSync(path.join(tree, 'system'));
  const at = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(path.join(tree, 'system', 'run-log.jsonl'), row(at) + '\n');
  const fresh = run([], { script, cwd: elsewhere });
  assert.equal(fresh.code, 0);
  assert.equal(
    fresh.stdout,
    `heartbeat: OK - the newest run-log row is 1 hour(s) old (job triage, at ${at}), inside the 48-hour window\n`
  );
});

test('--file is resolved against the repository root, not the cwd, and the message path uses forward slashes', () => {
  const tree = path.join(TMP, 'tree2');
  const script = copyCli(tree);
  fs.mkdirSync(path.join(tree, 'system', 'nested'), { recursive: true });
  const r = run(['--file', 'system/nested/missing.jsonl', '--now', NOW], { script, cwd: os.tmpdir() });
  assert.equal(r.code, 1);
  assert.equal(
    r.stdout,
    'heartbeat: FAIL - system/nested/missing.jsonl is absent: no Routine has ever written a row on this branch\n'
  );
  fs.writeFileSync(path.join(tree, 'system', 'nested', 'rows.jsonl'), row('2026-09-23T06:00:00Z') + '\n');
  const ok = run(['--file', 'system/nested/rows.jsonl', '--now', NOW], { script, cwd: os.tmpdir() });
  assert.equal(ok.code, 0);
  assert.match(
    ok.stdout,
    /^heartbeat: OK - the newest run-log row is 1 hour\(s\) old \(job triage, at 2026-09-23T06:00:00Z\)/
  );
});

test('the window is inclusive: exactly 48 hours is OK, one second more is FAIL (and still reads "48 hour(s) old")', () => {
  const at48 = check(fileWith([row('2026-09-21T07:00:00Z')]));
  assert.equal(at48.code, 0);
  assert.equal(
    at48.stdout,
    'heartbeat: OK - the newest run-log row is 48 hour(s) old (job triage, at 2026-09-21T07:00:00Z), inside the 48-hour window\n'
  );
  const over = check(fileWith([row('2026-09-21T06:59:59Z')]));
  assert.equal(over.code, 1);
  assert.equal(
    over.stdout,
    'heartbeat: FAIL - the newest run-log row is 48 hour(s) old (job triage, at 2026-09-21T06:59:59Z), over the 48-hour window: no Routine has written for two days. Open claude.ai/code/routines and check they are on, the GitHub connection holds, and the subscription is not paused.\n'
  );
  assert.equal(over.stderr, '', 'a FAIL goes to stdout, where the workflow log shows it; stderr stays empty');
});

test('a tie on at goes to the later line, and blank, CRLF and unparseable lines are skipped silently', () => {
  const f = fileWith(
    [row('2026-09-23T06:00:00Z', 'brief'), '', 'not json', '{"job":"radar"}', row('2026-09-23T06:00:00Z', 'radar')],
    '\r\n'
  );
  const r = check(f);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\(job radar, at 2026-09-23T06:00:00Z\)/);
  assert.equal(r.stderr, '');
});

test('refusals: an invalid --now, a zero or negative --max-hours exit 2 with the REFUSED line on stderr and nothing on stdout', () => {
  const f = fileWith([row('2026-09-23T06:00:00Z')]);
  const refusal = 'heartbeat: REFUSED - --max-hours must be a positive number and --now an ISO date\n';
  for (const extra of [
    ['--now', 'not-a-date'],
    ['--max-hours', '0'],
    ['--max-hours', '-5']
  ]) {
    const r = run(['--file', f, ...(extra[0] === '--now' ? [] : ['--now', NOW]), ...extra]);
    assert.equal(r.code, 2, extra.join(' '));
    assert.equal(r.stdout, '', extra.join(' '));
    assert.equal(r.stderr, refusal, extra.join(' '));
  }
});

test('--max-hours moves the window', () => {
  const f = fileWith([row('2026-09-20T07:00:00Z'), row('2026-09-21T06:00:00Z', 'brief')]); // 49 h
  const r = check(f, ['--max-hours', '100']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /49 hour\(s\) old \(job brief, at 2026-09-21T06:00:00Z\), inside the 100-hour window/);
});

test('PINNED DEFECT HB-D1: a fresh sweep row keeps the heartbeat OK while the only Routine row is 72 hours old', () => {
  const r = check(fileWith([row('2026-09-20T07:00:00Z', 'triage'), row('2026-09-23T06:00:00Z', 'sweep')]));
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    'heartbeat: OK - the newest run-log row is 1 hour(s) old (job sweep, at 2026-09-23T06:00:00Z), inside the 48-hour window\n'
  );
});

test('PINNED DEFECT HB-D2: a malformed at masks a fresh valid row (a false FAIL)', () => {
  const r = check(fileWith([row('2026-09-23T06:00:00Z', 'triage'), row('zzz', 'brief')]));
  assert.equal(r.code, 1);
  assert.equal(r.stdout, "heartbeat: FAIL - the newest row's at (zzz) is not a date\n");
});

test('PINNED DEFECT HB-D2: a future at wins and passes for ever, with a negative age', () => {
  const r = check(fileWith([row('2026-09-01T00:00:00Z', 'triage'), row('2099-01-01T00:00:00Z', 'brief')]));
  const hours = Math.round((Date.parse(NOW) - Date.parse('2099-01-01T00:00:00Z')) / 3600000);
  assert.ok(hours < 0);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    `heartbeat: OK - the newest run-log row is ${hours} hour(s) old (job brief, at 2099-01-01T00:00:00Z), inside the 48-hour window\n`
  );
});

test("--file with no value refuses, exit 2, in this file's own words, never a Node stack", () => {
  const r = run(['--now', NOW, '--file']);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, "heartbeat: REFUSED - Option '--file <value>' argument missing\n");
  assert.doesNotMatch(r.stderr, /ERR_INVALID_ARG_TYPE/);
});

test('an unknown flag refuses, exit 2, naming the flag and the flags this command takes', () => {
  const r = check(fileWith([row('2026-09-21T07:00:00Z')]), ['--maxhours', '1']);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, '');
  assert.equal(
    r.stderr,
    'heartbeat: REFUSED - unknown flag --maxhours; this command takes --file, --max-hours, --now\n'
  );
});

test('PINNED DEFECT HB-D5: the remedy text says "two days" whatever the window is', () => {
  const r = check(fileWith([row('2026-09-23T04:00:00Z')]), ['--max-hours', '1']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /over the 1-hour window: no Routine has written for two days\./);
});

test('PINNED DEFECT HB-D6: a row whose job is a number, or has no job, counts as a Routine row', () => {
  const numeric = check(fileWith(['{"at":"2026-09-23T06:00:00Z","job":5}']));
  assert.equal(numeric.code, 0);
  assert.match(numeric.stdout, /\(job 5, at 2026-09-23T06:00:00Z\)/);
  const nojob = check(fileWith(['{"at":"2026-09-23T06:00:00Z"}']));
  assert.equal(nojob.code, 0);
  assert.match(nojob.stdout, /\(job undefined, at 2026-09-23T06:00:00Z\)/);
});

test('only an object with a string at is a row: null, a number, a string, an array and a BOM-led line are passed over', () => {
  // the reader hands back whatever each line parses to, and a line it refuses apart; the heartbeat's own
  // filter decides, reads the line as it stands (a BOM before a fresh row keeps it out), and resolves the
  // default log against its own root, never CLAUDE_PROJECT_DIR, so a decoy project's fresh log changes nothing
  const tree = path.join(TMP, 'tree3');
  const script = copyCli(tree);
  fs.mkdirSync(path.join(tree, 'system'));
  const fresh = '2026-09-23T06:59:00Z';
  const bomFresh = `\uFEFF${row(fresh, 'brief')}`;
  const lines = ['null', '5', JSON.stringify(fresh), '[1]', bomFresh, row('2026-09-21T06:00:00Z')];
  fs.writeFileSync(path.join(tree, 'system', 'run-log.jsonl'), `${lines.join('\n')}\n`);
  const decoy = path.join(TMP, 'decoy');
  fs.mkdirSync(path.join(decoy, 'system'), { recursive: true });
  fs.writeFileSync(path.join(decoy, 'system', 'run-log.jsonl'), `${row(fresh)}\n`);
  const stale = {
    code: 1,
    stdout:
      'heartbeat: FAIL - the newest run-log row is 49 hour(s) old (job triage, at 2026-09-21T06:00:00Z), over the 48-hour window: no Routine has written for two days. Open claude.ai/code/routines and check they are on, the GitHub connection holds, and the subscription is not paused.\n',
    stderr: ''
  };
  for (const projectDir of [undefined, decoy]) {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
    const r = spawnSync(process.execPath, [script, '--now', NOW], { encoding: 'utf8', cwd: TMP, env });
    assert.deepEqual(
      { code: r.status, stdout: r.stdout, stderr: r.stderr },
      stale,
      `CLAUDE_PROJECT_DIR ${projectDir ?? 'unset'}`
    );
  }
});
