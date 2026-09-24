'use strict';
/*
 * scripts/lib/install-state.js - THE one reader and writer of system/install-state.json.
 * (2026-09-23, Virtual Alex fleet seat 1, open-list item "install-state two writers".)
 *
 * WHAT. The only code that reads or writes system/install-state.json. The file holds one fact:
 * which version of the template this copy carries, and when it got there. It is machine-local on a
 * laptop (gitignored) and committed in an owner's repo online, where the repo IS the machine.
 *
 * HOW. read(root) returns the record, accepting the legacy key names so an old install still
 * reports its version. stamp(root, commit, { by }) writes a fresh record through
 * scripts/lib/json-writer.js, which is what drops the legacy keys on the first update.
 *
 * NEVER. Never writes a legacy camelCase key, and never writes the file except through the JSON
 * helper. Every other script that needs the record calls this module.
 *
 * WHY THIS FILE EXISTS. Until now four places wrote it and they did not agree on the key names.
 * Update-Alex.cmd, Update-Alex.command, kit-doctor --repair and migration 002 all wrote
 * `head` / `previousHead` / `updatedAt`; the online /update command wrote `template_commit`.
 * On 2026-09-23 a real online install ran both in one session and ended with a file holding both
 * key sets, half of it describing the owner's own autosave commit as if it were a version.
 *
 * WHICH KEY SET SURVIVED, AND WHY.
 *   1. `head` is a LIE online. Online the repository is the owner's, and its git HEAD is their own
 *      autosave, not a template version at all. `template_commit` is true in both lanes: on a
 *      laptop the Kit checkout IS the template clone, so the commit it is on IS the version it
 *      carries. A field whose name is false in one lane gets read wrong there sooner or later.
 *   2. The legacy names are camelCase, and this Kit's own JSON standard requires snake_case keys.
 *      They cannot be written through scripts/lib/json-writer.js at all: writeJson throws on
 *      `previousHead`. A key set the house rules refuse to write is not a candidate.
 *   3. Online is where the file is load-bearing: /update and /support-bundle read `template_commit`,
 *      and describe() below turns the record into the line /alex-status and the brief print. On a
 *      laptop the readers are one kit-doctor line and V9's install-age fallback, which reads only
 *      the date.
 *
 * WHAT HAPPENED TO THE LOSER. The legacy keys are READ ONLY from here on: read() below accepts
 * them so an already-installed copy keeps its record and never reports itself version-less, and
 * stamp() writes a fresh object, so the first update after this change drops them for good. No
 * numbered migration is needed and none can half-apply.
 *
 * Test: node scripts/tests/test-install-state.mjs (the legacy set shown being REFUSED by the JSON
 * standard first, then the read normalisation, the stamp, and the drift guard that fails if any
 * other file writes this record or names a legacy key).
 */

const fs = require('fs');
const path = require('path');
const { writeJson } = require('./json-writer.js');

const REL = 'system/install-state.json';
const SCHEMA = 'install-state@1';
const WRITER = 'scripts/lib/install-state.js';
const PURPOSE = 'Which template version this copy carries, and when it got there.';

// The pre-2026-09-23 key set. READ ONLY: nothing writes these again, and
// scripts/tests/test-install-state.mjs fails if any file outside this one names them.
const LEGACY = {
  template_commit: 'head',
  previous_template_commit: 'previousHead',
  template_updated_at: 'updatedAt',
  stamped_by: 'seededBy',
};

const file = (root) => path.join(root, 'system', 'install-state.json');

// Returns the record in the surviving shape, or null when there is no readable record. A legacy
// file reads exactly like a current one; that is the whole migration.
function read(root) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file(root), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const pick = (key) => {
    const v = raw[key] !== undefined && raw[key] !== null ? raw[key] : raw[LEGACY[key]];
    return v === undefined || v === null || v === '' ? null : String(v);
  };
  return {
    template_commit: pick('template_commit'),
    previous_template_commit: pick('previous_template_commit'),
    template_updated_at: pick('template_updated_at'),
    stamped_by: pick('stamped_by'),
  };
}

// Records that this copy now carries template version `commit`. The current commit becomes the
// previous one. Read back before returning: a version record that did not land is worse than none,
// because every reader downstream believes it.
function stamp(root, commit, opts = {}) {
  const c = String(commit || '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(c)) {
    throw new Error(`install-state: "${commit}" is not a commit sha; nothing written`);
  }
  const prev = read(root);
  const data = {
    previous_template_commit: (prev && prev.template_commit) || null,
    stamped_by: String(opts.by || 'unknown'),
    template_commit: c.toLowerCase(),
    template_updated_at: opts.at || new Date().toISOString().slice(0, 10),
  };
  fs.mkdirSync(path.dirname(file(root)), { recursive: true });
  writeJson(file(root), data, { purpose: PURPOSE, writer: WRITER, schema: SCHEMA });
  const back = read(root);
  if (!back || back.template_commit !== data.template_commit) {
    throw new Error(`install-state: wrote ${data.template_commit} but read back ${back ? back.template_commit : 'nothing'}`);
  }
  return back;
}

// One plain line: which template build this copy carries, how old that build is, and when this copy
// took it. LOCAL FILES ONLY: the tree's VERSION (written by the template build), else its changelog,
// plus the stamp above. It replaces the "template moved" signal the housekeeping Routine lost
// (fleet Fix C, review finding F08): a Routine cannot read the template, so the owner is shown the
// age of their own copy instead, which is the part of "has it moved" they can act on. /update is
// still the only place that compares against the template itself. Never throws.
function describe(root, today) {
  const now = today || process.env.ALEX_TODAY || new Date().toISOString().slice(0, 10);
  let build = null;
  let built = null;
  try {
    const m = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').match(/build (\d+), (\d{4}-\d{2}-\d{2})/);
    if (m) { build = Number(m[1]); built = m[2]; }
  } catch { /* an older tree has no VERSION; the changelog below answers */ }
  if (build === null) {
    try {
      const rows = fs.readFileSync(path.join(root, 'system', 'template-changelog.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
      const last = JSON.parse(rows[rows.length - 1]);
      build = Number.isInteger(last.build) ? last.build : rows.length;
      built = /^\d{4}-\d{2}-\d{2}/.test(String(last.at || '')) ? String(last.at).slice(0, 10) : null;
    } catch { /* neither file: said below, never guessed */ }
  }
  let age = '';
  const days = built ? Math.floor((Date.parse(now) - Date.parse(built)) / 86400000) : NaN;
  if (Number.isFinite(days) && days >= 0) age = days === 0 ? ' (today)' : ` (${days} day${days === 1 ? '' : 's'} ago)`;
  const head = build === null
    ? 'Alex is on template build unknown (this copy holds no VERSION and no changelog)'
    : `Alex is on template build ${build}, built ${built || 'on an unrecorded date'}${age}`;
  const rec = read(root);
  const took = rec && rec.template_commit
    ? `; this copy was updated to it on ${rec.template_updated_at || 'an unrecorded date'} by ${rec.stamped_by || 'an unrecorded writer'}, template commit ${rec.template_commit.slice(0, 7)}`
    : '; this copy has not run /update yet';
  return `${head}${took}. Type /update to see whether a newer build is waiting.`;
}

module.exports = { read, stamp, describe, REL, SCHEMA, LEGACY };

// node scripts/lib/install-state.js line [--root <dir>]   prints describe(); always exit 0.
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === 'line') {
    const at = argv.indexOf('--root');
    const dir = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : path.join(__dirname, '..', '..');
    try { console.log(describe(dir)); } catch { console.log('Alex is on template build unknown.'); }
    process.exit(0);
  }
  console.error('usage: node scripts/lib/install-state.js line [--root <dir>]');
  process.exit(1);
}
