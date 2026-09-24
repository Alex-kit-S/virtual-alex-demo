// render-templates.js - fills templates/*.template.md (refactor P1-S3, amendment A4).
// ALL generated-document prose lives in the templates; this module only loads, slices named
// BLOCKs, and substitutes {{PLACEHOLDER}} slots. It fails loudly on a missing template, a missing
// block, or ANY unresolved placeholder left after substitution (uppercase {{A-Z0-9_}} syntax).
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const TEMPLATES = path.join(REPO, 'templates');
const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g; // the shared unresolved-slot contract (validator uses it too)

function loadTemplate(name) {
  const p = path.join(TEMPLATES, `${name}.template.md`);
  if (!fs.existsSync(p)) throw new Error(`render-templates: missing template ${path.relative(REPO, p)}`);
  return fs.readFileSync(p, 'utf8');
}

// Extract a named block: from its "<!-- BLOCK:NAME -->" line to the next BLOCK marker (or EOF).
// Templates without BLOCK markers are used whole (pass no blockName).
function block(templateText, blockName) {
  const re = new RegExp(`<!-- BLOCK:${blockName} -->\\r?\\n([\\s\\S]*?)(?=<!-- BLOCK:|$)`);
  const m = templateText.match(re);
  if (!m) throw new Error(`render-templates: block ${blockName} not found`);
  return m[1].replace(/\s+$/, '') + '\n';
}

// Substitute every {{KEY}} from the map, then fail on anything left unresolved.
function fill(text, map, contextName) {
  let out = text;
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || v === null) throw new Error(`render-templates: ${contextName}: value for {{${k}}} is ${v}`);
    out = out.split(`{{${k}}}`).join(String(v));
  }
  const left = out.match(PLACEHOLDER_RE);
  if (left) throw new Error(`render-templates: unresolved placeholder(s) in ${contextName}: ${[...new Set(left)].join(', ')}`);
  return out;
}

module.exports = { loadTemplate, block, fill, PLACEHOLDER_RE };
