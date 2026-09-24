#!/usr/bin/env node
// scripts/tests/test-validate-v9.mjs - validate-alex V9 first-fire aging must be SILENT on a
// day-one install. (2026-09-23, Virtual Alex fleet seat 1.)
//
// WHY. The defect, measured on a real install: /setup is what stamps `created:` in a project's
// status.md, so on the first day of any install not one project has a date. V9 filed an unknown
// date as OVERDUE, and every new owner opened their brand new Alex to a list of projects "PAST the
// 14-day window". That is not a measurement, it is an assumption reported as one, and a guard that
// cries on day one is a guard its owner learns to scroll past.
//
// WHAT. V9 says nothing about a project whose age it cannot know:
//   W1  NEGATIVE on a mature install, an undated never-fired row is named undated, never overdue
//       (its own fixture since F17: it used to stage W2's tree, where V9 never reads a row)
//   W2  a day-one install (no created: anywhere) says nothing at all
//   W3  a young install (every created: inside the window) says nothing at all
//   W4  a mature install DOES flag a genuinely overdue project, so the check still works
//   W5  a mature install reports an undated row as undated, on its own line, never as overdue
//   W6  NEGATIVE with no dated page, an install record stamped 40 days ago still ages the install
//       (review finding F17: it was silent forever); W7 stamped today it stays silent
//   W8  online only, the repository's first commit ages it too; on a laptop the Kit's history never does
//
// HOW. Runs the REAL validator against this checkout with a --staged overlay carrying the status
// pages one case at a time.
//   node scripts/tests/test-validate-v9.mjs      (exit 0 = all pass)
//
// NEVER. The working tree is never touched.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const installState = createRequire(import.meta.url)(path.join(KIT, 'scripts', 'lib', 'install-state.js'));

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};
const show = (label, lines) => { if (lines.length) console.log(`      ${label}: ${lines.join('\n      ')}`); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-validate-v9-'));
const manifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'manifest.json'), 'utf8'));
const rows = [...manifest.projects, ...((manifest.meta && manifest.meta.unnumbered) || [])];
const neverFired = rows.filter((p) => (p.state === 'LIVE' || p.state === 'EVENT') && !p.first_fire && p.status_md);

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Stage a status.md for each row that has one. `dates` maps a status_md path to a created: date, or
// to null for "ship this page without a created: line".
function staged(dates) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  for (const p of rows) {
    if (!p.status_md) continue;
    const when = Object.prototype.hasOwnProperty.call(dates, p.status_md) ? dates[p.status_md] : dates['*'];
    const dst = path.join(dir, p.status_md);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const head = when ? `---\ncreated: ${when}\n---\n` : '';
    fs.writeFileSync(dst, `${head}# ${p.name}\n\nA staged status page for the V9 test.\n`);
  }
  return dir;
}

function v9(stagedDir) {
  const r = spawnSync(process.execPath, [VALIDATOR, '--context=pre-commit', `--staged=${stagedDir}`], {
    cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '' },
  });
  return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /V9:/.test(l));
}

ok(neverFired.length > 0, 'the real registry has never-fired LIVE/EVENT rows to age', `${neverFired.length} row(s)`);

// --- W1 NEGATIVE: the rule that shipped, on an install old enough to reach it ------------------
// The old rule counted `ageDays === null` as overdue. Until 2026-09-24 W1 staged the SAME day-one tree
// as W2 (fleet review F17), where V9 returns before it looks at any row, so W1 could not fail unless W2
// did. Its own fixture now: the install is 40 days old by the pages of projects that are NOT waiting on
// a first fire, and every never-fired page is undated. That reaches the per-row rule, where the old
// rule files all of them PAST the window and the right one names them as undated.
{
  const dates = { '*': daysAgo(40) };
  for (const p of neverFired) dates[p.status_md] = null;
  const lines = v9(staged(dates));
  show('W1', lines);
  const overdue = lines.filter((l) => /PAST the 14-day window/.test(l));
  const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
  ok(overdue.length === 0 && neverFired.every((p) => undatedLine.includes(p.name)),
    'W1 NEGATIVE on a 40-day-old install, undated never-fired rows are named as undated and never called PAST the window',
    overdue.length ? overdue.join(' | ') : (undatedLine.slice(0, 120) || 'no V9 line at all'));
}

// --- W2 a day-one install is silent -----------------------------------------------------------
{
  const lines = v9(staged({ '*': null }));
  ok(lines.length === 0, 'W2 a day-one install (no created: anywhere) says nothing at all',
    lines.length ? lines.join(' | ') : 'silent');
}

// --- W3 a young install is silent -------------------------------------------------------------
{
  const lines = v9(staged({ '*': daysAgo(3) }));
  ok(lines.length === 0, 'W3 an install whose oldest page is 3 days old says nothing at all',
    lines.length ? lines.join(' | ') : 'silent');
}

// --- W4 a mature install still flags a real overdue project -----------------------------------
{
  const victim = neverFired[0];
  const lines = v9(staged({ '*': daysAgo(3), [victim.status_md]: daysAgo(90) }));
  show('W4', lines);
  const overdue = lines.filter((l) => /PAST the 14-day window/.test(l));
  ok(overdue.length === 1 && overdue[0].includes(victim.name),
    'W4 a 90-day-old never-fired project IS flagged, so the check still does its job',
    overdue.join(' | ') || 'nothing flagged, which is a regression');
}

// --- W5 a mature install reports an undated row as undated ------------------------------------
{
  const aged = neverFired[0];
  const undated = neverFired[1] || neverFired[0];
  const dates = { '*': daysAgo(40), [undated.status_md]: null };
  const lines = v9(staged(dates));
  show('W5', lines);
  const overdueLine = lines.find((l) => /PAST the 14-day window/.test(l)) || '';
  const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
  if (neverFired.length > 1) {
    ok(undatedLine.includes(undated.name),
      'W5 the undated row gets its own line naming it as undated', undatedLine || 'no undated line');
    ok(!overdueLine.includes(undated.name),
      'W5 and it is NOT on the overdue line', overdueLine);
    ok(overdueLine.includes(aged.name),
      'W5 while the genuinely aged row still is', overdueLine);
  } else {
    ok(undatedLine !== '', 'W5 the undated row gets its own line', undatedLine || 'no undated line');
  }
}

// --- W6 NEGATIVE: no page dated, but the install record says the install is old ----------------
// Review finding F17: install age came ONLY from status pages, so an install of any age whose pages
// carry no created: date was silent forever. The install record's stamp date is a lower bound on the
// install's age (it cannot have been installed after its own stamp), so it may speak when no page can.
// Written through the record's one writer, as every other file must (test-install-state I7).
const withInstallState = (dir, date) => {
  installState.stamp(dir, 'a'.repeat(40), { by: 'test', at: date });
  return dir;
};
{
  const lines = v9(withInstallState(staged({ '*': null }), daysAgo(40)));
  show('W6', lines);
  const undatedLine = lines.find((l) => /no created: date to age them against/.test(l)) || '';
  ok(undatedLine !== '' && !lines.some((l) => /PAST the 14-day window/.test(l)),
    'W6 NEGATIVE an install stamped 40 days ago with no dated page reports its undated rows (as undated, never as overdue)',
    undatedLine.slice(0, 120) || 'silent, the F17 defect');
}
// --- W7 and a day-one install with a record stamped today is still silent ---------------------
{
  const lines = v9(withInstallState(staged({ '*': null }), daysAgo(0)));
  ok(lines.length === 0, 'W7 a day-one install with its record stamped today stays silent (the fallback does not bring back W1)',
    lines.length ? lines.join(' | ') : 'silent');
}

// --- W8 online only, the repository's first commit ages the install; a laptop never reads it -----
// The owner's repository begins at install, so online its first commit is a clock. A laptop's first
// commit is the Kit's own history, older than any install, and reading it there would bring W1 back.
{
  const root = spawnSync('git', ['log', '--max-parents=0', '--format=%cI', 'HEAD'], { cwd: KIT, encoding: 'utf8' });
  const first = String(root.stdout || '').trim().split(/\r?\n/).filter(Boolean).sort()[0] || '';
  const age = first ? Math.floor((Date.now() - Date.parse(first)) / 86400000) : -1;
  const v9env = (dir, remote) => {
    const r = spawnSync(process.execPath, [VALIDATOR, '--context=pre-commit', `--staged=${dir}`], {
      cwd: KIT, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: remote },
    });
    return `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).filter((l) => /V9:/.test(l));
  };
  if (age > 14) {
    const online = v9env(staged({ '*': null }), 'true');
    ok(online.some((l) => /no created: date to age them against/.test(l)),
      `W8a online, a repository whose first commit is ${age} days old ages the install with no record and no dated page`, online.join(' | ').slice(0, 120) || 'silent');
    const laptop = v9env(staged({ '*': null }), '');
    ok(laptop.length === 0, 'W8b on a laptop the same checkout stays silent: the Kit\'s own history is not an install date', laptop.join(' | ') || 'silent');
  } else {
    console.log(`SKIP  W8 this checkout's first commit is ${age} day(s) old, inside the window, so it cannot tell the two lanes apart`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 });
console.log(failures === 0 ? '\ntest-validate-v9: ALL PASS' : `\ntest-validate-v9: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
