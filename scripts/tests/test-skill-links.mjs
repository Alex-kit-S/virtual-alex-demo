// @ts-check
// scripts/tests/test-skill-links.mjs - a skill link must keep working when the whole tree moves.
//
// WHAT. Online, .claude/skills/ is committed, so a link's target is text in a git blob, and a target naming
// the tree's own path is dead in every clone at another path: every other owner's. Off Windows a target is
// relative to its link's folder; on Windows it is absolute, because a junction is the only link Windows makes
// without elevation and a Windows link never reaches a repository. Deleted, this file would let a writer go
// back to an absolute POSIX target, or a second writer make links its own way. L1 NEGATIVE the contract
// refuses the old absolute target (the control for L2). L2 the POSIX target is relative, forward-slashed,
// resolves to the store, and survives the tree moving. L3 the win32 target is absolute. L4 a real link
// survives the move (POSIX; SKIPPED on win32). L5 neither bootstrap.mjs nor skills-park.js links on its own.
//
// HOW. L1 to L3 hold targets from scripts/lib/skill-state.js to one contract function; L4 makes a real link
// (a junction on win32, a symlink elsewhere) in a tree under the OS temp folder and moves the tree. Every
// fixture tree is removed in the test's own after() hook, the link or junction it may hold unlinked first so
// removing it can never walk into, or delete, what it points at.
//
// NEVER. Makes or changes a link in this checkout's .claude/skills/, or reaches a network. Leaves an
// `alex-skilllink-*` OS temp folder, or a real link inside one, behind.
//
// Usage: node scripts/tests/test-skill-links.mjs
// Exit: 0 every leg passes - 1 any leg fails

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const skillState = require('../lib/skill-state.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Removes every real link or junction under a fixture tree before the tree itself is removed, so a
 * recursive delete can never follow one into, or delete the content of, whatever it points at.
 * @param {string} dir
 */
function unlinkAll(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) {
      fs.unlinkSync(full);
      continue;
    }
    if (e.isDirectory()) unlinkAll(full);
  }
}
/**
 * A tree shaped like the Kit, content in .agents/skills and links in .claude/skills; removed, links first,
 * when the test ends.
 * @param {import('node:test').TestContext} t
 * @returns {string} its root
 */
function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-skilllink-'));
  t.after(() => {
    unlinkAll(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), 'demo skill\n');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  return root;
}
/** @param {string} t */
const isRelative = (t) => !path.isAbsolute(t) && !/^[a-zA-Z]:/.test(t);

/**
 * THE CONTRACT a committed POSIX target must meet, as one function, because a check that never said NO proves
 * nothing about a YES. Resolved from where the link sits after the tree moves, it must land in the moved store.
 * @param {string} target
 * @param {string} root
 * @param {string} linkDir
 * @param {string} storeDir
 * @param {string} name
 */
function contractProblems(target, root, linkDir, storeDir, name) {
  const problems = [];
  if (!isRelative(target)) problems.push('absolute');
  if (target.includes('\\')) problems.push('backslashed');
  if (path.resolve(linkDir, target) !== path.resolve(storeDir, name)) problems.push('does not resolve to the store');
  const moved = `${root}-moved-to-another-owner`;
  const inMoved = (/** @type {string} */ p) => moved + p.slice(root.length);
  if (path.resolve(inMoved(linkDir), target) !== path.resolve(inMoved(storeDir), name))
    problems.push('dies when the tree moves');
  return problems;
}

describe('a skill link keeps working when the whole tree moves', () => {
  test('L1 NEGATIVE the contract refuses the old target: absolute, and dead once the tree moves', (t) => {
    const root = tree(t);
    const linkDir = path.join(root, '.claude', 'skills');
    const storeDir = path.join(root, '.agents', 'skills');
    const old = path.join(storeDir, 'demo');
    const problems = contractProblems(old, root, linkDir, storeDir, 'demo');
    assert.ok(problems.includes('absolute'), problems.join(', ') || 'accepted');
    assert.ok(problems.includes('dies when the tree moves'), problems.join(', ') || 'accepted');
  });

  test('L2 POSIX target meets the contract L1 shows refusing (relative, forward-slashed, resolves, survives a move)', (t) => {
    const root = tree(t);
    const linkDir = path.join(root, '.claude', 'skills');
    const storeDir = path.join(root, '.agents', 'skills');
    const target = skillState.skillLinkTarget(linkDir, storeDir, 'demo', 'linux');
    const problems = contractProblems(target, root, linkDir, storeDir, 'demo');
    assert.deepEqual(problems, [], `${target} - ${problems.join(', ')}`);
    assert.equal(target, '../../.agents/skills/demo');
  });

  test('L3 win32 target is absolute (a junction cannot be relative)', (t) => {
    const root = tree(t);
    const linkDir = path.join(root, '.claude', 'skills');
    const storeDir = path.join(root, '.agents', 'skills');
    const target = skillState.skillLinkTarget(linkDir, storeDir, 'demo', 'win32');
    assert.ok(!isRelative(target), target);
  });

  test('L4 a moved tree keeps working links', {
    skip:
      process.platform === 'win32' &&
      'Windows cannot create a relative symlink without Developer Mode (EPERM) and normalises a junction to an absolute path; the macOS CI runner covers this leg'
  }, (t) => {
    const root = tree(t);
    const linkDir = path.join(root, '.claude', 'skills');
    const storeDir = path.join(root, '.agents', 'skills');
    skillState.linkSkill(linkDir, storeDir, 'demo');
    assert.equal(
      fs.readFileSync(path.join(linkDir, 'demo', 'SKILL.md'), 'utf8').trim(),
      'demo skill',
      'the link resolves where it was made'
    );
    const moved = `${root}-moved-to-another-owner`;
    fs.renameSync(root, moved);
    t.after(() => {
      unlinkAll(moved);
      fs.rmSync(moved, { recursive: true, force: true });
    });
    let readable = false;
    try {
      readable =
        fs.readFileSync(path.join(moved, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8').trim() === 'demo skill';
    } catch {
      readable = false;
    }
    assert.ok(readable, 'the link still resolves after the whole tree moved to a different path');
  });

  test('L5 DRIFT: neither bootstrap.mjs nor skills-park.js makes a skill link of its own', () => {
    for (const rel of ['scripts/bootstrap.mjs', 'scripts/skills-park.js']) {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      const raw = src.split(/\r?\n/).filter((l) => /fs\.symlinkSync\s*\(/.test(l) && !/^\s*[*/]/.test(l));
      assert.deepEqual(raw, [], `${rel} still calls fs.symlinkSync: ${raw.map((l) => l.trim()).join(' | ')}`);
    }
  });
});
