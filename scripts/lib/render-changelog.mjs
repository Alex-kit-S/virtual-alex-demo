// @ts-check
// scripts/lib/render-changelog.mjs - CHANGELOG.md and VERSION, rendered from system/template-changelog.jsonl.
//
// WHAT. The template's human changelog and its one-line version marker. Every template build appends one
// JSON row to system/template-changelog.jsonl (scripts/build-online-template.mjs); this module turns those
// rows into CHANGELOG.md, newest build first, and into VERSION, which names the build a tree is: the
// support bundle's `cat VERSION` answer, and the line scripts/lib/install-state.js parses. It also checks
// that a tree's two rendered files say exactly what its rows say. Neither file is ever a source: both are
// written again on every build, so neither can say anything the rows do not.
//
// HOW. parseRows(text) parses the rows and numbers them by position. Newer rows also carry their number,
// and one that disagrees with its position is refused, the rule the generator's nextBuild() enforces.
// renderChangelog(text) returns the markdown and renderVersion(text) the VERSION line, which names the
// newest build, its day and its Kit commit. writeChangelog(root) writes <root>/CHANGELOG.md and
// <root>/VERSION from <root>/system/template-changelog.jsonl and returns the tree paths it wrote, or []
// when the tree has no jsonl. checkTree(root) returns every disagreement as one sentence (none = they
// agree): CHANGELOG.md and the jsonl must both exist or both be absent, and each rendered file must equal
// its render byte for byte, line endings aside. scripts/tests/test-changelog.mjs runs checkTree in the
// tree it ships in. The Kit's own VERSION is the laptop release marker and a drop row online; only a
// generated tree's VERSION is this render.
//
// NEVER. Reads the clock or the environment: the same rows always render the same bytes. Writes the
// jsonl: the generator is its one writer. Guesses a row that does not parse: the changelog is the build
// history, and a guessed row is a false one. Knowingly keeps the defects
// scripts/tests/test-render-changelog-contract.mjs pins (R3-L9, R3-L10, R3-L11): writeChangelog writes
// CHANGELOG.md before an empty jsonl fails VERSION, a malformed row field renders as confident prose, and
// an empty jsonl is a valid CHANGELOG.md and a fatal VERSION.
//
// Usage: module only

import fs from 'node:fs';
import path from 'node:path';

export const CHANGELOG_MD = 'CHANGELOG.md';
export const CHANGELOG_JSONL = 'system/template-changelog.jsonl';
export const VERSION_FILE = 'VERSION';

// How many characters of a Kit commit a render shows.
const SHORT_SHA = 12;
// A row's `at` read to the minute for a heading, and to the day for VERSION.
const AT_MINUTE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
const AT_DAY = /^(\d{4}-\d{2}-\d{2})/;

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

/**
 * One build as the generator wrote it, numbered by its position in the jsonl. Every other field comes
 * from the file unchecked, so each is read defensively where it is printed.
 * @typedef {object} ChangelogRow
 * @property {number} build 1 for the first row
 * @property {unknown} [at] the build time, an ISO string
 * @property {unknown} [changed] how many files changed since the previous build
 * @property {unknown} [files] how many files the tree holds
 * @property {unknown} [flagged] the sensitive paths among the changed ones
 * @property {unknown} [kit_commit] the Kit commit the tree was built from
 * @property {unknown} [kit_dirty] true when the Kit had uncommitted changes
 * @property {unknown} [previous_template_commit] null on the first build
 */

/** @param {string} text */
const toLf = (text) => text.replace(/\r\n/g, '\n');

/**
 * The first SHORT_SHA characters of a commit, or null when it is not a non-empty string.
 * @param {unknown} sha
 */
const shortSha = (sha) => (typeof sha === 'string' && sha ? sha.slice(0, SHORT_SHA) : null);

/**
 * A heading's date: the row's day and minute in UTC, or "date unknown", never a guess.
 * @param {unknown} at
 */
function when(at) {
  const m = AT_MINUTE.exec(String(at || ''));
  return m ? `${m[1]} ${m[2]} UTC` : 'date unknown';
}

/**
 * The rows, parsed, each with its build number. Throws on a row that does not parse, and on a numbered
 * row away from its position.
 * @param {string} jsonlText
 * @returns {ChangelogRow[]}
 */
export function parseRows(jsonlText) {
  const lines = toLf(String(jsonlText || ''))
    .split('\n')
    .filter((l) => l.trim());
  return lines.map((l, i) => {
    let row;
    try {
      row = JSON.parse(l);
    } catch {
      throw new Error(`${CHANGELOG_JSONL} row ${i + 1} is not JSON; the changelog will not guess what it said`);
    }
    if (row.build !== undefined && row.build !== i + 1) {
      throw new Error(`${CHANGELOG_JSONL} row ${i + 1} says build ${row.build}; a row was deleted or inserted`);
    }
    return { ...row, build: i + 1 };
  });
}

/**
 * The markdown for a whole jsonl text. Deterministic: the same rows give the same bytes.
 * @param {string} jsonlText
 */
export function renderChangelog(jsonlText) {
  const rows = parseRows(jsonlText);
  const out = [...INTRO];
  for (const r of rows.slice().reverse()) {
    const flagged = Array.isArray(r.flagged) ? r.flagged : [];
    const kit = shortSha(r.kit_commit);
    const size = r.previous_template_commit
      ? `- ${r.changed} of ${r.files} files changed.`
      : `- The first build: ${r.files} files.`;
    const sensitive = flagged.length ? flagged.map((p) => `\`${p}\``).join(', ') : 'none';
    const dirty = r.kit_dirty ? ', with uncommitted changes in the Kit' : '';
    out.push('', `## Build ${r.build} (${when(r.at)})`, '', size);
    out.push(`- Sensitive files: ${sensitive}.`);
    out.push(`- Built from Kit commit ${kit ? `\`${kit}\`` : 'unknown'}${dirty}.`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * VERSION for a whole jsonl text: the newest build, its day and its Kit commit, on one line.
 * @param {string} jsonlText
 */
export function renderVersion(jsonlText) {
  const rows = parseRows(jsonlText);
  if (!rows.length) throw new Error(`${CHANGELOG_JSONL} has no rows, so there is no build to name`);
  const r = rows[rows.length - 1];
  const day = AT_DAY.exec(String(r.at || ''));
  const kit = shortSha(r.kit_commit) ?? 'unknown';
  return `Virtual Alex template build ${r.build}, ${day ? day[1] : 'date unknown'}, from Kit commit ${kit}\n`;
}

/**
 * Writes <root>/CHANGELOG.md and <root>/VERSION when the jsonl exists there.
 * @param {string} root the tree
 * @returns {string[]} the tree paths written, or [] when there is no jsonl
 */
export function writeChangelog(root) {
  const src = path.join(root, CHANGELOG_JSONL);
  if (!fs.existsSync(src)) return [];
  const text = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(path.join(root, CHANGELOG_MD), renderChangelog(text));
  fs.writeFileSync(path.join(root, VERSION_FILE), renderVersion(text));
  return [CHANGELOG_MD, VERSION_FILE];
}

/**
 * The sentence for a CHANGELOG.md that is not its render: the first line where the two differ.
 * @param {string} have the file, LF line endings
 * @param {string} want the render
 */
function firstDifference(have, want) {
  const a = have.split('\n');
  const b = want.split('\n');
  const n = a.findIndex((l, i) => l !== b[i]);
  const at = n === -1 ? Math.min(a.length, b.length) : n;
  return `${CHANGELOG_MD} is not the render of ${CHANGELOG_JSONL}: line ${at + 1} reads ${JSON.stringify(a[at] ?? '(end of file)')}, the render reads ${JSON.stringify(b[at] ?? '(end of file)')}`;
}

/**
 * Every way <root>'s CHANGELOG.md and VERSION disagree with its jsonl, one sentence each.
 * @param {string} root the tree
 * @returns {string[]} empty when they agree, or when neither CHANGELOG.md nor the jsonl exists
 */
export function checkTree(root) {
  const md = path.join(root, CHANGELOG_MD);
  const jsonl = path.join(root, CHANGELOG_JSONL);
  const hasMd = fs.existsSync(md);
  const hasJsonl = fs.existsSync(jsonl);
  if (!hasMd && !hasJsonl) return [];
  if (!hasMd) return [`${CHANGELOG_JSONL} exists and ${CHANGELOG_MD} does not; the build writes one from the other`];
  if (!hasJsonl) return [`${CHANGELOG_MD} exists with no ${CHANGELOG_JSONL} to be the render of`];
  let want;
  let wantVersion;
  try {
    const text = fs.readFileSync(jsonl, 'utf8');
    want = renderChangelog(text);
    wantVersion = renderVersion(text);
  } catch (e) {
    return [/** @type {Error} */ (e).message];
  }
  const verFile = path.join(root, VERSION_FILE);
  const haveVersion = fs.existsSync(verFile) ? toLf(fs.readFileSync(verFile, 'utf8')) : null;
  const problems =
    haveVersion === wantVersion
      ? []
      : [
          `${VERSION_FILE} is not the render of ${CHANGELOG_JSONL}: it reads ${JSON.stringify(haveVersion)}, the render reads ${JSON.stringify(wantVersion)}`
        ];
  const have = toLf(fs.readFileSync(md, 'utf8'));
  if (have === want) return problems;
  return [...problems, firstDifference(have, want)];
}
