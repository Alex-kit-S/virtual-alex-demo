#!/usr/bin/env node
// @ts-check
// scripts/human-actions.js - the "Waiting on you" queue: what only the owner can do, kept until it is done.
//
// WHAT. What only the owner can do (sign, pay, call, decide) waits here with why it is theirs and how urgent, ageing
// in the brief, /status and the SessionStart line until a "done: <id>", or the drill that proves it, closes it.
//
// HOW. system/human-actions.jsonl is append-only, one JSON row per line: an open row {id, what, why_only_you,
// severity, created, due?} or a close {id, done: true, done_date}; the latest row per id wins. It is gitignored, as
// a row may carry personal context; the encrypted vault backup carries it. add queues an item that is not open; done
// closes an open one, and an ATTEST_GATED escrow item only once ATTEST_FILE opens on a yyyy-MM-dd date; list prints
// open items by severity, then date; sessionline prints one line once an item is 7 days old; summary prints one JSON
// line. Every append is read back. As a SessionStart hook and a Close-Out and Routine step an unknown flag
// warns on stderr instead of refusing, and the run carries on (see warnUnknownFlags below for how).
//
// NEVER. Rewrites a row, or names a person in one: a row points at a vault page. Closes an escrow item through done
// on an unproven attestation (no file, or one it cannot read); a close row appended by hand bypasses the gate, by
// design. Changes what a crash prints or its exit code: test-human-actions.mjs pins its frames, re-pinned when
// lines move. Fixes in passing a defect test-human-actions.mjs pins: HA-D2, HA-D3, HA-D4, HA-D5, HA-T1 or HA-N1.
//
// contract: read as text by scripts/tests/test-human-actions.mjs:440. Every --flag this Usage line and
// ADD_FLAGS/DONE_FLAGS name must agree; add or drop one in both places together.
// Usage: node scripts/human-actions.js add --id <id> --what <text> [--why <text>] [--severity <level>]
//          [--created YYYY-MM-DD] [--due YYYY-MM-DD] | done <id> | done --id <id> | list | sessionline | summary
// Exit: 0 done, or nothing to report - 1 refused (usage, a missing, duplicate or unknown id, the gate) or failed
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'system', 'human-actions.jsonl');
/** The order list and summary sort by; a severity not listed sorts last. @type {Record<string, number>} */
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
/** The escrow items: escrow-test.ps1 writes ATTEST_FILE and closes them itself when its drill passes. */
const ATTEST_GATED = new Set(['passphrase-attestation', 'passphrase-escrow-retest', 'passphrase-safeplace-fix']);
const ATTEST_FILE = path.join(__dirname, '..', 'work', '18-recovery-layer', 'state', 'passphrase-attested.txt');

/** True when ATTEST_FILE's first line opens with a date; PENDING, anything else or no file is false. */
function attestationIsProven() {
  try {
    const first = (fs.readFileSync(ATTEST_FILE, 'utf8').split('\n')[0] || '').trim();
    return /^\d{4}-\d{2}-\d{2}\b/.test(first);
  } catch {
    return false;
  }
}

/** @returns {Array<Record<string, any>>} the latest row for every id in the ledger, open and closed alike */
function load() {
  if (!fs.existsSync(FILE)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try {
      row = JSON.parse(t);
    } catch (_) {
      continue;
    }
    if (row.done) {
      const prev = byId.get(row.id);
      if (prev) prev.done = row.done_date || true;
    } else byId.set(row.id, { ...row });
  }
  return [...byId.values()];
}

/** @returns {Array<Record<string, any>>} every open (not yet done) row, sorted by severity then by created date */
function openItems() {
  return load()
    .filter((r) => !r.done)
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9) || a.created.localeCompare(b.created));
}
/** @param {string} created a row's YYYY-MM-DD @returns {number} whole days since that date's local midnight */
function ageDays(created) {
  return Math.floor((Date.now() - new Date(`${created}T00:00:00`).getTime()) / 86400000);
}
/** @param {Record<string, unknown>} obj one row, appended then read back as the file's last line */
function append(obj) {
  fs.appendFileSync(FILE, `${JSON.stringify(obj)}\n`, 'utf8');
  // verify-after-write: the last line must parse and carry this id; a torn last line crashes (kept)
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.id !== obj.id) {
    console.error('human-actions: append verify FAILED');
    process.exit(1);
  }
}
/** @param {string} name a flag's name without its dashes @returns {string | undefined} the word after --name */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
/**
 * Print one WARNING line on stderr for every flag this subcommand does not know, and carry on: a
 * hook or Routine edge never refuses one. Every known flag keeps arg()'s own reading above, done's own
 * positional-vs---id precedence included; args.js's parsed values and any Refusal it raises for a known flag
 * used oddly are both discarded. args.js and errors.js are required inside this try, not at module top level,
 * because sessionline runs as a SessionStart hook entry (standard 3.6): a load failure here just means no
 * warning prints, never a crash of the hook.
 * @param {Record<string, { type: 'string' | 'boolean' }>} options this subcommand's known flags
 * @param {boolean} allowPositionals whether this subcommand takes a bare word of its own
 */
function warnUnknownFlags(options, allowPositionals) {
  try {
    const { parseCommandLine } = require('./lib/args');
    parseCommandLine({ name: 'human-actions', edge: 'hook', options, allowPositionals });
  } catch {
    // A Refusal for a known flag used oddly is not this program's to surface (see the header HOW paragraph),
    // and a failed require of args.js or errors.js degrades to no warning printing at all, never a crash.
  }
}
/** @typedef {{ severity: string, created: string } & Record<string, string | undefined>} Row an open row */
// add's and done's own flags: the one table each subcommand's warnUnknownFlags call reads below, so a flag
// added to or dropped from one is a change to the other by construction, never a hand-copy left behind.
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const ADD_FLAGS = {
  id: { type: 'string' },
  what: { type: 'string' },
  why: { type: 'string' },
  severity: { type: 'string' },
  created: { type: 'string' },
  due: { type: 'string' }
};
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const DONE_FLAGS = { id: { type: 'string' } };
const cmd = process.argv[2];
const today = new Date().toISOString().slice(0, 10);

if (cmd === 'add') {
  warnUnknownFlags(ADD_FLAGS, false);
  const row = /** @type {Row} */ ({
    id: arg('id'),
    what: arg('what'),
    why_only_you: arg('why'),
    severity: arg('severity') || 'medium',
    created: arg('created') || today
  });
  if (arg('due')) row.due = arg('due');
  if (!row.id || !row.what) {
    console.error('add needs --id and --what');
    process.exit(1);
  }
  if (openItems().some((r) => r.id === row.id)) {
    console.error(`open item '${row.id}' already exists`);
    process.exit(1);
  }
  append(row);
  console.log(`queued: ${row.id} (${row.severity})`);
} else if (cmd === 'done') {
  warnUnknownFlags(DONE_FLAGS, true);
  const id = process.argv[3] === '--id' && process.argv.length > 4 ? process.argv[4] : process.argv[3];
  if (!openItems().some((r) => r.id === id)) {
    console.error(`no open item '${id}'`);
    process.exit(1);
  }
  // The attestation gate: an escrow item stays open until the drill has written a dated attestation.
  if (ATTEST_GATED.has(id) && !attestationIsProven()) {
    console.error(
      `refusing to close '${id}': ${ATTEST_FILE} is not a fresh dated attestation (first line must be yyyy-MM-dd, not PENDING).`
    );
    console.error(
      `Run the escrow drill: powershell -File work/18-recovery-layer/escrow-test.ps1 - it stamps the attestation and closes this item on PASS.`
    );
    process.exit(1);
  }
  append({ id, done: true, done_date: today });
  console.log(`closed: ${id}`);
} else if (cmd === 'list') {
  warnUnknownFlags({}, false);
  const items = openItems();
  if (!items.length) {
    console.log('Waiting on you: nothing. Queue is empty.');
    process.exit(0);
  }
  console.log(`Waiting on you (${items.length}):`);
  for (const r of items) {
    const due = r.due ? ` | due ${r.due}` : '';
    console.log(`- [${r.severity.toUpperCase()}] ${r.id} (${ageDays(r.created)}d): ${r.what}${due}`);
  }
  console.log(`Close one with: node scripts/human-actions.js done <id>  (or tell Alex "done: <id>")`);
} else if (cmd === 'sessionline') {
  warnUnknownFlags({}, false);
  const aged = openItems().filter((r) => ageDays(r.created) >= 7);
  if (aged.length) {
    const oldest = Math.max(...aged.map((r) => ageDays(r.created)));
    console.log(
      `WAITING ON YOU: ${aged.length} item(s) only you can do, oldest ${oldest}d (say "waiting list" for the queue).`
    );
  } // else: silent by design
} else if (cmd === 'summary') {
  warnUnknownFlags({}, false);
  const items = openItems();
  const oldest = items.length ? Math.max(...items.map((r) => ageDays(r.created))) : 0;
  const worst = items.length ? items[0].severity : 'none';
  const top = items[0];
  console.log(
    JSON.stringify({
      open_count: items.length,
      oldest_days: oldest,
      worst_severity: worst,
      headline: top ? `${top.what.slice(0, 80)} (${ageDays(top.created)}d)` : 'queue empty'
    })
  );
} else {
  console.error('usage: human-actions.js add|done|list|sessionline|summary');
  process.exit(1);
}
