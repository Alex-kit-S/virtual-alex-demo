// gen-scheduler.js - scheduler/schedule.md -> Windows Task Scheduler jobs (refactor P1-S3).
// The ONLY PowerShell/Windows touchpoint in the generator (D11): schtasks is invoked as a
// subprocess. Job-naming follows the existing /cron-setup pattern: Alex-{name}, each running
// a hardened wrapper scripts/run-{name}.ps1 (never a bare `claude -p`).
//
// Idempotence + safety contract:
//   - dry-run (apply=false): parse the documented Alex-* job set from scheduler/schedule.md,
//     query the live set (schtasks /query), report missing / unknown / matched. No writes.
//   - apply: creates ONLY jobs that are documented but not registered (schtasks /create /f by job
//     name). It NEVER touches an existing job: the live jobs carry hand-applied hardening
//     (RestartCount ladders, WakeToRun, battery settings) that re-creation would silently wipe -
//     that is a documented past incident class, so "leave existing jobs alone" is a hard rule here.
//   - Alex-retry-* one-shots are ephemeral by design and excluded on both sides (same as
//     recovery check C7).
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');

// The scheduler backend for THIS platform, in the words a human reads in an error message. Callers
// use this instead of hardcoding "Windows Task Scheduler": a checker that names the wrong backend
// sends its reader to the wrong tool, which is the same defect class as printing no message at all.
function backendName() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'win32') return 'Windows Task Scheduler';
  return `no scheduler backend (platform=${process.platform})`;
}

// Documented jobs this platform deliberately CANNOT register, name -> reason. On macOS the recovery
// sweep has no port yet, so gen-launchd refuses to register it BY DESIGN. A checker that does not
// know that reports it as a permanently missing job, which trains the owner to ignore the check.
// The refusal list is published here, beside the live query, instead of being re-derived by callers.
function notRegisterable() {
  if (process.platform !== 'darwin') return {};
  return require('./gen-launchd').NO_MAC_PORT;
}

// Live Alex-* job names from whichever scheduler this platform actually runs.
//
// PLATFORM DISPATCH LIVES HERE (2026-09-20). It used to live only in run() below, while this
// function shelled straight to schtasks - so on macOS every caller died with ENOENT. Not a cosmetic
// gap: validate-alex.js V2 calls this directly, generate-alex.js runs the validator in 'generator'
// context where that failure is HARD, and the generator's step 3 throws before step 4 registers a
// single job. Install-Alex.command swallows the exit code as a warning, so the install reported
// success and left the machine with zero scheduled jobs and nothing saying so. One dispatch point
// per module boundary, which is the rule run() already states twenty lines further down.
function liveJobs() {
  if (process.platform === 'darwin') {
    try {
      return [...require('./gen-launchd').liveAgents()].sort();
    } catch (e) {
      throw new Error(`gen-scheduler: launchctl list failed: ${e.message}`);
    }
  }
  if (process.platform !== 'win32') {
    throw new Error(`gen-scheduler: ${backendName()} - Windows Task Scheduler and macOS launchd are the two supported backends`);
  }
  let csv;
  try {
    csv = execFileSync('schtasks', ['/query', '/fo', 'CSV'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`gen-scheduler: schtasks /query failed: ${e.message}`);
  }
  const names = new Set();
  for (const m of csv.matchAll(/"\\([^"\\]*Alex-[A-Za-z0-9-]+)"/g)) {
    const name = m[1];
    if (!name.startsWith('Alex-retry-')) names.add(name);
  }
  return [...names].sort();
}

// Parse a schedule.md frequency phrase into schtasks args. Conservative on purpose: anything it
// cannot parse must go through /cron-setup by hand - guessing a schedule is worse than failing.
function parseFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase();

  // LOGON triggers, and they are the default shape in this system. A wall-clock trigger assumes a
  // machine that is on at that hour. On a personal laptop it is not, WakeToRun mostly does not fire
  // on battery, and a job that never runs is the worst failure mode there is: silent. "logon + 10
  // min" means the job runs ten minutes after the owner opens the laptop, every day, whatever hour
  // that is. It also makes the task "run only when user is logged on" by construction, which is a
  // hard requirement for the desktop toast in scripts/lib/run-status.ps1 to render at all.
  // (Pointer fixed 2026-08-31: it named scripts/notify-run-status.ps1, a file that has never
  // existed in this repo - a stale pointer in the file that creates every scheduled job.)
  // schtasks wants the delay as mmmm:ss.
  const logon = f.match(/^logon(?:\s*\+\s*(\d{1,4})\s*min)?/);
  if (logon) {
    const mins = logon[1] ? parseInt(logon[1], 10) : 0;
    const args = ['/sc', 'ONLOGON'];
    if (mins > 0) args.push('/delay', `${String(mins).padStart(4, '0')}:00`);
    return args;
  }

  const time = f.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (!time) return null;
  let hh = parseInt(time[1], 10);
  const mm = time[2];
  if (time[3] === 'pm' && hh < 12) hh += 12;
  if (time[3] === 'am' && hh === 12) hh = 0;
  const st = `${String(hh).padStart(2, '0')}:${mm}`;
  if (/weekday/.test(f)) return ['/sc', 'WEEKLY', '/d', 'MON,TUE,WED,THU,FRI', '/st', st];
  const day = f.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (day) return ['/sc', 'WEEKLY', '/d', day[1].slice(0, 3).toUpperCase(), '/st', st];
  if (/monthly.*last day/.test(f)) return ['/sc', 'MONTHLY', '/mo', 'LASTDAY', '/m', '*', '/st', st];
  const dom = f.match(/monthly on the (\d{1,2})/);
  if (dom) return ['/sc', 'MONTHLY', '/d', dom[1], '/st', st];
  if (/daily|\bdays\b|3x daily/.test(f)) return ['/sc', 'DAILY', '/st', st];
  return null;
}

// Map a documented job name back to its schedule.md entry (the entry text carries the job name).
function entryForJob(schedule, jobName) {
  return schedule.entries.find(e => e.jobNames.includes(jobName)) || null;
}

async function run({ schedule, apply, log }) {
  // Platform dispatch (2026-08-31, macOS port Phase 3.8): on darwin the launchd generator owns
  // the whole job - plists from the same schedule.md, create-only bootstrap, refuse-don't-guess.
  // One dispatch point, so generate-alex.js and /cron-setup need no platform knowledge.
  if (process.platform === 'darwin') {
    const launchd = require('./gen-launchd');
    const r = launchd.generate(schedule, { apply, log });
    log(`  scheduler(launchd): ${r.written.length} plist(s) written, ${r.bootstrapped.length} bootstrapped, ${r.skipped.length} skipped, ${r.refused.length} refused`);
    return { documented: schedule.allJobNames, live: [], missing: [], unknown: [], matched: [], applied: r.bootstrapped, launchd: r };
  }
  if (process.platform !== 'win32') {
    log(`  scheduler: SKIPPED - no scheduler backend for platform=${process.platform} (Windows Task Scheduler and macOS launchd are the two supported backends)`);
    return { documented: schedule.allJobNames, live: [], missing: [], unknown: [], matched: [], applied: [], skippedLive: true };
  }
  const documented = schedule.allJobNames;
  const live = liveJobs();
  const liveSet = new Set(live);
  const docSet = new Set(documented);
  const missing = documented.filter(j => !liveSet.has(j));
  const unknown = live.filter(j => !docSet.has(j));
  const matched = documented.filter(j => liveSet.has(j));

  log(`  scheduler: documented=${documented.length} live=${live.length} matched=${matched.length}`);
  if (missing.length) log(`  scheduler: MISSING from Task Scheduler: ${missing.join(', ')}`);
  if (unknown.length) log(`  scheduler: live but NOT documented in schedule.md: ${unknown.join(', ')}`);
  if (!missing.length && !unknown.length) log('  scheduler: schedule.md and Task Scheduler agree (verified no-op)');

  if (!apply) return { documented, live, missing, unknown, matched, applied: [] };

  const applied = [];
  for (const job of missing) {
    const entry = entryForJob(schedule, job);
    if (!entry) throw new Error(`gen-scheduler: ${job} is documented but no schedule.md entry names it - fix schedule.md`);
    const schArgs = parseFrequency(entry.frequency);
    if (!schArgs)
      throw new Error(`gen-scheduler: cannot parse frequency '${entry.frequency}' for ${job} - register it via /cron-setup instead`);
    const base = job.replace(/^Alex-/, '');
    const rel = entry.script || `scripts/run-${base}.ps1`;
    const wrapper = path.join(REPO, ...rel.split('/'));
    const fsx = require('fs');
    if (!fsx.existsSync(wrapper))
      throw new Error(`gen-scheduler: ${rel} does not exist for ${job} - create the hardened wrapper first, or fix the "- Script:" line in scheduler/schedule.md (never schedule a bare claude -p)`);
    const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${wrapper}"`;
    execFileSync('schtasks', ['/create', '/f', '/tn', job, '/tr', tr, ...schArgs], { encoding: 'utf8' });
    log(`  scheduler: CREATED ${job} (${entry.frequency}) -> ${rel}`);
    applied.push(job);
  }
  return { documented, live, missing, unknown, matched, applied };
}

module.exports = { run, liveJobs, parseFrequency, backendName, notRegisterable };
