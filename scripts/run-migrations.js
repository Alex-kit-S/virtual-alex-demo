#!/usr/bin/env node
/*
 * run-migrations.js - carry a change into files that git cannot reach.
 *
 * WHY THIS EXISTS. Most of an update arrives by git: a new skill, a house-style rule, a line
 * in the constitution. But the files that hold WHO THE OWNER IS are gitignored on purpose, so
 * that whoever hosts the repo never sees their content. soul.md is the main one. That privacy
 * is worth keeping and it has a cost: an improvement to the voice rules has no way in.
 *
 * A migration is that way in. It runs locally, after the merge, against files only this
 * machine has.
 *
 * THE RULES THIS RUNNER FOLLOWS, ALL FOUR FOR THE SAME REASON. The person running it may not
 * read code, may be mid-sentence in a real piece of work, and cannot debug a half-applied edit.
 *   1. ONCE. Applied ids are recorded in system/migrations-applied.json and never re-run.
 *   2. NEVER FAILS THE UPDATE. A migration that cannot run is not an emergency. It reports and
 *      the update still succeeds, because the git half already landed and is worth keeping.
 *   3. A DECLINE IS NOT A FAILURE AND IS NOT RECORDED AS DONE. If a migration cannot find what
 *      it expects it leaves the file untouched and stays pending, so a later run or a person
 *      can complete it. Recording a decline as applied would lose the change silently, which is
 *      the worst outcome available here.
 *   4. PLAIN ENGLISH OUT. No diffs, no stack traces, no file paths in the normal case.
 *
 * THE LEDGER GOES THROUGH THE JSON STANDARD (2026-09-23, Virtual Alex fleet seat 3). This script is
 * the ONE writer of system/migrations-applied.json and it writes through scripts/lib/json-writer.js,
 * so the file carries the four-field header and canonical bytes, and it is on the enforced list in
 * system/kit-manifest.json (validate-alex V21 blocks a hand-edit of it). Two consequences:
 *   - A ledger written before this change has no header. It is still READ exactly as before, and
 *     every non-dry run rewrites it through the helper even when nothing is pending, so the first
 *     update after this change heals it. /update runs this script before its commit, which is why
 *     that commit never meets V21 holding a legacy ledger.
 *   - A ledger carrying a DIFFERENT schema (a newer Kit wrote it) is not guessed at (rule 4 of the
 *     standard). Nothing runs, the file is left alone, and the run still succeeds (rule 2 above),
 *     because re-running every migration against an unknown record is the one outcome worse than
 *     running none.
 *
 * Usage:  node scripts/run-migrations.js            apply what is pending
 *         node scripts/run-migrations.js --dry-run  say what would run, change nothing
 *         node scripts/run-migrations.js --list     show every migration and its state
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJson } = require('./lib/json-writer.js');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'scripts', 'migrations');
const LEDGER = path.join(ROOT, 'system', 'migrations-applied.json');
const DRY = process.argv.includes('--dry-run');
const LIST = process.argv.includes('--list');
const SCHEMA = 'migrations-applied@1';
const WRITER = 'scripts/run-migrations.js';
const PURPOSE = 'Which numbered migrations have run on this copy, so that each one runs exactly once.';

// Returns { applied, foreign }. `foreign` is the schema a newer writer stamped, when it is not ours;
// the caller then runs nothing. A ledger with no _schema is the pre-standard shape and reads as before.
function readLedger() {
  let j;
  try { j = JSON.parse(fs.readFileSync(LEDGER, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return { applied: [], foreign: null }; }
  if (j && typeof j === 'object' && j._schema !== undefined && j._schema !== SCHEMA) {
    return { applied: [], foreign: String(j._schema) };
  }
  return { applied: Array.isArray(j && j.applied) ? j.applied : [], foreign: null };
}

function writeLedger(led) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeJson(LEDGER, { applied: led.applied }, { purpose: PURPOSE, writer: WRITER, schema: SCHEMA });
}

// Rewrite an existing ledger through the helper. A no-op when it already conforms (the helper does
// not write unchanged bytes); a legacy or damaged-bytes ledger is healed with its content kept.
function healLedger(led) {
  if (fs.existsSync(LEDGER)) writeLedger(led);
}

function main() {
  if (!fs.existsSync(DIR)) { console.log('No migrations to run.'); return 0; }

  const files = fs.readdirSync(DIR).filter(f => /^\d{3}-.*\.js$/.test(f)).sort();
  const ledger = readLedger();
  if (ledger.foreign) {
    // Rule 4 of the JSON standard, inside rule 2 of this runner: refuse loudly, fail nothing.
    console.log('  The record of finished setup steps was written by a newer version of Alex, so none were run.');
    console.log(`  Details for whoever set this up: system/migrations-applied.json has schema ${ledger.foreign}, this runner reads ${SCHEMA}.`);
    return 0;
  }
  const done = new Set(ledger.applied.map(a => a.id));

  if (LIST) {
    if (!files.length) console.log('No migrations exist.');
    for (const f of files) {
      const id = f.replace(/\.js$/, '');
      console.log(`  ${done.has(id) ? '[done]   ' : '[pending]'} ${id}`);
    }
    return 0;
  }

  const pending = files.filter(f => !done.has(f.replace(/\.js$/, '')));
  if (!pending.length) {
    if (!DRY) healLedger(ledger);
    console.log('Nothing new to set up.');
    return 0;
  }

  for (const f of pending) {
    const id = f.replace(/\.js$/, '');
    if (DRY) { console.log(`  would run: ${id}`); continue; }

    let res;
    try {
      const mod = require(path.join(DIR, f));
      res = mod.run({ root: ROOT, log: m => console.log(`    ${m}`) });
    } catch (e) {
      // Rule 2: an exception is reported, never thrown onward, and never recorded as applied.
      console.log(`  Could not finish one setup step. Nothing was changed by it.`);
      console.log(`  Details for whoever set this up: ${id}: ${e.message}`);
      continue;
    }

    const status = (res && res.status) || 'declined';
    const message = (res && res.message) || '';

    if (status === 'applied' || status === 'skipped') {
      ledger.applied.push({ id, status, date: new Date().toISOString().slice(0, 10) });
      writeLedger(ledger);
      if (message) console.log(`  ${message}`);
    } else {
      // Rule 3: stays pending on purpose.
      console.log(`  One setup step was skipped: ${message}`);
      // A cloud session has no Desktop and no update-log.txt; its support path is /support-bundle
      // (fleet Fix C, review finding F40).
      console.log(process.env.CLAUDE_CODE_REMOTE === 'true'
        ? `  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.`
        : `  Alex still works. Send update-log.txt from your Desktop to whoever set this up.`);
    }
  }
  if (!DRY) healLedger(ledger);
  return 0;
}

process.exit(main());
