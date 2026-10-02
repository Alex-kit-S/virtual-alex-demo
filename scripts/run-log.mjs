#!/usr/bin/env node
// @ts-check
// scripts/run-log.mjs - appends one row per run to system/run-log.jsonl and reads back the newest per job.
//
// WHAT. The run log of a Virtual Alex install: every Routine and every session close-out appends one row
// saying which job ran, how it ended and why. It replaces system/run-status.json online, a single document
// every job rewrote: two writers finishing in the same minute is a merge conflict by construction, while
// appended rows union-merge (.gitattributes). /status, the brief and the Routines read the newest row per
// job back through `last`. A laptop install never has the file, and /status reads run-status.json there.
//
// HOW. The log is system/run-log.jsonl in this script's repository, whatever the working directory. `append`
// first walks its own argv by hand, preprocessAppendArgs: a bare word
// with no flag before it is warned and dropped; a known flag (job/status/reason/canary/model/missed/
// session-url/repo/sha) followed by nothing, or by one of those SAME flag names, is warned and dropped, its
// slot left null; a known flag followed by anything else - a word that merely starts with a dash included,
// `--reason "--dry-run was used"` included - takes that word as its value, rewritten `--flag=value` so
// node's parseArgs never sees a bare dash-led value and never calls it ambiguous. This exists because
// args.js's own parseArgs cannot make that distinction; only a truly UNKNOWN flag (--foo) is left for
// args.js's 'routine' edge to warn and drop, unchanged. By the time parseCommandLine runs, nothing it could
// refuse remains, so its wording never reaches a user on this path. What comes back is then checked in a
// fixed order, at this program's own EXIT_REFUSED (2), unchanged: an enum, a sha shape, a repository name,
// --job non-empty. The row always carries the same ten keys, a flag not given written null; `at` is UTC to
// the second; repo and sha are the snapshot Routine's, collapsed through the JSON writer's canonical text
// to one line, appended with a line feed, and read back: the file's last line must be that row. `last`
// reads through scripts/lib/run-log-read.js with `trim` set, forgiving a byte-order mark or a non-breaking
// space at either end, naming each non-JSON line on stderr, newest row per job by `at` as text, a tie going
// to the later line. A refusal is one line on stderr and writes nothing.
//
// NEVER. Rewrites or repairs a line already in the log. Lets args.js's own wording or exit code reach a user
// of `append`. Fixes in passing a defect that test pins: a row holding a key the writer refuses stops `last`
// (RL-D1), a file with no final line feed glues two appended rows into one bad line (RL-D2), a repeated flag
// is taken silently with the last one winning (RL-D4), `last` ignores extra words, unknown flags included,
// since it never routes through args.js (RL-D5), and --job is checked only for being non-empty (RL-D7).
//
// Usage: node scripts/run-log.mjs append --job <name> --status <COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED>
//          [--reason <text>] [--canary ok|missing] [--model <id>] [--missed <n>] [--session-url <url>]
//          [--repo <owner/name>] [--sha <commit>]
//        node scripts/run-log.mjs last [<job>]
// Exit: 0 appended, or the rows printed - 1 an error, or the row did not read back - 2 refused, nothing written

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { jsonlRow } = require('./lib/json-writer.js');
const { readRunLog } = require('./lib/run-log-read.js');
const { parseCommandLine } = require('./lib/args.js');

// Computed by hand rather than imported from repo-root.js: every test that reaches this file copies it
// alone, without scripts/lib/, so a shared repo-root module would have to join each of those copy lists.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(REPO, 'system', 'run-log.jsonl');
// The log's path as every message names it: relative to the repository, with the platform's separator.
const FILE_SHOWN = path.relative(REPO, FILE);

const STATUSES = ['COMPLETE', 'PARTIAL', 'BLOCKED', 'SKIPPED', 'RED'];
const CANARIES = ['ok', 'missing'];
// `append`'s parseArgs option table: every value is a string this program validates itself, below.
/** @type {import('node:util').ParseArgsOptionsConfig} */
const APPEND_OPTIONS = {
  job: { type: 'string' },
  status: { type: 'string' },
  reason: { type: 'string' },
  canary: { type: 'string' },
  model: { type: 'string' },
  missed: { type: 'string' },
  'session-url': { type: 'string' },
  repo: { type: 'string' },
  sha: { type: 'string' }
};
// The flags append recognises, each spelled the way it arrives on a command line, derived from
// APPEND_OPTIONS so the two can never drift apart: a hand-copied set would let a flag silently fall out
// of one and not the other. Used only to tell "a value that happens to start with a dash" apart from
// "another one of this command's own flags, given no value" - args.js's own unknown-flag warn (a flag not
// in this list) is untouched by it.
const KNOWN_FLAGS = new Set(Object.keys(APPEND_OPTIONS).map((k) => `--${k}`));
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const MAX_REPO_LENGTH = 200;
const WHOLE_NUMBER = /^\d+$/;
// `at` is the clock to the second: the milliseconds toISOString adds are cut.
const MILLISECONDS = /\.\d{3}Z$/;
const USAGE =
  'usage: run-log.mjs append --job <name> --status <COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED> [--reason ..] [--canary ok|missing] [--model ..] [--missed <n>] [--session-url ..] [--repo ..] [--sha ..] | last [<job>]';

const EXIT_ERROR = 1;
const EXIT_REFUSED = 2;

/**
 * @typedef {object} Row
 * @property {string} at
 * @property {string | null} canary
 * @property {string} job
 * @property {number | null} missed
 * @property {string | null} model
 * @property {string | null} reason
 * @property {string | null} repo
 * @property {string | null} session_url
 * @property {string | null} sha
 * @property {string} status
 */

/**
 * Print the refusal and stop with nothing written, at EXIT_REFUSED (2), the one code every refusal here uses.
 * @param {string} msg
 * @returns {never}
 */
const refuse = (msg) => {
  console.error(`run-log: REFUSED - ${msg}`);
  process.exit(EXIT_REFUSED);
};

/**
 * One row as the log holds it: the JSON writer's canonical text, collapsed to one line.
 * @param {object} row
 * @returns {string}
 */
const rowText = jsonlRow;

/**
 * Every row the log holds, in file order; a line that is not JSON is named on stderr and skipped.
 * @returns {unknown[]}
 */
function readRows() {
  const log = readRunLog(FILE, { trim: true });
  if (!log) return [];
  for (const bad of log.unparseable) {
    console.error(`run-log: WARN ${FILE_SHOWN}:${bad.line} is not JSON, skipped`);
  }
  return log.rows;
}

/**
 * The newest row of each job by `at`, compared as text; on a tie the later line wins, which is append order.
 * A row with no string job is no one's.
 * @param {unknown[]} rows
 * @returns {Map<string, { at?: unknown }>}
 */
function newestPerJob(rows) {
  /** @type {Map<string, { at?: unknown }>} */
  const best = new Map();
  for (const value of rows) {
    const r = /** @type {{ job?: unknown, at?: unknown } | null} */ (value);
    if (!r || typeof r.job !== 'string') continue;
    const cur = best.get(r.job);
    if (!cur || String(r.at || '') >= String(cur.at || '')) best.set(r.job, r);
  }
  return best;
}

/**
 * Refuse a job, status, canary, sha or repo append cannot store, in the order a reader of the refusals has
 * always seen them. A flag append does not take never reaches here: args.js's 'routine' edge already
 * dropped it with a warning, or, for a known flag given no value, refused before this runs.
 * @param {Record<string, string>} o
 */
function refuseBadFlags(o) {
  if (!o.job) refuse('--job is required');
  if (!STATUSES.includes(o.status)) {
    refuse(`--status must be one of ${STATUSES.join(' | ')} (got ${JSON.stringify(o.status)})`);
  }
  if (o.canary !== undefined && !CANARIES.includes(o.canary)) {
    refuse(`--canary must be ok | missing (got ${JSON.stringify(o.canary)})`);
  }
  if (o.sha !== undefined && !COMMIT_SHA.test(o.sha)) {
    refuse(`--sha must be a 40-character commit sha (got ${JSON.stringify(o.sha)})`);
  }
  if (o.repo !== undefined && (!o.repo.trim() || /\s/.test(o.repo) || o.repo.length > MAX_REPO_LENGTH)) {
    refuse(`--repo must be one repository name, owner/name (got ${JSON.stringify(o.repo)})`);
  }
}

/**
 * The --missed count, checked last: null when it was not given, a refusal when it is not a whole number.
 * @param {Record<string, string>} o
 * @returns {number | null}
 */
function missedCount(o) {
  if (o.missed === undefined) return null;
  if (!WHOLE_NUMBER.test(o.missed)) refuse(`--missed must be a non-negative integer (got ${JSON.stringify(o.missed)})`);
  return Number(o.missed);
}

/**
 * The ten-key row for checked flags, each flag not given written as null.
 * @param {Record<string, string>} o
 * @param {number | null} missed
 * @returns {Row}
 */
function buildRow(o, missed) {
  return {
    at: new Date().toISOString().replace(MILLISECONDS, 'Z'),
    canary: o.canary === undefined ? null : o.canary,
    job: o.job,
    missed,
    model: o.model === undefined ? null : o.model,
    reason: o.reason === undefined ? null : o.reason,
    repo: o.repo === undefined ? null : o.repo,
    session_url: o['session-url'] === undefined ? null : o['session-url'],
    sha: o.sha === undefined ? null : o.sha.toLowerCase(),
    status: o.status
  };
}

/**
 * Settles the one shape args.js cannot parse by hand, ahead of its own parse: node's parseArgs treats ANY
 * dash-led separate-token value as ambiguous for a string option, whatever it actually is, so it cannot
 * tell `--reason "--dry-run was used"` (a real value) from a known flag genuinely missing its value. Walks
 * argv once. A bare word with no flag before it (a stray positional) is warned and dropped, and so is a
 * lone `--`: it is never forwarded as parseArgs's own positional terminator, which would turn every
 * argument after it into an unclaimed positional and let node's own sentence and exit code reach a caller
 * of `append` (the file's own NEVER). A token already in `--flag=value` form whose name is one of
 * KNOWN_FLAGS is taken whole and untouched, consuming nothing else, so a bare word right after it meets
 * the stray-positional rule above instead of being folded into the wrong flag's value. A known flag (one
 * of KNOWN_FLAGS, with no inline value) followed by nothing, or by another of KNOWN_FLAGS, has no value:
 * warned and dropped, its slot left for `buildRow` to write null. A known flag followed by anything else -
 * including a word that merely starts with a dash - takes that word as its value, rewritten `--flag=value`
 * (one token, so parseArgs reads it as a plain string, never ambiguous). An unrecognised flag with no
 * inline value (`--foo`) is left exactly as it arrived, with the bare word right after it if there is one,
 * for args.js's own 'routine' edge to warn and drop together, since args.js's own lenient pass pairs them
 * the same way when the flag itself carries no value. An unrecognised flag that already carries an inline
 * value (`--foo=bar`) is left alone, with nothing paired after it: args.js's lenient pass never absorbs a
 * trailing word into a flag that already has its own value, so pairing one here would only hand it a word
 * it cannot drop, which reaches strict parseArgs as an unclaimed positional and refuses the whole append;
 * the trailing word is warned and dropped on its own turn, by the stray-positional rule above.
 * @param {string[]} argv
 * @returns {string[]}
 */
function preprocessAppendArgs(argv) {
  /** @param {string} line */
  const warn = (line) => console.error(`run-log: WARNING - ${line}`);
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    const eq = a.indexOf('=');
    if (a !== '--' && eq !== -1 && KNOWN_FLAGS.has(a.slice(0, eq))) {
      // already carries its own value inline (--flag=value): take it whole, consume nothing else.
      out.push(a);
      i += 1;
    } else if (a === '--') {
      warn('ignored --: not a flag');
      i += 1;
    } else if (a.startsWith('--') && KNOWN_FLAGS.has(a)) {
      const next = argv[i + 1];
      if (next === undefined || KNOWN_FLAGS.has(next)) {
        warn(`ignored ${a}: no value given${next === undefined ? '' : ` (the next argument, ${next}, is a flag)`}`);
        i += 1;
      } else {
        out.push(`${a}=${next}`);
        i += 2;
      }
    } else if (a.startsWith('--')) {
      // an unrecognised flag: when it carries no inline value, pass it and the bare word right after it
      // (if there is one) through untouched, so args.js's own lenient pass pairs and drops them together.
      // A flag that already carries =value needs no such pairing (see the function's own doc comment), so
      // a trailing word is left for the stray-positional rule below to warn and drop on its own.
      out.push(a);
      i += 1;
      if (eq === -1 && i < argv.length && !argv[i].startsWith('--')) {
        out.push(argv[i]);
        i += 1;
      }
    } else {
      warn(`ignored ${a}: not a flag`);
      i += 1;
    }
  }
  return out;
}

/**
 * `append`: settle the one shape args.js cannot parse by hand (preprocessAppendArgs), parse what remains
 * through args.js's 'routine' edge (only an unrecognised flag can still reach it), check the flags kept,
 * append the row, read the file's last line back, and print the row.
 * @param {string[]} args
 */
function append(args) {
  const { values } = parseCommandLine({
    name: 'run-log',
    edge: 'routine',
    options: APPEND_OPTIONS,
    allowPositionals: false,
    argv: preprocessAppendArgs(args)
  });
  const o = /** @type {Record<string, string>} */ (values);
  refuseBadFlags(o);
  const missed = missedCount(o);
  const line = rowText(buildRow(o, missed));
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, `${line}\n`, 'utf8');
  const tail = fs.readFileSync(FILE, 'utf8').trimEnd().split('\n').pop();
  if (tail !== line) {
    console.error(`run-log: WRITE VERIFY FAILED - the last line of ${FILE_SHOWN} is not the row just appended`);
    process.exit(EXIT_ERROR);
  }
  console.log(`run-log: appended ${line}`);
}

/**
 * `last`: the newest row of one job, or `none`; with no job, the newest row of every job, sorted by job.
 * @param {string[]} args
 */
function last(args) {
  const newest = newestPerJob(readRows());
  if (args.length === 0) {
    for (const job of [...newest.keys()].sort()) console.log(rowText(/** @type {object} */ (newest.get(job))));
    return;
  }
  const row = newest.get(args[0]);
  console.log(row ? rowText(row) : 'none');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'append') append(rest);
  else if (cmd === 'last') last(rest);
  else refuse(USAGE);
} catch (e) {
  console.error(`run-log: ERROR ${/** @type {Error} */ (e).message}`);
  process.exit(EXIT_ERROR);
}
