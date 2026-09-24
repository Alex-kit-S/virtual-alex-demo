#!/usr/bin/env node
// scripts/tests/test-scheduler-dispatch.mjs - the scheduler backend must follow the PLATFORM.
//
// WHY THIS TEST EXISTS (2026-09-20). gen-scheduler.run() dispatched to launchd on darwin, but
// gen-scheduler.liveJobs() did not - it shelled straight to `schtasks`, a Windows binary. That one
// missing branch was not cosmetic. validate-alex.js V2 imports liveJobs directly; generate-alex.js
// runs the validator in 'generator' context where the failure is HARD; the generator throws at
// step 3 and never reaches step 4, which is the step that registers the jobs. Install-Alex.command
// logs the exit code as a warning and carries on, so a Mac install reported success and left the
// machine with zero scheduled jobs and nothing anywhere saying so.
//
// The guard is behavioural, not a grep: it forces process.platform and asserts which BINARY the
// module reaches for. Run it on any platform - nothing here touches the real scheduler.
//
//   node scripts/tests/test-scheduler-dispatch.mjs
//
// Exit 0 = clean. Exit 1 = findings.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The child half lives in its own file (scripts/tests/fixtures/scheduler-dispatch-probe.cjs): it
// needs tabs, newlines and backslashes in its fixture output, and an inlined string would add one
// more escaping layer for those to be eaten in.
const PROBE = path.join(ROOT, 'scripts', 'tests', 'fixtures', 'scheduler-dispatch-probe.cjs');

function probe(platform, modulePath) {
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FAKE_PLATFORM: platform, MODULE_PATH: modulePath },
  });
  if (r.status !== 0) return { fatal: (r.stderr || '').trim().split('\n').slice(-3).join(' ') };
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch { return { fatal: 'probe produced no JSON: ' + (r.stdout || '').trim() }; }
}

const MODULE = process.env.DISPATCH_MODULE_UNDER_TEST || path.join(ROOT, 'scripts', 'lib', 'gen-scheduler.js');
const findings = [];
const check = (ok, msg) => { if (!ok) findings.push(msg); };

// --- macOS: launchd, never schtasks ------------------------------------------------------------
const mac = probe('darwin', MODULE);
if (mac.fatal) {
  findings.push(`darwin probe crashed: ${mac.fatal}`);
} else {
  check(!mac.error, `liveJobs() THREW on darwin: ${mac.error} - this is the exact break that left a Mac install with no jobs`);
  check(!mac.calls.includes('schtasks'), `liveJobs() reached for schtasks on darwin (calls: ${mac.calls.join(', ')}) - schtasks is a Windows binary and does not exist on macOS`);
  check(mac.calls.includes('launchctl'), `liveJobs() never called launchctl on darwin (calls: ${mac.calls.join(', ') || 'none'})`);
  check(Array.isArray(mac.jobs) && mac.jobs.includes('Alex-email-triage'), `liveJobs() did not return the live launchd agent (got: ${JSON.stringify(mac.jobs)})`);
  check(Array.isArray(mac.jobs) && !mac.jobs.some(j => j.startsWith('Alex-retry-')), `liveJobs() leaked an ephemeral Alex-retry-* agent (got: ${JSON.stringify(mac.jobs)})`);
  check(mac.backend === 'launchd', `backendName() on darwin is ${JSON.stringify(mac.backend)}, expected 'launchd' - a checker that names the wrong backend sends its reader to the wrong tool`);
  check(Array.isArray(mac.notRegisterable) && mac.notRegisterable.includes('Alex-recovery-check'),
    `notRegisterable() on darwin is ${JSON.stringify(mac.notRegisterable)} - it must name the jobs gen-launchd refuses, or V2 reports them missing forever`);
}

// --- Windows: unchanged ------------------------------------------------------------------------
const win = probe('win32', MODULE);
if (win.fatal) {
  findings.push(`win32 probe crashed: ${win.fatal}`);
} else {
  check(!win.error, `liveJobs() THREW on win32: ${win.error}`);
  check(win.calls.includes('schtasks'), `liveJobs() did not call schtasks on win32 (calls: ${win.calls.join(', ') || 'none'})`);
  check(!win.calls.includes('launchctl'), `liveJobs() called launchctl on win32 (calls: ${win.calls.join(', ')})`);
  check(win.backend === 'Windows Task Scheduler', `backendName() on win32 is ${JSON.stringify(win.backend)}`);
  check(Array.isArray(win.notRegisterable) && win.notRegisterable.length === 0, `notRegisterable() on win32 should be empty, got ${JSON.stringify(win.notRegisterable)}`);
}

// --- anything else: refuse with a NAMED reason, never a raw ENOENT -----------------------------
const other = probe('linux', MODULE);
if (other.fatal) {
  findings.push(`linux probe crashed: ${other.fatal}`);
} else {
  check(!!other.error && /supported backends/.test(other.error),
    `liveJobs() on an unsupported platform must refuse with a named reason; got ${JSON.stringify(other.error || other.jobs)}`);
  check(!other.calls.includes('schtasks'), `liveJobs() reached for schtasks on linux (calls: ${other.calls.join(', ')})`);
}

if (findings.length) {
  console.log(`test-scheduler-dispatch: ${findings.length} FAILURE(S)`);
  for (const f of findings) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('test-scheduler-dispatch: ALL PASS (darwin -> launchd, win32 -> schtasks, other -> named refusal)');
