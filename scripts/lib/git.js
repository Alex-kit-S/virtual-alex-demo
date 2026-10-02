// @ts-check
// scripts/lib/git.js - the one way a script runs git and gets its raw bytes back or a loud error.
//
// WHAT. scripts/lib/staged-paths.js is this module's one real caller: stagedNameStatus and stagedNumstat
// both run git through it. The same three rules apply on every call: read bytes, not text, so a blob's
// own encoding survives the round trip; never let a large blob truncate silently; and throw loud on
// anything git could not do. scripts/secret-scan.mjs and scripts/employer-data-guard.mjs each still carry
// their own copy of the same spawnSync wrapper, because both walls treat that throw as "the scanner
// could not do its job" and refuse the commit rather than call silence clean, and each is copied alone,
// without scripts/lib/, by its own known-bad test fixture; adopting this module there would move with
// those fixtures' own change.
//
// HOW. git(args, options) spawns `git <args>` through node:child_process's spawnSync, with buffer
// encoding and a 256 MB output cap, inheriting the caller's cwd and environment (a hook's
// GIT_INDEX_FILE, set for a partial commit, reaches the child this way, and so does a test's
// GIT_CEILING_DIRECTORIES or GIT_CONFIG_* fixture), and returns stdout as a Buffer. A spawn failure
// (git missing from PATH) and a non-zero exit (outside a repository, a broken object, a staged gitlink)
// both throw an Error naming the failing argument or the whole command line, with git's own stderr
// trimmed onto the end. `options` is merged in after the two defaults, so a caller that needs a
// different cwd does not need a second copy of this function to ask for one.
//
// NEVER. Swallows a spawn error or a non-zero exit. A version that returned an empty buffer instead
// would turn "git could not read this" into "there is nothing here", the one confusion a security wall
// must never make.
//
// Usage: module only - const { git } = require('./git');
'use strict';

const { spawnSync } = require('node:child_process');

const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Runs `git <args>` and returns stdout as a Buffer (the default) or a string, if the caller's own
 * options ask for a text encoding instead. Throws on a spawn error or a non-zero exit, with git's own
 * stderr folded into the message.
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options] merged in after the two defaults
 * @returns {Buffer | string}
 */
function git(args, options = {}) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: MAX_BUFFER, ...options });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.toString('utf8').trim()}`);
  }
  return r.stdout;
}

module.exports = { git };
