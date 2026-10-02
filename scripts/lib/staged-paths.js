// @ts-check
// scripts/lib/staged-paths.js - the protected-file guard's two staged-change listings.
//
// WHAT. scripts/lib/validate/commit.js's V10 and V11 read what is staged through this module:
// stagedNameStatus, every status git reports for a staged path (A/M/D/R/C, nothing folded into a plain
// add), and stagedNumstat, the removed-line count per modified path. Two calls because git itself
// answers WHICH changed and HOW MUCH in two separate forms. scripts/secret-scan.mjs and
// scripts/employer-data-guard.mjs solve a related but different problem (the staged path list folded to
// a plain add, and one staged blob's bytes) with their own inline copies; this module does not hold
// that shape (see NEVER).
//
// HOW. stagedNameStatus(options) runs `git diff --cached --name-status -z` and splits the NUL-separated
// output into status records, expanding a rename or copy record (status R or C) into its two paths,
// oldPath and path. stagedNumstat(options) runs `git diff --cached --numstat -z` and returns a Map of
// path to the removed-line count git prints ('-' for a binary path); a rename record is skipped whole,
// so its own content change, if any, is not reported under either path. Both run through
// scripts/lib/git.js, so both throw loud on a git failure rather than return an empty result.
//
// NEVER. Reads the working tree for staged content: every byte this module reports comes from the
// INDEX, so a change made and never staged cannot slip through as if it had been. Retries or widens a
// git failure into an empty result. Lists staged paths, reads one staged blob by path, or tests a
// buffer for binary content: secret-scan.mjs and employer-data-guard.mjs each keep their own copy of
// that shape, loaded alone as a hook entry.
//
// Usage: module only - const { stagedNameStatus, stagedNumstat } = require('./staged-paths');
'use strict';

const { git } = require('./git');

/**
 * Every staged change by name-status, in the order git reports it, with full rename and copy records
 * (every status; nothing folded into a plain add).
 * @param {import('node:child_process').SpawnSyncOptions} [options] forwarded to git.js's own git() untouched
 * @returns {Array<{ status: string, path: string, oldPath?: string }>}
 */
function stagedNameStatus(options = {}) {
  const raw = git(['diff', '--cached', '--name-status', '-z'], { encoding: 'utf8', ...options })
    .toString('utf8')
    .split('\0');
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const status = raw[i];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = raw[++i];
      const newPath = raw[++i];
      out.push({ status: status[0], oldPath, path: newPath });
    } else {
      const p = raw[++i];
      if (p == null) break;
      out.push({ status: status[0], path: p });
    }
  }
  return out;
}

/**
 * Removed-line counts for every staged path by numstat, text files only (git's own rule). A rename
 * record is skipped whole: its own content change, if any, is not reported under either path.
 * @param {import('node:child_process').SpawnSyncOptions} [options] forwarded to git.js's own git() untouched
 * @returns {Map<string, string>} path -> removed-line count as git prints it ('-' for binary)
 */
function stagedNumstat(options = {}) {
  const raw = git(['diff', '--cached', '--numstat', '-z'], { encoding: 'utf8', ...options })
    .toString('utf8')
    .split('\0');
  const removedByPath = new Map();
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    if (!tok) continue;
    const parts = tok.split('\t');
    if (parts.length === 3 && parts[2] !== '') removedByPath.set(parts[2], parts[1]);
    else if (parts.length === 3 && parts[2] === '') i += 2; // rename record: skip old+new tokens
  }
  return removedByPath;
}

module.exports = { stagedNameStatus, stagedNumstat };
