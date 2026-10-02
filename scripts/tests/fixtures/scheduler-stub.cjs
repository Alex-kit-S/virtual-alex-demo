'use strict';
// scripts/tests/fixtures/scheduler-stub.cjs - the shared scheduler stub for validate-alex/generate-alex
// tests, so a test that loads it can never reach the real Windows Task Scheduler or macOS launchd. A
// test that still carries its own inline preload instead of loading this one has not adopted it yet.
//
// WHAT. Answers schtasks, launchctl, id and crontab from environment variables instead of the real
// binaries, and inspects every powershell/pwsh call for the one PowerShell scheduler query the Kit's own
// code makes, for any test that runs validate-alex.js or generate-alex.js as a child process. Deleted,
// every test that spawns the validator or the generator falls through to the real scheduler on whatever
// machine runs it, or, when another preload blocks the scheduler ahead of this file through
// NODE_OPTIONS, to that preload's own refusal instead, and a test's result would depend on the machine
// it happened to run on.
//
// HOW. Load with `node -r <this file> <target>`, before any Kit code (a bare `require()` also installs it,
// since the work happens at module-load time). process.platform stays the REAL platform unless C4_PLATFORM
// names another, so a wired test that never sets it runs on its own platform; when C4_NOW is set, the clock
// is pinned too (a subclass of the real Date). Wraps every child_process entry point (execFileSync,
// spawnSync, spawn, execFile, execSync, exec) so a call naming schtasks, launchctl, id or crontab is answered
// HERE, before it can reach a blocker loaded earlier or a real binary: schtasks /query /fo CSV (no /tn)
// answers a CSV row per C4_LIVE name, or throws under C4_QUERY_THROW; schtasks /query /tn <n> /xml ONE
// answers C4_READABLE_XML(_B64) when <n> is C4_READABLE_TASK, else refused; schtasks /create is recorded to
// C4_SCHED_LOG and answered SUCCESS, nothing registered; any other schtasks call is refused; launchctl list
// answers one row per C4_LIVE name, or throws under C4_LAUNCHCTL_THROW; launchctl bootstrap is recorded and
// fails only for a label named in C4_BOOTSTRAP_FAIL; id -u answers C4_UID (default 501); crontab/systemctl
// always refuse. A powershell or pwsh call is inspected, never blanket-stubbed: bootstrap.mjs's own name
// query (`(Get-ScheduledTask -TaskName '<prefix>*' ...).TaskName`) is answered with the matching C4_LIVE
// names, one per line; any other call whose arguments name the scheduler (this file's own SCHED_TEXT
// pattern) is refused with a logged ENOENT-style error; anything else passes through to the real binary
// untouched (V18's PowerShell syntax sweep, which names no scheduler, reaches powershell.exe for real). Every
// schtasks/launchctl/id/crontab/systemctl call, and every powershell/pwsh call this stub inspects - answered,
// refused or passed through - is logged to C4_SCHED_LOG when set. Every C4_* default is "nothing live, uid
// 501, nothing refused" - a fresh, never-installed machine. C4_LIVEJOBS_DIRECT, off by default, answers
// gen-scheduler.js's liveJobs() straight from C4_LIVE/C4_QUERY_THROW instead of through the schtasks path
// above (a caller that never needs the real retry-job filter and wants one fewer moving part).
//
// NEVER. Spawns a real schtasks, launchctl, crontab or systemctl process, whatever module or
// child_process entry point called it, or whatever blocker is loaded ahead of it. Answers a powershell or
// pwsh call that names the scheduler with real data: it is refused, the same as the other binaries.
//
// Usage: module only - `node -r scripts/tests/fixtures/scheduler-stub.cjs <target>`, C4_* in the env
// Exit: n/a

const os = require('node:os');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// os.tmpdir() reads TEMP on win32; a POSIX host pretending to be win32 would otherwise see "undefined\temp".
if (process.env.C4_PLATFORM === 'win32' && process.platform !== 'win32' && !process.env.TEMP) {
  process.env.TEMP = os.tmpdir();
}
// The REAL platform, unless a test names another: on the macOS and Ubuntu runners the validator and the
// generator then take their own platform's branches, which a fixed win32 would leave unexercised there.
if (process.env.C4_PLATFORM) {
  Object.defineProperty(process, 'platform', { value: process.env.C4_PLATFORM });
}

if (process.env.C4_NOW) {
  const fixed = Date.parse(process.env.C4_NOW);
  const RealDate = Date;
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(fixed);
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = PinnedDate;
}

const note = (line) => {
  if (!process.env.C4_SCHED_LOG) return;
  try {
    fs.appendFileSync(process.env.C4_SCHED_LOG, `${line}\n`);
  } catch {
    // Best-effort log only; a write failure here must never change what a test observes.
  }
};
const baseName = (cmd) =>
  path
    .basename(String(cmd))
    .replace(/\.exe$/i, '')
    .toLowerCase();
const SCHEDULER_BIN = new Set(['schtasks', 'launchctl', 'id', 'crontab', 'systemctl']);
const PS_BIN = new Set(['powershell', 'pwsh']);
// A test harness may load its own scheduler blocker ahead of this file; the pattern below names the
// same commands, so the two agree on what "names the scheduler" means.
const SCHED_TEXT = /ScheduledTask|ScheduledJob|\bschtasks\b|\blaunchctl\b|\bsystemctl\b|\bcrontab\b|Schedule\.Service/i;
// bootstrap.mjs:285's exact name query, the one PowerShell call the Kit's own doctor makes on Windows:
// (Get-ScheduledTask -TaskName '<prefix>*' -ErrorAction SilentlyContinue).TaskName
const BOOTSTRAP_NAME_QUERY =
  /Get-ScheduledTask\s+-TaskName\s+'([^*']*)\*'\s+-ErrorAction\s+SilentlyContinue\)\.TaskName/i;

/**
 * A powershell/pwsh call's outcome: `{ out }` to answer it here, or null to pass it through to the real
 * binary untouched. Throws for a scheduler call this stub does not recognise. Every call reaching here is
 * logged, whichever of the three happens, so a wired test's PowerShell traffic is visible without a person
 * re-deriving it from this file.
 * @param {(string | Buffer)[]} args
 * @returns {{ out: string } | null}
 */
function handlePowershell(args) {
  const text = (args || []).map(String).join(' ');
  const shown = text.length > 160 ? `${text.slice(0, 160)}...` : text;
  const bootstrap = text.match(BOOTSTRAP_NAME_QUERY);
  if (bootstrap) {
    const prefix = bootstrap[1];
    const names = (process.env.C4_LIVE || '')
      .split(',')
      .filter(Boolean)
      .filter((n) => n.startsWith(prefix));
    note(`powershell ${shown} -> ${names.length} name(s)`);
    return { out: names.length ? `${names.join('\r\n')}\r\n` : '' };
  }
  if (SCHED_TEXT.test(text)) {
    note(`powershell ${shown} (refused)`);
    throw Object.assign(new Error('test preload: a PowerShell scheduler call was refused'), { code: 'ENOENT' });
  }
  note(`powershell ${shown} (passed through)`);
  return null;
}

function schtasksCsv() {
  const names = (process.env.C4_LIVE || '').split(',').filter(Boolean);
  return `${['"TaskName","Next Run Time","Status"', ...names.map((n) => `"\\${n}","N/A","Ready"`)].join('\r\n')}\r\n`;
}

/** @returns {string | Buffer} on success; throws a refusal otherwise. */
function handleSchtasks(args) {
  const a = (args || []).map(String);
  const lower = a.map((x) => x.toLowerCase());
  if (lower[0] === '/query' && lower.includes('/fo') && !lower.includes('/tn')) {
    if (process.env.C4_QUERY_THROW) {
      note('schtasks /query refused (C4_QUERY_THROW)');
      throw new Error('test preload: schtasks query failed');
    }
    return schtasksCsv();
  }
  if (lower[0] === '/query' && lower.includes('/tn') && lower.includes('/xml')) {
    const name = a[lower.indexOf('/tn') + 1];
    if (process.env.C4_READABLE_TASK && name === process.env.C4_READABLE_TASK) {
      note(`schtasks ${a.join(' ')}`);
      if (process.env.C4_READABLE_XML_B64) return Buffer.from(process.env.C4_READABLE_XML_B64, 'base64');
      return process.env.C4_READABLE_XML || '';
    }
    note(`schtasks ${a.join(' ')} (refused)`);
    throw new Error(`test preload: schtasks /query /tn ${name} refused`);
  }
  if (lower[0] === '/create') {
    note(`schtasks ${a.join(' ')}`);
    return 'SUCCESS: recorded by the scheduler-stub fixture, nothing was registered\r\n';
  }
  note(`schtasks ${a.join(' ')} (refused)`);
  throw new Error(`test preload: schtasks ${a[0] || ''} refused`);
}

function handleLaunchctl(args) {
  const a = (args || []).map(String);
  if (a[0] === 'list') {
    if (process.env.C4_LAUNCHCTL_THROW) {
      note('launchctl list refused (C4_LAUNCHCTL_THROW)');
      throw new Error('test preload: launchctl list failed');
    }
    const names = (process.env.C4_LIVE || '').split(',').filter(Boolean);
    if (!names.length) return 'PID\tStatus\tLabel\n';
    return `${names.map((n) => `-\t0\t${n}`).join('\n')}\n`;
  }
  if (a[0] === 'bootstrap') {
    const target = a[2] || '';
    const label = path.basename(target, '.plist');
    const fails = (process.env.C4_BOOTSTRAP_FAIL || '').split(',').filter(Boolean);
    note(`launchctl ${a.join(' ')}`);
    if (fails.includes(label)) throw new Error(`scheduler-stub: bootstrap refused for ${label} (C4_BOOTSTRAP_FAIL)`);
    return '';
  }
  note(`launchctl ${a.join(' ')} (refused)`);
  throw new Error(`test preload: launchctl ${a[0] || ''} refused`);
}

function handleId(args) {
  const a = (args || []).map(String);
  if (a[0] === '-u') return `${process.env.C4_UID || '501'}\n`;
  note(`id ${a.join(' ')} (refused)`);
  throw new Error(`test preload: id ${a[0] || ''} refused`);
}

/** @returns {{ out: string | Buffer }} on success; throws a refusal otherwise; null when not ours. */
function intercept(cmd, args) {
  const b = baseName(cmd);
  if (b === 'schtasks') return { out: handleSchtasks(args) };
  if (b === 'launchctl') return { out: handleLaunchctl(args) };
  if (b === 'id') return { out: handleId(args) };
  if (b === 'crontab' || b === 'systemctl') {
    note(`${b} ${(args || []).join(' ')} (refused)`);
    throw new Error(`test preload: ${b} refused`);
  }
  return null;
}

const real = {
  execFileSync: cp.execFileSync,
  spawnSync: cp.spawnSync,
  spawn: cp.spawn,
  execFile: cp.execFile,
  execSync: cp.execSync,
  exec: cp.exec
};

cp.execFileSync = function (cmd, ...rest) {
  const [args, opts] = rest;
  const b = baseName(cmd);
  if (SCHEDULER_BIN.has(b)) {
    const hit = intercept(cmd, Array.isArray(args) ? args : []);
    const o = (Array.isArray(args) ? opts : args) || {};
    const wantsString = o.encoding && o.encoding !== 'buffer';
    if (wantsString) return Buffer.isBuffer(hit.out) ? hit.out.toString(o.encoding) : String(hit.out);
    return Buffer.isBuffer(hit.out) ? hit.out : Buffer.from(String(hit.out));
  }
  if (PS_BIN.has(b)) {
    const hit = handlePowershell(Array.isArray(args) ? args : []);
    if (hit === null) return real.execFileSync.call(this, cmd, ...rest);
    const o = (Array.isArray(args) ? opts : args) || {};
    const wantsString = o.encoding && o.encoding !== 'buffer';
    return wantsString ? hit.out : Buffer.from(hit.out);
  }
  return real.execFileSync.call(this, cmd, ...rest);
};

cp.spawnSync = function (cmd, ...rest) {
  const [args] = rest;
  const b = baseName(cmd);
  if (SCHEDULER_BIN.has(b)) {
    try {
      const hit = intercept(cmd, Array.isArray(args) ? args : []);
      const out = Buffer.isBuffer(hit.out) ? hit.out.toString('utf8') : hit.out;
      return { status: 0, stdout: out, stderr: '' };
    } catch (e) {
      return { status: 1, stdout: '', stderr: /** @type {Error} */ (e).message, error: undefined };
    }
  }
  if (PS_BIN.has(b)) {
    try {
      const hit = handlePowershell(Array.isArray(args) ? args : []);
      if (hit === null) return real.spawnSync.call(this, cmd, ...rest);
      return { status: 0, stdout: hit.out, stderr: '' };
    } catch (e) {
      // The same ENOENT-style shape a harness-level scheduler blocker uses, so a caller that checks
      // `.error` sees the same refusal it would from a genuinely missing binary.
      return { error: e, status: null, signal: null, output: null, pid: 0, stdout: null, stderr: null };
    }
  }
  return real.spawnSync.call(this, cmd, ...rest);
};

for (const k of ['spawn', 'execFile']) {
  cp[k] = function (cmd, ...rest) {
    if (SCHEDULER_BIN.has(baseName(cmd))) {
      throw new Error(
        `test preload: async ${k} of ${baseName(cmd)} refused (the scheduler stub only answers the synchronous entry points the Kit's own scheduler code uses)`
      );
    }
    return real[k].call(this, cmd, ...rest);
  };
}

for (const k of ['execSync', 'exec']) {
  cp[k] = function (command, ...rest) {
    if (SCHED_TEXT.test(String(command))) {
      note(`${k} command string refused: ${String(command).slice(0, 120)}`);
      throw new Error('test preload: scheduler command string refused');
    }
    return real[k].call(this, command, ...rest);
  };
}

// C4_LIVEJOBS_DIRECT: an opt-in, OFF by default, for a caller that wants gen-scheduler.js's liveJobs()
// answered straight from C4_LIVE/C4_QUERY_THROW with no schtasks round trip at all - the shape three test
// files carried by hand (their own Module._load patch) before they adopted this stub. Every other caller
// already gets liveJobs() for free through the schtasks interception above, which runs the function's
// real retry-job filter; this switch exists only so a caller that depended on the unfiltered direct form
// keeps that exact behaviour after adopting the shared stub.
if (process.env.C4_LIVEJOBS_DIRECT) {
  const Module = require('module');
  const load = Module._load;
  Module._load = function (request, ...rest) {
    const mod = load.call(this, request, ...rest);
    if (/gen-scheduler(\.js)?$/.test(request) && mod && typeof mod.liveJobs === 'function' && !mod.__testLiveDirect) {
      const liveJobs = () => {
        if (process.env.C4_QUERY_THROW) throw new Error('test preload: scheduler query failed');
        return (process.env.C4_LIVE || '').split(',').filter(Boolean).sort();
      };
      return Object.assign({}, mod, { liveJobs, __testLiveDirect: true });
    }
    return mod;
  };
}

module.exports = {};
