#!/usr/bin/env node
// @ts-check
// scripts/tests/test-human-actions.mjs - the "Waiting on you" queue, every command run as its callers run it.
//
// WHAT. Pins scripts/human-actions.js as it behaves today: every command, its exit code and exact lines,
// the row shapes it appends to system/human-actions.jsonl, the attestation gate on the escrow items, the
// SessionStart line both SessionStart chains end with, both forms of done the callers use (`done <id>` and
// the documented `done --id <id>`), and every defect known in it. Deleted, it would let a rewrite move a
// line the brief, /status or the SessionStart hook prints, drop the read-back of an append, open the gate,
// or quietly fix or worsen a defect, with every other test green.
//
// HOW. The script writes beside itself, so each test copies it alone into a fresh tree in a temp folder,
// with system/ as every real tree has it, and runs it as a child from the OS temp folder. Children run with
// TZ=UTC, and every `created` date is computed from the real clock, so an age is exact; the one test of
// another zone skips a run that straddles noon UTC. A preload file stands in for a second writer.
//
// NEVER. Writes outside its temp folder, which it removes at the end. Flips a PINNED DEFECT assertion on
// its own: each pins today's behaviour, and only a FIX row in the ratchet flips one. HA-D2: a hand-written
// row with no created reads (NaNd), and crashes the sort on a severity tie. HA-D3: an age counts from the
// LOCAL midnight of a UTC date. HA-D4: summary crashes when the top row has no what. HA-D5: a done row
// written before its open row is lost, so the item stays open. HA-T1: the refusal asks for a "fresh"
// attestation, and any dated first line passes. HA-N1: add crashes when system/ does not exist.
//
// Usage: node scripts/tests/test-human-actions.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-human-actions-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

let n = 0;
/** @param {number} d days before now @returns {string} that day in UTC, as YYYY-MM-DD */
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const utcToday = () => new Date().toISOString().slice(0, 10);
/** @param {string} t a tree from tree() */
const QUEUE = (t) => path.join(t, 'system', 'human-actions.jsonl');
/**
 * Write the queue by hand, one row per line, as a hand edit or a merge would leave it.
 * @param {string} t
 * @param {object[]} objs
 */
const writeQueue = (t, objs) => {
  // biome-ignore lint/style/useTemplate: pinned tests' fingerprints cover this helper's tokens, so they stay
  fs.writeFileSync(QUEUE(t), objs.map((o) => JSON.stringify(o)).join('\n') + '\n');
};
/** @param {string} t @returns {any[]} every row in the tree's queue, parsed */
const rows = (t) =>
  fs
    .readFileSync(QUEUE(t), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
/** A fresh tree in the temp folder holding the script beside its libraries, and an empty system/. */
function tree() {
  const t = path.join(TMP, `tree-${++n}`);
  fs.mkdirSync(path.join(t, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(t, 'system')); // every real tree has system/ (the registry lives there)
  fs.copyFileSync(path.join(KIT, 'scripts', 'human-actions.js'), path.join(t, 'scripts', 'human-actions.js'));
  // The unknown-flag warning requires these three beside the script.
  for (const lib of ['args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(t, 'scripts', 'lib', lib));
  }
  return t;
}
/**
 * Run the tree's copy of the script with these arguments, in a zone.
 * @param {string} t
 * @param {string[]} args
 * @param {string} [tz]
 */
function ha(t, args, tz = 'UTC') {
  const r = spawnSync(process.execPath, [path.join(t, 'scripts', 'human-actions.js'), ...args], {
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, TZ: tz }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('no command or an unknown one prints the usage on stderr and exits 1', () => {
  const t = tree();
  for (const args of [[], ['close']]) {
    assert.deepEqual(ha(t, args), {
      code: 1,
      stdout: '',
      stderr: 'usage: human-actions.js add|done|list|sessionline|summary\n'
    });
  }
});

test('an empty queue: list, sessionline and summary each say so, exit 0, and create nothing', () => {
  const t = tree();
  assert.deepEqual(ha(t, ['list']), { code: 0, stdout: 'Waiting on you: nothing. Queue is empty.\n', stderr: '' });
  assert.deepEqual(ha(t, ['sessionline']), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(ha(t, ['summary']), {
    code: 0,
    stdout: '{"open_count":0,"oldest_days":0,"worst_severity":"none","headline":"queue empty"}\n',
    stderr: ''
  });
  assert.equal(fs.existsSync(QUEUE(t)), false);
});

test('PINNED DEFECT HA-N1: add in a tree with no system/ directory crashes (exit 1, a stack) instead of creating it', () => {
  const t = tree();
  fs.rmSync(path.join(t, 'system'), { recursive: true });
  const r = ha(t, ['add', '--id', 'x', '--what', 'X']);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /ENOENT: no such file or directory, open '.*human-actions\.jsonl'/);
});

test('add: one row with the documented keys, severity medium and created today (UTC) by default', () => {
  const t = tree();
  const before = utcToday();
  const r = ha(t, ['add', '--id', 'pay-rent', '--what', 'Pay the rent', '--why', 'only the owner can pay']);
  const afterDay = utcToday();
  assert.deepEqual(r, { code: 0, stdout: 'queued: pay-rent (medium)\n', stderr: '' });
  const [row] = rows(t);
  assert.deepEqual(Object.keys(row), ['id', 'what', 'why_only_you', 'severity', 'created']);
  assert.ok([before, afterDay].includes(row.created), row.created);
  assert.deepEqual(
    { ...row, created: '<today>' },
    {
      id: 'pay-rent',
      what: 'Pay the rent',
      why_only_you: 'only the owner can pay',
      severity: 'medium',
      created: '<today>'
    }
  );
  ha(t, [
    'add',
    '--id',
    'sign',
    '--what',
    'Sign it',
    '--severity',
    'critical',
    '--created',
    '2026-09-01',
    '--due',
    '2026-10-01'
  ]);
  assert.deepEqual(
    rows(t)[1],
    { id: 'sign', what: 'Sign it', severity: 'critical', created: '2026-09-01', due: '2026-10-01' },
    'no --why means no why_only_you value'
  );
});

test('add refuses a missing --id or --what, and a duplicate OPEN id, exit 1, writing nothing', () => {
  const t = tree();
  assert.deepEqual(ha(t, ['add', '--what', 'x']), { code: 1, stdout: '', stderr: 'add needs --id and --what\n' });
  assert.deepEqual(ha(t, ['add', '--id', 'x']), { code: 1, stdout: '', stderr: 'add needs --id and --what\n' });
  assert.equal(fs.existsSync(QUEUE(t)), false);
  ha(t, ['add', '--id', 'x', '--what', 'first']);
  assert.deepEqual(ha(t, ['add', '--id', 'x', '--what', 'again']), {
    code: 1,
    stdout: '',
    stderr: "open item 'x' already exists\n"
  });
  assert.equal(rows(t).length, 1);
});

test('done <id> (positional) appends the close row; an unknown or closed id exits 1; a re-add reopens', () => {
  const t = tree();
  ha(t, ['add', '--id', 'x', '--what', 'Do x']);
  const before = utcToday();
  assert.deepEqual(ha(t, ['done', 'x']), { code: 0, stdout: 'closed: x\n', stderr: '' });
  const close = rows(t)[1];
  assert.deepEqual(Object.keys(close), ['id', 'done', 'done_date']);
  assert.equal(close.done, true);
  assert.ok([before, utcToday()].includes(close.done_date));
  assert.deepEqual(ha(t, ['done', 'x']), { code: 1, stdout: '', stderr: "no open item 'x'\n" });
  assert.deepEqual(ha(t, ['done', 'nope']), { code: 1, stdout: '', stderr: "no open item 'nope'\n" });
  assert.deepEqual(ha(t, ['add', '--id', 'x', '--what', 'Do x again']), {
    code: 0,
    stdout: 'queued: x (medium)\n',
    stderr: ''
  });
  assert.match(ha(t, ['list']).stdout, /- \[MEDIUM\] x \(0d\): Do x again/);
});

test('list: a count line, items by severity then created, the age in whole days, the due date, and the close hint', () => {
  const t = tree();
  ha(t, ['add', '--id', 'low-one', '--what', 'Low', '--severity', 'low', '--created', daysAgo(1)]);
  ha(t, ['add', '--id', 'high-new', '--what', 'High new', '--severity', 'high', '--created', daysAgo(2)]);
  ha(t, [
    'add',
    '--id',
    'high-old',
    '--what',
    'High old',
    '--severity',
    'high',
    '--created',
    daysAgo(9),
    '--due',
    '2026-12-24'
  ]);
  ha(t, ['add', '--id', 'crit', '--what', 'Critical', '--severity', 'critical', '--created', daysAgo(3)]);
  assert.deepEqual(ha(t, ['list']), {
    code: 0,
    stderr: '',
    stdout: [
      'Waiting on you (4):',
      '- [CRITICAL] crit (3d): Critical',
      '- [HIGH] high-old (9d): High old | due 2026-12-24',
      '- [HIGH] high-new (2d): High new',
      '- [LOW] low-one (1d): Low',
      'Close one with: node scripts/human-actions.js done <id>  (or tell Alex "done: <id>")',
      ''
    ].join('\n')
  });
});

test('sessionline: silent below seven days, one line from seven days (the boundary counts)', () => {
  const t = tree();
  ha(t, ['add', '--id', 'young', '--what', 'Young', '--created', daysAgo(6)]);
  assert.deepEqual(ha(t, ['sessionline']), { code: 0, stdout: '', stderr: '' });
  ha(t, ['add', '--id', 'seven', '--what', 'Seven', '--created', daysAgo(7)]);
  ha(t, ['add', '--id', 'ten', '--what', 'Ten', '--severity', 'low', '--created', daysAgo(10)]);
  assert.deepEqual(ha(t, ['sessionline']), {
    code: 0,
    stderr: '',
    stdout: 'WAITING ON YOU: 2 item(s) only you can do, oldest 10d (say "waiting list" for the queue).\n'
  });
});

test('summary: one JSON line; worst severity and headline from the top item, the headline cut at 80 characters', () => {
  const t = tree();
  const what = 'A'.repeat(100);
  ha(t, ['add', '--id', 'a', '--what', 'Low', '--severity', 'low', '--created', daysAgo(12)]);
  ha(t, ['add', '--id', 'b', '--what', what, '--severity', 'high', '--created', daysAgo(4)]);
  assert.deepEqual(ha(t, ['summary']), {
    code: 0,
    stderr: '',
    stdout: `{"open_count":2,"oldest_days":12,"worst_severity":"high","headline":"${'A'.repeat(80)} (4d)"}\n`
  });
});

test('the attestation gate: an escrow id stays open while the attestation file is absent or PENDING, and closes on a dated line', () => {
  const t = tree();
  const attest = path.join(t, 'work', '18-recovery-layer', 'state', 'passphrase-attested.txt');
  for (const id of ['passphrase-attestation', 'passphrase-escrow-retest', 'passphrase-safeplace-fix'])
    ha(t, ['add', '--id', id, '--what', id]);
  /** @param {string} id */
  const refused = (id) => {
    const r = ha(t, ['done', id]);
    assert.equal(r.code, 1, id);
    assert.equal(r.stdout, '');
    const lines = r.stderr.split('\n');
    assert.match(
      lines[0],
      new RegExp(
        `^refusing to close '${id}': .*passphrase-attested\\.txt is not a fresh dated attestation \\(first line must be yyyy-MM-dd, not PENDING\\)\\.$`
      )
    );
    assert.equal(
      lines[1],
      'Run the escrow drill: powershell -File work/18-recovery-layer/escrow-test.ps1 - it stamps the attestation and closes this item on PASS.'
    );
  };
  refused('passphrase-attestation');
  fs.mkdirSync(path.dirname(attest), { recursive: true });
  fs.writeFileSync(attest, 'PENDING\n');
  refused('passphrase-escrow-retest');
  assert.equal(rows(t).length, 3, 'a refusal writes no close row');
  fs.writeFileSync(attest, '2026-09-20 attested by the drill\n');
  assert.deepEqual(ha(t, ['done', 'passphrase-safeplace-fix']), {
    code: 0,
    stdout: 'closed: passphrase-safeplace-fix\n',
    stderr: ''
  });
});

test('an append whose read-back is not the row just written fails: "append verify FAILED", exit 1 (a writer injected between the two)', () => {
  const t = tree();
  const preload = path.join(TMP, 'intruder.cjs');
  fs.writeFileSync(
    preload,
    "const fs = require('fs');\nconst real = fs.appendFileSync;\n" +
      'fs.appendFileSync = function (p, ...rest) { real.call(fs, p, ...rest); if (String(p).endsWith(\'human-actions.jsonl\')) real.call(fs, p, \'{"id":"intruder"}\\n\'); };\n'
  );
  const r = spawnSync(
    process.execPath,
    ['--require', preload, path.join(t, 'scripts', 'human-actions.js'), 'add', '--id', 'x', '--what', 'X'],
    { encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, TZ: 'UTC' } }
  );
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'human-actions: append verify FAILED\n');
});

test('PINNED DEFECT HA-T1: the refusal asks for a "fresh" attestation, but a dated line from 2000 closes the item', () => {
  const t = tree();
  const attest = path.join(t, 'work', '18-recovery-layer', 'state', 'passphrase-attested.txt');
  fs.mkdirSync(path.dirname(attest), { recursive: true });
  fs.writeFileSync(attest, '2000-01-01\n');
  ha(t, ['add', '--id', 'passphrase-attestation', '--what', 'x']);
  assert.equal(ha(t, ['done', 'passphrase-attestation']).code, 0);
});

test('done --id <id>, the form two command files document, closes the item exactly as done <id> does; a bare --id still names no item', () => {
  const t = tree();
  ha(t, ['add', '--id', 'pay-rent', '--what', 'Pay']);
  ha(t, ['add', '--id', 'passphrase-attestation', '--what', 'Attest']);
  assert.deepEqual(ha(t, ['done', '--id']), { code: 1, stdout: '', stderr: "no open item '--id'\n" });
  const gate = ha(t, ['done', '--id', 'passphrase-attestation']);
  assert.equal(gate.code, 1, 'the attestation gate reads the id the flag names');
  assert.match(gate.stderr, /^refusing to close 'passphrase-attestation': /);
  assert.equal(rows(t).length, 2, 'neither refusal writes a row');
  const before = utcToday();
  assert.deepEqual(ha(t, ['done', '--id', 'pay-rent']), { code: 0, stdout: 'closed: pay-rent\n', stderr: '' });
  const close = rows(t)[2];
  assert.deepEqual(Object.keys(close), ['id', 'done', 'done_date']);
  assert.deepEqual([close.id, close.done], ['pay-rent', true]);
  assert.ok([before, utcToday()].includes(close.done_date));
  assert.deepEqual(ha(t, ['done', '--id', 'pay-rent']), { code: 1, stdout: '', stderr: "no open item 'pay-rent'\n" });
  const docs = ['status.md', 'morning-brief.md']
    .map((f) => path.join(KIT, '.claude', 'commands', f))
    .filter((p) => fs.existsSync(p));
  assert.ok(docs.length > 0, 'at least one command file is in this tree');
  for (const p of docs) assert.match(fs.readFileSync(p, 'utf8'), /node scripts\/human-actions\.js done --id <id>/, p);
});

test('PINNED DEFECT HA-D2: a hand row with no created reads (NaNd), and crashes the sort on a severity tie', () => {
  const t = tree();
  writeQueue(t, [{ id: 'hand', what: 'Hand row', severity: 'high' }]);
  assert.match(ha(t, ['list']).stdout, /- \[HIGH\] hand \(NaNd\): Hand row/);
  // the row without created comes SECOND: the sort then calls it as the left operand, which is the crash
  // (in the other order `created.localeCompare(undefined)` compares with the string "undefined" and passes)
  writeQueue(t, [
    { id: 'other', what: 'Other', severity: 'high', created: daysAgo(1) },
    { id: 'hand', what: 'Hand row', severity: 'high' }
  ]);
  for (const cmd of ['list', 'sessionline', 'summary']) {
    const r = ha(t, [cmd]);
    assert.equal(r.code, 1, cmd);
    assert.equal(r.stdout, '', cmd);
    assert.match(r.stderr, /TypeError: Cannot read properties of undefined \(reading 'localeCompare'\)/, cmd);
  }
});

test('PINNED DEFECT HA-D3: the age counts from LOCAL midnight of the UTC date, so at UTC-12 a new item is -1 day old before noon UTC', (testCtx) => {
  const t = tree();
  ha(t, ['add', '--id', 'x', '--what', 'X']);
  const hourBefore = new Date().getUTCHours();
  const r = ha(t, ['list'], 'Etc/GMT+12');
  const hourAfter = new Date().getUTCHours();
  if (hourBefore < 12 !== hourAfter < 12) {
    testCtx.skip('the list ran across noon UTC');
    return;
  }
  assert.match(r.stdout, new RegExp(`- \\[MEDIUM\\] x \\(${hourBefore < 12 ? '-1' : '0'}d\\): X`));
});

test('PINNED DEFECT HA-D4: summary crashes when the top row has no what', () => {
  const t = tree();
  writeQueue(t, [{ id: 'hand', severity: 'critical', created: daysAgo(1) }]);
  const r = ha(t, ['summary']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /TypeError: Cannot read properties of undefined \(reading 'slice'\)/);
});

test('PINNED DEFECT HA-D5: a done row that precedes its open row is lost, so the item stays open', () => {
  const t = tree();
  writeQueue(t, [
    { id: 'x', done: true, done_date: daysAgo(1) },
    { id: 'x', what: 'Merged out of order', severity: 'low', created: daysAgo(2) }
  ]);
  assert.match(ha(t, ['list']).stdout, /^Waiting on you \(1\):\n- \[LOW\] x \(2d\): Merged out of order\n/);
});

test('done takes its id from the word after done: `done <id> --id <other>` closes <id>, and `done --id=<id>` names an item called "--id=<id>"', () => {
  const t = tree();
  ha(t, ['add', '--id', 'a', '--what', 'Do a']);
  ha(t, ['add', '--id', 'b', '--what', 'Do b']);
  assert.deepEqual(ha(t, ['done', 'b', '--id', 'a']), { code: 0, stdout: 'closed: b\n', stderr: '' });
  assert.deepEqual(ha(t, ['done', '--id=a']), { code: 1, stdout: '', stderr: "no open item '--id=a'\n" });
  assert.deepEqual(
    rows(t)
      .filter((r) => r.done)
      .map((r) => r.id),
    ['b'],
    'a is still open'
  );
});

test('an unknown flag warns on stderr and every command carries on exactly as it would without it (a hook or Routine edge never refuses one)', () => {
  const t = tree();
  const withTypo = ha(t, ['add', '--id', 'a', '--what', 'Do a', '--typo']);
  assert.deepEqual(withTypo, {
    code: 0,
    stdout: 'queued: a (medium)\n',
    stderr: 'human-actions: WARNING - ignored --typo: unknown flag --typo\n'
  });
  assert.deepEqual(rows(t)[0], { id: 'a', what: 'Do a', severity: 'medium', created: utcToday() });
  const doneClean = ha(t, ['done', 'a']);
  assert.deepEqual(doneClean, { code: 0, stdout: 'closed: a\n', stderr: '' });
  ha(t, ['add', '--id', 'b', '--what', 'Do b']);
  const doneWarned = ha(t, ['done', 'b', '--typo']);
  assert.deepEqual(doneWarned, {
    code: 0,
    stdout: 'closed: b\n',
    stderr: 'human-actions: WARNING - ignored --typo: unknown flag --typo\n'
  });
  const listWarned = ha(t, ['list', '--typo']);
  assert.equal(listWarned.stderr, 'human-actions: WARNING - ignored --typo: unknown flag --typo\n');
  assert.equal(listWarned.stdout, ha(t, ['list']).stdout, 'the listing itself is untouched by the warning');
});

test('the same unknown-flag warning covers sessionline and summary, not just add/done/list; and add\'s own --due never triggers a false "unknown flag" warning (its table lists it)', () => {
  const t = tree();
  ha(t, ['add', '--id', 'a', '--what', 'Do a']);
  const sessionClean = ha(t, ['sessionline']);
  const sessionWarned = ha(t, ['sessionline', '--typo']);
  assert.equal(sessionWarned.stderr, 'human-actions: WARNING - ignored --typo: unknown flag --typo\n');
  assert.equal(sessionWarned.stdout, sessionClean.stdout);

  const summaryClean = ha(t, ['summary']);
  const summaryWarned = ha(t, ['summary', '--typo']);
  assert.equal(summaryWarned.stderr, 'human-actions: WARNING - ignored --typo: unknown flag --typo\n');
  assert.equal(summaryWarned.stdout, summaryClean.stdout);

  const withDue = ha(t, ['add', '--id', 'b', '--what', 'Do b', '--due', '2026-12-01']);
  assert.deepEqual(withDue, { code: 0, stdout: 'queued: b (medium)\n', stderr: '' });
  assert.equal(rows(t).find((r) => r.id === 'b').due, '2026-12-01');
});

test('every flag the Usage: header documents is a key of ADD_FLAGS or DONE_FLAGS, and every key of those tables is documented in Usage - the two must never drift apart', () => {
  const source = fs.readFileSync(path.join(KIT, 'scripts', 'human-actions.js'), 'utf8');
  const usageBlock = source.slice(source.indexOf('// Usage:'), source.indexOf('// Exit:'));
  const usageFlags = new Set([...usageBlock.matchAll(/--([a-z][a-z-]*)\b/g)].map((m) => m[1]));
  const tableFlags = new Set(
    [...source.matchAll(/const (?:ADD|DONE)_FLAGS = (\{[\s\S]*?\};)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\w+): \{ type:/g)])
      .map((m) => m[1])
  );
  assert.deepEqual([...usageFlags].sort(), [...tableFlags].sort());
});
