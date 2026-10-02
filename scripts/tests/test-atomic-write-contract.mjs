#!/usr/bin/env node
// @ts-check
// scripts/tests/test-atomic-write-contract.mjs - the generator's stage, swap and roll-back, held from outside.
//
// WHAT. Proves scripts/lib/atomic-write.js: what it exports and where it stages, that a full swap lands every
// file and cleans up after itself, that an empty swap is refused, and that a swap failing part way puts back
// what it replaced and leaves a recovery marker naming the files it had swapped. Deleted, it would let the
// roll-back, its count, the marker's bytes or the leftover-backup warning change unseen: the generator's own
// tests only run the path where every rename succeeds.
//
// HOW. The module is copied alone into a fresh temp scripts/lib/ for each test, so its root, two folders up,
// is that test's own folder with its own .staging/ and .staging-backup/. A swap is made to fail on every
// platform by staging a file whose parent path is an existing FILE, a folder no platform can create. Each
// PINNED DEFECT test asserts a defect as the code has it today, so the fix flips that named test.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-atomic-write-contract.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-atomic-write-')));
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

let seq = 0;
/** A new root holding a lone copy of the module under scripts/lib/, and that copy loaded. */
function fresh() {
  const root = path.join(ROOT, `r${++seq}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'atomic-write.js'),
    path.join(root, 'scripts', 'lib', 'atomic-write.js')
  );
  return { root, aw: require(path.join(root, 'scripts', 'lib', 'atomic-write.js')) };
}
const read = (/** @type {string} */ p) => fs.readFileSync(p, 'utf8');
/**
 * Every console.warn line said while fn runs.
 * @param {() => void} fn
 */
function captureWarn(fn) {
  /** @type {string[]} */
  const said = [];
  const real = console.warn;
  console.warn = (...a) => said.push(a.join(' '));
  try {
    fn();
  } finally {
    console.warn = real;
  }
  return said;
}
const LEFTOVER =
  "atomic-write: found leftover .staging-backup/ from a prior run (a swap likely died mid-rollback). Check 'git status' for half-written files before it is cleared.";

/** A swap that fails on its third file: a.txt (existing), b.txt (new), then x/y.txt whose parent x is a file. */
function failingSwap() {
  const { root, aw } = fresh();
  fs.writeFileSync(path.join(root, 'a.txt'), 'old a\n');
  fs.writeFileSync(path.join(root, 'x'), 'x is a file\n');
  aw.stage('a.txt', 'new a\n');
  aw.stage('b.txt', 'new b\n');
  fs.mkdirSync(path.join(aw.STAGING, 'x'), { recursive: true });
  fs.writeFileSync(path.join(aw.STAGING, 'x', 'y.txt'), 'y\n');
  /** @type {Error | undefined} */
  let thrown;
  try {
    aw.swapAll();
  } catch (e) {
    thrown = /** @type {Error} */ (e);
  }
  return { root, aw, thrown };
}

describe('atomic-write', () => {
  test('the exports and where staging lives', () => {
    const { root, aw } = fresh();
    assert.deepEqual(Object.keys(aw), [
      'REPO',
      'STAGING',
      'reset',
      'stage',
      'stagedFiles',
      'readStaged',
      'swapAll',
      'rmrf'
    ]);
    assert.equal(aw.REPO, root);
    assert.equal(aw.STAGING, path.join(root, '.staging'));
  });

  test('stage writes under .staging and returns the path; stagedFiles lists forward-slash paths, sorted; readStaged reads one back', () => {
    const { aw } = fresh();
    const abs = aw.stage('docs/b.md', 'B\n');
    assert.equal(abs, path.join(aw.STAGING, 'docs', 'b.md'));
    aw.stage('CLAUDE.md', 'C\n');
    aw.stage('docs/a/z.md', 'Z\n');
    assert.deepEqual(aw.stagedFiles(), ['CLAUDE.md', 'docs/a/z.md', 'docs/b.md']);
    assert.equal(aw.readStaged('docs/b.md'), 'B\n');
  });

  test('swapAll puts every staged file over its real path, creates folders, returns the list, and removes staging and backup', () => {
    const { root, aw } = fresh();
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'old\n');
    aw.stage('CLAUDE.md', 'new\n');
    aw.stage('docs/deep/page.md', 'page\n');
    assert.deepEqual(aw.swapAll(), ['CLAUDE.md', 'docs/deep/page.md']);
    assert.equal(read(path.join(root, 'CLAUDE.md')), 'new\n');
    assert.equal(read(path.join(root, 'docs', 'deep', 'page.md')), 'page\n');
    assert.ok(!fs.existsSync(aw.STAGING) && !fs.existsSync(path.join(root, '.staging-backup')));
  });

  test('swapAll with nothing staged refuses with its own message', () => {
    const { aw } = fresh();
    assert.throws(() => aw.swapAll(), { message: 'atomic-write: nothing staged, refusing to swap' });
  });

  test('a swap that fails half way rolls back what it swapped, writes a recovery marker, and leaves staging and backup behind', () => {
    const { root, aw, thrown } = failingSwap();
    const m = /^atomic-write: swap failed at '(.+)' - rolled back 2 file\(s\), repo untouched$/.exec(
      /** @type {string} */ (thrown?.message)
    );
    assert.ok(m, thrown?.message);
    assert.equal(read(path.join(root, 'a.txt')), 'old a\n', 'an existing file is restored');
    assert.ok(!fs.existsSync(path.join(root, 'b.txt')), 'a new file is removed');
    const backup = path.join(root, '.staging-backup');
    assert.equal(
      read(path.join(backup, 'ROLLBACK-INCOMPLETE.txt')),
      `atomic-write swap FAILED at: ${m[1]}\nswapped-before-fail (restore these from this dir if a crash interrupts the rollback):\na.txt\nb.txt\n`
    );
    assert.equal(read(path.join(backup, 'a.txt')), 'old a\n');
    assert.ok(fs.existsSync(path.join(aw.STAGING, 'x', 'y.txt')), 'the unswapped file is still staged');
  });

  test('PINNED DEFECT R6-10: after a CLEAN rollback the next reset says a swap "likely died mid-rollback" and deletes the marker it cites', () => {
    const { root, aw } = failingSwap();
    const said = captureWarn(() => aw.reset());
    assert.deepEqual(said, [LEFTOVER]);
    assert.ok(!fs.existsSync(path.join(root, '.staging-backup')), 'the marker and the backup are gone');
    assert.ok(!fs.existsSync(aw.STAGING));
  });

  test('PINNED DEFECT R6-10: a leftover backup holding the only copy of a file is deleted by the next reset after one warning', () => {
    const { root, aw } = fresh();
    const backup = path.join(root, '.staging-backup');
    fs.mkdirSync(backup);
    fs.writeFileSync(path.join(backup, 'CLAUDE.md'), 'the only copy of the pre-swap constitution\n');
    const said = captureWarn(() => aw.reset());
    assert.deepEqual(said, [LEFTOVER]);
    assert.ok(!fs.existsSync(backup));
    assert.deepEqual(
      captureWarn(() => aw.reset()),
      [],
      'nothing is said the second time'
    );
  });

  test('PINNED DEFECT R6-18: stage() accepts a path that climbs out of .staging and writes it into the repo itself', () => {
    const { root, aw } = fresh();
    aw.stage('../escaped.txt', 'out\n');
    assert.equal(read(path.join(root, 'escaped.txt')), 'out\n');
    assert.deepEqual(aw.stagedFiles(), []);
  });

  test('PINNED DEFECT R6-18: a staged file identical to its target is still rewritten and reported as swapped', () => {
    const { root, aw } = fresh();
    fs.writeFileSync(path.join(root, 'same.txt'), 'same\n');
    aw.stage('same.txt', 'same\n');
    assert.deepEqual(aw.swapAll(), ['same.txt']);
  });

  test('PINNED DEFECT R6-18: an error while BACKING UP is thrown raw, outside the rollback, with no marker, and the backup folder is left behind', () => {
    const { root, aw } = fresh();
    fs.mkdirSync(path.join(root, 'target-is-a-folder', 'inner'), { recursive: true });
    aw.stage('first.txt', '1\n');
    aw.stage('target-is-a-folder', 'I am a file now\n');
    let thrown;
    try {
      aw.swapAll();
    } catch (e) {
      thrown = /** @type {Error} */ (e);
    }
    assert.ok(thrown, 'the swap throws');
    assert.ok(!thrown.message.startsWith('atomic-write:'), thrown.message);
    assert.ok(!fs.existsSync(path.join(root, 'first.txt')), 'nothing was swapped yet');
    assert.ok(
      fs.existsSync(path.join(root, '.staging-backup')) &&
        !fs.existsSync(path.join(root, '.staging-backup', 'ROLLBACK-INCOMPLETE.txt'))
    );
  });
});
