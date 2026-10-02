#!/usr/bin/env node
// scripts/tests/test-generate-cli.mjs - a typo on the generator's command line must never change a machine.
//
// WHAT. scripts/generate-alex.js ends a full run by registering scheduled tasks on THIS machine (its
// step 4), so an argument it does not recognise must never fall through to that full run. An argument
// outside `--dry-run`, one `--only=<list>` and `--help`/`-h` is refused with exit 2 and a usage line
// BEFORE any module that can touch the machine is even loaded, and `--help` prints the usage and touches
// nothing. Deleted, this test would let an unrecognised flag on the command line silently reach the
// scheduler.
//
// HOW. Each case runs the REAL generator under a preloaded tripwire (written into the OS temp
// directory at run time). The tripwire replaces every module the generator loads that can write or
// register anything (the write lock, the staging area, the validator, the soul-core builder, the log
// file, the scheduler) with a recorder, and appends one line per load and per call to a log file.
// "No side effect" is then a checkable fact: the log is empty. A fail-safe underneath refuses a real
// `schtasks /create`, `launchctl load|bootstrap` or `crontab` write outright, so even a stub that
// missed could not register anything while this test runs. The `child_process` load is matched by
// either spelling (`child_process` or `node:child_process`): the generator's own choice of prefix is
// not this test's to freeze, and a match on one spelling only stops engaging with nothing anywhere
// failing when the generator's require changes. G0 is the positive control and must stay: it runs a
// VALID dry-run through the same tripwire, requires the log to show the lock and the scheduler step
// being reached AND the `child_process` stub itself having loaded, so an empty log below reads as
// "not reached", not "the tripwire records nothing at all" - without it every NEGATIVE case would pass
// vacuously, and a missed load would pass silently too.
//
// NEVER. Runs the generator without the tripwire, or with a form that applies the scheduler for real.
// Wires the shared scheduler-stub fixture in: this file's own tripwire stubs validate-alex.js and
// gen-scheduler.js entirely for every module loaded from inside generate-alex.js, so no real scheduler
// call is ever attempted either way - a narrower, purpose-built mechanism, kept as is.
//
// Usage: node scripts/tests/test-generate-cli.mjs
// Exit: 0 all cases passed - 1 a case failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = path.join(KIT, 'scripts', 'generate-alex.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-generate-cli-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const TRIPWIRE = path.join(TMP, 'tripwire.cjs');

fs.writeFileSync(
  TRIPWIRE,
  `'use strict';
const Module = require('module');
const fs = require('fs');
const path = require('path');
const LOG = process.env.GEN_TRIPWIRE_LOG;
const note = (s) => fs.appendFileSync(LOG, s + '\\n');

// Fail-safe first: whatever loads, no real scheduler write can happen in this process.
const cp = require('child_process');
const realExecFileSync = cp.execFileSync;
const WRITE_VERBS = { schtasks: ['/create', '/change', '/delete'], launchctl: ['load', 'bootstrap', 'unload', 'bootout'], crontab: ['-'] };
cp.execFileSync = function (cmd, args, ...rest) {
  const base = path.basename(String(cmd)).replace(/\\.exe$/i, '').toLowerCase();
  const verbs = WRITE_VERBS[base];
  if (verbs && (args || []).some(a => verbs.includes(String(a).toLowerCase()))) {
    note('BLOCKED real ' + base + ' ' + (args || []).join(' '));
    throw new Error('tripwire: refused a real scheduler write');
  }
  return realExecFileSync.call(this, cmd, args, ...rest);
};

const STUBS = {
  'gen-scheduler.js': { run: async (o) => { note('scheduler.run apply=' + Boolean(o && o.apply)); return { applied: [] }; } },
  'write-lock.js': { acquire: () => { note('write-lock.acquire'); return { ok: true, release() { note('write-lock.release'); } }; },
                     lockPath: () => '(stub)', DEFAULT_NAME: 'stub' },
  'atomic-write.js': { STAGING: path.join(path.dirname(LOG), 'no-staging'), reset() { note('staging.reset'); },
                       stage(rel) { note('staging.stage ' + rel); }, stagedFiles() { return []; }, swapAll() { note('staging.swap'); return []; } },
  'validate-alex.js': { runAll: async () => { note('validate.runAll'); return { ok: true, failures: [] }; }, SUITE_RANGE: '(stub)' },
  'build-soul-core.js': { build: () => { note('soul-core.build'); return { skipped: true }; } },
  'log.js': { step: (s) => { process.stdout.write(String(s) + '\\n'); }, flush: () => { note('log.flush'); }, LOG_PATH: '(stub)' },
};
const fromGenerator = (parent) => Boolean(parent && /generate-alex\\.js$/.test(parent.filename || ''));
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (fromGenerator(parent)) {
    if (/^(node:)?child_process$/.test(request)) {
      note('load child_process');
      return Object.assign({}, cp, { execSync: (cmd) => { note('execSync ' + String(cmd).split(' ').slice(0, 2).join(' ')); return Buffer.from(''); } });
    }
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { /* let the real loader report it */ }
    const stub = resolved && STUBS[path.basename(resolved)];
    if (stub) { note('load ' + path.basename(resolved)); return stub; }
  }
  return realLoad.apply(this, arguments);
};
`
);

function run(args, label) {
  const logFile = path.join(TMP, `${label}.log`);
  const r = spawnSync(process.execPath, ['--require', TRIPWIRE, GEN, ...args], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, GEN_TRIPWIRE_LOG: logFile },
    timeout: 120000
  });
  const trip = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', trip };
}
const show = (r) =>
  `exit ${r.status}; tripwire: ${r.trip.length ? `${r.trip.slice(0, 6).join(' | ')}${r.trip.length > 6 ? ` (+${r.trip.length - 6})` : ''}` : 'nothing loaded, nothing called'}`;
const USAGE_RE = /usage: node scripts\/generate-alex\.js/;

// In a generated online tree (no variants/online) the generator's step 4 names the scheduler skipped
// and never calls it (the Routines are the schedule there), so the control asserts that step line and
// the absent call instead. The lock is recorded in both trees, which is what keeps G1..G7 honest.
const ONLINE_TREE = !fs.existsSync(path.join(KIT, 'variants', 'online'));

describe('generate-alex.js CLI: an unrecognised argument must never reach the scheduler', () => {
  test('G0 control: a VALID dry-run is recorded reaching the lock and the scheduler step', () => {
    const r = run(['--dry-run', '--only=scheduler'], 'g0');
    const reached = ONLINE_TREE
      ? r.stdout
          .split(/\r?\n/)
          .includes(
            '[4/5] scheduler skipped (online tree: the Routines are the schedule, and nothing registers on this machine)'
          ) && !r.trip.some((l) => l.startsWith('scheduler.run'))
      : r.trip.includes('scheduler.run apply=false');
    assert.ok(
      r.status === 0 && r.trip.includes('write-lock.acquire') && reached,
      `${show(r)}${ONLINE_TREE ? ' (online tree: the scheduler step is named skipped and never called)' : ''}`
    );
    assert.ok(!r.trip.some((l) => l.startsWith('BLOCKED')), `the fail-safe never had to fire (${show(r)})`);
    // generate-alex.js requires 'node:child_process'; a stub keyed on the bare name alone
    // stops engaging with no failure anywhere in this file, and the generator's advisory steps then run
    // real children silently. This line is the guard: if the stub's request match misses the module the
    // generator actually asks for, this fails loudly instead of the log quietly losing a line.
    assert.ok(r.trip.includes('load child_process'), `the child_process stub engaged (${show(r)})`);
  });

  for (const [id, args, what] of [
    ['G1', ['--bogus'], 'an unknown flag'],
    ['G2', ['--only', 'docs'], '`--only docs` with a space (the list becomes a stray argument)'],
    ['G3', ['--only=nope'], 'an unknown --only value'],
    ['G4', ['docs'], 'a stray positional argument'],
    ['G5', ['--dry-run', '--bogus'], 'a valid flag beside an unknown one (the valid one does not launder it)'],
    ['G6', ['--only='], 'an empty --only list']
  ]) {
    test(`${id} NEGATIVE ${what} is refused with exit 2, loads no side-effecting module and calls nothing`, () => {
      const r = run(args, id.toLowerCase());
      assert.equal(r.status, 2, show(r));
      assert.equal(r.trip.length, 0, `scheduler step never reached (${show(r)})`);
      assert.ok(/REFUSED/.test(r.stderr) && USAGE_RE.test(r.stderr), r.stderr.trim().split('\n')[0]);
    });
  }

  test('G7 --help is read-only: prints the usage, exits 0, loads and calls nothing, even beside an unknown flag', () => {
    for (const flag of ['--help', '-h']) {
      const r = run([flag], `g7${flag.replace(/-/g, '')}`);
      assert.ok(r.status === 0 && USAGE_RE.test(r.stdout), `${flag}: ${show(r)}`);
      assert.equal(r.trip.length, 0, `${flag}: ${show(r)}`);
    }
    const r = run(['--help', '--bogus'], 'g7mixed');
    assert.ok(r.status === 0 && r.trip.length === 0, show(r));
  });

  test('G8 the usage lists every valid --only value (derived, so it cannot go stale)', () => {
    const src = fs.readFileSync(GEN, 'utf8');
    const m = src.match(/const VALID_ONLY = \[([^\]]*)\]/);
    const valid = m ? [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : [];
    const r = run(['--help'], 'g8');
    const missing = valid.filter((v) => !r.stdout.includes(v));
    assert.ok(
      valid.length > 0 && missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${valid.length} listed`
    );
  });
});
