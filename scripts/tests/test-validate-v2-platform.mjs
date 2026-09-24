#!/usr/bin/env node
// scripts/tests/test-validate-v2-platform.mjs - V2's live half on a platform with no local scheduler.
// (2026-09-23, Virtual Alex fleet seat 3.)
//
// WHY, THE DEFECT. This Kit has two scheduler backends, Windows Task Scheduler and macOS launchd. On any
// other platform gen-scheduler's liveJobs() throws "no scheduler backend", by design, and its own
// run() logs the scheduler step as SKIPPED. But validate-alex V2 turned that throw into a hard
// FAILED in the generator context, so `node scripts/generate-alex.js` failed at step 3 on EVERY
// Linux run. Linux is where every online owner lives (the Claude Code cloud VM), and /new, /setup
// and /update all tell the model to run the generator. Found when the online CI list first ran
// test-generate-no-soul.mjs on Ubuntu (template CI run 35924782216, G1 exit 1).
//
// WHAT. No backend on this platform = nothing to compare = a stated WARNING, because the
// scheduler step skips on the same condition. A backend that EXISTS but whose query fails is still
// a hard FAILED in the generator context: that is a real fault on a machine that should have jobs.
//
//   P1  NEGATIVE on a platform with no backend (linux), V2 does not FAIL the generator context
//   P2  and it says so: a WARNING V2 SKIPPED line naming the platform
//   P3  NEGATIVE a supported platform whose query cannot run still FAILS V2 (checked off-darwin by
//       claiming darwin where launchctl is absent; on a real Mac the query works, so it is skipped)
//
// HOW. Runs the real validator's runAll() in a child node with process.platform overridden, and
// reads only V2 lines.
//   node scripts/tests/test-validate-v2-platform.mjs      (exit 0 = all pass)
//
// NEVER. Nothing in the checkout is touched.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

function v2Lines(platform) {
  const js = `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
    const v = require(${JSON.stringify(path.join(KIT, 'scripts', 'validate-alex.js'))});
    v.runAll({ context: 'generator' }).then(() => {}, (e) => { console.error('internal: ' + e.message); });`;
  const r = spawnSync(process.execPath, ['-e', js], { cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
  return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /^(FAILED|WARNING)[^:]*V2\b/.test(l) || /^internal:/.test(l));
}

{
  const lines = v2Lines('linux');
  const failed = lines.filter((l) => /^FAILED V2: .*query unavailable/.test(l));
  ok(failed.length === 0, 'P1 NEGATIVE with no scheduler backend (linux), V2 does not FAIL the generator context', failed.join(' | ') || 'no FAILED V2 live-half line');
  ok(lines.some((l) => /^WARNING V2 SKIPPED \(live half\): .*platform=linux/.test(l)), 'P2 it states the skip and names the platform',
    lines.find((l) => /SKIPPED/.test(l)) || '(no SKIPPED line)');
}
if (process.platform === 'darwin') {
  console.log('SKIP  P3 - this runner IS darwin, where launchctl works, so a failing launchd query cannot be staged here');
} else {
  const lines = v2Lines('darwin');
  ok(lines.some((l) => /^FAILED V2: V2 \(live half\): launchd query unavailable/.test(l)),
    'P3 NEGATIVE a supported backend whose query cannot run still FAILS V2', lines.find((l) => /^FAILED V2/.test(l)) || lines.join(' | ') || '(no V2 line)');
}

console.log(failures === 0 ? '\ntest-validate-v2-platform: ALL PASS' : `\ntest-validate-v2-platform: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
