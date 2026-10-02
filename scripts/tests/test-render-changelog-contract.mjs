#!/usr/bin/env node
// @ts-check
// scripts/tests/test-render-changelog-contract.mjs - the exact bytes scripts/lib/render-changelog.mjs writes into
// every generated tree, and the defects it keeps, pinned.
//
// WHAT. CHANGELOG.md and VERSION ship in every template, seed and owner repository, and both are read: /update
// and a person read CHANGELOG.md, scripts/lib/install-state.js parses VERSION with its VERSION_BUILD pattern,
// /build (\d+), (\d{4}-\d{2}-\d{2})/, and test-changelog.mjs C8 compares a tree's two files with this render.
// test-changelog.mjs holds the drift legs by regex; this file holds the render byte for byte. Deleted, it would
// let a change reword the introduction, reorder the builds, reword a block or the VERSION line, stop reading CRLF
// rows and blank lines as LF ones, rename an export the builder or test-changelog.mjs imports, point the module
// at another jsonl than the builder writes, or reword a sentence checkTree returns, with every other test green.
//
// HOW. Pure calls, and fixture trees in the OS temp folder. A test named "PINNED DEFECT <id>" asserts behaviour
// known to be wrong; its fix flips exactly that assertion when the defect ledger schedules it.
//
// NEVER. Writes inside the repository it runs in. Fixes a defect it pins (R3-L9, R3-L10, R3-L11): writeChangelog
// writes CHANGELOG.md before an empty jsonl fails VERSION, malformed row fields render as confident prose ("Sensitive
// files: none" for a string list), and an empty jsonl is a valid CHANGELOG.md but a fatal VERSION.
//
// Usage: node scripts/tests/test-render-changelog-contract.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from '../lib/render-changelog.mjs';
import { CHANGELOG_REL } from '../build-online-template.mjs';

/**
 * A fixture tree with a system/ folder and the named files, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} [files] tree path to text
 */
const tree = (t, files = {}) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-rc-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'system'));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(d, rel), text);
  return d;
};
const INTRO = [
  '# Changelog',
  '',
  'Every build of the Virtual Alex template, newest first. This file is generated from',
  '`system/template-changelog.jsonl` each time the template is built, so it always agrees with',
  'that file. Do not edit it by hand: CI compares the two and fails on any difference.',
  '',
  'Sensitive files are the ones that change how Alex behaves: settings, commands, hooks and their',
  'libraries, workflows, Routine orders and `CLAUDE.md`. `/update` names them before it asks for',
  'your yes.'
];
const ROWS = `${[
  '{"at":"2026-09-01T09:05:59Z","changed":800,"files":800,"flagged":["CLAUDE.md",".claude/settings.json"],"kit_commit":"abcdef0123456789abcdef0123456789abcdef01","kit_dirty":false,"previous_template_commit":null}',
  '{"at":"2026-09-02T23:59:00Z","changed":3,"files":801,"flagged":[],"kit_commit":"0000000000001111111111111111111111111111","kit_dirty":true,"previous_template_commit":"1234"}',
  '{"at":"2026-09-03T00:00:00Z","build":3,"changed":0,"files":801,"flagged":["scripts/lib/"],"kit_commit":"ffffffffffffffffffffffffffffffffffffffff","kit_dirty":false,"previous_template_commit":"5678"}'
].join('\n')}\n`;

test('the exports test-changelog and the builder import, and the jsonl path the builder writes', () => {
  assert.deepEqual(Object.keys(R).sort(), [
    'CHANGELOG_JSONL',
    'CHANGELOG_MD',
    'VERSION_FILE',
    'checkTree',
    'parseRows',
    'renderChangelog',
    'renderVersion',
    'writeChangelog'
  ]);
  assert.equal(R.CHANGELOG_MD, 'CHANGELOG.md');
  assert.equal(R.VERSION_FILE, 'VERSION');
  assert.equal(R.CHANGELOG_JSONL, 'system/template-changelog.jsonl');
  assert.equal(R.CHANGELOG_JSONL, CHANGELOG_REL, 'the builder writes the file this module reads');
});

test('the render, byte for byte: the introduction, newest build first, each block in its fixed wording', () => {
  assert.equal(
    R.renderChangelog(ROWS),
    [
      ...INTRO,
      '',
      '## Build 3 (2026-09-03 00:00 UTC)',
      '',
      '- 0 of 801 files changed.',
      '- Sensitive files: `scripts/lib/`.',
      '- Built from Kit commit `ffffffffffff`.',
      '',
      '## Build 2 (2026-09-02 23:59 UTC)',
      '',
      '- 3 of 801 files changed.',
      '- Sensitive files: none.',
      '- Built from Kit commit `000000000000`, with uncommitted changes in the Kit.',
      '',
      '## Build 1 (2026-09-01 09:05 UTC)',
      '',
      '- The first build: 800 files.',
      '- Sensitive files: `CLAUDE.md`, `.claude/settings.json`.',
      '- Built from Kit commit `abcdef012345`.',
      ''
    ].join('\n')
  );
});

test('CRLF rows and blank lines render the same bytes as LF rows', () => {
  assert.equal(R.renderChangelog(`\n${ROWS.replace(/\n/g, '\r\n')}\r\n\r\n`), R.renderChangelog(ROWS));
});

test('a row without "at" or kit_commit says "date unknown" and "unknown", never a guess', () => {
  const md = R.renderChangelog('{"changed":1,"files":2,"flagged":[],"previous_template_commit":"x"}\n');
  assert.ok(
    md.endsWith(
      '\n## Build 1 (date unknown)\n\n- 1 of 2 files changed.\n- Sensitive files: none.\n- Built from Kit commit unknown.\n'
    ),
    md
  );
});

test('VERSION: one line naming the newest build, its day and its Kit commit (12 characters)', () => {
  assert.equal(R.renderVersion(ROWS), 'Virtual Alex template build 3, 2026-09-03, from Kit commit ffffffffffff\n');
  assert.equal(
    R.renderVersion('{"kit_commit":7}\n'),
    'Virtual Alex template build 1, date unknown, from Kit commit unknown\n'
  );
});

test('VERSION is the line scripts/lib/install-state.js reads with /build (\\d+), (\\d{4}-\\d{2}-\\d{2})/; a "date unknown" VERSION does not match it', () => {
  const m = /** @type {RegExpMatchArray} */ (R.renderVersion(ROWS).match(/build (\d+), (\d{4}-\d{2}-\d{2})/));
  assert.deepEqual([m[1], m[2]], ['3', '2026-09-03']);
  assert.equal(/build (\d+), (\d{4}-\d{2}-\d{2})/.test(R.renderVersion('{}\n')), false);
});

test("parseRows numbers rows by position, keeps every field, and throws a plain Error (not the builder's Refusal)", () => {
  const rows = R.parseRows(ROWS);
  assert.deepEqual(
    rows.map((r) => r.build),
    [1, 2, 3]
  );
  assert.equal(rows[1].kit_dirty, true);
  const notJson = /** @type {Error} */ (
    (() => {
      try {
        R.parseRows('{"a":1}\n{broken\n');
      } catch (e) {
        return e;
      }
      return null;
    })()
  );
  assert.equal(notJson.constructor, Error);
  assert.equal(
    notJson.message,
    'system/template-changelog.jsonl row 2 is not JSON; the changelog will not guess what it said'
  );
  const shifted = /** @type {Error} */ (
    (() => {
      try {
        R.parseRows('{"a":1}\n{"build":5}\n');
      } catch (e) {
        return e;
      }
      return null;
    })()
  );
  assert.equal(shifted.constructor, Error);
  assert.equal(shifted.message, 'system/template-changelog.jsonl row 2 says build 5; a row was deleted or inserted');
});

test('writeChangelog returns [] and writes nothing when the tree has no jsonl', (t) => {
  const d = tree(t);
  assert.deepEqual(R.writeChangelog(d), []);
  assert.deepEqual(fs.readdirSync(d), ['system']);
});

test('writeChangelog writes CHANGELOG.md and VERSION (LF, overwriting) and returns their tree paths', (t) => {
  const d = tree(t, { 'system/template-changelog.jsonl': ROWS, 'CHANGELOG.md': 'stale', VERSION: 'stale' });
  assert.deepEqual(R.writeChangelog(d), ['CHANGELOG.md', 'VERSION']);
  assert.equal(fs.readFileSync(path.join(d, 'CHANGELOG.md'), 'utf8'), R.renderChangelog(ROWS));
  assert.equal(fs.readFileSync(path.join(d, 'VERSION'), 'utf8'), R.renderVersion(ROWS));
});

test('checkTree: every disagreement as one exact sentence, and CRLF checkouts agree', (t) => {
  const good = {
    'system/template-changelog.jsonl': ROWS,
    'CHANGELOG.md': R.renderChangelog(ROWS),
    VERSION: R.renderVersion(ROWS)
  };
  assert.deepEqual(R.checkTree(tree(t)), []);
  assert.deepEqual(R.checkTree(tree(t, good)), []);
  assert.deepEqual(
    R.checkTree(
      tree(t, {
        ...good,
        'CHANGELOG.md': good['CHANGELOG.md'].replace(/\n/g, '\r\n'),
        VERSION: good.VERSION.replace(/\n/g, '\r\n')
      })
    ),
    []
  );
  assert.deepEqual(R.checkTree(tree(t, { 'system/template-changelog.jsonl': ROWS })), [
    'system/template-changelog.jsonl exists and CHANGELOG.md does not; the build writes one from the other'
  ]);
  assert.deepEqual(R.checkTree(tree(t, { 'CHANGELOG.md': 'x' })), [
    'CHANGELOG.md exists with no system/template-changelog.jsonl to be the render of'
  ]);
  assert.deepEqual(R.checkTree(tree(t, { ...good, 'system/template-changelog.jsonl': '{x\n' })), [
    'system/template-changelog.jsonl row 1 is not JSON; the changelog will not guess what it said'
  ]);
  const noVersion = tree(t, { 'system/template-changelog.jsonl': ROWS, 'CHANGELOG.md': good['CHANGELOG.md'] });
  assert.deepEqual(R.checkTree(noVersion), [
    'VERSION is not the render of system/template-changelog.jsonl: it reads null, the render reads "Virtual Alex template build 3, 2026-09-03, from Kit commit ffffffffffff\\n"'
  ]);
  const edited = tree(t, { ...good, 'CHANGELOG.md': good['CHANGELOG.md'].replace('- 0 of 801', '- 1 of 801') });
  assert.deepEqual(R.checkTree(edited), [
    'CHANGELOG.md is not the render of system/template-changelog.jsonl: line 13 reads "- 1 of 801 files changed.", the render reads "- 0 of 801 files changed."'
  ]);
  const short = tree(t, { ...good, 'CHANGELOG.md': INTRO.join('\n') });
  assert.deepEqual(R.checkTree(short), [
    'CHANGELOG.md is not the render of system/template-changelog.jsonl: line 10 reads "(end of file)", the render reads ""'
  ]);
});

test('PINNED DEFECT R3-L9: writeChangelog on an empty jsonl writes CHANGELOG.md, then throws before VERSION', (t) => {
  const d = tree(t, { 'system/template-changelog.jsonl': '' });
  assert.throws(() => R.writeChangelog(d), {
    message: 'system/template-changelog.jsonl has no rows, so there is no build to name'
  });
  assert.ok(fs.existsSync(path.join(d, 'CHANGELOG.md')), 'CHANGELOG.md was left behind');
  assert.ok(!fs.existsSync(path.join(d, 'VERSION')));
});

test('PINNED DEFECT R3-L10: malformed row fields render as confident prose', () => {
  const md = R.renderChangelog(
    '{"at":"2026-09-01T00:00:00Z","flagged":"CLAUDE.md","kit_commit":1234,"previous_template_commit":"x"}\n'
  );
  assert.ok(md.includes('\n- undefined of undefined files changed.\n'), 'missing counts print "undefined"');
  assert.ok(md.includes('\n- Sensitive files: none.\n'), 'a flagged STRING naming CLAUDE.md prints "none"');
  assert.ok(md.includes('\n- Built from Kit commit unknown.\n'), 'a numeric kit_commit prints "unknown"');
});

test('PINNED DEFECT R3-L11: an empty jsonl is a valid CHANGELOG.md (the introduction alone) and a fatal VERSION', () => {
  assert.equal(R.renderChangelog(''), `${INTRO.join('\n')}\n`);
  assert.throws(() => R.renderVersion(''), {
    message: 'system/template-changelog.jsonl has no rows, so there is no build to name'
  });
});
