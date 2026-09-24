'use strict';
/* h-skills - facts from skills-lock.json: the installed-skill reproducibility baseline.
 * Emits the skill COUNT + lock version + rebaseline date. Per-skill hashes are deliberately NOT
 * mirrored here: recovery check S7 already recomputes every installed hash against this lock, so
 * copying 82 hash rows nightly would add pure supersession churn (and risk the mass-drift tripwire on
 * a legitimate marketing-pack-sized install) for a fact nothing downstream reads. Count is the fact
 * a doc can drift on ("31 skills" vs 82). */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'skills-lock.json');
  if (!fs.existsSync(src)) return [];
  const lock = JSON.parse(fs.readFileSync(src, 'utf8'));
  const facts = [];
  const push = (predicate, object) =>
    facts.push({ subject: 'skills', predicate, object, source: 'skills-lock.json', harvester: 'h-skills', aliases: ['skill', 'skills', 'skills-lock'] });
  const count = lock.skills ? Object.keys(lock.skills).length : 0;
  push('count', String(count));
  if (lock.version != null) push('lock_version', String(lock.version));
  if (lock.rebaselined) push('rebaselined', String(lock.rebaselined));
  return facts;
}

module.exports = { harvest };
