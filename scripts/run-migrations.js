#!/usr/bin/env node
// @ts-check
// scripts/run-migrations.js - runs each numbered migration once: the one way a change reaches files git cannot.
//
// WHAT. Most of an update arrives by git, but the files that hold who the owner is (soul.md above all) are
// gitignored on purpose, so whoever hosts the repository never sees them, and a change to them has no way in.
// A migration is that way in: a numbered script that runs on this machine after the update has landed. The
// person running this may not read code and may be mid-sentence in real work, so it keeps four rules.
// ONCE: a recorded migration never runs again. NEVER FAILS THE UPDATE: a migration that cannot run is
// reported and the update still succeeds, because the git half already landed. A DECLINE STAYS PENDING: a
// migration that cannot find what it expects changes nothing and is not recorded, so a later run can finish
// it; the one exception is a decline by design where the migration does not apply (002 in a cloud session),
// recorded as not-applicable and silent, because nothing is wrong. PLAIN ENGLISH OUT: no diffs, no traces.
//
// HOW. The command line parses through scripts/lib/args.js on the operator edge: an unknown flag, or a
// known flag given a value it does not take, refuses before anything runs. Reads
// scripts/migrations/NNN-<name>.js in file-name order (the id is the file name without .js) and the
// ledger through scripts/lib/migration-ledger.js, which counts a row as applied by its id whether the row
// is an object or a bare string. Each pending migration's synchronous run({ root, log }) returns
// { status, message }. applied and skipped are recorded at once with the UTC date and their message printed;
// a decline prints its message and the support path for this kind of session: /support-bundle in a cloud
// session (CLAUDE_CODE_REMOTE=true), update-log.txt from the Desktop anywhere else. A migration that throws
// is reported in two lines and the next one still runs. The ledger is written only through
// scripts/lib/json-writer.js (the four-field header and canonical bytes validate-alex V21 enforces). A
// ledger with no header is healed by every run that applies migrations (not --dry-run, not --list), which is
// why /update's commit, made after this runs, never meets V21 holding a legacy ledger.
//
// NEVER. Runs anything against a ledger stamped with a schema it does not know (a newer Kit wrote it): the
// file is left alone and the run still exits 0, because re-running every migration against an unknown
// record is the one outcome worse than running none. Records a decline as applied, or writes the ledger
// except through writeJson. Renames a migration or changes its id: every owner's ledger holds it for ever.
// Kept as pinned, not fixed in passing: a ledger that does not parse reads as empty, so everything runs
// again (R4-5); a row key the standard refuses crashes the run (R4-L9); an async migration is a silent
// decline (R4-L10); a decline with no message ends in a bare colon (R4-L11).
//
// Usage: node scripts/run-migrations.js [--dry-run] [--list]
//          no flag applies what is pending; --dry-run says what would run and changes nothing;
//          --list prints every migration and its state
// Exit: 0 on every handled path, whatever a migration did - 1 a bad command line (an unknown flag, or a
//       known flag given a value it does not take), or an uncaught throw with Node's stack (a ledger row
//       the standard refuses is the one a test pins); both launchers log "needs a person" on any non-zero
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('./lib/json-writer.js');
const { REPO } = require('./lib/repo-root.js');
const { readMigrationLedger, LEDGER_PATH, LEDGER_REL, SCHEMA } = require('./lib/migration-ledger.js');
const { parseCommandLine } = require('./lib/args.js');
const { Refusal } = require('./lib/errors.js');
const MIGRATIONS = path.join(REPO, 'scripts', 'migrations');
const LEDGER = path.join(REPO, LEDGER_REL);
const WRITER = 'scripts/run-migrations.js';
const PURPOSE = 'Which numbered migrations have run on this copy, so that each one runs exactly once.';

/** @type {import('node:util').ParseArgsOptionsConfig} */
const FLAGS = { 'dry-run': { type: 'boolean' }, list: { type: 'boolean' } };

// Immutable history: the id this pattern gives a file is the id every owner's ledger holds.
const MIGRATION_FILE = /^\d{3}-.*\.js$/;

// Migrations that decline by design in a cloud session, where the decline means "not for this kind of
// install" and never "try again". A shipped migration is immutable history and cannot say so itself.
const CLOUD_NOT_APPLICABLE = new Set(['002-install-state-seed']);

const SUPPORT_CLOUD = '  Alex still works. Type /support-bundle and send the page it prints to whoever set this up.';
const SUPPORT_LAPTOP = '  Alex still works. Send update-log.txt from your Desktop to whoever set this up.';

/**
 * @typedef {object} Ledger
 * @property {unknown[]} rows the ledger's own `applied` array, as the file holds it, for a write to
 *   append onto; a row the runner wrote is { id, status, date }, and an older or hand-edited row can be a
 *   bare string
 * @property {Set<string>} done every id the ledger already counts as run, a string row or an object row's
 *   id read the same way
 * @property {string | null} foreign the schema a newer writer stamped, when it is not this runner's
 */

/**
 * @typedef {object} MigrationResult
 * @property {string} [status] applied, skipped or declined; anything else, or nothing, is a decline
 * @property {string} [message] one plain sentence for the owner
 */

/**
 * Read the ledger through the one reader scripts/lib/migration-ledger.js, kept as `rows` for a write to
 * append onto (kept, see NEVER: a file that is missing or does not parse reads as empty).
 * @returns {Ledger}
 */
function readLedger() {
  const { rows, applied, foreign } = readMigrationLedger(REPO);
  return { rows, done: applied, foreign };
}

/**
 * Write the ledger through the JSON standard. Throws on a row key the standard refuses (kept, see NEVER).
 * @param {Ledger} ledger
 */
function writeLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  // contract: read as text by scripts/tests/test-run-migrations-ledger.mjs:170. The ledger's one write is this call, spelled with LEDGER as its first argument.
  // biome-ignore format: the reader matches the call name and its first argument with nothing between them
  writeJson(LEDGER, { applied: ledger.rows }, { purpose: PURPOSE, writer: WRITER, schema: SCHEMA });
}

/**
 * Rewrite an existing ledger through the helper: a no-op when it already conforms (the helper does not
 * write unchanged bytes), and a legacy or damaged-bytes ledger is healed with its rows kept.
 * @param {Ledger} ledger
 */
function healLedger(ledger) {
  if (fs.existsSync(LEDGER)) writeLedger(ledger);
}

/**
 * Add one row and write the ledger at once, so a later migration that fails cannot lose it.
 * @param {Ledger} ledger
 * @param {string} id
 * @param {string} status
 */
function record(ledger, id, status) {
  ledger.rows.push({ id, status, date: new Date().toISOString().slice(0, 10) });
  writeLedger(ledger);
}

/** @param {string} file a migration's file name @returns {string} its id */
function idOf(file) {
  return file.replace(/\.js$/, '');
}

/** @returns {boolean} whether this runs in a cloud session, read at the moment it is asked */
function inCloudSession() {
  return process.env.CLAUDE_CODE_REMOTE === 'true';
}

/**
 * Run one pending migration and record or report its outcome. A throw is reported, never thrown onward,
 * and never recorded.
 * @param {string} file
 * @param {Ledger} ledger
 */
function runMigration(file, ledger) {
  const id = idOf(file);
  /** @type {MigrationResult | undefined} */
  let res;
  try {
    // `mod` by that name: a module with no run() reports "mod.run is not a function" to the owner.
    const mod = require(path.join(MIGRATIONS, file));
    res = mod.run({ root: REPO, log: (/** @type {string} */ m) => console.log(`    ${m}`) });
  } catch (e) {
    console.log('  Could not finish one setup step. Nothing was changed by it.');
    console.log(`  Details for whoever set this up: ${id}: ${/** @type {Error} */ (e).message}`);
    return;
  }

  const status = res?.status || 'declined';
  const message = res?.message || '';

  if (status === 'applied' || status === 'skipped') {
    record(ledger, id, status);
    if (message) console.log(`  ${message}`);
  } else if (status === 'declined' && inCloudSession() && CLOUD_NOT_APPLICABLE.has(id)) {
    record(ledger, id, 'not-applicable');
  } else {
    console.log(`  One setup step was skipped: ${message}`);
    console.log(inCloudSession() ? SUPPORT_CLOUD : SUPPORT_LAPTOP);
  }
}

/**
 * The command line.
 * @param {string[]} args the arguments after the script's path
 * @returns {number} the exit code
 */
function main(args) {
  /** @type {{ 'dry-run'?: boolean | string, list?: boolean | string }} */
  let values;
  try {
    ({ values } = parseCommandLine({ name: 'run-migrations', edge: 'operator', options: FLAGS, argv: args }));
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`run-migrations: ${/** @type {Error} */ (e).message}`);
    return 1;
  }
  const dryRun = Boolean(values['dry-run']);
  const list = Boolean(values.list);

  if (!fs.existsSync(MIGRATIONS)) {
    console.log('No migrations to run.');
    return 0;
  }
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  const ledger = readLedger();
  if (ledger.foreign) {
    console.log('  The record of finished setup steps was written by a newer version of Alex, so none were run.');
    console.log(
      `  Details for whoever set this up: ${LEDGER_PATH} has schema ${ledger.foreign}, this runner reads ${SCHEMA}.`
    );
    return 0;
  }
  const done = ledger.done;

  if (list) {
    if (!files.length) console.log('No migrations exist.');
    for (const f of files) console.log(`  ${done.has(idOf(f)) ? '[done]   ' : '[pending]'} ${idOf(f)}`);
    return 0;
  }

  const pending = files.filter((f) => !done.has(idOf(f)));
  if (!pending.length) {
    if (!dryRun) healLedger(ledger);
    console.log('Nothing new to set up.');
    return 0;
  }
  for (const f of pending) {
    if (dryRun) console.log(`  would run: ${idOf(f)}`);
    else runMigration(f, ledger);
  }
  if (!dryRun) healLedger(ledger);
  return 0;
}

process.exit(main(process.argv.slice(2)));
