#!/usr/bin/env node
// scripts/tests/test-scheduler-dispatch.mjs - the scheduler backend must follow the PLATFORM.
//
// WHAT. gen-scheduler.js must reach for the scheduler binary that matches the running platform: launchd
// on darwin, the Windows Task Scheduler on win32, and a named refusal everywhere else. Deleted, a
// platform branch could shell straight to the wrong binary (or none) and the failure would surface only
// as a machine left with zero scheduled jobs and nothing saying so, because an installer that logs a
// non-zero exit as a warning and carries on hides exactly that break.
//
// HOW. Behavioural, not a grep: forces process.platform in a child process (scripts/tests/fixtures/
// scheduler-dispatch-probe.cjs) and asserts which BINARY gen-scheduler.js's liveJobs() actually calls, on
// each of the three platforms in turn. Safe to run on any platform - nothing here touches the real
// scheduler: the probe stubs schtasks/launchctl/id at the child_process level before the module under
// test is even required, so no call ever reaches a real binary or a blocker loaded ahead of it.
//
// NEVER. Calls a real scheduler binary: schtasks, launchctl and crontab are stubbed in the child before
// the module under test loads.
//
// Usage: node scripts/tests/test-scheduler-dispatch.mjs
// Exit: 0 no finding - 1 a finding

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The child half lives in its own file (scripts/tests/fixtures/scheduler-dispatch-probe.cjs): it needs
// tabs, newlines and backslashes in its fixture output, and an inlined string would add one more
// escaping layer for those to be eaten in.
const PROBE = path.join(ROOT, 'scripts', 'tests', 'fixtures', 'scheduler-dispatch-probe.cjs');
const MODULE = process.env.DISPATCH_MODULE_UNDER_TEST || path.join(ROOT, 'scripts', 'lib', 'gen-scheduler.js');

function probe(platform, modulePath) {
  const r = spawnSync(process.execPath, [PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FAKE_PLATFORM: platform, MODULE_PATH: modulePath }
  });
  if (r.status !== 0) return { fatal: (r.stderr || '').trim().split('\n').slice(-3).join(' ') };
  try {
    return JSON.parse((r.stdout || '').trim().split('\n').pop());
  } catch {
    return { fatal: `probe produced no JSON: ${(r.stdout || '').trim()}` };
  }
}

describe('gen-scheduler.js dispatches on process.platform', () => {
  test('macOS: launchd, never schtasks', () => {
    const mac = probe('darwin', MODULE);
    assert.equal(mac.fatal, undefined, mac.fatal);
    assert.equal(
      mac.error,
      null,
      `liveJobs() THREW on darwin: ${mac.error} - this is the exact break that left a Mac install with no jobs`
    );
    assert.ok(
      !mac.calls.includes('schtasks'),
      `liveJobs() reached for schtasks on darwin (calls: ${mac.calls.join(', ')}) - schtasks is a Windows binary and does not exist on macOS`
    );
    assert.ok(
      mac.calls.includes('launchctl'),
      `liveJobs() never called launchctl on darwin (calls: ${mac.calls.join(', ') || 'none'})`
    );
    assert.ok(
      Array.isArray(mac.jobs) && mac.jobs.includes('Alex-email-triage'),
      `liveJobs() did not return the live launchd agent (got: ${JSON.stringify(mac.jobs)})`
    );
    assert.ok(
      Array.isArray(mac.jobs) && !mac.jobs.some((j) => j.startsWith('Alex-retry-')),
      `liveJobs() leaked an ephemeral Alex-retry-* agent (got: ${JSON.stringify(mac.jobs)})`
    );
    assert.equal(
      mac.backend,
      'launchd',
      `backendName() on darwin is ${JSON.stringify(mac.backend)}, expected 'launchd' - a checker that names the wrong backend sends its reader to the wrong tool`
    );
    assert.ok(
      Array.isArray(mac.notRegisterable) && mac.notRegisterable.includes('Alex-recovery-check'),
      `notRegisterable() on darwin is ${JSON.stringify(mac.notRegisterable)} - it must name the jobs gen-launchd refuses, or V2 reports them missing forever`
    );
  });

  test('Windows: schtasks, never launchctl', () => {
    const win = probe('win32', MODULE);
    assert.equal(win.fatal, undefined, win.fatal);
    assert.equal(win.error, null, `liveJobs() THREW on win32: ${win.error}`);
    assert.ok(
      win.calls.includes('schtasks'),
      `liveJobs() did not call schtasks on win32 (calls: ${win.calls.join(', ') || 'none'})`
    );
    assert.ok(
      !win.calls.includes('launchctl'),
      `liveJobs() called launchctl on win32 (calls: ${win.calls.join(', ')})`
    );
    assert.equal(win.backend, 'Windows Task Scheduler', `backendName() on win32 is ${JSON.stringify(win.backend)}`);
    assert.ok(
      Array.isArray(win.notRegisterable) && win.notRegisterable.length === 0,
      `notRegisterable() on win32 should be empty, got ${JSON.stringify(win.notRegisterable)}`
    );
  });

  test('anything else: refuse with a NAMED reason, never a raw ENOENT', () => {
    const other = probe('linux', MODULE);
    assert.equal(other.fatal, undefined, other.fatal);
    assert.ok(
      Boolean(other.error) && /supported backends/.test(other.error),
      `liveJobs() on an unsupported platform must refuse with a named reason; got ${JSON.stringify(other.error || other.jobs)}`
    );
    assert.ok(
      !other.calls.includes('schtasks'),
      `liveJobs() reached for schtasks on linux (calls: ${other.calls.join(', ')})`
    );
  });
});
