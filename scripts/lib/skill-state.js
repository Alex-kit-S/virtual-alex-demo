// @ts-check
// scripts/lib/skill-state.js - which skills are awake on this machine, and the one writer of a skill link.
//
// WHAT. One template serves owners who want different skills, so "which skills are awake here" has an
// answer in three layers, and every consumer must get the same one: bootstrap's link repair, kit-doctor's
// health report, skills-park and the seed check all call resolve() instead of reading the files
// themselves, so the doctor can never disagree with the linker on a machine whose owner cannot debug
// either. The two scripts that make a .claude/skills link both make it through linkSkill().
//
// HOW. resolve({ root }) reads the layers in order. 1: <root>/skills-lock.json, the template default every
// install shares; a row with `parked: true` gets no link. 2: <root>/system/install-profile.json, this
// machine's own choices; wake[] un-parks a skill the lock parks, park[] parks one it leaves awake, and a
// name the lock does not know is a warning, never fatal, because a template update may remove a skill.
// 3: the MANDATORY floor, the skills named in a MANDATORY row of <root>/CLAUDE.md's Skill Bindings table,
// parsed here and never hardcoded. A profile or a lock that parks one is refused by name: validate-alex.js
// V17 fails the build on the same fact, and refusing first gives the owner a message instead. A token in
// a MANDATORY cell counts when the lock knows the name or the name is hyphenated, so prose in the cell
// ("then", "and") is never read as a skill while a one-word skill (pdf) and a hyphenated one the lock
// lacks both stay in the floor. V17 keeps its own copy of this parse.
// linkSkill makes <linkDir>/<name> point at <storeDir>/<name>: a junction with an absolute target on
// Windows, a symlink with a relative, forward-slashed target everywhere else (skillLinkTarget).
//
// NEVER. Writes anything but the link linkSkill makes. Gives a link an absolute target off Windows:
// online the link folder is committed, so an absolute target is dead in every clone at another path,
// which is every other owner's. Gives one a relative target on Windows: a junction is the only link
// Windows makes without elevation, a relative symlink raises EPERM without Developer Mode, and a Windows
// link never leaves its machine (the folder is gitignored and core.symlinks is off there). Tells a
// profile that does not parse, a byte-order mark included, from an absent one, or checks that wake and
// park are lists: scripts/tests/test-install-profile-readers.mjs pins both as they are (R6-7, R6-26)
// until their fix wave. Requires anything but Node's own modules and json-writer.js's readJsonHeaderless,
// because the rest of this tree's tests copy this file into a temp tree with only named siblings beside it.
//
// Usage: module only
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonHeaderless } = require('./json-writer');

// Native separators: skills-park.js joins it onto the repository root, and a test compares it that way.
const PROFILE_REL = path.join('system', 'install-profile.json');
const LOCK_NAME = 'skills-lock.json';
const CONSTITUTION = 'CLAUDE.md';
// A Skill Bindings row whose Strength cell, any cell after the first, reads MANDATORY.
const MANDATORY_ROW = /^\|.*\|\s*MANDATORY\s*\|/;
// A candidate skill name inside the Skill(s) cell: lowercase words joined by hyphens.
const NAME_TOKEN = /[a-z0-9]+(?:-[a-z0-9]+)*/g;
// The Skill(s) cell of a row split on '|': the text before the first pipe is cell 0.
const SKILLS_CELL = 2;

/**
 * @typedef {object} SkillState
 * @property {Set<string>} awake the skills that should have a .claude/skills link
 * @property {Set<string>} parked the skills that deliberately have none
 * @property {Set<string>} mandatory the force-awake floor, from CLAUDE.md
 * @property {Record<string, unknown>} lanes the profile's lanes, {} with no profile
 * @property {string} locale the profile's locale, 'en' with no profile
 * @property {string[]} warnings profile names the lock does not know
 */

/**
 * The MANDATORY floor: every skill named in a MANDATORY row of <root>/CLAUDE.md. An unreadable
 * constitution gives an empty floor, because V17 owns that failure. With no knownNames the lock's skill
 * names are read here, and with no readable lock only hyphenated names count, the shape prose cannot fake.
 * @param {string} root the repository root
 * @param {Set<string> | null} [knownNames] the lock's skill names, when the caller has already read them
 * @returns {Set<string>}
 */
function parseMandatory(root, knownNames) {
  /** @type {Set<string>} */
  const out = new Set();
  let text;
  try {
    text = fs.readFileSync(path.join(root, CONSTITUTION), 'utf8');
  } catch {
    return out;
  }
  let known = knownNames;
  if (!known) {
    try {
      known = new Set(Object.keys(readJsonHeaderless(path.join(root, LOCK_NAME)).skills || {}));
    } catch {
      known = null;
    }
  }
  const rows = text.split(/\r?\n/).filter((l) => MANDATORY_ROW.test(l));
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    for (const tok of cells[SKILLS_CELL].match(NAME_TOKEN) || []) {
      if (known?.has(tok) || /-/.test(tok)) out.add(tok);
    }
  }
  return out;
}

/**
 * This machine's profile as parsed JSON, or null when it is absent or cannot be read or parsed.
 * @param {string} root the repository root
 * @returns {any}
 */
function readProfile(root) {
  return readJsonHeaderless(path.join(root, PROFILE_REL), { ifUnreadable: null });
}

/**
 * Which skills are awake and which parked here: the lock, then this machine's profile, then the
 * MANDATORY floor. Throws the raw read or parse error on an unreadable lock, and an Error naming the
 * skill when the profile or the lock parks a MANDATORY one.
 * @param {{ root: string }} options the repository root
 * @returns {SkillState}
 */
function resolve({ root }) {
  const lock = readJsonHeaderless(path.join(root, LOCK_NAME));
  const names = Object.keys(lock.skills || {});
  const known = new Set(names);
  const mandatory = parseMandatory(root, known);
  /** @type {string[]} */
  const warnings = [];

  const parked = new Set(names.filter((n) => lock.skills[n]?.parked));

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

  // The floor holds for the template too: a lock default must never park a MANDATORY skill.
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
    lanes: profile?.lanes || {},
    locale: profile?.locale || 'en',
    warnings
  };
}

/**
 * The target a link at <linkDir>/<name> gets: <storeDir>/<name>, absolute on Windows, relative to the
 * link's own folder and forward-slashed everywhere else, which is what a committed git symlink holds.
 * @param {string} linkDir the .claude/skills folder
 * @param {string} storeDir the .agents/skills folder
 * @param {string} name the skill
 * @param {string} [platform] process.platform unless a test names another
 * @returns {string}
 */
function skillLinkTarget(linkDir, storeDir, name, platform = process.platform) {
  const target = path.join(storeDir, name);
  if (platform === 'win32') return target;
  return path.relative(linkDir, target).split(path.sep).join('/');
}

/**
 * Make the link <linkDir>/<name> to the skill's content: a junction on Windows, a symlink elsewhere.
 * An existing link or folder at that path throws EEXIST, which is the caller's to handle.
 * Test: node scripts/tests/test-skill-links.mjs
 * @param {string} linkDir the .claude/skills folder
 * @param {string} storeDir the .agents/skills folder
 * @param {string} name the skill
 * @returns {string} the link's path
 */
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
