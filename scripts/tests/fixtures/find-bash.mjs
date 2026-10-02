// scripts/tests/fixtures/find-bash.mjs - the one findBash() every test that shells out through Git's
// bash on Windows imports, replacing five copies of the same lookup.
//
// WHAT. findBash() returns the bash binary a test should hand to spawnSync/spawn: the ALEX_BASH
// override when set, the platform's own 'bash' on anything but Windows, and on Windows the bash.exe
// that ships beside the first git.exe on PATH.
//
// HOW. On Windows it shells out to `where.exe git`, takes each candidate git.exe path in the order
// `where.exe` prints them, and derives `<git root>\bin\bash.exe` from it (git.exe lives two levels
// under the Git for Windows install root, which carries bin\bash.exe). The first candidate that
// exists on disk wins.
//
// NEVER. Never resolves a bare 'bash' on Windows PATH: that can be WSL's launcher, which cannot see
// a Windows temp path a caller created with fs.mkdtempSync. Never caches its answer: a caller wanting
// one lookup for the whole file assigns it once itself (`const BASH = findBash();`).
//
// Usage: ESM only - `import { findBash } from './fixtures/find-bash.mjs'`
// Exit: n/a

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The bash binary a test should use to run a repository hook or shell script.
 *
 * @returns {string} `process.env.ALEX_BASH` when set; `'bash'` on any platform but Windows; otherwise
 *   the `bash.exe` that ships beside the first `git.exe` `where.exe` finds on PATH.
 * @throws {Error} on Windows, when no `git.exe` on PATH has a sibling `bin/bash.exe` (set ALEX_BASH).
 */
export function findBash() {
  if (process.env.ALEX_BASH) return process.env.ALEX_BASH;
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const gitExe = line.trim();
    const cand = gitExe && path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe');
    if (cand && fs.existsSync(cand)) return cand;
  }
  throw new Error('Git bash not found next to git.exe; set ALEX_BASH');
}
