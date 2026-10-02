// scripts/lib/validate/structure.js - the shared file-reading helpers every validator leg builds on,
// plus G1-G4, the structural guards.
//
// WHAT. scripts/validate-alex.js is a thin entry at that path; this module is the shared file-reading
// layer every leg builds on: REPO (the repository root every leg resolves paths against, from
// scripts/lib/repo-root.js), the staged-vs-repo file reader effective() that every leg but V9's git
// clock, V10 and V11 calls, the small text helpers built on it (listFiles, countOf, mdSection), pad and
// PLACEHOLDER_RE from scripts/lib/render-templates.js, the six marker strings from scripts/lib/markers.js,
// and G1-G4 themselves.
//
// HOW. effective(stagedDir, rel) prefers a file staged for the run about to ship, then falls back to the
// live repo copy at REPO; both return { text, from } or null. RT_BEGIN, RT_END, CZ_START, CZ_END,
// PT_BEGIN and PT_END are markers.js's PAIRS.ROUTING_TABLE, PAIRS.CUSTOM_ZONE and PAIRS.PROJECT_TABLE
// begin/end strings, re-exported here under their long-standing names so nothing on the caller census
// (commit.js, manifest-docs.js) moves; pad and PLACEHOLDER_RE come the same way from render-templates.js.
// structuralGuards runs G1 (no unresolved {{PLACEHOLDER}} left in a staged tree), then G2 (CLAUDE.md's
// routing-table markers), G3 (docs/README.md's custom-zone markers) and G4 (docs/projects/README.md's
// project-table markers) each through markers.js's own locatePair, so this file keeps no second copy of
// the one-pair rule, pushing onto the failures array the caller passes in with every message byte-
// identical to what it always was.
//
// NEVER. Reads the git index (every leg here reads the working tree or the staged preview, never what
// `git commit` would record - V10 and V11 are the two exceptions, and neither lives in this file). Writes
// anything.
//
// Usage: module only - const { effective, structuralGuards, ... } = require('./structure');
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('../repo-root');
const { PAIRS, locatePair } = require('../markers');
const { pad, PLACEHOLDER_RE } = require('../render-templates');

const {
  ROUTING_TABLE: { begin: RT_BEGIN, end: RT_END },
  CUSTOM_ZONE: { begin: CZ_START, end: CZ_END },
  PROJECT_TABLE: { begin: PT_BEGIN, end: PT_END }
} = PAIRS;

function listFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  })(dir);
  return out;
}

// Prefer the staged copy (the version about to ship); fall back to the live repo copy.
function effective(stagedDir, rel) {
  const staged = stagedDir && path.join(stagedDir, rel);
  if (staged && fs.existsSync(staged)) return { text: fs.readFileSync(staged, 'utf8'), from: 'staged' };
  const real = path.join(REPO, rel);
  if (fs.existsSync(real)) return { text: fs.readFileSync(real, 'utf8'), from: 'repo' };
  return null;
}

function countOf(text, marker) {
  return text.split(marker).length - 1;
}

// Slice a "## ..." section (heading line matching headingRe) up to the next "## " heading or EOF.
function mdSection(text, headingRe) {
  const m = text.match(headingRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

// ---------------------------------------------------------------------------------------------
// G1-G4 - structural guards
// ---------------------------------------------------------------------------------------------
function structuralGuards({ stagedDir }, failures) {
  // G1 - no unresolved {{PLACEHOLDER}} in any staged output.
  if (stagedDir && fs.existsSync(stagedDir)) {
    for (const f of listFiles(stagedDir)) {
      const left = fs.readFileSync(f, 'utf8').match(PLACEHOLDER_RE);
      if (left)
        failures.push(
          `FAILED G1: unresolved placeholder(s) ${[...new Set(left)].join(', ')} in staged ${path.relative(stagedDir, f)}`
        );
    }
  }

  // G2 - routing-region markers in CLAUDE.md present and well-formed (exactly one, ordered).
  const claude = effective(stagedDir, 'CLAUDE.md');
  if (!claude) failures.push('FAILED G2: CLAUDE.md not found (staged or repo)');
  else {
    const at = locatePair(claude.text, PAIRS.ROUTING_TABLE);
    if (!at.ok)
      failures.push(
        at.reason === 'count'
          ? `FAILED G2: CLAUDE.md (${claude.from}) must contain exactly one ROUTING-TABLE BEGIN/END pair - found BEGIN=${at.found.begin}, END=${at.found.end}`
          : `FAILED G2: CLAUDE.md (${claude.from}) routing markers out of order (END before BEGIN)`
      );
  }

  // G3 - custom-zone markers in docs/README.md present exactly once, ordered.
  const readme = effective(stagedDir, 'docs/README.md');
  if (!readme)
    failures.push(
      'FAILED G3: docs/README.md not found (staged or repo) - the hand-written welcome block is required (D8)'
    );
  else {
    const at = locatePair(readme.text, PAIRS.CUSTOM_ZONE);
    if (!at.ok)
      failures.push(
        at.reason === 'count'
          ? `FAILED G3: docs/README.md (${readme.from}) must contain exactly one custom zone - found START=${at.found.begin}, END=${at.found.end}`
          : `FAILED G3: docs/README.md (${readme.from}) custom-zone markers out of order`
      );
  }

  // G4 - project-table markers in docs/projects/README.md present exactly once, ordered.
  const proj = effective(stagedDir, 'docs/projects/README.md');
  if (!proj) failures.push('FAILED G4: docs/projects/README.md not found (staged or repo)');
  else {
    const at = locatePair(proj.text, PAIRS.PROJECT_TABLE);
    if (!at.ok)
      failures.push(
        at.reason === 'count'
          ? `FAILED G4: docs/projects/README.md (${proj.from}) must contain exactly one PROJECT-TABLE BEGIN/END pair - found BEGIN=${at.found.begin}, END=${at.found.end}`
          : `FAILED G4: docs/projects/README.md (${proj.from}) project-table markers out of order`
      );
  }
}

module.exports = {
  REPO,
  effective,
  listFiles,
  pad,
  countOf,
  mdSection,
  PLACEHOLDER_RE,
  RT_BEGIN,
  RT_END,
  CZ_START,
  CZ_END,
  PT_BEGIN,
  PT_END,
  structuralGuards
};
