// @ts-check
// scripts/lib/write-lock.js - the one lock every writer of a generated surface takes before it writes.
//
// WHAT. Two sessions open at the same time can each start a run that rewrites the same generated files, and
// two runs interleaved leave a file that is half one and half the other. Every writer of those surfaces (the
// generator, the soul-card builder, status-rotate, skills-park and the online-template builder) takes this
// lock first, under one shared name, so only one of them writes at a time. A lock that a crashed run left
// behind is taken over after half an hour instead of blocking every run after it.
//
// HOW. acquire makes the folder .alex-lock-<name> in the repository root with one mkdir, which creates it or
// fails with EEXIST and leaves no gap between the check and the claim, then writes holder.json inside it:
// label, pid and start time, as two-space JSON with no final line break. When the folder is already there it
// reads the holder: a folder older than staleMs by its modification time is removed and claimed again, after
// one line to the caller's log naming its age and holder; a younger one is refused with a reason naming the
// holder. The refused caller decides what follows: the generator fails loud, the nightly writers defer.
// release removes the folder unless holder.json names another process. withLock runs a function between
// the two. It must load copied alone, so it computes its own root, two folders up, instead of taking
// repo-root.js's: scripts/tests/test-write-lock-contract.mjs and five tests that build throwaway
// repositories (test-build-soul-core-paths, test-soul-core-floor, test-generate-no-soul,
// test-status-rotate-ledger, test-skills-park-cli) copy it with no repo-root.js beside it.
//
// NEVER. Waits or retries: each call is one attempt. Throws for a held lock. acquire throws in two cases
// only: the folder cannot be made for a reason other than EEXIST, or its holder file cannot be written, and
// then the claim removes the folder it made before it throws, so no lock is left that names no one; a
// steal that fails either way is a refusal, not a throw. Fails closed: a lock it cannot claim is a refusal,
// never a run without the lock. Removes a lock whose holder file names another process. Judges a holder by
// anything but the folder's age, as the code stands and as its contract test pins it: a holder still alive
// past the window is taken over too, and a holder file that is missing or does not parse reads as "no
// holder file yet".
//
// Usage: module only - const held = require('./lib/write-lock').acquire({ label }); ... held.release();
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
/** One name for every surface writer, so none of them can interleave with another. */
const DEFAULT_NAME = 'alex-surfaces';
/** A lock older than this was left by a run that crashed. */
const DEFAULT_STALE_MS = 30 * 60 * 1000;
const HOLDER_FILE = 'holder.json';

/**
 * @typedef {{ label: string, pid: number, since: string }} Holder what a claim writes into holder.json
 * @typedef {{ ok: boolean, release: () => boolean, holder: unknown, reason: string | null }} Held
 * @typedef {{ name?: string, label?: string, staleMs?: number, log?: (message: string) => void }} LockOptions
 */

/**
 * The folder that is the lock of this name.
 * @param {string} name
 */
function lockPath(name) {
  return path.join(REPO, `.alex-lock-${name}`);
}

/**
 * The parsed holder file of a lock folder, or null when it is missing or does not parse. Its shape is not
 * checked: a claim writes a Holder, but the file may hold any JSON, and that comes back as it is.
 * @param {string} dir
 * @returns {unknown}
 */
function holderOf(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, HOLDER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * One field of a parsed holder file, as the release check, the steal line and the refusal read it:
 * undefined when the file lacks it, whatever JSON the file holds.
 * @param {unknown} holder a parsed holder file that is not null
 * @param {keyof Holder} key
 */
const holderField = (holder, key) => /** @type {Partial<Holder>} */ (holder)[key];

/**
 * How long ago a lock folder was last modified, in milliseconds; Infinity when it cannot be read.
 * @param {string} dir
 */
function ageMsOf(dir) {
  try {
    return Date.now() - fs.statSync(dir).mtimeMs;
  } catch {
    return Infinity;
  }
}

/** The release of a lock this call did not take: it touches nothing. */
const releaseNothing = () => false;

/**
 * Try once to take a lock.
 * @param {LockOptions} [options]
 * @returns {Held}
 */
function acquire({ name = DEFAULT_NAME, label = 'unknown', staleMs = DEFAULT_STALE_MS, log } = {}) {
  const dir = lockPath(name);
  /** @param {string} message */
  const say = (message) => {
    if (typeof log === 'function') log(message);
  };
  const claim = () => {
    fs.mkdirSync(dir); // creates the folder, or throws EEXIST while another run holds it
    try {
      fs.writeFileSync(
        path.join(dir, HOLDER_FILE),
        JSON.stringify({ label, pid: process.pid, since: new Date().toISOString() }, null, 2),
        'utf8'
      );
    } catch (error) {
      // A folder with no holder file refuses every taker for the whole window, naming no one.
      fs.rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  };
  const release = () => {
    const holder = holderOf(dir);
    if (holder && holderField(holder, 'pid') !== process.pid) return false; // taken over from this process: not ours
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  };

  try {
    claim();
    return { ok: true, release, holder: null, reason: null };
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
  }

  const holder = holderOf(dir);
  const age = ageMsOf(dir);
  if (age > staleMs) {
    const who = holder ? `${holderField(holder, 'label')} pid ${holderField(holder, 'pid')}` : 'unknown';
    say(
      `write-lock: stealing a STALE '${name}' lock (age ${Math.round(age / 60000)}min, holder ${who}) - a prior run almost certainly crashed`
    );
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      claim();
      return { ok: true, release, holder, reason: 'stole-stale' };
    } catch (e) {
      const reason = `stale-steal failed: ${/** @type {Error} */ (e).message}`;
      return { ok: false, release: releaseNothing, holder, reason };
    }
  }

  const reason = holder
    ? `held by ${holderField(holder, 'label')} (pid ${holderField(holder, 'pid')}) since ${holderField(holder, 'since')}`
    : 'held by an unknown process (no holder file yet)';
  return { ok: false, release: releaseNothing, holder, reason };
}

/**
 * Run fn under a lock and release it after a result or a throw; while the lock is held elsewhere fn never runs.
 * @template T
 * @param {LockOptions | undefined} opts
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<{ ok: boolean, value: T | undefined, reason: string | null, holder?: unknown }>}
 */
async function withLock(opts, fn) {
  const held = acquire(opts);
  if (!held.ok) return { ok: false, value: undefined, reason: held.reason, holder: held.holder };
  try {
    const value = await fn();
    return { ok: true, value, reason: null };
  } finally {
    held.release();
  }
}

module.exports = { acquire, withLock, lockPath, DEFAULT_NAME, DEFAULT_STALE_MS, REPO };
