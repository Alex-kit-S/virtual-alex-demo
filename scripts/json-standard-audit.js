#!/usr/bin/env node
'use strict';
/*
 * scripts/json-standard-audit.js - does the JSON standard actually hold on this disk?
 *
 * WHAT. A per-file compliance table for every JSON file this Kit defines the shape of, measured from
 * the bytes on disk, plus a list of the code paths that still write one of those files without the
 * helper. The standard is docs/json-standard.md; the helper is scripts/lib/json-writer.js.
 *
 * WHY IT EXISTS. A standard with a helper and no audit is a convention: nothing reports a file that
 * drifts, so nobody can say whether the rules hold today without re-deriving the answer by hand.
 * Upstream the same standard was lost for 26 days precisely because nothing measured it. This script
 * is the measurement, per file, from the disk rather than from anybody's memory.
 *
 * It reads. It never writes, never fetches, and costs zero tokens.
 *
 * WHAT IT MEASURES, and the two halves are different questions:
 *
 *   1. FILES. For every in-scope JSON file: is it what the helper would have produced? The strongest
 *      form of that question is byte comparison, so the canonical column is exactly that: does the
 *      file equal canonicalText(parsed) + newline. Everything else in the findings column explains
 *      WHY a file is not canonical, in the vocabulary of the ten rules.
 *   2. WRITER SITES. A conforming file written by a raw JSON.stringify is conforming by accident and
 *      will drift on the next run. Compliance is meant to be STRUCTURAL, so the second half asks which
 *      code paths still serialize in-scope JSON without the helper. That includes PowerShell: this
 *      Kit still runs .ps1 writers on Windows installs and the node helper cannot reach them, so they
 *      are listed by file and line rather than left out of the picture.
 *
 * SCOPE is the doc's ownership rule, not a filename rule: a file is in scope when WE define its shape.
 *
 * TWO MODES, because they answer two different questions:
 *
 *   (default)    the whole picture. Exit 2 if ANY in-scope file breaks a rule or ANY writer bypasses
 *                the helper. On this Kit that is expected to be 2 for a long time: most files have not
 *                been migrated, and anti-goal 1 forbids reformatting them outside their writers.
 *   --enforced   the RATCHET, the mode CI runs. The same table is printed, but the exit code answers
 *                only: does any file on the enforced list (system/kit-manifest.json -> json_standard
 *                .enforced[]) break the standard, and does any code path write an enforced file
 *                without the helper? A regression on a migrated file fails; the unmigrated backlog
 *                is reported and never blocks. A missing contract is a FAILURE (exit 1), never a pass:
 *                a ratchet with no list asserts nothing and would look exactly like a healthy one.
 *
 * HOW. Run it one of these ways:
 *   node scripts/json-standard-audit.js              the table (the deliverable)
 *   node scripts/json-standard-audit.js --enforced   the table, exit code scoped to enforced[]
 *   node scripts/json-standard-audit.js --json       machine-readable
 *   node scripts/json-standard-audit.js --root DIR   audit another tree (a fixture, a generated template)
 *   node scripts/json-standard-audit.js --files      files only, skip the writer-site scan
 *   node scripts/json-standard-audit.js --verbose    also list the write sites whose target did not resolve
 *
 * Exit: 0 clean, 2 findings, 1 the audit itself failed (or, with --enforced, the contract is missing).
 *
 * NEVER. It never rewrites a file to make it conform. A reformat outside the writer is anti-goal 1:
 * the next run of the unmigrated writer undoes it and the diff proves nothing.
 *
 * Ported from the upstream audit on 2026-09-23 (Virtual Alex fleet, seat 3). What differs: the
 * upstream-only exclusions are gone (this Kit has no workflow server whose payloads would need them),
 * the PowerShell listing and the --enforced ratchet are new here, and the contract lives in
 * system/kit-manifest.json rather than in the project registry, for the reason given in that file.
 * Test: node scripts/tests/test-json-standard.mjs
 */

const fs = require('fs');
const path = require('path');

const { canonicalText, SNAKE_CASE, SCHEMA_ID, HEADER_KEYS, IDENTIFIER_KEY, idMapsFor } = require(path.join(__dirname, 'lib', 'json-writer.js'));

// ---------------------------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------------------------

// Directory globs walked for in-scope files. One '*' segment only, matching the repo's shape.
const IN_SCOPE_GLOBS = [
  'system/*.json',
  'work/*/state/*.json',
  'work/*/config/*.json',
  'skills-lock.json',
];

// Out by the OWNERSHIP rule, each with the reason it is out. Printed by --json so the exclusions
// are auditable rather than folklore. The two harness files are outside every glob today; they are
// named anyway so that widening a glob can never quietly pull a shape Anthropic owns into scope.
const OUT_OF_SCOPE_PATHS = [
  ['.claude/settings.json', 'Anthropic defines the harness schema and changes it on its own schedule'],
  ['.claude/settings.local.json', 'same, and it is machine-local'],
];
const OUT_OF_SCOPE_PREFIXES = [
  ['.agents/skills/', 'third-party skills bring their own files and their own shapes'],
];

// Files whose VALUES must never reach a log or a terminal. Findings for these name the rule and the
// count, never a key and never a value.
const SECRET_BEARING = new Set(['system/credentials-ledger.json']);

// Where the ratchet's list lives, and why there: see json_standard.note in that file.
const CONTRACT_REL = 'system/kit-manifest.json';

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

/**
 * Read json_standard.enforced[] from the contract file TEXT. Throws, never defaults: the caller
 * decides what a missing contract means, and both callers (V21 and --enforced) make it a failure.
 * @param {string|null} text the contract file's contents, or null when the file is absent
 * @returns {string[]} the enforced paths
 */
function parseContract(text) {
  if (text === null || text === undefined) throw new Error(`${CONTRACT_REL} is not on disk`);
  let j;
  try { j = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error(`${CONTRACT_REL} is not valid JSON: ${e.message}`); }
  const cfg = j && j.json_standard;
  if (!cfg || !Array.isArray(cfg.enforced)) {
    throw new Error(`${CONTRACT_REL} has no json_standard.enforced[] array`);
  }
  for (const p of cfg.enforced) {
    if (typeof p !== 'string' || !p.trim()) throw new Error(`${CONTRACT_REL} json_standard.enforced[] holds a non-path value ${JSON.stringify(p)}`);
  }
  return cfg.enforced.slice();
}

function readContract(root) {
  const f = path.join(root, CONTRACT_REL);
  return parseContract(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
}

// ---------------------------------------------------------------------------------------------
// The file audit
// ---------------------------------------------------------------------------------------------

function findDateInKey(key) {
  if (/(19|20)\d{2}[-_]?\d{2}[-_]?\d{2}/.test(key)) return 'an embedded date';
  for (const seg of key.split('_')) if (/^(19|20)\d{2}$/.test(seg)) return `a bare year segment "${seg}"`;
  return null;
}

// JSON.parse preserves file order for non-integer-like keys and REORDERS integer-like ones, so an
// object carrying "2" and "10" cannot have its on-disk order recovered this way. That is reported as
// unverifiable rather than passed, because a check that quietly passes what it cannot see is the
// shape a guard must never have.
function isIntegerLike(k) { return /^(0|[1-9]\d*)$/.test(k); }

// idMaps: the dotted paths the file's own schema DECLARES as identifier maps (json-writer.js ID_MAPS,
// read by `_schema`, the same registry the writer uses). Only the keys directly under such a path may
// be identifiers instead of snake_case; a file without a declaring `_schema` gets no exception at all.
function walkKeys(value, where, out, idMaps = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkKeys(v, `${where}[${i}]`, out, idMaps));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const keys = Object.keys(value);
  if (keys.some(isIntegerLike)) out.sortUnverifiable.push(where || '(root)');
  else {
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (keys.length !== sorted.length || keys.some((k, i) => k !== sorted[i])) {
      out.unsorted.push(where || '(root)');
    }
  }
  const isIdMap = where !== '' && idMaps.includes(where);
  for (const k of keys) {
    const atRoot = where === '';
    const isHeader = atRoot && HEADER_KEYS.includes(k);
    if (!isHeader) {
      if (k.startsWith('_')) out.underscore.push(k);
      else if (!(isIdMap ? IDENTIFIER_KEY : SNAKE_CASE).test(k)) out.badCase.push(isIdMap ? `${k} (in the declared identifier map ${where})` : k);
      const d = findDateInKey(k);
      if (d) out.dateKey.push(`${k} (${d})`);
    }
    walkKeys(value[k], atRoot ? k : `${where}.${k}`, out, idMaps);
  }
}

function classifyDialect(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'bare';
  const has = k => Object.prototype.hasOwnProperty.call(v, k);
  if (HEADER_KEYS.every(has)) return 'standard';
  if (has('_what') || has('_read_me_first') || has('_about')) return 'underscore-doc';
  if (has('schema') || has('version')) return 'versioned';
  if (HEADER_KEYS.some(has)) return 'partial-standard';
  return 'bare';
}

/**
 * Audit one file from its TEXT. This is the seam V21 uses: the validator reads the file through
 * its own effective(stagedDir, rel) and hands the text straight here.
 *
 * @param {string} rel  repo-relative path, forward slashes (used only for messages and scope)
 * @param {string} text file contents as utf8, BOM NOT stripped by the caller
 * @param {{root?: string}} [opts] root for resolving a _writer claim; omit to skip that check
 * @returns {{path, dialect, canonical, findings: string[]}}
 */
function auditText(rel, text, opts = {}) {
  const res = { path: rel, dialect: null, canonical: false, findings: [] };
  const secret = SECRET_BEARING.has(rel);
  const name = k => (secret ? '(name withheld: secret-bearing file)' : k);

  // --- rule 1: encoding -----------------------------------------------------------------------
  let body = text;
  if (body.charCodeAt(0) === 0xFEFF) { res.findings.push('rule 1: BOM'); body = body.slice(1); }
  if (body.includes('\r')) res.findings.push('rule 1: CRLF line endings');
  if (!body.endsWith('\n')) res.findings.push('rule 1: no trailing newline');
  else if (body.endsWith('\n\n')) res.findings.push('rule 1: more than one trailing newline');

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    res.findings.push(`unparseable: ${secret ? 'JSON.parse failed' : e.message}`);
    res.dialect = 'unparseable';
    return res;
  }

  res.dialect = classifyDialect(parsed);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    res.findings.push('rule 9: the root is not an object, so there is nowhere for the header to live');
    return res;
  }

  // --- rule 2: the four generated header fields -----------------------------------------------
  const missing = HEADER_KEYS.filter(k => !Object.prototype.hasOwnProperty.call(parsed, k));
  if (missing.length) res.findings.push(`rule 2: header missing ${missing.join(', ')}`);

  // --- rule 3: the schema identifier ----------------------------------------------------------
  if (Object.prototype.hasOwnProperty.call(parsed, '_schema')) {
    const sch = parsed._schema;
    if (typeof sch !== 'string' || !SCHEMA_ID.test(sch)) {
      res.findings.push(`rule 3: _schema ${JSON.stringify(sch)} is not name@revision`);
    }
  }

  // --- rule 2, the half nobody can check by eye: does _writer name a real script? --------------
  // A hand-typed _writer is a claim about code made without reading it.
  if (opts.root && typeof parsed._writer === 'string' && parsed._writer.trim() !== '') {
    const claim = parsed._writer.trim().split(/[\s(]/)[0];
    if (/[\\/]/.test(claim) && !fs.existsSync(path.join(opts.root, claim))) {
      res.findings.push(`rule 2: _writer names ${claim}, which does not exist`);
    }
  }

  // --- rules 5 and 6: key naming and key ordering ---------------------------------------------
  const k = { unsorted: [], sortUnverifiable: [], underscore: [], badCase: [], dateKey: [] };
  walkKeys(parsed, '', k, idMapsFor(parsed._schema));
  if (k.badCase.length) res.findings.push(`rule 5: not snake_case: ${k.badCase.slice(0, 6).map(name).join(', ')}${k.badCase.length > 6 ? ` (+${k.badCase.length - 6} more)` : ''}`);
  if (k.dateKey.length) res.findings.push(`rule 5: date inside a key: ${k.dateKey.slice(0, 4).map(name).join(', ')}${k.dateKey.length > 4 ? ` (+${k.dateKey.length - 4} more)` : ''}`);
  if (k.underscore.length) res.findings.push(`rule 2: underscore-prefixed payload key: ${k.underscore.slice(0, 6).map(name).join(', ')}${k.underscore.length > 6 ? ` (+${k.underscore.length - 6} more)` : ''}`);
  if (k.unsorted.length) res.findings.push(`rule 6: keys not sorted at ${k.unsorted.slice(0, 4).map(name).join(', ')}${k.unsorted.length > 4 ? ` (+${k.unsorted.length - 4} more)` : ''}`);
  if (k.sortUnverifiable.length) res.findings.push(`rule 6: key order UNVERIFIABLE at ${k.sortUnverifiable.slice(0, 3).map(name).join(', ')} (integer-like keys; JSON.parse reorders them)`);

  // --- rules 6, 7 and 8 at once: is this byte-for-byte what the helper emits? ------------------
  let canon = null;
  try { canon = canonicalText(parsed, { validate: false }) + '\n'; } catch (e) { /* unserializable */ }
  res.canonical = canon !== null && canon === body;
  if (!res.canonical && canon !== null && !res.findings.some(f => f.startsWith('rule 6') || f.startsWith('rule 1'))) {
    res.findings.push('rules 7 and 8: not byte-identical to the helper output (indent or formatting)');
  }

  return res;
}

// ---------------------------------------------------------------------------------------------
// The writer-site scan
// ---------------------------------------------------------------------------------------------

const WRITER_ROOTS = [
  { dir: 'scripts', ext: ['.js', '.mjs', '.cjs'] },
  { dir: 'work', ext: ['.js', '.mjs', '.cjs'] },
  { dir: 'system/recall', ext: ['.js', '.mjs'] },
];
const PS_ROOTS = [
  { dir: 'scripts', ext: ['.ps1', '.psm1'] },
  { dir: 'work', ext: ['.ps1', '.psm1'] },
];
const WRITER_SKIP = [/node_modules/, /(^|[\\/])\.git([\\/]|$)/];

function listFiles(root, sub, ext, acc) {
  const abs = path.join(root, sub);
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (WRITER_SKIP.some(r => r.test(rel))) continue;
    if (e.isDirectory()) listFiles(root, rel, ext, acc);
    else if (ext.includes(path.extname(e.name))) acc.push(rel);
  }
  return acc;
}

// A deliberately small evaluator. It handles the path shapes this repo actually writes: a literal,
// path.join/resolve of literals and already-known names, __dirname, the ESM dirname idiom, and
// `process.env.X || <expr>`. Anything else returns null, and null is reported as "unresolved"
// rather than guessed, because a guessed destination in a compliance report is worse than an
// admitted gap.
function makeResolver(root, relFile, text) {
  const dirOfFile = path.dirname(path.join(root, relFile));
  const consts = new Map();
  const declRe = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;
  let m;
  while ((m = declRe.exec(text)) !== null) if (!consts.has(m[1])) consts.set(m[1], m[2].trim());
  // EVERY value a name is ever given, declarations and later plain reassignments alike. The PATH
  // resolver keeps first-declaration semantics (a guessed destination is worse than none), but the
  // question "can this name carry serialized JSON?" must be answered over every value, or a `let`
  // given its JSON on a later line and then written walks past the scan (F05, test leg B6).
  const values = new Map();
  const addValue = (k, v) => { if (!values.has(k)) values.set(k, []); values.get(k).push(v.trim()); };
  for (const [k, v] of consts) addValue(k, v);
  const assignRe = /(?:^|\n|;)\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*([^\n;]+)/g;
  while ((m = assignRe.exec(text)) !== null) addValue(m[1], m[2]);

  const seen = new Set();
  function evaluate(expr, depth) {
    if (depth > 6) return null;
    expr = expr.trim().replace(/,$/, '');
    const alt = expr.match(/^process\.env\.\w+\s*(?:\|\||\?\?)\s*(.+)$/);
    if (alt) return evaluate(alt[1], depth + 1);
    const lit = expr.match(/^'([^']*)'$/) || expr.match(/^"([^"]*)"$/) || expr.match(/^`([^`$]*)`$/);
    if (lit) return lit[1];
    if (expr === '__dirname') return dirOfFile;
    if (expr === 'fileURLToPath(import.meta.url)') return path.join(root, relFile);
    if (/^path\.dirname\(\s*fileURLToPath\(import\.meta\.url\)\s*\)$/.test(expr)) return dirOfFile;
    const dirname = expr.match(/^path\.dirname\((.*)\)$/s);
    if (dirname) { const v = evaluate(dirname[1], depth + 1); return v === null ? null : path.dirname(v); }
    const join = expr.match(/^path\.(join|resolve)\((.*)\)$/s);
    if (join) {
      const parts = splitArgs(join[2]).map(p => evaluate(p, depth + 1));
      if (parts.some(p => p === null)) return null;
      return join[1] === 'resolve' ? path.resolve(...parts) : path.join(...parts);
    }
    if (/^[A-Za-z_$][\w$]*$/.test(expr) && consts.has(expr) && !seen.has(expr)) {
      seen.add(expr);
      const v = evaluate(consts.get(expr), depth + 1);
      seen.delete(expr);
      return v;
    }
    return null;
  }
  // Does this argument expression carry text a raw JSON.stringify produced? Directly, or through a
  // name whose value (any of its values) does, followed a few levels deep. It over-approximates on
  // purpose: a name that is ever given serialized JSON counts, because the cost of a false "yes" is
  // one reviewed line in a report and the cost of a false "no" is a guard that can be walked past.
  const seenData = new Set();
  function serializesJson(expr, depth) {
    if (depth > 6) return false;
    if (/JSON\.stringify/.test(expr)) return true;
    for (const id of expr.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (!values.has(id) || seenData.has(id)) continue;
      seenData.add(id);
      const hit = values.get(id).some(v => serializesJson(v, depth + 1));
      seenData.delete(id);
      if (hit) return true;
    }
    return false;
  }
  evaluate.serializesJson = (expr) => serializesJson(expr, 0);
  return evaluate;
}

function splitArgs(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Pull the balanced argument list of a call starting at `open` (the index of its "("). Calls span
// lines often enough that a line-at-a-time regex silently misses sites, which is how a scan reports
// a healthier system than it has.
function callArgs(text, open) {
  let depth = 0, q = null, i = open;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return { inner: text.slice(open + 1, i), end: i }; }
  }
  return null;
}

// A test that writes a LIVE in-scope file is still a writer of that file. It is labelled rather
// than excluded, because "the tests do it" is a reason to know about a write, not to stop counting it.
function siteKind(rel) {
  return /(^|\/)tests?\//.test(rel) || /(^|\/)(test|verify)-[^/]*\.(js|mjs|cjs|ps1)$/.test(rel) ? 'test' : 'production';
}

function scanWriterSites(root, inScopeSet) {
  const sites = [];
  const files = [];
  for (const r of WRITER_ROOTS) listFiles(root, r.dir, r.ext, files);
  for (const rel of [...new Set(files)].sort()) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!/JSON\.stringify/.test(text)) continue;
    const usesHelper = /json-writer/.test(text);
    const resolve = makeResolver(root, rel, text);

    // Every node call that puts bytes into a named file (F05). writeFile covers fs.writeFile,
    // fs.promises.writeFile and a bare writeFile imported from fs/promises; the \b before it keeps
    // writeFileSync from matching twice. A stream opened on an in-scope JSON file bypasses the helper
    // whatever it is later fed, because the helper's whole contract is one atomic whole-file write,
    // so a stream is judged by its target alone.
    const callRe = /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream)\s*\(/g;
    let m;
    while ((m = callRe.exec(text)) !== null) {
      const open = m.index + m[0].length - 1;
      const call = callArgs(text, open);
      if (!call) continue;
      callRe.lastIndex = call.end;
      const args = splitArgs(call.inner);
      const isStream = m[1] === 'createWriteStream';
      if (args.length < (isStream ? 1 : 2)) continue;
      if (!isStream && !resolve.serializesJson(args.slice(1).join(','))) continue;

      const abs = resolve(args[0], 0);
      let target = null;
      if (abs) {
        const r2 = path.relative(root, abs).split(path.sep).join('/');
        if (!r2.startsWith('..')) target = r2;
      }
      // A write site is judged against the in-scope FILE LIST, and a gitignored file that has not
      // been written yet is not on disk to be listed. So a resolved target is also in scope when
      // its PATH matches a glob: otherwise the writer of a not-yet-existing state file would drop
      // out of the scan on exactly the fresh checkout CI runs on.
      const inScope = target !== null && (inScopeSet.has(target) || matchesScope(target));
      if (!inScope && target !== null) continue;
      sites.push({
        site: `${rel}:${text.slice(0, m.index).split('\n').length}`,
        target,
        in_scope: inScope,
        kind: siteKind(rel),
        lang: 'node',
        call: m[1],
        imports_helper: usesHelper,
      });
    }
  }
  return sites;
}

// PowerShell cannot reach the node helper at all, so every .ps1 line that serializes JSON and
// writes it in the same statement is a writer site outside the standard by construction. Targets
// are variables built at runtime, so they are listed unresolved: the file and line are the finding.
function scanPowerShellSites(root) {
  const files = [];
  for (const r of PS_ROOTS) listFiles(root, r.dir, r.ext, files);
  const sites = [];
  for (const rel of [...new Set(files)].sort()) {
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (/ConvertTo-Json/i.test(line) && /(Set-Content|Out-File|WriteAllText|Add-Content)/i.test(line)) {
        sites.push({ site: `${rel}:${i + 1}`, target: null, in_scope: null, kind: siteKind(rel), lang: 'powershell', imports_helper: false });
      }
    });
  }
  return sites;
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

function globToRegex(glob) {
  return new RegExp('^' + glob.split('/').map(seg =>
    seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('/') + '$');
}
const SCOPE_RX = IN_SCOPE_GLOBS.map(globToRegex);
function matchesScope(rel) {
  if (OUT_OF_SCOPE_PATHS.some(([p]) => p === rel)) return false;
  if (OUT_OF_SCOPE_PREFIXES.some(([p]) => rel.startsWith(p))) return false;
  return SCOPE_RX.some(rx => rx.test(rel));
}

function expandGlob(root, glob) {
  const segs = glob.split('/');
  let dirs = [''];
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    const next = [];
    for (const d of dirs) {
      if (seg === '*') {
        let ents = [];
        try { ents = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch { continue; }
        for (const e of ents) if (e.isDirectory()) next.push(d ? `${d}/${e.name}` : e.name);
      } else {
        next.push(d ? `${d}/${seg}` : seg);
      }
    }
    dirs = next;
  }
  const rx = globToRegex(segs[segs.length - 1]);
  const out = [];
  for (const d of dirs) {
    let ents = [];
    try { ents = fs.readdirSync(path.join(root, d), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) if (e.isFile() && rx.test(e.name)) out.push(d ? `${d}/${e.name}` : e.name);
  }
  return out;
}

function auditTree(root, { withWriters = true, enforced = null } = {}) {
  const candidates = [...new Set(IN_SCOPE_GLOBS.flatMap(g => expandGlob(root, g)))].sort();
  // A root with nothing in it is an ERROR, never a clean bill of health: an audit that looked
  // nowhere must never be indistinguishable from a healthy system.
  if (candidates.length === 0) {
    throw new Error(`no in-scope JSON found under ${root}. Expected at least one of ` +
                    IN_SCOPE_GLOBS.join(', ') + '. Wrong --root, or a tree that is not an Alex repo.');
  }
  const files = [];
  const excluded = [];

  for (const rel of candidates) {
    const named = OUT_OF_SCOPE_PATHS.find(([p]) => p === rel);
    if (named) { excluded.push({ path: rel, reason: named[1] }); continue; }
    const pre = OUT_OF_SCOPE_PREFIXES.find(([p]) => rel.startsWith(p));
    if (pre) { excluded.push({ path: rel, reason: pre[1] }); continue; }

    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) {
      files.push({ path: rel, dialect: 'unreadable', canonical: false, findings: [`unreadable: ${e.code || e.message}`] });
      continue;
    }
    files.push(auditText(rel, text, { root }));
  }

  const inScopeSet = new Set(files.map(f => f.path));
  const writerSites = withWriters ? scanWriterSites(root, inScopeSet).concat(scanPowerShellSites(root)) : [];

  const fileFindings = files.reduce((n, f) => n + f.findings.length, 0);
  const bypasses = writerSites.filter(s => s.in_scope).length;
  const psSites = writerSites.filter(s => s.lang === 'powershell' && s.kind === 'production').length;

  const out = { root, files, excluded, writer_sites: writerSites,
                findings: fileFindings + bypasses + psSites,
                file_findings: fileFindings, writer_bypasses: bypasses, powershell_sites: psSites };

  // The ratchet. Only what is on the list can fail it; everything else is reported.
  if (enforced) {
    const set = new Set(enforced);
    const regressions = [];
    for (const rel of enforced) {
      const f = files.find(x => x.path === rel);
      if (f && f.findings.length) regressions.push(`${rel}: ${f.findings.join('; ')}`);
    }
    for (const s of writerSites) {
      if (s.lang === 'node' && s.target && set.has(s.target)) {
        regressions.push(s.call === 'createWriteStream'
          ? `${s.site} writes ${s.target} through a raw write stream, not through scripts/lib/json-writer.js`
          : `${s.site} writes ${s.target} with a raw JSON.stringify (${s.call}), not through scripts/lib/json-writer.js`);
      }
    }
    out.enforced = enforced.slice();
    out.enforced_present = enforced.filter(rel => inScopeSet.has(rel));
    out.regressions = regressions;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function renderTable(r, verbose) {
  const out = [];
  const enforcedSet = new Set(r.enforced || []);
  out.push('');
  out.push('JSON STANDARD COMPLIANCE, ' + new Date().toISOString().slice(0, 10) + ' (docs/json-standard.md)');
  out.push('');
  const conform = r.files.filter(f => f.findings.length === 0).length;
  out.push(`${conform} of ${r.files.length} in-scope files conform. ${r.files.length - conform} do not. ` +
           `${r.writer_bypasses} node writer site(s) serialize an in-scope file without the helper; ` +
           `${r.powershell_sites} PowerShell writer site(s) cannot reach it at all.`);
  out.push('');
  const w = Math.max(24, ...r.files.map(f => f.path.length)) + 2;
  out.push(pad('FILE', w) + '  ' + pad('ENF', 5) + pad('DIALECT', 17) + pad('CANON', 7) + 'FINDINGS');
  out.push('-'.repeat(w) + '  ' + '-'.repeat(5) + '-'.repeat(17) + '-'.repeat(7) + '-'.repeat(8));
  for (const f of r.files) {
    const head = pad(f.path, w) + '  ' + pad(enforcedSet.has(f.path) ? 'yes' : '', 5) +
                 pad(f.dialect, 17) + pad(f.canonical ? 'yes' : 'no', 7);
    if (!f.findings.length) { out.push(head + 'none'); continue; }
    out.push(head + f.findings[0]);
    for (const x of f.findings.slice(1)) out.push(' '.repeat(w + 31) + x);
  }
  if (r.enforced) {
    const absent = r.enforced.filter(p => !r.enforced_present.includes(p));
    if (absent.length) {
      out.push('');
      out.push(`ENFORCED but not on this disk (${absent.length}), nothing asserted about them here: ${absent.join(', ')}`);
    }
  }
  if (r.excluded.length) {
    out.push('');
    out.push(`EXCLUDED, by the ownership rule (${r.excluded.length}):`);
    const byReason = new Map();
    for (const e of r.excluded) byReason.set(e.reason, (byReason.get(e.reason) || 0) + 1);
    for (const [reason, n] of byReason) out.push(`  ${pad(n, 5)} ${reason}`);
  }
  const inScopeSites = r.writer_sites.filter(s => s.in_scope);
  const unresolved = r.writer_sites.filter(s => s.lang === 'node' && !s.in_scope);
  const psSites = r.writer_sites.filter(s => s.lang === 'powershell');
  if (inScopeSites.length) {
    out.push('');
    out.push('NODE WRITER SITES that serialize an IN-SCOPE file without scripts/lib/json-writer.js:');
    const sw = Math.max(20, ...inScopeSites.map(s => s.site.length));
    for (const s of inScopeSites) {
      out.push(`  ${pad(s.site, sw)}  ${pad(s.kind, 12)}-> ${s.target}` +
               (enforcedSet.has(s.target) ? '   ENFORCED' : '') +
               (s.imports_helper ? '   (file imports the helper, this line does not use it)' : ''));
    }
  }
  if (psSites.length) {
    out.push('');
    out.push('POWERSHELL WRITER SITES (ConvertTo-Json written to a file; the node helper cannot reach these):');
    for (const s of psSites) out.push(`  ${s.site}  [${s.kind}]`);
  }
  if (unresolved.length) {
    out.push('');
    out.push(`${unresolved.length} further JSON.stringify write site(s) have a destination this scan could not ` +
             `resolve statically (a runtime variable or a computed path). Not counted as findings. --verbose lists them.`);
    if (verbose) for (const s of unresolved) out.push(`  ${s.site}  [${s.kind}]`);
  }
  out.push('');
  out.push(r.findings === 0
    ? 'Result: clean.'
    : `Result: ${r.file_findings} file finding(s) across ${r.files.filter(f => f.findings.length).length} file(s), ` +
      `plus ${r.writer_bypasses} node writer bypass(es) and ${r.powershell_sites} PowerShell writer site(s).`);
  if (r.enforced) {
    out.push(r.regressions.length === 0
      ? `Enforced (${r.enforced.length} path(s), ${r.enforced_present.length} on this disk): clean. The backlog above is reported, never blocking.`
      : `Enforced: ${r.regressions.length} REGRESSION(S), a migrated file broken or written around the helper:`);
    for (const x of r.regressions) out.push(`  ${x}`);
  }
  out.push('');
  return out.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const rootIx = args.indexOf('--root');
  const root = rootIx >= 0 ? path.resolve(args[rootIx + 1]) : path.resolve(__dirname, '..');
  const asJson = args.includes('--json');
  const withWriters = !args.includes('--files');
  const ratchet = args.includes('--enforced');

  let enforced = null;
  try {
    enforced = readContract(root);
  } catch (e) {
    if (ratchet) {
      console.error(`json-standard-audit: FAILED: ${e.message}. That list IS the ratchet; without it --enforced has ` +
                    'no scope and would pass everything, which is worse than no check. Restore it (doc: docs/json-standard.md).');
      return 1;
    }
    enforced = null; // the whole-picture mode does not need the list; the ENF column is simply blank
  }

  let r;
  try {
    r = auditTree(root, { withWriters, enforced });
  } catch (e) {
    console.error(`json-standard-audit: FAILED to run: ${e.message}`);
    return 1;
  }
  console.log(asJson ? JSON.stringify(r, null, 2) : renderTable(r, args.includes('--verbose')));
  if (ratchet) return r.regressions.length === 0 ? 0 : 2;
  return r.findings === 0 ? 0 : 2;
}

module.exports = { auditText, auditTree, parseContract, readContract, matchesScope, CONTRACT_REL,
                   IN_SCOPE_GLOBS, OUT_OF_SCOPE_PATHS, OUT_OF_SCOPE_PREFIXES };

if (require.main === module) process.exit(main(process.argv));
