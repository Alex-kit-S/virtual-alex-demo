#!/usr/bin/env node
// scripts/tests/test-generate-cli.mjs - a typo on the generator's command line must never change a machine.
//
// WHAT. scripts/generate-alex.js ends a full run by registering scheduled tasks on THIS machine (its
// step 4). Until 2026-09-24 (fleet Fix D, from Fix B's own finding 8) the parser knew two forms,
// `--dry-run` and `--only=<list>`, and treated EVERYTHING else as "no flags": `--help`, a misspelt
// flag, and `--only docs` with a space all started that full run. Fix B's `--help` stopped only because
// a pipe closed after validation. This test holds the refusal in place: an argument the generator does
// not know is refused with exit 2 and a usage line BEFORE any module that can touch the machine is
// even loaded, and `--help` prints the usage and touches nothing.
//
// HOW. Each case runs the REAL generator under a preloaded tripwire (written into the OS temp
// directory at run time). The tripwire replaces every module the generator loads that can write or
// register anything (the write lock, the staging area, the validator, the soul-core builder, the log
// file, the scheduler) with a recorder, and appends one line per load and per call to a log file.
// "No side effect" is then a checkable fact: the log is empty. A fail-safe underneath refuses a real
// `schtasks /create`, `launchctl load|bootstrap` or `crontab` write outright, so even a stub that
// missed could not register anything while this test runs.
//
// G0 is the positive control and must stay: it runs a VALID dry-run through the same tripwire and
// requires the log to show the lock and the scheduler step being reached. Without it an empty log
// could mean the tripwire records nothing at all, and every NEGATIVE below would pass vacuously.
//
// NEVER. It never runs the generator without the tripwire, and never with a form that applies the
// scheduler for real.
//
// Run: node scripts/tests/test-generate-cli.mjs      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = path.join(KIT, 'scripts', 'generate-alex.js');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-generate-cli-')));
const TRIPWIRE = path.join(TMP, 'tripwire.cjs');

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}

fs.writeFileSync(TRIPWIRE, `'use strict';
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
    if (request === 'child_process') {
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
`);

function run(args, label) {
  const logFile = path.join(TMP, `${label}.log`);
  const r = spawnSync(process.execPath, ['--require', TRIPWIRE, GEN, ...args],
    { cwd: KIT, encoding: 'utf8', env: { ...process.env, GEN_TRIPWIRE_LOG: logFile }, timeout: 120000 });
  const trip = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', trip };
}
const show = (r) => `exit ${r.status}; tripwire: ${r.trip.length ? r.trip.slice(0, 6).join(' | ') + (r.trip.length > 6 ? ` (+${r.trip.length - 6})` : '') : 'nothing loaded, nothing called'}`;
const USAGE_RE = /usage: node scripts\/generate-alex\.js/;

// ------------------------------------------------------------------ G0. the tripwire records (control)
{
  const r = run(['--dry-run', '--only=scheduler'], 'g0');
  ok(r.status === 0 && r.trip.includes('write-lock.acquire') && r.trip.includes('scheduler.run apply=false'),
     'G0 control: a VALID dry-run is recorded reaching the lock and the scheduler step (so an empty log below means "not reached")', show(r));
  ok(!r.trip.some(l => l.startsWith('BLOCKED')), 'G0 control: the fail-safe never had to fire', show(r));
}

// ------------------------------------------------------------------ G1..G6. refusals reach nothing
const REFUSED = [
  ['G1', ['--bogus'], 'an unknown flag'],
  ['G2', ['--only', 'docs'], '`--only docs` with a space (the list becomes a stray argument)'],
  ['G3', ['--only=nope'], 'an unknown --only value'],
  ['G4', ['docs'], 'a stray positional argument'],
  ['G5', ['--dry-run', '--bogus'], 'a valid flag beside an unknown one (the valid one does not launder it)'],
  ['G6', ['--only='], 'an empty --only list'],
];
for (const [id, args, what] of REFUSED) {
  const r = run(args, id.toLowerCase());
  ok(r.status === 2, `${id} NEGATIVE ${what} is refused with exit 2`, show(r));
  ok(r.trip.length === 0, `${id} NEGATIVE ${what} loads no side-effecting module and calls nothing (scheduler step never reached)`, show(r));
  ok(/REFUSED/.test(r.stderr) && USAGE_RE.test(r.stderr), `${id} the refusal says REFUSED and prints the usage line`, r.stderr.trim().split('\n')[0]);
}

// ------------------------------------------------------------------ G7. --help is read-only
for (const flag of ['--help', '-h']) {
  const r = run([flag], `g7${flag.replace(/-/g, '')}`);
  ok(r.status === 0 && USAGE_RE.test(r.stdout), `G7 ${flag} prints the usage and exits 0`, show(r));
  ok(r.trip.length === 0, `G7 NEGATIVE ${flag} loads no side-effecting module and calls nothing`, show(r));
}
{
  const r = run(['--help', '--bogus'], 'g7mixed');
  ok(r.status === 0 && r.trip.length === 0, 'G7 --help beside an unknown flag still only prints the usage', show(r));
}

// ------------------------------------------------------------------ G8. the usage names every surface
{
  const src = fs.readFileSync(GEN, 'utf8');
  const m = src.match(/const VALID_ONLY = \[([^\]]*)\]/);
  const valid = m ? [...m[1].matchAll(/'([a-z]+)'/g)].map(x => x[1]) : [];
  const r = run(['--help'], 'g8');
  const missing = valid.filter(v => !r.stdout.includes(v));
  ok(valid.length > 0 && missing.length === 0, 'G8 the usage lists every valid --only value (derived, so it cannot go stale)',
     missing.length ? `missing: ${missing.join(', ')}` : `${valid.length} listed`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
