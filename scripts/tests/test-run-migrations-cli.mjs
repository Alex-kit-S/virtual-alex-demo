#!/usr/bin/env node
// @ts-check
// scripts/tests/test-run-migrations-cli.mjs - holds scripts/run-migrations.js to what its callers read.
//
// WHAT. /update step 6 quotes everything the runner prints (update.md:257); both Update-Alex launchers
// append it to the owner's update log and read only its exit code (Update-Alex.cmd:125-126,
// Update-Alex.command:124); kit-doctor --repair runs it (kit-doctor.js:183) and reads its ledger back by
// applied[].id. scripts/tests/test-run-migrations-ledger.mjs holds the ledger's JSON-standard legs; this
// file holds the rest of the command line: every printed sentence and its indent, --list, --dry-run, the
// order, a throwing migration, the one decline that is recorded (002 in a cloud session, as not-applicable
// and silently), and exit 0 on every handled path. Deleted, it would let a change reword a sentence an owner
// is shown, run a finished migration again, record a decline as done or send every cloud owner a false
// support-bundle alarm, with nothing in CI noticing.
//
// HOW. The runner and the JSON writer are COPIED from this checkout into a throwaway tree in the OS temp
// directory, beside the fixture migrations each test writes, and the runner runs there as a child process.
// A test named "PINNED DEFECT <id>" asserts behaviour known to be wrong; its fix flips exactly that test.
//
// NEVER. Runs the real migrations or touches this checkout's ledger. Fixes a defect it pins: a damaged ledger
// re-runs every migration and rewrites the history (R4-5); a row key the JSON standard refuses crashes the
// run with exit 1 (R4-L9); an async migration is a silent decline (R4-L10); a decline with no message
// prints a dangling colon (R4-L11).
//
// Usage: node scripts/tests/test-run-migrations-cli.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TODAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A fixture migration that counts its runs in count-<id>.txt, logs one line and reports applied.
 * @param {string} id
 * @param {string} [message] what it reports
 * @returns {string} the migration's source
 */
const COUNTER = (id, message = `${id} ran`) => `const fs = require('fs'); const path = require('path');
module.exports = { run: ({ root, log }) => { const f = path.join(root, 'count-${id}.txt');
  const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1; fs.writeFileSync(f, String(n));
  log('working on ${id}'); return { status: 'applied', message: ${JSON.stringify(message)} }; } };\n`;

/**
 * @typedef {object} Run
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * A throwaway tree holding a copy of the runner and the JSON writer, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string> | null} [migrations] file name to source; null for no migrations folder
 * @param {{ ledger?: string }} [options] the ledger's text, when the tree starts with one
 */
function tree(t, migrations = {}, { ledger } = {}) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-runm-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const rel of [
    'scripts/run-migrations.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/repo-root.js',
    'scripts/lib/migration-ledger.js',
    'scripts/lib/args.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js'
  ]) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(d, rel));
  }
  if (migrations !== null) {
    fs.mkdirSync(path.join(d, 'scripts', 'migrations'), { recursive: true });
    for (const [name, src] of Object.entries(migrations))
      fs.writeFileSync(path.join(d, 'scripts', 'migrations', name), src);
  }
  if (ledger !== undefined) {
    fs.mkdirSync(path.join(d, 'system'), { recursive: true });
    fs.writeFileSync(path.join(d, 'system', 'migrations-applied.json'), ledger);
  }
  /**
   * Run the copied runner. CLAUDE_CODE_REMOTE is removed unless `env` sets it.
   * @param {string[]} [args]
   * @param {Record<string, string>} [env]
   * @returns {Run}
   */
  const run = (args = [], env = {}) => {
    const e = { ...process.env, ...env };
    if (!('CLAUDE_CODE_REMOTE' in env)) delete e.CLAUDE_CODE_REMOTE;
    const r = spawnSync(process.execPath, [path.join(d, 'scripts', 'run-migrations.js'), ...args], {
      cwd: d,
      encoding: 'utf8',
      env: e
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  /** @returns {any[]} the ledger's rows, as the file holds them */
  const ledgerRows = () =>
    JSON.parse(fs.readFileSync(path.join(d, 'system', 'migrations-applied.json'), 'utf8')).applied;
  /** @param {string} id @returns {number} how many times the COUNTER fixture of that id ran */
  const count = (id) =>
    fs.existsSync(path.join(d, `count-${id}.txt`))
      ? Number(fs.readFileSync(path.join(d, `count-${id}.txt`), 'utf8'))
      : 0;
  return {
    d,
    run,
    ledgerRows,
    count,
    hasLedger: () => fs.existsSync(path.join(d, 'system', 'migrations-applied.json'))
  };
}

test('no migrations folder: "No migrations to run.", exit 0, no ledger', (t) => {
  const x = tree(t, null);
  const r = x.run();
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'No migrations to run.\n', '']);
  assert.ok(!x.hasLedger());
});

test('an applied migration: its log lines at four spaces, its message at two, one ledger row {date, id, status}', (t) => {
  const x = tree(t, { '001-a.js': COUNTER('a') });
  const r = x.run();
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '    working on a\n  a ran\n', '']);
  const rows = x.ledgerRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ['date', 'id', 'status']);
  assert.deepEqual([rows[0].id, rows[0].status], ['001-a', 'applied']);
  assert.match(rows[0].date, TODAY);
});

test('pending migrations run in file-name order; a two-digit name is not a migration to the runner', (t) => {
  const x = tree(t, {
    '010-c.js': COUNTER('c'),
    '002-b.js': COUNTER('b'),
    '001-a.js': COUNTER('a'),
    '04-old.js': COUNTER('old'),
    'README.md': 'x'
  });
  const r = x.run();
  assert.equal(r.stdout, '    working on a\n  a ran\n    working on b\n  b ran\n    working on c\n  c ran\n');
  assert.deepEqual(
    x.ledgerRows().map((a) => a.id),
    ['001-a', '002-b', '010-c']
  );
  assert.equal(x.count('old'), 0);
});

test('nothing pending: "Nothing new to set up.", exit 0, and a recorded migration never runs twice', (t) => {
  const x = tree(t, { '001-a.js': COUNTER('a') });
  x.run();
  const r = x.run();
  assert.deepEqual([r.status, r.stdout], [0, 'Nothing new to set up.\n']);
  assert.equal(x.count('a'), 1);
});

test('--list: one line per file, [done] or [pending], two-space indent; nothing runs, nothing is written', (t) => {
  const x = tree(
    t,
    { '001-a.js': COUNTER('a'), '002-b.js': COUNTER('b') },
    { ledger: JSON.stringify({ applied: [{ id: '001-a', status: 'applied', date: '2026-01-01' }] }) }
  );
  const before = fs.readFileSync(path.join(x.d, 'system', 'migrations-applied.json'), 'utf8');
  const r = x.run(['--list']);
  assert.deepEqual([r.status, r.stdout], [0, '  [done]    001-a\n  [pending] 002-b\n']);
  assert.equal(x.count('b'), 0);
  assert.equal(fs.readFileSync(path.join(x.d, 'system', 'migrations-applied.json'), 'utf8'), before);
  assert.equal(tree(t, {}).run(['--list']).stdout, 'No migrations exist.\n');
});

test('--dry-run: "  would run: <id>" per pending migration; nothing runs and nothing is written', (t) => {
  const x = tree(t, { '001-a.js': COUNTER('a'), '002-b.js': COUNTER('b') });
  const r = x.run(['--dry-run']);
  assert.deepEqual([r.status, r.stdout], [0, '  would run: 001-a\n  would run: 002-b\n']);
  assert.equal(x.count('a'), 0);
  assert.ok(!x.hasLedger());
});

test('a skipped migration is recorded as skipped and its message printed; an applied one with no message prints nothing', (t) => {
  const x = tree(t, {
    '001-s.js': "module.exports = { run: () => ({ status: 'skipped', message: 'already there.' }) };\n",
    '002-q.js': "module.exports = { run: () => ({ status: 'applied' }) };\n"
  });
  const r = x.run();
  assert.equal(r.stdout, '  already there.\n');
  assert.deepEqual(
    x.ledgerRows().map((a) => `${a.id}/${a.status}`),
    ['001-s/skipped', '002-q/applied']
  );
});

test('a declined migration is NOT recorded, prints two lines (laptop: the Desktop log; online: /support-bundle), and runs again next time', (t) => {
  const x = tree(t, {
    '001-d.js': "module.exports = { run: () => ({ status: 'declined', message: 'not today.' }) };\n"
  });
  const laptop = x.run();
  assert.deepEqual(
    [laptop.status, laptop.stdout],
    [
      0,
      '  One setup step was skipped: not today.\n  Alex still works. Send update-log.txt from your Desktop to whoever set this up.\n'
    ]
  );
  const online = x.run([], { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(
    online.stdout,
    '  One setup step was skipped: not today.\n  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.\n'
  );
  assert.ok(!x.hasLedger(), 'a decline alone writes no ledger');
  assert.equal(
    x.run([], { CLAUDE_CODE_REMOTE: 'false' }).stdout.split('\n')[1],
    '  Alex still works. Send update-log.txt from your Desktop to whoever set this up.',
    'only the exact value "true" means online'
  );
});

test('002-install-state-seed declining in a cloud session is recorded as not-applicable and prints nothing; on a laptop, or under any other id, a decline stays pending and asks for help', (t) => {
  const declines = "module.exports = { run: () => ({ status: 'declined', message: 'not here.' }) };\n";
  const x = tree(t, { '002-install-state-seed.js': declines, '003-other.js': declines });
  const laptopLines =
    '  One setup step was skipped: not here.\n  Alex still works. Send update-log.txt from your Desktop to whoever set this up.\n';
  const onlineLines =
    '  One setup step was skipped: not here.\n  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.\n';
  assert.deepEqual(
    [x.run().stdout, x.run([], { CLAUDE_CODE_REMOTE: 'false' }).stdout],
    [laptopLines.repeat(2), laptopLines.repeat(2)]
  );
  assert.ok(!x.hasLedger(), 'on a laptop 002 stays pending like any decline');
  const online = x.run([], { CLAUDE_CODE_REMOTE: 'true' });
  assert.deepEqual(
    [online.status, online.stdout, online.stderr],
    [0, onlineLines, ''],
    'only the other id asks for help'
  );
  const rows = x.ledgerRows();
  assert.deepEqual(
    rows.map((a) => `${a.id}/${a.status}`),
    ['002-install-state-seed/not-applicable']
  );
  assert.deepEqual(Object.keys(rows[0]), ['date', 'id', 'status']);
  assert.match(rows[0].date, TODAY);
  assert.equal(x.run([], { CLAUDE_CODE_REMOTE: 'true' }).stdout, onlineLines, 'recorded, so 002 never runs again here');
  assert.equal(x.run(['--list']).stdout, '  [done]    002-install-state-seed\n  [pending] 003-other\n');

  // The not-applicable leg requires BOTH the exact status 'declined' and the one listed id; each fixture
  // isolates one of the two, online, where the silent record is possible at all.
  const failed = tree(t, {
    '002-install-state-seed.js': "module.exports = { run: () => ({ status: 'failed', message: 'x' }) };\n"
  });
  const failedOnline = failed.run([], { CLAUDE_CODE_REMOTE: 'true' });
  assert.deepEqual(
    [failedOnline.status, failedOnline.stdout, failedOnline.stderr],
    [
      0,
      '  One setup step was skipped: x\n  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.\n',
      ''
    ],
    '002-install-state-seed returning an outcome that is not applied, skipped or declined still alarms online'
  );
  assert.ok(!failed.hasLedger(), 'a non-decline outcome from the frozen 002 is never silently recorded');

  const lookalike = tree(t, {
    '102-install-state-seed.js': "module.exports = { run: () => ({ status: 'declined', message: 'y' }) };\n"
  });
  const lookalikeOnline = lookalike.run([], { CLAUDE_CODE_REMOTE: 'true' });
  assert.deepEqual(
    [lookalikeOnline.status, lookalikeOnline.stdout, lookalikeOnline.stderr],
    [
      0,
      '  One setup step was skipped: y\n  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.\n',
      ''
    ],
    'a decline under a lookalike id (not the one listed id) still alarms online'
  );
  assert.ok(
    !lookalike.hasLedger(),
    'the lookalike id is not the one CLOUD_NOT_APPLICABLE names, so it is never recorded'
  );
  assert.equal(
    lookalike.run(['--list']).stdout,
    '  [pending] 102-install-state-seed\n',
    'still [pending] in --list, so a later run can finish it'
  );
});

test('a migration that throws: two plain lines, the next one still runs, nothing recorded for it, exit 0', (t) => {
  const x = tree(t, {
    '001-x.js': "module.exports = { run: () => { throw new Error('the disk is full'); } };\n",
    '002-b.js': COUNTER('b')
  });
  const r = x.run();
  assert.deepEqual([r.status, r.stderr], [0, '']);
  assert.equal(
    r.stdout,
    '  Could not finish one setup step. Nothing was changed by it.\n  Details for whoever set this up: 001-x: the disk is full\n    working on b\n  b ran\n'
  );
  assert.deepEqual(
    x.ledgerRows().map((a) => a.id),
    ['002-b']
  );
});

test('a ledger with a byte-order mark is read (the runner strips it)', (t) => {
  const x = tree(
    t,
    { '001-a.js': COUNTER('a') },
    { ledger: `\uFEFF${JSON.stringify({ applied: [{ id: '001-a', status: 'applied', date: '2026-01-01' }] })}` }
  );
  assert.equal(x.run().stdout, 'Nothing new to set up.\n');
  assert.equal(x.count('a'), 0);
});

test("PINNED DEFECT R4-5: a damaged ledger re-runs every migration and rewrites the history with only this run's rows", (t) => {
  // 002-s applies once, then (like 002-install-state-seed) reports skipped when its work is already there.
  const selfChecking =
    "const fs = require('fs'); const p = require('path');\nmodule.exports = { run: ({ root }) => { const f = p.join(root, 'done-s'); if (fs.existsSync(f)) return { status: 'skipped', message: 'already there.' }; fs.writeFileSync(f, 'x'); return { status: 'applied', message: 'did it.' }; } };\n";
  const x = tree(t, { '001-a.js': COUNTER('a'), '002-s.js': selfChecking });
  x.run();
  assert.deepEqual(
    x.ledgerRows().map((a) => `${a.id}/${a.status}`),
    ['001-a/applied', '002-s/applied']
  );
  fs.writeFileSync(path.join(x.d, 'system', 'migrations-applied.json'), '{"applied": [ {"id":"001-a"');
  const r = x.run();
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '    working on a\n  a ran\n  already there.\n', 'no word about the damaged record');
  assert.equal(x.count('a'), 2, 'the non-idempotent migration ran a second time');
  assert.deepEqual(
    x.ledgerRows().map((a) => `${a.id}/${a.status}`),
    ['001-a/applied', '002-s/skipped'],
    '002-s now reads as never having applied'
  );
  assert.ok(x.ledgerRows().every((a) => TODAY.test(a.date)));
});

test('a mistyped flag such as --dryrun refuses with exit 1 and applies nothing', (t) => {
  const x = tree(t, { '001-a.js': COUNTER('a') });
  const r = x.run(['--dryrun']);
  assert.deepEqual(
    [r.status, r.stdout, r.stderr],
    [1, '', 'run-migrations: unknown flag --dryrun; this command takes --dry-run, --list\n']
  );
  assert.equal(x.count('a'), 0, 'nothing ran');
  assert.ok(!x.hasLedger(), 'nothing was written');
});

test('a string row counts as applied, so the migration does not run again', (t) => {
  const x = tree(t, { '001-a.js': COUNTER('a') }, { ledger: JSON.stringify({ applied: ['001-a'] }) });
  const r = x.run();
  assert.deepEqual([r.status, r.stdout], [0, 'Nothing new to set up.\n']);
  assert.equal(x.count('a'), 0, 'not run again: the ledger already names it');
  assert.deepEqual(x.ledgerRows(), ['001-a'], 'the string row is healed as itself, not rewritten to an object');
});

test('PINNED DEFECT R4-L9: a ledger row the JSON standard refuses (a camelCase key) crashes the run with exit 1', (t) => {
  const x = tree(
    t,
    { '001-a.js': COUNTER('a') },
    { ledger: JSON.stringify({ applied: [{ id: '001-a', status: 'applied', appliedAt: '2026-01-01' }] }) }
  );
  const r = x.run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /appliedAt/);
});

test('PINNED DEFECT R4-L10: an async migration is a silent decline: never recorded, no reason given, its own message lost', (t) => {
  const x = tree(t, {
    '001-a.js': "module.exports = { run: async () => ({ status: 'applied', message: 'done' }) };\n"
  });
  const r = x.run();
  const [first, second] = r.stdout.split('\n');
  // Held without the exact punctuation, which the pinned no-message case below tests on its own: a fix to
  // the colon must not flip this one.
  assert.ok(first.startsWith('  One setup step was skipped'), first);
  assert.ok(!r.stdout.includes('done'), "the migration's own message never printed");
  assert.equal(second, '  Alex still works. Send update-log.txt from your Desktop to whoever set this up.');
  assert.ok(!x.hasLedger());
});

test('PINNED DEFECT R4-L11: a decline with no message prints a dangling colon', (t) => {
  const x = tree(t, { '001-d.js': "module.exports = { run: () => ({ status: 'declined' }) };\n" });
  assert.equal(x.run().stdout.split('\n')[0], '  One setup step was skipped: ');
});
