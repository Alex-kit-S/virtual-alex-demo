// scripts/tests/fixtures/validator-tree.mjs - the one temp-git-tree harness every validate-alex.js and
// generate-alex.js test builds from, so five test files stop carrying five copies of the same setup.
//
// WHAT. makeRoot() allocates one realpath'd temp folder a caller owns end to end. pinnedGitEnv(root)
// returns the environment every git call in these tests runs under: GIT_* stripped from the inherited
// environment, GIT_CONFIG_NOSYSTEM and a per-root GIT_CONFIG_GLOBAL so no machine-wide git config leaks
// in, HOME/USERPROFILE pointed at the root, and the automatic-maintenance override (see NEVER). writeGitConfig
// writes that global config file. buildBaseTree(kitDir, baseDir, env) copies every file this checkout's
// git tracks (`.agents/` left out: no leg under test reads it) into baseDir and commits it there, once,
// so every caller's tree() is a cheap copy of one real commit rather than a fresh tracked-file walk.
// makeTreeFactory(baseDir, rootDir, env) returns tree(), which copies baseDir into a new numbered folder
// under rootDir. spawnCollect(nodeArgs, options) runs one child process to completion and resolves
// { status, stdout, stderr }, the one shape every runner in these files builds its own `failed`/`warnings`
// extraction on top of.
//
// HOW. Every export takes its environment and paths as arguments rather than reading globals, so two
// callers in the same process (a file importing this module twice under different `describe()` blocks,
// or two files sharing a process in --test-concurrency) never share state through this module itself -
// each caller's own ROOT, BASE and ENV stay theirs.
//
// NEVER. Reads or writes outside the baseDir/rootDir a caller gives it. Lets git's automatic maintenance
// run detached: since Git 2.54 a commit leaving 100 loose objects repacks them, and on macOS and Linux
// that repack runs in a detached process that can delete the loose objects while a sibling tree() copy is
// still reading .git - not detached, the commit simply waits for the repack, which costs time but never
// a race. The two `maintenance.autoDetach`/`gc.autoDetach` overrides below are what disables detaching,
// and they ride in the environment (not in the gitconfig writeGitConfig writes) so they hold for every
// git call this module or a caller makes, not only the ones against a config file.
//
// Usage: ESM only - `import { makeRoot, pinnedGitEnv, writeGitConfig, buildBaseTree, makeTreeFactory,
//   spawnCollect } from './fixtures/validator-tree.mjs'`
// Exit: n/a

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

/** A fresh, realpath'd temp folder a caller owns end to end (remove it in `after()`). */
export function makeRoot(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * The environment every git call in these tests runs under.
 * @param {string} root the caller's own temp root (HOME/USERPROFILE and the global config live here)
 * @returns {NodeJS.ProcessEnv}
 */
export function pinnedGitEnv(root) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_') && !k.startsWith('C4_'))
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    HOME: root,
    USERPROFILE: root
  });
  // See the file header NEVER paragraph: this is the detached-repack race fix.
  Object.assign(env, {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'maintenance.autoDetach',
    GIT_CONFIG_VALUE_0: 'false',
    GIT_CONFIG_KEY_1: 'gc.autoDetach',
    GIT_CONFIG_VALUE_1: 'false'
  });
  return env;
}

/** Writes the global gitconfig pinnedGitEnv's GIT_CONFIG_GLOBAL points at. */
export function writeGitConfig(root, name) {
  fs.writeFileSync(
    path.join(root, 'gitconfig'),
    `[user]\n\tname = ${name}\n\temail = fixture@example.invalid\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n`
  );
}

/** `git <args>` in `cwd`, under `env`, stdin ignored. Returns stdout as a utf8 string. */
export function gitIn(env) {
  return (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Copies every file `kitDir`'s git tracks (`.agents/` left out) into `baseDir`, then `git init` + one
 * commit there. The one real tracked-file walk every caller's tree() copies from afterwards.
 */
export function buildBaseTree(kitDir, baseDir, env, { exclude = ['.agents/'] } = {}) {
  const git = gitIn(env);
  for (const f of git(kitDir, ['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (exclude.some((p) => f.startsWith(p))) continue;
    const src = path.join(kitDir, f);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(baseDir, f)), { recursive: true });
    fs.copyFileSync(src, path.join(baseDir, f));
  }
  git(baseDir, ['init', '-q']);
  git(baseDir, ['add', '-A']);
  git(baseDir, ['commit', '-qm', 'fixture base']);
}

/** tree(): a cheap copy of `baseDir` into a new numbered folder under `rootDir`. */
export function makeTreeFactory(baseDir, rootDir) {
  let seq = 0;
  return function tree() {
    const dir = path.join(rootDir, `t${++seq}`);
    fs.cpSync(baseDir, dir, { recursive: true });
    return dir;
  };
}

/**
 * Runs one child process to completion and collects its output. The one spawn shape every caller's own
 * runner (validate-alex's `run()`, generate-alex's `gen()`) builds its FAILED/WARNING extraction on.
 * @param {string[]} nodeArgs argv after the node executable, e.g. ['-r', stubPath, scriptPath, ...args]
 * @param {{cwd: string, env: NodeJS.ProcessEnv}} options
 * @returns {Promise<{status: number|null, stdout: string, stderr: string}>}
 */
export function spawnCollect(nodeArgs, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** Non-empty lines of `s`, split on any line ending. */
export function lines(s) {
  return String(s || '')
    .split(/\r?\n/)
    .filter(Boolean);
}
