// @ts-check
// scripts/lib/render-templates.js - fills the document templates under templates/ with generated values.
//
// WHAT. Every generated document takes its prose from a template, templates/<name>.template.md, and only
// its data from code. This module loads a template, cuts a named block out of one, and fills its
// {{SLOT}} placeholders, so the generators that build CLAUDE.md's routing table and the four documents
// under docs/ carry no prose of their own. It also holds the two cell helpers those tables share: a
// project number padded to two digits, and a table cell with its pipes escaped.
//
// HOW. loadTemplate reads templates/<name>.template.md from the repository root. block returns the text
// from a "<!-- BLOCK:NAME -->" line to the next BLOCK marker or the end of the template, trailing
// whitespace cut to one line break; a caller that wants a whole template does not call it. fill replaces
// each {{KEY}} of the map with its value, key by key in the map's order, then refuses the result if any
// {{UPPER_SNAKE}} slot is left. A value goes in as it is, so one that holds a {{SLOT}} of its own is
// filled by a later key or refused as left over; the generator tests pin both. PLACEHOLDER_RE is the
// slot pattern; scripts/lib/validate/structure.js imports it (with pad) for G1, so this module keeps the
// one copy of the pattern it exports.
//
// NEVER. Writes a file: the caller stages what it renders. Renders with a slot left unfilled, or with a
// value that is null or undefined: either refuses, naming the context the caller gave.
//
// Usage: module only - const { loadTemplate, block, fill, pad, esc } = require('./render-templates');
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./repo-root');

const TEMPLATES = path.join(REPO, 'templates');

/** An unresolved {{SLOT}}: uppercase letters, digits and underscores between double braces. */
const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g;

/**
 * A project number as the tables print it, two digits with a leading zero.
 * @param {number | string} n
 */
const pad = (n) => String(n).padStart(2, '0');

/**
 * A value made safe for one cell of a markdown table: every pipe escaped.
 * @param {unknown} s
 */
const esc = (s) => String(s).replace(/\|/g, '\\|');

/**
 * The text of templates/<name>.template.md.
 * @param {string} name
 * @returns {string}
 */
function loadTemplate(name) {
  const p = path.join(TEMPLATES, `${name}.template.md`);
  if (!fs.existsSync(p)) throw new Error(`render-templates: missing template ${path.relative(REPO, p)}`);
  return fs.readFileSync(p, 'utf8');
}

/**
 * One named block of a template, ending in a single line break.
 * @param {string} templateText
 * @param {string} blockName
 * @returns {string}
 */
function block(templateText, blockName) {
  const re = new RegExp(`<!-- BLOCK:${blockName} -->\\r?\\n([\\s\\S]*?)(?=<!-- BLOCK:|$)`);
  const m = templateText.match(re);
  if (!m) throw new Error(`render-templates: block ${blockName} not found`);
  return `${m[1].replace(/\s+$/, '')}\n`;
}

/**
 * The text with every {{KEY}} of the map filled, refused if any slot is left.
 * @param {string} text
 * @param {Record<string, unknown>} map
 * @param {string} contextName names the template or block in a refusal
 * @returns {string}
 */
function fill(text, map, contextName) {
  let out = text;
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null) throw new Error(`render-templates: ${contextName}: value for {{${k}}} is ${v}`);
    out = out.split(`{{${k}}}`).join(String(v));
  }
  const left = out.match(PLACEHOLDER_RE);
  if (left)
    throw new Error(`render-templates: unresolved placeholder(s) in ${contextName}: ${[...new Set(left)].join(', ')}`);
  return out;
}

module.exports = { loadTemplate, block, fill, pad, esc, PLACEHOLDER_RE };
