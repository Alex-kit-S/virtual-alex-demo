#!/usr/bin/env node
// @ts-check
// scripts/tests/test-session-branch.mjs - the session-branch paths the autosave suite never reaches.
//
// WHAT. Pins scripts/lib/session-branch.sh beyond T8b to T8h of test-autosave.mjs: another named branch,
// a detached HEAD, a folder outside any repository, a claude/ branch whose fetch fails, a refused rescue
// on main, a checkout that fails, the upstream set after a switch, and the three git answers it reads
// when they fail: the own-commit count (fails closed), the cached main's count (fails open, nothing
// rescued) and FETCH_HEAD after the fetch. On every path it holds the contract /update and the snapshot
// Routine branch on: exactly one line on stdout, opening with one of the three markers, and exit 0.
// Deleted, a start-up step that moved a branch it must not move, lost or leaked a commit, printed a
// second line or stopped a session with a non-zero exit would pass with every other test green.
//
// HOW. Each test builds a world in a temp folder: a bare origin whose main holds one commit, and clones
// of it. The script runs under bash with CLAUDE_PROJECT_DIR set to the clone, and its stdout, stderr and
// exit code are compared with the exact lines. Git runs with no system or global config. A failing git
// answer is injected through BASH_ENV, which loads a shell function named git that fails the one call a
// test names and runs the real git for the rest. On Windows bash is the one beside git.exe, or the one
// ALEX_BASH names.
//
// NEVER. Writes outside its own temp folder, which it removes at the end, or reaches a network. Flips a
// PINNED DEFECT assertion on its own: each pins today's behaviour, and only a FIX row in the ratchet
// flips one. SB-D1: SessionStart has no matcher and the script reads no stdin, so on resume, clear or
// compact a main that is ahead of GitHub, holding the session's own unpushed commit, is moved to a rescue
// branch and the working tree reset to GitHub's main, mid-session. SB-D2: an unrelated cached main, from
// a repository deleted and made again, is pushed whole to a rescue branch of the new one, and history the
// owner purged comes back. SB-D3: outside a repository it leaks git's fatal line and calls the folder a
// detached HEAD.
//
// Usage: node scripts/tests/test-session-branch.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(KIT, 'scripts', 'lib', 'session-branch.sh');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-session-branch-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

/** Bash to run the script under: ALEX_BASH, else bash, else on Windows the one beside git.exe. */
function findBash() {
  if (process.env.ALEX_BASH) return process.env.ALEX_BASH;
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const cand = line.trim() && path.join(path.dirname(path.dirname(line.trim())), 'bin', 'bash.exe');
    if (cand && fs.existsSync(cand)) return cand;
  }
  throw new Error('Git bash not found next to git.exe; set ALEX_BASH');
}
const BASH = findBash();
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid'
};
/**
 * Runs git in cwd with the pinned environment: its trimmed stdout, or with allowFail the whole result.
 * @overload
 * @param {string} cwd
 * @param {string[]} args
 * @param {false} [allowFail]
 * @returns {string}
 */
/**
 * @overload
 * @param {string} cwd
 * @param {string[]} args
 * @param {true} allowFail
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {boolean} [allowFail]
 * @returns {string | import('node:child_process').SpawnSyncReturns<string>}
 */
function git(cwd, args, allowFail = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return allowFail ? r : (r.stdout || '').trim();
}
/** @type {(dir: string, rel: string, text: string, msg: string) => void} */
const commit = (dir, rel, text, msg) => {
  fs.writeFileSync(path.join(dir, rel), text);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
};

let n = 0;
// A bare origin whose main holds one commit, and a clone of it on main.
function world() {
  const base = path.join(TMP, `w${++n}`);
  const bare = path.join(base, 'origin.git');
  fs.mkdirSync(base);
  git(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = path.join(base, 'seed');
  git(base, ['init', '-q', '-b', 'main', seed]);
  commit(seed, 'README.md', '# GitHub main\n', 'seed');
  git(seed, ['push', '-q', bare, 'main']);
  /** @param {string} name */
  const clone = (name) => {
    const d = path.join(base, name);
    git(base, ['clone', '-q', bare, d]);
    return d;
  };
  const move = () => {
    const m = clone(`mover-${Math.random().toString(36).slice(2, 8)}`);
    commit(m, 'moved.md', '# main moved\n', 'main moves');
    git(m, ['push', '-q', 'origin', 'main']);
  };
  const remoteMain = () => git(base, ['ls-remote', bare, 'refs/heads/main']).split(/\s+/)[0];
  return { base, bare, clone, move, remoteMain };
}
/**
 * Runs the script against the clone in dir, with input on stdin when given.
 * @param {string} dir
 * @param {string} [input]
 */
function run(dir, input = undefined) {
  const r = spawnSync(BASH, [SCRIPT], {
    cwd: os.tmpdir(),
    input,
    encoding: 'utf8',
    env: { ...ENV, CLAUDE_PROJECT_DIR: dir }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const TAIL_NOT_MAIN =
  'Every save here lands on that branch, and the next session starts from main without it. Tell the owner that in one plain sentence in your first reply, before any other work.';
const TAIL_DIVERGED =
  'What you read here may be old, and a save from here can land on top of work you cannot see. Tell the owner that in one plain sentence in your first reply, before any other work.';
/** @type {(branch: string, why: string) => string} */
const notMain = (branch, why) =>
  `---BRANCH-NOT-MAIN--- This session is on ${branch}, not main (${why}). ${TAIL_NOT_MAIN}\n`;
/** @param {string} why */
const diverged = (why) =>
  `---BRANCH-DIVERGED--- This session is on main, but this copy is NOT known to match GitHub's main (${why}). ${TAIL_DIVERGED}\n`;
/** @param {string} dir */
const branchOf = (dir) => git(dir, ['branch', '--show-current']);

test('a branch that is neither main nor claude/* is never moved, and the line says so', () => {
  const w = world();
  const d = w.clone('feature');
  git(d, ['checkout', '-q', '-b', 'feature/x']);
  assert.deepEqual(run(d), {
    code: 0,
    stdout: notMain('feature/x', 'this start-up step only moves a fresh claude/ branch'),
    stderr: ''
  });
  assert.equal(branchOf(d), 'feature/x');
});

test('a detached HEAD is never moved, and the line names it', () => {
  const w = world();
  const d = w.clone('detached');
  git(d, ['checkout', '-q', '--detach']);
  assert.deepEqual(run(d), {
    code: 0,
    stdout: notMain('a detached HEAD', 'this start-up step only moves a fresh claude/ branch'),
    stderr: ''
  });
});

test('PINNED DEFECT SB-D3: outside a repository it leaks git\'s fatal line and calls it "a detached HEAD"', () => {
  const plain = fs.mkdtempSync(path.join(TMP, 'plain-'));
  const r = run(plain);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, notMain('a detached HEAD', 'this start-up step only moves a fresh claude/ branch'));
  assert.match(r.stderr, /^fatal: not a git repository/);
});

test('a claude/ branch whose fetch fails is not moved', () => {
  const w = world();
  const d = w.clone('nofetch');
  git(d, ['checkout', '-q', '-b', 'claude/nofetch-1']);
  git(d, ['remote', 'set-url', 'origin', path.join(w.base, 'no-such-remote.git')]);
  assert.deepEqual(run(d), {
    code: 0,
    stdout: notMain('claude/nofetch-1', "could not fetch GitHub's main"),
    stderr: ''
  });
  assert.equal(branchOf(d), 'claude/nofetch-1');
});

test('on main, a rescue push that fails moves nothing and drops nothing (DIVERGED)', () => {
  const w = world();
  const d = w.clone('norescue');
  commit(d, 'unpushed.md', '# a save that never reached GitHub\n', 'unpushed');
  const keep = git(d, ['rev-parse', 'HEAD']);
  git(d, ['remote', 'set-url', '--push', 'origin', path.join(w.base, 'no-such-remote.git')]);
  assert.deepEqual(run(d), {
    code: 0,
    stderr: '',
    stdout: diverged(
      "the local main has 1 commit(s) GitHub's main lacks and they could not be kept on a rescue branch, so nothing was moved and no commit was dropped"
    )
  });
  assert.equal(git(d, ['rev-parse', 'HEAD']), keep);
  assert.equal(fs.existsSync(path.join(d, 'unpushed.md')), true);
});

test("a checkout of GitHub's main that fails leaves the copy as it was (DIVERGED on main, NOT-MAIN on claude/)", () => {
  const w = world();
  const onMain = w.clone('lock-main');
  const onClaude = w.clone('lock-claude');
  git(onClaude, ['checkout', '-q', '-b', 'claude/lock-2']);
  w.move();
  for (const d of [onMain, onClaude]) fs.writeFileSync(path.join(d, '.git', 'index.lock'), ''); // a held index lock: status and fetch still work, checkout cannot
  const before = git(onMain, ['rev-parse', 'HEAD']);
  assert.deepEqual(run(onMain), {
    code: 0,
    stdout: diverged("the checkout of GitHub's main failed, so this copy was left as it was"),
    stderr: ''
  });
  assert.equal(git(onMain, ['rev-parse', 'HEAD']), before);
  assert.deepEqual(run(onClaude), {
    code: 0,
    stdout: notMain('claude/lock-2', "the checkout of GitHub's main failed"),
    stderr: ''
  });
  assert.equal(branchOf(onClaude), 'claude/lock-2');
});

test('after a switch, main tracks origin/main and the old claude/ branch is left in place', () => {
  const w = world();
  const d = w.clone('switch');
  git(d, ['checkout', '-q', '-b', 'claude/fresh-9']);
  const r = run(d);
  assert.equal(
    r.stdout,
    'BRANCH: main (switched from claude/fresh-9, a fresh platform branch with no work of its own)\n'
  );
  assert.equal(git(d, ['rev-parse', '--abbrev-ref', 'main@{upstream}']), 'origin/main');
  assert.equal(git(d, ['branch', '--list', 'claude/fresh-9']), 'claude/fresh-9');
});

test("PINNED DEFECT SB-D1: a SessionStart on resume/clear/compact moves the session's own unpushed commit off main and resets the tree", () => {
  // The online SessionStart has no matcher, so it runs on every source; the script reads no stdin, so
  // it cannot tell a compaction from a fresh start. Here the session's own save is on local main
  // (its push had failed); the compact-time run moves it to a rescue branch and the file vanishes
  // from the working tree the session is still using.
  const w = world();
  const d = w.clone('own-work');
  commit(d, 'vault-only-here.md', "# this session's own work, not yet on GitHub\n", 'alex: autosave');
  const own = git(d, ['rev-parse', 'HEAD']);
  const r = run(d, JSON.stringify({ session_id: 's', hook_event_name: 'SessionStart', source: 'compact' }));
  assert.equal(r.code, 0);
  const m =
    /^BRANCH: main \(the cached local main had 1 commit\(s\) that GitHub's main lacks, kept on (claude\/rescue-stale-main-\d{8}T\d{6}Z-([0-9a-f]{12}))\)\n$/.exec(
      r.stdout
    );
  assert.ok(m, r.stdout);
  assert.ok(own.startsWith(m[2]));
  assert.equal(git(d, ['rev-parse', 'HEAD']), w.remoteMain(), "the session now stands on GitHub's main");
  assert.equal(fs.existsSync(path.join(d, 'vault-only-here.md')), false, 'its own file is gone from the working tree');
  assert.equal(
    git(w.base, ['ls-remote', w.bare, `refs/heads/${m[1]}`]).split(/\s+/)[0],
    own,
    'the commit is on the rescue branch'
  );

  const settings = [
    path.join(KIT, 'variants', 'online', '.claude', 'settings.json'),
    path.join(KIT, '.claude', 'settings.json')
  ].find((p) => fs.existsSync(p));
  const start = JSON.parse(fs.readFileSync(/** @type {string} */ (settings), 'utf8')).hooks.SessionStart;
  assert.equal(start.length, 1);
  assert.equal(start[0].matcher, undefined, 'no matcher: startup, resume, clear and compact all run it');
  assert.match(
    start[0].hooks[0].command,
    /^PD="\$\{CLAUDE_PROJECT_DIR:-\.\}"; bash "\$PD\/scripts\/lib\/session-branch\.sh";/
  );
});

test('PINNED DEFECT SB-D2: an unrelated cached main (a deleted and recreated repository) is pushed whole to the new repository', () => {
  const w = world();
  const d = w.clone('recreated');
  // the old repository's history, which the owner deleted the repository to get rid of
  git(d, ['checkout', '-q', '--orphan', 'old']);
  git(d, ['rm', '-rq', '--cached', '.']);
  fs.rmSync(path.join(d, 'README.md'));
  commit(d, 'OLD.md', '# the old repository\n', 'old root');
  commit(d, 'purged.md', '# a page the owner purged by deleting the repository\n', 'the purged page');
  const oldTip = git(d, ['rev-parse', 'HEAD']);
  const oldRoot = git(d, ['rev-list', '--max-parents=0', 'HEAD']);
  git(d, ['branch', '-q', '-f', 'main', 'old']);
  git(d, ['checkout', '-q', '-f', '-b', 'claude/start-1', 'origin/main']);
  git(d, ['branch', '-q', '-D', 'old']);
  assert.notEqual(git(d, ['merge-base', 'main', 'origin/main'], true).status, 0, 'the two histories share nothing');
  const r = run(d);
  const m = /kept on (claude\/rescue-stale-main-\d{8}T\d{6}Z-[0-9a-f]{12})\)\n$/.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.match(r.stdout, /the cached local main had 2 commit\(s\) that GitHub's main lacks/);
  assert.equal(git(w.base, ['ls-remote', w.bare, `refs/heads/${m[1]}`]).split(/\s+/)[0], oldTip);
  for (const sha of [oldTip, oldRoot])
    assert.equal(git(w.bare, ['cat-file', '-e', `${sha}^{commit}`], true).status, 0, `${sha} is on the new origin`);
  assert.equal(git(w.bare, ['show', `${oldTip}:purged.md`]), '# a page the owner purged by deleting the repository');
});

test('every path prints exactly one line on stdout and exits 0', () => {
  const w = world();
  const shapes = [];
  const a = w.clone('one-a');
  shapes.push(run(a));
  const b = w.clone('one-b');
  fs.writeFileSync(path.join(b, 'dirty.md'), 'x');
  shapes.push(run(b));
  const c = w.clone('one-c');
  git(c, ['checkout', '-q', '-b', 'claude/c']);
  fs.writeFileSync(path.join(c, 'dirty.md'), 'x');
  shapes.push(run(c));
  const d = w.clone('one-d');
  git(d, ['checkout', '-q', '-b', 'claude/d']);
  commit(d, 'own.md', 'x', 'own');
  shapes.push(run(d));
  for (const r of shapes) {
    assert.equal(r.code, 0);
    assert.equal(r.stdout.split('\n').length, 2, r.stdout);
    assert.match(r.stdout, /^(BRANCH: main|---BRANCH-NOT-MAIN---|---BRANCH-DIVERGED---)/);
  }
  assert.deepEqual(
    shapes.map((r) => r.stdout.split(' ')[0]),
    ['BRANCH:', '---BRANCH-DIVERGED---', '---BRANCH-NOT-MAIN---', '---BRANCH-NOT-MAIN---']
  );
});

/**
 * Runs the script as run() does, with one git call failing: BASH_ENV loads a shell function named git that
 * returns 128 when its arguments match `glob`, a bash case pattern, and runs the real git for the rest.
 * @param {string} dir
 * @param {string} glob
 */
function runWithFailingGit(dir, glob) {
  const fault = path.join(fs.mkdtempSync(path.join(TMP, 'fault-')), 'git-fault.sh');
  fs.writeFileSync(fault, `git() { case "$*" in ${glob}) return 128 ;; esac; command git "$@"; }\n`);
  const r = spawnSync(BASH, [SCRIPT], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...ENV, CLAUDE_PROJECT_DIR: dir, BASH_ENV: fault }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('a claude/ branch whose own-commit count fails is not moved: a count it cannot make reads as work of its own', () => {
  const w = world();
  const d = w.clone('own-count');
  git(d, ['checkout', '-q', '-b', 'claude/own-count-1']);
  assert.deepEqual(runWithFailingGit(d, "*' rev-list --count '*'..HEAD'"), {
    code: 0,
    stdout: notMain('claude/own-count-1', 'it has commits of its own'),
    stderr: ''
  });
  assert.equal(branchOf(d), 'claude/own-count-1');
});

test("a failed count of the cached main's own commits reads as none: main moves to GitHub's and nothing is rescued", () => {
  // the rescue exists for exactly these commits, so this path fails open: the unpushed commit ends up on no
  // branch at all, where only the reflog still finds it
  const w = world();
  const d = w.clone('main-count');
  commit(d, 'unpushed.md', '# a save only the cached main holds\n', 'unpushed');
  const unpushed = git(d, ['rev-parse', 'HEAD']);
  git(d, ['checkout', '-q', '-b', 'claude/main-count-1', 'origin/main']);
  assert.deepEqual(runWithFailingGit(d, "*' rev-list --count '*'..refs/heads/main'"), {
    code: 0,
    stdout: 'BRANCH: main (switched from claude/main-count-1, a fresh platform branch with no work of its own)\n',
    stderr: ''
  });
  assert.equal(git(d, ['rev-parse', 'HEAD']), w.remoteMain());
  assert.equal(git(d, ['branch', '--contains', unpushed]), '', 'no local branch holds the unpushed commit');
  assert.equal(git(w.base, ['ls-remote', w.bare, 'refs/heads/claude/*']), '', 'no rescue branch was pushed');
});

test('a fetch that leaves no FETCH_HEAD to read moves nothing, and the line says so', () => {
  const w = world();
  const d = w.clone('no-fetch-head');
  git(d, ['checkout', '-q', '-b', 'claude/no-fetch-head-1']);
  assert.deepEqual(runWithFailingGit(d, "*' rev-parse -q --verify FETCH_HEAD'"), {
    code: 0,
    stdout: notMain('claude/no-fetch-head-1', 'no FETCH_HEAD after the fetch'),
    stderr: ''
  });
  assert.equal(branchOf(d), 'claude/no-fetch-head-1');
});
