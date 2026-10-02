#!/usr/bin/env node
// @ts-check
// scripts/json-standard-audit.js - does the JSON standard hold on this disk, file by file and writer by writer.
//
// WHAT. The measurement behind docs/json-standard.md. For every JSON file whose shape this Kit defines, it
// says whether the file is exactly what scripts/lib/json-writer.js would write, and if not, which rules it
// breaks. It also lists every code path that writes such a file without the helper, because a file a raw
// writer produces conforms by accident and drifts on the next run. CI runs it as the ratchet: a file on the
// enforced list that breaks a rule, or a code path writing one around the helper, fails the build, and the
// unmigrated backlog is reported and never blocks. validate-alex V21 reuses its contract parser and rules.
//
// HOW. The contract is system/kit-manifest.json -> json_standard.enforced[], read by parseContract, which throws and
// never defaults. Scope is the ownership rule: what IN_SCOPE_GLOBS reach, less what another party owns. auditText
// judges one file from its bytes: rule 1 on the raw text, then on the parsed value the header, the schema, the
// _writer claim, key naming and key order, and last a byte comparison with the helper's own output, which is the
// CANON column. The writer scan reads the .js, .mjs and .cjs files under scripts/, work/ and system/recall/ that
// name JSON.stringify, takes each call that writes a named file, follows its data through every value a name is ever
// given, and resolves the destination with a small static evaluator that follows a relative import to its own value
// (REPO from scripts/lib/repo-root.js is one); a destination it cannot resolve is listed, never guessed. A
// PowerShell ConvertTo-Json write is listed by file and line. The table goes to stdout, or the same result as JSON
// under --json; --files skips the writer scan, --verbose lists the unresolved sites, --root audits another tree.
// The command line parses through scripts/lib/args.js on the operator edge: a dangling value, an unknown flag
// or a stray word each refuse with one line on stderr, exit 1.
//
// NEVER. Writes, fetches or costs a token, and never rewrites a file to make it conform: the unmigrated writer would
// undo that on its next run. Passes --enforced without its list, which is exit 1, because a ratchet with no list
// looks exactly like a healthy one; calls an empty tree clean; passes a file whose value the helper cannot render,
// which is UNVERIFIABLE. Fixes these pinned limits in passing (scripts/tests/test-json-standard-ratchet.mjs holds
// each until the defect ledger schedules it): the writer scan sees only a write call made directly on a path it
// resolves, so a function declaration, a destination another module exports as anything but a literal or a
// resolvable path.join/resolve, a rename, a bracket or aliased call, writeSync, a destructured stringify, a
// destination passed in as a parameter, a stream in a file that never names JSON.stringify and a Python writer all
// walk past it, and a shadowed name resolves to its first declaration (R7-6); it reads comments and strings as code
// (R7-7); a hand edit that stays canonical passes (R7-18); CANON ignores a BOM, and a secret-bearing file's
// _schema value is printed (R7-24); a value nested past the key walk's own stack fails the run (exit 1). One
// limit is named, not pinned: a relative destination resolves against the working folder, not --root, which
// holds because CI runs from the root.
//
// Usage: node scripts/json-standard-audit.js [--enforced] [--json] [--files] [--verbose] [--root <dir>]
// Exit: 0 clean - 1 the audit could not run, or --enforced has no contract - 2 findings, or under --enforced a regression
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EXIT } = require('./lib/exit-codes.js');
const { Refusal } = require('./lib/errors.js');
const {
  canonicalText,
  HEADER_KEYS,
  IDENTIFIER_KEY,
  idMapsFor,
  SCHEMA_ID,
  SNAKE_CASE
} = require('./lib/json-writer.js');
const { REPO } = require('./lib/repo-root.js');

/**
 * One audited file: a row of the table, a member of --json's files, and what V21 reads.
 * @typedef {{ path: string, dialect: string | null, canonical: boolean, findings: string[] }} FileRow
 */
/**
 * A code path that writes JSON into a file. A node site names its call; a PowerShell site has no call,
 * no target and no scope, because its destination is built at run time.
 * @typedef {{ site: string, target: string | null, in_scope: boolean | null, kind: string, lang: string,
 *   call?: string, imports_helper: boolean }} WriterSite
 */
/**
 * What auditTree found. The last three keys exist only when an enforced list was given.
 * @typedef {{ root: string, files: FileRow[], excluded: { path: string, reason: string }[],
 *   writer_sites: WriterSite[], findings: number, file_findings: number, writer_bypasses: number,
 *   powershell_sites: number, enforced?: string[], enforced_present?: string[], regressions?: string[] }} TreeReport
 */
/**
 * The key-level findings of one file, each list in document order.
 * @typedef {{ unsorted: string[], sortUnverifiable: string[], underscore: string[], badCase: string[],
 *   dateKey: string[] }} KeyFindings
 */

// ------------------------------------------------------------------------------------------------ scope

/** The files whose shape this Kit defines. One `*` per segment, matching the repository's layout. */
const IN_SCOPE_GLOBS = ['system/*.json', 'work/*/state/*.json', 'work/*/config/*.json', 'skills-lock.json'];

/**
 * Out by the ownership rule, each with the reason a file they exclude is listed under. No glob reaches
 * them today; they are named anyway, so that widening a glob can never quietly pull a shape someone else
 * owns into scope.
 */
const OUT_OF_SCOPE_PATHS = [
  ['.claude/settings.json', 'Anthropic defines the harness schema and changes it on its own schedule'],
  ['.claude/settings.local.json', 'same, and it is machine-local']
];
const OUT_OF_SCOPE_PREFIXES = [['.agents/skills/', 'third-party skills bring their own files and their own shapes']];

/** Files whose values must never reach a log or a terminal: a finding about them withholds every name. */
const SECRET_BEARING = new Set(['system/credentials-ledger.json']);
const WITHHELD = '(name withheld: secret-bearing file)';

/** Where the ratchet's list lives, and why there: see json_standard.note in that file. */
const CONTRACT_REL = 'system/kit-manifest.json';
const HELPER_REL = 'scripts/lib/json-writer.js';
const DOC_REL = 'docs/json-standard.md';
const NO_CONTRACT =
  'That list IS the ratchet; without it --enforced has no scope and would pass everything, which is worse ' +
  `than no check. Restore it (doc: ${DOC_REL}).`;

// ------------------------------------------------------------------------------------- the writer scan's reach

/** Where node writers are looked for, and PowerShell ones; node_modules and .git are never walked. */
const WRITER_ROOTS = [
  { dir: 'scripts', ext: ['.js', '.mjs', '.cjs'] },
  { dir: 'work', ext: ['.js', '.mjs', '.cjs'] },
  { dir: 'system/recall', ext: ['.js', '.mjs'] }
];
const PS_ROOTS = [
  { dir: 'scripts', ext: ['.ps1', '.psm1'] },
  { dir: 'work', ext: ['.ps1', '.psm1'] }
];
const WRITER_SKIP = [/node_modules/, /(^|[\\/])\.git([\\/]|$)/];

/** The one test that decides whether a text carries JSON from a raw serializer. */
const NAMES_STRINGIFY = /JSON\.stringify/;

/** How many steps the static evaluator follows a path or a value before it gives up. */
const RESOLVE_DEPTH = 6;

/** How many files the evaluator follows a destructured import across before it gives up. */
const IMPORT_HOP_DEPTH = 4;

// ----------------------------------------------------------------------------------------- the report's shape

/** The root keys that mark the two older conventions the DIALECT column names. */
const UNDERSCORE_DOC_KEYS = ['_what', '_read_me_first', '_about'];
const VERSION_KEYS = ['schema', 'version'];

/** How many names a finding shows; past it, most findings say how many more there are. */
const SHOWN = { badCase: 6, dateKey: 4, underscore: 6, unsorted: 4, sortUnverifiable: 3 };

/** The table's columns: the file column fits the longest path, padded; the others are fixed. */
const FILE_COLUMN_MIN = 24;
const FILE_COLUMN_PAD = 2;
const GUTTER = '  ';
const ENF_WIDTH = 5;
const DIALECT_WIDTH = 17;
const CANON_WIDTH = 7;
const SITE_COLUMN_MIN = 20;
const KIND_WIDTH = 12;
const COUNT_WIDTH = 5;

// ------------------------------------------------------------------------------------------------ the contract

/**
 * Read json_standard.enforced[] from the contract file's TEXT. Throws, never defaults: the caller decides
 * what a missing contract means, and both callers (V21 and --enforced) make it a failure.
 * @param {string|null} text the contract file's contents, or null when the file is absent
 * @returns {string[]} the enforced paths
 */
function parseContract(text) {
  if (text === null || text === undefined) throw new Error(`${CONTRACT_REL} is not on disk`);
  let contract;
  try {
    contract = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`${CONTRACT_REL} is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
  const standard = contract?.json_standard;
  if (!standard || !Array.isArray(standard.enforced)) {
    throw new Error(`${CONTRACT_REL} has no json_standard.enforced[] array`);
  }
  for (const entry of standard.enforced) {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${CONTRACT_REL} json_standard.enforced[] holds a non-path value ${JSON.stringify(entry)}`);
    }
  }
  return standard.enforced.slice();
}

/**
 * The enforced list of the tree at `root`. Throws what parseContract throws, and what reading throws.
 * @param {string} root
 */
function readContract(root) {
  const file = path.join(root, CONTRACT_REL);
  return parseContract(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
}

// ---------------------------------------------------------------------------------------------- the file rules

/**
 * A plain object, the only root that can carry the header.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rule 1 on the raw text: a BOM, a carriage return anywhere, and anything but exactly one final newline.
 * @param {string} text
 * @param {string[]} findings where each finding is filed
 * @returns {string} the text without its BOM, which is what the rest of the audit reads
 */
function checkEncoding(text, findings) {
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    findings.push('rule 1: BOM');
    body = body.slice(1);
  }
  if (body.includes('\r')) findings.push('rule 1: CRLF line endings');
  if (!body.endsWith('\n')) findings.push('rule 1: no trailing newline');
  else if (body.endsWith('\n\n')) findings.push('rule 1: more than one trailing newline');
  return body;
}

/**
 * The dialect column: which convention a file's root follows, before any rule is applied.
 * @param {unknown} value the parsed root
 */
function classifyDialect(value) {
  if (!isRecord(value)) return 'bare';
  const has = (/** @type {string} */ key) => Object.hasOwn(value, key);
  if (HEADER_KEYS.every(has)) return 'standard';
  if (UNDERSCORE_DOC_KEYS.some(has)) return 'underscore-doc';
  if (VERSION_KEYS.some(has)) return 'versioned';
  if (HEADER_KEYS.some(has)) return 'partial-standard';
  return 'bare';
}

/**
 * The path `_writer` claims, when it names a script under `root` that does not exist. A hand-typed
 * `_writer` is a claim about code made without reading it; only a claim with a folder in it is checked.
 * @param {unknown} writer the root's _writer value
 * @param {string} root
 * @returns {string|null}
 */
function missingWriterScript(writer, root) {
  if (typeof writer !== 'string' || writer.trim() === '') return null;
  const claim = writer.trim().split(/[\s(]/)[0];
  return /[\\/]/.test(claim) && !fs.existsSync(path.join(root, claim)) ? claim : null;
}

/**
 * Rules 2 and 3 on the root object: the four generated header fields, the schema identifier, and, when a
 * root is given, whether `_writer` names a real script.
 * @param {Record<string, unknown>} parsed
 * @param {string|undefined} root
 */
function headerFindings(parsed, root) {
  const findings = [];
  const missing = HEADER_KEYS.filter((key) => !Object.hasOwn(parsed, key));
  if (missing.length) findings.push(`rule 2: header missing ${missing.join(', ')}`);
  if (Object.hasOwn(parsed, '_schema')) {
    const schema = parsed._schema;
    if (typeof schema !== 'string' || !SCHEMA_ID.test(schema)) {
      findings.push(`rule 3: _schema ${JSON.stringify(schema)} is not name@revision`);
    }
  }
  const claim = root ? missingWriterScript(parsed._writer, root) : null;
  if (claim) findings.push(`rule 2: _writer names ${claim}, which does not exist`);
  return findings;
}

/**
 * The kind of date written into a key, or null. The helper holds the same check with its own wording.
 * @param {string} key
 */
function findDateInKey(key) {
  if (/(19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/.test(key)) return 'an embedded date';
  for (const segment of key.split('_')) if (/^(19|20)\d{2}$/.test(segment)) return `a bare year segment "${segment}"`;
  return null;
}

/**
 * An integer-like key. JSON.parse keeps file order for every other key and moves these to the front, so an
 * object holding one cannot have its on-disk order recovered. It is reported as unverifiable rather than
 * passed, because a check that quietly passes what it cannot see is the shape a guard must never have.
 * @param {string} key
 */
function isIntegerLike(key) {
  return /^(0|[1-9]\d*)$/.test(key);
}

/**
 * Whether keys are in UTF-16 code-unit order, the order the helper writes them in.
 * @param {string[]} keys
 */
function isSorted(keys) {
  const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return keys.every((key, i) => key === sorted[i]);
}

/**
 * Rules 2 and 5 on one key below the header: no leading underscore, snake_case (or an identifier, inside a
 * map the file's schema declares), and no date written into it.
 * @param {string} key
 * @param {string} where the dotted path of the object holding it
 * @param {boolean} inIdMap
 * @param {KeyFindings} found
 */
function checkKeyName(key, where, inIdMap, found) {
  if (key.startsWith('_')) found.underscore.push(key);
  else if (!(inIdMap ? IDENTIFIER_KEY : SNAKE_CASE).test(key)) {
    found.badCase.push(inIdMap ? `${key} (in the declared identifier map ${where})` : key);
  }
  const date = findDateInKey(key);
  if (date) found.dateKey.push(`${key} (${date})`);
}

/**
 * Walk a parsed value depth first and file every key-level finding in document order. `where` is the dotted
 * path of `value`, '' at the root, where the four header keys are exempt. `idMaps` are the dotted paths the
 * file's own `_schema` declares as identifier maps (the registry the helper reads); only the keys directly
 * under one may be identifiers, and a file with no declaring schema gets no exception at all.
 * @param {unknown} value
 * @param {string} where
 * @param {KeyFindings} found
 * @param {readonly string[]} [idMaps]
 */
function walkKeys(value, where, found, idMaps = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      walkKeys(item, `${where}[${i}]`, found, idMaps);
    });
    return;
  }
  if (!isRecord(value)) return;
  const keys = Object.keys(value);
  if (keys.some(isIntegerLike)) found.sortUnverifiable.push(where || '(root)');
  else if (!isSorted(keys)) found.unsorted.push(where || '(root)');
  const atRoot = where === '';
  const inIdMap = !atRoot && idMaps.includes(where);
  for (const key of keys) {
    if (!(atRoot && HEADER_KEYS.includes(key))) checkKeyName(key, where, inIdMap, found);
    walkKeys(value[key], atRoot ? key : `${where}.${key}`, found, idMaps);
  }
}

/**
 * @param {string[]} items
 * @param {number} cap
 * @param {(item: string) => string} name
 */
function firstOf(items, cap, name) {
  return items.slice(0, cap).map(name).join(', ');
}

/**
 * @param {string[]} items
 * @param {number} cap
 * @param {(item: string) => string} name
 */
function listed(items, cap, name) {
  return `${firstOf(items, cap, name)}${items.length > cap ? ` (+${items.length - cap} more)` : ''}`;
}

/**
 * Rules 5, 2 and 6 over every key of the root object, in the order the table prints them.
 * @param {Record<string, unknown>} parsed
 * @param {(item: string) => string} name withholds names for a secret-bearing file
 */
function keyFindings(parsed, name) {
  /** @type {KeyFindings} */
  const found = { unsorted: [], sortUnverifiable: [], underscore: [], badCase: [], dateKey: [] };
  walkKeys(parsed, '', found, idMapsFor(parsed._schema));
  const findings = [];
  if (found.badCase.length) findings.push(`rule 5: not snake_case: ${listed(found.badCase, SHOWN.badCase, name)}`);
  if (found.dateKey.length) findings.push(`rule 5: date inside a key: ${listed(found.dateKey, SHOWN.dateKey, name)}`);
  if (found.underscore.length) {
    findings.push(`rule 2: underscore-prefixed payload key: ${listed(found.underscore, SHOWN.underscore, name)}`);
  }
  if (found.unsorted.length) {
    findings.push(`rule 6: keys not sorted at ${listed(found.unsorted, SHOWN.unsorted, name)}`);
  }
  if (found.sortUnverifiable.length) {
    const at = firstOf(found.sortUnverifiable, SHOWN.sortUnverifiable, name);
    findings.push(`rule 6: key order UNVERIFIABLE at ${at} (integer-like keys; JSON.parse reorders them)`);
  }
  return findings;
}

/**
 * The helper's own bytes for this value, final newline included, or the error it threw rendering them: a
 * number JSON.parse made infinite, or a nesting deeper than the helper's stack.
 * @param {Record<string, unknown>} parsed
 * @returns {string | Error}
 */
function helperText(parsed) {
  try {
    return `${canonicalText(parsed, { validate: false })}\n`;
  } catch (e) {
    return /** @type {Error} */ (e);
  }
}

/**
 * True for a finding that already explains why a file is not byte-identical to the helper's output.
 * @param {string} finding
 */
function explainsBytes(finding) {
  return finding.startsWith('rule 6') || finding.startsWith('rule 1');
}

/**
 * Audit one file from its TEXT. This is the seam V21 uses: the validator reads the file through its own
 * effective(stagedDir, rel) and hands the text straight here. Rules 7 and 8 have no check of their own:
 * a file that is not byte-identical to the helper's output breaks them, unless a rule 1 or rule 6 finding
 * already says why. A value the helper cannot render at all is UNVERIFIABLE, never passed.
 *
 * @param {string} rel  repo-relative path, forward slashes (used only for messages and scope)
 * @param {string} text file contents as utf8, BOM NOT stripped by the caller
 * @param {{root?: string}} [opts] root for resolving a _writer claim; omit to skip that check
 * @returns {FileRow}
 */
function auditText(rel, text, opts = {}) {
  /** @type {FileRow} */
  const row = { path: rel, dialect: null, canonical: false, findings: [] };
  const secret = SECRET_BEARING.has(rel);
  const body = checkEncoding(text, row.findings);

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    row.findings.push(`unparseable: ${secret ? 'JSON.parse failed' : /** @type {Error} */ (e).message}`);
    row.dialect = 'unparseable';
    return row;
  }
  row.dialect = classifyDialect(parsed);
  if (!isRecord(parsed)) {
    row.findings.push('rule 9: the root is not an object, so there is nowhere for the header to live');
    return row;
  }

  const name = (/** @type {string} */ item) => (secret ? WITHHELD : item);
  row.findings.push(...headerFindings(parsed, opts.root), ...keyFindings(parsed, name));

  const canon = helperText(parsed);
  if (typeof canon !== 'string') {
    const why = secret ? 'canonicalText failed' : canon.message;
    row.findings.push(`rules 7 and 8: UNVERIFIABLE (the helper could not render this value: ${why})`);
    return row;
  }
  row.canonical = canon === body;
  if (!row.canonical && !row.findings.some(explainsBytes)) {
    row.findings.push('rules 7 and 8: not byte-identical to the helper output (indent or formatting)');
  }
  return row;
}

// --------------------------------------------------------------------------------------------- the writer scan

/**
 * The entries of one folder under the root, or none when it cannot be read.
 * @param {string} root
 * @param {string} dir repo-relative, '' for the root itself
 */
function entriesOf(root, dir) {
  try {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * @param {string} dir
 * @param {string} name
 */
function childOf(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

/**
 * Every file under `sub` whose extension is in `ext`, walked depth first into `acc`.
 * @param {string} root
 * @param {string} sub
 * @param {string[]} ext
 * @param {string[]} acc
 */
function listFiles(root, sub, ext, acc) {
  for (const entry of entriesOf(root, sub)) {
    const rel = childOf(sub, entry.name);
    if (WRITER_SKIP.some((skip) => skip.test(rel))) continue;
    if (entry.isDirectory()) listFiles(root, rel, ext, acc);
    else if (ext.includes(path.extname(entry.name))) acc.push(rel);
  }
  return acc;
}

/**
 * Every source file under the given roots, once each, in code-unit order.
 * @param {string} root
 * @param {{ dir: string, ext: string[] }[]} roots
 */
function sourceFiles(root, roots) {
  /** @type {string[]} */
  const files = [];
  for (const { dir, ext } of roots) listFiles(root, dir, ext, files);
  return [...new Set(files)].sort();
}

/**
 * A source file's text, or null when it cannot be read: an unreadable file is skipped, never fatal.
 * @param {string} root
 * @param {string} rel
 */
function readSource(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * A call's arguments split at the top-level commas, quote- and bracket-aware (no escapes inside quotes).
 * @param {string} s
 */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  /** @type {string|null} */
  let quote = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * The balanced argument list of the call whose "(" is at `open`, quote-aware with backslash escapes, or null
 * when it never closes. Calls span lines often enough that a line-at-a-time match would silently miss sites,
 * which is how a scan reports a healthier system than it has.
 * @param {string} text
 * @param {number} open
 * @returns {{ inner: string, end: number } | null} `end` is the index of the closing ")"
 */
function callArgs(text, open) {
  let depth = 0;
  /** @type {string|null} */
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** A line that continues the statement above it: a method chain's leading `.`, a binary or logical
 * operator wanting a right operand, or a bracket this statement is still closing. */
const CONTINUES_STATEMENT = /^[ \t]*(?:\.[A-Za-z_$]|[+\-*/%]|&&|\|\||\?\?|[?:,)\]}])/;

/**
 * The text of one statement's value, read forward from just after its `=`: brackets, parens and braces
 * balanced, quotes (and a template literal's backtick) opaque with backslash escapes honoured inside them.
 * Stops at the first `;` seen at bracket depth zero, or the first newline seen at bracket depth zero whose
 * next line does not open with CONTINUES_STATEMENT. A one-line declaration behaves exactly as before; a
 * declaration the pinned Biome wraps over several lines, no semicolon anywhere, reads whole instead of
 * truncated at its first line - the open bracket of a wrapped call sits one or more lines below the `=`
 * itself (`const text = rows\n  .map((r) => ...)`), so depth alone does not see the wrap coming.
 * @param {string} text
 * @param {number} start index just after the `=`
 * @returns {string} the value, untrimmed
 */
function readStatementValue(text, start) {
  let depth = 0;
  /** @type {string|null} */
  let quote = null;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      continue;
    }
    if (depth <= 0 && ch === ';') break;
    if (depth <= 0 && ch === '\n' && !CONTINUES_STATEMENT.test(text.slice(i + 1))) break;
  }
  return text.slice(start, i);
}

/**
 * The first value each name is declared with, read to the end of its statement (readStatementValue).
 * @param {string} text
 */
function declaredValues(text) {
  /** @type {Map<string, string>} */
  const declared = new Map();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
    if (!declared.has(m[1])) declared.set(m[1], readStatementValue(text, m.index + m[0].length).trim());
  }
  return declared;
}

/**
 * EVERY value each name is ever given: its first declaration and every later plain assignment, each read to
 * the end of its statement (readStatementValue). The path evaluator keeps first-declaration semantics, but
 * whether a name can carry serialized JSON is answered over all of them, or a `let` given its JSON on a
 * later line and then written would walk past the scan.
 * @param {string} text
 * @param {Map<string, string>} declared
 */
function everyValue(text, declared) {
  /** @type {Map<string, string[]>} */
  const values = new Map();
  const add = (/** @type {string} */ name, /** @type {string} */ value) => {
    if (!values.has(name)) values.set(name, []);
    /** @type {string[]} */ (values.get(name)).push(value.trim());
  };
  for (const [name, value] of declared) add(name, value);
  for (const m of text.matchAll(/(?:^|\n|;)\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*/g)) {
    add(m[1], readStatementValue(text, m.index + m[0].length));
  }
  return values;
}

/**
 * A relative module specifier resolved against a directory the way a relative `require` or `import` does:
 * an explicit extension is kept, a bare specifier is tried as `.js` first, since every file this repo
 * reaches this way is `.js`.
 * @param {string} dir
 * @param {string} specifier
 */
function resolveRelativeModule(dir, specifier) {
  const resolved = path.resolve(dir, specifier);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

/**
 * The names this file imports from another file IN THIS REPOSITORY by a relative specifier ('./x', '../x'):
 * local binding name -> the exported name and the repo-relative path of the module it came from. A bare
 * specifier ('node:fs', 'json-writer') names a package or a module not reached this way, so it is not
 * recorded. Resolved by what the module specifier NAMES, never by the text of a file's own name appearing
 * anywhere: a specifier landing on a different file, at the wrong relative depth, or on a same-named file
 * elsewhere, contributes nothing, and a local `const X = ...` that is not an import is untouched by this
 * map. Covers both spellings this repo writes, a destructured `require` and a named ES `import`, each with
 * or without a rename, at any relative depth.
 * @param {string} root
 * @param {string} relFile
 * @param {string} text
 * @returns {Map<string, { file: string, exported: string }>} local binding -> the module it came from
 *   (repo-relative) and the name it exports there
 */
function importBindings(root, relFile, text) {
  const dirOfFile = path.dirname(path.join(root, relFile));
  /** @type {Map<string, { file: string, exported: string }>} */
  const bindings = new Map();
  /**
   * @param {string} names the text between `{` and `}`
   * @param {string} specifier
   * @param {RegExp} renamedBy ':' for a destructured require, 'as' for a named ES import
   */
  const record = (names, specifier, renamedBy) => {
    if (!specifier.startsWith('.')) return;
    const file = repoPathOf(root, resolveRelativeModule(dirOfFile, specifier));
    if (file === null) return;
    for (const piece of names.split(',')) {
      const part = piece.trim();
      if (!part) continue;
      const [exported, renamed] = part.split(renamedBy).map((s) => s.trim());
      bindings.set(renamed || exported, { file, exported });
    }
  };
  for (const m of text.matchAll(/\bconst\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g)) {
    record(m[1], m[3], /:/);
  }
  for (const m of text.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    record(m[1], m[3], /\bas\b/);
  }
  return bindings;
}

/**
 * A deliberately small static evaluator over one source file. `pathOf` handles the path shapes this repo
 * writes: a literal, path.join or path.resolve of known parts (one spread argument of `X.split('sep')` for
 * a literal separator included, which is how a module turns its own forward-slash constant into a platform
 * path), path.dirname, __dirname, the ES module dirname idiom, a name declared with one of these, a name
 * imported by a destructured require or ES import of a RELATIVE module (read and evaluated in a resolver of
 * its own, which is how `REPO` from scripts/lib/repo-root.js resolves to the audited root: that file
 * declares `REPO` as `path.resolve(__dirname, '..', '..')`, and its own __dirname sits two folders under
 * this root), and an environment variable with a fallback. Anything else is null, reported as unresolved
 * and never guessed, because a guessed destination in a compliance report is worse than an admitted gap.
 * `carriesJson` over-approximates on purpose: a name that is EVER given serialized JSON counts, since a
 * false yes costs one reviewed line and a false no is a guard that can be walked past.
 * @param {string} root
 * @param {string} relFile
 * @param {string} text
 * @param {Set<string>} [visiting] repo-relative files already in this import chain (this file included once
 *   the function starts), so a cycle, or a chain past IMPORT_HOP_DEPTH, stops instead of looping
 */
function makeResolver(root, relFile, text, visiting = new Set()) {
  const dirOfFile = path.dirname(path.join(root, relFile));
  const declared = declaredValues(text);
  const values = everyValue(text, declared);
  const imports = importBindings(root, relFile, text);
  const visited = new Set(visiting);
  visited.add(relFile);

  /** @type {Set<string>} */
  const following = new Set();
  /**
   * The value a name imported from another file resolves to, by reading that file and evaluating its own
   * exported declaration there. Null when the file cannot be read, is already in this chain, or the chain
   * has already made IMPORT_HOP_DEPTH hops.
   * @param {{ file: string, exported: string }} imported
   */
  function followImport(imported) {
    if (visited.has(imported.file) || visited.size > IMPORT_HOP_DEPTH) return null;
    const importedText = readSource(root, imported.file);
    if (importedText === null) return null;
    return makeResolver(root, imported.file, importedText, visited).pathOf(imported.exported);
  }

  /**
   * @param {string} source
   * @param {number} depth
   * @returns {string|null}
   */
  function evaluate(source, depth) {
    if (depth > RESOLVE_DEPTH) return null;
    const expr = source.trim().replace(/,$/, '');
    const fallback = expr.match(/^process\.env\.\w+\s*(?:\|\||\?\?)\s*(.+)$/);
    if (fallback) return evaluate(fallback[1], depth + 1);
    const literal = expr.match(/^'([^']*)'$/) || expr.match(/^"([^"]*)"$/) || expr.match(/^`([^`$]*)`$/);
    if (literal) return literal[1];
    if (expr === '__dirname') return dirOfFile;
    if (expr === 'fileURLToPath(import.meta.url)') return path.join(root, relFile);
    if (/^path\.dirname\(\s*fileURLToPath\(import\.meta\.url\)\s*\)$/.test(expr)) return dirOfFile;
    const dirname = expr.match(/^path\.dirname\((.*)\)$/s);
    if (dirname) {
      const inner = evaluate(dirname[1], depth + 1);
      return inner === null ? null : path.dirname(inner);
    }
    const join = expr.match(/^path\.(join|resolve)\((.*)\)$/s);
    if (join) {
      const spread = join[2].match(/^\.\.\.\s*(.+?)\s*\.split\(\s*(['"])((?:\\.|(?!\2).)*)\2\s*\)$/s);
      if (spread) {
        const base = evaluate(spread[1], depth + 1);
        if (base === null) return null;
        const parts = base.split(spread[3].replace(/\\(.)/g, '$1'));
        return join[1] === 'resolve' ? path.resolve(...parts) : path.join(...parts);
      }
      const parts = splitArgs(join[2]).map((part) => evaluate(part, depth + 1));
      if (parts.some((part) => part === null)) return null;
      const known = /** @type {string[]} */ (parts);
      return join[1] === 'resolve' ? path.resolve(...known) : path.join(...known);
    }
    if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
      if (declared.has(expr) && !following.has(expr)) {
        following.add(expr);
        const value = evaluate(/** @type {string} */ (declared.get(expr)), depth + 1);
        following.delete(expr);
        return value;
      }
      const imported = imports.get(expr);
      if (imported) return followImport(imported);
    }
    return null;
  }

  /** @type {Set<string>} */
  const tracing = new Set();
  /**
   * @param {string} expr
   * @param {number} depth
   * @returns {boolean}
   */
  function serializesJson(expr, depth) {
    if (depth > RESOLVE_DEPTH) return false;
    if (NAMES_STRINGIFY.test(expr)) return true;
    for (const name of expr.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (!values.has(name) || tracing.has(name)) continue;
      tracing.add(name);
      const hit = /** @type {string[]} */ (values.get(name)).some((value) => serializesJson(value, depth + 1));
      tracing.delete(name);
      if (hit) return true;
    }
    return false;
  }

  return {
    pathOf: (/** @type {string} */ expr) => evaluate(expr, 0),
    carriesJson: (/** @type {string} */ expr) => serializesJson(expr, 0)
  };
}

/**
 * A resolved destination as a repo-relative path, or null when there is none or it lies outside the root.
 * @param {string} root
 * @param {string|null} abs
 */
function repoPathOf(root, abs) {
  if (!abs) return null;
  const rel = path.relative(root, abs).split(path.sep).join('/');
  return rel.startsWith('..') ? null : rel;
}

/**
 * 'test' for a file under a test or tests folder, or named test-* or verify-*; else 'production'. A test
 * that writes a LIVE in-scope file is still a writer of it: labelled, never excluded, because "the tests do
 * it" is a reason to know about a write, not to stop counting it.
 * @param {string} rel
 */
function siteKind(rel) {
  return /(^|\/)tests?\//.test(rel) || /(^|\/)(test|verify)-[^/]*\.(js|mjs|cjs|ps1)$/.test(rel) ? 'test' : 'production';
}

/**
 * @param {string} text
 * @param {number} index
 */
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * The node write sites of one file: every call that puts bytes into a named file, where the data carries
 * raw serialized JSON (a stream is judged by its target alone, since the helper's whole contract is one
 * atomic whole-file write) and the destination is in scope or cannot be resolved. writeFile covers the
 * fs, fs.promises and fs/promises forms; the word boundary keeps writeFileSync from matching twice.
 * @param {string} root
 * @param {string} rel
 * @param {string} text
 * @param {Set<string>} inScopeSet
 * @returns {WriterSite[]}
 */
function nodeWriteSites(root, rel, text, inScopeSet) {
  const importsHelper = /json-writer/.test(text);
  const resolver = makeResolver(root, rel, text);
  /** @type {WriterSite[]} */
  const sites = [];
  const calls = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/g;
  for (let m = calls.exec(text); m !== null; m = calls.exec(text)) {
    const call = callArgs(text, m.index + m[0].length - 1);
    if (!call) continue;
    calls.lastIndex = call.end;
    const args = splitArgs(call.inner);
    const isStream = m[1] === 'createWriteStream';
    if (args.length < (isStream ? 1 : 2)) continue;
    if (!isStream && !resolver.carriesJson(args.slice(1).join(','))) continue;

    // Judged against the in-scope FILE LIST, or its globs: a gitignored state file nobody has written yet
    // is not on disk to be listed, and its writer must not drop out of the scan on a fresh checkout.
    const target = repoPathOf(root, resolver.pathOf(args[0]));
    const inScope = target !== null && (inScopeSet.has(target) || matchesScope(target));
    if (!inScope && target !== null) continue;
    sites.push({
      site: `${rel}:${lineOf(text, m.index)}`,
      target,
      in_scope: inScope,
      kind: siteKind(rel),
      lang: 'node',
      call: m[1],
      imports_helper: importsHelper
    });
  }
  return sites;
}

/**
 * Every node write site under the writer roots, file by file in code-unit order. A file that never names
 * JSON.stringify is not read further.
 * @param {string} root
 * @param {Set<string>} inScopeSet
 */
function scanWriterSites(root, inScopeSet) {
  return sourceFiles(root, WRITER_ROOTS).flatMap((rel) => {
    const text = readSource(root, rel);
    if (text === null || !NAMES_STRINGIFY.test(text)) return [];
    return nodeWriteSites(root, rel, text, inScopeSet);
  });
}

/**
 * True for a PowerShell line that serializes JSON and writes it in the same statement.
 * @param {string} line
 */
function isPowerShellJsonWrite(line) {
  return /ConvertTo-Json/i.test(line) && /(Set-Content|Out-File|WriteAllText|Add-Content)/i.test(line);
}

/**
 * PowerShell cannot reach the node helper at all, so every such line is a writer site outside the standard
 * by construction. Its target is a variable built at run time, so the file and the line are the finding.
 * @param {string} root
 * @returns {WriterSite[]}
 */
function scanPowerShellSites(root) {
  return sourceFiles(root, PS_ROOTS).flatMap((rel) => {
    const text = readSource(root, rel);
    if (text === null) return [];
    const kind = siteKind(rel);
    return text
      .split(/\r?\n/)
      .flatMap((line, i) =>
        isPowerShellJsonWrite(line)
          ? [{ site: `${rel}:${i + 1}`, target: null, in_scope: null, kind, lang: 'powershell', imports_helper: false }]
          : []
      );
  });
}

// ------------------------------------------------------------------------------------------------- the tree

/**
 * A glob as an anchored regular expression: `*` is any run inside one path segment.
 * @param {string} glob
 */
function globToRegex(glob) {
  const segments = glob
    .split('/')
    .map((segment) => segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
  return new RegExp(`^${segments.join('/')}$`);
}
const SCOPE_RX = IN_SCOPE_GLOBS.map(globToRegex);

/**
 * The ownership rule's reason a path is out of scope, or null when nothing excludes it.
 * @param {string} rel
 */
function exclusionOf(rel) {
  const named = OUT_OF_SCOPE_PATHS.find(([p]) => p === rel);
  if (named) return named[1];
  const prefixed = OUT_OF_SCOPE_PREFIXES.find(([p]) => rel.startsWith(p));
  return prefixed ? prefixed[1] : null;
}

/**
 * Whether a repo-relative path is in scope: reached by a glob and not excluded. V21 filters the tracked
 * files through this.
 * @param {string} rel
 */
function matchesScope(rel) {
  return exclusionOf(rel) === null && SCOPE_RX.some((rx) => rx.test(rel));
}

/**
 * The files one glob reaches under the root: folder segments expand `*` over folders, the last matches files.
 * @param {string} root
 * @param {string} glob
 */
function expandGlob(root, glob) {
  const segments = glob.split('/');
  const fileName = globToRegex(/** @type {string} */ (segments.pop()));
  let dirs = [''];
  for (const segment of segments) {
    dirs = dirs.flatMap((dir) =>
      segment === '*'
        ? entriesOf(root, dir)
            .filter((entry) => entry.isDirectory())
            .map((entry) => childOf(dir, entry.name))
        : [childOf(dir, segment)]
    );
  }
  return dirs.flatMap((dir) =>
    entriesOf(root, dir)
      .filter((entry) => entry.isFile() && fileName.test(entry.name))
      .map((entry) => childOf(dir, entry.name))
  );
}

/**
 * Every file the globs reach, once each, in code-unit order. None at all is an ERROR, never a clean bill of
 * health: an audit that looked nowhere must never be indistinguishable from a healthy system.
 * @param {string} root
 */
function inScopeCandidates(root) {
  const candidates = [...new Set(IN_SCOPE_GLOBS.flatMap((glob) => expandGlob(root, glob)))].sort();
  if (candidates.length === 0) {
    throw new Error(
      `no in-scope JSON found under ${root}. Expected at least one of ${IN_SCOPE_GLOBS.join(', ')}. ` +
        'Wrong --root, or a tree that is not an Alex repo.'
    );
  }
  return candidates;
}

/**
 * One in-scope file, read and audited; a file that cannot be read is a finding, not a failure.
 * @param {string} root
 * @param {string} rel
 * @returns {FileRow}
 */
function auditFile(root, rel) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, rel), 'utf8');
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    return { path: rel, dialect: 'unreadable', canonical: false, findings: [`unreadable: ${err.code || err.message}`] };
  }
  return auditText(rel, text, { root });
}

/**
 * The ratchet's line for a node site that writes an enforced file around the helper.
 * @param {WriterSite} s
 */
function bypassLine(s) {
  return s.call === 'createWriteStream'
    ? `${s.site} writes ${s.target} through a raw write stream, not through ${HELPER_REL}`
    : `${s.site} writes ${s.target} with a raw JSON.stringify (${s.call}), not through ${HELPER_REL}`;
}

/**
 * The ratchet: only what is on the list can fail it. An enforced file with a finding is a regression, and
 * so is a node site whose resolved target is enforced; an enforced path absent from disk asserts nothing.
 * @param {string[]} enforced
 * @param {FileRow[]} files
 * @param {WriterSite[]} writerSites
 * @param {Set<string>} inScopeSet
 */
function ratchetOf(enforced, files, writerSites, inScopeSet) {
  const enforcedSet = new Set(enforced);
  const regressions = [];
  for (const rel of enforced) {
    const file = files.find((f) => f.path === rel);
    if (file?.findings.length) regressions.push(`${rel}: ${file.findings.join('; ')}`);
  }
  for (const s of writerSites) {
    if (s.lang === 'node' && s.target && enforcedSet.has(s.target)) regressions.push(bypassLine(s));
  }
  return { enforced: enforced.slice(), enforced_present: enforced.filter((rel) => inScopeSet.has(rel)), regressions };
}

/**
 * Audit a whole tree: every in-scope file, then (unless told not to) every writer site, then the counts,
 * then the ratchet when an enforced list is given.
 * @param {string} root
 * @param {{ withWriters?: boolean, enforced?: string[] | null }} [options]
 * @returns {TreeReport}
 */
function auditTree(root, { withWriters = true, enforced = null } = {}) {
  /** @type {FileRow[]} */
  const files = [];
  const excluded = [];
  for (const rel of inScopeCandidates(root)) {
    const reason = exclusionOf(rel);
    if (reason !== null) excluded.push({ path: rel, reason });
    else files.push(auditFile(root, rel));
  }

  const inScopeSet = new Set(files.map((f) => f.path));
  const writerSites = withWriters ? scanWriterSites(root, inScopeSet).concat(scanPowerShellSites(root)) : [];
  const fileFindings = files.reduce((n, f) => n + f.findings.length, 0);
  const bypasses = writerSites.filter((s) => s.in_scope).length;
  const psSites = writerSites.filter((s) => s.lang === 'powershell' && s.kind === 'production').length;

  /** @type {TreeReport} */
  const report = {
    root,
    files,
    excluded,
    writer_sites: writerSites,
    findings: fileFindings + bypasses + psSites,
    file_findings: fileFindings,
    writer_bypasses: bypasses,
    powershell_sites: psSites
  };
  if (enforced) Object.assign(report, ratchetOf(enforced, files, writerSites, inScopeSet));
  return report;
}

// ----------------------------------------------------------------------------------------------- the report

/**
 * The line under the title: how many files conform, and how many writer sites stand outside the helper.
 * @param {TreeReport} report
 */
function summaryLine(report) {
  const total = report.files.length;
  const conform = report.files.filter((f) => f.findings.length === 0).length;
  return (
    `${conform} of ${total} in-scope files conform. ${total - conform} do not. ` +
    `${report.writer_bypasses} node writer site(s) serialize an in-scope file without the helper; ` +
    `${report.powershell_sites} PowerShell writer site(s) cannot reach it at all.`
  );
}

/**
 * The FILE/ENF/DIALECT/CANON/FINDINGS table: one row per file, each further finding on its own line under
 * the FINDINGS column.
 * @param {FileRow[]} files
 * @param {Set<string>} enforcedSet
 */
function fileTable(files, enforcedSet) {
  const width = Math.max(FILE_COLUMN_MIN, ...files.map((f) => f.path.length)) + FILE_COLUMN_PAD;
  const findingsIndent = ' '.repeat(width + GUTTER.length + ENF_WIDTH + DIALECT_WIDTH + CANON_WIDTH);
  const lines = [
    `${'FILE'.padEnd(width)}${GUTTER}${'ENF'.padEnd(ENF_WIDTH)}${'DIALECT'.padEnd(DIALECT_WIDTH)}${'CANON'.padEnd(CANON_WIDTH)}FINDINGS`,
    `${'-'.repeat(width)}${GUTTER}${'-'.repeat(ENF_WIDTH + DIALECT_WIDTH + CANON_WIDTH)}${'-'.repeat('FINDINGS'.length)}`
  ];
  for (const f of files) {
    const enf = enforcedSet.has(f.path) ? 'yes' : '';
    const head = `${f.path.padEnd(width)}${GUTTER}${enf.padEnd(ENF_WIDTH)}${String(f.dialect).padEnd(DIALECT_WIDTH)}${(f.canonical ? 'yes' : 'no').padEnd(CANON_WIDTH)}`;
    if (!f.findings.length) {
      lines.push(`${head}none`);
      continue;
    }
    lines.push(head + f.findings[0]);
    for (const finding of f.findings.slice(1)) lines.push(findingsIndent + finding);
  }
  return lines;
}

/**
 * The enforced paths this disk does not hold, which the ratchet says nothing about here.
 * @param {TreeReport} report
 */
function absentLines(report) {
  if (!report.enforced) return [];
  const present = /** @type {string[]} */ (report.enforced_present);
  const absent = report.enforced.filter((p) => !present.includes(p));
  if (!absent.length) return [];
  return [
    '',
    `ENFORCED but not on this disk (${absent.length}), nothing asserted about them here: ${absent.join(', ')}`
  ];
}

/**
 * The files the ownership rule left out, counted by reason.
 * @param {TreeReport['excluded']} excluded
 */
function excludedLines(excluded) {
  if (!excluded.length) return [];
  /** @type {Map<string, number>} */
  const byReason = new Map();
  for (const e of excluded) byReason.set(e.reason, (byReason.get(e.reason) || 0) + 1);
  return [
    '',
    `EXCLUDED, by the ownership rule (${excluded.length}):`,
    ...[...byReason].map(([reason, n]) => `  ${String(n).padEnd(COUNT_WIDTH)} ${reason}`)
  ];
}

/**
 * The node sites that write an in-scope file around the helper, each with its kind and target.
 * @param {WriterSite[]} sites
 * @param {Set<string>} enforcedSet
 */
function nodeSiteLines(sites, enforcedSet) {
  const inScope = sites.filter((s) => s.in_scope);
  if (!inScope.length) return [];
  const width = Math.max(SITE_COLUMN_MIN, ...inScope.map((s) => s.site.length));
  const line = (/** @type {WriterSite} */ s) =>
    `  ${s.site.padEnd(width)}  ${s.kind.padEnd(KIND_WIDTH)}-> ${s.target}` +
    (enforcedSet.has(/** @type {string} */ (s.target)) ? '   ENFORCED' : '') +
    (s.imports_helper ? '   (file imports the helper, this line does not use it)' : '');
  return ['', `NODE WRITER SITES that serialize an IN-SCOPE file without ${HELPER_REL}:`, ...inScope.map(line)];
}

/**
 * The PowerShell sites, by file and line.
 * @param {WriterSite[]} sites
 */
function powerShellLines(sites) {
  const ps = sites.filter((s) => s.lang === 'powershell');
  if (!ps.length) return [];
  return [
    '',
    'POWERSHELL WRITER SITES (ConvertTo-Json written to a file; the node helper cannot reach these):',
    ...ps.map((s) => `  ${s.site}  [${s.kind}]`)
  ];
}

/**
 * How many node sites have a destination the evaluator could not resolve, and under --verbose which.
 * @param {WriterSite[]} sites
 * @param {boolean} verbose
 */
function unresolvedLines(sites, verbose) {
  const unresolved = sites.filter((s) => s.lang === 'node' && !s.in_scope);
  if (!unresolved.length) return [];
  return [
    '',
    `${unresolved.length} further JSON.stringify write site(s) have a destination this scan could not ` +
      'resolve statically (a runtime variable or a computed path). Not counted as findings. --verbose lists them.',
    ...(verbose ? unresolved.map((s) => `  ${s.site}  [${s.kind}]`) : [])
  ];
}

/**
 * @param {TreeReport} report
 */
function resultLine(report) {
  if (report.findings === 0) return 'Result: clean.';
  const failing = report.files.filter((f) => f.findings.length).length;
  return (
    `Result: ${report.file_findings} file finding(s) across ${failing} file(s), ` +
    `plus ${report.writer_bypasses} node writer bypass(es) and ${report.powershell_sites} PowerShell writer site(s).`
  );
}

/**
 * The ratchet's verdict and its regressions, when an enforced list was read.
 * @param {TreeReport} report
 */
function enforcedLines(report) {
  if (!report.enforced) return [];
  const present = /** @type {string[]} */ (report.enforced_present);
  const regressions = /** @type {string[]} */ (report.regressions);
  const verdict =
    regressions.length === 0
      ? `Enforced (${report.enforced.length} path(s), ${present.length} on this disk): clean. The backlog above is reported, never blocking.`
      : `Enforced: ${regressions.length} REGRESSION(S), a migrated file broken or written around the helper:`;
  return [verdict, ...regressions.map((x) => `  ${x}`)];
}

/**
 * @param {TreeReport} report
 * @param {boolean} verbose
 */
function renderTable(report, verbose) {
  const enforcedSet = new Set(report.enforced || []);
  return [
    '',
    `JSON STANDARD COMPLIANCE, ${new Date().toISOString().slice(0, 10)} (${DOC_REL})`,
    '',
    summaryLine(report),
    '',
    ...fileTable(report.files, enforcedSet),
    ...absentLines(report),
    ...excludedLines(report.excluded),
    ...nodeSiteLines(report.writer_sites, enforcedSet),
    ...powerShellLines(report.writer_sites),
    ...unresolvedLines(report.writer_sites, verbose),
    '',
    resultLine(report),
    ...enforcedLines(report),
    ''
  ].join('\n');
}

// -------------------------------------------------------------------------------------------------- the CLI

/**
 * Parse the command line, read the contract, audit the tree, print, and return the exit code.
 * @param {string[]} argv process.argv
 * @returns {number}
 */
function main(argv) {
  const { parseCommandLine } = require('./lib/args.js');
  let values;
  try {
    ({ values } = parseCommandLine({
      name: 'json-standard-audit',
      edge: 'operator',
      options: {
        enforced: { type: 'boolean' },
        json: { type: 'boolean' },
        files: { type: 'boolean' },
        verbose: { type: 'boolean' },
        root: { type: 'string' }
      },
      argv: argv.slice(2)
    }));
  } catch (e) {
    if (e instanceof Refusal) {
      console.error(`json-standard-audit: REFUSED - ${e.message}`);
      return /** @type {{ exitCode?: number }} */ (e).exitCode ?? EXIT.FAILURE;
    }
    throw e;
  }
  if (values.root === '') {
    console.error(`json-standard-audit: REFUSED - Option '--root <value>' argument is empty`);
    return EXIT.FAILURE;
  }
  const root = values.root ? path.resolve(String(values.root)) : REPO;
  const ratchet = Boolean(values.enforced);

  /** @type {string[] | null} */
  let enforced = null;
  try {
    enforced = readContract(root);
  } catch (e) {
    if (ratchet) {
      console.error(`json-standard-audit: FAILED: ${/** @type {Error} */ (e).message}. ${NO_CONTRACT}`);
      return EXIT.FAILURE;
    }
    // The whole-picture mode does not need the list; the ENF column is simply blank.
  }

  let report;
  try {
    report = auditTree(root, { withWriters: !values.files, enforced });
  } catch (e) {
    console.error(`json-standard-audit: FAILED to run: ${/** @type {Error} */ (e).message}`);
    return EXIT.FAILURE;
  }
  console.log(values.json ? JSON.stringify(report, null, 2) : renderTable(report, Boolean(values.verbose)));
  const failed = ratchet ? /** @type {string[]} */ (report.regressions).length > 0 : report.findings > 0;
  return failed ? EXIT.REFUSED : EXIT.SUCCESS;
}

// contract: read as text by scripts/tests/test-validate-known-bad-shipped.mjs:547. That test appends code after this file's last line that replaces module.exports.auditText, so the exports stay one plain object.
module.exports = {
  auditText,
  auditTree,
  parseContract,
  readContract,
  matchesScope,
  CONTRACT_REL,
  IN_SCOPE_GLOBS,
  OUT_OF_SCOPE_PATHS,
  OUT_OF_SCOPE_PREFIXES
};

if (require.main === module) process.exit(main(process.argv));
