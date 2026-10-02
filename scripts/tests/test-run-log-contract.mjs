#!/usr/bin/env node
// @ts-check
// scripts/tests/test-run-log-contract.mjs - holds scripts/run-log.mjs to the lines its readers read back.
//
// WHAT. The run log's contract beyond T7 of scripts/tests/test-autosave.mjs: where the file lives, the exact
// stdout and stderr lines a Routine prompt, the close-out and the weekly sweep read back, every refusal and
// its wording, the torn-line warning, and the known defects as they behave today. Deleted, it would let a
// change move the log away from system/ beside the script, reword `none` or a refusal a Routine reads, drop
// the torn-line warning or its line number, write a row a refusal should have stopped, or fix a pinned
// defect silently, with nothing else in CI noticing.
//
// HOW. Each test copies run-log.mjs, scripts/lib/json-writer.js, scripts/lib/run-log-read.js,
// scripts/lib/args.js, scripts/lib/errors.js and scripts/lib/exit-codes.js into a fresh temp tree, because
// the script writes system/run-log.jsonl beside itself and requires all five library files, and runs the
// copy as a child process. A test named "PINNED DEFECT <id>" asserts behaviour known to be wrong; the fix
// flips exactly that assertion when the defect ledger schedules it. `append` resolves the value-vs-flag
// question by hand (preprocessAppendArgs, ahead of args.js, which cannot tell a real dash-led value from a
// missing one) before parsing what remains through args.js's 'routine' edge. An unknown flag warns and the
// append still happens, and so does a lone `--` or a `--flag=value` token followed by a stray word, never
// forwarded to parseArgs as its own positional terminator. A known flag followed by nothing, or by another
// of its own flag names, warns and is dropped (null in the row); a reason that starts with -- but is not
// one of run-log's own flags is the value verbatim. A stray positional word warns and is dropped, and the
// append carries on. Every business-rule refusal (an enum, a sha shape, a repository name, --job non-empty,
// --missed a whole number) is this program's own exit 2 and its own wording, args.js never in the path.
//
// NEVER. Touches the checkout: every tree lives in one temp folder this file removes at the end. Reaches the
// network, or depends on the clock beyond the shape of `at`. Fixes a defect it pins: RL-D1 one row with a
// non-snake_case key breaks `last`, RL-D2 an append to a file with no final line feed glues two rows, RL-D4
// a repeated flag is taken with the last one winning, RL-D5 `last` ignores extra words, unknown flags
// included, since `last` never routes through args.js, RL-D7 --job is checked only for being non-empty.
//
// Usage: node scripts/tests/test-run-log-contract.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-runlog-contract-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

let n = 0;
/** A fresh temp tree holding the script and the JSON writer it requires; returns its root. */
function tree() {
  const t = path.join(TMP, `tree-${++n}`);
  fs.mkdirSync(path.join(t, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'run-log.mjs'), path.join(t, 'scripts', 'run-log.mjs'));
  for (const rel of ['json-writer.js', 'run-log-read.js', 'args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', rel), path.join(t, 'scripts', 'lib', rel));
  }
  return t;
}
/** @param {string} t a tree root */
const LOG = (t) => path.join(t, 'system', 'run-log.jsonl');
const SEP_LOG = ['system', 'run-log.jsonl'].join(path.sep); // run-log prints the path with the platform separator
/**
 * Run the tree's copy of run-log.mjs from `cwd` and collect what it printed.
 * @param {string} t a tree root
 * @param {string[]} args
 * @param {string} [cwd]
 */
function runLog(t, args, cwd = os.tmpdir()) {
  const r = spawnSync(process.execPath, [path.join(t, 'scripts', 'run-log.mjs'), ...args], { encoding: 'utf8', cwd });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
/**
 * The row an append printed on stdout, parsed. Fails the test when no row was printed.
 * @param {string} stdout
 */
function appendedRow(stdout) {
  const m = /appended (\{.*\})$/m.exec(stdout);
  assert.ok(m, `an appended row is printed: ${stdout}`);
  return JSON.parse(m[1]);
}
/**
 * Write `text` as the tree's run log, creating system/.
 * @param {string} t a tree root
 * @param {string} text
 */
const writeRows = (t, text) => {
  fs.mkdirSync(path.join(t, 'system'), { recursive: true });
  fs.writeFileSync(LOG(t), text);
};
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

test('last on an absent log: `last <job>` prints exactly "none", `last` prints nothing, both exit 0', () => {
  const t = tree();
  const one = runLog(t, ['last', 'triage']);
  assert.deepEqual(one, { code: 0, stdout: 'none\n', stderr: '' });
  const all = runLog(t, ['last']);
  assert.deepEqual(all, { code: 0, stdout: '', stderr: '' });
  assert.equal(fs.existsSync(path.join(t, 'system')), false, 'a read creates nothing');
});

test('append writes system/run-log.jsonl beside the script whatever the cwd, creating system/, and prints the row', () => {
  const t = tree();
  const r = runLog(
    t,
    [
      'append',
      '--job',
      'snapshot',
      '--status',
      'COMPLETE',
      '--canary',
      'missing',
      '--missed',
      '3',
      '--model',
      'claude-sonnet-4-6',
      '--reason',
      'landed',
      '--session-url',
      'https://claude.ai/code/x',
      '--repo',
      'owner/backup',
      '--sha',
      'ABCDEF0123456789ABCDEF0123456789ABCDEF01'
    ],
    TMP
  );
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const m = /^run-log: appended (\{.*\})\n$/.exec(r.stdout);
  assert.ok(m, r.stdout);
  const row = JSON.parse(m[1]);
  assert.deepEqual(Object.keys(row), [
    'at',
    'canary',
    'job',
    'missed',
    'model',
    'reason',
    'repo',
    'session_url',
    'sha',
    'status'
  ]);
  assert.match(row.at, AT);
  assert.deepEqual(
    { ...row, at: '<at>' },
    {
      at: '<at>',
      canary: 'missing',
      job: 'snapshot',
      missed: 3,
      model: 'claude-sonnet-4-6',
      reason: 'landed',
      repo: 'owner/backup',
      session_url: 'https://claude.ai/code/x',
      sha: 'abcdef0123456789abcdef0123456789abcdef01',
      status: 'COMPLETE'
    }
  );
  assert.equal(fs.readFileSync(LOG(t), 'utf8'), m[1] + '\n', 'the file holds exactly the printed row, LF-terminated');
});

test('last with no job prints one line per job, sorted by job name; the newest by at wins and a tie goes to the later line', () => {
  const t = tree();
  writeRows(
    t,
    [
      '{"at":"2026-09-20T10:00:00Z","job":"zeta","status":"COMPLETE","n":1}',
      '{"at":"2026-09-22T10:00:00Z","job":"alpha","status":"PARTIAL","n":2}',
      '{"at":"2026-09-21T10:00:00Z","job":"alpha","status":"COMPLETE","n":3}',
      '{"at":"2026-09-22T10:00:00Z","job":"mid","status":"COMPLETE","n":4}',
      '{"at":"2026-09-22T10:00:00Z","job":"mid","status":"RED","n":5}',
      '{"at":"2026-09-22T10:00:00Z","job":7,"status":"RED","n":6}',
      ''
    ].join('\n')
  );
  const r = runLog(t, ['last']);
  assert.equal(r.code, 0);
  assert.equal(
    r.stdout,
    [
      '{"at":"2026-09-22T10:00:00Z","job":"alpha","n":2,"status":"PARTIAL"}',
      '{"at":"2026-09-22T10:00:00Z","job":"mid","n":5,"status":"RED"}',
      '{"at":"2026-09-20T10:00:00Z","job":"zeta","n":1,"status":"COMPLETE"}',
      ''
    ].join('\n'),
    'canonical text (sorted keys, one line), jobs sorted, a non-string job ignored'
  );
  assert.equal(runLog(t, ['last', 'mid']).stdout, '{"at":"2026-09-22T10:00:00Z","job":"mid","n":5,"status":"RED"}\n');
});

test('a torn line is skipped with a WARN naming its 1-based line and the relative path; CRLF rows are read', () => {
  const t = tree();
  writeRows(t, '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}\r\nnot json\r\n');
  const r = runLog(t, ['last', 'brief']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}\n');
  assert.equal(r.stderr, `run-log: WARN ${SEP_LOG}:2 is not JSON, skipped\n`);
});

test("this program's OWN business-rule refusals exit 2 with its own wording, never args.js's, and write nothing", () => {
  const usage =
    'run-log: REFUSED - usage: run-log.mjs append --job <name> --status <COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED> [--reason ..] [--canary ok|missing] [--model ..] [--missed <n>] [--session-url ..] [--repo ..] [--sha ..] | last [<job>]\n';
  /** @type {Array<[string[], string]>} */
  const cases = [
    [[], usage],
    [['list'], usage],
    [['append', '--status', 'COMPLETE'], 'run-log: REFUSED - --job is required\n'],
    [
      ['append', '--job', 'x'],
      'run-log: REFUSED - --status must be one of COMPLETE | PARTIAL | BLOCKED | SKIPPED | RED (got undefined)\n'
    ],
    [
      ['append', '--job', 'x', '--status', 'complete'],
      'run-log: REFUSED - --status must be one of COMPLETE | PARTIAL | BLOCKED | SKIPPED | RED (got "complete")\n'
    ],
    [
      ['append', '--job', 'x', '--status', 'COMPLETE', '--canary', 'yes'],
      'run-log: REFUSED - --canary must be ok | missing (got "yes")\n'
    ],
    [
      ['append', '--job', 'x', '--status', 'COMPLETE', '--repo', 'owner/a b'],
      'run-log: REFUSED - --repo must be one repository name, owner/name (got "owner/a b")\n'
    ],
    [
      ['append', '--job', 'x', '--status', 'COMPLETE', '--repo', ''],
      'run-log: REFUSED - --repo must be one repository name, owner/name (got "")\n'
    ],
    [
      ['append', '--job', 'x', '--status', 'COMPLETE', '--missed', '-1'],
      'run-log: REFUSED - --missed must be a non-negative integer (got "-1")\n'
    ]
  ];
  for (const [args, stderr] of cases) {
    const t = tree();
    const r = runLog(t, args);
    assert.deepEqual(r, { code: 2, stdout: '', stderr }, args.join(' '));
    assert.equal(fs.existsSync(LOG(t)), false, `${args.join(' ')} wrote nothing`);
  }
  const long = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--repo', 'o/' + 'n'.repeat(199)]);
  assert.equal(long.code, 2);
  assert.match(long.stderr, /^run-log: REFUSED - --repo must be one repository name/);
});

test("a known flag given no value WARNS and the append still happens, the row holding model: null; the same for --model immediately followed by another of run-log's own flags", () => {
  const t = tree();
  const eof = runLog(t, ['append', '--job', 'x', '--status', 'COMPLETE', '--model']);
  assert.equal(eof.code, 0, eof.stderr);
  assert.equal(eof.stderr, 'run-log: WARNING - ignored --model: no value given\n');
  const rowEof = appendedRow(eof.stdout);
  assert.equal(rowEof.model, null);

  const t2 = tree();
  const beforeFlag = runLog(t2, ['append', '--job', 'x', '--status', 'COMPLETE', '--model', '--canary', 'ok']);
  assert.equal(beforeFlag.code, 0, beforeFlag.stderr);
  assert.equal(
    beforeFlag.stderr,
    'run-log: WARNING - ignored --model: no value given (the next argument, --canary, is a flag)\n'
  );
  const rowFlag = appendedRow(beforeFlag.stdout);
  assert.deepEqual(
    [rowFlag.model, rowFlag.canary],
    [null, 'ok'],
    "--canary was not eaten as --model's value; it still parsed on its own next turn"
  );
});

test('a stray positional word: `append triage --job x --status COMPLETE` WARNS that "triage" is not a flag and the append still happens, ignoring it', () => {
  const t = tree();
  const r = runLog(t, ['append', 'triage', '--job', 'x', '--status', 'COMPLETE']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, 'run-log: WARNING - ignored triage: not a flag\n');
  const row = appendedRow(r.stdout);
  assert.equal(row.job, 'x');
  // the bare original case (no --job at all) still reaches this program's OWN --job-required refusal,
  // once the stray word is out of the way - the warning and the refusal are two separate, unrelated facts
  const bare = runLog(tree(), ['append', 'triage']);
  assert.equal(bare.code, 2);
  assert.equal(bare.stderr, 'run-log: WARNING - ignored triage: not a flag\nrun-log: REFUSED - --job is required\n');
});

test('an unknown flag WARNS on stderr (one line, naming the flag and the value it took with it) and the append still happens, the row missing only what that flag would have carried', () => {
  const t = tree();
  const r = runLog(t, ['append', '--job', 'x', '--status', 'COMPLETE', '--foo', 'y']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, 'run-log: WARNING - ignored --foo y: unknown flag --foo\n');
  const m = /^run-log: appended (\{.*\})\n$/.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.deepEqual(
    { ...JSON.parse(m[1]), at: '<at>' },
    {
      at: '<at>',
      canary: null,
      job: 'x',
      missed: null,
      model: null,
      reason: null,
      repo: null,
      session_url: null,
      sha: null,
      status: 'COMPLETE'
    }
  );
  assert.equal(fs.readFileSync(LOG(t), 'utf8'), m[1] + '\n');
});

test('PINNED DEFECT RL-D1: one row with a non-snake_case key makes `last <job>` exit 1 with neither a row nor "none"', () => {
  const t = tree();
  writeRows(
    t,
    [
      '{"at":"2026-09-22T10:00:00Z","job":"b","status":"COMPLETE"}',
      '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}',
      '{"at":"2026-09-22T11:00:00Z","job":"triage","sessionUrl":"x","status":"COMPLETE"}',
      ''
    ].join('\n')
  );
  const one = runLog(t, ['last', 'triage']);
  assert.equal(one.code, 1);
  assert.equal(one.stdout, '');
  assert.match(one.stderr, /^run-log: ERROR invalid key "sessionUrl"/);
  const all = runLog(t, ['last']);
  assert.equal(all.code, 1);
  assert.equal(
    all.stdout,
    '{"at":"2026-09-22T10:00:00Z","job":"b","status":"COMPLETE"}\n{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}\n',
    'the board prints the jobs sorted before the foreign row, then stops'
  );
  assert.match(all.stderr, /^run-log: ERROR invalid key "sessionUrl"/);
  assert.equal(runLog(t, ['last', 'brief']).code, 0, 'another job still reads');
});

test('PINNED DEFECT RL-D2: appending to a file with no trailing newline destroys the previous row too', () => {
  const t = tree();
  writeRows(t, '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}');
  const r = runLog(t, ['append', '--job', 'triage', '--status', 'COMPLETE']);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `run-log: WRITE VERIFY FAILED - the last line of ${SEP_LOG} is not the row just appended\n`);
  const lines = fs.readFileSync(LOG(t), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1, 'both rows are one glued line');
  assert.throws(() => JSON.parse(lines[0]));
  const brief = runLog(t, ['last', 'brief']);
  assert.equal(brief.stdout, 'none\n', 'the earlier row is gone for every reader');
  assert.equal(brief.stderr, `run-log: WARN ${SEP_LOG}:1 is not JSON, skipped\n`);
});

test("a reason that starts with -- is never refused: it is not one of run-log's own flags, so it IS the value, and the row holds it verbatim", () => {
  const t = tree();
  const r = runLog(t, ['append', '--job', 'x', '--status', 'COMPLETE', '--reason', '--dry-run was used']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '', 'no warning either: this is a real, ordinary value, not a missing one');
  const row = appendedRow(r.stdout);
  assert.equal(row.reason, '--dry-run was used');
  assert.equal(fs.readFileSync(LOG(t), 'utf8').includes('--dry-run was used'), true);

  // a value that merely starts with a single dash takes the same path
  const t2 = tree();
  const r2 = runLog(t2, ['append', '--job', 'x', '--status', 'COMPLETE', '--reason', '-n']);
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(r2.stderr, '');
  assert.equal(appendedRow(r2.stdout).reason, '-n');
});

test("a lone --, a stray word after it, --reason=foo followed by a bare word, --note=x followed by a stray word, and -- before --job=x, none of them ever reach parseArgs as a positional terminator; every one warns and the append still happens, in this program's own exit 2 or 0, never node's sentence at exit 1", () => {
  const dashExtra = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--', 'extra']);
  assert.equal(dashExtra.code, 0, dashExtra.stderr);
  assert.equal(
    dashExtra.stderr,
    'run-log: WARNING - ignored --: not a flag\nrun-log: WARNING - ignored extra: not a flag\n'
  );
  assert.equal(appendedRow(dashExtra.stdout).job, 'x');

  const dashReason = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--', '--reason', 'y']);
  assert.equal(dashReason.code, 0, dashReason.stderr);
  assert.equal(dashReason.stderr, 'run-log: WARNING - ignored --: not a flag\n');
  assert.equal(appendedRow(dashReason.stdout).reason, 'y');

  const eqBar = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--reason=foo', 'bar']);
  assert.equal(eqBar.code, 0, eqBar.stderr);
  assert.equal(eqBar.stderr, 'run-log: WARNING - ignored bar: not a flag\n');
  assert.equal(appendedRow(eqBar.stdout).reason, 'foo');

  const jobEqBar = runLog(tree(), ['append', '--job=x', 'bar', '--status', 'COMPLETE']);
  assert.equal(jobEqBar.code, 0, jobEqBar.stderr);
  assert.equal(jobEqBar.stderr, 'run-log: WARNING - ignored bar: not a flag\n');
  assert.equal(appendedRow(jobEqBar.stdout).job, 'x');

  const dashBeforeJob = runLog(tree(), ['append', '--', '--job', 'x', '--status', 'COMPLETE']);
  assert.equal(dashBeforeJob.code, 0, dashBeforeJob.stderr);
  assert.equal(dashBeforeJob.stderr, 'run-log: WARNING - ignored --: not a flag\n');
  assert.equal(appendedRow(dashBeforeJob.stdout).job, 'x');

  // an unrecognised flag that already carries its own inline value (--note=x), followed by a bare word:
  // both are warned and dropped on their own turn, and the append still happens, exit 0, one row.
  const inlineUnknownStray = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--note=x', 'stray']);
  assert.equal(inlineUnknownStray.code, 0, inlineUnknownStray.stderr);
  assert.equal(
    inlineUnknownStray.stderr,
    'run-log: WARNING - ignored stray: not a flag\nrun-log: WARNING - ignored --note=x: unknown flag --note\n'
  );
  assert.equal(appendedRow(inlineUnknownStray.stdout).job, 'x');

  for (const r of [dashExtra, dashReason, eqBar, jobEqBar, dashBeforeJob, inlineUnknownStray]) {
    assert.doesNotMatch(r.stderr, /run-log: ERROR/, "node's own sentence never reaches this path");
    assert.notEqual(r.code, 1, 'never the generic error exit either');
  }
});

test('--flag=value (standard CLI form) is accepted with no warning, and a trailing lone -- warns instead of vanishing silently', () => {
  const eqForm = runLog(tree(), ['append', '--job=x', '--status=COMPLETE', '--reason=', '--canary=ok']);
  assert.equal(eqForm.code, 0, eqForm.stderr);
  assert.equal(eqForm.stderr, '', '--flag=value never warns: it is one token, never ambiguous to parseArgs');
  const row = appendedRow(eqForm.stdout);
  assert.deepEqual([row.job, row.status, row.reason, row.canary], ['x', 'COMPLETE', '', 'ok']);

  const trailingDash = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--']);
  assert.equal(trailingDash.code, 0, trailingDash.stderr);
  assert.equal(trailingDash.stderr, 'run-log: WARNING - ignored --: not a flag\n');
  assert.equal(appendedRow(trailingDash.stdout).job, 'x');
});

test('KNOWN_FLAGS is derived from APPEND_OPTIONS, so every append flag, --sha included, gets the value-vs-flag check; --sha with nothing after it warns and drops instead of falling through to a raw parseArgs refusal', () => {
  const r = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--sha']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, 'run-log: WARNING - ignored --sha: no value given\n');
  assert.equal(appendedRow(r.stdout).sha, null);

  const beforeFlag = runLog(tree(), ['append', '--job', 'x', '--status', 'COMPLETE', '--sha', '--repo', 'o/n']);
  assert.equal(beforeFlag.code, 0, beforeFlag.stderr);
  assert.equal(
    beforeFlag.stderr,
    'run-log: WARNING - ignored --sha: no value given (the next argument, --repo, is a flag)\n'
  );
  const row = appendedRow(beforeFlag.stdout);
  assert.deepEqual([row.sha, row.repo], [null, 'o/n'], "--repo was not eaten as --sha's value");
});

test('PINNED DEFECT RL-D4: a repeated option is accepted silently and the last one wins', () => {
  const t = tree();
  const r = runLog(t, ['append', '--job', 'a', '--job', 'b', '--status', 'COMPLETE', '--status', 'RED']);
  assert.equal(r.code, 0);
  const row = JSON.parse(fs.readFileSync(LOG(t), 'utf8'));
  assert.equal(row.job, 'b');
  assert.equal(row.status, 'RED');
});

test('PINNED DEFECT RL-D5: `last` ignores extra arguments', () => {
  const t = tree();
  writeRows(t, '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}\n');
  assert.deepEqual(runLog(t, ['last', 'brief', 'extra', '--whatever']), runLog(t, ['last', 'brief']));
  assert.equal(runLog(t, ['last', 'brief', 'extra']).code, 0);
});

test('PINNED DEFECT RL-D7: --job accepts whitespace and the reserved name session from any caller', () => {
  const t = tree();
  assert.equal(runLog(t, ['append', '--job', 'two words', '--status', 'COMPLETE']).code, 0);
  assert.equal(runLog(t, ['append', '--job', 'session', '--status', 'COMPLETE']).code, 0);
  const jobs = fs
    .readFileSync(LOG(t), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).job);
  assert.deepEqual(jobs, ['two words', 'session']);
});

test('last forgives a byte-order mark or a non-breaking space at either end of a line, as String#trim does, and warns about neither', () => {
  const t = tree();
  writeRows(
    t,
    [
      '\uFEFF{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}',
      '\u00A0{"at":"2026-09-22T11:00:00Z","job":"triage","status":"RED"}\u00A0',
      '{"at":"2026-09-22T12:00:00Z","job":"zeta","status":"PARTIAL"}\uFEFF',
      ''
    ].join('\n')
  );
  assert.deepEqual(
    runLog(t, ['last']),
    {
      code: 0,
      stdout: [
        '{"at":"2026-09-22T10:00:00Z","job":"brief","status":"COMPLETE"}',
        '{"at":"2026-09-22T11:00:00Z","job":"triage","status":"RED"}',
        '{"at":"2026-09-22T12:00:00Z","job":"zeta","status":"PARTIAL"}',
        ''
      ].join('\n'),
      stderr: ''
    },
    'a reader that parses the line as it stands would name all three as not JSON and lose the rows'
  );
});

test('two bad things meet: an unknown flag now only warns, so the bad --missed behind it is what refuses; a bad --canary still refuses before a bad --sha is even checked', () => {
  // an unknown flag never wins this race by refusing first. It warns (one line, args.js's
  // routine-edge parse, which runs before this program's own business-rule checks) and parsing carries on;
  // --missed 'many' is then this program's OWN refusal, unchanged wording, at its OWN exit code 2.
  const t = tree();
  const r = runLog(t, ['append', '--job', 'x', '--status', 'COMPLETE', '--missed', 'many', '--foo', 'y']);
  assert.deepEqual(r, {
    code: 2,
    stdout: '',
    stderr:
      'run-log: WARNING - ignored --foo y: unknown flag --foo\nrun-log: REFUSED - --missed must be a non-negative integer (got "many")\n'
  });
  assert.equal(fs.existsSync(LOG(t)), false);

  // unchanged: a bad --canary is still this program's own business-rule refusal, checked in its own fixed
  // order ahead of --sha, and neither --sha nor --canary is flag-shaped so args.js has nothing to say here.
  const t2 = tree();
  const r2 = runLog(t2, ['append', '--job', 'x', '--status', 'COMPLETE', '--sha', 'zz', '--canary', 'yes']);
  assert.deepEqual(r2, {
    code: 2,
    stdout: '',
    stderr: 'run-log: REFUSED - --canary must be ok | missing (got "yes")\n'
  });
  assert.equal(fs.existsSync(LOG(t2)), false);
});
