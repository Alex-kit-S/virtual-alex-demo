#!/usr/bin/env node
'use strict';
/*
 * scripts/lib/json-writer.js - THE writer helper, and the whole of the standard's enforcement
 * mechanism. It once had a PowerShell sibling that had to be byte-identical to it; that half was
 * RETIRED with the platform on 2026-08-25 and is not coming back (docs/json-standard.md, status
 * block). This header claimed the sibling was live until 2026-09-20, which is how a reader ends up
 * hunting for a file that was deliberately deleted. Proof, not assertion, still holds for what
 * remains: scripts/tests/test-json-writer.js.
 *
 * Standard: docs/json-standard.md. This helper is what makes compliance STRUCTURAL: a file written
 * through writeJson() cannot violate the mechanical rules, because there is no code path that emits
 * a BOM, a CRLF, an unsorted key, or a missing header.
 *
 * ---------------------------------------------------------------------------------------------
 * SERIALIZATION CONTRACT: RFC 8785 (JSON Canonicalization Scheme) WITH ONE DELIBERATE DEVIATION.
 * ---------------------------------------------------------------------------------------------
 * We follow JCS for the three things that decide whether two implementations agree byte-for-byte:
 *
 *   1. KEY ORDERING - sorted by UTF-16 CODE UNIT, not locale-aware alphabetical. Capitals (U+0041..)
 *      sort BEFORE the underscore (U+005F), which sorts before lowercase (U+0061..). Inside a
 *      conforming payload this is invisible, because snake_case forbids capitals outright. It is
 *      pinned NOW, while it costs nothing, so the day a nonconforming key appears the two helpers
 *      do not silently disagree. A locale-aware sort would put "Z" after "a" on some machines and
 *      before it on others, which is exactly the class of bug that only shows up in production.
 *   2. NUMBERS - ECMAScript Number::toString, which is what JCS mandates. In node this is native:
 *      JSON.stringify IS the reference implementation, so we USE IT AS THE ORACLE rather than
 *      reimplementing the shortest-round-trip algorithm from prose. The PowerShell side has no such
 *      native, so it implements the rule and is tested against this one.
 *   3. STRINGS - JCS/ECMAScript minimal escaping: only ", \, and the C0 controls are escaped; every
 *      other character is emitted as literal UTF-8. Arabic and Swedish text therefore comes out
 *      byte-identical from either helper instead of one emitting \uXXXX and the other not.
 *      JSON.stringify is again the oracle (and since ES2019 it is well-formed, so lone surrogates
 *      are escaped rather than emitted as invalid UTF-8).
 *
 * THE DEVIATION: JCS output is COMPACT. Ours is PRETTY-PRINTED with two-space indentation.
 * This is intentional and must not be "fixed". These files live in git and their diffs get read by
 * a human during an incident; a canonical one-line file produces a one-line diff that says nothing.
 * We take the readable diff and give up literal JCS compliance. If you are here because a linter or
 * a future reader flagged us as non-compliant with RFC 8785: that is known, it is deliberate, and
 * collapsing the whitespace would destroy the diffs this system depends on. Every OTHER JCS rule is
 * followed exactly, so the canonical form is recoverable by stripping insignificant whitespace.
 * ---------------------------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

// The four generated header fields. Underscore-prefixed so that under plain code-unit ordering they
// sort ahead of every payload key (U+005F < U+0061), which is why rules 2 and 6 of the standard
// cooperate instead of needing an ordering exception.
const HEADER_KEYS = ['_generated_at', '_purpose', '_schema', '_writer'];

// Strict snake_case: lowercase start, lowercase/digit segments joined by single underscores.
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
// name@revision, optionally namespaced (skills-lock@1, alex/recovery-baseline@3).
const SCHEMA_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9-]+)*@\d+$/;

// --- rule 5's one declared exception: IDENTIFIER MAPS (fleet Fix D, F11, 2026-09-24) -------------
// A map keyed BY NAMES is data, not schema: `lanes` is keyed by lane id and one lane id is
// `business-validation`, the same shape as skill names in skills-lock.json and `google-drive` in
// backup-destinations.json. Rule 5's snake_case exists so a schema's own field names are uniform; it
// was never meant to rename the things a map is keyed by, and renaming a lane id would need a
// migration on every family laptop's gitignored profile or the lane silently resets.
//
// So the exception is DECLARED, never inferred: this registry, keyed by schema identifier, names the
// dotted payload paths whose OWN keys are identifiers. Everything else in that file, and every other
// file, stays snake_case. The writer reads it by the schema it is writing and the audit reads it by
// the file's `_schema`, so the two can never disagree, and a caller cannot opt in on its own: a kebab
// key anywhere undeclared is still refused by name. The date clause of rule 5 still applies inside a
// declared map. Widening this list is a standard change: say why in docs/json-standard.md, rule 5.
const ID_MAPS = Object.freeze({
  'install-profile@1': Object.freeze(['lanes']),
});
// An identifier: lowercase letters and digits in segments joined by single hyphens or underscores.
// Capitals, spaces, dots, a leading or trailing separator and a leading underscore are all refused.
const IDENTIFIER_KEY = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
/** The declared identifier-map paths for a schema, or [] (the default: no exception). */
function idMapsFor(schema) { return (typeof schema === 'string' && ID_MAPS[schema]) || []; }

class JsonWriterError extends Error {}

// --- rule 5: no dates in key names -------------------------------------------------------------
// A date is a VALUE and belongs in a value. Caught here because a key like `reviewed_2026_07_20` is
// perfectly valid snake_case, so the casing rule alone would let it through. It is a real pattern,
// not a hypothetical: a file that records reviews as `_reviewed_2026-07-20`, `_reviewed_2026-07-25`
// invents a new key every review, and no reader can enumerate them without pattern-matching dates.
function findDateInKey(key) {
  if (/(19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/.test(key)) return 'an embedded yyyy-mm-dd date';
  for (const seg of key.split('_')) {
    if (/^(19|20)\d{2}$/.test(seg)) return `a bare year segment "${seg}"`;
  }
  return null;
}

function validateKey(key, where, isIdMap) {
  if (isIdMap) {
    if (!IDENTIFIER_KEY.test(key)) {
      throw new JsonWriterError(
        `invalid key "${key}" at ${where}: ${where} is a declared identifier map, and its keys must be ` +
        `identifiers (/^[a-z0-9]+([-_][a-z0-9]+)*$/). The helper never silently renames a key.`);
    }
  } else if (!SNAKE_CASE.test(key)) {
    throw new JsonWriterError(
      `invalid key "${key}" at ${where}: not snake_case (rule 5). ` +
      `Expected /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/. The helper never silently renames a key.`);
  }
  const d = findDateInKey(key);
  if (d) {
    throw new JsonWriterError(
      `invalid key "${key}" at ${where}: contains ${d} (rule 5, no dates in key names). ` +
      `A date is a value; move it into a value. The helper never silently renames a key.`);
  }
}

// --- canonical serialization -------------------------------------------------------------------
// Explicitly ordered emission. We deliberately do NOT build a key-ordered object and hand it to
// JSON.stringify: JS reorders integer-like keys ("2" before "10") ahead of string keys regardless of
// insertion order, which would silently diverge from code-unit ordering.
function codeUnitCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function serialize(value, indentLevel, where, validate, idMaps = []) {
  const pad = '  '.repeat(indentLevel);
  const padIn = '  '.repeat(indentLevel + 1);

  if (value === null) return 'null';
  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new JsonWriterError(`non-finite number at ${where}: ${value} is not representable in JSON`);
    }
    return JSON.stringify(value); // ECMAScript Number::toString == the JCS rule. Oracle, not reimplementation.
  }

  if (t === 'string') return JSON.stringify(value); // JCS minimal escaping, literal UTF-8.

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v, i) => padIn + serialize(v, indentLevel + 1, `${where}[${i}]`, validate, idMaps));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }

  if (t === 'object') {
    // Only PLAIN objects. A Date, Map, Set or class instance is typeof "object" with no own
    // enumerable keys, so without this it would serialize to a silent, data-losing "{}" instead of
    // refusing. Caught by the test suite, which is the whole reason the negative half exists.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const cname = (value.constructor && value.constructor.name) || 'non-plain object';
      throw new JsonWriterError(
        `unsupported type at ${where}: ${cname}. Only plain objects, arrays, strings, numbers, ` +
        `booleans and null are JSON values. Convert it explicitly (e.g. a Date to an ISO string) ` +
        `rather than relying on a coercion that would silently emit {}.`);
    }
    const keys = Object.keys(value).sort(codeUnitCompare);
    if (keys.length === 0) return '{}';
    const isIdMap = where !== '' && idMaps.includes(where);
    const parts = keys.map(k => {
      if (validate && !HEADER_KEYS.includes(k)) validateKey(k, where === '' ? '(root)' : where, isIdMap);
      const child = where === '' ? k : `${where}.${k}`;
      return padIn + JSON.stringify(k) + ': ' + serialize(value[k], indentLevel + 1, child, validate, idMaps);
    });
    return '{\n' + parts.join(',\n') + '\n' + pad + '}';
  }

  throw new JsonWriterError(
    `unsupported type at ${where}: ${t}. Only object, array, string, number, boolean and null are ` +
    `JSON values. Convert it explicitly rather than relying on a coercion.`);
}

/**
 * Canonical (pretty, sorted, JCS-scalar) text for a value. No header, no trailing newline.
 * `schema` selects that schema's declared identifier maps (ID_MAPS) for key validation; without it
 * every key is held to snake_case, which is the default and the safe direction.
 */
function canonicalText(value, { validate = true, schema = null } = {}) {
  return serialize(value, 0, '', validate, idMapsFor(schema));
}

// --- read (rule 4) -----------------------------------------------------------------------------
/**
 * Parse a file and enforce its schema identifier. Fails LOUDLY with BOTH values on mismatch and on
 * absence. There is no silent fallback and no "accept the newest shape I understand" path: a reader
 * that quietly accepts an unknown schema is how a format change becomes a wrong answer instead of an
 * error (S5 read $baseline.listeners off a file with no listeners key, error-log 2026-08-23).
 */
function readJson(filePath, expectedSchema) {
  if (!expectedSchema) {
    throw new JsonWriterError(`readJson("${filePath}") requires an expectedSchema (rule 4)`);
  }
  let raw = fs.readFileSync(filePath, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // tolerate a legacy BOM on READ, never write one
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new JsonWriterError(`${filePath}: not parseable as JSON (${e.message})`);
  }
  const actual = parsed && typeof parsed === 'object' ? parsed._schema : undefined;
  if (actual === undefined) {
    throw new JsonWriterError(
      `${filePath}: schema check FAILED. expected "${expectedSchema}", found: no _schema field at all. ` +
      `An unheadered file is not a conforming file (rule 2).`);
  }
  if (actual !== expectedSchema) {
    throw new JsonWriterError(
      `${filePath}: schema check FAILED. expected "${expectedSchema}", found "${actual}". ` +
      `Refusing to guess: bump the reader, or the writer's revision, deliberately.`);
  }
  return parsed;
}

// --- write -------------------------------------------------------------------------------------
/**
 * Write `data` to `filePath` conforming to every mechanical rule in the standard.
 *
 * DETERMINISM vs TIMESTAMP, the collision and its resolution.
 * Rule 7 wants the same data written twice to be byte-identical; rule 2 stamps a moving
 * `_generated_at`. Those cannot both hold if we write unconditionally. Resolution: when the content
 * is unchanged we DO NOT WRITE AT ALL. The file is untouched, its timestamp preserved, and mtime
 * stays meaningful. "Same data twice produces byte-identical output" becomes the stronger "same data
 * twice produces no second write", and `_generated_at` honestly means WHEN THE CONTENT LAST CHANGED
 * rather than when a script last ran.
 *
 * Scope note: the comparison covers the payload AND the three caller-supplied header values. The
 * brief said payload; including purpose/writer/schema is a deliberate widening, because a schema
 * REVISION BUMP with an unchanged payload must reach disk or every rule-4 reader breaks on a file
 * that still claims the old revision.
 *
 * @returns {{written: boolean, path: string, reason: string, bytes: number}}
 */
function writeJson(filePath, data, meta) {
  // meta.generatedAt exists for tests and reproducible builds (it is how cross-language
  // byte-identity is provable at all, since two runs otherwise differ by their clock).
  // Callers leave it unset.
  const { purpose, writer, schema, generatedAt } = meta || {};
  for (const [k, v] of Object.entries({ purpose, writer, schema })) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new JsonWriterError(`writeJson("${filePath}"): meta.${k} is required and must be a non-empty string`);
    }
  }
  if (!SCHEMA_ID.test(schema)) {
    throw new JsonWriterError(
      `writeJson("${filePath}"): schema "${schema}" is malformed. Expected name@revision ` +
      `(e.g. "skills-lock@1"). A bare number is not a schema identifier (rule 3).`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new JsonWriterError(`writeJson("${filePath}"): data must be an object (the header fields live beside it)`);
  }
  for (const k of Object.keys(data)) {
    if (k.startsWith('_')) {
      throw new JsonWriterError(
        `writeJson("${filePath}"): payload key "${k}" is underscore-prefixed, which is reserved for the ` +
        `four generated header fields. The helper stamps those; a caller must not.`);
    }
  }

  // Validates keys as it goes, so a bad key throws before anything touches the disk.
  const payloadText = canonicalText(data, { validate: true, schema });

  // --- determinism gate: is the content actually different from what is already there? ---
  //
  // UNCHANGED CONTENT IS NOT THE SAME AS AN UNDAMAGED FILE, and conflating the two made the gate a
  // ratchet in the wrong direction (found 2026-09-20 on work/07-email-triage/state/job-threads.json,
  // which a hand-edit had left without its trailing newline). The comparison below is over PARSED
  // content, so a BOM, CRLF endings or a missing trailing newline all compare equal to a clean file.
  // Skipping the write then made that damage PERMANENT: the file breaks rule 1, the audit and V21
  // flag it forever, and no writer will ever repair it because the content never changes again.
  // That directly contradicts the helper's whole promise, that a file written through writeJson
  // cannot violate the mechanical rules.
  //
  // So: identical content AND identical bytes means no write, exactly as before. Identical content
  // but DIFFERENT bytes means REPAIR - rewrite the mechanical shape while KEEPING the existing
  // `_generated_at`, because the content genuinely has not changed and moving that stamp would be a
  // lie about when it last did. Determinism is preserved (a repeat write of clean bytes is still a
  // no-op) and the file heals.
  let repairStamp = null;
  if (fs.existsSync(filePath)) {
    try {
      const rawExisting = fs.readFileSync(filePath, 'utf8');
      const existing = JSON.parse(rawExisting.replace(/^\uFEFF/, ''));
      const { _generated_at, _purpose, _schema, _writer, ...existingPayload } = existing;
      const same =
        _purpose === purpose && _writer === writer && _schema === schema &&
        canonicalText(existingPayload, { validate: false }) === payloadText;
      if (same) {
        const wouldBe = canonicalText(
          { ...data, _generated_at, _purpose: purpose, _schema: schema, _writer: writer },
          { validate: true, schema }) + '\n';
        if (rawExisting === wouldBe) {
          return { written: false, path: filePath, reason: 'unchanged', bytes: fs.statSync(filePath).size };
        }
        // Content matches, bytes do not: repair under the ORIGINAL timestamp.
        if (typeof _generated_at === 'string' && _generated_at) repairStamp = _generated_at;
      }
    } catch (e) {
      // Unreadable or malformed existing file: fall through and replace it. Being unable to compare
      // is not a reason to leave a broken file in place.
    }
  }

  const stamp = generatedAt || repairStamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const full = { ...data, _generated_at: stamp, _purpose: purpose, _schema: schema, _writer: writer };
  const text = canonicalText(full, { validate: true, schema }) + '\n'; // rule 1: exactly one trailing newline
  const buf = Buffer.from(text, 'utf8');                       // rule 1: UTF-8, and Buffer never adds a BOM

  atomicWrite(filePath, buf);
  return { written: true, path: filePath, reason: repairStamp ? 'repaired' : 'changed', bytes: buf.length };
}

/**
 * Stage beside the destination, then replace in one operation, so a process dying mid-write leaves
 * the OLD file intact and never a half-written one.
 *
 * Windows caveat, stated rather than assumed: POSIX rename(2) semantics are not automatic here.
 * Node's fs.renameSync goes through libuv, which calls MoveFileExW with MOVEFILE_REPLACE_EXISTING,
 * and that IS an atomic metadata operation on NTFS for a same-volume move. Staging in the SAME
 * DIRECTORY is what guarantees same-volume. (The PowerShell half cannot use Move and uses
 * File.Replace for the same reason; see its comment.)
 */
function atomicWrite(filePath, buf) {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);      // durability before the swap, so the replace cannot expose a short file
    fs.closeSync(fd); fd = null;
    fs.renameSync(tmp, filePath);
  } catch (e) {
    if (fd !== null && fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

module.exports = { writeJson, readJson, canonicalText, JsonWriterError, HEADER_KEYS, SNAKE_CASE, SCHEMA_ID,
                   ID_MAPS, IDENTIFIER_KEY, idMapsFor };
