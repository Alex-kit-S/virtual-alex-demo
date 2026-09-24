'use strict';
// scripts/lib/gen-launchd.js - scheduler/schedule.md -> launchd user agents (macOS port Phase 3.4,
// 2026-08-31). Modeled line-for-line on the donor's gen-systemd.js, including its two hard rules:
//
//   REFUSE, DON'T GUESS: a frequency this file cannot express in launchd is REPORTED and skipped,
//   never approximated. launchd's Day+Weekday semantics are OR (either matches -> fire), so
//   "first Monday of the month" would fire ~9 times a month if emitted naively, and there is no
//   negative day-of-month for "last day". Neither cadence exists in the Kit's schedule today; the
//   guard is here for the day one arrives.
//
//   CREATE-ONLY: apply bootstraps ONLY agents that are documented but not loaded. It never touches
//   a loaded agent - same contract as gen-scheduler.js ("leave existing jobs alone").
//
// WHY WALL-CLOCK HERE WHEN WINDOWS USES LOGON TRIGGERS. The Windows jobs ride logon+delay because
// laptops sleep through wall-clock times and Windows won't reliably wake. A Mac mini is a desktop:
// it stays logged in for weeks (so a logon trigger would fire almost never) and SLEEPS rather than
// powers off - and launchd replays a StartCalendarInterval missed during sleep, coalesced to one
// run on wake (launchd.plist(5)). Power-off is the one gap launchd cannot cover, so ONE RunAtLoad
// catchup agent (Alex-catchup -> run-job.mjs catchup) replays anything stale off
// system/task-signals.jsonl at login. Individual jobs never get RunAtLoad: launchd.plist(5) warns
// speculative launches hurt login, and six concurrent claude runs at boot is a self-inflicted
// outage.
//
// Plists are emitted into the gitignored launchd/ dir and SYMLINKED into ~/Library/LaunchAgents
// (launchd resolves symlinks): generated artifacts beside their source, reviewable before loading.
// Job labels are the schedule.md names VERBATIM (Alex-email-triage), same rule as gen-systemd W11.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const PLIST_DIR = path.join(REPO, 'launchd');
const AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

const hasLaunchd = () => process.platform === 'darwin';

// --- the run-job mapping --------------------------------------------------------------------
// Every agent runs `node scripts/run-job.mjs <suffix>` (portability-ok: macOS only, a drop row online)
// One wrapper layer, jobs as data; online no launchd agent is ever generated.
// A job name maps to its run-job suffix by stripping the Alex- prefix.
const jobSuffix = (jobName) => jobName.replace(/^Alex-/, '');

// run-job.mjs itself refuses jobs with no macOS implementation; this list keeps them from even
// being registered, with the reason printed instead of a silent absence.
const NO_MAC_PORT = {
  'Alex-recovery-check': 'the recovery sweep (work/18-recovery-layer/check.ps1) has no macOS port yet',
};

// --- frequency grammar ----------------------------------------------------------------------
// Accepted:  daily HH:MM               -> {Hour,Minute}
//            weekly <Weekday> HH:MM    -> {Weekday,Hour,Minute}   ("weekly on Monday at 07:30" too)
//            monthly on the D at HH:MM -> {Day,Hour,Minute}
//            login                     -> RunAtLoad (the catchup agent only)
// Everything else -> null (REFUSED; the caller reports it with the reason).
//
// WHY WEEKLY IS SAFE WHERE "first Monday" IS NOT. The REFUSE-DON'T-GUESS guard at the top of this
// file is about launchd's Day+Weekday OR semantics: a dict carrying BOTH fires on either match, so
// "first Monday" emitted naively fires ~9 times a month. A Weekday-ONLY dict has no Day key to OR
// against, so it means exactly what it says: that weekday, that time, every week. The weekly branch
// therefore emits Weekday+Hour+Minute and never a Day, and its regex is anchored at ^weekly so it
// cannot reach a "monthly, first Monday ..." string at all (proved by L1/L1c in
// scripts/tests/test-gen-launchd.mjs, which still expect null for both monthly shapes).
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function parseMacFrequency(freq) {
  if (!freq) return null;
  const f = freq.toLowerCase().trim();
  let m = f.match(/^daily\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { calendar: { Hour: parseInt(m[1], 10), Minute: parseInt(m[2], 10) } };
  // ^weekly is the anchor that keeps "monthly, first Monday 10:00" out; the optional "on"/"at"
  // noise words are accepted because schedule.md prose reads better with them.
  m = f.match(/^weekly(?:\s+on)?\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\s+(?:at\s+)?(\d{1,2})[:.](\d{2})/);
  if (m) return { calendar: { Weekday: WEEKDAYS[m[1]], Hour: parseInt(m[2], 10), Minute: parseInt(m[3], 10) } };
  m = f.match(/^monthly on the (\d{1,2})\s+at\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { calendar: { Day: parseInt(m[1], 10), Hour: parseInt(m[2], 10), Minute: parseInt(m[3], 10) } };
  if (f === 'login') return { runAtLoad: true };
  return null;
}

// The PATH launchd agents get. Agents never source .zprofile, and brew's node@24 is keg-only, so
// both prefixes are spelled out. ~/.local/bin carries the pinned claude CLI.
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
    '/sbin',
  ].join(':');
}

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
  const logDir = path.join(REPO, 'outputs', 'logs', 'launchd');
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
  <key>StandardOutPath</key><string>${path.join(logDir, `${jobSuffix(label)}.out`)}</string>
  <key>StandardErrorPath</key><string>${path.join(logDir, `${jobSuffix(label)}.err`)}</string>
  <key>ProcessType</key><string>Background</string>
${trigger}
</dict></plist>
`;
}

// --- live query -----------------------------------------------------------------------------
function liveAgents() {
  const r = spawnSync('launchctl', ['list'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gen-launchd: launchctl list failed (${r.status})`);
  return new Set(
    (r.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[2])
      .filter((s) => s && s.startsWith('Alex-') && !s.startsWith('Alex-retry-'))
  );
}

// --- self-validation ------------------------------------------------------------------------
// plutil exists only on macOS. Tri-state like gen-systemd's systemd-analyze: true valid, false
// invalid, null = not checkable here (Windows/Linux dev box; CI's macos job is the real gate).
function lintPlist(file) {
  const r = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
  if (r.error) return null;
  return r.status === 0;
}

// --- main entry -----------------------------------------------------------------------------
// generate(schedule, {apply, log}): schedule = read-sources parseScheduleJobs() output.
// Returns { written, skipped, refused, bootstrapped, lint }.
function generate(schedule, { apply = false, log = console.log } = {}) {
  fs.mkdirSync(PLIST_DIR, { recursive: true });
  fs.mkdirSync(path.join(REPO, 'outputs', 'logs', 'launchd'), { recursive: true });

  const written = [];
  const refused = [];
  const skipped = [];
  const lint = {};

  // Standing jobs from the schedule entries.
  const wanted = new Map(); // label -> spec
  for (const e of schedule.entries) {
    for (const job of e.jobNames) {
      if (NO_MAC_PORT[job]) {
        skipped.push({ job, reason: NO_MAC_PORT[job] });
        continue;
      }
      // Per-job macOS line wins; the main Frequency line is the fallback (it covers
      // "monthly on the 1 at 10:00"; the logon+delay lines refuse below, by design).
      const macLine = (e.text || '').match(/^- Frequency \(macOS\):\s*(.+)$/m);
      const freq = macLine ? macLine[1].trim() : e.frequency;
      const spec = parseMacFrequency(freq);
      if (!spec) {
        refused.push({ job, freq, reason: 'no launchd expression for this cadence (logon triggers have no wall clock; add a "- Frequency (macOS):" line to schedule.md)' });
        continue;
      }
      wanted.set(job, spec);
    }
  }
  // The catchup agent: RunAtLoad, replays stale jobs after power-off. Documented in schedule.md's
  // Transient section (so the Windows checkers never expect it live there).
  wanted.set('Alex-catchup', { runAtLoad: true });

  for (const [label, spec] of wanted) {
    const file = path.join(PLIST_DIR, `${label}.plist`);
    fs.writeFileSync(file, renderPlist(label, spec), 'utf8');
    written.push(label);
    lint[label] = lintPlist(file);
    if (lint[label] === false) log(`  gen-launchd: INVALID plist for ${label} (plutil -lint failed)`);
  }
  for (const s of skipped) log(`  gen-launchd: SKIPPED ${s.job} - ${s.reason}`);
  for (const r of refused) log(`  gen-launchd: REFUSED ${r.job} ("${r.freq}") - ${r.reason}`);

  const bootstrapped = [];
  if (apply) {
    if (!hasLaunchd()) {
      log('  gen-launchd: APPLY SKIPPED - no launchd on this machine (platform=' + process.platform + '). Plists written for review; on the Mac this bootstraps them.');
      return { written, skipped, refused, bootstrapped, lint };
    }
    const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
    const live = liveAgents();
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    for (const label of written) {
      if (live.has(label)) continue; // CREATE-ONLY: never touch a loaded agent
      const src = path.join(PLIST_DIR, `${label}.plist`);
      const dst = path.join(AGENTS_DIR, `${label}.plist`);
      try {
        try { fs.unlinkSync(dst); } catch { /* absent is fine */ }
        fs.symlinkSync(src, dst);
        const r = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, dst], { encoding: 'utf8' });
        if (r.status === 0) {
          bootstrapped.push(label);
          log(`  gen-launchd: bootstrapped ${label}`);
        } else {
          log(`  gen-launchd: bootstrap FAILED for ${label}: ${String(r.stderr || '').trim()}`);
        }
      } catch (e) {
        log(`  gen-launchd: bootstrap FAILED for ${label}: ${e.message}`);
      }
    }
  }
  return { written, skipped, refused, bootstrapped, lint };
}

module.exports = { generate, parseMacFrequency, renderPlist, hasLaunchd, liveAgents, NO_MAC_PORT };
