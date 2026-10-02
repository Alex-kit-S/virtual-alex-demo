#!/usr/bin/env node
// @ts-check
// scripts/tests/test-staged-paths.mjs - the protected-file guard's two staged-change listings.
//
// WHAT. Proves scripts/lib/staged-paths.js's stagedNameStatus and stagedNumstat, the protected-file
// guard's own two listings (scripts/lib/validate/commit.js's V10 and V11): every status including a
// real rename record, a removed-line count per modified path, and the same thrown-Error shape on a git
// failure, never git's own stderr echoed to this process's stderr as well. Deleted, this file would let
// the protected-file guard misjudge a rename or a line count, or a git failure come back as an empty
// result instead of a loud throw.
//
// HOW. Runs git for real inside a throwaway repository under the OS temp folder, removed at the end;
// git runs with no system or global configuration reachable, so nothing on this machine's real config
// can change a result.
//
// NEVER. Writes outside its own temp folder.
//
// Usage: node scripts/tests/test-staged-paths.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stagedNameStatus, stagedNumstat } from '../lib/staged-paths.js';

const MODULE = fileURLToPath(new URL('../lib/staged-paths.js', import.meta.url));
const require = createRequire(import.meta.url);
const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-staged-paths-')));
after(() => fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 }));

const GITCFG = path.join(TEMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
const ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_CEILING_DIRECTORIES: TEMP };

let n = 0;
let REPO = '';

/** @param {string[]} args */
function git(args) {
  return execFileSync('git', args, { cwd: REPO, env: ENV, encoding: 'utf8' });
}

/**
 * @param {string} rel
 * @param {string} content
 */
function put(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

// A fresh repository per test, so "what is staged" never carries over from the last one.
beforeEach(() => {
  REPO = path.join(TEMP, `r${++n}`);
  fs.mkdirSync(REPO, { recursive: true });
  git(['init', '-q', '-b', 'main']);
  git([
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@localhost',
    'commit',
    '-q',
    '--allow-empty',
    '--no-verify',
    '-m',
    'seed'
  ]);
});

// staged-paths.js runs git with the caller's cwd through options, exactly like git.js; every call below
// passes { cwd: REPO, env: ENV } so it never touches the real checkout this test runs from.
const opts = () => ({ cwd: REPO, env: ENV });

describe("stagedNameStatus and stagedNumstat, the protected-file guard's own two listings", () => {
  test('nothing staged: an empty array and an empty map', () => {
    assert.deepEqual(stagedNameStatus(opts()), []);
    assert.deepEqual(stagedNumstat(opts()), new Map());
  });

  test("an add, a modify and a delete: every status, not just AM, with the modify's removed-line count", () => {
    put('modified.md', 'one\ntwo\nthree\n');
    put('deleted.md', 'gone\n');
    git(['add', 'modified.md', 'deleted.md']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '--no-verify', '-m', 'seed']);
    put('added.md', 'x\n');
    put('modified.md', 'one\n'); // two of three lines removed
    fs.rmSync(path.join(REPO, 'deleted.md'));
    git(['add', '-A']);
    assert.deepEqual(
      stagedNameStatus(opts())
        .map((c) => `${c.status} ${c.path}`)
        .sort(),
      ['A added.md', 'D deleted.md', 'M modified.md']
    );
    // numstat reports every changed text path, not only M: added.md has 0 removed, deleted.md's whole
    // line count shows as removed. readStagedChangeset only ever looks this map up for an M path.
    assert.deepEqual(
      stagedNumstat(opts()),
      new Map([
        ['added.md', '0'],
        ['deleted.md', '1'],
        ['modified.md', '2']
      ])
    );
  });

  test('a rename is its own status, with both paths named, never folded into a plain add', () => {
    put('old.txt', 'line one\nline two\nline three\n');
    git(['add', 'old.txt']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '--no-verify', '-m', 'seed old.txt']);
    git(['mv', 'old.txt', 'new.txt']);
    assert.deepEqual(stagedNameStatus(opts()), [{ status: 'R', oldPath: 'old.txt', path: 'new.txt' }]);
  });

  test("a binary modify numstats as '-', git's own mark, never a number", () => {
    put('seed.bin', 'x');
    git(['add', 'seed.bin']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '--no-verify', '-m', 'seed seed.bin']);
    fs.writeFileSync(path.join(REPO, 'seed.bin'), Buffer.from([0x41, 0x00, 0x42]));
    git(['add', 'seed.bin']);
    assert.equal(stagedNumstat(opts()).get('seed.bin'), '-');
  });

  test("a git failure (outside any repository) throws one clean Error, git's stderr folded into the message and never echoed to this process's own stderr", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'test-staged-paths-outside-'));
    const outsideOpts = { cwd: outside, env: { ...ENV, GIT_CEILING_DIRECTORIES: outside } };
    assert.throws(
      () => stagedNameStatus(outsideOpts),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^git diff --cached --name-status -z exited 129: /);
        return true;
      }
    );
    assert.throws(
      () => stagedNumstat(outsideOpts),
      (e) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^git diff --cached --numstat -z exited 129: /);
        return true;
      }
    );
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

test('an import and a require load the same two functions', () => {
  const mod = require(MODULE);
  assert.equal(mod.stagedNameStatus, stagedNameStatus);
  assert.equal(mod.stagedNumstat, stagedNumstat);
  assert.deepEqual(Object.keys(mod).sort(), ['stagedNameStatus', 'stagedNumstat']);
});
