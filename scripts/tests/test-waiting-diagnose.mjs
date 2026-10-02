#!/usr/bin/env node
// @ts-check
// scripts/tests/test-waiting-diagnose.mjs - holds the waiting-on-them ledger and diagnose to what they do today.
//
// WHAT. The two ledgers a Routine and the weekly review drive: scripts/waiting-on-them.js (what others owe the
// owner, read by the morning brief and the triage run) and work/23-self-review/diagnose/diagnose.js
// (instruction attribution behind its confidence gate). Held here: waiting-on-them's six commands and their
// exact lines, the row shapes and the latest-per-id read, the silent briefline the brief depends on, the
// summary JSON the HQ push reads, the two thresholds, the append read-back and every refusal; and diagnose's
// four commands, the bounded corpus it prints, the id, the confidence gate in both directions, the queued
// proposal's text, and the resolve and stats arithmetic. Deleted, it would let a threshold, a line the brief
// prints, the summary's keys, the gate or the proposal's text change with nothing in CI noticing.
//
// HOW. Both scripts age their rows against the clock, so every child runs under a fixed one, a preload this
// file writes, with TZ=UTC, and with every ALEX_ and FAKE_ variable of the parent stripped. Every fixture is a
// throwaway tree under the OS temp folder with the real scripts copied in: diagnose with
// scripts/human-actions.js, which it runs to queue a proposal. A test named "PINNED DEFECT <id>" asserts
// behaviour known to be wrong; the fix flips exactly that assertion when the defect ledger schedules it.
//
// NEVER. Touches the checkout or reaches a network. Fixes a defect it pins: add opens a thread on the day it
// was sent, so briefline counts it, and add --threshold stores placeholders rather than refusing (R8-16);
// diagnose reads a correction heading shape no writer is told to use (R8-9); and --dry-run writes the record,
// which resolve then scores as applied (R8-10).
//
// Usage: node scripts/tests/test-waiting-diagnose.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-wd-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// 2026-09-20T12:00:00Z, so every age in an assertion is arithmetic on a fixed day.
const NOW_MS = 1789905600000;
const TODAY = '2026-09-20';
const CLOCK = path.join(TMP, 'clock.cjs');
fs.writeFileSync(
  CLOCK,
  [
    "'use strict';",
    '// A fixed clock for the child: both scripts age their rows against Date.now().',
    'const NOW = Number(process.env.FAKE_NOW_MS);',
    "if (!Number.isFinite(NOW)) throw new Error('fake clock: FAKE_NOW_MS is not a number');",
    'const RealDate = Date;',
    'class FakeDate extends RealDate {',
    '  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }',
    '  static now() { return NOW; }',
    '}',
    'globalThis.Date = FakeDate;'
  ].join('\n') + '\n'
);

let n = 0;
/**
 * Write `content` at `rel` under `root`, creating the folders.
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
/**
 * The child's environment: the parent's without its ALEX_ and FAKE_ variables, under the fixed clock.
 * @param {Record<string, string>} [extra]
 */
function env(extra = {}) {
  /** @type {Record<string, string | undefined>} */
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ALEX_|FAKE_)/.test(k)) e[k] = v;
  return { ...e, FAKE_NOW_MS: String(NOW_MS), TZ: 'UTC', ...extra };
}
/**
 * Run the script at `rel` in the tree under the fixed clock and collect its output, stdout split into lines.
 * @param {string} root
 * @param {string} rel
 * @param {string[]} args
 * @param {{ input?: string, extraEnv?: Record<string, string> }} [options]
 */
function runIn(root, rel, args, { input, extraEnv } = {}) {
  const r = spawnSync(process.execPath, ['--require', CLOCK, path.join(root, rel), ...args], {
    cwd: root,
    env: env(extraEnv),
    encoding: 'utf8',
    input
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    lines: r.stdout
      .trimEnd()
      .split('\n')
      .filter((l) => l !== '')
  };
}

// ---------------------------------------------------------------- waiting-on-them
// system/ must already exist: the script appends to system/waiting-on-them.jsonl and never creates the
// folder (pinned below). On a real install the folder ships with the Kit.
/**
 * A fresh tree holding waiting-on-them.js, with system/ unless told otherwise; returns its root.
 * @param {{ withSystem?: boolean }} [options]
 */
function waitTree({ withSystem = true } = {}) {
  const root = path.join(TMP, `w${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  if (withSystem) fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'waiting-on-them.js'), path.join(root, 'scripts', 'waiting-on-them.js'));
  // warnUnknownFlags (EDGE-WARN) requires these beside the script.
  for (const lib of ['args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(root, 'scripts', 'lib', lib));
  }
  return root;
}
/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ input?: string, extraEnv?: Record<string, string> }} [opts]
 */
const wait = (root, args, opts) => runIn(root, 'scripts/waiting-on-them.js', args, opts);
/** @param {string} root every row of the tree's store, parsed */
const store = (root) =>
  fs
    .readFileSync(path.join(root, 'system', 'waiting-on-them.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));

test('waiting-on-them with an empty store: briefline is SILENT with exit 0 (the brief prints nothing), list says nobody owes, summary is the HQ JSON with its keys in order', () => {
  const root = waitTree();
  const b = wait(root, ['briefline']);
  assert.deepEqual([b.status, b.stdout, b.stderr], [0, '', '']);
  assert.deepEqual(wait(root, ['list']).lines, ['Waiting on them: nothing. Nobody owes you a reply.']);
  const s = JSON.parse(wait(root, ['summary']).stdout);
  assert.deepEqual(Object.keys(s), ['open_count', 'oldest_days', 'jobs_owed', 'headline']);
  assert.deepEqual(s, { open_count: 0, oldest_days: 0, jobs_owed: 0, headline: 'nobody owes you' });
  assert.ok(!fs.existsSync(path.join(root, 'system', 'waiting-on-them.jsonl')), 'a read never creates the store');
});

test('sweep: a thread is opened only once it is past its threshold (3 days for a job, 4 otherwise), a reply resolves it, a row with no id or no sent_date is skipped, and the job threads newly gone quiet are listed', () => {
  const root = waitTree();
  const threads = [
    {
      threadId: 't1',
      to: 'a@example.invalid',
      subject: 'Job app Senior BI',
      sent_date: '2026-09-16',
      has_reply: false,
      is_job: true
    },
    { threadId: 't2', to: 'b@example.invalid', subject: 'Invoice', sent_date: '2026-09-17', has_reply: false },
    { threadId: 't3', to: 'c@example.invalid', subject: 'Old', sent_date: '2026-09-10', has_reply: false },
    { id: 't4', sent_date: '2026-09-19', has_reply: false },
    { threadId: 't5' }
  ];
  const r = wait(root, ['sweep'], { input: JSON.stringify(threads) });
  assert.equal(r.status, 0);
  assert.deepEqual(
    r.lines,
    [
      'waiting-on-them sweep: 2 newly owed, 0 resolved, 2 open total',
      'JOB THREADS GONE QUIET (report each one; there is nothing further to run):',
      '  - thread t1 (2026-09-16): Job app Senior BI'
    ],
    't2 is 3 days old against a 4-day threshold, t4 is 1 day old, t5 has no sent_date'
  );
  assert.deepEqual(
    store(root).map((x) => [x.id, x.to, x.threshold_days, x.is_job, x.created]),
    [
      ['t1', 'a@example.invalid', 3, true, TODAY],
      ['t3', 'c@example.invalid', 4, false, TODAY]
    ]
  );
  assert.deepEqual(Object.keys(store(root)[0]), [
    'id',
    'to',
    'subject',
    'sent_date',
    'threshold_days',
    'is_job',
    'created'
  ]);
  assert.deepEqual(
    wait(root, ['sweep'], { input: JSON.stringify([threads[0]]) }).lines,
    ['waiting-on-them sweep: 0 newly owed, 0 resolved, 2 open total'],
    'a second sweep of the same thread opens nothing new and resolves nothing'
  );
});

test('the store is never created: with no system/ folder the first write crashes with a raw ENOENT and exit 1', () => {
  const root = waitTree({ withSystem: false });
  const r = wait(root, ['add', '--id', 'm1', '--sent', '2026-09-10']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Error: ENOENT: no such file or directory, open '.*waiting-on-them\.jsonl'/);
  assert.deepEqual(
    wait(root, ['list']).lines,
    ['Waiting on them: nothing. Nobody owes you a reply.'],
    'the read path is happy with an absent store'
  );
});

test('sweep, list, briefline and summary over an open ledger: the job thread sorts first, ages are whole days, and a reply resolves by id', () => {
  const root = waitTree();
  wait(root, ['sweep'], {
    input: JSON.stringify([
      {
        threadId: 't1',
        to: 'a@example.invalid',
        subject: 'Job app Senior BI',
        sent_date: '2026-09-16',
        has_reply: false,
        is_job: true
      },
      { threadId: 't3', to: 'c@example.invalid', subject: 'Old', sent_date: '2026-09-10', has_reply: false }
    ])
  });
  assert.deepEqual(wait(root, ['list']).lines, [
    'Waiting on them (2):',
    '- a@example.invalid [JOB] (4d, owed past 3d): Job app Senior BI',
    '- c@example.invalid (10d, owed past 4d): Old'
  ]);
  assert.deepEqual(wait(root, ['briefline']).lines, ['2 owe you replies, oldest 10d: c@example.invalid re: Old']);
  assert.deepEqual(JSON.parse(wait(root, ['summary']).stdout), {
    open_count: 2,
    oldest_days: 10,
    jobs_owed: 1,
    headline: 'c@example.invalid re: Old (10d)'
  });
  const resolved = wait(root, ['sweep'], {
    input: JSON.stringify([{ threadId: 't3', sent_date: '2026-09-10', has_reply: true }])
  });
  assert.deepEqual(resolved.lines, ['waiting-on-them sweep: 0 newly owed, 1 resolved, 1 open total']);
  assert.deepEqual(store(root).at(-1), { id: 't3', resolved: true, resolved_date: TODAY, reason: 'reply' });
  assert.deepEqual(wait(root, ['list']).lines.length, 2, 'a resolved row is dropped by the latest-per-id load');
});

test('add and resolve by hand, and every refusal: a missing id or date, an unknown thread, unparseable input, a JSON object instead of an array, an unknown command', () => {
  const root = waitTree();
  assert.deepEqual(
    wait(root, ['add', '--id', 'm1', '--to', 'd@example.invalid', '--subject', 'a subject', '--sent', '2026-09-14'])
      .lines,
    ['tracked: m1']
  );
  assert.deepEqual(wait(root, ['add', '--id', 'm1', '--to', 'other', '--sent', '2026-09-14']).lines, ['tracked: m1']);
  assert.equal(store(root).length, 1, 'add is idempotent: an already-tracked id writes nothing');
  assert.deepEqual(wait(root, ['resolve', 'm1', '--reason', 'reply']).lines, ['resolved: m1']);
  assert.equal(store(root).at(-1).reason, 'reply');
  /** @type {Array<[string[], string]>} */
  const refusals = [
    [['add', '--id', 'z'], 'add needs --id and --sent YYYY-MM-DD\n'],
    [['resolve', 'nope'], "no open thread 'nope'\n"],
    [['resolve'], "no open thread 'undefined'\n"],
    [['bogus'], 'usage: waiting-on-them.js sweep|add|resolve|list|briefline|summary\n'],
    [[], 'usage: waiting-on-them.js sweep|add|resolve|list|briefline|summary\n']
  ];
  for (const [args, err] of refusals) {
    const r = wait(root, args);
    assert.deepEqual([r.status, r.stderr], [1, err], args.join(' ') || '(none)');
  }
  for (const [input, err] of [
    ['not json', 'sweep: input is not valid JSON\n'],
    ['{}', 'sweep: expected a JSON array of thread descriptors\n']
  ]) {
    const r = wait(root, ['sweep'], { input });
    assert.deepEqual([r.status, r.stderr], [1, err], input);
  }
  const noFile = wait(root, ['sweep', 'no-such.json']);
  assert.deepEqual([noFile.status, noFile.stderr], [1, 'sweep: need a JSON file arg or piped JSON on stdin\n']);
  put(
    root,
    'threads.json',
    JSON.stringify([
      { threadId: 't9', to: 'z@example.invalid', subject: 'From a file', sent_date: '2026-09-01', has_reply: false }
    ])
  );
  assert.deepEqual(
    wait(root, ['sweep', 'threads.json']).lines,
    ['waiting-on-them sweep: 1 newly owed, 0 resolved, 1 open total'],
    'a file argument is read instead of stdin'
  );
});

test('PINNED DEFECT R8-16: add opens a thread on the day it was sent, so briefline counts a thread nobody owes yet; with no --to or --subject the threshold path stores placeholders rather than refusing (--to and --subject are kept when given)', () => {
  const root = waitTree();
  assert.deepEqual(
    wait(root, ['add', '--id', 'm1', '--to', 'd@example.invalid', '--subject', 'sent today', '--sent', TODAY]).lines,
    ['tracked: m1']
  );
  assert.deepEqual(store(root)[0].threshold_days, 4, 'its own threshold says four days');
  assert.deepEqual(
    wait(root, ['briefline']).lines,
    ['1 owe you replies, oldest 0d: d@example.invalid re: sent today'],
    'and the brief reports it at zero days old'
  );
  assert.equal(JSON.parse(wait(root, ['summary']).stdout).open_count, 1);
  const root2 = waitTree();
  wait(root2, [
    'add',
    '--id',
    'm2',
    '--to',
    'd@example.invalid',
    '--subject',
    'kept',
    '--sent',
    '2026-09-10',
    '--threshold',
    '10'
  ]);
  assert.deepEqual(
    [store(root2)[0].to, store(root2)[0].subject, store(root2)[0].threshold_days],
    ['d@example.invalid', 'kept', 10],
    'the flags are read'
  );
  const root3 = waitTree();
  wait(root3, ['add', '--id', 'm3', '--sent', '2026-09-10', '--threshold', '10']);
  assert.deepEqual(
    [store(root3)[0].to, store(root3)[0].subject],
    ['unknown', ''],
    'with no --to and no --subject the threshold path stores placeholders rather than refusing'
  );
});

test('EDGE-WARN: an unknown flag warns on stderr and every command carries on exactly as it would without it (a Routine edge never refuses one)', () => {
  const root = waitTree();
  const added = wait(root, ['add', '--id', 'm1', '--sent', TODAY, '--typo']);
  assert.equal(added.status, 0);
  assert.equal(added.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(added.lines, ['tracked: m1']);
  const listedClean = wait(root, ['list']);
  const listedWarned = wait(root, ['list', '--typo']);
  assert.equal(listedWarned.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(listedWarned.lines, listedClean.lines, 'the listing itself is untouched by the warning');
  const resolved = wait(root, ['resolve', 'm1', '--typo']);
  assert.equal(resolved.status, 0);
  assert.equal(resolved.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(resolved.lines, ['resolved: m1']);
  // sweep's own positional-picking (`process.argv[3]`) has no notion of a flag: the file argument must
  // come first, or "--typo" itself would be read as the (missing) file path, which is pre-existing and not
  // this test's concern.
  put(root, 'threads.json', '[]');
  const sweptClean = wait(root, ['sweep', path.join(root, 'threads.json')]);
  const sweptWarned = wait(root, ['sweep', path.join(root, 'threads.json'), '--typo']);
  assert.equal(sweptWarned.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(sweptWarned.lines, sweptClean.lines);
});

test('WM3: briefline and summary also warn on an unknown flag (untested before), exactly like list', () => {
  const root = waitTree();
  wait(root, ['add', '--id', 'm2', '--sent', TODAY]);
  const briefClean = wait(root, ['briefline']);
  const briefWarned = wait(root, ['briefline', '--typo']);
  assert.equal(briefWarned.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(briefWarned.lines, briefClean.lines);
  const summaryClean = wait(root, ['summary']);
  const summaryWarned = wait(root, ['summary', '--typo']);
  assert.equal(summaryWarned.stderr, 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(summaryWarned.lines, summaryClean.lines);
});

test("WM2: sweep keeps allowPositionals true for its own unknown-flag check, so an unknown flag placed before the file positional does not swallow the file's path into its warning", () => {
  const root = waitTree();
  put(root, 'threads.json', '[]');
  const file = path.join(root, 'threads.json');
  const r = wait(root, ['sweep', '--typo', file]);
  // sweep's own positional-picking (process.argv[3]) has no notion of a flag either way, so putting --typo
  // FIRST makes argv[3] "--typo" itself and the read fails downstream - pre-existing, not this test's
  // concern (see the comment above). Only the warning line itself is what WM2 is about.
  assert.equal(r.stderr.split('\n')[0], 'waiting-on-them: WARNING - ignored --typo: unknown flag --typo');
});

// ---------------------------------------------------------------- diagnose
/** A fresh tree holding diagnose.js, human-actions.js and a one-project manifest; returns its root. */
function diagTree() {
  const root = path.join(TMP, `d${++n}`);
  fs.mkdirSync(path.join(root, 'work', '23-self-review', 'diagnose'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'work', '23-self-review', 'diagnose', 'diagnose.js'),
    path.join(root, 'work', '23-self-review', 'diagnose', 'diagnose.js')
  );
  fs.copyFileSync(path.join(KIT, 'scripts', 'human-actions.js'), path.join(root, 'scripts', 'human-actions.js'));
  // human-actions.js's own unknown-flag warning requires args.js, errors.js and exit-codes.js beside it;
  // diagnose.js's own parseRoutine needs the same two, its REPO needs repo-root.js, and its manifest() read
  // needs json-writer.js.
  for (const lib of ['args.js', 'errors.js', 'exit-codes.js', 'json-writer.js', 'repo-root.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(root, 'scripts', 'lib', lib));
  }
  put(
    root,
    'system/manifest.json',
    JSON.stringify({ meta: { unnumbered: [] }, projects: [{ name: 'radar', work_dir: 'work/15-radar' }] })
  );
  return root;
}
/**
 * @param {string} root
 * @param {string[]} args
 * @param {{ input?: string, extraEnv?: Record<string, string> }} [opts]
 */
const diag = (root, args, opts) => runIn(root, 'work/23-self-review/diagnose/diagnose.js', args, opts);
/** @param {string} root every row of the tree's diagnoses log, parsed */
const diagnoses = (root) =>
  fs
    .readFileSync(path.join(root, 'vault', 'projects', 'self-review', 'diagnoses.jsonl'), 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));

test('diagnose corpus prints the bounded file set and the rules for the reasoning step; an unknown project says so on stderr and prints the two-file set', () => {
  const root = diagTree();
  const r = diag(root, ['corpus', '--project', 'radar']);
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, [
    'Bounded candidate instruction corpus (the ONLY files the reasoning step may cite):',
    '  CLAUDE.md  <- root: Standing Orders, gates, model-routing, the Skill Bindings table',
    '  soul.md  <- voice + identity (gitignored; law even so)',
    '  work/15-radar/CLAUDE.md  <- #radar behaviour',
    'Rules for the reasoning step (Alex, claude-sonnet-4-6, no voice block):',
    '  - cite a quoted span + file:line from WITHIN this set, or return confidence < 80.',
    '  - "no attributable instruction" is a legitimate, common answer. Do not invent a culprit.'
  ]);
  const nope = diag(root, ['corpus', '--project', 'nope']);
  assert.equal(nope.stderr, "(no work_dir for project 'nope' in the manifest)\n");
  assert.equal(nope.lines.length, 6, 'the project line is simply absent');
  assert.equal(diag(root, ['corpus']).lines.length, 6);
});

test('diagnose record: below the gate it records no-attribution and proposes nothing; at or above it records an open row, queues ONE human-actions proposal with its exact text, and refuses without --file and --span', () => {
  const root = diagTree();
  const low = diag(root, ['record', '--correction', 'c1', '--class', 'voice', '--confidence', '40']);
  assert.equal(low.status, 0);
  assert.deepEqual(low.lines, [
    'recorded: diag-20260920-d5b4e0b7 -> NO attributable instruction (confidence 40 < 80). Nothing proposed. This is the honest common case.'
  ]);
  const row = diagnoses(root)[0];
  assert.deepEqual(Object.keys(row), [
    'id',
    'date',
    'correction',
    'class',
    'confidence',
    'culprit',
    'proposal',
    'status',
    'resolve_by',
    'recurred'
  ]);
  assert.deepEqual([row.status, row.culprit, row.proposal, row.resolve_by], ['no-attribution', null, null, null]);
  const high = diag(root, [
    'record',
    '--correction',
    'c4',
    '--class',
    'format',
    '--confidence',
    '95',
    '--file',
    'CLAUDE.md',
    '--line',
    '3',
    '--span',
    's',
    '--date',
    '2026-07-01'
  ]);
  assert.deepEqual(
    high.lines,
    ['recorded: diag-20260701-77f4e43c (open, resolve-by 2026-08-30) + queued gated proposal diag-20260701-77f4e43c.'],
    'the id is the date plus a hash of the date and the correction; resolve-by is 60 days on'
  );
  const queued = JSON.parse(fs.readFileSync(path.join(root, 'system', 'human-actions.jsonl'), 'utf8').trim());
  assert.equal(queued.id, 'diag-20260701-77f4e43c');
  assert.equal(queued.severity, 'low');
  assert.equal(
    queued.what,
    'PROPOSED instruction fix (self-review diagnose, confidence 95): CLAUDE.md:3 - "s". From correction: "c4". Alex proposes; you edit the source + regenerate. Never auto-applied. Resolve-by 2026-08-30.'
  );
  assert.equal(
    queued.why_only_you,
    'Editing CLAUDE.md/soul.md is hand-authored law, gated to the owner (NEVER-TOUCH / #23 hard rule). Diagnose only proposes.'
  );
  const bad = diag(root, ['record', '--correction', 'c6', '--class', 'rule', '--confidence', '90']);
  assert.deepEqual(
    [bad.status, bad.stderr],
    [1, 'an attributed diagnosis (confidence >= 80) needs --file and --span\n']
  );
  const missing = diag(root, ['record', '--class', 'rule']);
  assert.deepEqual([missing.status, missing.stderr], [1, 'record needs --correction and --class\n']);
  const notANumber = diag(root, ['record', '--correction', 'c5', '--class', 'fact', '--confidence', 'high']);
  assert.match(notANumber.lines[0], /-> NO attributable instruction \(confidence NaN < 80\)/);
  assert.equal(
    diagnoses(root).at(-1).confidence,
    null,
    'a non-numeric confidence is stored as null, never as a number'
  );
});

test("record --file --span q refuses, exit 1, nothing recorded: a known flag never takes another flag's own name as its value", () => {
  const root = diagTree();
  const r = diag(root, [
    'record',
    '--correction',
    'c3',
    '--class',
    'format',
    '--confidence',
    '90',
    '--file',
    '--span',
    'q',
    '--dry-run'
  ]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^diagnose: REFUSED - Option '--file' argument is ambiguous\./);
  assert.equal(fs.existsSync(path.join(root, 'vault', 'projects', 'self-review', 'diagnoses.jsonl')), false);
});

test('a queue child that exits non-zero with empty stderr is described by its exit status, never a blank reason', () => {
  const root = diagTree();
  // A stub whose `add` fails loudly in exit code alone: stdout and stderr both empty, status 7.
  fs.writeFileSync(
    path.join(root, 'scripts', 'human-actions.js'),
    "#!/usr/bin/env node\nconst cmd = process.argv[2];\nif (cmd === 'add') { process.exit(7); }\nelse if (cmd === 'list') { console.log('Waiting on you: nothing. Queue is empty.'); }\n"
  );
  const r = diag(root, [
    'record',
    '--correction',
    'c15',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x'
  ]);
  assert.equal(r.status, 0, 'the diagnosis itself still stands');
  assert.match(r.stderr, /^warning: human-actions proposal not queued: the child exited 7: /);
  assert.doesNotMatch(r.stderr, /proposal not queued: \n/, 'never a blank reason');
});

test('diagnose resolve and stats: only diagnoses past their resolve-by date are scored, recurrence reads the corrections log, and the accuracy line counts applied and resolved rows only', () => {
  const root = diagTree();
  assert.deepEqual(diag(root, ['resolve']).lines, ['resolve: no open diagnoses are due yet.']);
  assert.deepEqual(diag(root, ['stats']).lines, [
    'diagnoses: 0 total | open 0 | no-attribution 0 | resolved 0',
    'diagnoser accuracy: not enough applied+resolved diagnoses to say (by design, ~a dozen resolved rows/year).'
  ]);
  diag(root, [
    'record',
    '--correction',
    'c3',
    '--class',
    'rule',
    '--confidence',
    '85',
    '--file',
    'CLAUDE.md',
    '--line',
    '12',
    '--span',
    'never X',
    '--proposal',
    'say Y',
    '--date',
    '2026-06-01'
  ]);
  diag(root, [
    'record',
    '--correction',
    'c9',
    '--class',
    'voice',
    '--confidence',
    '90',
    '--file',
    'soul.md',
    '--line',
    '1',
    '--span',
    'x',
    '--date',
    TODAY
  ]);
  put(root, 'vault/projects/teach-alex/corrections-log.md', '## [2026-08-01 10:00] type=rule target=CLAUDE.md\nx\n');
  const r = diag(root, ['resolve']);
  assert.equal(
    r.lines[0],
    'resolved diag-20260601-4ea1a236: class=rule recurred=true applied=false  (class returned -> the diagnosis likely missed, or the fix was not applied)'
  );
  assert.equal(
    r.lines[1],
    'diagnoses: 2 total | open 1 | no-attribution 0 | resolved 1',
    'the diagnosis recorded today is not due yet'
  );
  assert.deepEqual(diagnoses(root).at(-1), {
    id: 'diag-20260601-4ea1a236',
    resolve_event: true,
    resolved_date: TODAY,
    recurred: true,
    applied: false
  });
  assert.equal(
    diag(root, ['stats']).lines[1],
    'diagnoser accuracy: not enough applied+resolved diagnoses to say (by design, ~a dozen resolved rows/year).',
    'an unapplied fix never scores the diagnoser'
  );
});

test('diagnose: an unknown command and no command print the usage line with exit 1, and the ledger path is env-overridable', () => {
  const root = diagTree();
  for (const args of [[], ['bogus']]) {
    const r = diag(root, args);
    assert.deepEqual(
      [r.status, r.stderr],
      [1, 'usage: diagnose.js corpus|record|resolve|stats  (see header)\n'],
      args.join(' ') || '(none)'
    );
  }
  const log = path.join(TMP, `diag${n}.jsonl`);
  diag(root, ['record', '--correction', 'e1', '--class', 'voice', '--confidence', '10'], {
    extraEnv: { ALEX_DIAGNOSES_LOG: log }
  });
  assert.equal(JSON.parse(fs.readFileSync(log, 'utf8').trim()).correction, 'e1');
  assert.ok(!fs.existsSync(path.join(root, 'vault', 'projects', 'self-review', 'diagnoses.jsonl')));
});

test('PINNED DEFECT R8-9: recurrence reads a correction heading shape (`## [date] type=<class>`) that the teach-alex spec never prescribes, so a `type: format` heading is read as "did not recur"', () => {
  const root = diagTree();
  diag(root, [
    'record',
    '--correction',
    'c4',
    '--class',
    'format',
    '--confidence',
    '95',
    '--file',
    'CLAUDE.md',
    '--line',
    '3',
    '--span',
    's',
    '--date',
    '2026-07-01'
  ]);
  put(root, 'vault/projects/teach-alex/corrections-log.md', '## [2026-08-02] type: format\ny\n');
  const r = diag(root, ['resolve']);
  assert.match(
    r.lines[0],
    /^resolved diag-20260701-77f4e43c: class=format recurred=false /,
    'the same correction, written with a colon, is invisible'
  );
  const root2 = diagTree();
  diag(root2, [
    'record',
    '--correction',
    'c4',
    '--class',
    'format',
    '--confidence',
    '95',
    '--file',
    'CLAUDE.md',
    '--line',
    '3',
    '--span',
    's',
    '--date',
    '2026-07-01'
  ]);
  put(root2, 'vault/projects/teach-alex/corrections-log.md', '## [2026-08-02] type=format\ny\n');
  assert.match(
    diag(root2, ['resolve']).lines[0],
    /class=format recurred=true /,
    'control: with an equals sign it recurs'
  );
});

test('PINNED DEFECT R8-10: --dry-run WRITES the diagnosis row (only the queueing is skipped), and resolve then reads the absent human-action as "applied", scoring a proposal nobody ever saw', () => {
  const root = diagTree();
  const r = diag(root, [
    'record',
    '--correction',
    'c3',
    '--class',
    'rule',
    '--confidence',
    '85',
    '--file',
    'CLAUDE.md',
    '--line',
    '12',
    '--span',
    'never X',
    '--proposal',
    'say Y',
    '--date',
    '2026-06-01',
    '--dry-run'
  ]);
  assert.equal(r.status, 0);
  assert.deepEqual(r.lines, [
    'recorded: diag-20260601-4ea1a236 (open, resolve-by 2026-07-31). DRY-RUN, would queue human-action:',
    '  id=diag-20260601-4ea1a236 sev=low',
    '  PROPOSED instruction fix (self-review diagnose, confidence 85): CLAUDE.md:12 - "never X". Suggested change: say Y. From correction: "c3". Alex proposes; you edit the source + regenerate. Never auto-applied. Resolve-by 2026-07-31.'
  ]);
  assert.equal(diagnoses(root).length, 1, 'the row is on disk although the run said DRY-RUN');
  assert.equal(diagnoses(root)[0].status, 'open');
  assert.ok(!fs.existsSync(path.join(root, 'system', 'human-actions.jsonl')), 'and nothing was queued');
  const resolved = diag(root, ['resolve']);
  assert.match(
    resolved.lines[0],
    /^resolved diag-20260601-4ea1a236: class=rule recurred=false applied=true/,
    'an empty queue reads as "the owner applied it"'
  );
  assert.equal(
    diag(root, ['stats']).lines[1],
    'diagnoser accuracy (of applied+resolved): 1/1 did not recur. Small n; a signal, never a scoreboard.'
  );
});

test('"+ queued gated proposal" prints only once the queue write reads back; a broken queue says what really happened, and the diagnosis still stands', () => {
  const root = diagTree();
  fs.rmSync(path.join(root, 'scripts', 'human-actions.js')); // the queueing subprocess can no longer run at all
  const r = diag(root, [
    'record',
    '--correction',
    'c9',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x'
  ]);
  assert.equal(r.status, 0, 'the diagnosis itself still stands: the record exit code is never at stake over the queue');
  assert.ok(!r.lines.some((l) => l.includes('+ queued gated proposal')), 'never claims a queue that never ran');
  assert.match(
    /** @type {string} */ (r.lines.at(-1)),
    /^recorded: diag-[\w-]+ \(open, resolve-by 2026-1[01]-\d\d\)\. Proposal NOT confirmed queued\.$/
  );
  assert.match(r.stderr, /^warning: human-actions proposal not queued: /);
  assert.equal(diagnoses(root).length, 1, 'the diagnosis row is written regardless');
  assert.equal(diagnoses(root)[0].status, 'open', 'and it is open, not silently downgraded');
});

test('a queue add that exits 0 but whose write never reaches the list is ALSO not confirmed queued (the read-back, not just the exit code, decides)', () => {
  const root = diagTree();
  // A stub that answers `add` with success and prints nothing useful, but whose `list` never shows anything:
  // the write silently did nothing, which a bare exit-0 check on `add` alone would miss.
  fs.writeFileSync(
    path.join(root, 'scripts', 'human-actions.js'),
    "#!/usr/bin/env node\nconst cmd = process.argv[2];\nif (cmd === 'add') { console.log('queued: stub (low)'); }\nelse if (cmd === 'list') { console.log('Waiting on you: nothing. Queue is empty.'); }\n"
  );
  const r = diag(root, [
    'record',
    '--correction',
    'c10',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x'
  ]);
  assert.equal(r.status, 0);
  assert.ok(
    !r.lines.some((l) => l.includes('+ queued gated proposal')),
    'add exited 0, but the list read-back never showed it'
  );
  assert.match(/** @type {string} */ (r.lines.at(-1)), /Proposal NOT confirmed queued\.$/);
  assert.equal(r.stderr, 'warning: human-actions proposal not queued: the queue does not list it back\n');
});

test('an add that refuses because the id is already open (a repeat correction) still reads back as queued, since the row genuinely is', () => {
  const root = diagTree();
  const args = [
    'record',
    '--correction',
    'c11',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x',
    '--date',
    '2026-06-01'
  ];
  const first = diag(root, args);
  assert.equal(first.status, 0);
  assert.ok(
    first.lines.some((l) => l.includes('+ queued gated proposal')),
    'first record queues it'
  );
  // The identical correction + class + date recomputes the SAME id, so the second `add` refuses with
  // "already exists" - but the row is still genuinely open, and the read-back must say so.
  const second = diag(root, args);
  assert.equal(second.status, 0, 'the diagnosis itself never fails over a queue that is already open');
  assert.ok(
    second.lines.some((l) => l.includes('+ queued gated proposal')),
    `an already-open id still reads back as queued: ${JSON.stringify(second.lines)}`
  );
  assert.equal(second.stderr, '', 'no false warning either');
  assert.equal(diagnoses(root).length, 2, 'both diagnosis rows are recorded, one per record() call');
});

test('a human-actions list that crashes reports "queue state unknown", never "not queued" - the two are different facts', () => {
  const root = diagTree();
  // add succeeds; list crashes outright. Only the read-back is broken, so record() must not claim to know
  // whether the row is queued or not.
  fs.writeFileSync(
    path.join(root, 'scripts', 'human-actions.js'),
    "#!/usr/bin/env node\nconst cmd = process.argv[2];\nif (cmd === 'add') { console.log('queued: stub (low)'); }\nelse if (cmd === 'list') { console.error('boom: list crashed'); process.exit(1); }\n"
  );
  const r = diag(root, [
    'record',
    '--correction',
    'c12',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x'
  ]);
  assert.equal(r.status, 0);
  assert.ok(!r.lines.some((l) => l.includes('+ queued gated proposal')));
  assert.match(/** @type {string} */ (r.lines.at(-1)), /Proposal NOT confirmed queued\.$/);
  assert.equal(r.stderr, 'warning: human-actions queue state unknown: boom: list crashed\n');
});

test('a human-actions list that hangs past the child timeout is killed and reported as "queue state unknown", not left to hang the run', () => {
  const root = diagTree();
  fs.writeFileSync(
    path.join(root, 'scripts', 'human-actions.js'),
    "#!/usr/bin/env node\nconst cmd = process.argv[2];\nif (cmd === 'add') { console.log('queued: stub (low)'); }\nelse if (cmd === 'list') { const end = Date.now() + 30000; while (Date.now() < end) {} console.log('Waiting on you: nothing. Queue is empty.'); }\n"
  );
  const r = diag(
    root,
    [
      'record',
      '--correction',
      'c13',
      '--class',
      'rule',
      '--confidence',
      '90',
      '--file',
      'CLAUDE.md',
      '--line',
      '1',
      '--span',
      'x'
    ],
    { extraEnv: { ALEX_DIAGNOSE_CHILD_TIMEOUT_MS: '3000' } }
  );
  assert.equal(r.status, 0);
  assert.ok(!r.lines.some((l) => l.includes('+ queued gated proposal')));
  assert.match(
    r.stderr,
    /^warning: human-actions queue state unknown: the queue did not answer within 3000ms \(killed with \w+\)\n$/
  );
});

test('the read-back matches the listing\'s exact row shape for THIS id, never a substring test for "diag-" anywhere in the whole listing', () => {
  const root = diagTree();
  // The stub's `list` always shows a DIFFERENT diagnosis's id, never the one record() actually queued: a
  // plain `list.includes('diag-')` (or even `list.includes(id)` against the wrong id) would be fooled by it,
  // since every diagnosis id starts with "diag-" by construction.
  fs.writeFileSync(
    path.join(root, 'scripts', 'human-actions.js'),
    "#!/usr/bin/env node\nconst cmd = process.argv[2];\nif (cmd === 'add') { console.log('queued: stub (low)'); }\nelse if (cmd === 'list') { console.log('Waiting on you (1):\\n- [LOW] diag-99999999-ffffffff (0d): an unrelated diagnosis'); }\n"
  );
  const r = diag(root, [
    'record',
    '--correction',
    'c14',
    '--class',
    'rule',
    '--confidence',
    '90',
    '--file',
    'CLAUDE.md',
    '--line',
    '1',
    '--span',
    'x'
  ]);
  assert.equal(r.status, 0);
  assert.ok(
    !r.lines.some((l) => l.includes('+ queued gated proposal')),
    "the listing never named THIS diagnosis's own id, so it must not read as queued"
  );
  assert.equal(r.stderr, 'warning: human-actions proposal not queued: the queue does not list it back\n');
});

test('EDGE-WARN: an unknown flag warns on stderr and every command carries on exactly as it would without it (a Routine edge never refuses one)', () => {
  const root = diagTree();
  const corpusClean = diag(root, ['corpus']);
  const corpusWarned = diag(root, ['corpus', '--typo']);
  assert.equal(corpusWarned.stderr, 'diagnose: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(corpusWarned.lines, corpusClean.lines);
  const recorded = diag(root, ['record', '--correction', 'c1', '--class', 'voice', '--confidence', '40', '--typo']);
  assert.equal(recorded.status, 0);
  assert.equal(recorded.stderr, 'diagnose: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(recorded.lines, [
    'recorded: diag-20260920-d5b4e0b7 -> NO attributable instruction (confidence 40 < 80). Nothing proposed. This is the honest common case.'
  ]);
  // Two identically-seeded roots (one open diagnosis, dated far enough back that resolve() finds it due), so
  // this compares resolve()'s own call to stats() at the end with and without the flag: if the warning were
  // checked inside both resolve() and stats() themselves, the "--typo" run would print it twice.
  /** @param {string} t */
  const seedOpen = (t) =>
    diag(t, [
      'record',
      '--correction',
      'c2',
      '--class',
      'rule',
      '--confidence',
      '90',
      '--file',
      'CLAUDE.md',
      '--line',
      '1',
      '--span',
      'x',
      '--date',
      '2026-06-01'
    ]);
  const cleanRoot = diagTree();
  seedOpen(cleanRoot);
  const resolveClean = diag(cleanRoot, ['resolve']);
  const warnedRoot = diagTree();
  seedOpen(warnedRoot);
  const resolveWarned = diag(warnedRoot, ['resolve', '--typo']);
  assert.equal(
    resolveWarned.stderr,
    'diagnose: WARNING - ignored --typo: unknown flag --typo\n',
    'exactly one warning, not one per resolve() and one per its internal stats() call'
  );
  assert.deepEqual(resolveWarned.lines, resolveClean.lines);
  const statsClean = diag(cleanRoot, ['stats']);
  const statsWarned = diag(cleanRoot, ['stats', '--typo']);
  assert.equal(statsWarned.stderr, 'diagnose: WARNING - ignored --typo: unknown flag --typo\n');
  assert.deepEqual(statsWarned.lines, statsClean.lines);
});

test('waiting-on-them.js: every flag the Usage: header documents is a key of ADD_FLAGS or RESOLVE_FLAGS, and every key of those tables is documented in Usage', () => {
  const source = fs.readFileSync(path.join(KIT, 'scripts', 'waiting-on-them.js'), 'utf8');
  const usageBlock = source.slice(source.indexOf('// Usage:'), source.indexOf('// Exit:'));
  const usageFlags = new Set([...usageBlock.matchAll(/--([a-z][a-z-]*)\b/g)].map((m) => m[1]));
  const tableFlags = new Set(
    [...source.matchAll(/const (?:ADD|RESOLVE)_FLAGS = (\{[\s\S]*?\};)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\w+): \{ type:/g)])
      .map((m) => m[1])
  );
  assert.deepEqual([...usageFlags].sort(), [...tableFlags].sort());
});

test('diagnose.js: every flag the Usage: header documents is a key of CORPUS_FLAGS or RECORD_FLAGS, and every key of those tables is documented in Usage', () => {
  const source = fs.readFileSync(path.join(KIT, 'work', '23-self-review', 'diagnose', 'diagnose.js'), 'utf8');
  const usageBlock = source.slice(source.indexOf('// Usage:'), source.indexOf('// Exit:'));
  const usageFlags = new Set([...usageBlock.matchAll(/--([a-z][a-z-]*)\b/g)].map((m) => m[1]));
  const tableFlags = new Set(
    [...source.matchAll(/const (?:CORPUS|RECORD)_FLAGS = (\{[\s\S]*?\};)/g)]
      .flatMap((m) => [...m[1].matchAll(/(['"]?[\w-]+['"]?): \{ type:/g)])
      .map((m) => m[1].replace(/['"]/g, ''))
  );
  assert.deepEqual([...usageFlags].sort(), [...tableFlags].sort());
});
