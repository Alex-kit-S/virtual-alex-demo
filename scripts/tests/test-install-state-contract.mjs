#!/usr/bin/env node
// @ts-check
// scripts/tests/test-install-state-contract.mjs - holds scripts/lib/install-state.js to what its readers read.
//
// WHAT. Both Update-Alex launchers and /update call stamp() by path with node -e
// (scripts/tests/test-update-command-contract.mjs runs those texts); /update and /support-bundle read
// template_commit; validate-alex V9 reads template_updated_at; /alex-status and the brief print `line` as it
// prints. scripts/tests/test-install-state.mjs holds the one-writer and one-schema legs. This file holds the
// record's exact bytes, read()'s normalisation, stamp()'s argument handling, every `line` sentence and the
// command line's exits. Deleted, it would let a change move a byte /update commits, reword a sentence a
// Routine prints, loosen the sha check or flip `line`'s exit 0, with nothing in CI noticing.
//
// HOW. Fixture roots in the OS temp directory, each removed after its test; describe() in-process with an
// explicit day, the command line with ALEX_TODAY, the clock the code already reads. A test named "PINNED
// DEFECT <id>" asserts behaviour known to be wrong; the fix flips exactly that assertion.
//
// NEVER. Reads or writes this checkout's record. Fixes a defect it pins: an empty record {} reads as a record
// (R4-12), re-stamping the same commit erases the real previous one (R4-L4), a 7-character sha is accepted
// (R4-L5), `at` is written unvalidated (R4-L6), a record with a byte-order mark reads as no record (R4-L7),
// and one damaged last changelog row hides the whole build (R4-L8).
//
// Usage: node scripts/tests/test-install-state-contract.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = path.join(ROOT, 'scripts', 'lib', 'install-state.js');
const S = require(LIB);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const TAIL = 'Type /update to see whether a newer build is waiting.';

/**
 * A fixture root holding system/ and the given files, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [files] a repo-relative path to its text
 */
const root = (t, files = {}) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-ist-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'system'));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(d, rel), text);
  return d;
};
/** @param {string} d a fixture root */
const recText = (d) => fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8');
/**
 * The library's command line as a child; ALEX_TODAY reaches it only when `env` sets it.
 * @param {string[]} args
 * @param {Record<string, string>} [env]
 */
const cli = (args, env = {}) => {
  const e = { ...process.env, ...env };
  if (!('ALEX_TODAY' in env)) delete e.ALEX_TODAY;
  return spawnSync(process.execPath, [LIB, ...args], { encoding: 'utf8', env: e });
};

test('the exports and their values', () => {
  assert.deepEqual(Object.keys(S).sort(), ['LEGACY', 'REL', 'SCHEMA', 'describe', 'read', 'stamp']);
  assert.equal(S.REL, 'system/install-state.json');
  assert.equal(S.SCHEMA, 'install-state@1');
  // LEGACY by its keys and a round trip, never by spelling the two camelCase names: test-install-state.mjs I6
  // fails any tracked file but itself that names them, and its I2 already holds the four names one by one.
  assert.deepEqual(Object.keys(S.LEGACY), [
    'template_commit',
    'previous_template_commit',
    'template_updated_at',
    'stamped_by'
  ]);
  assert.deepEqual([S.LEGACY.template_commit, S.LEGACY.template_updated_at], ['head', 'updatedAt']);
});

test('read() maps every LEGACY name onto its current key (the whole migration of an old record)', (t) => {
  const legacy = Object.fromEntries(Object.values(S.LEGACY).map((k, i) => [k, `v${i}`]));
  assert.deepEqual(
    S.read(root(t, { [S.REL]: JSON.stringify(legacy) })),
    Object.fromEntries(Object.keys(S.LEGACY).map((k, i) => [k, `v${i}`]))
  );
});

test("stamp writes these exact bytes (the JSON standard's header, keys sorted, two-space indent, LF) and returns the record it read back", (t) => {
  const d = root(t);
  const back = S.stamp(d, A.toUpperCase(), { by: 'a test', at: '2026-09-24' });
  assert.deepEqual(back, {
    template_commit: A,
    previous_template_commit: null,
    template_updated_at: '2026-09-24',
    stamped_by: 'a test'
  });
  const text = recText(d);
  const stampAt = JSON.parse(text)._generated_at;
  assert.match(stampAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(
    text,
    `{\n  "_generated_at": "${stampAt}",\n  "_purpose": "Which template version this copy carries, and when it got there.",\n  "_schema": "install-state@1",\n  "_writer": "scripts/lib/install-state.js",\n  "previous_template_commit": null,\n  "stamped_by": "a test",\n  "template_commit": "${A}",\n  "template_updated_at": "2026-09-24"\n}\n`
  );
});

test('stamp() throws, naming both commits, when the record it wrote does not read back as that commit', (t) => {
  const d = root(t);
  const rec = path.join(d, 'system', 'install-state.json');
  const realRename = fs.renameSync;
  const realRead = fs.readFileSync;
  let landed = false;
  t.mock.method(fs, 'renameSync', (/** @type {string} */ from, /** @type {string} */ to) => {
    realRename(from, to);
    if (path.resolve(String(to)) === rec) landed = true;
  });
  t.mock.method(fs, 'readFileSync', (/** @type {any} */ file, /** @type {any} */ options) => {
    const text = realRead(file, options);
    return landed && path.resolve(String(file)) === rec ? String(text).replace(A, B) : text;
  });
  assert.throws(() => S.stamp(d, A, { by: 'x', at: '2026-09-24' }), {
    message: `install-state: wrote ${A} but read back ${B}`
  });
});

test('stamp with no `by` says "unknown"; with no `at` it writes today\'s UTC day; the old commit becomes previous', (t) => {
  const d = root(t);
  S.stamp(d, A);
  S.stamp(d, B);
  const j = JSON.parse(recText(d));
  assert.equal(j.stamped_by, 'unknown');
  assert.equal(j.previous_template_commit, A);
  assert.match(j.template_updated_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('stamp refuses a non-sha with a plain Error naming it, and writes nothing', (t) => {
  const d = root(t);
  for (const bad of ['', 'xyz', 'abc12', `${A}0`, null, undefined]) {
    assert.throws(() => S.stamp(d, bad), { message: `install-state: "${bad}" is not a commit sha; nothing written` });
  }
  assert.ok(!fs.existsSync(path.join(d, 'system', 'install-state.json')));
});

test('read(): null for no file, unparseable text, an array or a scalar; empty strings read as null; numbers as strings', (t) => {
  assert.equal(S.read(root(t)), null);
  for (const text of ['{', '[]', '"x"', '42', 'null'])
    assert.equal(S.read(root(t, { 'system/install-state.json': text })), null, text);
  assert.deepEqual(
    S.read(
      root(t, {
        'system/install-state.json': JSON.stringify({ template_commit: '', stamped_by: 7, template_updated_at: null })
      })
    ),
    { template_commit: null, previous_template_commit: null, template_updated_at: null, stamped_by: '7' }
  );
  assert.deepEqual(
    S.read(root(t, { 'system/install-state.json': JSON.stringify({ template_commit: A, head: B }) })).template_commit,
    A,
    'the current key wins over the legacy one'
  );
});

// ------------------------------------------------------------------ the `line` sentence
test("line: every sentence shape, from VERSION, from the changelog, from nothing, and the record's three parts", (t) => {
  /**
   * @param {string} text the VERSION line
   * @param {Record<string, string>} [extra] more fixture files
   */
  const v = (text, extra = {}) => root(t, { VERSION: text, ...extra });
  const V41 = 'Virtual Alex template build 41, 2026-09-24, from Kit commit fd41fcf00000\n';
  assert.equal(
    S.describe(v(V41), '2026-09-24'),
    `Alex is on template build 41, built 2026-09-24 (today); this copy has not run /update yet. ${TAIL}`
  );
  assert.equal(
    S.describe(v(V41), '2026-09-25'),
    `Alex is on template build 41, built 2026-09-24 (1 day ago); this copy has not run /update yet. ${TAIL}`
  );
  assert.equal(
    S.describe(v(V41), '2026-10-04'),
    `Alex is on template build 41, built 2026-09-24 (10 days ago); this copy has not run /update yet. ${TAIL}`
  );
  assert.equal(
    S.describe(v(V41), '2026-09-01'),
    `Alex is on template build 41, built 2026-09-24; this copy has not run /update yet. ${TAIL}`,
    'a build from the future carries no age'
  );
  assert.equal(
    S.describe(v(V41), 'not a day'),
    `Alex is on template build 41, built 2026-09-24; this copy has not run /update yet. ${TAIL}`
  );
  /** @param {string} rows the changelog's text */
  const cl = (rows) => root(t, { 'system/template-changelog.jsonl': rows });
  assert.equal(
    S.describe(cl('{"at":"2026-09-20T10:00:00Z"}\n{"at":"2026-09-21T10:00:00Z"}\n'), '2026-09-21'),
    `Alex is on template build 2, built 2026-09-21 (today); this copy has not run /update yet. ${TAIL}`,
    'legacy rows count by position'
  );
  assert.equal(
    S.describe(cl('{"at":"x","build":7}\n'), '2026-09-21'),
    `Alex is on template build 7, built on an unrecorded date; this copy has not run /update yet. ${TAIL}`
  );
  assert.equal(
    S.describe(
      v('an old laptop VERSION\n', { 'system/template-changelog.jsonl': '{"at":"2026-09-20T10:00:00Z","build":3}\n' }),
      '2026-09-20'
    ),
    `Alex is on template build 3, built 2026-09-20 (today); this copy has not run /update yet. ${TAIL}`,
    'a VERSION the regex does not read falls back to the changelog'
  );
  assert.equal(
    S.describe(root(t), '2026-09-20'),
    `Alex is on template build unknown (this copy holds no VERSION and no changelog); this copy has not run /update yet. ${TAIL}`
  );
  const stamped = v(V41, { 'system/install-state.json': JSON.stringify({ template_commit: A }) });
  assert.equal(
    S.describe(stamped, '2026-09-24'),
    `Alex is on template build 41, built 2026-09-24 (today); this copy was updated to it on an unrecorded date by an unrecorded writer, template commit aaaaaaa. ${TAIL}`
  );
});

test('line CLI: --root, ALEX_TODAY as the clock, one line, exit 0 always; anything else is usage on stderr with exit 1', (t) => {
  const d = root(t, { VERSION: 'Virtual Alex template build 9, 2026-09-01, from Kit commit 000000000000\n' });
  const r = cli(['line', '--root', d], { ALEX_TODAY: '2026-09-03' });
  assert.deepEqual(
    [r.status, r.stdout, r.stderr],
    [0, `Alex is on template build 9, built 2026-09-01 (2 days ago); this copy has not run /update yet. ${TAIL}\n`, '']
  );
  fs.writeFileSync(path.join(d, S.REL), '{'); // a planted fixture, named through the library's own constant
  assert.equal(
    cli(['line', '--root', d], { ALEX_TODAY: '2026-09-03' }).status,
    0,
    'an unreadable record still exits 0'
  );
  for (const args of [[], ['lines'], ['--root', d]]) {
    const u = cli(args);
    assert.deepEqual(
      [u.status, u.stdout, u.stderr],
      [1, '', 'usage: node scripts/lib/install-state.js line [--root <dir>]\n'],
      args.join(' ')
    );
  }
});

// ------------------------------------------------------------------ the defects
test('PINNED DEFECT R4-12: an empty record {} reads as a record of four nulls (truthy), which is what makes migration 002 skip', (t) => {
  const r = S.read(root(t, { 'system/install-state.json': '{}' }));
  assert.deepEqual(r, {
    template_commit: null,
    previous_template_commit: null,
    template_updated_at: null,
    stamped_by: null
  });
});

test('PINNED DEFECT R4-L4: re-stamping the commit a copy already carries erases the real previous commit', (t) => {
  const d = root(t);
  S.stamp(d, A, { by: 'x', at: '2026-09-01' });
  S.stamp(d, B, { by: 'x', at: '2026-09-02' });
  S.stamp(d, B, { by: 'Update-Alex.cmd', at: '2026-09-03' });
  const j = JSON.parse(recText(d));
  assert.equal(j.previous_template_commit, B, 'previous = current; commit A is gone');
});

test('PINNED DEFECT R4-L5: a 7-character sha is accepted and written as the version', (t) => {
  const d = root(t);
  assert.equal(S.stamp(d, 'fd41fcf', { by: 'x' }).template_commit, 'fd41fcf');
});

test('PINNED DEFECT R4-L6: `at` is written unvalidated, and `line` repeats it to the owner', (t) => {
  const d = root(t, { VERSION: 'Virtual Alex template build 1, 2026-09-01, from Kit commit 000000000000\n' });
  S.stamp(d, A, { by: 'x', at: 'not-a-date' });
  assert.equal(
    S.describe(d, '2026-09-01'),
    `Alex is on template build 1, built 2026-09-01 (today); this copy was updated to it on not-a-date by x, template commit aaaaaaa. ${TAIL}`
  );
});

test('PINNED DEFECT R4-L7: a record that starts with a byte-order mark reads as no record', (t) => {
  const d = root(t, { 'system/install-state.json': `\uFEFF${JSON.stringify({ template_commit: A })}` });
  assert.equal(S.read(d), null);
  assert.match(S.describe(d, '2026-09-01'), /; this copy has not run \/update yet\. /);
  S.stamp(d, B, { by: 'x' });
  assert.equal(JSON.parse(recText(d)).previous_template_commit, null, 'the next stamp loses the old commit');
});

test('PINNED DEFECT R4-L8: one damaged LAST changelog row hides the whole build, though the rows before it are fine', (t) => {
  const d = root(t, {
    'system/template-changelog.jsonl':
      '{"at":"2026-09-20T10:00:00Z","build":1}\n{"at":"2026-09-21T10:00:00Z","build":2}\n{broken\n'
  });
  assert.equal(
    S.describe(d, '2026-09-21'),
    `Alex is on template build unknown (this copy holds no VERSION and no changelog); this copy has not run /update yet. ${TAIL}`
  );
});
