// @ts-check
// scripts/tests/test-run-migrations-ledger.mjs - the ledger goes through the JSON standard and its heal loses nothing.
//
// WHAT. scripts/run-migrations.js is the one writer of system/migrations-applied.json, through the JSON helper,
// and validate-alex V21 checks the file. Deleted, this would let a second writer, a lost record or a run against
// a newer Kit's ledger through, with nothing in CI noticing. What is proven, negative legs first:
//   L1  NEGATIVE a pre-standard ledger is healed on the next ordinary run, keeping every id (V21 fails it else)
//   L2  NEGATIVE a ledger a newer Kit stamped: nothing runs, the file is left byte-identical, the run exits 0
//   L3  a pending migration is recorded through the helper: the four-field header and canonical bytes
//   L4  a second run writes nothing (byte-identical, the same _generated_at)
//   L5  --dry-run writes nothing, not even the heal
//   L6  the shape kit-doctor reads, applied[].id, is intact
//   L7  the source writes the ledger only through writeJson(LEDGER (a second writer would be a bypass)
//   L8  NEGATIVE online a declined step names /support-bundle; on a laptop it still names update-log.txt
//
// HOW. Each case copies the REAL runner and the JSON writer into a throwaway tree under the OS temp directory,
// beside one fixture migration, runs it as a child process and asserts on its output. The shared temp root is
// removed once, after every leg has run.
//
// NEVER. Touches anything in this checkout.
//
// Usage: node scripts/tests/test-run-migrations-ledger.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { auditText } = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-migrations-ledger-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const REL = 'system/migrations-applied.json';

/**
 * A throwaway tree: the real runner and JSON writer, migration 001-already, and 002-fixture when `pending`.
 * @param {string} name the folder under TMP
 * @param {{ ledger?: string, pending?: boolean }} [options] the ledger's text, and whether 002 is pending
 * @returns {string} the tree's root
 */
function tree(name, { ledger, pending = false } = {}) {
  const root = path.join(TMP, name);
  for (const rel of [
    'scripts/run-migrations.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/repo-root.js',
    'scripts/lib/migration-ledger.js',
    'scripts/lib/args.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js'
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(KIT, rel), path.join(root, rel));
  }
  const mig = path.join(root, 'scripts', 'migrations');
  fs.mkdirSync(mig, { recursive: true });
  fs.writeFileSync(
    path.join(mig, '001-already.js'),
    "const fs = require('fs'); const path = require('path');\n" +
      "module.exports = { run: ({ root }) => { fs.writeFileSync(path.join(root, 'ran-001.txt'), 'x'); return { status: 'applied' }; } };\n"
  );
  if (pending) {
    fs.writeFileSync(
      path.join(mig, '002-fixture.js'),
      "const fs = require('fs'); const path = require('path');\n" +
        "module.exports = { run: ({ root }) => { fs.writeFileSync(path.join(root, 'ran-002.txt'), 'x'); return { status: 'applied', message: 'fixture applied' }; } };\n"
    );
  }
  if (ledger !== undefined) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, REL), ledger);
  }
  return root;
}
/**
 * @param {string} root
 * @param {...string} args
 */
const run = (root, ...args) =>
  spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js'), ...args], { encoding: 'utf8' });
/** @param {string} root @returns {string} the ledger's text */
const read = (root) => fs.readFileSync(path.join(root, REL), 'utf8');
const LEGACY = `${JSON.stringify({ applied: [{ id: '001-already', status: 'applied', date: '2026-08-31' }] }, null, 2)}\n`;

describe('scripts/run-migrations.js: the ledger', () => {
  test('L1 NEGATIVE a legacy ledger with nothing pending is healed onto the standard, every record surviving', () => {
    const root = tree('l1', { ledger: LEGACY });
    const before = auditText(REL, read(root));
    assert.ok(
      before.findings.some((/** @type {string} */ f) => /header missing/.test(f)),
      'the fixture really is a pre-standard ledger'
    );
    const r = run(root);
    const after1 = auditText(REL, read(root), { root });
    const j = JSON.parse(read(root));
    assert.equal(r.status, 0, `exit ${r.status}`);
    assert.deepEqual(after1.findings, [], after1.findings.join(' | '));
    assert.equal(j.applied.length, 1);
    assert.equal(j.applied[0].id, '001-already');
    assert.equal(j.applied[0].date, '2026-08-31', 'every record survived the heal, unchanged');
  });

  test('L2 NEGATIVE a foreign schema: nothing runs, the ledger is left byte-identical, exit 0', () => {
    const foreign = `${JSON.stringify({ _generated_at: '2026-09-23T00:00:00Z', _purpose: 'p', _schema: 'migrations-applied@9', _writer: 'scripts/run-migrations.js', applied: [] }, null, 2)}\n`;
    const root = tree('l2', { ledger: foreign, pending: true });
    const r = run(root);
    assert.equal(r.status, 0, `exit ${r.status} (an update is never failed by this runner)`);
    assert.equal(
      fs.existsSync(path.join(root, 'ran-002.txt')),
      false,
      'NEGATIVE nothing ran against a ledger of an unknown schema'
    );
    assert.equal(fs.existsSync(path.join(root, 'ran-001.txt')), false);
    assert.equal(read(root), foreign, 'NEGATIVE the foreign ledger is left byte-identical');
    assert.match(r.stdout, /newer version of Alex/, r.stdout.trim().split('\n')[0]);
    assert.match(r.stdout, /migrations-applied@9/, 'names both schemas');
  });

  test('L3 + L4 a pending migration is recorded through the helper, and a second run writes nothing', () => {
    const root = tree('l3', { ledger: LEGACY, pending: true });
    const r = run(root);
    const text = read(root);
    const j = JSON.parse(text);
    assert.equal(r.status, 0);
    assert.ok(fs.existsSync(path.join(root, 'ran-002.txt')), 'L3 the pending migration ran');
    assert.equal(
      j._schema,
      'migrations-applied@1',
      `L3 the ledger carries the four-field header: ${j._schema} by ${j._writer}`
    );
    assert.equal(j._writer, 'scripts/run-migrations.js');
    assert.match(j._generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.deepEqual(auditText(REL, text, { root }).findings, [], 'L3 the ledger is canonical, byte for byte');
    assert.equal(
      j.applied.map((/** @type {{id:string}} */ a) => a.id).join(','),
      '001-already,002-fixture',
      'L3 both ids recorded, in order'
    );
    const r2 = run(root);
    assert.equal(r2.status, 0);
    assert.equal(read(root), text, 'L4 a second run writes nothing (byte-identical, same _generated_at)');
  });

  test('L5 --dry-run writes nothing, not even the heal', () => {
    const root = tree('l5', { ledger: LEGACY, pending: true });
    run(root, '--dry-run');
    assert.equal(read(root), LEGACY);
    assert.equal(fs.existsSync(path.join(root, 'ran-002.txt')), false);
  });

  test("L6 kit-doctor's read of applied[].id still sees both ids", () => {
    const root = tree('l6', { pending: true });
    run(root);
    const j = JSON.parse(read(root));
    const ran = new Set(
      (j.applied || []).map((/** @type {{id:string}|string} */ a) => (typeof a === 'string' ? a : a.id))
    ); // kit-doctor's own read, verbatim
    assert.ok(ran.has('001-already'));
    assert.ok(ran.has('002-fixture'));
  });

  test('L7 the runner writes the ledger only through writeJson', () => {
    const src = fs.readFileSync(path.join(KIT, 'scripts', 'run-migrations.js'), 'utf8');
    assert.doesNotMatch(src, /writeFileSync\s*\(\s*LEDGER/);
    assert.match(src, /writeJson\(LEDGER/);
  });

  test('L8 NEGATIVE online a declined step names /support-bundle, never a Desktop file; on a laptop it still names update-log.txt', () => {
    const root = tree('l8', { ledger: LEGACY });
    fs.writeFileSync(
      path.join(root, 'scripts', 'migrations', '003-declines.js'),
      "module.exports = { run: () => ({ status: 'declined', message: 'a fixture that declines' }) };\n"
    );
    const online = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js')], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: 'true' }
    });
    const laptop = spawnSync(process.execPath, [path.join(root, 'scripts', 'run-migrations.js')], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: '' }
    });
    assert.equal(online.status, 0);
    assert.match(online.stdout, /\/support-bundle/, online.stdout.trim().split('\n').pop());
    assert.doesNotMatch(online.stdout, /Desktop/);
    assert.equal(laptop.status, 0);
    assert.match(laptop.stdout, /update-log\.txt from your Desktop/, laptop.stdout.trim().split('\n').pop());
  });
});
