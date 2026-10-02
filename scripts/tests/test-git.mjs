#!/usr/bin/env node
// @ts-check
// scripts/tests/test-git.mjs - the git transport every wall runs commands through.
//
// WHAT. Proves scripts/lib/git.js: a clean run returns stdout as a Buffer, not a string; a non-zero exit
// throws an Error naming the whole command line and git's own trimmed stderr; a spawn failure (git not
// reachable at all) throws a shorter message naming only the first argument; and the second parameter is
// merged into the spawnSync call after the two defaults, so a caller can redirect cwd without copying
// the function. Deleted, it would let a caller treat "git could not run this" the same as "git ran this
// and found nothing", which is the one confusion a security wall must never make.
//
// HOW. Runs git for real inside a throwaway repository under the OS temp folder, removed at the end;
// git runs with no system or global configuration reachable, so nothing on this machine's real config
// can change a result.
//
// NEVER. Writes outside its own temp folder.
//
// Usage: node scripts/tests/test-git.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/git.js';

const MODULE = fileURLToPath(new URL('../lib/git.js', import.meta.url));
const require = createRequire(import.meta.url);
const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-')));
after(() => fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 }));

const GITCFG = path.join(TEMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
const CHILD_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCFG,
  GIT_CEILING_DIRECTORIES: TEMP
};

const REPO = path.join(TEMP, 'repo');
fs.mkdirSync(REPO, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: REPO, env: CHILD_ENV });
execFileSync(
  'git',
  ['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'seed'],
  {
    cwd: REPO,
    env: CHILD_ENV
  }
);

describe('a clean run', () => {
  test('returns stdout as a Buffer, not a string', () => {
    const out = git(['rev-parse', 'HEAD'], { cwd: REPO, env: CHILD_ENV });
    assert.ok(Buffer.isBuffer(out), 'expected a Buffer');
    assert.equal(out.toString('utf8').trim().length, 40);
  });
});

describe('a non-zero exit', () => {
  test('throws an Error naming the whole command line and gits own trimmed stderr', () => {
    assert.throws(
      () => git(['bogus-subcommand-zz'], { cwd: REPO, env: CHILD_ENV }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^git bogus-subcommand-zz exited \d+: /);
        assert.ok(!e.message.endsWith('\n'), 'stderr is trimmed, no trailing newline');
        return true;
      }
    );
  });

  test('a staged gitlink makes "git show" fail with gits raw fatal text, never an empty result', () => {
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `160000,${'1234567890'.repeat(4)},vendor/zz-sub`], {
      cwd: REPO,
      env: CHILD_ENV
    });
    assert.throws(
      () => git(['show', ':vendor/zz-sub'], { cwd: REPO, env: CHILD_ENV }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^git show :vendor\/zz-sub exited 128: fatal: /);
        return true;
      }
    );
    execFileSync('git', ['reset'], { cwd: REPO, env: CHILD_ENV });
  });
});

describe('a spawn failure', () => {
  test('throws naming only the first argument, never the whole command line', () => {
    const noGit = { PATH: path.join(TEMP, 'nowhere-on-this-machine') };
    assert.throws(
      () => git(['status', '--short'], { cwd: REPO, env: noGit }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.equal(e.message.startsWith('git status:'), true);
        assert.ok(!e.message.includes('--short'), 'names only the first argument, not the rest of the command line');
        assert.ok(!e.message.includes('exited'), 'a spawn failure never reaches the exit-code branch');
        return true;
      }
    );
  });
});

describe('the raised buffer cap and a signal-killed git', () => {
  test("a blob over 1 MB (Node's own spawnSync default) round-trips whole, not truncated", () => {
    const big = Buffer.alloc(1_200_000, 0x41); // 'A', over spawnSync's own 1 MB maxBuffer default
    const blobFile = path.join(TEMP, 'big.bin');
    fs.writeFileSync(blobFile, big);
    const hash = execFileSync('git', ['hash-object', '-w', '--', blobFile], {
      cwd: REPO,
      env: CHILD_ENV,
      encoding: 'utf8'
    }).trim();
    const out = git(['show', hash], { cwd: REPO, env: CHILD_ENV });
    if (typeof out === 'string') throw new Error('expected a Buffer, not a string');
    assert.equal(out.length, big.length);
    assert.ok(out.equals(big), 'the round-tripped bytes match exactly, nothing truncated');
  });

  test('a git killed by a real signal (status null, no spawn error) throws, never returns partial stdout', () => {
    if (process.platform === 'win32') {
      console.log(
        'SKIP  a signal-killed git (Windows reports a plain exit code for a killed child, never status:null/signal:<name>; POSIX only)'
      );
      return;
    }
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-stub-'));
    const stubGit = path.join(stubDir, 'git');
    // Self-inflicted SIGKILL, not a spawnSync timeout: a timeout kill sets r.error (ETIMEDOUT), which
    // git.js already throws on through its OWN check; this proves the SEPARATE status !== 0 branch,
    // reached only when r.error is unset and r.status is null purely from the OS reporting a signal.
    fs.writeFileSync(
      stubGit,
      `#!/usr/bin/env node\nsetTimeout(() => process.kill(process.pid, 'SIGKILL'), 50);\nsetInterval(() => {}, 1000);\n`
    );
    fs.chmodSync(stubGit, 0o755);
    const stubEnv = { ...CHILD_ENV, PATH: `${stubDir}:${process.env.PATH}` };
    assert.throws(
      () => git(['show', 'x'], { cwd: REPO, env: stubEnv }),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^git show x exited null: /);
        return true;
      }
    );
    fs.rmSync(stubDir, { recursive: true, force: true });
  });
});

describe('options', () => {
  test('are merged in after the two defaults, so a caller can redirect cwd without a second function', () => {
    const other = path.join(TEMP, 'other');
    fs.mkdirSync(other, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other, env: CHILD_ENV });
    const top = git(['rev-parse', '--show-toplevel'], { cwd: other, env: CHILD_ENV }).toString('utf8').trim();
    // native, because the JavaScript realpath leaves a Windows short name such as RUNNER~1 in the temp
    // path unexpanded, while git prints the long one.
    assert.equal(fs.realpathSync.native(top), fs.realpathSync.native(other));
  });

  test('a callers own encoding wins over the buffer default, because options is spread in last', () => {
    const out = git(['rev-parse', 'HEAD'], { cwd: REPO, env: CHILD_ENV, encoding: 'utf8' });
    assert.equal(typeof out, 'string', 'the caller asked for utf8, so the default buffer encoding must not win');
    assert.equal(String(out).trim().length, 40);
  });
});

test('an import and a require load the one function', () => {
  assert.equal(require(MODULE).git, git);
  assert.deepEqual(Object.keys(require(MODULE)), ['git']);
});
