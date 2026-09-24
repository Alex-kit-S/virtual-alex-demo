'use strict';
/*
 * scripts/lib/skill-state.js - THE single resolver for which skills are awake on THIS machine.
 * (2026-08-31, macOS port Phase 2: the per-install profile layer.)
 *
 * WHY ONE RESOLVER. Three things need the same answer - bootstrap's link repair, kit-doctor's
 * health verdict, and V17's mandatory-binding guard - and before this file each read the lock
 * directly. The moment per-install overrides exist, three private readings become three chances
 * to disagree, and a doctor that disagrees with the linker reports false problems on a machine
 * whose owner cannot debug them. So: one function, everyone calls it.
 *
 * THE LAYERS, in order:
 *   1. skills-lock.json      - the TEMPLATE default (tracked, same for every install). Its
 *                              `parked: true` rows are the shipped baseline: today that is the
 *                              45-skill marketing pack parked, which is right for the two
 *                              translator installs and wrong for a business install.
 *   2. install-profile.json  - the PER-INSTALL override (system/, gitignored, machine-local).
 *                              `wake[]` un-parks, `park[]` parks. This is how one template
 *                              serves different owners with ZERO tracked-file divergence.
 *   3. the MANDATORY floor   - skills named in MANDATORY rows of the constitution's Skill
 *                              Bindings table are force-awake. A profile that tries to park one
 *                              is a hard ERROR, not a preference: V17 fails the build on the
 *                              same fact, and the resolver refusing early gives the owner a
 *                              message instead of a broken build. The set is PARSED from
 *                              CLAUDE.md (same source V17 reads), never hardcoded here.
 *
 * Contract: resolve({ root }) -> {
 *   awake:    Set<name>   skills that should have a .claude/skills link
 *   parked:   Set<name>   skills that deliberately have none
 *   mandatory:Set<name>   the force-awake floor (from CLAUDE.md)
 *   lanes:    object      profile.lanes ({} when no profile)
 *   locale:   string      profile.locale ('en' default)
 *   warnings: string[]    profile rows naming unknown skills (reported, not fatal)
 * }
 * Throws on: unreadable lock, or a profile that parks a MANDATORY skill.
 */
const fs = require('fs');
const path = require('path');

const PROFILE_REL = path.join('system', 'install-profile.json');

function parseMandatory(root, knownNames) {
  // MANDATORY rows of the constitution's Skill Bindings table, Skill(s) cell. Candidate tokens
  // are validated against the KNOWN skill names (the lock's keys) rather than required to carry
  // a hyphen: the old hyphen-only regex silently dropped `pptx` and `pdf` from the guarded set
  // for two weeks while CLAUDE.md line 315 claimed they were covered (found 2026-08-31 by this
  // resolver's own sabotage test). Filtering by known names is what keeps prose words in the
  // cell ("then", "and") from being read as skills. If CLAUDE.md is unreadable the floor is
  // empty - V17 owns that failure.
  const out = new Set();
  let text;
  try {
    text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  } catch {
    return out;
  }
  let known = knownNames;
  if (!known) {
    try {
      known = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'skills-lock.json'), 'utf8')).skills || {}));
    } catch {
      known = null; // no lock: fall back to hyphenated-only, the shape prose cannot fake
    }
  }
  const rows = text.split(/\r?\n/).filter((l) => /^\|.*\|\s*MANDATORY\s*\|/.test(l));
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    for (const tok of cells[2].match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []) {
      // Keep a token if it is a KNOWN skill name OR carries the hyphenated skill shape. The
      // union matters: filtering by known names alone would let a MANDATORY row naming an
      // un-vendored hyphenated skill silently drop out of the floor, which is precisely the
      // dead-end V17 exists to fail on. (Found by this suite's own S7b.)
      if ((known && known.has(tok)) || /-/.test(tok)) out.add(tok);
    }
  }
  return out;
}

function readProfile(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, PROFILE_REL), 'utf8'));
  } catch {
    return null; // no profile = pure template defaults; every install before 2026-08-31 is here
  }
}

function resolve({ root }) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'skills-lock.json'), 'utf8'));
  const names = Object.keys(lock.skills || {});
  const known = new Set(names);
  const mandatory = parseMandatory(root);
  const warnings = [];

  const parked = new Set(names.filter((n) => lock.skills[n] && lock.skills[n].parked));

  const profile = readProfile(root);
  if (profile) {
    for (const n of profile.wake || []) {
      if (!known.has(n)) {
        warnings.push(`profile wakes unknown skill '${n}' (not in skills-lock.json) - ignored`);
        continue;
      }
      parked.delete(n);
    }
    for (const n of profile.park || []) {
      if (!known.has(n)) {
        warnings.push(`profile parks unknown skill '${n}' (not in skills-lock.json) - ignored`);
        continue;
      }
      if (mandatory.has(n)) {
        throw new Error(
          `install-profile.json tries to park MANDATORY skill '${n}'. ` +
            `MANDATORY bindings (constitution Skill Bindings table) are the floor no profile may ` +
            `go below - V17 fails the build on the same fact. Remove '${n}' from the profile's park list.`
        );
      }
      parked.add(n);
    }
  }

  // The floor applies to the LOCK too: a template default must never park a MANDATORY skill.
  for (const n of mandatory) {
    if (parked.has(n)) {
      throw new Error(
        `skills-lock.json parks MANDATORY skill '${n}' (and no profile woke it). ` +
          `A MANDATORY binding must always resolve; fix the lock, not the callers.`
      );
    }
  }

  const awake = new Set(names.filter((n) => !parked.has(n)));
  return {
    awake,
    parked,
    mandatory,
    lanes: (profile && profile.lanes) || {},
    locale: (profile && profile.locale) || 'en',
    warnings,
  };
}

// ------------------------------------------------------------------------------------------------
// THE LINK WRITER (2026-09-23). Two scripts create a .claude/skills/<name> link - bootstrap's
// --repair-links and skills-park's --wake - and before this function each called fs.symlinkSync
// with its own target expression. Both wrote the target ABSOLUTE, which is invisible on a laptop
// (the links are gitignored there) and fatal online: the online .gitignore deliberately TRACKS
// .claude/skills/, so the target text sits in a committed git blob. A real install on 2026-09-23
// committed 114 links pointing at /home/user/alex-test/.agents/skills/<name>; every one of them is
// dead in any clone whose path differs, which is every other owner, because a seed repo is named
// after the person it belongs to.
//
// So the POSIX target is RELATIVE to the link's own directory (../../.agents/skills/<name>) and
// forward-slashed, which is what a git symlink blob holds.
//
// WINDOWS IS THE EXCEPTION AND CANNOT BE OTHERWISE. A junction is the only link type Windows makes
// without elevation, and Node normalises a junction's target to an absolute path; a plain relative
// symlink raises EPERM on a machine without Developer Mode (measured on this checkout, 2026-09-23).
// That costs nothing, because a Windows checkout has core.symlinks off and gitignores the link
// directory, so an absolute target never leaves the machine that wrote it.
//
// Test: node scripts/tests/test-skill-links.mjs (the absolute target shown failing the contract
// first, then the move test; L5 asserts neither writer keeps a symlinkSync call of its own).
function skillLinkTarget(linkDir, storeDir, name, platform = process.platform) {
  const target = path.join(storeDir, name);
  if (platform === 'win32') return target;
  return path.relative(linkDir, target).split(path.sep).join('/');
}

function linkSkill(linkDir, storeDir, name) {
  const dest = path.join(linkDir, name);
  const target = skillLinkTarget(linkDir, storeDir, name);
  if (process.platform === 'win32') {
    fs.symlinkSync(target, dest, 'junction');
    return dest;
  }
  fs.symlinkSync(target, dest);
  return dest;
}

module.exports = { resolve, readProfile, parseMandatory, skillLinkTarget, linkSkill, PROFILE_REL };
