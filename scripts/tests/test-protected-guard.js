#!/usr/bin/env node
// scripts/tests/test-protected-guard.js - unit test for V10 (protected-file guard) in validate-alex.js.
//
// WHAT. Proves evaluateProtectedChangeset over synthetic changesets: the append-only "pure addition"
// rule, the immutable/flagged rules, deletes and renames-away, and a mixed changeset. Deleted, nothing
// else in the tree exercises the pure evaluator directly against a synthetic changeset (readStagedChangeset
// is git-backed and untested here), so a change to the rule table could silently stop blocking a real class
// of protected-file edit.
//
// HOW. Deterministic, no git, no network. Calls evaluateProtectedChangeset(changeset) directly with
// synthetic changesets and asserts the shape and count of its failures/warnings, and, where named, that
// one of the two arrays holds a line naming what happened.
//
// NEVER. Never touches a real commit or the filesystem.
//
// Usage: node scripts/tests/test-protected-guard.js
// Exit: 0 every case passed - 1 one failed
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateProtectedChangeset } = require('../validate-alex');

/**
 * @param {Array<object>} changeset
 * @param {{failures: number, warnings: number, match?: string}} expect
 */
function assertEvaluated(changeset, expect) {
  const { failures, warnings } = evaluateProtectedChangeset(changeset);
  assert.equal(
    failures.length,
    expect.failures,
    `expected ${expect.failures} failure(s), got ${failures.length} -> ${JSON.stringify(failures)}`
  );
  assert.equal(
    warnings.length,
    expect.warnings,
    `expected ${expect.warnings} warning(s), got ${warnings.length} -> ${JSON.stringify(warnings)}`
  );
  if (expect.match)
    assert.ok(
      [...failures, ...warnings].some((l) => l.includes(expect.match)),
      `no line matched '${expect.match}'`
    );
}

describe('append-only', () => {
  test('pure addition is allowed', () => {
    assertEvaluated([{ status: 'M', path: 'vault/log.md', removed: '0' }], { failures: 0, warnings: 0 });
  });

  test('with removed lines FAILS', () => {
    assertEvaluated([{ status: 'M', path: 'vault/log.md', removed: '3' }], {
      failures: 1,
      warnings: 0,
      match: 'append-only vault/log.md'
    });
  });

  test('binary/unknown (removed "-") FAILS (safe direction)', () => {
    assertEvaluated([{ status: 'M', path: 'outputs/ledger.jsonl', removed: '-' }], { failures: 1, warnings: 0 });
  });

  test('delete FAILS', () => {
    assertEvaluated([{ status: 'D', path: 'vault/projects/self-review/close-out-log.md' }], {
      failures: 1,
      warnings: 0,
      match: 'deletes protected append'
    });
  });

  test('rename-away FAILS (old path protected)', () => {
    assertEvaluated([{ status: 'R', oldPath: 'vault/log.md', path: 'vault/log-archive.md' }], {
      failures: 1,
      warnings: 0,
      match: 'renames away'
    });
  });

  test('a type change (T, e.g. swapped for a symlink) FAILS, judged as a modify with removed unknown', () => {
    assertEvaluated([{ status: 'T', path: 'vault/log.md' }], {
      failures: 1,
      warnings: 0,
      match: 'append-only vault/log.md'
    });
  });
});

describe('immutable', () => {
  test('dir member modify FAILS', () => {
    assertEvaluated([{ status: 'M', path: 'vault/sources/cv-import.md', removed: '2' }], {
      failures: 1,
      warnings: 0,
      match: 'immutable'
    });
  });

  test('new file under the dir is allowed (add)', () => {
    assertEvaluated([{ status: 'A', path: 'vault/sources/new-import.md' }], { failures: 0, warnings: 0 });
  });

  test('a type change (T) FAILS the same way a modify does', () => {
    assertEvaluated([{ status: 'T', path: 'vault/sources/cv-import.md' }], {
      failures: 1,
      warnings: 0,
      match: 'immutable'
    });
  });
});

describe('flagged', () => {
  test('modify WARNS, never FAILS', () => {
    assertEvaluated([{ status: 'M', path: 'vault/identity.md', removed: '10' }], {
      failures: 0,
      warnings: 1,
      match: 'flagged vault/identity.md'
    });
  });

  test('delete WARNS, never FAILS', () => {
    assertEvaluated([{ status: 'D', path: 'brand/config/color-system.md' }], { failures: 0, warnings: 1 });
  });

  test('a type change (T) WARNS, never FAILS, the same as a modify', () => {
    assertEvaluated([{ status: 'T', path: 'vault/identity.md' }], {
      failures: 0,
      warnings: 1,
      match: 'flagged vault/identity.md'
    });
  });
});

describe('non-protected + mixed', () => {
  test('non-protected file with removed lines is allowed', () => {
    assertEvaluated([{ status: 'M', path: 'CLAUDE.md', removed: '12' }], { failures: 0, warnings: 0 });
  });

  test('mixed changeset: one append violation + one clean append + one flagged', () => {
    assertEvaluated(
      [
        { status: 'M', path: 'vault/log.md', removed: '0' }, // ok
        { status: 'M', path: 'outputs/ledger.jsonl', removed: '4' }, // FAIL
        { status: 'M', path: 'vault/identity.md', removed: '1' }, // WARN
        { status: 'A', path: 'vault/research/exemplars/index.md' } // ok
      ],
      { failures: 1, warnings: 1 }
    );
  });
});
