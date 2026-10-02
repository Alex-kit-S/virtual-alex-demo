#!/usr/bin/env node
// @ts-check
// scripts/skills-park.js - park or wake a skill on this machine, or list which skills are awake.
//
// WHAT. Parking a skill the owner does not use stops Claude Code loading it; waking it brings it back.
// Nothing is uninstalled either way, so undoing a park is always one command.
//
// HOW. Park removes only the .claude/skills/<name> link, the layer Claude Code finds skills through; wake
// makes it again through skill-state.js linkSkill, the one link writer. The choice is recorded in this
// machine's system/install-profile.json by default (park[] and wake[]; gitignored, so an update never
// conflicts with it), read through skill-state.js readProfile and written through install-profile.js
// writeProfile; a machine with no profile yet starts from the template's defaults. With --lock it goes
// into the tracked skills-lock.json instead (`parked: true` and `parkedAt` on the row), which changes the
// default of every install: template development only. A park or wake holds the shared write lock
// (lib/write-lock.js, label skills-park), skips by name a MANDATORY-bound skill, a name the lock lacks and
// a name with no content, then reads the answer back through skill-state.js resolve: a parked name has no
// link, intact content and resolves parked; a woken one has a live link and resolves awake. --list, or no
// argument, reads without the lock: the counts, the parked names, the resolver's warnings and every awake
// skill whose link is dead. scripts/lib/args.js's parseCommandLine runs the whole parse, on the operator
// edge (this CLI has no hook, Routine or launcher caller): --park and --wake read a name or a comma list
// as their string value, --list and --lock take none. main() runs only when this file is the one node
// started (errors.js's isMain), and removeLink is exported for its own test.
//
// NEVER. Overwrites a profile it cannot read. A system/install-profile.json that is there but does not
// parse, a byte-order mark included, stops the park or wake before anything changes, because rewriting it
// from defaults would erase every choice it holds, the employer guard's settings among them. Touches
// .agents/skills/. Removes a real folder where a link should be: rmdir refuses one that holds anything.
// Calls fs.symlinkSync itself. Reads, holds or writes anything on a bad command line: an unknown flag, a
// flag where a name belongs, or a missing name each refuse first, exit 1. Knowingly keeps R8-15's other
// two symptoms, still pinned by scripts/tests/test-skills-park-cli.mjs: a dangling link fails the wake on
// EEXIST instead of being replaced, and a --lock wake fails its read-back while this machine's profile
// still parks the skill. Catches a thrown --list: main() returns it uncaught, so a broken list crashes raw
// (an unhandled rejection with a stack) instead of the `skills-park FAILED:` line park and wake print.
// Refuses a hand-written string `park` or `wake` in the profile: R6-26's letter-by-letter read makes the
// write back a shredded list, exit 0, silently erasing whatever the owner hand-wrote there.
//
// Usage: node scripts/skills-park.js --park <name>[,<name>...] [--lock]
//        node scripts/skills-park.js --wake <name>[,<name>...] [--lock]
//        node scripts/skills-park.js [--list]
// Exit: 0 done, names skipped with their reason included - 1 a usage error, an unreadable lock or profile,
// a link it cannot make or remove, or a failed read-back - 2 the write lock is busy, and nothing changed
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const skillState = require('./lib/skill-state');
const installProfile = require('./lib/install-profile');
const { readJsonHeaderless } = require('./lib/json-writer');
const writeLock = require('./lib/write-lock');
const { REPO } = require('./lib/repo-root');
const { parseCommandLine } = require('./lib/args');
const { Refusal, isMain } = require('./lib/errors');

const SKILLS_LOCK = path.join(REPO, 'skills-lock.json');
const LINKS = path.join(REPO, '.claude', 'skills');
const STORE = path.join(REPO, '.agents', 'skills');
const PROFILE = path.join(REPO, skillState.PROFILE_REL);
const USAGE = 'usage: skills-park --park a,b | --wake a,b | --list';
const UNREADABLE_PROFILE =
  'system/install-profile.json is there but does not parse as JSON (a byte-order mark, a syntax error, or not a ' +
  'file), so writing this change would replace every setting it holds with defaults. Nothing was changed: fix ' +
  'the file, then run skills-park again.';

/** @typedef {{ parked?: boolean, parkedAt?: string }} LockRow */
/** @typedef {{ skills: Record<string, LockRow> }} SkillsLock */

/** @returns {SkillsLock} the tracked skills-lock.json; a missing or broken one throws fs's or JSON's error */
function readSkillsLock() {
  return readJsonHeaderless(SKILLS_LOCK);
}

/** @param {SkillsLock} lock */
function writeSkillsLock(lock) {
  fs.writeFileSync(SKILLS_LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

/**
 * This machine's profile through skill-state.js readProfile, or a new one when there is none yet. A
 * profile that is there and cannot be read is refused, never replaced with the defaults.
 * @returns {any} what the file holds, as parsed
 */
function readProfileFile() {
  const profile = skillState.readProfile(REPO);
  if (profile !== null) return profile;
  if (fs.existsSync(PROFILE)) throw new Error(UNREADABLE_PROFILE);
  return { wake: [], park: [], lanes: {}, locale: 'en' };
}

/** @param {object} p the profile to write */
// contract: read as text by scripts/tests/test-install-profile.mjs:154. This function calls installProfile.writeProfile and never serialises the profile itself.
// biome-ignore format: the reader slices this function by regex, from its name to the first closing brace at column 0
function writeProfileFile(p) {
  installProfile.writeProfile(REPO, p);
}

/**
 * Remove a skill link and never the content it points at. lstat sees the link itself, and Node reports a
 * Windows junction as a symbolic link as well, so every link is unlinked. Anything else at the path goes
 * to rmdir, which refuses a folder that holds anything: something replaced the link, and a person should
 * look before it goes.
 * @param {string} link
 */
function removeLink(link) {
  let st;
  try {
    st = fs.lstatSync(link);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) fs.unlinkSync(link);
  else fs.rmdirSync(link);
}

/** @param {string} name */
function linkPath(name) {
  return path.join(LINKS, name);
}

/**
 * True when the skill's SKILL.md can be read through its link.
 * @param {string} name
 */
function isLive(name) {
  try {
    fs.readFileSync(path.join(linkPath(name), 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
}

/** @param {boolean} lockMode */
function target(lockMode) {
  return lockMode ? 'the template LOCK' : "this machine's profile";
}

/** @param {string[]} skipped */
function skippedNote(skipped) {
  return skipped.length ? `; skipped: ${skipped.join('; ')}` : '';
}

/**
 * Park each name: remove its link and record the choice in the profile, or in the lock with lockMode.
 * @param {string[]} names
 * @param {boolean} lockMode
 */
function park(names, lockMode) {
  const lock = readSkillsLock();
  const mandatory = skillState.parseMandatory(REPO);
  /** @type {string[]} */
  const done = [];
  /** @type {string[]} */
  const skipped = [];
  const profile = lockMode ? null : readProfileFile();
  for (const n of names) {
    if (!lock.skills[n]) {
      skipped.push(`${n} (not in lock)`);
      continue;
    }
    if (!fs.existsSync(path.join(STORE, n))) {
      skipped.push(`${n} (no .agents/skills content - refusing)`);
      continue;
    }
    if (mandatory.has(n)) {
      skipped.push(`${n} (MANDATORY-bound, refusing to park)`);
      continue;
    }
    removeLink(linkPath(n));
    if (lockMode) {
      lock.skills[n].parked = true;
      lock.skills[n].parkedAt = new Date().toISOString();
    } else {
      profile.park = Array.from(new Set([...(profile.park || []), n]));
      profile.wake = (profile.wake || []).filter((/** @type {string} */ x) => x !== n);
    }
    done.push(n);
  }
  if (lockMode) writeSkillsLock(lock);
  else writeProfileFile(profile);
  const eff = skillState.resolve({ root: REPO });
  const bad = done.filter(
    (n) => fs.existsSync(linkPath(n)) || !fs.existsSync(path.join(STORE, n, 'SKILL.md')) || !eff.parked.has(n)
  );
  if (bad.length) throw new Error(`park verify FAILED for: ${bad.join(', ')}`);
  console.log(`parked ${done.length} in ${target(lockMode)} (link removed, content untouched)${skippedNote(skipped)}`);
}

/**
 * Wake each name: make its link when none is there and record the choice in the profile, or in the lock
 * with lockMode. Any store folder may be woken into the profile, in the lock or not.
 * @param {string[]} names
 * @param {boolean} lockMode
 */
function wake(names, lockMode) {
  const lock = readSkillsLock();
  /** @type {string[]} */
  const done = [];
  /** @type {string[]} */
  const skipped = [];
  const profile = lockMode ? null : readProfileFile();
  for (const n of names) {
    if (!fs.existsSync(path.join(STORE, n))) {
      skipped.push(`${n} (no content)`);
      continue;
    }
    if (!fs.existsSync(linkPath(n))) {
      fs.mkdirSync(LINKS, { recursive: true }); // a fresh clone may not have the gitignored link folder yet
      // contract: read as text by scripts/tests/test-skill-links.mjs:159. No code line in this file calls fs.symlinkSync; every link goes through skillState.linkSkill here.
      skillState.linkSkill(LINKS, STORE, n);
    }
    if (lockMode) {
      if (lock.skills[n]) {
        delete lock.skills[n].parked;
        delete lock.skills[n].parkedAt;
      }
    } else {
      profile.wake = Array.from(new Set([...(profile.wake || []), n]));
      profile.park = (profile.park || []).filter((/** @type {string} */ x) => x !== n);
    }
    done.push(n);
  }
  if (lockMode) writeSkillsLock(lock);
  else writeProfileFile(profile);
  const eff = skillState.resolve({ root: REPO });
  const bad = done.filter((n) => !isLive(n) || eff.parked.has(n));
  if (bad.length) throw new Error(`wake verify FAILED for: ${bad.join(', ')}`);
  console.log(`woke ${done.length} in ${target(lockMode)} (link verified live)${skippedNote(skipped)}`);
}

/** Print the effective counts, the parked names, the resolver's warnings and every awake skill with a dead link. */
function list() {
  const eff = skillState.resolve({ root: REPO });
  const total = eff.awake.size + eff.parked.size;
  const profile = skillState.readProfile(REPO);
  const layers = profile ? "lock + this machine's profile" : 'lock, no profile';
  console.log(`skills: ${total} total, ${eff.awake.size} awake, ${eff.parked.size} parked (effective = ${layers})`);
  if (eff.parked.size) console.log(`parked: ${Array.from(eff.parked).sort().join(', ')}`);
  for (const w of eff.warnings) console.log(`WARN ${w}`);
  const orphans = Array.from(eff.awake).filter((n) => !isLive(n));
  if (orphans.length) {
    console.log(`WARN awake-but-dead links (run: node scripts/bootstrap.mjs --repair-links): ${orphans.join(', ')}`);
  }
}

const argv = process.argv.slice(2);

// The four flags this CLI knows. skills-park has no hook, Routine or launcher caller - it is named only
// in CLAUDE.md prose and docs, for a person or the model to type by hand - so parseCommandLine runs the
// whole parse on the operator edge: a flag where a name belongs and an unknown flag both refuse.
/** @type {import('node:util').ParseArgsOptionsConfig} */
const ARGS_TABLE = {
  park: { type: 'string' },
  wake: { type: 'string' },
  list: { type: 'boolean' },
  lock: { type: 'boolean' }
};

// async with no await: a throw from list() below then surfaces as an unhandled rejection rather than a
// synchronous crash, the raw-crash shape NEVER above names.
async function main() {
  if (argv.length === 0) return list();
  /** @type {{ park?: string | boolean, wake?: string | boolean, list?: boolean, lock?: boolean }} */
  let values;
  try {
    ({ values } = parseCommandLine({ name: 'skills-park', edge: 'operator', options: ARGS_TABLE, argv }));
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (values.list) return list();
  const isPark = typeof values.park === 'string';
  const raw = typeof values.park === 'string' ? values.park : typeof values.wake === 'string' ? values.wake : '';
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const held = writeLock.acquire({ label: 'skills-park' });
  if (!held.ok) {
    console.error(`skills-park: write lock busy (${held.reason})`);
    process.exitCode = 2;
    return;
  }
  const lockMode = Boolean(values.lock);
  try {
    if (isPark) park(names, lockMode);
    else wake(names, lockMode);
    process.exitCode = 0;
  } catch (e) {
    console.error(`skills-park FAILED: ${/** @type {Error} */ (e).message}`);
    process.exitCode = 1;
  } finally {
    held.release();
  }
}

if (isMain(__filename)) main();

module.exports = { removeLink };
