#!/usr/bin/env node
// @ts-check
// scripts/tests/test-write-lock-contract.mjs - the shared write lock: held, refused, stale, stolen, released.
//
// WHAT. Proves scripts/lib/write-lock.js, the one lock the generator, the soul-card builder, status-rotate,
// skills-park and the online-template builder take before they write: its exports, default name and window;
// a free lock taken with a holder file naming label, pid and start time; a held lock refused with its holder
// named; a lock past the window stolen and the steal logged; release touching only a lock this process holds;
// withLock releasing after a result or a throw; and a claim whose holder file cannot be written leaving no
// folder behind. Deleted, it would let the holder file's bytes, the refusal wording its callers print, the
// window, a release that removes another run's lock, or a lock left naming no one change unseen: the
// holders' own tests take the lock only on the path where it is free.
//
// HOW. The module is copied alone into a fresh temp scripts/lib/ for each test, so its root, two folders up,
// is that test's own folder with its own lock folder. Five other test files also copy it with no
// repo-root.js beside it, which is why the module keeps its own root. An old lock is planted as a folder with
// a holder file and its modification time set back. Each PINNED DEFECT test asserts a defect as the code has
// it today, so the fix flips that named test.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-write-lock-contract.mjs
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
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-write-lock-')));
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

let seq = 0;
/** A new root holding a lone copy of the module under scripts/lib/, and that copy loaded. */
function fresh() {
  const root = path.join(ROOT, `r${++seq}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'write-lock.js'),
    path.join(root, 'scripts', 'lib', 'write-lock.js')
  );
  return { root, lock: require(path.join(root, 'scripts', 'lib', 'write-lock.js')) };
}
/**
 * Plant a lock folder, with a holder file when one is given (a string is written as it is), aged by minutes.
 * @param {string} dir
 * @param {string | object} [holder]
 * @param {number} [ageMinutes]
 */
function plant(dir, holder, ageMinutes) {
  fs.mkdirSync(dir);
  if (holder !== undefined)
    fs.writeFileSync(
      path.join(dir, 'holder.json'),
      typeof holder === 'string' ? holder : JSON.stringify(holder, null, 2)
    );
  if (ageMinutes) {
    const t = new Date(Date.now() - ageMinutes * 60 * 1000);
    fs.utimesSync(dir, t, t);
  }
}
/**
 * Make every write of a holder.json throw the given error for the rest of the test; other writes go through.
 * @param {import('node:test').TestContext} t
 * @param {Error} error
 */
function holderWriteFails(t, error) {
  const write = fs.writeFileSync;
  /** @type {typeof fs.writeFileSync} */
  const failHolder = (file, data, options) => {
    if (String(file).endsWith('holder.json')) throw error;
    write(file, data, options);
  };
  t.mock.method(fs, 'writeFileSync', failHolder);
}

describe('write-lock', () => {
  test('the exports, the default name and window, and where a lock lives', () => {
    const { root, lock } = fresh();
    assert.deepEqual(Object.keys(lock), [
      'acquire',
      'withLock',
      'lockPath',
      'DEFAULT_NAME',
      'DEFAULT_STALE_MS',
      'REPO'
    ]);
    assert.equal(lock.DEFAULT_NAME, 'alex-surfaces');
    assert.equal(lock.DEFAULT_STALE_MS, 30 * 60 * 1000);
    assert.equal(lock.REPO, root, 'REPO is two folders above the module, so it works copied alone');
    assert.equal(lock.lockPath('alex-surfaces'), path.join(root, '.alex-lock-alex-surfaces'));
  });

  test('a free lock: acquired with a holder file naming label, pid and start; released exactly once; a second release is a harmless true', () => {
    const { lock } = fresh();
    const held = lock.acquire({ label: 'test run' });
    assert.equal(held.ok, true);
    assert.equal(held.holder, null);
    assert.equal(held.reason, null);
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    const text = fs.readFileSync(path.join(dir, 'holder.json'), 'utf8');
    const h = JSON.parse(text);
    assert.deepEqual(Object.keys(h), ['label', 'pid', 'since']);
    assert.equal(h.label, 'test run');
    assert.equal(h.pid, process.pid);
    assert.match(h.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(text, JSON.stringify(h, null, 2), 'two-space JSON, no trailing newline');
    assert.equal(held.release(), true);
    assert.ok(!fs.existsSync(dir));
    assert.equal(held.release(), true);
  });

  test("a held lock refuses a second taker with the holder named, and that taker's release touches nothing", () => {
    const { lock } = fresh();
    const a = lock.acquire({ label: 'first' });
    const since = JSON.parse(fs.readFileSync(path.join(lock.lockPath(lock.DEFAULT_NAME), 'holder.json'), 'utf8')).since;
    const b = lock.acquire({ label: 'second' });
    assert.equal(b.ok, false);
    assert.equal(b.reason, `held by first (pid ${process.pid}) since ${since}`);
    assert.deepEqual(b.holder, { label: 'first', pid: process.pid, since });
    assert.equal(b.release(), false);
    assert.ok(fs.existsSync(lock.lockPath(lock.DEFAULT_NAME)));
    assert.equal(a.release(), true);
  });

  test('a lock whose holder file names another pid is not released by the original holder', () => {
    const { lock } = fresh();
    const a = lock.acquire({ label: 'first' });
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    fs.writeFileSync(path.join(dir, 'holder.json'), JSON.stringify({ label: 'thief', pid: 424242, since: 'x' }));
    assert.equal(a.release(), false);
    assert.ok(fs.existsSync(dir));
  });

  test('a lock older than the window is stolen, the steal is logged with its age and holder, and the new holder is this process', () => {
    const { lock } = fresh();
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    const old = { label: 'crashed run', pid: 424242, since: '2026-09-25T07:00:00.000Z' };
    plant(dir, old, 45);
    /** @type {string[]} */
    const said = [];
    const held = lock.acquire({ label: 'next run', log: (/** @type {string} */ m) => said.push(m) });
    assert.equal(held.ok, true);
    assert.equal(held.reason, 'stole-stale');
    assert.deepEqual(held.holder, old);
    assert.deepEqual(said, [
      "write-lock: stealing a STALE 'alex-surfaces' lock (age 45min, holder crashed run pid 424242) - a prior run almost certainly crashed"
    ]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'holder.json'), 'utf8')).pid, process.pid);
    assert.equal(held.release(), true);
  });

  test("PINNED DEFECT R6-15: staleness is the directory's age alone: a LIVE holder (this very process) past the window is stolen, whatever its start time says", () => {
    const { lock } = fresh();
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    plant(dir, { label: 'a long run, still alive', pid: process.pid, since: new Date().toISOString() }, 31);
    const held = lock.acquire({ label: 'second writer' });
    assert.equal(held.ok, true);
    assert.equal(held.reason, 'stole-stale');
  });

  test('PINNED DEFECT R6-28: no holder file, a corrupt holder file, and a FILE at the lock path all read "no holder file yet"', () => {
    for (const shape of ['empty dir', 'corrupt holder', 'file at the path']) {
      const { lock } = fresh();
      const dir = lock.lockPath(lock.DEFAULT_NAME);
      if (shape === 'empty dir') plant(dir);
      if (shape === 'corrupt holder') plant(dir, '{ not json');
      if (shape === 'file at the path') fs.writeFileSync(dir, 'a file where the lock goes\n');
      const r = lock.acquire({ label: 'x' });
      assert.equal(r.ok, false, shape);
      assert.equal(r.reason, 'held by an unknown process (no holder file yet)', shape);
      assert.equal(r.holder, null, shape);
    }
  });

  test('a lock under another name is independent of the default', () => {
    const { lock } = fresh();
    const a = lock.acquire({ label: 'surfaces' });
    const b = lock.acquire({ name: 'fleet', label: 'fleet' });
    assert.equal(b.ok, true);
    assert.ok(fs.existsSync(lock.lockPath('fleet')));
    b.release();
    a.release();
  });

  test('withLock runs the function under the lock and releases it after a result, after a throw, and never runs it when held', async () => {
    const { lock } = fresh();
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    const ok = await lock.withLock({ label: 'w' }, () => {
      assert.ok(fs.existsSync(dir), 'held inside');
      return 7;
    });
    assert.deepEqual(ok, { ok: true, value: 7, reason: null });
    assert.ok(!fs.existsSync(dir));
    await assert.rejects(
      lock.withLock({ label: 'w' }, () => {
        throw new Error('inside');
      }),
      /inside/
    );
    assert.ok(!fs.existsSync(dir), 'released after the throw');
    const other = lock.acquire({ label: 'holder' });
    let ran = false;
    const refused = await lock.withLock({ label: 'w' }, () => {
      ran = true;
    });
    assert.equal(ran, false);
    assert.equal(refused.ok, false);
    assert.equal(refused.value, undefined);
    assert.match(refused.reason, /^held by holder \(pid \d+\) since /);
    other.release();
  });

  test('a holder file that cannot be written: the claim throws that error, removes the folder it made, and the next taker is not refused', (t) => {
    const { lock } = fresh();
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    const denied = Object.assign(new Error('EACCES: permission denied (planted)'), { code: 'EACCES' });
    holderWriteFails(t, denied);
    assert.throws(
      () => lock.acquire({ label: 'first' }),
      (/** @type {unknown} */ e) => e === denied
    );
    t.mock.restoreAll();
    assert.ok(!fs.existsSync(dir), 'no lock folder is left naming no one');
    const next = lock.acquire({ label: 'second' });
    assert.equal(next.ok, true, `the next taker is not refused: ${next.reason}`);
    assert.equal(next.release(), true);
  });

  test('a stale lock whose new holder file cannot be written: the steal is refused with that error and leaves no folder', (t) => {
    const { lock } = fresh();
    const dir = lock.lockPath(lock.DEFAULT_NAME);
    const old = { label: 'crashed run', pid: 424242, since: '2026-09-25T07:00:00.000Z' };
    plant(dir, old, 45);
    holderWriteFails(t, new Error('EACCES: permission denied (planted)'));
    const held = lock.acquire({ label: 'next run' });
    t.mock.restoreAll();
    assert.deepEqual(
      [held.ok, held.reason, held.holder],
      [false, 'stale-steal failed: EACCES: permission denied (planted)', old]
    );
    assert.equal(held.release(), false);
    assert.ok(!fs.existsSync(dir), 'no lock folder is left naming no one');
  });
});
