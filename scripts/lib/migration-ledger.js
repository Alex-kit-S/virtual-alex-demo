// @ts-check
// scripts/lib/migration-ledger.js - the runner's reader of system/migrations-applied.json; kit-doctor.js (Kit only) keeps its own on purpose.
//
// WHAT. Which numbered migrations have already run on this copy, read once for scripts/run-migrations.js
// to decide what is still pending. An id counts as applied whichever shape its row takes: an object row
// (the runner's own, `{ id, status, date }`) by its `id` field, or a bare string row, as a hand-edited or
// pre-standard ledger can hold, by the string itself.
//
// HOW. readMigrationLedger(root) reads LEDGER_REL under root through json-writer.js's readJsonHeaderless
// (a byte-order mark forgiven; a missing or unparseable file reads as empty). A ledger stamped with a
// schema this reader does not know is a newer Kit's write: every row is set aside and `foreign` names the
// schema it found, so the caller changes nothing rather than guessing at a shape it has never read.
// Otherwise `applied` is the Set of ids the ledger already counts, and `rows` is its own `applied` array
// exactly as read, untouched, for a caller that writes the ledger back with new rows appended to it.
//
// NEVER. Writes the ledger: scripts/run-migrations.js owns that one write, through
// scripts/lib/json-writer.js. Reads a file other than LEDGER_REL under the root it is given.
//
// Usage: module only - const { readMigrationLedger, LEDGER_REL } = require('./migration-ledger');
'use strict';

const path = require('node:path');
const { readJsonHeaderless } = require('./json-writer.js');

/** The ledger's path from the repository root, forward-slashed: what a message to the owner prints. */
const LEDGER_PATH = 'system/migrations-applied.json';
const LEDGER_REL = path.join(...LEDGER_PATH.split('/'));
const SCHEMA = 'migrations-applied@1';

/**
 * @typedef {object} MigrationLedger
 * @property {Set<string>} applied every id this ledger already counts as run
 * @property {unknown[]} rows the ledger's own `applied` array, exactly as read
 * @property {string | null} foreign the schema a newer writer stamped, when it is not this reader's own
 */

/**
 * @param {unknown} row an `applied` array entry: an object row or a bare string row
 * @returns {string | null} the id it names, or null for a row this reader cannot read an id from
 */
function idOf(row) {
  if (typeof row === 'string') return row;
  if (row && typeof row === 'object' && typeof (/** @type {{ id?: unknown }} */ (row).id) === 'string') {
    return /** @type {{ id: string }} */ (row).id;
  }
  return null;
}

/**
 * Read the migration ledger under `root`. A missing or unparseable file, or one with no `applied` array,
 * reads as empty.
 * @param {string} root
 * @returns {MigrationLedger}
 */
function readMigrationLedger(root) {
  const file = path.join(root, LEDGER_REL);
  const parsed = readJsonHeaderless(file, { bom: true, ifUnreadable: null });
  if (parsed && typeof parsed === 'object' && parsed._schema !== undefined && parsed._schema !== SCHEMA) {
    return { applied: new Set(), rows: [], foreign: String(parsed._schema) };
  }
  /** @type {unknown[]} */
  const rows = Array.isArray(parsed?.applied) ? parsed.applied : [];
  const applied = new Set(rows.map(idOf).filter((/** @type {string | null} */ id) => id !== null));
  return { applied, rows, foreign: null };
}

module.exports = { readMigrationLedger, LEDGER_PATH, LEDGER_REL, SCHEMA };
