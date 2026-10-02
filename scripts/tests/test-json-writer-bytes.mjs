#!/usr/bin/env node
// @ts-check
// scripts/tests/test-json-writer-bytes.mjs - the JSON writer's output pinned byte for byte, and its two readers.
//
// WHAT. Proves scripts/lib/json-writer.js writes exactly these bytes for every value shape it accepts, orders
// keys by UTF-16 code unit at every depth (integer-like keys included) with the header first, refuses every
// value, key and header it does not accept with its exact class and message and leaves nothing behind, never
// rewrites unchanged content, repairs damaged bytes under the original stamp, replaces a file atomically,
// reads a headered file by its schema, and reads a headerless one exactly as JSON.parse over its text would.
// The bytes are a contract: the audit and V21 compare every enforced file against canonicalText of its
// parsed content plus a line break, and three JSON Lines writers build their rows from canonicalText.
// Deleted, it would let one changed byte of any value shape, a reworded refusal, a lost repair, a
// half-written file or a reader that wraps or swallows an error through, with every other test green.
//
// HOW. Writes with a fixed clock into a temp folder and compares whole files, whole messages and whole
// return values. The atomic replace is proven through the real writeJson, with fs.renameSync and
// fs.writeSync swapped for ones that fail. The headerless reader is compared with the raw expression it
// replaces, on the same files. Every non-ASCII and every control character is built with
// String.fromCharCode, so this file stays plain ASCII.
//
// NEVER. Writes outside its temp folder, which it removes at the end. Asserts a fix for a defect it pins:
// each pinned test says in its title what the writer does today (a sparse array written as invalid JSON, a
// nested header key the audit then flags, a circular value's RangeError, a numeric stamp and the clock its
// repair takes, an identifier map's integer-like keys, and the lost POSIX file mode, skipped on Windows),
// and stays as it is until the defect ledger schedules the fix.
//
// Usage: node scripts/tests/test-json-writer-bytes.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-jw-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const W = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const A = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));

const c = String.fromCharCode;
const BS = c(92);
const STAMP = '2000-01-01T00:00:00Z';
const M = { purpose: 'p', writer: 'scripts/w.js', schema: 'zz@1', generatedAt: STAMP };
let n = 0;
const F = (name = `f${++n}.json`) => path.join(TMP, name);
/** @param {string} f */
const read = (f) => fs.readFileSync(f, 'utf8');
const HEADER = `{\n  "_generated_at": "${STAMP}",\n  "_purpose": "p",\n  "_schema": "zz@1",\n  "_writer": "scripts/w.js",\n`;
/**
 * What a call throws: its class, whether it is the writer's own refusal, and its message; or 'no error'.
 * @param {() => unknown} fn
 * @returns {any[]} its class, true or false, and its message
 */
function refusal(fn) {
  try {
    fn();
  } catch (e) {
    return [
      /** @type {Error} */ (e).constructor.name,
      e instanceof W.JsonWriterError,
      /** @type {Error} */ (e).message
    ];
  }
  return ['no error'];
}

// ---------------------------------------------------------------- the byte contract
test('every accepted value shape, written with a fixed clock, is exactly these bytes (the V21 contract)', () => {
  const unicode = `sk${c(0xe4)}rg${c(0xe5)}rd ${c(0x645, 0x631, 0x62d, 0x628, 0x627)} ${String.fromCodePoint(0x1f600)}`;
  const escapes = `q"b${BS}t${c(9)}c${c(1)} ${c(0x2028)}${c(0xd800)}${c(0x7f)}`;
  const data = {
    a_null: null,
    b_true: true,
    c_false: false,
    d_int: 42,
    e_neg_zero: -0,
    f_exp: 1e21,
    g_small: 1e-7,
    h_frac: 0.1,
    i_neg: -3.5,
    j_max: Number.MAX_SAFE_INTEGER,
    k_str: 'plain',
    l_unicode: unicode,
    m_escapes: escapes,
    n_empty_arr: [],
    o_empty_obj: {},
    p_nested: { z: [1, [2, { y: null }]], a: { b: {} } },
    q_null_proto: Object.assign(Object.create(null), { k: 1 })
  };
  const f = F();
  const r = W.writeJson(f, data, M);
  const expected =
    HEADER +
    '  "a_null": null,\n  "b_true": true,\n  "c_false": false,\n  "d_int": 42,\n  "e_neg_zero": 0,\n  "f_exp": 1e+21,\n' +
    '  "g_small": 1e-7,\n  "h_frac": 0.1,\n  "i_neg": -3.5,\n  "j_max": 9007199254740991,\n  "k_str": "plain",\n' +
    `  "l_unicode": "${unicode}",\n` +
    `  "m_escapes": "q${BS}"b${BS}${BS}t${BS}tc${BS}u0001 ${c(0x2028)}${BS}ud800${c(0x7f)}",\n` +
    '  "n_empty_arr": [],\n  "o_empty_obj": {},\n' +
    '  "p_nested": {\n    "a": {\n      "b": {}\n    },\n    "z": [\n      1,\n      [\n        2,\n        {\n          "y": null\n        }\n      ]\n    ]\n  },\n' +
    '  "q_null_proto": {\n    "k": 1\n  }\n}\n';
  assert.equal(read(f), expected);
  assert.deepEqual(r, { written: true, path: f, reason: 'changed', bytes: Buffer.byteLength(expected) });
  assert.equal(r.bytes, 640);
  const raw = fs.readFileSync(f);
  assert.ok(raw[0] === 0x7b && !raw.includes(0x0d), 'no byte-order mark, no carriage return');
  assert.equal(
    W.canonicalText(JSON.parse(read(f)), { validate: false }) + '\n',
    read(f),
    'the round trip the audit performs reproduces the file'
  );
  assert.deepEqual(A.auditText('system/shapes.json', read(f)), {
    path: 'system/shapes.json',
    dialect: 'standard',
    canonical: true,
    findings: []
  });
});

test('key order is UTF-16 code unit order at every depth: integer-like keys by their characters, capitals before the underscore before lower case, so the header leads', () => {
  assert.equal(
    W.canonicalText({ B: 1, _x: 2, a: 3, 10: 4, 2: 5 }, { validate: false }),
    '{\n  "10": 4,\n  "2": 5,\n  "B": 1,\n  "_x": 2,\n  "a": 3\n}'
  );
  assert.equal(
    W.canonicalText({ z: { b: 1, a: [{ d: 1, c: 2 }] } }),
    '{\n  "z": {\n    "a": [\n      {\n        "c": 2,\n        "d": 1\n      }\n    ],\n    "b": 1\n  }\n}'
  );
  assert.equal(
    W.canonicalText([1, 'a', null]),
    '[\n  1,\n  "a",\n  null\n]',
    'a bare array root is accepted by canonicalText'
  );
  assert.equal(W.canonicalText('x'), '"x"', 'so is a bare string root');
  assert.equal(W.canonicalText({}), '{}');
  assert.deepEqual(
    refusal(() => W.canonicalText({ B: 1 })),
    [
      'JsonWriterError',
      true,
      'invalid key "B" at (root): not snake_case (rule 5). Expected /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/. The helper never silently renames a key.'
    ],
    'validate defaults to true'
  );
});

test("jsonlRow: one compact line, the same key order and scalar rules as canonicalText, for the three JSON Lines writers (run-log.mjs, build-online-template.mjs, close-out-online.sh's heredoc)", () => {
  assert.equal(W.jsonlRow({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(
    W.jsonlRow({ at: '2026-09-30T10:00:00Z', job: 'session', class: 'process', evidence: 'f:1', lesson: 'x' }),
    '{"at":"2026-09-30T10:00:00Z","class":"process","evidence":"f:1","job":"session","lesson":"x"}'
  );
  assert.equal(W.jsonlRow({ z: { b: 1, a: [{ d: 1, c: 2 }] } }), '{"z":{"a":[{"c":2,"d":1}],"b":1}}');
  // Exactly canonicalText, re-parsed and re-stringified compact: no header, no sparse-array or key-order
  // surprise of its own, and the same refusal on an invalid key.
  assert.equal(W.jsonlRow(JSON.parse(W.canonicalText({ z: 1, a: 2 }))), W.jsonlRow({ a: 2, z: 1 }));
  assert.deepEqual(
    refusal(() => W.jsonlRow({ B: 1 })),
    refusal(() => W.canonicalText({ B: 1 }))
  );
});

test('every refusal: its error class and its exact message; nothing and no temporary file is left behind', () => {
  const f = path.join(TMP, 'refused', 'r.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const fq = `"${f}"`; // the path as it is, in quotes, not JSON-escaped
  const plainTail =
    '. Only plain objects, arrays, strings, numbers, booleans and null are JSON values. Convert it explicitly (e.g. a Date to an ISO string) rather than relying on a coercion that would silently emit {}.';
  const typeTail =
    '. Only object, array, string, number, boolean and null are JSON values. Convert it explicitly rather than relying on a coercion.';
  const snake = '. Expected /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/. The helper never silently renames a key.';
  /** @type {Array<[unknown, string]>} */
  const cases = [
    [{ BadKey: 1 }, `invalid key "BadKey" at (root): not snake_case (rule 5)${snake}`],
    [{ 'bad-key': 1 }, `invalid key "bad-key" at (root): not snake_case (rule 5)${snake}`],
    [{ a: { b: [{ BadKey: 1 }] } }, `invalid key "BadKey" at a.b[0]: not snake_case (rule 5)${snake}`],
    [
      { reviewed_2026_07_20: 1 },
      'invalid key "reviewed_2026_07_20" at (root): contains an embedded yyyy-mm-dd date (rule 5, no dates in key names). A date is a value; move it into a value. The helper never silently renames a key.'
    ],
    [
      { reviewed_2026: 1 },
      'invalid key "reviewed_2026" at (root): contains a bare year segment "2026" (rule 5, no dates in key names). A date is a value; move it into a value. The helper never silently renames a key.'
    ],
    [
      { _sneaky: 1 },
      `writeJson(${fq}): payload key "_sneaky" is underscore-prefixed, which is reserved for the four generated header fields. The helper stamps those; a caller must not.`
    ],
    [{ a: undefined }, `unsupported type at a: undefined${typeTail}`],
    [{ a: NaN }, 'non-finite number at a: NaN is not representable in JSON'],
    [{ a: Infinity }, 'non-finite number at a: Infinity is not representable in JSON'],
    [{ a: BigInt(1) }, `unsupported type at a: bigint${typeTail}`],
    [{ a: Symbol('s') }, `unsupported type at a: symbol${typeTail}`],
    [{ a() {} }, `unsupported type at a: function${typeTail}`],
    [{ a: new Date(0) }, `unsupported type at a: Date${plainTail}`],
    [{ a: new Map() }, `unsupported type at a: Map${plainTail}`],
    [{ a: new (class Thing {})() }, `unsupported type at a: Thing${plainTail}`],
    [{ a: Buffer.from('x') }, `unsupported type at a: Buffer${plainTail}`],
    [[1], `writeJson(${fq}): data must be an object (the header fields live beside it)`],
    [null, `writeJson(${fq}): data must be an object (the header fields live beside it)`],
    [new Date(0), `unsupported type at : Date${plainTail}`]
  ];
  for (const [data, msg] of cases)
    assert.deepEqual(
      refusal(() => W.writeJson(f, data, M)),
      ['JsonWriterError', true, msg],
      msg.slice(0, 40)
    );
  const meta = [
    [undefined, `writeJson(${fq}): meta.purpose is required and must be a non-empty string`],
    [{ ...M, purpose: ' ' }, `writeJson(${fq}): meta.purpose is required and must be a non-empty string`],
    [{ ...M, writer: '' }, `writeJson(${fq}): meta.writer is required and must be a non-empty string`],
    [
      { ...M, schema: '3' },
      `writeJson(${fq}): schema "3" is malformed. Expected name@revision (e.g. "skills-lock@1"). A bare number is not a schema identifier (rule 3).`
    ],
    [
      { ...M, schema: 'Thing@1' },
      `writeJson(${fq}): schema "Thing@1" is malformed. Expected name@revision (e.g. "skills-lock@1"). A bare number is not a schema identifier (rule 3).`
    ]
  ];
  for (const [m, msg] of meta)
    assert.deepEqual(
      refusal(() => W.writeJson(f, { a: 1 }, m)),
      ['JsonWriterError', true, msg]
    );
  const im = { ...M, schema: 'install-profile@1' };
  assert.equal(
    W.writeJson(path.join(TMP, 'refused', 'lanes.json'), { lanes: { 'business-validation': true } }, im).reason,
    'changed',
    'a declared identifier map takes a kebab key'
  );
  assert.deepEqual(
    refusal(() => W.writeJson(f, { lanes: { 'Bad.Id': true } }, im)),
    [
      'JsonWriterError',
      true,
      'invalid key "Bad.Id" at lanes: lanes is a declared identifier map, and its keys must be identifiers (/^[a-z0-9]+([-_][a-z0-9]+)*$/). The helper never silently renames a key.'
    ]
  );
  assert.deepEqual(
    refusal(() => W.writeJson(f, { lanes: { 'lane-2026-01-01': true } }, im)),
    [
      'JsonWriterError',
      true,
      'invalid key "lane-2026-01-01" at lanes: contains an embedded yyyy-mm-dd date (rule 5, no dates in key names). A date is a value; move it into a value. The helper never silently renames a key.'
    ]
  );
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['lanes.json'], 'no refused file and no temporary file');
});

// ---------------------------------------------------------------- the determinism gate
test('the determinism gate: the same content is never rewritten (mtime kept); damaged bytes are repaired under the ORIGINAL stamp; a payload, schema or purpose change is written', () => {
  const f = F();
  assert.equal(W.writeJson(f, { alpha: 1 }, M).reason, 'changed');
  const clean = read(f);
  const old = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(f, old, old);
  const same = W.writeJson(f, { alpha: 1 }, { ...M, generatedAt: undefined });
  assert.deepEqual(same, { written: false, path: f, reason: 'unchanged', bytes: Buffer.byteLength(clean) });
  assert.equal(fs.statSync(f).mtimeMs, old.getTime(), 'no write happened');
  /** @type {Array<(t: string) => string>} */
  const damages = [
    (t) => t.replace(/\n$/, ''),
    (t) => t.replace(/\n/g, '\r\n'),
    (t) => c(0xfeff) + t,
    (t) => t + '\n',
    (t) => t.replace(/\n {2}"/g, '\n    "')
  ];
  for (const d of damages) {
    fs.writeFileSync(f, d(clean));
    const r = W.writeJson(f, { alpha: 1 }, { ...M, generatedAt: undefined });
    assert.deepEqual([r.written, r.reason], [true, 'repaired']);
    assert.equal(read(f), clean, 'repaired to the clean bytes, the 2000 stamp kept');
  }
  assert.equal(W.writeJson(f, { alpha: 2 }, M).reason, 'changed');
  assert.equal(
    W.writeJson(f, { alpha: 2 }, { ...M, schema: 'zz@2' }).reason,
    'changed',
    'a schema bump with the same payload reaches disk'
  );
  assert.equal(W.writeJson(f, { alpha: 2 }, { ...M, schema: 'zz@2', purpose: 'other' }).reason, 'changed');
  const moved = W.writeJson(f, { alpha: 3 }, { ...M, generatedAt: undefined });
  assert.equal(moved.reason, 'changed');
  assert.match(
    read(f),
    /"_generated_at": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/,
    'a real change takes the clock, to the second, with no milliseconds'
  );
  fs.writeFileSync(f, '{ not json');
  assert.equal(W.writeJson(f, { alpha: 1 }, M).reason, 'changed', 'a malformed file is replaced');
  fs.writeFileSync(f, '{\n  "alpha": 1\n}\n');
  assert.equal(
    W.writeJson(f, { alpha: 1 }, M).reason,
    'changed',
    'a headerless file with the same payload is replaced'
  );
  assert.equal(read(f), `${HEADER}  "alpha": 1\n}\n`);
  const deep = path.join(TMP, 'deep', 'er', 'x.json');
  assert.equal(W.writeJson(deep, { a: 1 }, M).reason, 'changed', 'missing folders are created');
});

// ---------------------------------------------------------------- the atomic replace, through the real writer
test('the atomic replace: a failing rename and a failing write leave the old file byte for byte, remove the temporary file, and rethrow the raw fs error', () => {
  const f = F();
  W.writeJson(f, { alpha: 1 }, M);
  const before = read(f);
  const dir = path.dirname(f);
  const tmpNames = () => fs.readdirSync(dir).filter((x) => x.includes('.tmp-'));
  for (const fn of /** @type {const} */ (['renameSync', 'writeSync'])) {
    /** @type {any} */
    const real = fs[fn];
    fs[fn] = () => {
      const e = /** @type {NodeJS.ErrnoException} */ (new Error(`${fn} refused by the test`));
      e.code = 'ETEST';
      throw e;
    };
    /** @type {any} */
    let err;
    try {
      W.writeJson(f, { alpha: 2 }, M);
    } catch (e) {
      err = e;
    } finally {
      fs[fn] = real;
    }
    assert.ok(
      err && err.code === 'ETEST' && !(err instanceof W.JsonWriterError),
      `${fn}: the fs error propagates as it is`
    );
    assert.equal(read(f), before, `${fn}: the old file is untouched`);
    assert.deepEqual(tmpNames(), [], `${fn}: no temporary file is left`);
  }
  const realRename = fs.renameSync;
  /** @type {any[][]} */
  const seen = [];
  fs.renameSync = (from, to) => {
    seen.push([from, to]);
    return realRename(from, to);
  };
  try {
    W.writeJson(f, { alpha: 2 }, M);
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(seen.length, 1);
  assert.equal(
    path.dirname(seen[0][0]),
    path.dirname(path.resolve(f)),
    'staged in the destination folder, so the rename stays on one volume'
  );
  assert.match(
    path.basename(seen[0][0]),
    new RegExp(`^\\.${path.basename(f).replace('.', '\\.')}\\.tmp-${process.pid}-\\d+$`)
  );
  assert.equal(read(f), `${HEADER}  "alpha": 2\n}\n`);
});

test('a destination that is a folder with content: the rename fails, the folder and its content survive, no temporary file remains', () => {
  const target = path.join(TMP, 'is-a-dir.json');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep\n');
  /** @type {any} */
  let err;
  try {
    W.writeJson(target, { alpha: 1 }, M);
  } catch (e) {
    err = e;
  }
  assert.ok(
    err && !(err instanceof W.JsonWriterError) && typeof err.code === 'string',
    `a raw fs error (${err?.code})`
  );
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep\n');
  assert.deepEqual(
    fs.readdirSync(TMP).filter((x) => x.startsWith('.is-a-dir.json.tmp-')),
    []
  );
});

// ---------------------------------------------------------------- readJson and the module surface
test('readJson: the matching schema reads (a legacy BOM tolerated); every other input throws its exact message; a missing file is a raw ENOENT', () => {
  const f = F();
  W.writeJson(f, { alpha: 1 }, M);
  assert.equal(W.readJson(f, 'zz@1').alpha, 1);
  const bom = F();
  fs.writeFileSync(bom, c(0xfeff) + read(f));
  assert.equal(W.readJson(bom, 'zz@1').alpha, 1);
  assert.deepEqual(
    refusal(() => W.readJson(f)),
    ['JsonWriterError', true, `readJson("${f}") requires an expectedSchema (rule 4)`]
  );
  assert.deepEqual(
    refusal(() => W.readJson(f, 'zz@2')),
    [
      'JsonWriterError',
      true,
      `${f}: schema check FAILED. expected "zz@2", found "zz@1". Refusing to guess: bump the reader, or the writer's revision, deliberately.`
    ]
  );
  const nh = F();
  fs.writeFileSync(nh, '{"alpha":1}');
  assert.deepEqual(
    refusal(() => W.readJson(nh, 'zz@1')),
    [
      'JsonWriterError',
      true,
      `${nh}: schema check FAILED. expected "zz@1", found: no _schema field at all. An unheadered file is not a conforming file (rule 2).`
    ]
  );
  const arr = F();
  fs.writeFileSync(arr, '[1]');
  assert.deepEqual(
    refusal(() => W.readJson(arr, 'zz@1')),
    [
      'JsonWriterError',
      true,
      `${arr}: schema check FAILED. expected "zz@1", found: no _schema field at all. An unheadered file is not a conforming file (rule 2).`
    ]
  );
  const bad = F();
  fs.writeFileSync(bad, '{');
  const r = refusal(() => W.readJson(bad, 'zz@1'));
  assert.deepEqual(r.slice(0, 2), ['JsonWriterError', true]);
  assert.ok(r[2].startsWith(`${bad}: not parseable as JSON (`));
  const missing = refusal(() => W.readJson(path.join(TMP, 'missing.json'), 'zz@1'));
  assert.deepEqual(missing.slice(0, 2), ['Error', false]);
  assert.match(missing[2], /^ENOENT: no such file or directory, open /);
});

// ---------------------------------------------------------------- readJsonHeaderless
/**
 * The hand-written read readJsonHeaderless replaces, over one file.
 * @param {import('node:fs').PathOrFileDescriptor} f
 */
const rawRead = (f) => () => JSON.parse(fs.readFileSync(f, 'utf8'));
/**
 * One fixture per input a headerless read meets, written as the bytes given.
 * @param {string} text
 */
function fileWith(text) {
  const f = F();
  fs.writeFileSync(f, text);
  return f;
}

test("readJsonHeaderless with no option IS JSON.parse over the file's text: the same value, and the same error, never wrapped", () => {
  const plain = fileWith('{"b":[1,{"a":null}],"a":"x"}');
  assert.deepEqual(W.readJsonHeaderless(plain), { b: [1, { a: null }], a: 'x' });
  assert.deepEqual(Object.keys(W.readJsonHeaderless(plain)), ['b', 'a'], 'the keys in file order, nothing reordered');
  const headered = F();
  W.writeJson(headered, { alpha: 1 }, M);
  assert.equal(W.readJsonHeaderless(headered)._schema, 'zz@1', 'a header is data here, and no schema is checked');
  assert.deepEqual(
    [
      W.readJsonHeaderless(fileWith('[1]')),
      W.readJsonHeaderless(fileWith('null')),
      W.readJsonHeaderless(fileWith('"x"'))
    ],
    [[1], null, 'x']
  );
  const folder = path.join(TMP, 'a-folder.json');
  fs.mkdirSync(folder);
  const inputs = {
    'a byte-order mark': fileWith(`${c(0xfeff)}{"a":1}`),
    'a broken file': fileWith('{'),
    'an empty file': fileWith(''),
    'a missing file': path.join(TMP, 'absent.json'),
    'a folder': folder
  };
  for (const [name, f] of Object.entries(inputs)) {
    assert.deepEqual(
      refusal(() => W.readJsonHeaderless(f)),
      refusal(rawRead(f)),
      `${name}: the raw read's own error`
    );
  }
  assert.deepEqual(
    refusal(() => W.readJsonHeaderless(inputs['a byte-order mark'])).slice(0, 2),
    ['SyntaxError', false],
    'a byte-order mark is refused unless asked'
  );
  assert.deepEqual(refusal(() => W.readJsonHeaderless(inputs['a missing file'])).slice(0, 2), ['Error', false]);
});

test('readJsonHeaderless options: bom strips one mark, ifMissing answers only for nothing at the path, ifUnreadable for any error, and a missing file takes ifMissing', () => {
  const plain = fileWith('{"a":1}');
  const marked = fileWith(`${c(0xfeff)}{"a":1}`);
  const twice = fileWith(`${c(0xfeff, 0xfeff)}{"a":1}`);
  const broken = fileWith('{');
  const missing = path.join(TMP, 'absent-too.json');
  const folder = path.join(TMP, 'another-folder.json');
  fs.mkdirSync(folder);
  assert.deepEqual(
    [W.readJsonHeaderless(marked, { bom: true }), W.readJsonHeaderless(plain, { bom: true })],
    [{ a: 1 }, { a: 1 }]
  );
  assert.deepEqual(
    refusal(() => W.readJsonHeaderless(twice, { bom: true })),
    refusal(() => JSON.parse(read(twice).slice(1))),
    'one mark only'
  );
  assert.deepEqual(
    refusal(() => W.readJsonHeaderless(marked, { bom: false })),
    refusal(rawRead(marked))
  );

  const sentinel = Symbol('absent');
  for (const value of [null, undefined, 0, '', sentinel]) {
    assert.equal(W.readJsonHeaderless(missing, { ifMissing: value }), value, `ifMissing ${String(value)}`);
  }
  assert.deepEqual(W.readJsonHeaderless(plain, { ifMissing: sentinel }), { a: 1 });
  assert.deepEqual(
    refusal(() => W.readJsonHeaderless(broken, { ifMissing: sentinel })),
    refusal(rawRead(broken)),
    'a file that is there still throws'
  );
  assert.deepEqual(
    refusal(() => W.readJsonHeaderless(folder, { ifMissing: sentinel })),
    refusal(rawRead(folder)),
    'so does a folder'
  );
  const fd = fs.openSync(plain, 'r');
  try {
    assert.deepEqual(W.readJsonHeaderless(fd, { ifMissing: sentinel }), { a: 1 }, 'a descriptor is never missing');
  } finally {
    fs.closeSync(fd);
  }

  for (const f of [missing, broken, folder, marked, fileWith('')]) {
    assert.equal(W.readJsonHeaderless(f, { ifUnreadable: sentinel }), sentinel, path.basename(f));
  }
  assert.equal(W.readJsonHeaderless(broken, { ifUnreadable: undefined }), undefined);
  assert.deepEqual(W.readJsonHeaderless(plain, { ifUnreadable: sentinel }), { a: 1 });
  assert.deepEqual(W.readJsonHeaderless(marked, { bom: true, ifUnreadable: sentinel }), { a: 1 });

  assert.equal(W.readJsonHeaderless(missing, { ifMissing: 'missing', ifUnreadable: 'unreadable' }), 'missing');
  assert.equal(W.readJsonHeaderless(broken, { ifMissing: 'missing', ifUnreadable: 'unreadable' }), 'unreadable');
});

test('the module surface and its constants', () => {
  assert.deepEqual(Object.keys(W), [
    'writeJson',
    'readJson',
    'canonicalText',
    'jsonlRow',
    'JsonWriterError',
    'HEADER_KEYS',
    'SNAKE_CASE',
    'SCHEMA_ID',
    'ID_MAPS',
    'IDENTIFIER_KEY',
    'idMapsFor',
    'readJsonHeaderless'
  ]);
  assert.deepEqual(W.HEADER_KEYS, ['_generated_at', '_purpose', '_schema', '_writer']);
  assert.equal(String(W.SNAKE_CASE), '/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/');
  assert.equal(String(W.SCHEMA_ID), '/^[a-z0-9][a-z0-9-]*(\\/[a-z0-9-]+)*@\\d+$/');
  assert.equal(String(W.IDENTIFIER_KEY), '/^[a-z0-9]+([-_][a-z0-9]+)*$/');
  assert.deepEqual(W.ID_MAPS, { 'install-profile@1': ['lanes'] });
  assert.ok(Object.isFrozen(W.ID_MAPS) && Object.isFrozen(W.ID_MAPS['install-profile@1']));
  assert.deepEqual([W.idMapsFor('install-profile@1'), W.idMapsFor('x@1'), W.idMapsFor(undefined)], [['lanes'], [], []]);
});

// ---------------------------------------------------------------- R7's defects, pinned as they are today
test('PINNED DEFECT R7-5: a sparse array is written as INVALID JSON, atomically, over a good file, and readJson then refuses it', () => {
  const f = F();
  W.writeJson(f, { a: [1] }, M);
  // biome-ignore lint/suspicious/noSparseArray: the pinned defect needs a real hole in the array
  const r = W.writeJson(f, { a: [1, , 2] }, M);
  assert.deepEqual([r.written, r.reason], [true, 'changed']);
  assert.equal(read(f), `${HEADER}  "a": [\n    1,\n,\n    2\n  ]\n}\n`);
  assert.throws(() => JSON.parse(read(f)), SyntaxError);
  const e = refusal(() => W.readJson(f, 'zz@1'));
  assert.deepEqual(e.slice(0, 2), ['JsonWriterError', true]);
  assert.ok(e[2].startsWith(`${f}: not parseable as JSON (`));
});

test("PINNED DEFECT R7-19: a header-named key below the root passes the writer and the audit flags the writer's own output; a circular object is a RangeError, not a JsonWriterError", () => {
  const f = F();
  assert.equal(W.writeJson(f, { a: { _purpose: 'x', _writer: 'y' } }, M).reason, 'changed');
  assert.deepEqual(A.auditText('system/nested.json', read(f)).findings, [
    'rule 2: underscore-prefixed payload key: _purpose, _writer'
  ]);
  const circ = {};
  circ.self = circ;
  const r = refusal(() => W.writeJson(F(), { a: circ }, M));
  assert.deepEqual(r, ['RangeError', false, 'Maximum call stack size exceeded']);
});

test('PINNED DEFECT R7-19: generatedAt is not validated, so a number is stamped as a number and the audit finds nothing wrong with it', () => {
  const f = F();
  W.writeJson(f, { a: 1 }, { ...M, generatedAt: 12345 });
  assert.equal(
    read(f),
    '{\n  "_generated_at": 12345,\n  "_purpose": "p",\n  "_schema": "zz@1",\n  "_writer": "scripts/w.js",\n  "a": 1\n}\n'
  );
  assert.deepEqual(A.auditText('system/stamp.json', read(f)).findings, []);
});

test('PINNED DEFECT R7-19: an identifier map with integer-like keys is written in code-unit order and the audit calls its order UNVERIFIABLE', () => {
  const f = F();
  W.writeJson(f, { lanes: { 10: true, 2: false } }, { ...M, schema: 'install-profile@1' });
  assert.equal(
    read(f),
    '{\n  "_generated_at": "2000-01-01T00:00:00Z",\n  "_purpose": "p",\n  "_schema": "install-profile@1",\n  "_writer": "scripts/w.js",\n  "lanes": {\n    "10": true,\n    "2": false\n  }\n}\n'
  );
  assert.deepEqual(A.auditText('system/lanes.json', read(f)).findings, [
    'rule 6: key order UNVERIFIABLE at lanes (integer-like keys; JSON.parse reorders them)'
  ]);
});

test("PINNED DEFECT R7-19: the replace does not keep the old file's POSIX mode (a 0600 file comes back with the default mode)", (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX file modes are not observable on Windows');
    return;
  }
  const f = F();
  W.writeJson(f, { a: 1 }, M);
  fs.chmodSync(f, 0o600);
  W.writeJson(f, { a: 2 }, M);
  assert.notEqual(fs.statSync(f).mode & 0o777, 0o600);
});

// ---------------------------------------------------------------- the registry is read by its own entries only
test('idMapsFor answers from the registry itself: a schema named after an Object prototype member has no identifier map', () => {
  for (const schema of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    assert.deepEqual(W.idMapsFor(schema), [], schema);
  }
  assert.equal(
    W.canonicalText({ a: { b: 1 } }, { schema: 'constructor' }),
    '{\n  "a": {\n    "b": 1\n  }\n}',
    'and canonicalText renders under it'
  );
});

// ---------------------------------------------------------------- readJsonHeaderless's promises, one by one
test('readJsonHeaderless rethrows the very object the read or the parse threw, so its code, errno, syscall, path and stack reach the caller', () => {
  const missing = path.join(TMP, 'absent-three.json');
  /** @type {any} */
  let raw;
  /** @type {any} */
  let got;
  try {
    fs.readFileSync(missing, 'utf8');
  } catch (e) {
    raw = e;
  }
  try {
    W.readJsonHeaderless(missing);
  } catch (e) {
    got = e;
  }
  const fields = ['code', 'errno', 'syscall', 'path'];
  assert.deepEqual(
    fields.map((k) => got?.[k]),
    fields.map((k) => raw[k])
  );
  const file = fileWith('{}');
  const thrown = new Error('thrown by the test');
  /** @type {Array<[any, string]>} */
  const throwers = [
    [fs, 'readFileSync'],
    [JSON, 'parse']
  ];
  for (const [owner, name] of throwers) {
    const real = owner[name];
    owner[name] = () => {
      throw thrown;
    };
    try {
      assert.throws(
        () => W.readJsonHeaderless(file),
        (e) => e === thrown,
        `${name}: the same object`
      );
    } finally {
      owner[name] = real;
    }
  }
});

test('readJsonHeaderless: ifMissing answers wherever fs.existsSync says nothing is there, a path through a file and a path no lookup accepts included; bom strips a leading mark only', () => {
  const plain = fileWith('{"a":1}');
  const absent = Symbol('absent');
  for (const p of [path.join(plain, 'x.json'), `${plain}${c(0)}.json`]) {
    assert.equal(fs.existsSync(p), false, 'fixture: fs.existsSync says nothing is there');
    assert.equal(W.readJsonHeaderless(p, { ifMissing: absent }), absent);
    assert.deepEqual(
      refusal(() => W.readJsonHeaderless(p)),
      refusal(rawRead(p)),
      'with no option, the raw error'
    );
  }
  const inner = `{"a":"${c(0xfeff)}x"}`;
  assert.deepEqual(
    W.readJsonHeaderless(fileWith(inner), { bom: true }),
    { a: `${c(0xfeff)}x` },
    'a mark inside a value is data'
  );
  assert.deepEqual(
    W.readJsonHeaderless(fileWith(c(0xfeff) + inner), { bom: true }),
    { a: `${c(0xfeff)}x` },
    'only the leading mark goes'
  );
});

// ---------------------------------------------------------------- one mark forgiven, a nameless class, a numeric stamp's repair
test('one leading byte-order mark is forgiven, never two: readJson refuses a doubly marked file, and writeJson replaces it as changed instead of repairing it', () => {
  const f = F();
  W.writeJson(f, { alpha: 1 }, M);
  fs.writeFileSync(f, `${c(0xfeff, 0xfeff)}${read(f)}`);
  const r = refusal(() => W.readJson(f, 'zz@1'));
  assert.deepEqual(r.slice(0, 2), ['JsonWriterError', true]);
  assert.ok(r[2].startsWith(`${f}: not parseable as JSON (`), r[2]);
  assert.equal(W.writeJson(f, { alpha: 1 }, M).reason, 'changed');
  assert.equal(read(f), `${HEADER}  "alpha": 1\n}\n`);
});

test('an instance of an anonymous class is refused as a non-plain object, because its class has no name to print', () => {
  assert.deepEqual(
    refusal(() => W.canonicalText({ a: new (class {})() })),
    [
      'JsonWriterError',
      true,
      'unsupported type at a: non-plain object. Only plain objects, arrays, strings, numbers, booleans and null are JSON values. Convert it explicitly (e.g. a Date to an ISO string) rather than relying on a coercion that would silently emit {}.'
    ]
  );
});

test('PINNED DEFECT R7-19: a numeric stamp is not kept on a repair: the same content in damaged bytes is rewritten under the clock, as changed', () => {
  const f = F();
  W.writeJson(f, { a: 1 }, { ...M, generatedAt: 12345 });
  fs.writeFileSync(f, read(f).replace(/\n/g, '\r\n'));
  assert.equal(W.writeJson(f, { a: 1 }, { ...M, generatedAt: undefined }).reason, 'changed');
  assert.match(read(f), /\n {2}"_generated_at": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z",\n/);
});
