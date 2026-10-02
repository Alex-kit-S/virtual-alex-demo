// scripts/tests/fixtures/scheduler-dispatch-probe.cjs - the child half of test-scheduler-dispatch.mjs.
//
// WHAT. Forces process.platform to the value under test, stubs the two binaries the scheduler can reach
// for, requires the module under test, and prints one JSON line naming which binary it actually called.
// Deleted, a regression in the scheduler's per-platform dispatch would go unnoticed by its parent test.
//
// HOW. Kept in its own file rather than inlined as a string in the parent test: the fixture output needs
// tabs, newlines and backslashes, and every layer of string-nesting is one more place for an escape to be
// eaten. Reads FAKE_PLATFORM and MODULE_PATH from the environment, patches child_process.execFileSync and
// child_process.spawnSync before the module under test loads, then requires it and calls liveJobs().
//
// NEVER. Reaches a real scheduler binary: schtasks, launchctl and their callers are replaced before the
// module under test is required.
//
// Usage: module only - spawned by scripts/tests/test-scheduler-dispatch.mjs with FAKE_PLATFORM and
//   MODULE_PATH set
'use strict';

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);

Object.defineProperty(process, 'platform', { value: process.env.FAKE_PLATFORM });

const cp = require('child_process');
const calls = [];

// schtasks /query /fo CSV: names arrive as "\Alex-name". Two leading backslashes in the real CSV
// are one escaped backslash to the regex; the fixture carries the raw byte.
cp.execFileSync = (bin) => {
  calls.push(bin);
  if (bin === 'schtasks') return '"' + BS + 'Alex-from-schtasks","Ready"' + NL;
  if (bin === 'id') return '501';
  throw new Error('unexpected execFileSync: ' + bin);
};

// launchctl list: PID, status, label - tab separated. One standing agent, one ephemeral retry
// (must be filtered), one unrelated Apple agent (must be ignored).
cp.spawnSync = (bin, args) => {
  calls.push(bin);
  if (bin === 'launchctl' && args && args[0] === 'list') {
    const rows = [
      '-' + TAB + '0' + TAB + 'Alex-email-triage',
      '-' + TAB + '0' + TAB + 'Alex-retry-foo-2',
      '123' + TAB + '0' + TAB + 'com.apple.other'
    ];
    return { status: 0, stdout: rows.join(NL) + NL };
  }
  return { status: 0, stdout: '' };
};

const g = require(process.env.MODULE_PATH);

let jobs = null;
let error = null;
try {
  jobs = g.liveJobs();
} catch (e) {
  error = e.message;
}

console.log(
  JSON.stringify({
    backend: typeof g.backendName === 'function' ? g.backendName() : null,
    notRegisterable: typeof g.notRegisterable === 'function' ? Object.keys(g.notRegisterable()) : null,
    jobs,
    error,
    calls
  })
);
