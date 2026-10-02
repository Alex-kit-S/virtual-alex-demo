#!/usr/bin/env node
// @ts-check
// scripts/tests/test-install-profile-cli.mjs - holds install-profile.js's command line, its writes and toPayload.
//
// WHAT. What scripts/tests/test-install-profile.mjs does not hold. skills-park.js writes every profile through
// writeProfile(), docs/json-standard.md tells a maintainer to run the --write-example command line, and the
// online /setup copies the example as it is. So the exports, that command line's output line and exits, the
// bytes writeProfile writes and toPayload's rules are read by people and by code. Deleted, a reworded line, a
// changed exit, a lost header field or a changed legacy_notes rule would pass CI.
//
// HOW. The writer and the JSON helper are copied from this checkout into a throwaway tree in the OS temp
// directory, because the command line writes next to itself. A test named "PINNED DEFECT <id>" asserts
// behaviour known to be wrong; the fix flips exactly that assertion.
//
// NEVER. Rewrites this checkout's example. Fixes a defect it pins: a hand-written string legacy_notes is
// spread into one key per character and then refused (R4-L21), and a foreign _schema is dropped without a
// check and the file rewritten as install-profile@1 (R4-L22).
//
// Usage: node scripts/tests/test-install-profile-cli.mjs
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
const P = require('../lib/install-profile.js');
const EXAMPLE_REL = 'system/install-profile.example.json';

/**
 * A throwaway tree holding a copy of the writer and the JSON helper, removed when the test ends, and a way to
 * run that copy's command line.
 * @param {import('node:test').TestContext} t
 */
function tree(t) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-prof-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  for (const rel of ['scripts/lib/install-profile.js', 'scripts/lib/json-writer.js', 'scripts/lib/repo-root.js']) {
    fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(d, rel));
  }
  fs.mkdirSync(path.join(d, 'system'));
  /** @param {string[]} args */
  const cli = (args) =>
    spawnSync(process.execPath, [path.join(d, 'scripts', 'lib', 'install-profile.js'), ...args], { encoding: 'utf8' });
  return { d, cli };
}

test('the exports and their values', () => {
  assert.deepEqual(Object.keys(P).sort(), [
    'EXAMPLE',
    'EXAMPLE_REL',
    'PROFILE_REL',
    'SCHEMA',
    'WRITER',
    'toPayload',
    'writeExample',
    'writeProfile'
  ]);
  assert.deepEqual(
    [P.SCHEMA, P.WRITER, P.PROFILE_REL, P.EXAMPLE_REL],
    ['install-profile@1', 'scripts/lib/install-profile.js', 'system/install-profile.json', EXAMPLE_REL]
  );
});

test('--write-example: "unchanged" over the tracked example, "written (<reason>, <bytes> bytes)" over a hand edit, exit 0 both times', (t) => {
  const x = tree(t);
  const tracked = path.join(ROOT, EXAMPLE_REL);
  if (fs.existsSync(tracked)) {
    fs.copyFileSync(tracked, path.join(x.d, EXAMPLE_REL));
    const same = x.cli(['--write-example']);
    assert.deepEqual(
      [same.status, same.stdout, same.stderr],
      [0, 'install-profile: system/install-profile.example.json unchanged\n', '']
    );
    assert.equal(
      fs.readFileSync(path.join(x.d, EXAMPLE_REL), 'utf8'),
      fs.readFileSync(tracked, 'utf8'),
      'the tracked example is exactly what the writer writes'
    );
    fs.writeFileSync(
      path.join(x.d, EXAMPLE_REL),
      fs.readFileSync(tracked, 'utf8').replace('"locale": "en"', '"locale": "xx"')
    );
  }
  const edited = x.cli(['--write-example']);
  assert.equal(edited.status, 0);
  assert.match(edited.stdout, /^install-profile: system\/install-profile\.example\.json written \(.+, \d+ bytes\)\n$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(x.d, EXAMPLE_REL), 'utf8')).locale, 'en');
  assert.equal(x.cli(['--write-example']).stdout, 'install-profile: system/install-profile.example.json unchanged\n');
});

test('anything but exactly --write-example is the usage line on stderr, exit 2', (t) => {
  const x = tree(t);
  for (const args of [[], ['--write'], ['--write-example', 'extra']]) {
    const r = x.cli(args);
    assert.deepEqual(
      [r.status, r.stdout, r.stderr],
      [2, '', 'usage: node scripts/lib/install-profile.js --write-example\n'],
      args.join(' ')
    );
  }
  assert.ok(!fs.existsSync(path.join(x.d, EXAMPLE_REL)));
});

test("writeProfile writes system/install-profile.json with the profile header and returns the helper's result", (t) => {
  const x = tree(t);
  const res = P.writeProfile(x.d, { wake: ['pdf'], park: [], locale: 'tr' });
  assert.equal(res.written, true);
  const j = JSON.parse(fs.readFileSync(path.join(x.d, 'system', 'install-profile.json'), 'utf8'));
  assert.deepEqual(
    { ...j, _generated_at: 'X' },
    {
      _generated_at: 'X',
      _purpose:
        "This machine's own choices: skills woken and parked, lane switches, answer language and radar feeds; never shipped as content.",
      _schema: 'install-profile@1',
      _writer: 'scripts/lib/install-profile.js',
      locale: 'tr',
      park: [],
      wake: ['pdf']
    }
  );
  assert.equal(P.writeProfile(x.d, j).written, false, 'the same content again is a no-op');
});

test('toPayload drops the four header fields, moves every other underscore key into legacy_notes, and refuses a non-object', () => {
  assert.deepEqual(
    P.toPayload({
      _generated_at: 'a',
      _purpose: 'b',
      _schema: 'install-profile@1',
      _writer: 'c',
      _what: 'doc',
      __double: 1,
      wake: []
    }),
    { wake: [], legacy_notes: { what: 'doc', double: 1 } }
  );
  assert.deepEqual(P.toPayload({ legacy_notes: { kept: 1 }, _extra: 2 }), { legacy_notes: { kept: 1, extra: 2 } });
  for (const bad of [null, [], 'x', 3])
    assert.throws(() => P.toPayload(bad), { message: 'install-profile: a profile must be a JSON object' });
});

test('PINNED DEFECT R4-L21: a hand-written STRING legacy_notes is shredded into one key per character, and the write then fails', (t) => {
  const payload = P.toPayload({ legacy_notes: 'kept', _what: 'doc', wake: [] });
  assert.deepEqual(payload.legacy_notes, { 0: 'k', 1: 'e', 2: 'p', 3: 't', what: 'doc' });
  const x = tree(t);
  assert.throws(() => P.writeProfile(x.d, { legacy_notes: 'kept', _what: 'doc', wake: [] }), /legacy_notes/);
  assert.ok(!fs.existsSync(path.join(x.d, 'system', 'install-profile.json')));
});

test('PINNED DEFECT R4-L22: a foreign `_schema` is dropped without a check, and the file is rewritten as install-profile@1', (t) => {
  assert.deepEqual(P.toPayload({ _schema: 'other-thing@3', wake: ['pdf'] }), { wake: ['pdf'] });
  const x = tree(t);
  P.writeProfile(x.d, { _schema: 'other-thing@3', wake: ['pdf'] });
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(x.d, 'system', 'install-profile.json'), 'utf8'))._schema,
    'install-profile@1'
  );
});
