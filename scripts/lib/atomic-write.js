// @ts-check
// scripts/lib/atomic-write.js - stages a generator run's outputs, then swaps them in all at once or not at all.
//
// WHAT. scripts/generate-alex.js touches no real file until every output of a run is staged and validated.
// It writes each output here first, validates the staged copies, and only then asks for the swap, which
// puts every staged file over its real path. A swap that fails part way puts back what it had replaced, so
// a run leaves the checkout either fully updated or as it found it.
//
// HOW. stage writes one output under .staging/ at its repository-relative path and fsyncs it; stagedFiles
// lists what is staged as sorted forward-slash paths, and readStaged reads one back. swapAll copies every
// existing target into .staging-backup/ first, then renames each staged file over its target, creating
// folders as it goes. When a rename fails it writes .staging-backup/ROLLBACK-INCOMPLETE.txt, naming the
// error and the files already swapped, puts those files back from the backup (or removes the ones that did
// not exist before), and throws. The marker is written before the roll-back, so a process killed during
// it still leaves a record of what to restore. A swap that completes removes both folders. reset clears
// both before a run, and warns on stderr first when a backup folder is left from an earlier one. It must
// load copied alone, so it computes its own root, two folders up, instead of taking repo-root.js's:
// scripts/tests/test-atomic-write-contract.mjs loads a lone copy, with no sibling beside it.
//
// NEVER. Touches a real path before swapAll, or swaps an empty staging folder: that is refused. Fails
// closed: every failure of the swap is thrown, after the roll-back. The marker is best effort, and one
// that cannot be written is skipped so the roll-back still runs. As the code stands, and as its contract
// test pins it: a relative path that climbs out of .staging/ is written where it points; a staged file
// identical to its target is still rewritten; an error while backing up is thrown as it came, before
// anything is swapped, with no marker; and the next reset deletes a leftover backup and its marker after
// one warning, whether the roll-back that left them finished or not.
//
// Usage: module only - const aw = require('./lib/atomic-write'); aw.reset(); aw.stage(rel, text); aw.swapAll();
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const STAGING = path.join(REPO, '.staging');
const BACKUP = path.join(REPO, '.staging-backup');
const MARKER = 'ROLLBACK-INCOMPLETE.txt';

/**
 * Remove a file or a folder with everything under it; a path that is not there is not an error.
 * @param {string} p
 */
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** Clear .staging/ and .staging-backup/ before a run, warning first when a backup is left from an earlier one. */
function reset() {
  if (fs.existsSync(BACKUP)) {
    try {
      console.warn(
        `atomic-write: found leftover ${path.basename(BACKUP)}/ from a prior run (a swap likely died mid-rollback). Check 'git status' for half-written files before it is cleared.`
      );
    } catch {
      // a console that cannot be written to must not stop the run
    }
  }
  rmrf(STAGING);
  rmrf(BACKUP);
}

/**
 * Write one output into .staging/ at its repository-relative path, and fsync it.
 * @param {string} relPath repository-relative, with forward or back slashes
 * @param {string} content written as UTF-8
 * @returns {string} the staged file's absolute path
 */
function stage(relPath, content) {
  const abs = path.join(STAGING, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const fd = fs.openSync(abs, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return abs;
}

/**
 * Every staged file, as a repository-relative path with forward slashes, sorted.
 * @returns {string[]}
 */
function stagedFiles() {
  if (!fs.existsSync(STAGING)) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(path.relative(STAGING, p).split(path.sep).join('/'));
    }
  };
  walk(STAGING);
  return out.sort();
}

/**
 * One staged file's text.
 * @param {string} relPath
 */
function readStaged(relPath) {
  return fs.readFileSync(path.join(STAGING, relPath), 'utf8');
}

/**
 * Copy every target that exists into .staging-backup/, at the same relative path. An error is thrown as it came.
 * @param {string[]} files
 */
function backUp(files) {
  fs.mkdirSync(BACKUP, { recursive: true });
  for (const rel of files) {
    const target = path.join(REPO, rel);
    if (fs.existsSync(target)) {
      const saved = path.join(BACKUP, rel);
      fs.mkdirSync(path.dirname(saved), { recursive: true });
      fs.copyFileSync(target, saved);
    }
  }
}

/**
 * Write the recovery marker: the error, and the files already swapped that a crash during the roll-back would
 * leave to be restored by hand from .staging-backup/.
 * @param {Error} error
 * @param {string[]} swapped
 */
function writeMarker(error, swapped) {
  try {
    fs.writeFileSync(
      path.join(BACKUP, MARKER),
      `atomic-write swap FAILED at: ${error.message}\nswapped-before-fail (restore these from this dir if a crash interrupts the rollback):\n${swapped.join('\n')}\n`,
      'utf8'
    );
  } catch {
    // best effort: the roll-back that follows matters more than the record of it
  }
}

/**
 * Put back every file already swapped: from its backup, or removed when it did not exist before the run.
 * @param {string[]} swapped
 */
function rollBack(swapped) {
  for (const rel of swapped) {
    const target = path.join(REPO, rel);
    const saved = path.join(BACKUP, rel);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, target);
    else rmrf(target);
  }
}

/**
 * Put every staged file over its real path, all or nothing, and return the paths swapped.
 * @returns {string[]}
 */
function swapAll() {
  const files = stagedFiles();
  if (files.length === 0) throw new Error('atomic-write: nothing staged, refusing to swap');
  backUp(files);
  /** @type {string[]} */
  const done = [];
  try {
    for (const rel of files) {
      const target = path.join(REPO, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(STAGING, rel), target); // replaces an existing target, on Windows too
      done.push(rel);
    }
  } catch (e) {
    const error = /** @type {Error} */ (e);
    writeMarker(error, done);
    rollBack(done);
    throw new Error(
      `atomic-write: swap failed at '${error.message}' - rolled back ${done.length} file(s), repo untouched`
    );
  }
  rmrf(STAGING);
  rmrf(BACKUP);
  return files;
}

module.exports = { REPO, STAGING, reset, stage, stagedFiles, readStaged, swapAll, rmrf };
