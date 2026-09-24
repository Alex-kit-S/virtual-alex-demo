#!/usr/bin/env node
// scripts/tests/test-skill-state.mjs - the per-install profile resolver, proven on fixtures.
// (2026-08-31, macOS port Phase 2.8.)
//
// The resolver (scripts/lib/skill-state.js) is the ONE answer to "which skills are awake on this
// machine" - bootstrap, kit-doctor and V17 all call it. These tests pin its contract:
//   S1  no profile             -> lock defaults verbatim
//   S2  profile wake           -> un-parks a lock-parked skill
//   S3  profile park           -> parks a lock-awake skill
//   S4  unknown names          -> warning, never fatal (a template update may remove a skill)
//   S5  NEGATIVE profile parks a MANDATORY skill -> throws
//   S6  NEGATIVE lock parks a MANDATORY skill (no profile rescue) -> throws
//   S7  REGRESSION: single-word MANDATORY names (pptx, pdf) are IN the floor. The old
//       hyphen-requiring token regex silently unguarded them for two weeks while the
//       constitution claimed coverage - found by this suite's S5 running against pptx.
//
// Exit 0 = all pass, 1 = any failure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const skillState = require('../lib/skill-state.js');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

// --- fixture builder --------------------------------------------------------------------------
function fixture({ lockSkills, profile, mandatoryRows }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-skillstate-'));
  const claude = [
    '# fixture constitution',
    '| Task trigger | Skill(s) | Strength |',
    '|---|---|---|',
    ...(mandatoryRows || []).map((cell) => `| some task | ${cell} | MANDATORY |`),
  ].join('\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), claude);
  fs.writeFileSync(path.join(root, 'skills-lock.json'), JSON.stringify({ skills: lockSkills }, null, 2));
  if (profile) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'system', 'install-profile.json'), JSON.stringify(profile, null, 2));
  }
  return root;
}
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

const LOCK = {
  'frontend-design': {},
  pptx: {},
  pdf: {},
  copywriting: { parked: true },
  ads: { parked: true },
  babysit: {},
};
const MAND_ROWS = ['frontend-design', 'pptx', 'pdf'];

// --- S1: no profile ---------------------------------------------------------------------------
{
  const root = fixture({ lockSkills: LOCK, mandatoryRows: MAND_ROWS });
  const r = skillState.resolve({ root });
  ok(r.awake.has('babysit') && r.parked.has('copywriting') && r.parked.has('ads'), 'S1 lock defaults verbatim without a profile');
  ok(r.locale === 'en' && Object.keys(r.lanes).length === 0, 'S1b default locale/lanes');
  cleanup(root);
}

// --- S2: profile wake -------------------------------------------------------------------------
{
  const root = fixture({ lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: ['copywriting'], park: [], lanes: { marketing: true }, locale: 'tr' } });
  const r = skillState.resolve({ root });
  ok(r.awake.has('copywriting') && r.parked.has('ads'), 'S2 profile wake un-parks a lock-parked skill');
  ok(r.locale === 'tr' && r.lanes.marketing === true, 'S2b locale + lanes pass through');
  cleanup(root);
}

// --- S3: profile park -------------------------------------------------------------------------
{
  const root = fixture({ lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: [], park: ['babysit'] } });
  const r = skillState.resolve({ root });
  ok(r.parked.has('babysit'), 'S3 profile park parks a lock-awake skill');
  cleanup(root);
}

// --- S4: unknown names warn, never throw ------------------------------------------------------
{
  const root = fixture({ lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: ['no-such-skill'], park: ['also-missing'] } });
  const r = skillState.resolve({ root });
  ok(r.warnings.length === 2, 'S4 unknown profile names produce warnings, not failures', r.warnings.join(' | '));
  cleanup(root);
}

// --- S5 NEGATIVE: profile parks a MANDATORY skill -> throws ----------------------------------
for (const target of ['frontend-design', 'pptx', 'pdf']) {
  const root = fixture({ lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: [], park: [target] } });
  let threw = false;
  try {
    skillState.resolve({ root });
  } catch (e) {
    threw = /MANDATORY/.test(e.message);
  }
  ok(threw, `S5 profile parking MANDATORY '${target}' throws`, target === 'pptx' || target === 'pdf' ? 'the single-word regression case' : '');
  cleanup(root);
}

// --- S6 NEGATIVE: lock itself parks a MANDATORY skill -> throws ------------------------------
{
  const badLock = { ...LOCK, pptx: { parked: true } };
  const root = fixture({ lockSkills: badLock, mandatoryRows: MAND_ROWS });
  let threw = false;
  try {
    skillState.resolve({ root });
  } catch (e) {
    threw = /MANDATORY/.test(e.message);
  }
  ok(threw, 'S6 lock parking a MANDATORY skill throws (template defect, not a preference)');
  cleanup(root);
}

// --- S7 REGRESSION: single-word mandatory names are in the floor ------------------------------
{
  const root = fixture({ lockSkills: LOCK, mandatoryRows: ['pptx', 'skill-creator + skill-development, then babysit'] });
  const m = skillState.parseMandatory(root);
  ok(m.has('pptx'), 'S7a single-word MANDATORY name (pptx) is guarded');
  ok(m.has('skill-creator') && m.has('skill-development'), 'S7b hyphenated names still parse from a prose-y cell');
  ok(!m.has('then'), 'S7c prose words in the cell are NOT read as skills (known-name filter)');
  ok(m.has('babysit'), 'S7d a known single-word skill named in the cell IS guarded');
  cleanup(root);
}

// --- verdict ----------------------------------------------------------------------------------
console.log('');
if (failures === 0) {
  console.log('test-skill-state: ALL PASS');
  process.exit(0);
} else {
  console.log(`test-skill-state: ${failures} FAILURE(S)`);
  process.exit(1);
}
