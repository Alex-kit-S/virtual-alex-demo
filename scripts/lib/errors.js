// @ts-check
// scripts/lib/errors.js - the Refusal class, and the test that tells a program it was run, not imported.
//
// WHAT. Two things every command line in this tree needs, kept in one place so no program writes its
// own. Refusal is the error a program throws when it will not do what it was asked, as opposed to failing
// while it tried; the caller sees the class, not a string, and knows which exit code the refusal carries.
// isMain answers whether the file asking is the script node was started with, so a module that is also a
// command runs its command only when it was run, never when a test or another script imports it.
//
// HOW. Refusal extends Error, is named 'Refusal' and carries exitCode, EXIT.REFUSED from
// scripts/lib/exit-codes.js unless the thrower names another. A thrower may also name a cause, the
// lower-level error this refusal wraps, so a caller that needs to tell one kind of refusal from another
// reads error.cause.code rather than matching the message text; scripts/lib/args.js does this with
// node:util's own ERR_PARSE_ARGS_* codes. scripts/lib/args.js names EXIT.FAILURE, 1,
// for a bad command line, as section 4 of docs/CODE-STANDARD.md orders; any other thrower names its own
// code, and an exitCode of 2 needs its own row in section 5.2. isMain takes the caller's own import.meta.url
// or __filename and compares it with process.argv[1], both resolved through the file system to their real
// paths, so a run through a symbolic link or a Windows junction still counts as run. process.argv[1] is
// resolved first the way node's CommonJS loader resolves it, because it keeps the path as typed: started
// as `node cli`, it names cli.js. On Windows the comparison ignores case, as the file system does.
//
// NEVER. Reads import.meta.main: the laptop floor is Node 22.16 and that property arrived in 22.18, so a
// command guarded by it would do nothing and exit 0 on a laptop between the two. Compares the raw
// strings: macOS runs its temporary folder through a link, and a main guard that read the link as
// "imported" once made a gate exit 0 without deciding anything. Ends the process itself.
//
// Usage: module only - const { Refusal, isMain } = require('./errors');
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { EXIT } = require('./exit-codes');

/** An error meaning "will not", carrying the exit code its program ends with. */
class Refusal extends Error {
  /**
   * @param {string} message what was refused and why, in words the person who asked can act on
   * @param {{ exitCode?: number, cause?: unknown }} [options] the exit code, when it is not EXIT.REFUSED,
   *   and the lower-level error this refusal wraps, when there is one (a caller can read its `.code`)
   */
  constructor(message, options = {}) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'Refusal';
    this.exitCode = options.exitCode ?? EXIT.REFUSED;
  }
}

/**
 * The real path of a file, or its absolute path when it does not exist.
 * @param {string} file
 */
function realPath(file) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return path.resolve(file);
  }
}

/**
 * The file node's CommonJS loader runs for a started path: `node cli` runs cli.js, while
 * process.argv[1] keeps the path as it was typed. A path the loader cannot resolve comes back absolute.
 * @param {string} started
 * @returns {string}
 */
function loaderPath(started) {
  const absolute = path.resolve(started);
  try {
    return require.resolve(absolute);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'MODULE_NOT_FOUND') return absolute;
    throw error;
  }
}

/**
 * True when the calling file is the script node was started with.
 * @param {string} self the caller's import.meta.url or __filename
 * @param {string | undefined} [invoked] the started script; process.argv[1] unless a test names another
 * @returns {boolean}
 */
function isMain(self, invoked = process.argv[1]) {
  if (!invoked) return false;
  const own = realPath(self.startsWith('file:') ? fileURLToPath(self) : self);
  const started = realPath(loaderPath(invoked));
  return process.platform === 'win32' ? own.toLowerCase() === started.toLowerCase() : own === started;
}

module.exports = { Refusal, isMain };
