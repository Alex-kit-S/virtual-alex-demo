'use strict';
/* h-validators - facts from scripts/validate-alex.js: the generator's validator suite.
 * Parses a structured DECLARATION, never prose and never a printed string (the V6 lesson
 * generalized). Since 2026-07-25 (stress-test F-10) validate-alex.js declares its suite size once as
 * `const V_MAX = <n>` and every consumer derives from it; the old `V1-V<n> PASS` console line is kept
 * as a fallback so this harvester still works against an older checkout. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'scripts', 'validate-alex.js');
  const txt = fs.readFileSync(src, 'utf8');
  const facts = [];
  const push = (subject, predicate, object, aliases = []) =>
    facts.push({ subject, predicate, object, source: 'scripts/validate-alex.js', harvester: 'h-validators', aliases });

  const m = txt.match(/^const V_MAX\s*=\s*(\d+)\s*;/m) || txt.match(/V1-V(\d+)\s+PASS/);
  if (m) {
    const n = parseInt(m[1], 10);
    push('validator-suite', 'v_count', String(n), ['validator', 'validators', 'validate', 'generator']);
    push('validator-suite', 'suite_range', `V1-V${n}`, ['validator', 'validators']);
  }
  const g = txt.match(/G1-G(\d+)/);
  if (g) push('validator-suite', 'g_count', String(parseInt(g[1], 10)), ['validator']);
  return facts;
}

module.exports = { harvest };
