'use strict';
/* h-recovery - facts from work/18-recovery-layer/check.ps1: the recovery checker's own registry.
 * Counts the `# --- C<n>` block headers (the same ground-truth source narrative-drift-check.py uses
 * for C19), so the check count is derived from the CODE, never a prose claim. This row is what C21
 * tests the in-repo work/18 CLAUDE.md "The checks (N total)" header against - the ST-20 "a doc
 * lying about the system" class, mechanized. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'work', '18-recovery-layer', 'check.ps1');
  const txt = fs.readFileSync(src, 'utf8');
  const nums = new Set();
  for (const m of txt.matchAll(/^\s*#\s*---\s*C(\d+)\b/gm)) nums.add(parseInt(m[1], 10));
  const facts = [];
  const push = (predicate, object) =>
    facts.push({ subject: 'recovery-checker', predicate, object, source: 'work/18-recovery-layer/check.ps1', harvester: 'h-recovery', aliases: ['recovery', 'checker', 'checks', 'drift'] });
  push('check_count', String(nums.size));
  if (nums.size) push('check_max', String(Math.max(...nums)));
  return facts;
}

module.exports = { harvest };
