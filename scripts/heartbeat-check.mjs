#!/usr/bin/env node
// @ts-check
// scripts/heartbeat-check.mjs - fails when no Routine has written to the run log for 48 hours.
//
// WHAT. The one alarm that still sounds when every Routine has stopped. A Routine writes a row to
// system/run-log.jsonl each time it runs; one that has stopped (72 hours without GitHub, a paused
// subscription, a daily cap that binds every night) writes nothing, so nothing inside the system can
// report it. GitHub runs this check once a day from the owner's heartbeat workflow, outside that
// boundary, and a failed check is a failed workflow, which GitHub mails to the owner. It costs no tokens.
//
// HOW. The workflow (variants/online/.github/workflows/heartbeat.yml in the Kit, .github/workflows/ in an
// owner's repository) runs it with no arguments. Its three flags, --file (default system/run-log.jsonl,
// resolved against the repository root, never the cwd or CLAUDE_PROJECT_DIR), --max-hours (default 48)
// and --now (default the clock), are read by scripts/lib/args.js on the operator edge: an unknown flag or
// a known flag with no value is caught here and turned into this file's own REFUSED line, exit 2, never
// args.js's exit 1 or a Node stack. It reads the log through scripts/lib/run-log-read.js
// without its trim. A blank or unparseable line is passed over without a word, and so is a row with no
// string at. A row whose job is session is an interactive close-out, not a Routine: it is counted and
// never kept, or an owner who chats every day would keep the log fresh while every Routine is dead. Of
// the other rows the newest at wins, compared as text, a tie going to the later line. Its age from --now
// is held against --max-hours, the window inclusive. A verdict is one line on stdout, where the workflow
// log shows it; a refusal is one line on stderr.
//
// NEVER. Writes a file or reaches the network. Passes when it cannot tell: it fails closed, so an absent
// log, a log with no Routine row and a newest at that is not a date are each a FAIL, and a path it cannot
// read as a file a crash. Fixes a known defect in passing: any job but session counts as a Routine, at is
// compared as text, and the remedy says two days whatever the window. Each is pinned by
// scripts/tests/test-heartbeat-paths.mjs until its fix lands.
//
// Usage: node scripts/heartbeat-check.mjs [--file <path>] [--max-hours <n>] [--now <iso>]
// Exit: 0 a Routine row inside the window - 1 any FAIL line, or a crash - 2 a bad --file, --max-hours or
// --now, or an unknown flag

import path from 'node:path';
import { REPO } from './lib/repo-root.js';
import { readRunLog } from './lib/run-log-read.js';
import { parseCommandLine } from './lib/args.js';
import { Refusal } from './lib/errors.js';

const DEFAULT_FILE = 'system/run-log.jsonl';
const DEFAULT_MAX_HOURS = 48;
const HOUR_MS = 3_600_000;
// The job an interactive session's close-out writes its row under: never a sign that a Routine ran.
const SESSION_JOB = 'session';
/** @type {import('node:util').ParseArgsOptionsConfig} */
const FLAGS = { file: { type: 'string' }, 'max-hours': { type: 'string' }, now: { type: 'string' } };
// A negative --max-hours is this file's own refusal (below), never args.js's: node:util's strict parseArgs
// calls a value that looks like another flag "ambiguous" unless it is joined with `=`, so `--max-hours -5`
// is rewritten `--max-hours=-5` here, unseen by anything but this parse.
const NEGATIVE_VALUE = /^-\d/;

/** @typedef {{ at: string, job?: unknown }} DatedRow */

/**
 * `--flag -5` joined `--flag=-5` for every known flag whose value looks like a negative number, so
 * parseCommandLine's strict pass does not read it as another flag. Anything else is untouched.
 * @param {string[]} argv
 * @returns {string[]}
 */
function unambiguous(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    const next = argv[i + 1];
    if (name && Object.hasOwn(FLAGS, name) && typeof next === 'string' && NEGATIVE_VALUE.test(next)) {
      out.push(`${argv[i]}=${next}`);
      i++;
    } else {
      out.push(argv[i]);
    }
  }
  return out;
}

// This program's own exit-2 category (section 5.2 of docs/CODE-STANDARD.md): bad arguments, whatever shape
// they take. args.js's own operator-edge refusal is exit 1; that is not this file's contract, so every
// Refusal it raises is caught here and re-said in this file's own words at exit 2.
let values;
try {
  ({ values } = parseCommandLine({
    name: 'heartbeat-check',
    edge: 'operator',
    options: FLAGS,
    argv: unambiguous(process.argv.slice(2))
  }));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`heartbeat: REFUSED - ${error.message}`);
  process.exit(2);
}

/**
 * True for a row with a string at; anything else in the log is no row at all.
 * @param {unknown} value
 * @returns {value is DatedRow}
 */
const isDated = (value) => Boolean(value) && typeof (/** @type {{ at?: unknown }} */ (value).at) === 'string';

/**
 * The newest Routine row by at, compared as text with a tie going to the later line, and how many
 * session rows were set aside on the way.
 * @param {unknown[]} rows
 * @returns {{ newest: DatedRow | null, sessionRows: number }}
 */
function newestRoutineRow(rows) {
  /** @type {DatedRow | null} */
  let newest = null;
  let sessionRows = 0;
  for (const row of rows) {
    if (!isDated(row)) continue;
    if (row.job === SESSION_JOB) {
      sessionRows++;
      continue;
    }
    if (!newest || row.at >= newest.at) newest = row;
  }
  return { newest, sessionRows };
}

const file = path.resolve(REPO, /** @type {string} */ (values.file ?? DEFAULT_FILE));
const maxHours = Number(values['max-hours'] ?? DEFAULT_MAX_HOURS);
const now = new Date(/** @type {string} */ (values.now ?? new Date().toISOString()));
if (!Number.isFinite(maxHours) || maxHours <= 0 || Number.isNaN(now.getTime())) {
  console.error('heartbeat: REFUSED - --max-hours must be a positive number and --now an ISO date');
  process.exit(2);
}
const rel = path.relative(REPO, file).split(path.sep).join('/');

const log = readRunLog(file);
if (!log) {
  console.log(`heartbeat: FAIL - ${rel} is absent: no Routine has ever written a row on this branch`);
  process.exit(1);
}
const { newest, sessionRows } = newestRoutineRow(log.rows);
if (!newest) {
  console.log(
    sessionRows
      ? `heartbeat: FAIL - ${rel} holds only interactive session rows (${sessionRows}): no Routine has ever written a row on this branch`
      : `heartbeat: FAIL - ${rel} has no row with an at field`
  );
  process.exit(1);
}
const ageHours = (now.getTime() - new Date(newest.at).getTime()) / HOUR_MS;
if (!Number.isFinite(ageHours)) {
  console.log(`heartbeat: FAIL - the newest row's at (${newest.at}) is not a date`);
  process.exit(1);
}
const age = `${Math.round(ageHours)} hour(s) old (job ${newest.job}, at ${newest.at})`;
if (ageHours > maxHours) {
  console.log(
    `heartbeat: FAIL - the newest run-log row is ${age}, over the ${maxHours}-hour window: no Routine has written for two days. Open claude.ai/code/routines and check they are on, the GitHub connection holds, and the subscription is not paused.`
  );
  process.exit(1);
}
console.log(`heartbeat: OK - the newest run-log row is ${age}, inside the ${maxHours}-hour window`);
