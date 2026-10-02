// @ts-check
// scripts/lib/json-writer.js - the one writer of Alex's JSON files, and the two readers beside it.
//
// WHAT. Every file the JSON standard (docs/json-standard.md) enforces is written through writeJson, and it
// cannot carry a byte-order mark, a carriage return, an unsorted key or a missing header, because no path
// through this file emits one. readJson reads such a file back and refuses every schema but the one its
// caller names. readJsonHeaderless reads a JSON file that has no header at all (a manifest, a lock, a
// payload) for the callers that parse one by hand today. canonicalText is the exact text the audit and
// validator check V21 compare every enforced file against, less its final line break.
//
// HOW. writeJson checks the three header values and every key before it touches the disk, then renders the
// payload and the four header fields in the canonical form described above serialize(). It compares that
// with the file already there: the same content in the same bytes is no write at all, the same content in
// damaged bytes is rewritten under the file's own _generated_at when that is a string (a caller's
// meta.generatedAt wins over it), and anything else is written stamped with the clock. The bytes are
// staged in a temporary file in the destination's folder and renamed over the destination. readJson
// parses, forgives a legacy byte-order mark and checks _schema. readJsonHeaderless is JSON.parse over the
// file's UTF-8 text, and its three options (documented at the function) fit every read the checker's
// dup-json-read leg lists without changing what any of them returns or throws.
//
// NEVER. Renames a key or coerces a value: it throws a JsonWriterError naming the key or value and where it
// sits, before any byte reaches the disk. Leaves a half-written destination or a temporary file behind a
// failed write. Moves a string _generated_at when the content did not change. Collapses the two-space
// pretty-printing into compact RFC 8785 output: the deviation is deliberate, and "fixing" it would destroy
// every readable diff. Wraps or rewords an error in readJsonHeaderless, which is what makes it a drop-in
// for the reads it replaces. Seven defects are pinned as they are by the bytes test and are not fixed in
// passing: a sparse array is written as invalid JSON, a circular value throws a RangeError, a header-named
// key below the root is accepted, a numeric generatedAt is stamped as a number, a repair of a file stamped
// that way takes the clock, integer-like keys in an identifier map are written in an order the audit
// cannot verify, and a replaced file's POSIX mode is lost.
//
// Usage: module only - const { writeJson, readJson, jsonlRow } = require('./lib/json-writer.js');
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The four generated header fields. Underscore-prefixed so that under plain code-unit ordering they sort
// ahead of every payload key (U+005F < U+0061), which is why rules 2 and 6 of the standard cooperate
// instead of needing an ordering exception.
const HEADER_KEYS = ['_generated_at', '_purpose', '_schema', '_writer'];

// Strict snake_case: lowercase start, lowercase and digit segments joined by single underscores.
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
// name@revision, optionally namespaced (skills-lock@1, alex/recovery-baseline@3).
const SCHEMA_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9-]+)*@\d+$/;

// Rule 5's one declared exception, identifier maps. A map keyed BY NAMES is data, not schema: `lanes` is
// keyed by lane id and one lane id is `business-validation`, the same shape as skill names in
// skills-lock.json. Rule 5's snake_case keeps a schema's own field names uniform; it was never meant to
// rename the things a map is keyed by, and renaming a lane id would need a migration on every owner's
// gitignored profile or the lane silently resets.
//
// So the exception is DECLARED, never inferred: this registry, keyed by schema identifier, names the
// dotted payload paths whose own keys are identifiers. Everything else in that file, and every other file,
// stays snake_case. The writer reads it by the schema it is writing and the audit by the file's `_schema`,
// so the two cannot disagree, and a caller cannot opt in on its own: an undeclared kebab key is still
// refused by name. The date clause of rule 5 still applies inside a declared map. Widening this list is a
// standard change: say why in docs/json-standard.md, rule 5.
/** @type {Readonly<Record<string, readonly string[]>>} */
const ID_MAPS = Object.freeze({
  'install-profile@1': Object.freeze(['lanes'])
});
// An identifier: lowercase letters and digits in segments joined by single hyphens or underscores.
// Capitals, spaces, dots, a leading or trailing separator and a leading underscore are all refused.
const IDENTIFIER_KEY = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

// One level of indentation in every file this writes: the readable-diff deviation from RFC 8785.
const INDENT = '  ';
// A date inside a key, with or without separators, and a key segment that is a bare year.
const DATE_IN_KEY = /(19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/;
const YEAR_SEGMENT = /^(19|20)\d{2}$/;
// Windows PowerShell 5.1 prefixes one to every UTF-8 file it writes; JSON.parse refuses it.
const BYTE_ORDER_MARK = 0xfeff;

/**
 * @typedef {object} WriteMeta
 * @property {string} [purpose] the `_purpose` header: what the file is for, one sentence
 * @property {string} [writer] the `_writer` header: the repo-relative path of the script that owns the file
 * @property {string} [schema] the `_schema` header, name@revision (rule 3)
 * @property {string} [generatedAt] a fixed `_generated_at`, for tests and reproducible builds; callers leave it unset
 */

/**
 * @typedef {object} WriteResult
 * @property {boolean} written false only when the file already held these exact bytes
 * @property {string} path the destination, as the caller gave it
 * @property {'unchanged' | 'repaired' | 'changed'} reason why it was or was not written
 * @property {number} bytes the size of the file now on disk
 */

/**
 * @typedef {object} HeaderlessOptions
 * @property {boolean} [bom] strip one leading byte-order mark before parsing; off by default
 * @property {unknown} [ifMissing] when given, returned as it is, without a read, when nothing is at the path
 * @property {unknown} [ifUnreadable] when given, returned as it is in place of any error the read or the parse throws
 */

/** A refusal: the value, key or header a caller passed cannot be written as a conforming file. */
class JsonWriterError extends Error {}

/**
 * The declared identifier-map paths for a schema, or none: the default, and the safe direction. Only the
 * registry's own entries count; an indexed read would answer `toString` or `__proto__` from its prototype.
 * @param {unknown} schema
 * @returns {readonly string[]}
 */
function idMapsFor(schema) {
  return typeof schema === 'string' && Object.hasOwn(ID_MAPS, schema) ? ID_MAPS[schema] : [];
}

/**
 * The text without the one byte-order mark it may start with.
 * @param {string} text
 */
function withoutByteOrderMark(text) {
  return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}

/**
 * What makes a key carry a date, or null. A date is a VALUE, and a key like `reviewed_2026_07_20` is valid
 * snake_case, so the casing rule alone would let it through: a file that records each review under a new
 * dated key invents a key per review, and no reader can enumerate them without pattern-matching dates.
 * @param {string} key
 * @returns {string | null}
 */
function findDateInKey(key) {
  if (DATE_IN_KEY.test(key)) return 'an embedded yyyy-mm-dd date';
  for (const segment of key.split('_')) {
    if (YEAR_SEGMENT.test(segment)) return `a bare year segment "${segment}"`;
  }
  return null;
}

/**
 * Refuse a key rule 5 does not allow, naming it and where it sits.
 * @param {string} key
 * @param {string} where the dotted path of the object that holds it, or "(root)"
 * @param {boolean} isIdMap whether that object is a declared identifier map
 */
function validateKey(key, where, isIdMap) {
  if (isIdMap) {
    if (!IDENTIFIER_KEY.test(key)) {
      throw new JsonWriterError(
        `invalid key "${key}" at ${where}: ${where} is a declared identifier map, and its keys must be ` +
          `identifiers (/^[a-z0-9]+([-_][a-z0-9]+)*$/). The helper never silently renames a key.`
      );
    }
  } else if (!SNAKE_CASE.test(key)) {
    throw new JsonWriterError(
      `invalid key "${key}" at ${where}: not snake_case (rule 5). ` +
        `Expected /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/. The helper never silently renames a key.`
    );
  }
  const date = findDateInKey(key);
  if (date) {
    throw new JsonWriterError(
      `invalid key "${key}" at ${where}: contains ${date} (rule 5, no dates in key names). ` +
        `A date is a value; move it into a value. The helper never silently renames a key.`
    );
  }
}

/**
 * UTF-16 code unit order, never locale order.
 * @param {string} a
 * @param {string} b
 */
function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The canonical text of one value: RFC 8785 (the JSON Canonicalization Scheme) with one deliberate
 * deviation. It follows JCS in the three things that decide whether two serializers agree byte for byte:
 *
 * 1. Key order is by UTF-16 code unit, never locale-aware: capitals (U+0041..) sort before the underscore
 *    (U+005F), which sorts before lower case (U+0061..). Inside a conforming payload this is invisible,
 *    because snake_case forbids capitals, and it is pinned while that costs nothing. A locale-aware sort
 *    puts "Z" after "a" on some machines and before it on others. Keys are emitted in an explicit order,
 *    never by building a sorted object for JSON.stringify: JavaScript puts integer-like keys ("2" before
 *    "10") ahead of every other key whatever the insertion order, which would break code-unit order.
 * 2. Numbers are ECMAScript Number::toString, which JCS mandates and JSON.stringify implements, so
 *    JSON.stringify is used as the oracle rather than a reimplementation of the shortest round trip.
 * 3. Strings take minimal escaping: only the quote, the backslash and the C0 controls are escaped, and
 *    every other character is literal UTF-8, so Arabic and Swedish text is never written as \uXXXX.
 *    JSON.stringify is again the oracle, and it escapes a lone surrogate rather than emit invalid UTF-8.
 *
 * The deviation: JCS output is compact, and this is pretty-printed with two-space indentation. These files
 * live in git and their diffs are read by a person during an incident; a one-line file gives a one-line
 * diff that says nothing. Every other JCS rule holds, so the canonical form is recovered by stripping the
 * insignificant white space.
 *
 * Only plain objects (and null-prototype ones), arrays, strings, finite numbers, booleans and null are
 * written; anything else is refused where it sits. A Date, Map, Set or class instance is typeof "object"
 * with no own enumerable keys, so without that refusal it would come out as a silent, data-losing {}.
 * @param {any} value
 * @param {number} indentLevel
 * @param {string} where the dotted path of `value`, '' at the root
 * @param {boolean} validate whether keys are held to rule 5
 * @param {readonly string[]} [idMaps] the declared identifier-map paths of the schema being written
 * @returns {string}
 */
function serialize(value, indentLevel, where, validate, idMaps = []) {
  const pad = INDENT.repeat(indentLevel);
  const padIn = INDENT.repeat(indentLevel + 1);

  if (value === null) return 'null';
  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new JsonWriterError(`non-finite number at ${where}: ${value} is not representable in JSON`);
    }
    return JSON.stringify(value);
  }

  if (t === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v, i) => padIn + serialize(v, indentLevel + 1, `${where}[${i}]`, validate, idMaps));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }

  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const cname = value.constructor?.name || 'non-plain object';
      throw new JsonWriterError(
        `unsupported type at ${where}: ${cname}. Only plain objects, arrays, strings, numbers, ` +
          `booleans and null are JSON values. Convert it explicitly (e.g. a Date to an ISO string) ` +
          `rather than relying on a coercion that would silently emit {}.`
      );
    }
    const keys = Object.keys(value).sort(codeUnitCompare);
    if (keys.length === 0) return '{}';
    const isIdMap = where !== '' && idMaps.includes(where);
    const parts = keys.map((k) => {
      if (validate && !HEADER_KEYS.includes(k)) validateKey(k, where === '' ? '(root)' : where, isIdMap);
      const child = where === '' ? k : `${where}.${k}`;
      return padIn + JSON.stringify(k) + ': ' + serialize(value[k], indentLevel + 1, child, validate, idMaps);
    });
    return '{\n' + parts.join(',\n') + '\n' + pad + '}';
  }

  throw new JsonWriterError(
    `unsupported type at ${where}: ${t}. Only object, array, string, number, boolean and null are ` +
      `JSON values. Convert it explicitly rather than relying on a coercion.`
  );
}

/**
 * The canonical text of a value: pretty, sorted, JCS scalars. No header and no final line break. Any JSON
 * root is accepted, an array or a string too. `schema` selects that schema's declared identifier maps for
 * key validation; without it every key is held to snake_case, which is the default and the safe direction.
 * @param {unknown} value
 * @param {{ validate?: boolean, schema?: string | null }} [options]
 * @returns {string}
 */
function canonicalText(value, { validate = true, schema = null } = {}) {
  return serialize(value, 0, '', validate, idMapsFor(schema));
}

/**
 * One row of a `.jsonl` file: the JSON writer's key order and naming rules, collapsed to a single line
 * (a `.jsonl` file is excluded from the JSON standard by its own text, so this is not `writeJson` for a
 * one-line file - it is `canonicalText`'s validated, sorted rendering, re-parsed and re-stringified compact).
 * The home for every append-one-line-at-a-time writer in the tree: `scripts/run-log.mjs`,
 * `scripts/build-online-template.mjs`'s changelog rows, and the lesson row `scripts/close-out-online.sh`'s
 * heredoc appends.
 * @param {object} row
 * @returns {string}
 */
function jsonlRow(row) {
  return JSON.stringify(JSON.parse(canonicalText(row)));
}

/**
 * Parse a file and enforce its schema identifier (rule 4). Fails loudly, naming both values, on a mismatch
 * and on an absent `_schema`. There is no fallback and no "accept the newest shape I understand": a reader
 * that quietly accepts an unknown schema is how a format change becomes a wrong answer instead of an
 * error. A legacy byte-order mark is forgiven on read, never written. A file that cannot be read throws
 * the error fs gives; every other refusal is a JsonWriterError.
 * @param {string} filePath
 * @param {string} [expectedSchema] required: its absence is a refusal
 * @returns {any} the parsed file, header included
 */
function readJson(filePath, expectedSchema) {
  if (!expectedSchema) {
    throw new JsonWriterError(`readJson("${filePath}") requires an expectedSchema (rule 4)`);
  }
  const raw = withoutByteOrderMark(fs.readFileSync(filePath, 'utf8'));
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const { message } = /** @type {SyntaxError} */ (e); // the only error JSON.parse throws
    throw new JsonWriterError(`${filePath}: not parseable as JSON (${message})`);
  }
  const actual = parsed && typeof parsed === 'object' ? parsed._schema : undefined;
  if (actual === undefined) {
    throw new JsonWriterError(
      `${filePath}: schema check FAILED. expected "${expectedSchema}", found: no _schema field at all. ` +
        `An unheadered file is not a conforming file (rule 2).`
    );
  }
  if (actual !== expectedSchema) {
    throw new JsonWriterError(
      `${filePath}: schema check FAILED. expected "${expectedSchema}", found "${actual}". ` +
        `Refusing to guess: bump the reader, or the writer's revision, deliberately.`
    );
  }
  return parsed;
}

/**
 * Parse a JSON file that carries no schema header: the home of the tree's hand-written
 * `JSON.parse(fs.readFileSync(file, 'utf8'))` reads, which disagree about a missing file, a file that
 * does not parse and a byte-order mark. So nothing is decided for them. With no options this IS that
 * expression: the parsed value, or exactly the error fs or JSON.parse throws, never wrapped. Each option
 * reproduces one habit a caller has today, and a caller states its habit rather than inheriting another's:
 *
 * - `bom: true` strips one leading byte-order mark first, as scripts/employer-data-guard.mjs and
 *   scripts/run-migrations.js do. Off by default, because every other read the dup-json-read leg lists
 *   refuses a marked file today.
 * - `ifMissing` is returned, with no read, when fs.existsSync says nothing is at the path, as the reads
 *   guarded by an existsSync do. A file that is there and does not parse still throws. A descriptor is
 *   never missing.
 * - `ifUnreadable` is returned in place of any error the read or the parse throws, as the reads inside a
 *   bare catch do. With both options, a missing file takes `ifMissing`.
 *
 * Either value is returned as given, so a caller that must tell "absent" from a file that holds that value
 * passes one no file can hold.
 *
 * Two hand-written reads the leg does not list take no option set: waiting-on-them.js refuses an
 * unreadable file and invalid JSON in two different words, which the no-option call and an
 * `instanceof SyntaxError` split reproduce, and seed-contract-check.mjs needs the raw text after the
 * parse, which no option returns.
 * @param {import('node:fs').PathOrFileDescriptor} file a path, or a descriptor such as 0 for stdin
 * @param {HeaderlessOptions} [options]
 * @returns {any} what JSON.parse returns
 */
function readJsonHeaderless(file, options = {}) {
  const { bom = false } = options;
  if (Object.hasOwn(options, 'ifMissing') && typeof file !== 'number' && !fs.existsSync(file)) {
    return options.ifMissing;
  }
  try {
    const text = fs.readFileSync(file, 'utf8');
    return JSON.parse(bom ? withoutByteOrderMark(text) : text);
  } catch (error) {
    if (Object.hasOwn(options, 'ifUnreadable')) return options.ifUnreadable;
    throw error;
  }
}

/**
 * Refuse a header value that is not a non-blank string.
 * @param {string} filePath
 * @param {string} name the field of `meta` it came from
 * @param {unknown} value
 * @returns {asserts value is string}
 */
function requireMetaText(filePath, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new JsonWriterError(`writeJson("${filePath}"): meta.${name} is required and must be a non-empty string`);
  }
}

/**
 * The clock as `_generated_at` stamps it: UTC, to the second, with a trailing Z.
 * @returns {string}
 */
function clockStamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Write `data` to `filePath` so that it keeps every mechanical rule of the standard.
 *
 * Determinism against the timestamp. Rule 7 wants the same data written twice to be byte-identical, and
 * rule 2 stamps a moving `_generated_at`; both cannot hold if every call writes. So unchanged content is
 * not written at all: the file, its stamp and its mtime stay as they are, and `_generated_at` means when
 * the content last changed rather than when a script last ran. The comparison covers the payload and the
 * three header values a caller supplies, so a schema revision bump with the same payload still reaches the
 * disk; otherwise every rule-4 reader would refuse a file that still names the old revision.
 *
 * Unchanged content is not the same as an undamaged file. The comparison is over PARSED content, so a
 * byte-order mark, CRLF endings or a missing final line break compare equal to a clean file, and skipping
 * the write there would keep the damage for good, since the content never changes again. So the same
 * content in the same bytes is no write, and the same content in other bytes is a repair that keeps the
 * existing `_generated_at` when it is a string, because the content did not change and moving the stamp
 * would misstate when it did; a caller's `generatedAt` still wins. A file that cannot be read or parsed is
 * simply replaced.
 * @param {string} filePath
 * @param {unknown} data the payload: a plain object whose top-level keys do not start with an underscore
 * @param {WriteMeta} [meta] purpose, writer and schema are required
 * @returns {WriteResult}
 */
function writeJson(filePath, data, meta) {
  const { purpose, writer, schema, generatedAt } = meta || {};
  requireMetaText(filePath, 'purpose', purpose);
  requireMetaText(filePath, 'writer', writer);
  requireMetaText(filePath, 'schema', schema);
  if (!SCHEMA_ID.test(schema)) {
    throw new JsonWriterError(
      `writeJson("${filePath}"): schema "${schema}" is malformed. Expected name@revision ` +
        `(e.g. "skills-lock@1"). A bare number is not a schema identifier (rule 3).`
    );
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new JsonWriterError(`writeJson("${filePath}"): data must be an object (the header fields live beside it)`);
  }
  for (const k of Object.keys(data)) {
    if (k.startsWith('_')) {
      throw new JsonWriterError(
        `writeJson("${filePath}"): payload key "${k}" is underscore-prefixed, which is reserved for the ` +
          `four generated header fields. The helper stamps those; a caller must not.`
      );
    }
  }

  // Every key is validated here, so a bad key throws before anything touches the disk.
  const payloadText = canonicalText(data, { validate: true, schema });

  /** @type {string | null} */
  let repairStamp = null;
  if (fs.existsSync(filePath)) {
    try {
      const rawExisting = fs.readFileSync(filePath, 'utf8');
      const existing = JSON.parse(withoutByteOrderMark(rawExisting));
      const { _generated_at, _purpose, _schema, _writer, ...existingPayload } = existing;
      const same =
        _purpose === purpose &&
        _writer === writer &&
        _schema === schema &&
        canonicalText(existingPayload, { validate: false }) === payloadText;
      if (same) {
        const wouldBe =
          canonicalText(
            { ...data, _generated_at, _purpose: purpose, _schema: schema, _writer: writer },
            { validate: true, schema }
          ) + '\n';
        if (rawExisting === wouldBe) {
          return { written: false, path: filePath, reason: 'unchanged', bytes: fs.statSync(filePath).size };
        }
        if (typeof _generated_at === 'string' && _generated_at) repairStamp = _generated_at;
      }
    } catch {
      // Unreadable or malformed: replace it. Being unable to compare is no reason to keep a broken file.
    }
  }

  const stamp = generatedAt || repairStamp || clockStamp();
  const full = { ...data, _generated_at: stamp, _purpose: purpose, _schema: schema, _writer: writer };
  const text = canonicalText(full, { validate: true, schema }) + '\n'; // rule 1: exactly one final line break
  const buf = Buffer.from(text, 'utf8'); // rule 1: UTF-8, and Buffer never adds a byte-order mark

  atomicWrite(filePath, buf);
  return { written: true, path: filePath, reason: repairStamp ? 'repaired' : 'changed', bytes: buf.length };
}

/**
 * Stage the bytes beside the destination, then replace it in one operation, so a process that dies
 * mid-write leaves the old file intact, never a half-written one. On Windows, fs.renameSync goes through
 * libuv to MoveFileExW with MOVEFILE_REPLACE_EXISTING, which is one atomic metadata operation on NTFS for a
 * move within a volume, and staging in the destination's own folder is what keeps it within one volume.
 * The temporary file is flushed to disk before the rename, so the rename can never expose a short file. On
 * any failure the temporary file is removed and the error fs gave is thrown as it is.
 * @param {string} filePath
 * @param {Buffer} buf
 */
function atomicWrite(filePath, buf) {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  /** @type {number | null | undefined} */
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeSync(fd, buf);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, filePath);
  } catch (e) {
    if (fd !== null && fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // The write already failed; that error, not this one, is what the caller must see.
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // Best effort, for the same reason.
    }
    throw e;
  }
}

module.exports = {
  writeJson,
  readJson,
  canonicalText,
  jsonlRow,
  JsonWriterError,
  HEADER_KEYS,
  SNAKE_CASE,
  SCHEMA_ID,
  ID_MAPS,
  IDENTIFIER_KEY,
  idMapsFor,
  readJsonHeaderless
};
