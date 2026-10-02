// @ts-check
// scripts/tests/test-skills-park.mjs - the real removeLink primitive, round-tripped on a fixture.
//
// WHAT. skills-park.js parks a skill by removing its .claude/skills link (removeLink) and wakes it by
// making the link again (fs.symlinkSync(..., 'junction')). This file proves removeLink itself, imported
// from the real file, not a copy of it; scripts/tests/test-skills-park-cli.mjs runs the whole script.
// Deleted, this file would let a removal that follows a link into its content, or one that deletes a real
// folder where a link should be, go unnoticed:
//   T1  removing the link leaves the content intact
//   T2  a new link reads the content through it
//   T3  NEGATIVE a real folder with content where the link should be makes the removal FAIL, untouched
//
// HOW. One folder under the OS temp folder, made before every test() and removed in an after() hook, holds a
// miniature store and link folder; each leg makes and removes links there in sequence, so T1 through T3 run
// in one describe(), in file order, sharing that one fixture.
//
// NEVER. Touches this checkout's .agents/skills or .claude/skills, or reaches a network. Imports
// skills-park.js in a way that runs its CLI: the file guards main() with errors.js's isMain, so importing
// it here for removeLink alone never parks or wakes a real skill.
//
// Usage: node scripts/tests/test-skills-park.mjs
// Exit: 0 every leg passes - 1 any leg fails

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { removeLink } from '../skills-park.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-park-test-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const STORE = path.join(tmp, '.agents', 'skills');
const LINKS = path.join(tmp, '.claude', 'skills');
const skill = 'fixture-skill';
const target = path.join(STORE, skill);
const link = path.join(LINKS, skill);

before(() => {
  fs.mkdirSync(path.join(STORE, skill), { recursive: true });
  fs.mkdirSync(LINKS, { recursive: true });
  fs.writeFileSync(path.join(STORE, skill, 'SKILL.md'), '# fixture\ncontent survives parking\n');
});

const makeLink = () => fs.symlinkSync(target, link, 'junction');

describe('skills-park.js removeLink: park (remove link) and wake (make link)', () => {
  test('T1 park removes the link and leaves the content intact', () => {
    makeLink();
    assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), 'T0 link works before park: content readable through link');
    removeLink(link);
    assert.equal(fs.existsSync(link), false, 'T1a park removes the link');
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), 'T1b content intact after park');
  });

  test('T2 wake relinks, content readable through the new link', () => {
    makeLink();
    assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), 'wake relinks, content readable through link');
    removeLink(link);
  });

  test('T3 NEGATIVE a squatter real directory makes removal REFUSE, content untouched', () => {
    // If something replaced the link with a REAL directory holding content, "park" must not delete it.
    // removeLink routes a real dir to rmdirSync, which fails ENOTEMPTY - the refusal is the pass.
    fs.mkdirSync(link, { recursive: true });
    fs.writeFileSync(path.join(link, 'SKILL.md'), 'squatter content that must not be destroyed\n');
    assert.throws(
      () => removeLink(link),
      'T3a removal REFUSES a non-empty real directory (guard against destroying replaced links)'
    );
    assert.ok(fs.existsSync(path.join(link, 'SKILL.md')), 'T3b squatter content untouched after refusal');
    fs.rmSync(link, { recursive: true, force: true }); // clean up the squatter
  });
});
