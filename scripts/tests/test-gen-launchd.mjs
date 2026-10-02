#!/usr/bin/env node
// @ts-check
// scripts/tests/test-gen-launchd.mjs - the launchd generator's guard rails, run on every commit.
//
// WHAT. Proves scripts/lib/gen-launchd.js refuses what launchd cannot express and writes what it can.
// L1 and L1c: "first Monday of the month", "last day" and the weekly-looking phrases beside them are
// refused, never emitted, because launchd fires a Day plus Weekday dict on either match and has no
// day-of-month for "last day"; a logon-plus-delay phrase refuses too, having no wall clock. L3: the
// real schedule generates with no refusal, one plist per schedulable job plus the catchup agent, and
// the recovery sweep is a named skip. L4: a label is the job name as written, the agent runs
// run-job.mjs with the job's suffix, its PATH holds the keg-only node@24, and only the catchup agent
// runs at load. L5: the accepted grammar parses, weekly with a Weekday key and never a Day key. L6: on
// apply, a link that cannot be replaced is logged with its own error, not the one the symlink after it
// raises. Deleted, a change that emitted a cadence launchd would misread, dropped a job without saying
// why, started every agent at login, or logged the wrong cause would pass with every other test green.
//
// HOW. gen-launchd.js writes into launchd/ and outputs/logs/launchd/ beside its own folder, and neither
// can be pointed elsewhere, so the generator and the schedule parser are loaded from a copy of what
// git sees in this checkout (tracked files, and untracked ones it does not ignore) under the OS temp
// folder. git runs with inherited GIT_* variables stripped and an empty config. The copy is removed on
// exit, a crash included. plutil exists only on macOS, so lint is null here by design, and the macOS
// CI job is where it runs for real. L6 applies in a child node whose platform reads darwin, whose
// child_process answers id and launchctl list and runs nothing, and whose home is under the temp folder.
//
// NEVER. Writes into this checkout, reaches a network, or loads an agent: generate runs without apply,
// except in L6's child, where every scheduler call is a stub.
//
// Usage: node scripts/tests/test-gen-launchd.mjs
// Exit: 0 all pass - 1 any failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-gen-launchd-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));
const REPO = path.join(TMP, 'checkout');
{
  // Inherited GIT_* is stripped and git reads an empty fixture config, so the listing is this tree's.
  fs.writeFileSync(path.join(TMP, 'gitconfig'), '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(TMP, 'gitconfig') });
  const ls = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: KIT,
    env,
    encoding: 'utf8'
  });
  if (ls.status !== 0) throw new Error(`git ls-files failed in ${KIT}: ${ls.stderr}`);
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const src = path.join(KIT, rel);
    const dst = path.join(REPO, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isFile()) fs.copyFileSync(src, dst);
  }
}
const { generate, parseMacFrequency, NO_MAC_PORT } = require(path.join(REPO, 'scripts', 'lib', 'gen-launchd.js'));
const { parseScheduleJobs } = require(path.join(REPO, 'scripts', 'lib', 'read-sources.js'));
const quiet = () => {};

describe('gen-launchd.js', () => {
  test('L5: the grammar', () => {
    assert.deepEqual(parseMacFrequency('daily 08:10'), { calendar: { Hour: 8, Minute: 10 } }, 'L5a daily HH:MM parses');
    assert.deepEqual(
      parseMacFrequency('monthly on the 1 at 10:00'),
      { calendar: { Day: 1, Hour: 10, Minute: 0 } },
      'L5b monthly-on-the-D parses'
    );
    const login = parseMacFrequency('login');
    assert.ok(login && login.runAtLoad === true, 'L5c login -> RunAtLoad');
    // L5d to L5f: the weekly branch emits a Weekday key and never a Day key, which is why weekly can be
    // expressed where "first Monday" cannot (launchd fires a Day plus Weekday dict on either match).
    assert.deepEqual(
      parseMacFrequency('weekly Monday 07:30'),
      { calendar: { Weekday: 1, Hour: 7, Minute: 30 } },
      'L5d weekly <Weekday> HH:MM parses'
    );
    assert.deepEqual(
      parseMacFrequency('weekly on Sunday at 21:00'),
      { calendar: { Weekday: 0, Hour: 21, Minute: 0 } },
      'L5e weekly-on-<Weekday>-at form parses (Sunday = 0)'
    );
    const weekly = parseMacFrequency('weekly Monday 07:30') || { calendar: {} };
    assert.ok(!('Day' in weekly.calendar), 'L5f weekly emits NO Day key (Day+Weekday would OR)');
  });

  test('L1 and L1c: the refusals, guard-class', () => {
    for (const [name, freq] of [
      ['first-Monday', 'monthly, first Monday 10:00'],
      ['last-day', 'monthly, last day 21:15'],
      ['logon-delay', 'logon + 10 min (Task Scheduler job Alex-x)']
    ]) {
      assert.equal(parseMacFrequency(freq), null, `L1 grammar refuses ${name}`);
    }
    {
      const fake = { entries: [{ jobNames: ['Alex-qc-fixture'], frequency: 'monthly, first Monday 10:00', text: '' }] };
      const r = generate(fake, { apply: false, log: quiet });
      assert.ok(
        r.refused.length === 1 && !r.written.includes('Alex-qc-fixture'),
        `L1b inexpressible cadence: refused + NOT emitted (${r.refused[0]?.reason.slice(0, 40)})`
      );
      try {
        fs.unlinkSync(path.join(REPO, 'launchd', 'Alex-qc-fixture.plist'));
      } catch {
        /* never existed - the point */
      }
    }
    // L1c: the weekly branch must not have widened the hole it sits next to. These are the strings a
    // careless /^(?:weekly|monthly).*(monday)/ would have swallowed; all three still refuse.
    for (const [name, freq] of [
      ['weekly-comma-first-Monday', 'weekly, first Monday 10:00'],
      ['first-Monday-of-the-month', 'first Monday of the month at 10:00'],
      ['monthly-last-Friday', 'monthly, last Friday 21:15']
    ]) {
      assert.equal(parseMacFrequency(freq), null, `L1c weekly branch still refuses ${name}`);
    }
  });

  test('L3: the real schedule', () => {
    const schedule = parseScheduleJobs(fs.readFileSync(path.join(REPO, 'scheduler', 'schedule.md'), 'utf8'));
    const r = generate(schedule, { apply: false, log: quiet });
    assert.equal(
      r.refused.length,
      0,
      `L3a real schedule has zero refusals (${r.refused.map((/** @type {{ job: string }} */ x) => x.job).join(',')})`
    );
    assert.ok(
      r.skipped.some((/** @type {{ job: string }} */ s) => s.job === 'Alex-recovery-check'),
      'L3b recovery-check is a NAMED skip (no macOS port)'
    );
    assert.ok(
      Object.keys(NO_MAC_PORT).every((j) => !r.written.includes(j)),
      'L3c no-port jobs are never written'
    );
    assert.ok(r.written.includes('Alex-catchup'), 'L3d catchup agent emitted');
    const expected = schedule.allJobNames.filter((/** @type {string} */ j) => !NO_MAC_PORT[j]).length + 1; // +1 catchup
    assert.equal(
      r.written.length,
      expected,
      `L3e plist count = schedulable jobs + catchup (${expected}); got ${r.written.length}`
    );
  });

  test('L4: plist shape', () => {
    const p = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-email-triage.plist'), 'utf8');
    assert.ok(p.includes('<key>Label</key><string>Alex-email-triage</string>'), 'L4a Label is the job name verbatim');
    assert.ok(
      p.includes('run-job.mjs') && p.includes('<string>email-triage</string>'),
      'L4b ProgramArguments -> run-job.mjs <suffix>'
    );
    assert.ok(p.includes('opt/node@24/bin'), 'L4c PATH carries keg-only node@24 (agents never source .zprofile)');
    const cu = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-catchup.plist'), 'utf8');
    assert.ok(
      cu.includes('<key>RunAtLoad</key><true/>') && !cu.includes('StartCalendarInterval'),
      'L4d catchup is RunAtLoad only'
    );
    const jobs = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-vault-backup.plist'), 'utf8');
    assert.ok(!jobs.includes('RunAtLoad'), 'L4e ordinary jobs never get RunAtLoad (login-storm rule)');
  });

  test('L6: apply, with the scheduler stubbed in a child', () => {
    // A folder where the agent's link goes cannot be unlinked (EPERM or EISDIR). That failure is the
    // cause the log must name, not the symlink EEXIST that would follow it if swallowed.
    const home = path.join(TMP, 'home');
    fs.mkdirSync(path.join(home, 'Library', 'LaunchAgents', 'Alex-gl1.plist', 'inside'), { recursive: true });
    const stubbedApply = [
      "const cp = require('node:child_process');",
      "Object.defineProperty(process, 'platform', { value: 'darwin' });",
      "cp.execFileSync = (cmd) => { if (cmd === 'id') return '501\\n'; throw new Error('stub: ' + cmd + ' is not run'); };",
      "cp.spawnSync = (cmd, args) => cmd === 'launchctl' && args[0] === 'list' ? { status: 0, stdout: '' } : { status: 1, stdout: '', stderr: 'stub: not run', error: cmd === 'plutil' ? new Error('stub: no plutil') : undefined };",
      'const lines = [];',
      "require(process.argv[1]).generate({ entries: [{ jobNames: ['Alex-gl1'], frequency: 'daily 01:00', text: '' }] }, { apply: true, log: (l) => lines.push(l) });",
      'console.log(JSON.stringify(lines));'
    ].join('\n');
    const child = spawnSync(
      process.execPath,
      ['-e', stubbedApply, path.join(REPO, 'scripts', 'lib', 'gen-launchd.js')],
      {
        env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: 'utf8'
      }
    );
    /** @type {string[]} */
    const lines = child.status === 0 ? JSON.parse(child.stdout) : [];
    const failed = lines.find((l) => l.startsWith('  gen-launchd: bootstrap FAILED for Alex-gl1: ')) ?? '';
    assert.ok(
      /: E[A-Z]+: [^,]+, unlink '/.test(failed) && !failed.includes('EEXIST'),
      `L6 a link that cannot be replaced is logged with its own unlink error (${failed || child.stderr.trim().slice(0, 200)})`
    );
  });
});
