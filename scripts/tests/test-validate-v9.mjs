#!/usr/bin/env node
// scripts/tests/test-validate-v9.mjs - validate-alex V9 first-fire aging must be SILENT on a
// day-one install.
//
// WHY. /setup is what stamps `created:` in a project's status.md, so on the first day of any install
// not one project has a date. Filing an unknown date as OVERDUE treats an absence of evidence as
// evidence: a day-one owner would open their brand new Alex to a list of projects "PAST the 14-day
// window" with no elapsed time behind the claim. A guard that cries on day one is a guard its owner
// learns to scroll past.
//
// WHAT. V9 says nothing about a project whose age it cannot know:
//   W1  NEGATIVE on a mature install, an undated never-fired row is named undated, never overdue
//   W2  a day-one install (no created: anywhere) says nothing at all
//   W3  a young install (every created: inside the window) says nothing at all
//   W4  a mature install DOES flag a genuinely overdue project, so the check still works
//   W5  a mature install reports an undated row as undated, on its own line, never as overdue
//   W6  NEGATIVE with no dated page, an install record stamped 40 days ago still ages the install,
//       rather than leaving an undated-everywhere install silent forever; W7 stamped today it stays silent
//   W8  online only, the repository's first commit ages it too; on a laptop the Kit's history never does
// Deleted, a fresh install would greet every new owner with a false OVERDUE list on day one, teaching
// them to distrust the guard immediately.
//
// HOW. Runs the REAL validator against this checkout with a --staged overlay carrying the status
// pages one case at a time, so nothing in the working tree is touched. Every run loads the shared
// scheduler-stub fixture (scripts/tests/fixtures/scheduler-stub.cjs) with an empty C4_LIVE, so V2's
// live-scheduler leg never reaches this machine's real Task Scheduler - none of the cases here read a
// V2 line (every filter below keeps "V9:" lines only), so the fixed, silent answer never changes what
// is asserted.
//
// NEVER. The working tree is never touched, and no real scheduler binary is reached.
//
// Usage: node scripts/tests/test-validate-v9.mjs
// Exit: 0 all pass - 1 a failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const installState = createRequire(import.meta.url)(path.join(KIT, 'scripts', 'lib', 'install-state.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-v9-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];
const neverFired = rows.filter((p) => (p.state === 'LIVE' || p.state === 'EVENT') && !p.first_fire && p.status_md);

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Stage a status.md for each row that has one. `dates` maps a status_md path to a created: date, or
// to null for "ship this page without a created: line".
function staged(dates) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  for (const p of rows) {
    if (!p.status_md) continue;
    const when = Object.hasOwn(dates, p.status_md) ? dates[p.status_md] : dates['*'];
    const dst = path.join(dir, p.status_md);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const head = when ? `---\ncreated: ${when}\n---\n` : '';
    fs.writeFileSync(dst, `${head}# ${p.name}\n\nA staged status page for the V9 test.\n`);
  }
  return dir;
}

function v9(stagedDir, env = {}) {
  const r = spawnSync(
    process.execPath,
    ['-r', SCHED_STUB, VALIDATOR, '--context=pre-commit', `--staged=${stagedDir}`],
    {
      cwd: KIT,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '', ...env }
    }
  );
  return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /V9:/.test(l));
}
const show = (label, lines) => {
  if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`);
};

describe('validate-alex V9: first-fire aging is silent on an install whose age it cannot know', () => {
  test('the real registry has never-fired LIVE/EVENT rows to age', () => {
    assert.ok(neverFired.length > 0, `${neverFired.length} row(s)`);
  });

  test('W1 NEGATIVE on a 40-day-old install, undated never-fired rows are named as undated and never called PAST the window', () => {
    // The old rule counted `ageDays === null` as overdue. The install is 40 days old by the pages of
    // projects that are NOT waiting on a first fire, and every never-fired page is undated. That
    // reaches the per-row rule, where the old rule files all of them PAST the window and the right
    // one names them as undated.
    const dates = { '*': daysAgo(40) };
    for (const p of neverFired) dates[p.status_md] = null;
    const lines = v9(staged(dates));
    show('W1', lines);
    const overdue = lines.filter((l) => /PAST the 14-day window/.test(l));
    const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
    assert.ok(
      overdue.length === 0 && neverFired.every((p) => undatedLine.includes(p.name)),
      overdue.length ? overdue.join(' | ') : undatedLine.slice(0, 120) || 'no V9 line at all'
    );
  });

  test('W2 a day-one install (no created: anywhere) says nothing at all', () => {
    const lines = v9(staged({ '*': null }));
    assert.deepEqual(lines, [], lines.join(' | '));
  });

  test('W3 an install whose oldest page is 3 days old says nothing at all', () => {
    const lines = v9(staged({ '*': daysAgo(3) }));
    assert.deepEqual(lines, [], lines.join(' | '));
  });

  test('W4 a 90-day-old never-fired project IS flagged, so the check still does its job', () => {
    const victim = neverFired[0];
    const lines = v9(staged({ '*': daysAgo(3), [victim.status_md]: daysAgo(90) }));
    show('W4', lines);
    const overdue = lines.filter((l) => /PAST the 14-day window/.test(l));
    assert.ok(
      overdue.length === 1 && overdue[0].includes(victim.name),
      overdue.join(' | ') || 'nothing flagged, which is a regression'
    );
  });

  test('W5 a mature install reports an undated row as undated', () => {
    const aged = neverFired[0];
    const undated = neverFired[1] || neverFired[0];
    const dates = { '*': daysAgo(40), [undated.status_md]: null };
    const lines = v9(staged(dates));
    show('W5', lines);
    const overdueLine = lines.find((l) => /PAST the 14-day window/.test(l)) || '';
    const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
    if (neverFired.length > 1) {
      assert.ok(undatedLine.includes(undated.name), undatedLine || 'no undated line');
      assert.ok(!overdueLine.includes(undated.name), overdueLine);
      assert.ok(overdueLine.includes(aged.name), overdueLine);
    } else {
      assert.notEqual(undatedLine, '', 'no undated line');
    }
  });

  test('W6 NEGATIVE an install stamped 40 days ago with no dated page reports its undated rows (as undated, never as overdue)', () => {
    // With status pages alone, an install whose pages carry no created: date would stay silent at any
    // age. The install record's stamp date is a lower bound on the install's age, so it may speak when
    // no page can. Written through the record's one writer, as every other file must.
    const dir = staged({ '*': null });
    installState.stamp(dir, 'a'.repeat(40), { by: 'test', at: daysAgo(40) });
    const lines = v9(dir);
    show('W6', lines);
    const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
    assert.ok(
      undatedLine !== '' && !lines.some((l) => /PAST the 14-day window/.test(l)),
      undatedLine.slice(0, 120) || 'expected the row to stay silent'
    );
  });

  test('W7 a day-one install with its record stamped today stays silent (the fallback does not bring back W1)', () => {
    const dir = staged({ '*': null });
    installState.stamp(dir, 'a'.repeat(40), { by: 'test', at: daysAgo(0) });
    const lines = v9(dir);
    assert.deepEqual(lines, [], lines.join(' | '));
  });
});
