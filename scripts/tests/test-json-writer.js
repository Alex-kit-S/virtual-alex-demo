#!/usr/bin/env node
'use strict';
/*
 * scripts/tests/test-json-writer.js - proves the JSON standard's writer helper.
 *
 * Both directions, per the standing rule: a helper that cannot be made to REFUSE is unproven. The
 * positive half shows the helper produces a conforming file; the negative half shows it throws on
 * every violation it claims to catch, and that an interrupted write leaves the original intact.
 *
 * ONE helper, not two. The standard shipped a PowerShell twin (scripts/lib/json-writer.ps1) and this
 * test's central leg was byte-identity between the two. That twin RETIRED 2026-08-25 with the
 * platform move off PowerShell, so the cross-language leg and its fixture script are gone and node
 * is the whole enforcement mechanism now. What those assertions guarded still matters: PS 5.1's
 * Set-Content -Encoding utf8 emitting a BOM is the trap that created the six BOM carriers the
 * inventory found, and a node writer must never reintroduce one.
 *
 * Encoding note: this file carries literal UTF-8 fixtures (Arabic, Swedish, an astral emoji), which
 * node reads natively. They stay because they are the only place minimal JCS escaping is proven on
 * real non-ASCII: a serializer that escaped everything to ASCII would pass every other test here.
 *
 * Run: node scripts/tests/test-json-writer.js   (exit 0 = pass)
 * Zero network. Writes only under a temp dir it creates and removes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeJson, readJson, canonicalText, JsonWriterError } = require('../lib/json-writer');

const STAMP = '2026-08-24T00:00:00Z';           // frozen clock: byte-identity is unprovable otherwise
const META = { purpose: 'test', writer: 'scripts/tests/test-json-writer.js', schema: 'json-writer-test@1' };

let pass = 0; const fails = [];
function ok(name)          { pass++; console.log(`  ok    ${name}`); }
function bad(name, detail) { fails.push(`${name}: ${detail}`); console.log(`  FAIL  ${name}: ${detail}`); }
function eq(name, actual, expected) {
  if (actual === expected) ok(name);
  else bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function throws(name, fn, mustMention) {
  try { fn(); bad(name, 'expected a throw, got none'); }
  catch (e) {
    if (!(e instanceof JsonWriterError)) return bad(name, `threw the wrong kind: ${e.message}`);
    if (mustMention && !e.message.includes(mustMention)) {
      return bad(name, `message did not name ${JSON.stringify(mustMention)}: ${e.message}`);
    }
    ok(name);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonwriter-'));
const p = n => path.join(TMP, n);

// Serialization fixtures: awkward key ordering, non-ASCII text, and the number shapes where a
// hand-rolled float formatter diverges from ECMAScript Number::toString.
const AR = 'مرحبا';   // Arabic "marhaba"
const SV = 'skärgård';               // Swedish, a-umlaut + a-ring
const EMOJI = '😀';                  // U+1F600, a valid surrogate PAIR
const FIXTURES = {
  basic: {
    purpose: 'ordering and nesting fixture',
    data: { zulu: 'last', alpha: { nested_b: 2, nested_a: [3, 1, 2], nested_c: null },
            mid_key: true, list: [{ b: 'x', a: 'y' }, [], {}], count: 42 },
  },
  text: {
    purpose: 'non-ascii byte fidelity fixture',
    data: { arabic: AR, swedish: SV, emoji: EMOJI, control: 'tab\there\u0001',   // U+0001 as an ESCAPE, never a raw byte (V18)
            quote_slash: 'he said "hi" \\ ok', mixed: [AR, SV, EMOJI] },
  },
  numbers: {
    purpose: 'awkward number fidelity fixture',
    data: { a_tenth: 0.1, a_third: 1 / 3, big_exp: 1e21, small_exp: 1e-7, neg_zero: -0,
            denormal: 5e-324, max_double: 1.7976931348623157e308, wide: 1.2345678901234568e29,
            micro: 0.000001, just_under: 1e20, plain_int: 100, neg_frac: -2.5, whole_double: 3.0 },
  },
};

console.log('\n--- POSITIVE: the file a conforming write produces ---');
{
  const f = p('basic-node.json');
  const r = writeJson(f, FIXTURES.basic.data, { ...META, generatedAt: STAMP });
  const buf = fs.readFileSync(f);
  eq('write reports written', r.written, true);
  eq('no BOM (node)', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, false);
  eq('LF only, no CR', buf.includes(0x0D), false);
  eq('ends with exactly one newline', buf[buf.length - 1] === 0x0A && buf[buf.length - 2] !== 0x0A, true);
  const text = buf.toString('utf8');
  eq('two-space indent', /\n  "/.test(text), true);

  const sortedEverywhere = (obj, where = 'root') => {
    if (obj === null || typeof obj !== 'object') return true;
    if (Array.isArray(obj)) return obj.every((v, i) => sortedEverywhere(v, `${where}[${i}]`));
    const seen = Object.keys(obj);                 // JSON.parse preserves file order for non-numeric keys
    const sorted = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (seen.join(' ') !== sorted.join(' ')) { bad('keys sorted at every depth', `${where}: ${seen}`); return false; }
    return seen.every(k => sortedEverywhere(obj[k], `${where}.${k}`));
  };
  if (sortedEverywhere(JSON.parse(text))) ok('keys sorted at every depth');

  const parsed = JSON.parse(text);
  eq('header: four generated fields present',
     ['_generated_at', '_purpose', '_schema', '_writer'].every(k => k in parsed), true);
  eq('header sorts ahead of payload keys', Object.keys(parsed).slice(0, 4).join(','),
     '_generated_at,_purpose,_schema,_writer');
  eq('schema stamped verbatim', parsed._schema, 'json-writer-test@1');
  eq('no leftover temp files', fs.readdirSync(TMP).filter(n => n.includes('.tmp-')).length, 0);
}

console.log('\n--- POSITIVE: determinism, unchanged payload produces NO write ---');
{
  const f = p('determinism.json');
  writeJson(f, { alpha: 1 }, META);
  const first = fs.readFileSync(f, 'utf8');
  const mtime1 = fs.statSync(f).mtimeMs;
  const r2 = writeJson(f, { alpha: 1 }, META);
  eq('second identical write is skipped', r2.written, false);
  eq('reason is "unchanged"', r2.reason, 'unchanged');
  eq('bytes on disk untouched', fs.readFileSync(f, 'utf8'), first);
  eq('mtime preserved', fs.statSync(f).mtimeMs, mtime1);
  const r3 = writeJson(f, { alpha: 2 }, META);
  eq('a real change DOES write', r3.written, true);
  // Widening beyond the brief: a schema revision bump must reach disk even with an equal payload, or
  // every rule-4 reader breaks against a file still claiming the old revision.
  const r4 = writeJson(f, { alpha: 2 }, { ...META, schema: 'json-writer-test@2' });
  eq('schema revision bump forces a write', r4.written, true);
}

console.log('\n--- POSITIVE: the reader (rule 4) ---');
{
  const f = p('reader.json');
  writeJson(f, { alpha: 1 }, META);
  eq('reader accepts a correct file', readJson(f, 'json-writer-test@1').alpha, 1);
}

console.log('\n--- POSITIVE: encoding and scalar fidelity over the fixtures ---');
// What survives of the retired cross-language leg. The fixtures were built to expose the three
// places two serializers drift: key order, non-ASCII escaping, float formatting. With one helper
// left they still earn their place, because each asserts a rule no ASCII-only fixture reaches.
for (const name of Object.keys(FIXTURES)) {
  const f = p(`${name}-node.x.json`);
  writeJson(f, FIXTURES[name].data,
            { purpose: FIXTURES[name].purpose, writer: 'scripts/tests/test-json-writer.js',
              schema: 'json-writer-test@1', generatedAt: STAMP });
  const buf = fs.readFileSync(f);
  eq(`no BOM (${name})`, buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, false);
  eq(`LF only (${name})`, buf.includes(0x0D), false);
  const round = JSON.parse(buf.toString('utf8'));
  const { _generated_at, _purpose, _schema, _writer, ...payload } = round;
  eq(`round-trips to the same value (${name})`,
     canonicalText(payload, { validate: false }), canonicalText(FIXTURES[name].data, { validate: false }));
}
{
  // Minimal JCS escaping, checked on the bytes the "text" fixture just wrote: literal UTF-8 for
  // everything except ", \\ and the C0 controls. An ASCII-safe escaper would pass every other
  // assertion in this file and still break byte fidelity for Arabic and Swedish.
  const text = fs.readFileSync(p('text-node.x.json'), 'utf8');
  eq('arabic emitted literally, not escaped', text.includes(AR), true);
  eq('swedish emitted literally, not escaped', text.includes(SV), true);
  eq('astral emoji emitted literally, not escaped', text.includes(EMOJI), true);
  // The fixture's control value carries a raw U+0001 after "tab\\there", so a \\uXXXX escape is
  // EXPECTED here. What must not happen is one outside the C0 range: that is the ASCII-safe tell.
  const escapes = text.match(/\\u[0-9a-fA-F]{4}/g) || [];
  eq('every \\uXXXX escape is a C0 control',
     escapes.every(e => parseInt(e.slice(2), 16) < 0x20), true);
  eq('the raw C0 control IS escaped', escapes.includes('\\u0001'), true);
  eq('tab takes its short escape', text.includes('tab\\there'), true);
}
{
  // Number::toString is the JCS rule and JSON.stringify is its reference implementation. These are
  // the shapes a reimplementation gets wrong: the exponent thresholds, negative zero, the denormal.
  const text = fs.readFileSync(p('numbers-node.x.json'), 'utf8');
  eq('1e21 keeps exponent form', text.includes('"big_exp": 1e+21'), true);
  eq('1e20 stays plain', text.includes('"just_under": 100000000000000000000'), true);
  eq('1e-7 keeps exponent form', text.includes('"small_exp": 1e-7'), true);
  eq('negative zero serializes as 0', text.includes('"neg_zero": 0'), true);
  eq('denormal survives', text.includes('"denormal": 5e-324'), true);
  eq('whole double loses its .0', text.includes('"whole_double": 3'), true);
}

console.log('\n--- NEGATIVE: the helper refuses ---');
throws('bad key name throws, naming the key', () => writeJson(p('n1.json'), { BadKey: 1 }, META), 'BadKey');
throws('kebab key throws, naming the key',    () => writeJson(p('n2.json'), { 'bad-key': 1 }, META), 'bad-key');
throws('nested bad key throws',               () => writeJson(p('n3.json'), { good: { AlsoBad: 1 } }, META), 'AlsoBad');
throws('date-in-key throws (yyyy_mm_dd)',     () => writeJson(p('n4.json'), { reviewed_2026_07_20: 1 }, META), 'reviewed_2026_07_20');
throws('date-in-key throws (bare year)',      () => writeJson(p('n5.json'), { reviewed_2026: 1 }, META), 'reviewed_2026');
throws('underscore key reserved for header',  () => writeJson(p('n6.json'), { _sneaky: 1 }, META), '_sneaky');
throws('malformed schema id throws',          () => writeJson(p('n7.json'), { a: 1 }, { ...META, schema: '3' }), 'name@revision');
throws('non-finite number throws',            () => writeJson(p('n8.json'), { a: Infinity }, META), 'non-finite');
throws('unsupported type throws',             () => writeJson(p('n9.json'), { a: new Date() }, META), 'unsupported type');
eq('no file was created by any refusal', fs.readdirSync(TMP).filter(n => /^n\d\.json$/.test(n)).length, 0);

console.log('\n--- NEGATIVE: the reader fails loudly ---');
{
  const f = p('reader.json');
  throws('reader rejects wrong schema, naming BOTH values', () => readJson(f, 'json-writer-test@9'), 'json-writer-test@9');
  try { readJson(f, 'json-writer-test@9'); } catch (e) {
    eq('wrong-schema message also names what was FOUND', e.message.includes('json-writer-test@1'), true);
  }
  const noHeader = p('no-header.json');
  fs.writeFileSync(noHeader, '{\n  "alpha": 1\n}\n');
  throws('reader rejects a file with no header at all', () => readJson(noHeader, 'json-writer-test@1'), 'no _schema field');
  throws('reader refuses without an expected schema', () => readJson(f), 'requires an expectedSchema');
}

console.log('\n--- NEGATIVE: an interrupted write leaves the original intact ---');
{
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
    'process.exit(9);',
  ].join('');
  try { execFileSync(process.execPath, ['-e', child], { stdio: 'pipe' }); } catch (_) { /* exit 9 expected */ }

  eq('destination byte-identical after the interruption', fs.readFileSync(f).equals(before), true);
  eq('destination still parses', readJson(f, 'json-writer-test@1').alpha, 'original');
  const strays = fs.readdirSync(TMP).filter(n => n.startsWith('.atomic.json.tmp-'));
  eq('the half-written bytes landed in a temp file, never the destination', strays.length, 1);
  strays.forEach(n => fs.unlinkSync(path.join(TMP, n)));

  try { writeJson(f, { alpha: 'x', BadKey: 1 }, META); } catch (_) {}
  eq('a refused write leaves no temp file', fs.readdirSync(TMP).filter(n => n.includes('.tmp-')).length, 0);
}

console.log('\n--- canonicalText: code-unit ordering is pinned, not alphabetical ---');
{
  // Capitals sort BEFORE the underscore, which sorts before lowercase. Invisible under snake_case,
  // which is exactly why it is pinned now, while it costs nothing. validate:false so the ordering
  // rule is tested independently of the casing rule that would otherwise reject these keys.
  const t = canonicalText({ b: 1, B: 2, _c: 3, a: 4 }, { validate: false });
  eq('code-unit order (B < _c < a < b)', Object.keys(JSON.parse(t)).join(','), 'B,_c,a,b');
}

console.log('\n--- the determinism gate REPAIRS byte damage instead of freezing it ---');
{
  // Found 2026-09-20 on work/07-email-triage/state/job-threads.json, which a hand-edit had left
  // without its trailing newline. The gate compares PARSED content, so a BOM, CRLF endings or a
  // missing trailing newline all compare equal to a clean file, and skipping the write made the
  // damage PERMANENT: the audit and V21 flag it forever and no writer ever repairs it, because the
  // content never changes again. That contradicts the helper's whole promise.
  //
  // Contract now: same content AND same bytes = no write. Same content, DIFFERENT bytes = repair,
  // keeping the existing _generated_at, because the content genuinely has not changed and moving
  // that stamp would lie about when it last did.
  const f = path.join(TMP, 'repair.json');
  const M = { purpose: 'p', writer: 'w', schema: 'json-writer-test@1' };
  eq('first write reports changed', writeJson(f, { alpha: 1 }, M).reason, 'changed');
  const stamp1 = JSON.parse(fs.readFileSync(f, 'utf8'))._generated_at;
  eq('an identical rewrite is still a no-op', writeJson(f, { alpha: 1 }, M).written, false);

  for (const [name, damage] of [
    ['a missing trailing newline', t => t.replace(/\n$/, '')],
    ['CRLF line endings', t => t.replace(/\n/g, '\r\n')],
    ['a BOM', t => '\uFEFF' + t],
  ]) {
    const clean = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, damage(clean), 'utf8');
    eq(`${name}: reported as repaired`, writeJson(f, { alpha: 1 }, M).reason, 'repaired');
    const after = fs.readFileSync(f, 'utf8');
    eq(`${name}: bytes restored exactly`, after, clean);
    eq(`${name}: _generated_at kept, not moved`, JSON.parse(after.replace(/^\uFEFF/, ''))._generated_at, stamp1);
  }

  // The repair path must not swallow a REAL change: that would freeze content, which is far worse
  // than freezing bytes.
  eq('a genuine content change is still reported as changed', writeJson(f, { alpha: 2 }, M).reason, 'changed');
  eq('and the new content actually landed', readJson(f, 'json-writer-test@1').alpha, 2);
}

// --- F11 (fleet Fix D, 2026-09-24): rule 5's ONE declared exception, both directions ---------------
// install-profile@1 declares `lanes` an identifier map, because its keys are lane ids and one of them
// is business-validation. Everything outside that one map, and every undeclared schema, must still be
// held to snake_case: an exception that leaks is worse than the conflict it settled.
{
  const PM = { purpose: 'test', writer: 'scripts/tests/test-json-writer.js', schema: 'install-profile@1' };
  const f = p('profile.json');
  const payload = { lanes: { 'business-validation': false, website: true }, locale: 'en' };
  let first = null;
  try { first = writeJson(f, payload, { ...PM, generatedAt: STAMP }); } catch (e) { bad('F11 a declared identifier map accepts a kebab lane id', e.message); }
  if (first) {
    eq('F11 a declared identifier map accepts a kebab lane id (install-profile@1 lanes)', first.written, true);
    eq('F11 a second write of the same content is a no-op (the determinism gate reads the declaration too)', writeJson(f, payload, PM).reason, 'unchanged');
  }
  throws('F11 NEGATIVE the same kebab key under an UNDECLARED schema is still refused',
    () => writeJson(p('f11-a.json'), { lanes: { 'business-validation': false } }, META), 'business-validation');
  throws('F11 NEGATIVE a kebab key OUTSIDE the declared map, in the declaring schema, is still refused',
    () => writeJson(p('f11-b.json'), { lanes: {}, 'radar-feeds': [] }, PM), 'radar-feeds');
  throws('F11 NEGATIVE a kebab key one level BELOW the declared map is still refused',
    () => writeJson(p('f11-c.json'), { lanes: { website: { 'is-on': true } } }, PM), 'is-on');
  throws('F11 NEGATIVE the declared map still refuses a key that is not an identifier (capitals)',
    () => writeJson(p('f11-d.json'), { lanes: { 'Business-Validation': false } }, PM), 'Business-Validation');
  throws('F11 NEGATIVE the declared map still refuses a date inside a key',
    () => writeJson(p('f11-e.json'), { lanes: { 'review-2026-09-24': false } }, PM), 'review-2026-09-24');
  throws('F11 NEGATIVE canonicalText with no schema holds every key to snake_case',
    () => canonicalText({ lanes: { 'business-validation': false } }), 'business-validation');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error('\nFAILURES:\n' + fails.map(x => '  - ' + x).join('\n')); process.exit(1); }
process.exit(0);
