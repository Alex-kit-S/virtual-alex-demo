#!/usr/bin/env node
// scripts/tests/test-doctor-honesty.mjs - pins release-QC finding #1 (2026-08-31): the doctor's
// Windows shell-retry made cmd.exe ANSWER for missing tools ("'x' is not recognized", exit 1, no
// error object), so every absent required tool false-PASSed - rclone included, on machines where
// a missing rclone means "no backup at all". A doctor that says PASS for an absent tool is worse
// than no doctor: it certifies the exact state it exists to catch.
//
// Black-box on purpose: runs the real doctor and asserts the INVARIANT that broke, so the pin
// holds no matter how the probe internals change:
//   H1  no [PASS] tool row's detail may carry a shell not-found signature
//   H2  a tool row whose probe found nothing real must be [MISS]/[OPT ], never [PASS]
//   H3  the doctor still exits 0/2 (verdicts), never 1 (crash)
//
// Exit 0 = all pass, 1 = any failure.

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

const r = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'bootstrap.mjs')], { encoding: 'utf8', timeout: 300000 });
const out = `${r.stdout || ''}${r.stderr || ''}`;
const lines = out.split(/\r?\n/);

// H1: the exact live symptom QC reproduced - "[PASS] tool rclone 'rclone' is not recognized..."
const NOT_FOUND = /is not recognized|not found|No such file|cannot find/i;
const badPass = lines.filter((l) => l.startsWith('[PASS] tool') && NOT_FOUND.test(l));
ok(badPass.length === 0, 'H1 no PASS row carries a not-found signature', badPass[0] || '');

// H2: every tool row is one of the three honest states with a non-empty detail
const toolRows = lines.filter((l) => /^\[(PASS|MISS|OPT )\] tool/.test(l));
ok(toolRows.length >= 5, 'H2a doctor probed a real tool set', `${toolRows.length} rows`);
const passRows = lines.filter((l) => l.startsWith('[PASS] tool'));
const emptyDetail = passRows.filter((l) => l.trim().split(/\s{2,}/).length < 3);
ok(emptyDetail.length === 0, 'H2b every PASS carries real evidence (version/path)', emptyDetail[0] || '');

// H3: verdict exits only
ok(r.status === 0 || r.status === 2, 'H3 doctor exits 0/2, never crashes', `exit ${r.status}`);

console.log('');
if (failures === 0) {
  console.log('test-doctor-honesty: ALL PASS');
  process.exit(0);
} else {
  console.log(`test-doctor-honesty: ${failures} FAILURE(S)`);
  process.exit(1);
}
