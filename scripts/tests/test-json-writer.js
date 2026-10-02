#!/usr/bin/env node
// @ts-check
// scripts/tests/test-json-writer.js - the JSON writer's promises, each shown holding and each refusal firing.
//
// WHAT. Proves scripts/lib/json-writer.js in both directions. A conforming write has no byte-order mark, LF
// endings only, exactly one final line break, a two-space indent, keys sorted at every depth and the four
// header fields first; a second identical write is skipped and a changed one written; readJson accepts the
// right schema and names both values when it refuses another; Arabic, Swedish and an astral emoji are
// written as literal UTF-8 with only C0 controls escaped; the number shapes a hand-rolled formatter gets
// wrong come out as ECMAScript prints them; every refusal the writer claims fires and names the offender; a
// byte-damaged file is repaired under its original stamp; and the one declared identifier map takes a kebab
// lane id while every undeclared place still refuses it. Deleted, it would let an escaping or number-format
// change, a refusal that stopped firing, a repair that froze the damage or a leaking identifier-map
// exception through to the bytes test alone.
//
// HOW. Writes fixtures with a frozen clock under a temp folder and checks the bytes, the parsed shape and
// the return values; each refusal must be a JsonWriterError whose message names the offending key or value.
// The fixtures carry literal UTF-8 on purpose: they are the only place minimal escaping is proven on real
// non-ASCII text, and a serializer that escaped everything to ASCII would pass every other case.
//
// NEVER. Writes outside the temp folder it creates and removes, or reaches the network. Its interrupted-write
// case runs a child that stages a temporary file and exits before any swap, and shows the destination
// untouched; it never drives writeJson itself, so the real atomic replace is the bytes test's to prove.
//
// Usage: node scripts/tests/test-json-writer.js
// Exit: 0 every check held - 1 one failed
'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeJson, readJson, canonicalText, JsonWriterError } = require('../lib/json-writer');

const STAMP = '2026-08-24T00:00:00Z'; // frozen clock: byte-identity is unprovable otherwise
const META = { purpose: 'test', writer: 'scripts/tests/test-json-writer.js', schema: 'json-writer-test@1' };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonwriter-'));
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {
    /* best-effort cleanup only */
  }
});
/** @param {string} n */
const p = (n) => path.join(TMP, n);

/**
 * fn() must throw a JsonWriterError, optionally naming mustMention in its message. The one assertion
 * combinator this file keeps: every throws() call here checks both of these, and a plain
 * assert.throws with no validator would let a wrong-kind throw or a message missing its offender pass.
 * @param {() => unknown} fn
 * @param {string} [mustMention]
 */
function throwsWriterError(fn, mustMention) {
  assert.throws(fn, (/** @type {any} */ e) => {
    assert.ok(e instanceof JsonWriterError, `threw the wrong kind: ${e?.message}`);
    if (mustMention) {
      assert.ok(e.message.includes(mustMention), `message did not name ${JSON.stringify(mustMention)}: ${e.message}`);
    }
    return true;
  });
}

// Serialization fixtures: awkward key ordering, non-ASCII text, and the number shapes where a
// hand-rolled float formatter diverges from ECMAScript Number::toString.
const AR = 'مرحبا'; // Arabic "marhaba"
const SV = 'skärgård'; // Swedish, a-umlaut + a-ring
const EMOJI = '😀'; // U+1F600, a valid surrogate PAIR
/** @type {Record<string, { purpose: string, data: Record<string, unknown> }>} */
const FIXTURES = {
  basic: {
    purpose: 'ordering and nesting fixture',
    data: {
      zulu: 'last',
      alpha: { nested_b: 2, nested_a: [3, 1, 2], nested_c: null },
      mid_key: true,
      list: [{ b: 'x', a: 'y' }, [], {}],
      count: 42
    }
  },
  text: {
    purpose: 'non-ascii byte fidelity fixture',
    data: {
      arabic: AR,
      swedish: SV,
      emoji: EMOJI,
      control: 'tab\there\u0001', // U+0001 as an ESCAPE, never a raw byte (V18)
      quote_slash: 'he said "hi" \\ ok',
      mixed: [AR, SV, EMOJI]
    }
  },
  numbers: {
    purpose: 'awkward number fidelity fixture',
    data: {
      a_tenth: 0.1,
      a_third: 1 / 3,
      big_exp: 1e21,
      small_exp: 1e-7,
      neg_zero: -0,
      denormal: 5e-324,
      max_double: 1.7976931348623157e308,
      wide: 1.2345678901234568e29,
      micro: 0.000001,
      just_under: 1e20,
      plain_int: 100,
      neg_frac: -2.5,
      whole_double: 3.0
    }
  }
};

describe('POSITIVE: the file a conforming write produces', () => {
  test('write bytes: no BOM, LF only, one final newline, two-space indent, keys sorted, header first', () => {
    const f = p('basic-node.json');
    const r = writeJson(f, FIXTURES.basic.data, { ...META, generatedAt: STAMP });
    const buf = fs.readFileSync(f);
    assert.equal(r.written, true, 'write reports written');
    assert.equal(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, false, 'no BOM (node)');
    assert.equal(buf.includes(0x0d), false, 'LF only, no CR');
    assert.equal(buf[buf.length - 1] === 0x0a && buf[buf.length - 2] !== 0x0a, true, 'ends with exactly one newline');
    const text = buf.toString('utf8');
    assert.equal(/\n {2}"/.test(text), true, 'two-space indent');

    /** @type {(obj: any, where?: string) => boolean} */
    const sortedEverywhere = (obj, where = 'root') => {
      if (obj === null || typeof obj !== 'object') return true;
      if (Array.isArray(obj)) return obj.every((v, i) => sortedEverywhere(v, `${where}[${i}]`));
      const seen = Object.keys(obj); // JSON.parse preserves file order for non-numeric keys
      const sorted = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      assert.equal(seen.join(' '), sorted.join(' '), `keys sorted at every depth: ${where}`);
      return seen.every((k) => sortedEverywhere(obj[k], `${where}.${k}`));
    };
    sortedEverywhere(JSON.parse(text));

    const parsed = JSON.parse(text);
    assert.equal(
      ['_generated_at', '_purpose', '_schema', '_writer'].every((k) => k in parsed),
      true,
      'header: four generated fields present'
    );
    assert.equal(
      Object.keys(parsed).slice(0, 4).join(','),
      '_generated_at,_purpose,_schema,_writer',
      'header sorts ahead of payload keys'
    );
    assert.equal(parsed._schema, 'json-writer-test@1', 'schema stamped verbatim');
    assert.equal(fs.readdirSync(TMP).filter((n) => n.includes('.tmp-')).length, 0, 'no leftover temp files');
  });
});

describe('POSITIVE: determinism, unchanged payload produces NO write', () => {
  test('a second identical write is a no-op; a real change, or a schema bump, still writes', () => {
    const f = p('determinism.json');
    writeJson(f, { alpha: 1 }, META);
    const first = fs.readFileSync(f, 'utf8');
    const mtime1 = fs.statSync(f).mtimeMs;
    const r2 = writeJson(f, { alpha: 1 }, META);
    assert.equal(r2.written, false, 'second identical write is skipped');
    assert.equal(r2.reason, 'unchanged', 'reason is "unchanged"');
    assert.equal(fs.readFileSync(f, 'utf8'), first, 'bytes on disk untouched');
    assert.equal(fs.statSync(f).mtimeMs, mtime1, 'mtime preserved');
    const r3 = writeJson(f, { alpha: 2 }, META);
    assert.equal(r3.written, true, 'a real change DOES write');
    // A schema revision bump must reach the disk even with an equal payload, or every rule-4 reader breaks
    // against a file that still names the old revision.
    const r4 = writeJson(f, { alpha: 2 }, { ...META, schema: 'json-writer-test@2' });
    assert.equal(r4.written, true, 'schema revision bump forces a write');
  });
});

describe('POSITIVE: the reader (rule 4)', () => {
  test('reader accepts a correct file', () => {
    const f = p('reader.json');
    writeJson(f, { alpha: 1 }, META);
    assert.equal(readJson(f, 'json-writer-test@1').alpha, 1);
  });
});

describe('POSITIVE: encoding and scalar fidelity over the fixtures', () => {
  // The fixtures expose the three places two serializers drift: key order, non-ASCII escaping and float
  // formatting. Each asserts a rule no ASCII-only fixture reaches.
  test('every fixture: no BOM, LF only, and round-trips to the same value', () => {
    for (const name of Object.keys(FIXTURES)) {
      const f = p(`${name}-node.x.json`);
      writeJson(f, FIXTURES[name].data, {
        purpose: FIXTURES[name].purpose,
        writer: 'scripts/tests/test-json-writer.js',
        schema: 'json-writer-test@1',
        generatedAt: STAMP
      });
      const buf = fs.readFileSync(f);
      assert.equal(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, false, `no BOM (${name})`);
      assert.equal(buf.includes(0x0d), false, `LF only (${name})`);
      const round = JSON.parse(buf.toString('utf8'));
      const { _generated_at, _purpose, _schema, _writer, ...payload } = round;
      assert.equal(
        canonicalText(payload, { validate: false }),
        canonicalText(FIXTURES[name].data, { validate: false }),
        `round-trips to the same value (${name})`
      );
    }
  });

  test('minimal JCS escaping: Arabic, Swedish and an astral emoji stay literal; only C0 controls escape', () => {
    // Minimal JCS escaping, checked on the bytes the "text" fixture just wrote: literal UTF-8 for
    // everything except ", \\ and the C0 controls. An ASCII-safe escaper would pass every other
    // assertion in this file and still break byte fidelity for Arabic and Swedish.
    const text = fs.readFileSync(p('text-node.x.json'), 'utf8');
    assert.equal(text.includes(AR), true, 'arabic emitted literally, not escaped');
    assert.equal(text.includes(SV), true, 'swedish emitted literally, not escaped');
    assert.equal(text.includes(EMOJI), true, 'astral emoji emitted literally, not escaped');
    // The fixture's control value carries a raw U+0001 after "tab\\there", so a \\uXXXX escape is
    // EXPECTED here. What must not happen is one outside the C0 range: that is the ASCII-safe tell.
    /** @type {string[]} */
    const escapes = text.match(/\\u[0-9a-fA-F]{4}/g) || [];
    assert.equal(
      escapes.every((e) => parseInt(e.slice(2), 16) < 0x20),
      true,
      'every \\uXXXX escape is a C0 control'
    );
    assert.equal(escapes.includes('\\u0001'), true, 'the raw C0 control IS escaped');
    assert.equal(text.includes('tab\\there'), true, 'tab takes its short escape');
  });

  test('number shapes: exponent thresholds, negative zero and a denormal match ECMAScript', () => {
    // Number::toString is the JCS rule and JSON.stringify is its reference implementation. These are
    // the shapes a reimplementation gets wrong: the exponent thresholds, negative zero, the denormal.
    const text = fs.readFileSync(p('numbers-node.x.json'), 'utf8');
    assert.equal(text.includes('"big_exp": 1e+21'), true, '1e21 keeps exponent form');
    assert.equal(text.includes('"just_under": 100000000000000000000'), true, '1e20 stays plain');
    assert.equal(text.includes('"small_exp": 1e-7'), true, '1e-7 keeps exponent form');
    assert.equal(text.includes('"neg_zero": 0'), true, 'negative zero serializes as 0');
    assert.equal(text.includes('"denormal": 5e-324'), true, 'denormal survives');
    assert.equal(text.includes('"whole_double": 3'), true, 'whole double loses its .0');
  });
});

describe('NEGATIVE: the helper refuses', () => {
  test('every refusal fires, naming the offender, and leaves no file behind', () => {
    throwsWriterError(() => writeJson(p('n1.json'), { BadKey: 1 }, META), 'BadKey'); // bad key name throws, naming the key
    throwsWriterError(() => writeJson(p('n2.json'), { 'bad-key': 1 }, META), 'bad-key'); // kebab key throws, naming the key
    throwsWriterError(() => writeJson(p('n3.json'), { good: { AlsoBad: 1 } }, META), 'AlsoBad'); // nested bad key throws
    throwsWriterError(() => writeJson(p('n4.json'), { reviewed_2026_07_20: 1 }, META), 'reviewed_2026_07_20'); // date-in-key throws (yyyy_mm_dd)
    throwsWriterError(() => writeJson(p('n5.json'), { reviewed_2026: 1 }, META), 'reviewed_2026'); // date-in-key throws (bare year)
    throwsWriterError(() => writeJson(p('n6.json'), { _sneaky: 1 }, META), '_sneaky'); // underscore key reserved for header
    throwsWriterError(() => writeJson(p('n7.json'), { a: 1 }, { ...META, schema: '3' }), 'name@revision'); // malformed schema id throws
    throwsWriterError(() => writeJson(p('n8.json'), { a: Infinity }, META), 'non-finite'); // non-finite number throws
    throwsWriterError(() => writeJson(p('n9.json'), { a: new Date() }, META), 'unsupported type'); // unsupported type throws
    assert.equal(
      fs.readdirSync(TMP).filter((n) => /^n\d\.json$/.test(n)).length,
      0,
      'no file was created by any refusal'
    );
  });
});

describe('NEGATIVE: the reader fails loudly', () => {
  test('wrong schema, no header at all, and no expectedSchema given', () => {
    const f = p('reader.json');
    throwsWriterError(() => readJson(f, 'json-writer-test@9'), 'json-writer-test@9'); // reader rejects wrong schema, naming BOTH values
    try {
      readJson(f, 'json-writer-test@9');
      assert.fail('expected readJson to throw'); // expected a throw, got none
    } catch (/** @type {any} */ e) {
      assert.equal(e.message.includes('json-writer-test@1'), true, 'wrong-schema message also names what was FOUND');
    }
    const noHeader = p('no-header.json');
    fs.writeFileSync(noHeader, '{\n  "alpha": 1\n}\n');
    throwsWriterError(() => readJson(noHeader, 'json-writer-test@1'), 'no _schema field'); // reader rejects a file with no header at all
    throwsWriterError(() => readJson(f), 'requires an expectedSchema'); // reader refuses without an expected schema
  });
});

describe('NEGATIVE: an interrupted write leaves the original intact', () => {
  test('a process that dies after staging the temp file, before the swap', () => {
    const f = p('atomic.json');
    writeJson(f, { alpha: 'original' }, META);
    const before = fs.readFileSync(f);

    // A process that dies AFTER staging the temp file and BEFORE the swap. That is the worst moment,
    // and the moment the stage-then-replace order exists to survive. Deterministic on purpose: racing
    // a real kill against a small write is flaky, and a flaky proof is not a proof.
    const child = [
      'const fs=require("fs"),path=require("path");',
      `const tmp=path.join(${JSON.stringify(TMP)},".atomic.json.tmp-simulated");`,
      'fs.writeFileSync(tmp, Buffer.from("{ \\"alpha\\": \\"HALF-WRIT"));',
      'process.exit(9);'
    ].join('');
    try {
      execFileSync(process.execPath, ['-e', child], { stdio: 'pipe' });
    } catch (_) {
      /* exit 9 expected */
    }

    assert.equal(fs.readFileSync(f).equals(before), true, 'destination byte-identical after the interruption');
    assert.equal(readJson(f, 'json-writer-test@1').alpha, 'original', 'destination still parses');
    const strays = fs.readdirSync(TMP).filter((n) => n.startsWith('.atomic.json.tmp-'));
    assert.equal(strays.length, 1, 'the half-written bytes landed in a temp file, never the destination');
    for (const n of strays) fs.unlinkSync(path.join(TMP, n));

    try {
      writeJson(f, { alpha: 'x', BadKey: 1 }, META);
    } catch (_) {
      /* the refusal itself is not the point of this leg */
    }
    assert.equal(
      fs.readdirSync(TMP).filter((n) => n.includes('.tmp-')).length,
      0,
      'a refused write leaves no temp file'
    );
  });
});

describe('canonicalText: code-unit ordering is pinned, not alphabetical', () => {
  test('capitals sort before the underscore, which sorts before lowercase', () => {
    // Capitals sort BEFORE the underscore, which sorts before lowercase. Invisible under snake_case,
    // which is exactly why it is pinned now, while it costs nothing. validate:false so the ordering
    // rule is tested independently of the casing rule that would otherwise reject these keys.
    const t = canonicalText({ b: 1, B: 2, _c: 3, a: 4 }, { validate: false });
    assert.equal(Object.keys(JSON.parse(t)).join(','), 'B,_c,a,b', 'code-unit order (B < _c < a < b)');
  });
});

describe('the determinism gate REPAIRS byte damage instead of freezing it', () => {
  test('a missing trailing newline, CRLF, and a BOM are repaired; a real change still writes', () => {
    // The gate compares PARSED content, so a byte-order mark, CRLF endings or a missing final line break
    // compare equal to a clean file. Skipping the write there would keep the damage for good: the audit
    // and V21 would flag the file forever and no writer would repair it, because its content never
    // changes again. So the same content in the same bytes is no write, and the same content in other
    // bytes is a repair that keeps _generated_at, because the content did not change and moving the
    // stamp would misstate when it did.
    const f = path.join(TMP, 'repair.json');
    const M = { purpose: 'p', writer: 'w', schema: 'json-writer-test@1' };
    assert.equal(writeJson(f, { alpha: 1 }, M).reason, 'changed', 'first write reports changed');
    const stamp1 = JSON.parse(fs.readFileSync(f, 'utf8'))._generated_at;
    assert.equal(writeJson(f, { alpha: 1 }, M).written, false, 'an identical rewrite is still a no-op');

    /** @type {Array<[string, (t: string) => string]>} */
    const damages = [
      ['a missing trailing newline', (t) => t.replace(/\n$/, '')],
      ['CRLF line endings', (t) => t.replace(/\n/g, '\r\n')],
      ['a BOM', (t) => '\uFEFF' + t]
    ];
    for (const [name, damage] of damages) {
      const clean = fs.readFileSync(f, 'utf8');
      fs.writeFileSync(f, damage(clean), 'utf8');
      assert.equal(writeJson(f, { alpha: 1 }, M).reason, 'repaired', `${name}: reported as repaired`);
      const after = fs.readFileSync(f, 'utf8');
      assert.equal(after, clean, `${name}: bytes restored exactly`);
      assert.equal(
        JSON.parse(after.replace(/^\uFEFF/, ''))._generated_at,
        stamp1,
        `${name}: _generated_at kept, not moved`
      );
    }

    // The repair path must not swallow a REAL change: that would freeze content, which is far worse
    // than freezing bytes.
    assert.equal(
      writeJson(f, { alpha: 2 }, M).reason,
      'changed',
      'a genuine content change is still reported as changed'
    );
    assert.equal(readJson(f, 'json-writer-test@1').alpha, 2, 'and the new content actually landed');
  });
});

describe("rule 5's one declared exception, both directions", () => {
  // install-profile@1 declares `lanes` an identifier map, because its keys are lane ids and one of them
  // is business-validation. Everything outside that one map, and every undeclared schema, must still be
  // held to snake_case: an exception that leaks is worse than the conflict it settled.
  test('a declared identifier map accepts its kebab id, and only inside the declared map', () => {
    const PM = { purpose: 'test', writer: 'scripts/tests/test-json-writer.js', schema: 'install-profile@1' };
    const f = p('profile.json');
    const payload = { lanes: { 'business-validation': false, website: true }, locale: 'en' };
    const first = writeJson(f, payload, { ...PM, generatedAt: STAMP });
    assert.equal(first.written, true, 'a declared identifier map accepts a kebab lane id (install-profile@1 lanes)');
    assert.equal(
      writeJson(f, payload, PM).reason,
      'unchanged',
      'a second write of the same content is a no-op (the determinism gate reads the declaration too)'
    );
    // NEGATIVE the same kebab key under an UNDECLARED schema is still refused
    throwsWriterError(
      () => writeJson(p('f11-a.json'), { lanes: { 'business-validation': false } }, META),
      'business-validation'
    );
    // NEGATIVE a kebab key OUTSIDE the declared map, in the declaring schema, is still refused
    throwsWriterError(() => writeJson(p('f11-b.json'), { lanes: {}, 'radar-feeds': [] }, PM), 'radar-feeds');
    // NEGATIVE a kebab key one level BELOW the declared map is still refused
    throwsWriterError(() => writeJson(p('f11-c.json'), { lanes: { website: { 'is-on': true } } }, PM), 'is-on');
    // NEGATIVE the declared map still refuses a key that is not an identifier (capitals)
    throwsWriterError(
      () => writeJson(p('f11-d.json'), { lanes: { 'Business-Validation': false } }, PM),
      'Business-Validation'
    );
    // NEGATIVE the declared map still refuses a date inside a key
    throwsWriterError(
      () => writeJson(p('f11-e.json'), { lanes: { 'review-2026-09-24': false } }, PM),
      'review-2026-09-24'
    );
    // NEGATIVE canonicalText with no schema holds every key to snake_case
    throwsWriterError(() => canonicalText({ lanes: { 'business-validation': false } }), 'business-validation');
  });
});
