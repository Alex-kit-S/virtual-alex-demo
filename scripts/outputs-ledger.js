#!/usr/bin/env node
// @ts-check
// scripts/outputs-ledger.js - the deliverables ledger over outputs/, and the two indexes generated from it.
//
// WHAT. Every file a run delivers under outputs/ gets one row in outputs/ledger.jsonl, and the ledger is what
// "that file from last week" is found through: outputs/INDEX.md and its Obsidian copy vault/outputs-index.md
// list every deliverable newest first. Files never move; a row records where one already is. The Close-Out
// adds a row per deliverable, scripts/close-out-online.sh runs reconcile and render at the end of every run,
// and the recovery sweep's C12 runs validate.
//
// HOW. add appends one row for a file that exists; update-desc appends a row that supersedes an existing path's description
// or links; reconcile appends a skeleton row for every deliverable on disk the ledger does not name yet, then renders;
// render writes both indexes; validate checks outputs/'s top-level folder names. A flag is read by lookup: the word after
// the first --name anywhere on the line. A row's path is repo-relative with forward slashes and is its key. render shows
// the latest row per path, leaves out a row whose file is gone, sorts by date and then path, newest first, and stamps the
// clock to the minute; the vault copy turns vault/*.md links into [[wiki links]]. A skeleton row takes its date from the
// first YYYY-MM-DD in its path, else from the file's modification time, its project from its top folder, its kind from its
// extension, and its description from its file name. reconcile skips a file directly under outputs/, the streams (logs,
// voice, typed), the temporary extensions, the ledger, INDEX.md, .platform, OS junk and the parts of a Power BI bundle,
// whose one deliverable is the .pbip file. validate accepts a folder named for a manifest project, an unnumbered entry or
// an exemption. manifestNames() reads MANIFEST through scripts/lib/json-writer.js's readJsonHeaderless. An unknown flag on
// this Routine edge warns on stderr and carries on: the check runs once per invocation at the command dispatch below, never
// inside reconcile()/add()/ update-desc(), since each calls render() internally and a second check would warn twice.
// warnUnknownFlags calls scripts/lib/args.js for the warning only, discarding its parsed values and any Refusal it raises
// for a known flag used oddly, so args.js's own wording and exit code never reach a caller of this file.
//
// NEVER. Moves, rewrites or deletes a ledger line: the ledger is append-only, and a correction is a newer row.
// Requires anything outside scripts/lib/ (args.js, errors.js, exit-codes.js, json-writer.js) beside node
// builtins: every test that copies this file alone into a temp tree copies those four beside it too. Fixes in
// passing a defect that scripts/tests/test-status-rotate-ledger.mjs pins: the Kit's own commands write folders
// validate rejects (R8-5), one torn ledger line crashes add, reconcile and render with a raw SyntaxError
// (R8-6), add accepts a path outside outputs/, and validate, render and reconcile crash with a raw ENOENT when
// outputs/ is absent (R8-22).
//
// contract: read as text by scripts/tests/test-status-rotate-ledger.mjs:930. Every --flag these Usage
// lines and ADD_FLAGS/UPDATE_DESC_FLAGS name must agree; add or drop one in both places together.
// Usage: node scripts/outputs-ledger.js add --project <name> --path <outputs/...> --desc <text> [--link <a,b>]
//        node scripts/outputs-ledger.js update-desc --path <outputs/...> [--desc <text>] [--link <a,b>]
//        node scripts/outputs-ledger.js reconcile | validate | render
// Exit: 0 done - 1 a usage error, a missing file or row, or a crash - 2 validate found a misnamed folder
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonHeaderless } = require('./lib/json-writer');
const { parseCommandLine } = require('./lib/args');
const { Refusal } = require('./lib/errors');

// Computed by hand rather than imported from repo-root.js: every test that reaches this file copies it
// alone, without scripts/lib/, so a shared repo-root module would have to join that copy list.
const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'outputs');
const LEDGER = path.join(OUT, 'ledger.jsonl');
const INDEX_OUT = path.join(OUT, 'INDEX.md');
const INDEX_VAULT = path.join(REPO, 'vault', 'outputs-index.md');
const MANIFEST = path.join(REPO, 'system', 'manifest.json');

// Streams are never ledgered: logs are regenerable, voice and typed are corpora whose paths are load-bearing.
const STREAM_DIRS = ['logs', 'voice', 'typed'];
// Top-level folders that are not manifest keys and are still legitimate: sessions is the home of every
// one-off session's outputs (sessions/YYYY-MM-DD-topic/). Their files are deliverables and get rows; only
// the folder name needs the exemption, and one that earns a manifest key drops out of this list.
const EXEMPT_DIRS = [...STREAM_DIRS, 'sessions'];
const SKIP_FILES = new Set(['ledger.jsonl', 'INDEX.md', '.gitkeep', 'desktop.ini', 'Thumbs.db', '.platform']);
const SKIP_EXT = new Set(['.log', '.tmp', '.lock']);
// The parts of a multi-file bundle are one deliverable, never rows of their own: a PBIP project explodes
// into dozens of .Report and .SemanticModel files, and the .pbip file is the deliverable.
const BUNDLE_SEGMENT = /\/(?:[^/]+\.(?:Report|SemanticModel)|\.pbi)\//;
const DATE_IN_PATH = /(\d{4}-\d{2}-\d{2})/;
// reconcile prints this many of the rows it added, then a count of the rest.
const MAX_LISTED = 20;
// add's and update-desc's own flags: the one table each subcommand's warnUnknownFlags call reads at the
// dispatch below, so a flag added to or dropped from one is a change everyone can see.
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const ADD_FLAGS = {
  project: { type: 'string' },
  path: { type: 'string' },
  desc: { type: 'string' },
  link: { type: 'string' }
};
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const UPDATE_DESC_FLAGS = { path: { type: 'string' }, desc: { type: 'string' }, link: { type: 'string' } };

/**
 * @typedef {object} Row
 * @property {string} date
 * @property {string} project
 * @property {string} kind
 * @property {string} desc
 * @property {string} path repo-relative, forward slashes: the key
 * @property {string} added manual, reconcile, backfill or update
 * @property {string[]} [links]
 */

/** Every name a top-level outputs/ folder may carry because the manifest registers it. */
function manifestNames() {
  const m = readJsonHeaderless(MANIFEST);
  const names = m.projects.map((/** @type {{ name: string }} */ p) => p.name);
  for (const u of m.meta.unnumbered || []) names.push(u.name);
  return new Set(names);
}

/**
 * Print one WARNING line on stderr for every flag this subcommand does not know, and carry on: a Routine
 * edge never refuses one. Every known flag keeps flag()'s own reading above; args.js's parsed values
 * and any Refusal it raises for a known flag used oddly are both discarded, never args.js's own wording or
 * exit code.
 * @param {Record<string, { type: 'string' | 'boolean' }>} options this subcommand's known flags
 */
function warnUnknownFlags(options) {
  try {
    parseCommandLine({ name: 'outputs-ledger', edge: 'routine', options, allowPositionals: false });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
}

/**
 * A path relative to the repository, with forward slashes.
 * @param {string} p
 */
function rel(p) {
  return path.relative(REPO, p).split(path.sep).join('/');
}

/** @returns {Row[]} every row, in append order; a torn line throws the SyntaxError JSON.parse gives */
function readLedger() {
  if (!fs.existsSync(LEDGER)) return [];
  return fs
    .readFileSync(LEDGER, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** @param {Row[]} rows */
function appendRows(rows) {
  if (!rows.length) return;
  const text = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  fs.appendFileSync(LEDGER, text, 'utf8');
}

/**
 * Every file under `dir`, depth first.
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Every deliverable file under outputs/'s folders, the streams and skipped files left out. */
function deliverablesOnDisk() {
  /** @type {string[]} */
  const files = [];
  if (!fs.existsSync(OUT)) return files;
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (STREAM_DIRS.includes(e.name)) continue;
    for (const f of walk(path.join(OUT, e.name))) {
      const base = path.basename(f);
      if (SKIP_FILES.has(base) || SKIP_EXT.has(path.extname(f).toLowerCase())) continue;
      if (BUNDLE_SEGMENT.test(`/${rel(f)}/`)) continue;
      files.push(f);
    }
  }
  return files;
}

/**
 * The first dated segment of the path, else the day the file was last modified.
 * @param {string} file
 */
function dateFor(file) {
  const m = rel(file).match(DATE_IN_PATH);
  if (m) return m[1];
  return new Date(fs.statSync(file).mtime).toISOString().slice(0, 10);
}

/**
 * The project a file's top folder under outputs/ stands for.
 * @param {string} file
 */
function projectFor(file) {
  return rel(file).split('/')[1];
}

/**
 * The file name without its extension, dashes and underscores read as spaces.
 * @param {string} file
 */
function descFor(file) {
  return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();
}

/**
 * The row a file gets before anyone describes it.
 * @param {string} file
 * @param {string} added
 * @returns {Row}
 */
function skeletonRow(file, added) {
  return {
    date: dateFor(file),
    project: projectFor(file),
    kind: path.extname(file).replace('.', '').toLowerCase() || 'file',
    desc: descFor(file),
    path: rel(file),
    added
  };
}

/**
 * The last row of each path. Append order is chronological, so a row update-desc wrote, or a corrected
 * --link, wins over the rows before it.
 * @param {Row[]} rows
 */
function latestPerPath(rows) {
  /** @type {Map<string, Row>} */
  const byPath = new Map();
  for (const r of rows) byPath.set(r.path, r);
  return [...byPath.values()];
}

/**
 * The Links cell: code spans in outputs/INDEX.md; in the vault copy a vault/*.md link becomes a [[wiki link]],
 * so the deliverable joins the Obsidian graph, and anything else (a Notion URL) stays as it is.
 * @param {string[] | undefined} links
 * @param {boolean} wiki
 */
function linkCell(links, wiki) {
  if (!links?.length) return '';
  return links
    .map((l) => {
      if (!wiki) return `\`${l}\``;
      const m = String(l).match(/^vault\/(.+)\.md$/);
      return m ? `[[${m[1]}]]` : String(l);
    })
    .join(' · ');
}

/**
 * The part both indexes share: the count line and the table.
 * @param {Row[]} rows
 * @param {boolean} wiki
 * @param {string} stamp
 */
function buildBody(rows, wiki, stamp) {
  const table = [
    '| Date | Project | Kind | What it is | Path | Links |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) => `| ${r.date} | ${r.project} | ${r.kind} | ${r.desc} | \`${r.path}\` | ${linkCell(r.links, wiki)} |`
    )
  ].join('\n');
  return `**${rows.length} deliverables, newest first.** Generated from \`outputs/ledger.jsonl\` by \`scripts/outputs-ledger.js\` - never hand-edit. Regenerate: \`node scripts/outputs-ledger.js render\`. Last generated: ${stamp}.\n\n${table}\n`;
}

/**
 * Write both indexes. An index is where a file is found, so a row whose file has moved or gone is left out;
 * the ledger keeps its history.
 * @returns {number} the rows rendered
 */
function render() {
  const rows = latestPerPath(readLedger())
    .filter((r) => !r.path || fs.existsSync(path.join(REPO, r.path)))
    .sort((a, b) => (b.date + b.path).localeCompare(a.date + a.path));
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  fs.writeFileSync(INDEX_OUT, `# Outputs Index\n\n${buildBody(rows, false, stamp)}`, 'utf8');
  fs.writeFileSync(
    INDEX_VAULT,
    `---\ntags: [index, outputs, generated]\nupdated: ${stamp.slice(0, 10)}\n---\n\n# Outputs Index (deliverables ledger)\n\n${buildBody(rows, true, stamp)}`,
    'utf8'
  );
  return rows.length;
}

/** `reconcile`: a skeleton row for every deliverable the ledger does not name, then both indexes. */
function reconcile() {
  const known = new Set(readLedger().map((r) => r.path));
  const missing = deliverablesOnDisk().filter((f) => !known.has(rel(f)));
  const rows = missing.map((f) => skeletonRow(f, known.size === 0 ? 'backfill' : 'reconcile'));
  appendRows(rows);
  const total = render();
  console.log(`reconcile: ${rows.length} row(s) added, ${total} total. INDEX.md + vault/outputs-index.md rendered.`);
  for (const r of rows.slice(0, MAX_LISTED)) console.log(`  + ${r.date} ${r.project} ${r.path}`);
  if (rows.length > MAX_LISTED) console.log(`  ... and ${rows.length - MAX_LISTED} more`);
}

/** `validate`: every top-level folder of outputs/ is a manifest name or a declared exemption, or exit 2. */
function validate() {
  const names = manifestNames();
  const bad = [];
  for (const e of fs.readdirSync(OUT, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (names.has(e.name) || EXEMPT_DIRS.includes(e.name)) continue;
    bad.push(e.name);
  }
  if (bad.length) {
    console.log(`VALIDATE FAIL: outputs/ top-level dir(s) not a manifest key or declared exemption: ${bad.join(', ')}`);
    console.log(
      'Fix: rename to the registry name, or (one-offs) move under outputs/sessions/, or add a justified exemption in scripts/outputs-ledger.js.'
    );
    process.exit(2);
  }
  console.log('validate: outputs/ top-level naming clean.');
}

/**
 * The word after the first --`name` on the command line: null when it is absent, undefined when it is last.
 * @param {string[]} args
 * @param {string} name
 * @returns {string | null | undefined}
 */
function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

/**
 * The --link list: comma-separated, each entry trimmed, empty entries dropped.
 * @param {string[]} args
 */
function parseLinks(args) {
  const l = flag(args, 'link');
  return l
    ? l
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/**
 * `add`: one row for a file that exists and is not ledgered yet, then both indexes.
 * @param {string[]} args
 */
function add(args) {
  const p = flag(args, 'path');
  const project = flag(args, 'project');
  const desc = flag(args, 'desc');
  if (!p || !project || !desc) {
    console.error('usage: add --project X --path outputs/... --desc "..." [--link a.md,b]');
    process.exit(1);
  }
  const full = path.join(REPO, p);
  if (!fs.existsSync(full)) {
    console.error(`add: file not found: ${p}`);
    process.exit(1);
  }
  const relP = rel(full);
  if (readLedger().some((r) => r.path === relP)) {
    console.log(`add: already ledgered: ${relP} (use update-desc to revise)`);
    render();
    return;
  }
  const row = { ...skeletonRow(full, 'manual'), project, desc };
  const links = parseLinks(args);
  if (links.length) row.links = links;
  appendRows([row]);
  render();
  console.log(`add: ${row.date} ${row.project} ${relP}${links.length ? ` +${links.length} link(s)` : ''}`);
}

/**
 * `update-desc`: a row superseding an existing path's description or links, then both indexes. This is how a
 * skeleton row a reconcile wrote gets its real description.
 * @param {string[]} args
 */
function updateDesc(args) {
  const p = flag(args, 'path');
  const desc = flag(args, 'desc');
  if (!p || (!desc && !flag(args, 'link'))) {
    console.error('usage: update-desc --path outputs/... [--desc "..."] [--link a.md,b]');
    process.exit(1);
  }
  const relP = p.split(path.sep).join('/');
  const existing = latestPerPath(readLedger()).find((r) => r.path === relP);
  if (!existing) {
    console.error(`update-desc: no ledger row for ${relP} - add it first`);
    process.exit(1);
  }
  const row = { ...existing, added: 'update' };
  if (desc) row.desc = desc;
  const links = parseLinks(args);
  if (links.length) row.links = links;
  appendRows([row]);
  render();
  console.log(`update-desc: ${relP}${desc ? ' desc revised' : ''}${links.length ? ` +${links.length} link(s)` : ''}`);
}

const [cmd, ...rest] = process.argv.slice(2);
// The warning check runs once per invocation here, never inside reconcile()/add()/update-desc() themselves,
// since each calls render() internally and a second check on the same command line would warn twice.
if (cmd === 'reconcile') {
  warnUnknownFlags({});
  reconcile();
} else if (cmd === 'validate') {
  warnUnknownFlags({});
  validate();
} else if (cmd === 'render') {
  warnUnknownFlags({});
  console.log(`render: ${render()} rows.`);
} else if (cmd === 'add') {
  warnUnknownFlags(ADD_FLAGS);
  add(rest);
} else if (cmd === 'update-desc') {
  warnUnknownFlags(UPDATE_DESC_FLAGS);
  updateDesc(rest);
} else {
  console.error('usage: outputs-ledger.js <add|update-desc|reconcile|validate|render>');
  process.exit(1);
}
