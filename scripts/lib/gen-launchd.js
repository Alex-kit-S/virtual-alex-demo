// @ts-check
// scripts/lib/gen-launchd.js - writes the macOS launchd agents for the jobs in scheduler/schedule.md.
//
// WHAT. On a Mac the scheduled jobs run as launchd user agents. This module turns the schedule into one
// agent file, a plist, per job, and writes each into the gitignored launchd/ folder of the checkout, where
// a person can read it before anything loads it. On apply it links and loads the agents that are not
// loaded yet. It is the macOS half of scripts/lib/gen-scheduler.js, which hands it the whole job on
// darwin, and it keeps the same two rules: refuse a cadence it cannot express, and never touch an agent
// that is already loaded.
//
// HOW. Each job takes its entry's "- Frequency (macOS):" line when there is one, else the main Frequency
// line, and parseMacFrequency reads daily, weekly and monthly-on-a-day times, and "login"; any other
// phrase is refused and reported. A Mac runs its jobs on the clock where Windows uses logon triggers,
// because a Mac mini stays logged in for weeks, so a logon trigger would almost never fire, and it
// sleeps rather than powering off. A weekly time carries a Weekday key and never a Day key, because
// launchd fires a dict holding both on either match. A time missed in sleep needs nothing here, since
// launchd replays a StartCalendarInterval missed during sleep, coalesced to one run on wake
// (launchd.plist(5)). Power-off is the gap it cannot cover, so one agent, Alex-catchup, runs at load and
// replays whatever system/task-signals.jsonl shows as stale. Every agent runs scripts/run-job.mjs with
// the job name minus its Alex- prefix, logs to outputs/logs/launchd/, and gets a PATH that names
// Homebrew's keg-only node@24 and ~/.local/bin, since an agent never reads the shell profile. On apply
// each new plist is linked into ~/Library/LaunchAgents and bootstrapped for the logged-in user. plutil
// lints every plist where it exists, which is macOS only. A path goes into a plist as it is, unescaped,
// as the generator tests pin. It must load copied alone, so it computes its own root, two folders up,
// instead of taking repo-root.js's, and requires read-sources.js, which holds the job-name rule, only when
// the live agents are read: scripts/tests/test-generator-libs-contract.mjs renders a plist from a lone
// copy under a folder whose name holds an &.
//
// NEVER. Approximates a cadence launchd cannot express: "first Monday of the month" as Day plus Weekday
// would fire about nine times a month, and there is no day-of-month for "last day". Bootstraps an agent
// that is already loaded, or a job NO_MAC_PORT names; each skip and refusal is logged with its reason.
// Gives an ordinary job RunAtLoad, since a burst of claude runs at login is an outage of its own making.
//
// Usage: module only - const { generate } = require('./gen-launchd');
// contract: read as text by scripts/tests/test-generator-libs-contract.mjs:634-635. Line 17 is the launchd sleep-replay sentence and stays line 17, because two documents cite this file by that line number; the tag sits below it so that nothing above line 17 moves.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

/** @typedef {import('./read-sources').ScheduleEntry} ScheduleEntry */
/**
 * An agent's trigger: a StartCalendarInterval dict, or RunAtLoad for the catchup agent.
 * @typedef {{ calendar: Record<string, number>, runAtLoad?: undefined }
 *   | { runAtLoad: true, calendar?: undefined }} AgentSpec
 */

const REPO = path.join(__dirname, '..', '..');
const PLIST_DIR = path.join(REPO, 'launchd');
const LOG_DIR = path.join(REPO, 'outputs', 'logs', 'launchd');
const AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

/** The one agent that runs at load, to replay what a powered-off Mac missed. */
const CATCHUP = 'Alex-catchup';

/**
 * Documented jobs with no macOS implementation, name to the reason printed when each is skipped.
 * run-job.mjs refuses them as well; listing them here keeps them from being registered at all.
 * @type {Record<string, string>}
 */
const NO_MAC_PORT = {
  'Alex-recovery-check': 'the recovery sweep (work/18-recovery-layer/check.ps1) has no macOS port yet'
};

/**
 * launchd's weekday numbers, Sunday first.
 * @type {Record<string, number>}
 */
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

const hasLaunchd = () => process.platform === 'darwin';

// The pragma stays on the line below these tags, the one that names the run-job call, because P6 exempts only the line it sits on.
// contract: read as text by scripts/tests/test-generator-libs-contract.mjs:647-650.
// contract: read as text by scripts/tests/portability-check.mjs:338 (unseen: P6 walks every line).
// Every agent runs `node scripts/run-job.mjs <suffix>` (portability-ok: macOS only, a drop row online)
/** @param {string} jobName a documented job, whose run-job suffix is its name without the Alex- prefix */
const jobSuffix = (jobName) => jobName.replace(/^Alex-/, '');

/**
 * A schedule frequency as an agent trigger, or null when launchd cannot express it. Accepted: "daily
 * HH:MM", "weekly <Weekday> HH:MM" (also "weekly on Monday at 07:30"), "monthly on the D at HH:MM", and
 * "login", which only the catchup agent uses. Hours and minutes are not range-checked.
 * @param {string | null | undefined} freq
 * @returns {AgentSpec | null}
 */
function parseMacFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase().trim();
  let m = f.match(/^daily\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { calendar: { Hour: parseInt(m[1], 10), Minute: parseInt(m[2], 10) } };
  // Anchored at ^weekly, so a "monthly, first Monday" phrase never reaches it; "on" and "at" are optional.
  m = f.match(
    /^weekly(?:\s+on)?\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\s+(?:at\s+)?(\d{1,2})[:.](\d{2})/
  );
  if (m) return { calendar: { Weekday: WEEKDAYS[m[1]], Hour: parseInt(m[2], 10), Minute: parseInt(m[3], 10) } };
  m = f.match(/^monthly on the (\d{1,2})\s+at\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { calendar: { Day: parseInt(m[1], 10), Hour: parseInt(m[2], 10), Minute: parseInt(m[3], 10) } };
  if (f === 'login') return { runAtLoad: true };
  return null;
}

/**
 * The PATH an agent gets. Agents never read the shell profile and Homebrew's node@24 is keg-only, so
 * both Homebrew prefixes are named; ~/.local/bin carries the pinned claude CLI.
 * @returns {string}
 */
function agentPath() {
  const brew = fs.existsSync('/opt/homebrew') ? '/opt/homebrew' : '/usr/local';
  return [
    path.join(os.homedir(), '.local', 'bin'),
    `${brew}/opt/node@24/bin`,
    `${brew}/bin`,
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ].join(':');
}

/**
 * One agent's plist, the label verbatim and every path written as it is.
 * @param {string} label
 * @param {AgentSpec} spec
 * @returns {string}
 */
function renderPlist(label, spec) {
  const args = [process.execPath, path.join(REPO, 'scripts', 'run-job.mjs'), jobSuffix(label)];
  const argXml = args.map((a) => `    <string>${a}</string>`).join('\n');
  let trigger = '';
  if (spec.runAtLoad) {
    trigger = '  <key>RunAtLoad</key><true/>';
  } else {
    const rows = Object.entries(spec.calendar)
      .map(([k, v]) => `    <key>${k}</key><integer>${v}</integer>`)
      .join('\n');
    trigger = `  <key>StartCalendarInterval</key><dict>\n${rows}\n  </dict>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
${argXml}
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${agentPath()}</string>
    <key>HOME</key><string>${os.homedir()}</string>
  </dict>
  <key>StandardOutPath</key><string>${path.join(LOG_DIR, `${jobSuffix(label)}.out`)}</string>
  <key>StandardErrorPath</key><string>${path.join(LOG_DIR, `${jobSuffix(label)}.err`)}</string>
  <key>ProcessType</key><string>Background</string>
${trigger}
</dict></plist>
`;
}

/**
 * The labels of the loaded Alex agents, from launchctl list's third column, retry one-shots left out.
 * @returns {Set<string>}
 */
function liveAgents() {
  const { JOB_PREFIX, isRetryJob } = require('./read-sources');
  const r = spawnSync('launchctl', ['list'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gen-launchd: launchctl list failed (${r.status})`);
  /** @type {Set<string>} */
  const labels = new Set();
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const label = line.trim().split(/\s+/)[2];
    if (label?.startsWith(JOB_PREFIX) && !isRetryJob(label)) labels.add(label);
  }
  return labels;
}

/**
 * plutil's verdict on a plist: true valid, false invalid, null when plutil is not on this machine. It
 * ships only with macOS, so the Kit's macOS CI job is where this check is real.
 * @param {string} file
 * @returns {boolean | null}
 */
function lintPlist(file) {
  const r = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
  if (r.error) return null;
  return r.status === 0;
}

/**
 * Writes one plist per schedulable job, and the catchup agent's, then on apply loads the new ones.
 * @param {{ entries: Pick<ScheduleEntry, 'jobNames' | 'frequency' | 'text'>[] }} schedule parseScheduleJobs' output
 * @param {{ apply?: boolean, log?: (line: string) => void }} [options]
 */
function generate(schedule, { apply = false, log = console.log } = {}) {
  fs.mkdirSync(PLIST_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  /** @type {string[]} */
  const written = [];
  /** @type {{ job: string, freq: string | null, reason: string }[]} */
  const refused = [];
  /** @type {{ job: string, reason: string }[]} */
  const skipped = [];
  /** @type {Record<string, boolean | null>} */
  const lint = {};

  /** @type {Map<string, AgentSpec>} */
  const wanted = new Map();
  for (const e of schedule.entries) {
    for (const job of e.jobNames) {
      if (NO_MAC_PORT[job]) {
        skipped.push({ job, reason: NO_MAC_PORT[job] });
        continue;
      }
      // The job's own macOS line wins; the main Frequency line is the fallback, and its logon forms refuse.
      const macLine = (e.text || '').match(/^- Frequency \(macOS\):\s*(.+)$/m);
      const freq = macLine ? macLine[1].trim() : e.frequency;
      const spec = parseMacFrequency(freq);
      if (!spec) {
        refused.push({
          job,
          freq,
          reason:
            'no launchd expression for this cadence (logon triggers have no wall clock; add a "- Frequency (macOS):" line to schedule.md)'
        });
        continue;
      }
      wanted.set(job, spec);
    }
  }
  wanted.set(CATCHUP, { runAtLoad: true });

  for (const [label, spec] of wanted) {
    const file = path.join(PLIST_DIR, `${label}.plist`);
    fs.writeFileSync(file, renderPlist(label, spec), 'utf8');
    written.push(label);
    lint[label] = lintPlist(file);
    if (lint[label] === false) log(`  gen-launchd: INVALID plist for ${label} (plutil -lint failed)`);
  }
  for (const s of skipped) log(`  gen-launchd: SKIPPED ${s.job} - ${s.reason}`);
  for (const r of refused) log(`  gen-launchd: REFUSED ${r.job} ("${r.freq}") - ${r.reason}`);

  /** @type {string[]} */
  const bootstrapped = [];
  if (apply) {
    if (!hasLaunchd()) {
      log(
        `  gen-launchd: APPLY SKIPPED - no launchd on this machine (platform=${process.platform}). Plists written for review; on the Mac this bootstraps them.`
      );
      return { written, skipped, refused, bootstrapped, lint };
    }
    const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
    const live = liveAgents();
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    for (const label of written) {
      if (live.has(label)) continue;
      const src = path.join(PLIST_DIR, `${label}.plist`);
      const dst = path.join(AGENTS_DIR, `${label}.plist`);
      try {
        try {
          fs.unlinkSync(dst);
        } catch (error) {
          // Only an absent link is fine. Any other failure is the cause the log below must name.
          if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
        }
        fs.symlinkSync(src, dst);
        const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, dst], { encoding: 'utf8' });
        if (r.status === 0) {
          bootstrapped.push(label);
          log(`  gen-launchd: bootstrapped ${label}`);
        } else {
          log(`  gen-launchd: bootstrap FAILED for ${label}: ${String(r.stderr || '').trim()}`);
        }
      } catch (e) {
        log(`  gen-launchd: bootstrap FAILED for ${label}: ${/** @type {Error} */ (e).message}`);
      }
    }
  }
  return { written, skipped, refused, bootstrapped, lint };
}

module.exports = { generate, parseMacFrequency, renderPlist, liveAgents, NO_MAC_PORT };
