// @ts-check
// scripts/lib/gen-scheduler.js - keeps this machine's scheduler in step with scheduler/schedule.md.
//
// WHAT. The jobs a laptop runs on its own are documented in scheduler/schedule.md. This module makes the
// machine match that page and reports where it does not. On Windows it lists the Alex-* tasks in the Task
// Scheduler and creates the documented ones that are missing; on macOS it hands the whole job to
// gen-launchd.js; on any other platform it says there is no scheduler here and changes nothing.
// scripts/validate-alex.js reads the live jobs through this module too, so the checker and the generator
// ask the machine the same question the same way.
//
// HOW. run() dispatches on the platform. On Windows it compares the documented job names with the live
// ones, logs what is missing, unknown and matched, and on apply creates each missing job with
// schtasks /create: the task runs its hardened wrapper, the entry's "- Script:" file or else
// scripts/run-<name>.ps1, through powershell.exe, on the trigger parseFrequency reads from the entry's
// Frequency line. liveJobs reads schtasks /query /fo CSV and keeps each task at the root whose name IS a
// job name exactly: no characters may precede the Alex- prefix, so a task named MyAlex-x is a
// stranger's task, never this checkout's, and is left out of the live set entirely - it is never even a
// candidate for V2's ownership check. On macOS it asks gen-launchd.js instead. Job names and the retry rule
// come from read-sources.js. parseFrequency turns a schedule phrase into schtasks trigger arguments:
// "logon + N min" is the default shape, because a laptop is rarely on at a wall-clock hour and a job
// that never runs fails silently; otherwise it takes the first time and the first weekday it finds, so a
// monthly "first Monday" reads as weekly, "3x daily" as once a day, and an hour past 23 goes through
// as written, all pinned by the generator tests. backendName and notRegisterable tell the checker which
// scheduler it is talking to and which documented jobs this platform refuses by design. gen-launchd.js is
// loaded only on macOS.
//
// NEVER. Touches a job that already exists: a live task carries settings added by hand (restart
// ladders, wake and battery settings) that re-creating it would wipe, so apply only ever creates.
// Creates a job whose frequency parseFrequency cannot read, or whose wrapper file is missing: either
// refuses, naming /cron-setup or the Script line, because a bare claude -p is never scheduled. Counts an
// Alex-retry-* one-shot, live or documented. Lets LIVE_TASK's match allow any prefix before the job
// name again: a foreign task such as MyAlex-thing is a stranger's task, never this checkout's, and
// must never be captured as one, so the anchor binds the WHOLE task name, not a suffix of it.
//
// Usage: module only - const { run, liveJobs, backendName } = require('./gen-scheduler');
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { REPO } = require('./repo-root');
const { JOB_NAME, JOB_PREFIX, isRetryJob } = require('./read-sources');
const { pad } = require('./render-templates');

/** @typedef {import('./read-sources').Schedule} Schedule */
/** @typedef {import('./read-sources').ScheduleEntry} ScheduleEntry */

/** schtasks lists every task on the machine, not only this checkout's, so its output can be large. */
const QUERY_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * One task in the CSV listing: a quoted field that opens with the root backslash and holds nothing but
 * a job name - no folder (a second backslash), no other characters before or after it. Anchored tight
 * against the backslash and the closing quote, so only an EXACT Alex-* name counts as live at all; see
 * the header's NEVER. paragraph for why a looser prefix must never come back.
 */
const LIVE_TASK = new RegExp(`"\\\\(${JOB_NAME.source})"`, 'g');

/**
 * The scheduler this platform runs, in the words a person reads in an error message, so a checker never
 * names the wrong tool.
 * @returns {string}
 */
function backendName() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'win32') return 'Windows Task Scheduler';
  return `no scheduler backend (platform=${process.platform})`;
}

/**
 * The documented jobs this platform refuses to register by design, name to reason. Only macOS has any:
 * the recovery sweep has no port there, and a checker that did not know would report it missing forever.
 * @returns {Record<string, string>}
 */
function notRegisterable() {
  if (process.platform !== 'darwin') return {};
  return require('./gen-launchd').NO_MAC_PORT;
}

/**
 * The live job names on this machine's scheduler, sorted, retry one-shots left out. The platform
 * dispatch is here as well as in run(), because validate-alex.js V2 calls this directly.
 * @returns {string[]}
 */
function liveJobs() {
  if (process.platform === 'darwin') {
    try {
      return [...require('./gen-launchd').liveAgents()].sort();
    } catch (e) {
      throw new Error(`gen-scheduler: launchctl list failed: ${/** @type {Error} */ (e).message}`);
    }
  }
  if (process.platform !== 'win32') {
    throw new Error(
      `gen-scheduler: ${backendName()} - Windows Task Scheduler and macOS launchd are the two supported backends`
    );
  }
  let csv;
  try {
    csv = execFileSync('schtasks', ['/query', '/fo', 'CSV'], { encoding: 'utf8', maxBuffer: QUERY_BUFFER_BYTES });
  } catch (e) {
    throw new Error(`gen-scheduler: schtasks /query failed: ${/** @type {Error} */ (e).message}`);
  }
  const names = new Set();
  for (const m of csv.matchAll(LIVE_TASK)) {
    if (!isRetryJob(m[1])) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * A schedule.md frequency phrase as schtasks trigger arguments, or null when it holds no time to read.
 * @param {string | null | undefined} freq
 * @returns {string[] | null}
 */
function parseFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase();

  // A logon trigger also makes the task run only while the owner is logged on, which the desktop toast
  // in scripts/lib/run-status.ps1 needs in order to show at all. schtasks takes the delay as mmmm:ss.
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
  const st = `${pad(hh)}:${mm}`;
  if (/weekday/.test(f)) return ['/sc', 'WEEKLY', '/d', 'MON,TUE,WED,THU,FRI', '/st', st];
  const day = f.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (day) return ['/sc', 'WEEKLY', '/d', day[1].slice(0, 3).toUpperCase(), '/st', st];
  if (/monthly.*last day/.test(f)) return ['/sc', 'MONTHLY', '/mo', 'LASTDAY', '/m', '*', '/st', st];
  const dom = f.match(/monthly on the (\d{1,2})/);
  if (dom) return ['/sc', 'MONTHLY', '/d', dom[1], '/st', st];
  if (/daily|\bdays\b|3x daily/.test(f)) return ['/sc', 'DAILY', '/st', st];
  return null;
}

/**
 * The schedule.md entry whose text names a documented job, or null.
 * @param {Schedule} schedule
 * @param {string} jobName
 * @returns {ScheduleEntry | null}
 */
function entryForJob(schedule, jobName) {
  return schedule.entries.find((e) => e.jobNames.includes(jobName)) || null;
}

/**
 * Compares the documented jobs with this machine's scheduler and, on apply, creates the missing ones.
 * @param {{ schedule: Schedule, apply: boolean, log: (line: string) => void }} options
 */
async function run({ schedule, apply, log }) {
  if (process.platform === 'darwin') {
    const launchd = require('./gen-launchd');
    const r = launchd.generate(schedule, { apply, log });
    log(
      `  scheduler(launchd): ${r.written.length} plist(s) written, ${r.bootstrapped.length} bootstrapped, ${r.skipped.length} skipped, ${r.refused.length} refused`
    );
    return {
      documented: schedule.allJobNames,
      live: [],
      missing: [],
      unknown: [],
      matched: [],
      applied: r.bootstrapped,
      launchd: r
    };
  }
  if (process.platform !== 'win32') {
    log(
      `  scheduler: SKIPPED - no scheduler backend for platform=${process.platform} (Windows Task Scheduler and macOS launchd are the two supported backends)`
    );
    return {
      documented: schedule.allJobNames,
      live: [],
      missing: [],
      unknown: [],
      matched: [],
      applied: [],
      skippedLive: true
    };
  }
  const documented = schedule.allJobNames;
  const live = liveJobs();
  const liveSet = new Set(live);
  const docSet = new Set(documented);
  const missing = documented.filter((j) => !liveSet.has(j));
  const unknown = live.filter((j) => !docSet.has(j));
  const matched = documented.filter((j) => liveSet.has(j));

  log(`  scheduler: documented=${documented.length} live=${live.length} matched=${matched.length}`);
  if (missing.length) log(`  scheduler: MISSING from Task Scheduler: ${missing.join(', ')}`);
  if (unknown.length) log(`  scheduler: live but NOT documented in schedule.md: ${unknown.join(', ')}`);
  if (!missing.length && !unknown.length) log('  scheduler: schedule.md and Task Scheduler agree (verified no-op)');

  if (!apply) return { documented, live, missing, unknown, matched, applied: [] };

  const applied = [];
  for (const job of missing) {
    const entry = entryForJob(schedule, job);
    if (!entry)
      throw new Error(`gen-scheduler: ${job} is documented but no schedule.md entry names it - fix schedule.md`);
    const schArgs = parseFrequency(entry.frequency);
    if (!schArgs)
      throw new Error(
        `gen-scheduler: cannot parse frequency '${entry.frequency}' for ${job} - register it via /cron-setup instead`
      );
    // A documented job is a JOB_NAME match, so it opens with the prefix.
    const base = job.slice(JOB_PREFIX.length);
    const rel = entry.script || `scripts/run-${base}.ps1`;
    const wrapper = path.join(REPO, ...rel.split('/'));
    if (!fs.existsSync(wrapper))
      throw new Error(
        `gen-scheduler: ${rel} does not exist for ${job} - create the hardened wrapper first, or fix the "- Script:" line in scheduler/schedule.md (never schedule a bare claude -p)`
      );
    const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${wrapper}"`;
    execFileSync('schtasks', ['/create', '/f', '/tn', job, '/tr', tr, ...schArgs], { encoding: 'utf8' });
    log(`  scheduler: CREATED ${job} (${entry.frequency}) -> ${rel}`);
    applied.push(job);
  }
  return { documented, live, missing, unknown, matched, applied };
}

module.exports = { run, liveJobs, parseFrequency, backendName, notRegisterable };
