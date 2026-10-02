#!/usr/bin/env node
// @ts-check
// scripts/lib/install-state.js - the one reader and writer of system/install-state.json, the version record.
//
// WHAT. Records which template version this copy of Alex carries and when it took it, and turns that record
// into the one line /alex-status and the monthly brief print. The record is machine-local on a laptop
// (gitignored) and committed in the owner's repository online, where the repository is the machine. The two
// Update-Alex launchers and /update stamp it, migration 002 seeds it on an old laptop, kit-doctor reads it,
// and /update and /support-bundle read its template_commit.
//
// HOW. read(root) parses the record and returns its four fields as strings, or null when no object can be
// read. An older Kit wrote camelCase keys (LEGACY below); read() takes each one where the current key is
// absent, so an installed copy never reports itself version-less, and stamp() writes a fresh object, so the
// first update drops them. The current set won because online the repository's HEAD is the owner's own
// commit, never a template version, and because the JSON standard refuses a camelCase key.
// stamp(root, commit, { by, at }) refuses anything but a hex sha, moves the recorded commit to
// previous_template_commit, writes through scripts/lib/json-writer.js and reads the record back before it
// returns it: a version record that did not land is worse than none, because every reader believes it.
// describe(root, today) reads local files only: the build and its date from VERSION, else from the last
// row of system/template-changelog.jsonl, then the record. Its clock is `today`, else ALEX_TODAY, else UTC.
//
// NEVER. Writes a camelCase key, or writes the record except through the JSON helper:
// scripts/tests/test-install-state.mjs fails any other tracked file that writes it or names a legacy key.
// Reaches the network; /update is the only place that compares against the template itself. Throws from
// describe(), or exits non-zero from `line`, which a Routine prints as it prints. Moves stamp's path, name or
// argument shape: both launchers and the previous release's /update text call it by path through node -e.
// Fixes in passing what scripts/tests/test-install-state-contract.mjs pins: an empty record {} reads as a
// record (R4-12), re-stamping the recorded commit erases the real previous one (R4-L4), a 7-character sha is
// accepted (R4-L5), `at` is written unvalidated (R4-L6), a record behind a byte-order mark reads as none
// (R4-L7), and one damaged last changelog row hides the whole build (R4-L8).
//
// Usage: node scripts/lib/install-state.js line [--root <dir>]
//        node -e "require('./scripts/lib/install-state.js').stamp('.', process.argv[1], {by:'<who>'})" <sha>
// Exit: 0 the line is printed, whatever the tree holds - 1 any other command line, with the usage on stderr
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJsonHeaderless, writeJson } = require('./json-writer.js');
const { REPO } = require('./repo-root.js');

const REL = 'system/install-state.json';
const SCHEMA = 'install-state@1';
const WRITER = 'scripts/lib/install-state.js';
const PURPOSE = 'Which template version this copy carries, and when it got there.';
const RECORD_META = { purpose: PURPOSE, writer: WRITER, schema: SCHEMA };

// The key set an older Kit wrote, by the current key each one stands for. Read only: nothing writes these.
const LEGACY = {
  template_commit: 'head',
  previous_template_commit: 'previousHead',
  template_updated_at: 'updatedAt',
  stamped_by: 'seededBy'
};

// A commit sha as stamp() accepts it: hex, any case, 7 to 40 characters.
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;
// The build number and its day in VERSION, as scripts/lib/render-changelog.mjs writes that line.
const VERSION_BUILD = /build (\d+), (\d{4}-\d{2}-\d{2})/;
const STARTS_WITH_DAY = /^\d{4}-\d{2}-\d{2}/;
const MS_PER_DAY = 86400000;
const SHORT_SHA = 7;
const USAGE = 'usage: node scripts/lib/install-state.js line [--root <dir>]';
const EXIT_USAGE = 1;

/**
 * @typedef {object} InstallRecord
 * @property {string | null} template_commit the template version this copy carries
 * @property {string | null} previous_template_commit the one it carried before the last stamp
 * @property {string | null} template_updated_at the day of the last stamp, YYYY-MM-DD as the stamper gave it
 * @property {string | null} stamped_by who wrote the last stamp
 */

/**
 * @typedef {object} StampOptions
 * @property {unknown} [by] who is stamping; written as a string, 'unknown' when absent
 * @property {unknown} [at] the day to record, written unvalidated; today's UTC day when absent
 */

/** @param {string} root */
const file = (root) => path.join(root, REL);

/** Today's day in UTC, YYYY-MM-DD. */
const utcDay = () => new Date().toISOString().slice(0, 10);

/**
 * The record in the current shape, or null when there is none an object can be read from. A legacy file
 * reads exactly like a current one; that is the whole migration.
 * @param {string} root the tree whose record to read
 * @returns {InstallRecord | null}
 */
function read(root) {
  /** @type {unknown} */
  let raw;
  try {
    raw = readJsonHeaderless(file(root));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  /** @param {keyof typeof LEGACY} key */
  const pick = (key) => {
    const value = record[key] !== undefined && record[key] !== null ? record[key] : record[LEGACY[key]];
    return value === undefined || value === null || value === '' ? null : String(value);
  };
  return {
    template_commit: pick('template_commit'),
    previous_template_commit: pick('previous_template_commit'),
    template_updated_at: pick('template_updated_at'),
    stamped_by: pick('stamped_by')
  };
}

/**
 * Records that this copy now carries template version `commit`; the recorded one becomes the previous.
 * @param {string} root the tree whose record to write
 * @param {unknown} commit the template commit, a hex sha
 * @param {StampOptions} [opts]
 * @returns {InstallRecord} the record as read back from the disk
 */
function stamp(root, commit, opts = {}) {
  const sha = String(commit || '').trim();
  if (!COMMIT_SHA.test(sha)) {
    throw new Error(`install-state: "${commit}" is not a commit sha; nothing written`);
  }
  const previous = read(root);
  const data = {
    previous_template_commit: previous?.template_commit || null,
    stamped_by: String(opts.by || 'unknown'),
    template_commit: sha.toLowerCase(),
    template_updated_at: opts.at || utcDay()
  };
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  writeJson(file(root), data, RECORD_META);
  const back = read(root);
  if (!back || back.template_commit !== data.template_commit) {
    throw new Error(
      `install-state: wrote ${data.template_commit} but read back ${back ? back.template_commit : 'nothing'}`
    );
  }
  return back;
}

/**
 * The build this tree carries and the day it was built, from VERSION, else from the changelog's last row.
 * Either value is null when neither file says it.
 * @param {string} root
 * @returns {{ build: number | null, built: string | null }}
 */
function templateBuild(root) {
  try {
    const match = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').match(VERSION_BUILD);
    if (match) return { build: Number(match[1]), built: match[2] };
  } catch {
    // An older tree has no VERSION; its changelog answers below.
  }
  try {
    const changelog = fs.readFileSync(path.join(root, 'system', 'template-changelog.jsonl'), 'utf8');
    const rows = changelog.split('\n').filter((line) => line.trim());
    const last = JSON.parse(rows[rows.length - 1]);
    // A row written before rows carried a number counts by its position.
    const build = Number.isInteger(last.build) ? last.build : rows.length;
    const built = STARTS_WITH_DAY.test(String(last.at || '')) ? String(last.at).slice(0, 10) : null;
    return { build, built };
  } catch {
    // Neither file: the line says so, and never guesses.
    return { build: null, built: null };
  }
}

/**
 * How long ago `built` was on the day `now`: ' (today)', ' (1 day ago)', ' (<n> days ago)', or '' when
 * either day does not parse or the build is from the future.
 * @param {string | null} built
 * @param {string} now
 */
function ageOf(built, now) {
  const days = built ? Math.floor((Date.parse(now) - Date.parse(built)) / MS_PER_DAY) : Number.NaN;
  if (!Number.isFinite(days) || days < 0) return '';
  return days === 0 ? ' (today)' : ` (${days} day${days === 1 ? '' : 's'} ago)`;
}

/**
 * The half of the line the record gives: when this copy took its build, by whom, and at which commit.
 * @param {InstallRecord | null} record
 */
function stampClause(record) {
  if (!record?.template_commit) return '; this copy has not run /update yet';
  const day = record.template_updated_at || 'an unrecorded date';
  const who = record.stamped_by || 'an unrecorded writer';
  const commit = record.template_commit.slice(0, SHORT_SHA);
  return `; this copy was updated to it on ${day} by ${who}, template commit ${commit}`;
}

/**
 * One plain line: which template build this copy carries, how old that build is, and when this copy took
 * it. It stands in for the "template moved" signal a Routine cannot compute, since a Routine cannot read
 * the template: the owner sees the age of their own copy, the part of "has it moved" they can act on.
 * @param {string} root the tree to describe
 * @param {string} [today] the day to measure the age against, YYYY-MM-DD
 * @returns {string}
 */
function describe(root, today) {
  const now = today || process.env.ALEX_TODAY || utcDay();
  const { build, built } = templateBuild(root);
  const head =
    build === null
      ? 'Alex is on template build unknown (this copy holds no VERSION and no changelog)'
      : `Alex is on template build ${build}, built ${built || 'on an unrecorded date'}${ageOf(built, now)}`;
  return `${head}${stampClause(read(root))}. Type /update to see whether a newer build is waiting.`;
}

module.exports = { read, stamp, describe, REL, SCHEMA, LEGACY };

/**
 * The command line: `line` prints describe() for the folder after --root, else for this Kit, and exits 0
 * whatever it finds. Anything else is the usage line. A line this command cannot parse (an unknown flag,
 * a dangling `--root`, a stray word) is a model's typo on a Routine edge, not an operator's: `args.js` is
 * required here, inside main() only, so every other caller of this file (migration 002, kit-doctor, V9, the
 * lane guard) keeps loading it alone, and a failed require degrades the same way a Refusal does, never a
 * crash. An unknown flag is already a warning from args.js itself; a Refusal (a known flag given no value,
 * a bare word on an edge that takes none) is caught here, warned once in this file's own voice, and this
 * Kit is described in place of the folder the broken flag could not name.
 * @param {string[]} argv the arguments after the script's path
 * @returns {number} the exit code
 */
function main(argv) {
  if (argv[0] !== 'line') {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  let dir = REPO;
  try {
    const { parseCommandLine } = require('./args');
    const { values } = parseCommandLine({
      name: 'install-state',
      edge: 'routine',
      options: { root: { type: 'string' } },
      argv: argv.slice(1)
    });
    if (values.root) dir = path.resolve(String(values.root));
  } catch (/** @type {any} */ e) {
    console.error(`install-state: WARNING - ${e?.message || e} - describing this Kit instead`);
  }
  try {
    console.log(describe(dir));
  } catch {
    console.log('Alex is on template build unknown.');
  }
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
