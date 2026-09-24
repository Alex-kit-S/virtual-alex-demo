#!/usr/bin/env node
// test-protected-guard.js - unit test for V10 (protected-file guard) in validate-alex.js.
// Deterministic, no git, no network. Exercises evaluateProtectedChangeset over synthetic
// changesets so the append-only "pure addition" rule and the immutable/flagged rules are proven
// without touching a real commit. Run: node scripts/tests/test-protected-guard.js  (exit 0 = pass).
'use strict';
const assert = require('assert');
const { evaluateProtectedChangeset } = require('../validate-alex');

let passed = 0;
function check(name, changeset, expect) {
  const { failures, warnings } = evaluateProtectedChangeset(changeset);
  try {
    assert.strictEqual(failures.length, expect.failures, `${name}: expected ${expect.failures} failure(s), got ${failures.length} -> ${JSON.stringify(failures)}`);
    assert.strictEqual(warnings.length, expect.warnings, `${name}: expected ${expect.warnings} warning(s), got ${warnings.length} -> ${JSON.stringify(warnings)}`);
    if (expect.match) assert.ok([...failures, ...warnings].some(l => l.includes(expect.match)), `${name}: no line matched '${expect.match}'`);
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

// --- append-only ---------------------------------------------------------------------------
check('append-only pure addition is allowed',
  [{ status: 'M', path: 'vault/log.md', removed: '0' }],
  { failures: 0, warnings: 0 });

check('append-only with removed lines FAILS',
  [{ status: 'M', path: 'vault/log.md', removed: '3' }],
  { failures: 1, warnings: 0, match: 'append-only vault/log.md' });

check('append-only binary/unknown (removed "-") FAILS (safe direction)',
  [{ status: 'M', path: 'outputs/ledger.jsonl', removed: '-' }],
  { failures: 1, warnings: 0 });

check('append-only delete FAILS',
  [{ status: 'D', path: 'vault/projects/self-review/close-out-log.md' }],
  { failures: 1, warnings: 0, match: 'deletes protected append' });

check('append-only rename-away FAILS (old path protected)',
  [{ status: 'R', oldPath: 'vault/log.md', path: 'vault/log-archive.md' }],
  { failures: 1, warnings: 0, match: 'renames away' });

// --- immutable -----------------------------------------------------------------------------
check('immutable dir member modify FAILS',
  [{ status: 'M', path: 'vault/sources/cv-import.md', removed: '2' }],
  { failures: 1, warnings: 0, match: 'immutable' });

check('immutable new file under the dir is allowed (add)',
  [{ status: 'A', path: 'vault/sources/new-import.md' }],
  { failures: 0, warnings: 0 });

// --- flagged -------------------------------------------------------------------------------
check('flagged modify WARNS, never FAILS',
  [{ status: 'M', path: 'vault/identity.md', removed: '10' }],
  { failures: 0, warnings: 1, match: 'flagged vault/identity.md' });

check('flagged delete WARNS, never FAILS',
  [{ status: 'D', path: 'brand/config/color-system.md' }],
  { failures: 0, warnings: 1 });

// --- non-protected + mixed -----------------------------------------------------------------
check('non-protected file with removed lines is allowed',
  [{ status: 'M', path: 'CLAUDE.md', removed: '12' }],
  { failures: 0, warnings: 0 });

check('mixed changeset: one append violation + one clean append + one flagged',
  [
    { status: 'M', path: 'vault/log.md', removed: '0' },                 // ok
    { status: 'M', path: 'system/landscape-log.jsonl', removed: '4' },   // FAIL
    { status: 'M', path: 'vault/identity.md', removed: '1' },            // WARN
    { status: 'A', path: 'vault/research/exemplars/index.md' },          // ok
  ],
  { failures: 1, warnings: 1 });

if (process.exitCode) console.error(`\ntest-protected-guard: FAILED (${passed} passed, then a failure above)`);
else console.log(`\ntest-protected-guard: all ${passed} cases passed`);
