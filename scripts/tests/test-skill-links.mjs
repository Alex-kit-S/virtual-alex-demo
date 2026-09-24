#!/usr/bin/env node
// scripts/tests/test-skill-links.mjs - a skill link must survive the tree moving.
// (2026-09-23, Virtual Alex fleet seat 1, open-list item "absolute skill links".)
//
// WHY. Online the owner's repo IS the machine, and the online .gitignore deliberately TRACKS
// .claude/skills/. So the link's target text is stored in a committed git blob. On 2026-09-23 a
// real install wrote them absolute (/home/user/alex-test/.agents/skills/<name>): every one of them
// breaks in any clone whose path differs, which is every other owner, because a seed repo is named
// after its owner. The target must be relative to the link's own directory.
//
// Windows is the one exception and cannot be otherwise. A junction is the only link type Windows
// makes without elevation, and Node normalises a junction's target to an absolute path; a plain
// relative symlink raises EPERM on a machine without Developer Mode (measured on this checkout).
// Windows links never reach a repository (.claude/skills/ is gitignored on a laptop install and
// core.symlinks is off there), so an absolute target never leaves the machine that wrote it.
//
// WHAT. A skill link's target is relative to its own directory on POSIX, and these legs prove it:
//   L1  NEGATIVE the contract refuses the old absolute target (the negative control for L2)
//   L2  the POSIX target meets the same contract: relative, forward-slashed, resolves back to the
//       store, and still resolves after the whole tree moves
//   L3  the win32 target is absolute, by the constraint above
//   L4  a real link survives the tree being moved (POSIX only; SKIPPED with the reason on win32)
//   L5  DRIFT no skill-link writer calls fs.symlinkSync itself; they all go through the helper
//
// HOW. L4 makes real links in a tree under the OS temp directory and moves it; L5 reads the sources.
//   node scripts/tests/test-skill-links.mjs      (exit 0 = all pass, 1 = any failure)
//
// NEVER. Never makes or changes a link in this checkout's .claude/skills/.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const skillState = require('../lib/skill-state.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};
const skip = (name, why) => console.log(`SKIP  ${name} - ${why}`);

// A tree shaped like the Kit: content in .agents/skills, links in .claude/skills.
function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-skilllink-'));
  fs.mkdirSync(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), 'demo skill\n');
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  return root;
}
const isRelative = (t) => !path.isAbsolute(t) && !/^[a-zA-Z]:/.test(t);

// THE CONTRACT a committed POSIX link target must meet, as one function, because L2 applies it to
// the new target and a check that has never said NO proves nothing about a YES. The last clause is
// the one that matters online: resolve the target from where the link would sit AFTER the whole
// tree moves (a clone under another owner's name), and it must land in the moved store, not the old.
function contractProblems(target, root, linkDir, storeDir, name) {
  const problems = [];
  if (!isRelative(target)) problems.push('absolute');
  if (target.includes('\\')) problems.push('backslashed');
  if (path.resolve(linkDir, target) !== path.resolve(storeDir, name)) problems.push('does not resolve to the store');
  const moved = `${root}-moved-to-another-owner`;
  const inMoved = (p) => moved + p.slice(root.length);
  if (path.resolve(inMoved(linkDir), target) !== path.resolve(inMoved(storeDir), name)) problems.push('dies when the tree moves');
  return problems;
}

// --- L1 NEGATIVE: the contract refuses the shape that shipped ---------------------------------
// Fed the exact expression bootstrap.mjs and skills-park.js used before this fix. Until 2026-09-24
// L1 asserted that path.join(<an absolute root>, ...) is absolute, which no code change can make
// false (fleet review F24), so it could never fail. Now it is the negative control for L2: if the
// contract ever stops refusing an absolute, tree-bound target, L1 fails and L2's PASS means nothing.
{
  const root = tree();
  const linkDir = path.join(root, '.claude', 'skills');
  const storeDir = path.join(root, '.agents', 'skills');
  const old = path.join(storeDir, 'demo');
  const problems = contractProblems(old, root, linkDir, storeDir, 'demo');
  ok(problems.includes('absolute') && problems.includes('dies when the tree moves'),
    'L1 NEGATIVE the contract refuses the old target: absolute, and dead once the tree moves', problems.join(', ') || 'accepted');
}

// --- L2 the POSIX target ----------------------------------------------------------------------
{
  const root = tree();
  const linkDir = path.join(root, '.claude', 'skills');
  const storeDir = path.join(root, '.agents', 'skills');
  const t = skillState.skillLinkTarget(linkDir, storeDir, 'demo', 'linux');
  const problems = contractProblems(t, root, linkDir, storeDir, 'demo');
  ok(problems.length === 0, 'L2 POSIX target meets the contract L1 shows refusing (relative, forward-slashed, resolves, survives a move)', `${t}${problems.length ? ` - ${problems.join(', ')}` : ''}`);
  ok(t === '../../.agents/skills/demo', 'L2 POSIX target is the expected relative path', t);
}

// --- L3 the win32 target ----------------------------------------------------------------------
{
  const root = tree();
  const linkDir = path.join(root, '.claude', 'skills');
  const storeDir = path.join(root, '.agents', 'skills');
  const t = skillState.skillLinkTarget(linkDir, storeDir, 'demo', 'win32');
  ok(!isRelative(t), 'L3 win32 target is absolute (a junction cannot be relative)', t);
}

// --- L4 a real link survives the move ---------------------------------------------------------
if (process.platform === 'win32') {
  skip('L4 a moved tree keeps working links',
    'Windows cannot create a relative symlink without Developer Mode (EPERM) and normalises a junction to an absolute path; the macOS CI runner covers this leg');
} else {
  const root = tree();
  const linkDir = path.join(root, '.claude', 'skills');
  const storeDir = path.join(root, '.agents', 'skills');
  skillState.linkSkill(linkDir, storeDir, 'demo');
  ok(fs.readFileSync(path.join(linkDir, 'demo', 'SKILL.md'), 'utf8').trim() === 'demo skill',
    'L4 the link resolves where it was made');
  const moved = `${root}-moved-to-another-owner`;
  fs.renameSync(root, moved);
  let readable = false;
  try {
    readable = fs.readFileSync(path.join(moved, '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8').trim() === 'demo skill';
  } catch (e) {
    readable = false;
  }
  ok(readable, 'L4 the link still resolves after the whole tree moved to a different path');
}

// --- L5 DRIFT: one writer -----------------------------------------------------------------
// Two scripts create these links (bootstrap --repair-links and skills-park --wake). The plan named
// only the first. A second writer that keeps its own symlinkSync call is how this defect comes
// back, so the rule is checked against the source rather than trusted.
{
  const writers = ['scripts/bootstrap.mjs', 'scripts/skills-park.js'];
  for (const rel of writers) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    const raw = src.split(/\r?\n/).filter((l) => /fs\.symlinkSync\s*\(/.test(l) && !/^\s*[*/]/.test(l));
    ok(raw.length === 0,
      `L5 ${rel} creates no skill link of its own`,
      raw.length ? `still calls fs.symlinkSync: ${raw.map((l) => l.trim()).join(' | ')}` : 'goes through skillState.linkSkill');
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
