#!/usr/bin/env node
// scripts/tests/test-validate-v2-platform.mjs - V2's live half on a platform with no local scheduler.
//
// WHAT. Proves validate-alex's V2 (the live-scheduler check) treats "no backend on this platform" as a
// stated WARNING, never a hard FAILED, while a supported backend whose query genuinely cannot run still
// fails. Deleted, this file would let a `generate-alex.js` run on Linux (every online owner's Claude Code
// cloud VM) FAIL at step 3 for a condition that was never a fault.
//
// WHY. This Kit has two scheduler backends, Windows Task Scheduler and macOS launchd. On any other
// platform gen-scheduler's liveJobs() throws "no scheduler backend", by design, and its own run() logs
// the scheduler step as SKIPPED. A validator that turned that throw into a hard FAILED in the generator
// context would fail `node scripts/generate-alex.js` at step 3 on every Linux run - every online owner's
// Claude Code cloud VM.
//
//   P1  NEGATIVE on a platform with no backend (linux), V2 does not FAIL the generator context
//   P2  and it says so: a WARNING V2 SKIPPED line naming the platform
//   P3  NEGATIVE a supported platform whose query cannot run still FAILS V2 (staged with
//       C4_LAUNCHCTL_THROW, which the fixture answers the same way on every host, real darwin included)
//
// HOW. Runs the real validator's runAll() in a child node with process.platform overridden, and reads
// only V2 lines. linux never reaches a real scheduler binary at all (no backend = no call). darwin's
// launchctl is answered by the shared scheduler-stub fixture with C4_LAUNCHCTL_THROW set, so the "query
// cannot run" case is a controlled refusal inside the fixture rather than a real absent binary or a fall
// through to whatever blocker NODE_OPTIONS may have loaded ahead of it (which would otherwise log a
// scheduler refusal of its own for a case this file MEANS to exercise).
//
// NEVER. Touches anything in the checkout, or a real scheduler binary.
//
// Usage: node scripts/tests/test-validate-v2-platform.mjs
// Exit: 0 all pass - 1 a failure

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');

function v2Lines(platform, env = {}) {
  // Platform is pinned by the scheduler-stub fixture itself, from C4_PLATFORM: not redefined here too,
  // since process.platform is not configurable a second time in the same process.
  const js = `const v = require(${JSON.stringify(path.join(KIT, 'scripts', 'validate-alex.js'))});
    v.runAll({ context: 'generator' }).then(() => {}, (e) => { console.error('internal: ' + e.message); });`;
  const r = spawnSync(process.execPath, ['-r', SCHED_STUB, '-e', js], {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_PLATFORM: platform, ...env }
  });
  return `${r.stdout || ''}\n${r.stderr || ''}`
    .split(/\r?\n/)
    .filter((l) => /^(FAILED|WARNING)[^:]*V2\b/.test(l) || /^internal:/.test(l));
}

describe('validate-alex V2, the live half, staged across platforms through the scheduler stub', () => {
  test('P1 NEGATIVE with no scheduler backend (linux), V2 does not FAIL the generator context; P2 it states the skip and names the platform', () => {
    const lines = v2Lines('linux');
    const failed = lines.filter((l) => /^FAILED V2: .*query unavailable/.test(l));
    assert.deepEqual(failed, [], 'no FAILED V2 live-half line');
    assert.ok(
      lines.some((l) => /^WARNING V2 SKIPPED \(live half\): .*platform=linux/.test(l)),
      `expected a WARNING V2 SKIPPED line naming platform=linux, got: ${lines.join(' | ') || '(nothing)'}`
    );
  });

  test('P3 NEGATIVE a supported backend whose query cannot run still FAILS V2', () => {
    // C4_LAUNCHCTL_THROW stages the failure inside the fixture: cp.spawnSync/execFileSync are
    // patched to intercept any call named launchctl before it reaches a real binary, whatever the host
    // actually is, so this case runs the same way on a real darwin runner as on Windows or Linux.
    const lines = v2Lines('darwin', { C4_LAUNCHCTL_THROW: '1' });
    assert.ok(
      lines.some((l) => /^FAILED V2: V2 \(live half\): launchd query unavailable/.test(l)),
      `expected a FAILED V2 launchd-unavailable line, got: ${lines.join(' | ') || '(nothing)'}`
    );
  });
});
