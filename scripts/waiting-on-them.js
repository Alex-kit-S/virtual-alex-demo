#!/usr/bin/env node
// @ts-check
// scripts/waiting-on-them.js - the ledger of sent messages still waiting for the other side's reply.
//
// WHAT. The mirror of scripts/human-actions.js: that file tracks what the owner owes, this one what others owe
// the owner. The triage run already reads the owner's sent threads; it feeds them here, and this file decides
// which ones are owed and for how long, so a follow-up is never forgotten and a job application that goes
// quiet is reported without the owner having to notice. The morning brief and /status print its one line; the
// summary command prints its JSON for a person to read, and nothing in the Kit calls it today. No model is
// involved: the decision is arithmetic on dates.
//
// HOW. The store is system/waiting-on-them.jsonl beside this script's repository, append-only. An open row is
// { id, to, subject, sent_date, threshold_days, is_job, created } and a resolved row { id, resolved,
// resolved_date, reason }; reading keeps the latest row per id, and a resolved row removes its id. sweep reads
// a JSON array of threads ({ threadId or id, to, subject, sent_date, has_reply, is_job }) from a file or from
// stdin: a thread with a reply is resolved, a thread past its threshold (3 days for a job, 4 otherwise) is
// opened once, and every job thread newly gone quiet is listed. add opens a thread by hand, resolve closes one
// by id, and list, briefline and summary only read. An age is whole days from midnight of the sent date to
// now. Every append is read back, and the last line must carry the row's id. A line that is not JSON is
// skipped without a word. A flag is read by lookup: the word after the first --name anywhere on the line, and
// --job counts wherever it stands. An unknown flag on this Routine edge warns on stderr and the command
// carries on: warnUnknownFlags calls scripts/lib/args.js per subcommand for that warning only, and discards
// its parsed values and any Refusal it raises for a known flag used oddly, so args.js's own wording and exit
// code never reach a caller of this file.
//
// NEVER. Calls a model, sends a message or reads a mailbox: the threads arrive as data. Creates system/: the
// folder ships with the install, and a first write without it crashes with a raw ENOENT. Prints anything from
// briefline when nothing is owed, because the brief prints that output as it is. Fixes in passing the defect
// scripts/tests/test-waiting-diagnose.mjs pins: add opens a thread on the day it was sent, so briefline counts
// a thread nobody owes yet, and add --threshold skips the already-tracked check and stores placeholders for a
// recipient or subject it was not given (R8-16).
//
// contract: read as text by scripts/tests/test-waiting-diagnose.mjs:982. Every --flag these Usage lines
// and ADD_FLAGS/RESOLVE_FLAGS name must agree; add or drop one in both places together.
// Usage: node scripts/waiting-on-them.js sweep [<threads.json>]     (the JSON array on stdin when no file)
//        node scripts/waiting-on-them.js add --id <thread> --sent <YYYY-MM-DD> [--to <who>] [--subject <text>]
//          [--job] [--threshold <days>]
//        node scripts/waiting-on-them.js resolve <id> [--reason reply|manual]
//        node scripts/waiting-on-them.js list | briefline | summary
// Exit: 0 done - 1 a usage error, input that is not a JSON array, an unknown id, a failed read-back, or a crash
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Computed by hand rather than imported from repo-root.js: test-waiting-diagnose.mjs copies this file
// beside scripts/lib/args.js, errors.js and exit-codes.js only, which would have to add repo-root.js too.
const FILE = path.join(__dirname, '..', 'system', 'waiting-on-them.jsonl');
const DEFAULT_THRESHOLD = 4;
// A job thread is owed sooner: a quiet application is worth a follow-up before other mail is.
const JOB_THRESHOLD = 3;
const DAY_MS = 86400000;
const STDIN = 0;
// How much of a subject each surface keeps: the stored row, the gone-quiet list, the summary's headline.
const SUBJECT_STORED = 80;
const SUBJECT_LISTED = 60;
const SUBJECT_HEADLINE = 50;
// add's and resolve's own flags: the one table each subcommand's warnUnknownFlags call reads below, so a
// flag added to or dropped from one is a change everyone can see in the same place.
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const ADD_FLAGS = {
  id: { type: 'string' },
  sent: { type: 'string' },
  to: { type: 'string' },
  subject: { type: 'string' },
  job: { type: 'boolean' },
  threshold: { type: 'string' }
};
/** @type {Record<string, { type: 'string' | 'boolean' }>} */
const RESOLVE_FLAGS = { reason: { type: 'string' } };

/**
 * @typedef {object} OpenRow
 * @property {string} id the Gmail thread id, stable across a conversation
 * @property {string} to
 * @property {string} subject
 * @property {string} sent_date YYYY-MM-DD
 * @property {number} threshold_days
 * @property {boolean} is_job
 * @property {string} created YYYY-MM-DD
 */

/**
 * @typedef {object} ResolvedRow
 * @property {string | undefined} id undefined only when a bare `resolve` closes a hand row that had no id
 * @property {true} resolved
 * @property {string} resolved_date YYYY-MM-DD
 * @property {string} reason reply or manual, or what --reason said
 */

/**
 * @typedef {object} Thread one sent thread as the triage run describes it
 * @property {string} [threadId]
 * @property {string} [id]
 * @property {string} [to]
 * @property {string} [subject]
 * @property {string} [sent_date]
 * @property {boolean} [has_reply]
 * @property {boolean} [is_job]
 */

const cmd = process.argv[2];
const today = new Date().toISOString().slice(0, 10);

/** Every open thread by id: the latest row of each id, an id whose latest row is resolved left out. */
function load() {
  /** @type {Map<string | undefined, OpenRow>} a row with no id is keyed by undefined */
  const byId = new Map();
  if (!fs.existsSync(FILE)) return byId;
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try {
      row = JSON.parse(t);
    } catch (_) {
      continue;
    }
    if (row.resolved) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return byId;
}

/** The open threads, job threads first, then the oldest sent first. */
function openItems() {
  return [...load().values()].sort(
    (a, b) => (a.is_job === b.is_job ? 0 : a.is_job ? -1 : 1) || a.sent_date.localeCompare(b.sent_date)
  );
}

/**
 * Whole days from midnight of `date` to now.
 * @param {string} date YYYY-MM-DD
 */
function ageDays(date) {
  return Math.floor((Date.now() - new Date(`${date}T00:00:00`).getTime()) / DAY_MS);
}

/**
 * The first open thread with the greatest age.
 * @param {OpenRow[]} items at least one
 */
function oldestItem(items) {
  return items.reduce((a, b) => (ageDays(a.sent_date) >= ageDays(b.sent_date) ? a : b));
}

/**
 * Append one row and read the last line back: it must parse and carry this row's id; a torn one crashes (kept).
 * @param {OpenRow | ResolvedRow} obj
 */
function append(obj) {
  fs.appendFileSync(FILE, `${JSON.stringify(obj)}\n`, 'utf8');
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.id !== obj.id) {
    console.error('waiting-on-them: append verify FAILED');
    process.exit(1);
  }
}

/**
 * The word after the first --`name` anywhere on the command line.
 * @param {string} name
 * @returns {string | undefined}
 */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/**
 * Print one WARNING line on stderr for every flag this subcommand does not know, and carry on (EDGE-WARN): a
 * Routine edge never refuses one. Every known flag keeps arg()'s own reading above; args.js's parsed values
 * and any Refusal it raises for a known flag used oddly are both discarded, never args.js's own wording or
 * exit code.
 * @param {Record<string, { type: 'string' | 'boolean' }>} options this subcommand's known flags
 * @param {boolean} allowPositionals whether this subcommand takes a bare word of its own
 */
function warnUnknownFlags(options, allowPositionals) {
  const { parseCommandLine } = require('./lib/args');
  const { Refusal } = require('./lib/errors');
  try {
    parseCommandLine({ name: 'waiting-on-them', edge: 'routine', options, allowPositionals });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
  }
}

/**
 * Open a thread under its type's threshold, unless its id is already open.
 * @param {{ id: string, to?: string, subject?: string, sent_date: string, is_job: boolean }} thread
 * @returns {boolean} true when a row was written
 */
function upsertOpen({ id, to, subject, sent_date, is_job }) {
  const threshold = is_job ? JOB_THRESHOLD : DEFAULT_THRESHOLD;
  const existing = load().get(id);
  if (existing) return false;
  append({
    id,
    to: to || 'unknown',
    subject: (subject || '').slice(0, SUBJECT_STORED),
    sent_date,
    threshold_days: threshold,
    is_job: !!is_job,
    created: today
  });
  return true;
}

/**
 * Close an open thread.
 * @param {string | undefined} id undefined for a bare `resolve`
 * @param {string | undefined} reason
 * @returns {boolean} false when no open thread has that id
 */
function resolveId(id, reason) {
  if (!load().has(id)) return false;
  append({ id, resolved: true, resolved_date: today, reason: reason || 'manual' });
  return true;
}

/** `sweep`: resolve every thread with a reply, open every one past its threshold, list the quiet job threads. */
function sweep() {
  warnUnknownFlags({}, true);
  const src = process.argv[3];
  let raw = '';
  try {
    raw = src ? fs.readFileSync(src, 'utf8') : fs.readFileSync(STDIN, 'utf8');
  } catch (_) {
    console.error('sweep: need a JSON file arg or piped JSON on stdin');
    process.exit(1);
  }
  /** @type {Thread[]} */
  let threads;
  try {
    threads = JSON.parse(raw);
  } catch (_) {
    console.error('sweep: input is not valid JSON');
    process.exit(1);
  }
  if (!Array.isArray(threads)) {
    console.error('sweep: expected a JSON array of thread descriptors');
    process.exit(1);
  }
  let opened = 0;
  let resolved = 0;
  const silenceCandidates = [];
  for (const th of threads) {
    const id = th.threadId || th.id;
    if (!id || !th.sent_date) continue;
    const isJob = !!th.is_job;
    const threshold = isJob ? JOB_THRESHOLD : DEFAULT_THRESHOLD;
    if (th.has_reply) {
      if (resolveId(id, 'reply')) resolved++;
      continue;
    }
    if (ageDays(th.sent_date) >= threshold) {
      const isNew = upsertOpen({ id, to: th.to, subject: th.subject, sent_date: th.sent_date, is_job: isJob });
      if (isNew) {
        opened++;
        // The line is the whole signal: the triage run reports each one, and nothing further runs.
        if (isJob) {
          silenceCandidates.push({
            threadId: id,
            subject: (th.subject || '').slice(0, SUBJECT_LISTED),
            sent_date: th.sent_date
          });
        }
      }
    }
  }
  console.log(`waiting-on-them sweep: ${opened} newly owed, ${resolved} resolved, ${openItems().length} open total`);
  if (silenceCandidates.length) {
    console.log('JOB THREADS GONE QUIET (report each one; there is nothing further to run):');
    for (const c of silenceCandidates) {
      console.log(`  - thread ${c.threadId} (${c.sent_date}): ${c.subject}`);
    }
  }
}

/** `add`: open a thread by hand; --threshold writes its own row whether or not the id is open. */
function add() {
  warnUnknownFlags(ADD_FLAGS, false);
  const id = arg('id');
  const sent = arg('sent');
  if (!id || !sent) {
    console.error('add needs --id and --sent YYYY-MM-DD');
    process.exit(1);
  }
  const isJob = process.argv.includes('--job');
  const t = arg('threshold');
  if (t) {
    append({
      id,
      to: arg('to') || 'unknown',
      subject: (arg('subject') || '').slice(0, SUBJECT_STORED),
      sent_date: sent,
      threshold_days: parseInt(t, 10),
      is_job: isJob,
      created: today
    });
  } else {
    upsertOpen({ id, to: arg('to'), subject: arg('subject'), sent_date: sent, is_job: isJob });
  }
  console.log(`tracked: ${id}`);
}

/** `resolve <id>`: close an open thread, the reason manual unless --reason says otherwise. */
function resolve() {
  warnUnknownFlags(RESOLVE_FLAGS, true);
  const id = process.argv[3];
  if (!resolveId(id, arg('reason'))) {
    console.error(`no open thread '${id}'`);
    process.exit(1);
  }
  console.log(`resolved: ${id}`);
}

/** `list`: every open thread with its age, or the one line saying nobody owes a reply. */
function list() {
  warnUnknownFlags({}, false);
  const items = openItems();
  if (!items.length) {
    console.log('Waiting on them: nothing. Nobody owes you a reply.');
    process.exit(0);
  }
  console.log(`Waiting on them (${items.length}):`);
  for (const r of items) {
    const tag = r.is_job ? ' [JOB]' : '';
    console.log(`- ${r.to}${tag} (${ageDays(r.sent_date)}d, owed past ${r.threshold_days}d): ${r.subject}`);
  }
}

/** `briefline`: one line for the brief when anything is owed, and nothing at all otherwise. */
function briefline() {
  warnUnknownFlags({}, false);
  const items = openItems();
  if (!items.length) process.exit(0);
  // Both branches are the greatest age; they differ only when every sent date is in the future, where the
  // job branch stops at 0.
  const oldest = items[0].is_job
    ? items.reduce((m, r) => Math.max(m, ageDays(r.sent_date)), 0)
    : Math.max(...items.map((r) => ageDays(r.sent_date)));
  const top = oldestItem(items);
  console.log(`${items.length} owe you replies, oldest ${oldest}d: ${top.to} re: ${top.subject}`);
}

/** `summary`: prints one JSON line for a person to read, with its keys in this order. */
function summary() {
  warnUnknownFlags({}, false);
  const items = openItems();
  const oldest = items.length ? Math.max(...items.map((r) => ageDays(r.sent_date))) : 0;
  const jobs = items.filter((r) => r.is_job).length;
  const top = items.length ? oldestItem(items) : null;
  console.log(
    JSON.stringify({
      open_count: items.length,
      oldest_days: oldest,
      jobs_owed: jobs,
      headline: top
        ? `${top.to} re: ${top.subject.slice(0, SUBJECT_HEADLINE)} (${ageDays(top.sent_date)}d)`
        : 'nobody owes you'
    })
  );
}

if (cmd === 'sweep') sweep();
else if (cmd === 'add') add();
else if (cmd === 'resolve') resolve();
else if (cmd === 'list') list();
else if (cmd === 'briefline') briefline();
else if (cmd === 'summary') summary();
else {
  console.error('usage: waiting-on-them.js sweep|add|resolve|list|briefline|summary');
  process.exit(1);
}
