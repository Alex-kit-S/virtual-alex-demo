// scripts/lib/render-changelog.mjs - CHANGELOG.md is the render of system/template-changelog.jsonl.
//
// WHAT. The template's human changelog. Every template build appends one JSON row to
// system/template-changelog.jsonl (scripts/build-online-template.mjs, --push). This turns those rows
// into CHANGELOG.md, newest build first, and checks that a tree's CHANGELOG.md is exactly that
// render. The markdown is never a source: it is generated on every build, so it cannot say anything
// the rows do not.
//
// HOW. renderChangelog(jsonlText) returns the markdown. Rows from build 24 on carry their number;
// the older rows carry none and are numbered by position, the rule nextBuild() in the generator
// already enforces. writeChangelog(root) writes <root>/CHANGELOG.md from <root>/system/... and
// returns the paths it wrote. checkTree(root) returns every problem as a string (empty = agree):
// the two files must both exist or both be absent, and the markdown must equal the render byte for
// byte, line endings aside. scripts/tests/test-changelog.mjs runs checkTree in the tree it ships in.
//
// VERSION (2026-09-24, fleet Fix A, review finding F44). The same rows also render VERSION, one line
// naming the build the tree is, its date and the Kit commit it was built from, so the support bundle's
// `cat VERSION` answers which build an owner is on. The Kit's own VERSION is the laptop release marker
// and a drop row online; a generated tree's VERSION is this render, and checkTree holds it to that.
//
// NEVER. Never reads the clock or the environment, so the same rows always render the same bytes.
// Never edits the jsonl: the generator is its one writer. Never tolerates a row that does not
// parse: the changelog is the build history, and a guessed row is a false one.
'use strict';

import fs from 'node:fs';
import path from 'node:path';

export const CHANGELOG_MD = 'CHANGELOG.md';
export const CHANGELOG_JSONL = 'system/template-changelog.jsonl';
export const VERSION_FILE = 'VERSION';

const INTRO = [
  '# Changelog',
  '',
  'Every build of the Virtual Alex template, newest first. This file is generated from',
  '`system/template-changelog.jsonl` each time the template is built, so it always agrees with',
  'that file. Do not edit it by hand: CI compares the two and fails on any difference.',
  '',
  'Sensitive files are the ones that change how Alex behaves: settings, commands, hooks and their',
  'libraries, workflows, Routine orders and `CLAUDE.md`. `/update` names them before it asks for',
  'your yes.',
];

/** The rows, parsed, each with its build number. Throws on a row that does not parse. */
export function parseRows(jsonlText) {
  const lines = String(jsonlText || '').replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  return lines.map((l, i) => {
    let row;
    try { row = JSON.parse(l); } catch { throw new Error(`${CHANGELOG_JSONL} row ${i + 1} is not JSON; the changelog will not guess what it said`); }
    if (row.build !== undefined && row.build !== i + 1) {
      throw new Error(`${CHANGELOG_JSONL} row ${i + 1} says build ${row.build}; a row was deleted or inserted`);
    }
    return { ...row, build: i + 1 };
  });
}

const when = (at) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(at || ''));
  return m ? `${m[1]} ${m[2]} UTC` : 'date unknown';
};
const short = (sha) => (typeof sha === 'string' && sha ? `\`${sha.slice(0, 12)}\`` : 'unknown');

/** The markdown for a whole jsonl text. Deterministic: same rows, same bytes. */
export function renderChangelog(jsonlText) {
  const rows = parseRows(jsonlText);
  const out = [...INTRO];
  for (const r of rows.slice().reverse()) {
    const flagged = Array.isArray(r.flagged) ? r.flagged : [];
    out.push('', `## Build ${r.build} (${when(r.at)})`, '');
    out.push(r.previous_template_commit
      ? `- ${r.changed} of ${r.files} files changed.`
      : `- The first build: ${r.files} files.`);
    out.push(`- Sensitive files: ${flagged.length ? flagged.map((p) => `\`${p}\``).join(', ') : 'none'}.`);
    out.push(`- Built from Kit commit ${short(r.kit_commit)}${r.kit_dirty ? ', with uncommitted changes in the Kit' : ''}.`);
  }
  return `${out.join('\n')}\n`;
}

/** VERSION for a whole jsonl text: the newest build, its date and its Kit commit, one line. */
export function renderVersion(jsonlText) {
  const rows = parseRows(jsonlText);
  if (!rows.length) throw new Error(`${CHANGELOG_JSONL} has no rows, so there is no build to name`);
  const r = rows[rows.length - 1];
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(r.at || ''));
  const kit = typeof r.kit_commit === 'string' && r.kit_commit ? r.kit_commit.slice(0, 12) : 'unknown';
  return `Virtual Alex template build ${r.build}, ${day ? day[1] : 'date unknown'}, from Kit commit ${kit}\n`;
}

/** Writes <root>/CHANGELOG.md and <root>/VERSION when the jsonl exists there. Returns the tree paths written. */
export function writeChangelog(root) {
  const src = path.join(root, CHANGELOG_JSONL);
  if (!fs.existsSync(src)) return [];
  const text = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(path.join(root, CHANGELOG_MD), renderChangelog(text));
  fs.writeFileSync(path.join(root, VERSION_FILE), renderVersion(text));
  return [CHANGELOG_MD, VERSION_FILE];
}

/** Every way <root>'s CHANGELOG.md and its jsonl disagree, as strings. Empty = they agree. */
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
  } catch (e) { return [e.message]; }
  const verFile = path.join(root, VERSION_FILE);
  const haveVersion = fs.existsSync(verFile) ? fs.readFileSync(verFile, 'utf8').replace(/\r\n/g, '\n') : null;
  const problems = haveVersion === wantVersion ? [] : [`${VERSION_FILE} is not the render of ${CHANGELOG_JSONL}: it reads ${JSON.stringify(haveVersion)}, the render reads ${JSON.stringify(wantVersion)}`];
  const have = fs.readFileSync(md, 'utf8').replace(/\r\n/g, '\n');
  if (have === want) return problems;
  const a = have.split('\n');
  const b = want.split('\n');
  const n = a.findIndex((l, i) => l !== b[i]);
  const at = n === -1 ? Math.min(a.length, b.length) : n;
  return [...problems, `${CHANGELOG_MD} is not the render of ${CHANGELOG_JSONL}: line ${at + 1} reads ${JSON.stringify(a[at] ?? '(end of file)')}, the render reads ${JSON.stringify(b[at] ?? '(end of file)')}`];
}
