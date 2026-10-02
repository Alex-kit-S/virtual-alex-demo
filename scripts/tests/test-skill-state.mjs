// @ts-check
// scripts/tests/test-skill-state.mjs - the skill resolver's three layers, proven on fixture trees.
//
// WHAT. scripts/lib/skill-state.js is the one answer to which skills are awake on this machine, for
// bootstrap, kit-doctor and skills-park. Deleted, this file would let the resolver ignore a profile's wake
// or park, fail on a skill a template update removed, let a profile or the lock park a MANDATORY skill, or
// drop a one-word MANDATORY skill from the floor, with every other test green:
//   S1  no profile: the lock's defaults verbatim, locale en, no lanes
//   S2  a profile's wake un-parks a lock-parked skill, and its locale and lanes pass through
//   S3  a profile's park parks a lock-awake skill
//   S4  names the lock does not know are warnings, never failures (a template update may remove a skill)
//   S5  NEGATIVE a profile that parks a MANDATORY skill throws, hyphenated or one-word (pptx, pdf)
//   S6  NEGATIVE a lock that parks a MANDATORY skill throws, with no profile to rescue it
//   S7  a one-word MANDATORY name is in the floor, a hyphenated one still is, and prose in the cell is not
//
// HOW. Each leg writes a constitution with MANDATORY rows, a lock and a profile into a fresh folder under
// the OS temp folder, calls the module, and removes the folder in the test's own after() hook.
//
// NEVER. Reads or writes this checkout, or reaches a network.
//
// Usage: node scripts/tests/test-skill-state.mjs
// Exit: 0 every leg passes - 1 any leg fails

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const skillState = require('../lib/skill-state.js');

/**
 * A fresh folder with a constitution holding one MANDATORY row per cell, a lock and, when given, a profile.
 * Removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {{ lockSkills: Record<string, object>, profile?: object, mandatoryRows?: string[] }} spec
 * @returns {string} its root
 */
function fixture(t, { lockSkills, profile, mandatoryRows }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-skillstate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claude = [
    '# fixture constitution',
    '| Task trigger | Skill(s) | Strength |',
    '|---|---|---|',
    ...(mandatoryRows || []).map((cell) => `| some task | ${cell} | MANDATORY |`)
  ].join('\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), claude);
  fs.writeFileSync(path.join(root, 'skills-lock.json'), JSON.stringify({ skills: lockSkills }, null, 2));
  if (profile) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'system', 'install-profile.json'), JSON.stringify(profile, null, 2));
  }
  return root;
}

const LOCK = {
  'frontend-design': {},
  pptx: {},
  pdf: {},
  copywriting: { parked: true },
  ads: { parked: true },
  babysit: {}
};
const MAND_ROWS = ['frontend-design', 'pptx', 'pdf'];

describe('scripts/lib/skill-state.js', () => {
  test('S1 no profile: the lock defaults verbatim, locale en, no lanes', (t) => {
    const root = fixture(t, { lockSkills: LOCK, mandatoryRows: MAND_ROWS });
    const r = skillState.resolve({ root });
    assert.ok(r.awake.has('babysit'));
    assert.ok(r.parked.has('copywriting'));
    assert.ok(r.parked.has('ads'));
    assert.equal(r.locale, 'en');
    assert.equal(Object.keys(r.lanes).length, 0);
  });

  test('S2 a profile wake un-parks a lock-parked skill, and its locale and lanes pass through', (t) => {
    const root = fixture(t, {
      lockSkills: LOCK,
      mandatoryRows: MAND_ROWS,
      profile: { wake: ['copywriting'], park: [], lanes: { marketing: true }, locale: 'tr' }
    });
    const r = skillState.resolve({ root });
    assert.ok(r.awake.has('copywriting'));
    assert.ok(r.parked.has('ads'));
    assert.equal(r.locale, 'tr');
    assert.equal(r.lanes.marketing, true);
  });

  test('S3 a profile park parks a lock-awake skill', (t) => {
    const root = fixture(t, { lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: [], park: ['babysit'] } });
    const r = skillState.resolve({ root });
    assert.ok(r.parked.has('babysit'));
  });

  test('S4 unknown profile names produce warnings, not failures', (t) => {
    const root = fixture(t, {
      lockSkills: LOCK,
      mandatoryRows: MAND_ROWS,
      profile: { wake: ['no-such-skill'], park: ['also-missing'] }
    });
    const r = skillState.resolve({ root });
    assert.equal(r.warnings.length, 2, r.warnings.join(' | '));
  });

  test('S5 NEGATIVE a profile parking a MANDATORY skill throws, hyphenated or one-word (pptx, pdf)', (t) => {
    for (const target of ['frontend-design', 'pptx', 'pdf']) {
      const root = fixture(t, { lockSkills: LOCK, mandatoryRows: MAND_ROWS, profile: { wake: [], park: [target] } });
      assert.throws(() => skillState.resolve({ root }), /MANDATORY/, `parking '${target}'`);
    }
  });

  test('S6 NEGATIVE the lock itself parking a MANDATORY skill throws (template defect, not a preference)', (t) => {
    const badLock = { ...LOCK, pptx: { parked: true } };
    const root = fixture(t, { lockSkills: badLock, mandatoryRows: MAND_ROWS });
    assert.throws(() => skillState.resolve({ root }), /MANDATORY/);
  });

  test('S7 single-word mandatory names are in the floor, hyphenated ones parse, prose is not', (t) => {
    const root = fixture(t, {
      lockSkills: LOCK,
      mandatoryRows: ['pptx', 'skill-creator + skill-development, then babysit']
    });
    const m = skillState.parseMandatory(root);
    assert.ok(m.has('pptx'), 'a single-word MANDATORY name (pptx) is guarded');
    assert.ok(m.has('skill-creator'), 'hyphenated names still parse from a prose-y cell');
    assert.ok(m.has('skill-development'));
    assert.ok(!m.has('then'), 'prose words in the cell are NOT read as skills (known-name filter)');
    assert.ok(m.has('babysit'), 'a known single-word skill named in the cell IS guarded');
  });
});
