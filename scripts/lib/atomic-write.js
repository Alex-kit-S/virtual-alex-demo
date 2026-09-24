// atomic-write.js - stage to .staging/, fsync, validate, then swap (refactor P1-S3, ground rule 8).
// A generation run succeeds as a whole or fails as a whole. Nothing real is touched until every
// output is staged AND validated. The swap backs up current targets first and rolls back on any
// mid-swap failure, so a crash can never leave a half-written repo.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const STAGING = path.join(REPO, '.staging');
const BACKUP = path.join(REPO, '.staging-backup');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// Fresh start: clear any leftovers from a previous (failed or dry) run.
function reset() {
  // BUG-09 fix (2026-07-15): a leftover .staging-backup/ means the last run died mid-rollback - surface
  // it so a half-written repo state is discoverable, not silently cleared.
  if (fs.existsSync(BACKUP)) {
    try { console.warn(`atomic-write: found leftover ${path.basename(BACKUP)}/ from a prior run (a swap likely died mid-rollback). Check 'git status' for half-written files before it is cleared.`); } catch (_) {}
  }
  rmrf(STAGING); rmrf(BACKUP);
}

// Write one output into the staging tree (relPath is repo-relative, forward slashes ok).
function stage(relPath, content) {
  const abs = path.join(STAGING, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  const fd = fs.openSync(abs, 'r+');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  return abs;
}

// All repo-relative paths currently staged.
function stagedFiles() {
  if (!fs.existsSync(STAGING)) return [];
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(STAGING, p).split(path.sep).join('/'));
    }
  })(STAGING);
  return out.sort();
}

function readStaged(relPath) {
  return fs.readFileSync(path.join(STAGING, relPath), 'utf8');
}

// Swap every staged file over its real path. Backup-first; rollback on any failure.
function swapAll() {
  const files = stagedFiles();
  if (files.length === 0) throw new Error('atomic-write: nothing staged, refusing to swap');
  fs.mkdirSync(BACKUP, { recursive: true });
  for (const rel of files) {
    const target = path.join(REPO, rel);
    if (fs.existsSync(target)) {
      const b = path.join(BACKUP, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(target, b);
    }
  }
  const done = [];
  try {
    for (const rel of files) {
      const target = path.join(REPO, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(STAGING, rel), target); // MOVEFILE_REPLACE_EXISTING on Windows
      done.push(rel);
    }
  } catch (e) {
    // BUG-09 fix (2026-07-15): drop a recovery marker BEFORE rolling back, so if the process is KILLED
    // mid-rollback (power loss) the half-restored state is discoverable and names which files to
    // restore from .staging-backup/. A clean rollback leaves it; the next reset() clears it.
    try {
      fs.writeFileSync(path.join(BACKUP, 'ROLLBACK-INCOMPLETE.txt'),
        `atomic-write swap FAILED at: ${e.message}\nswapped-before-fail (restore these from this dir if a crash interrupts the rollback):\n${done.join('\n')}\n`, 'utf8');
    } catch (_) { /* best-effort marker */ }
    // Roll back everything already swapped, then rethrow: all-or-nothing.
    for (const rel of done) {
      const target = path.join(REPO, rel);
      const b = path.join(BACKUP, rel);
      if (fs.existsSync(b)) fs.copyFileSync(b, target);
      else rmrf(target); // file did not exist before this run
    }
    throw new Error(`atomic-write: swap failed at '${e.message}' - rolled back ${done.length} file(s), repo untouched`);
  }
  rmrf(STAGING);
  rmrf(BACKUP);
  return files;
}

module.exports = { REPO, STAGING, reset, stage, stagedFiles, readStaged, swapAll, rmrf };
