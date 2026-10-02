#!/usr/bin/env node
// @ts-check
// scripts/tests/test-run-log-read.mjs - the run-log reader on every line shape its three callers meet.
//
// WHAT. Proves scripts/lib/run-log-read.js: an absent log is null, a path through a file included, and an
// empty one is empty; every line that parses is a row in file order, whatever it parses to; every line
// that does not is kept apart with its 1-based number and its text; blank lines, which String#trim
// decides, are neither and still count toward the numbering; a CRLF line reads like an LF one, and a lone
// carriage return splits nothing; padding outside JSON's own white space is refused unless the caller
// asks for a trim. Deleted, it would let the reader drop a torn line without a trace, shift the line
// numbers scripts/run-log.mjs prints, turn a missing log into an empty one, split at a lone carriage
// return and so read a stale log as fresh, call a line of white space unparseable, or quietly start
// trimming for the heartbeat check and the recovery sweep, with every other test green.
//
// HOW. Writes each fixture into a temp folder as literal bytes, calls readRunLog on it, and compares the
// whole result. One case reads a folder at the path, one compares the file's bytes before and after a
// read, and one loads the module both ways.
//
// NEVER. Writes outside its own temp folder, which it removes at the end.
//
// Usage: node scripts/tests/test-run-log-read.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readRunLog } from '../lib/run-log-read.js';

const MODULE = fileURLToPath(new URL('../lib/run-log-read.js', import.meta.url));
const require = createRequire(import.meta.url);
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'test-run-log-read-'));

after(() => fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 }));

const ROW_A = '{"at":"2026-01-01T00:00:00Z","job":"triage"}';
const ROW_B = '{"at":"2026-01-02T00:00:00Z","job":"brief"}';
const A = { at: '2026-01-01T00:00:00Z', job: 'triage' };
const B = { at: '2026-01-02T00:00:00Z', job: 'brief' };

let fixtures = 0;
/**
 * A log in the temp folder holding exactly these bytes.
 * @param {string} bytes
 */
function logWith(bytes) {
  const file = path.join(TEMP, `log-${++fixtures}.jsonl`);
  fs.writeFileSync(file, bytes, 'utf8');
  return file;
}

describe('an absent or empty log', () => {
  test('nothing at the path is null, not an empty log', () => {
    assert.equal(readRunLog(path.join(TEMP, 'absent.jsonl')), null);
    assert.equal(readRunLog(path.join(TEMP, 'no-such-folder', 'run-log.jsonl')), null);
  });

  test('a path through a file where a folder should be is null too, as fs.existsSync reads it', () => {
    assert.equal(readRunLog(path.join(logWith(ROW_A), 'run-log.jsonl')), null);
  });

  test('an empty file, and one of blank lines only, hold no rows and nothing unparseable', () => {
    assert.deepEqual(readRunLog(logWith('')), { rows: [], unparseable: [] });
    assert.deepEqual(readRunLog(logWith('\n \n\t\r\n\n')), { rows: [], unparseable: [] });
  });

  test('a line String#trim empties is blank even outside JSON white space: a BOM, a no-break space, U+2028', () => {
    const bytes = '\uFEFF\n\u00A0\n\u2028\n';
    assert.deepEqual(readRunLog(logWith(bytes)), { rows: [], unparseable: [] });
    assert.deepEqual(readRunLog(logWith(bytes), { trim: true }), { rows: [], unparseable: [] });
  });
});

describe('rows', () => {
  test('are every line that parses, in file order, with or without a final line break', () => {
    assert.deepEqual(readRunLog(logWith(`${ROW_B}\n${ROW_A}\n`)), { rows: [B, A], unparseable: [] });
    assert.deepEqual(readRunLog(logWith(`${ROW_B}\n${ROW_A}`)), { rows: [B, A], unparseable: [] });
  });

  test('a CRLF line reads like an LF one, its carriage return dropped', () => {
    assert.deepEqual(readRunLog(logWith(`${ROW_A}\r\nnot json\r\n${ROW_B}\r\n`)), {
      rows: [A, B],
      unparseable: [{ line: 2, text: 'not json' }]
    });
  });

  test('a lone carriage return is no line break: the rows it joins are one unparseable line, never rows', () => {
    const joined = `${ROW_B}\r${ROW_B}`;
    for (const trim of [false, true])
      assert.deepEqual(readRunLog(logWith(`${ROW_A}\n${joined}\n`), { trim }), {
        rows: [A],
        unparseable: [{ line: 2, text: joined }]
      });
    assert.deepEqual(readRunLog(logWith('a\rb')), { rows: [], unparseable: [{ line: 1, text: 'a\rb' }] });
  });

  test('a line that parses to anything but an object is still a row, for the caller to judge', () => {
    const log = readRunLog(logWith('null\n5\n"text"\n[1,2]\ntrue\n{}\n'));
    assert.deepEqual(log, { rows: [null, 5, 'text', [1, 2], true, {}], unparseable: [] });
  });
});

describe('unparseable lines', () => {
  test('a torn last line is kept with its 1-based number and its text, the rows before it whole', () => {
    const torn = '{"at":"2026-01-03T00:00:00Z","jo';
    assert.deepEqual(readRunLog(logWith(`${ROW_A}\n${ROW_B}\n${torn}`)), {
      rows: [A, B],
      unparseable: [{ line: 3, text: torn }]
    });
  });

  test('a blank line is neither a row nor unparseable, and still counts toward the numbering', () => {
    assert.deepEqual(readRunLog(logWith(`${ROW_A}\n\n   \nnot json\n${ROW_B}\n`)), {
      rows: [A, B],
      unparseable: [{ line: 4, text: 'not json' }]
    });
  });

  test('the numbering is the line number an editor shows, so a warning points at the right line', () => {
    const bytes = `${ROW_A}\nfirst torn\n${ROW_B}\r\n\nsecond torn\n`;
    const log = readRunLog(logWith(bytes));
    assert.ok(log);
    for (const { line, text } of log.unparseable) assert.equal(bytes.split('\n')[line - 1].trim(), text);
    assert.deepEqual(
      log.unparseable.map((u) => u.line),
      [2, 5]
    );
  });
});

describe('padding around a line', () => {
  const bom = `\uFEFF${ROW_A}`;
  const nbsp = `${ROW_B}\u00A0`;

  test('of JSON white space is read, and a byte-order mark or a non-breaking space refuses the line by default', () => {
    assert.deepEqual(readRunLog(logWith(`${bom}\n  ${ROW_A}\t\n${nbsp}\n`)), {
      rows: [A],
      unparseable: [
        { line: 1, text: bom },
        { line: 3, text: nbsp }
      ]
    });
  });

  test('is trimmed first when the caller asks, and the numbering is unchanged', () => {
    assert.deepEqual(readRunLog(logWith(`${bom}\n  ${ROW_A}\t\n${nbsp}\nnot json\n`), { trim: true }), {
      rows: [A, A, B],
      unparseable: [{ line: 4, text: 'not json' }]
    });
  });
});

describe('the file itself', () => {
  test('is never changed by a read, a torn line included', () => {
    const bytes = `${ROW_A}\r\n{"at":"2026-01-03`;
    const file = logWith(bytes);
    readRunLog(file);
    readRunLog(file, { trim: true });
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  });

  test('a folder at the path throws the error fs gives, never reads as absent or empty', () => {
    const folder = path.join(TEMP, 'a-folder.jsonl');
    fs.mkdirSync(folder);
    assert.throws(() => readRunLog(folder), { code: 'EISDIR' });
  });
});

test('an import and a require load the one function', () => {
  assert.equal(require(MODULE).readRunLog, readRunLog);
  assert.deepEqual(Object.keys(require(MODULE)), ['readRunLog']);
});
