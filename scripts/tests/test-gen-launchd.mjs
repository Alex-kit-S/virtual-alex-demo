#!/usr/bin/env node
// scripts/tests/test-gen-launchd.mjs - the launchd generator's guard rails, committed (release-QC
// finding #3, 2026-08-31: the refusals were demonstrated ad hoc and recorded only in a commit
// body; nothing re-ran them. A guard that ran once is a guard that can silently rot).
//
//   L1  the two cadences launchd cannot express are REFUSED, never emitted
//       (Day+Weekday is OR: "first Monday" would fire ~9x a month; no negative day-of-month)
//   L2  logon+delay cadences (the Windows lines) refuse too - no wall clock to map to
//   L3  the real schedule generates: every non-skipped job gets a plist, the catchup agent is
//       RunAtLoad, and Alex-recovery-check is a NAMED skip (no silent absence)
//   L4  plist shape: Label matches the job name verbatim, ProgramArguments runs run-job.mjs
//       with the stripped suffix, PATH carries the keg-only node@24 bin
//   L5  parseMacFrequency accepts exactly the documented grammar
//
// Exit 0 = all pass, 1 = any failure. Windows/Linux run everything except plutil (tri-state
// null there by design); the macos CI job is where lint runs for real.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { generate, parseMacFrequency, NO_MAC_PORT } = require('../lib/gen-launchd.js');
const { parseScheduleJobs } = require('../lib/read-sources.js');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};
const quiet = () => {};

// --- L5: the grammar ---------------------------------------------------------------------------
ok(JSON.stringify(parseMacFrequency('daily 08:10')) === JSON.stringify({ calendar: { Hour: 8, Minute: 10 } }), 'L5a daily HH:MM parses');
ok(JSON.stringify(parseMacFrequency('monthly on the 1 at 10:00')) === JSON.stringify({ calendar: { Day: 1, Hour: 10, Minute: 0 } }), 'L5b monthly-on-the-D parses');
ok(parseMacFrequency('login') && parseMacFrequency('login').runAtLoad === true, 'L5c login -> RunAtLoad');
// L5d-f: the weekly branch (added with #15 radar). Weekday-ONLY, never a Day key - that is the
// whole reason weekly is expressible where "first Monday" is not (Day+Weekday is OR in launchd).
ok(JSON.stringify(parseMacFrequency('weekly Monday 07:30')) === JSON.stringify({ calendar: { Weekday: 1, Hour: 7, Minute: 30 } }), 'L5d weekly <Weekday> HH:MM parses');
ok(JSON.stringify(parseMacFrequency('weekly on Sunday at 21:00')) === JSON.stringify({ calendar: { Weekday: 0, Hour: 21, Minute: 0 } }), 'L5e weekly-on-<Weekday>-at form parses (Sunday = 0)');
ok(!('Day' in (parseMacFrequency('weekly Monday 07:30') || {}).calendar), 'L5f weekly emits NO Day key (Day+Weekday would OR)');

// --- L1 + L2: the refusals (guard-class; these are the I3 negatives, now permanent) ------------
for (const [name, freq] of [
  ['first-Monday', 'monthly, first Monday 10:00'],
  ['last-day', 'monthly, last day 21:15'],
  ['logon-delay', 'logon + 10 min (Task Scheduler job Alex-x)'],
]) {
  ok(parseMacFrequency(freq) === null, `L1 grammar refuses ${name}`);
}
{
  const fake = { entries: [{ jobNames: ['Alex-qc-fixture'], frequency: 'monthly, first Monday 10:00', text: '' }] };
  const r = generate(fake, { apply: false, log: quiet });
  ok(r.refused.length === 1 && !r.written.includes('Alex-qc-fixture'), 'L1b inexpressible cadence: refused + NOT emitted', r.refused[0] && r.refused[0].reason.slice(0, 40));
  try { fs.unlinkSync(path.join(REPO, 'launchd', 'Alex-qc-fixture.plist')); } catch { /* never existed - the point */ }
}
// L1c: the weekly branch must not have widened the hole it sits next to. These are the strings a
// careless /^(?:weekly|monthly).*(monday)/ would have swallowed; all three still refuse.
for (const [name, freq] of [
  ['weekly-comma-first-Monday', 'weekly, first Monday 10:00'],
  ['first-Monday-of-the-month', 'first Monday of the month at 10:00'],
  ['monthly-last-Friday', 'monthly, last Friday 21:15'],
]) {
  ok(parseMacFrequency(freq) === null, `L1c weekly branch still refuses ${name}`);
}

// --- L3: the real schedule ---------------------------------------------------------------------
const schedule = parseScheduleJobs(fs.readFileSync(path.join(REPO, 'scheduler', 'schedule.md'), 'utf8'));
const r = generate(schedule, { apply: false, log: quiet });
ok(r.refused.length === 0, 'L3a real schedule has zero refusals', r.refused.map((x) => x.job).join(','));
ok(r.skipped.some((s) => s.job === 'Alex-recovery-check'), 'L3b recovery-check is a NAMED skip (no macOS port)');
ok(Object.keys(NO_MAC_PORT).every((j) => !r.written.includes(j)), 'L3c no-port jobs are never written');
ok(r.written.includes('Alex-catchup'), 'L3d catchup agent emitted');
const expected = schedule.allJobNames.filter((j) => !NO_MAC_PORT[j]).length + 1; // +1 catchup
ok(r.written.length === expected, `L3e plist count = schedulable jobs + catchup (${expected})`, `got ${r.written.length}`);

// --- L4: plist shape ---------------------------------------------------------------------------
{
  const p = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-email-triage.plist'), 'utf8');
  ok(p.includes('<key>Label</key><string>Alex-email-triage</string>'), 'L4a Label is the job name verbatim');
  ok(p.includes('run-job.mjs') && p.includes('<string>email-triage</string>'), 'L4b ProgramArguments -> run-job.mjs <suffix>');
  ok(p.includes('opt/node@24/bin'), 'L4c PATH carries keg-only node@24 (agents never source .zprofile)');
  const cu = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-catchup.plist'), 'utf8');
  ok(cu.includes('<key>RunAtLoad</key><true/>') && !cu.includes('StartCalendarInterval'), 'L4d catchup is RunAtLoad only');
  const jobs = fs.readFileSync(path.join(REPO, 'launchd', 'Alex-vault-backup.plist'), 'utf8');
  ok(!jobs.includes('RunAtLoad'), 'L4e ordinary jobs never get RunAtLoad (login-storm rule)');
}

console.log('');
if (failures === 0) {
  console.log('test-gen-launchd: ALL PASS');
  process.exit(0);
} else {
  console.log(`test-gen-launchd: ${failures} FAILURE(S)`);
  process.exit(1);
}
