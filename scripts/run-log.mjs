#!/usr/bin/env node
// scripts/run-log.mjs - the append-only run log, system/run-status.json's successor online.
//
// WHY. system/run-status.json is one JSON document that every job rewrites. Online, a session and a
// Routine can both finish in the same minute on two different VMs, and two writers rewriting one
// document is a merge conflict by construction. One row per run, appended, union-merged
// (.gitattributes), is not. /status reads the newest row per job from this file when it exists;
// on a laptop install the file never exists and /status keeps reading run-status.json.
//
// Usage:
//   node scripts/run-log.mjs append --job <name> --status <COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED>
//                              [--reason <text>] [--canary ok|missing] [--model <id>]
//                              [--missed <n>] [--session-url <url>] [--repo <owner/name>] [--sha <commit>]
//   node scripts/run-log.mjs last <job>      the newest row for that job, one JSON line, or `none`
//   node scripts/run-log.mjs last            the newest row per job, one line each, sorted by job
//
// The row: {at, canary, job, missed, model, reason, repo, session_url, sha, status}. Every row carries
// all ten keys; an option that was not given is null, so "not given" has one spelling. `at` is UTC.
// repo and sha are the snapshot Routine's: the repository the copy landed on and the sha it read back,
// which the weekly sweep compares with backup_repo (fleet Fix C, review finding F27).
// Rows go through the JSON writer's canonical text (key order, naming) collapsed to one line,
// the same way the template changelog is written.
//
// Exit 0 ok · 2 refused (a bad argument; nothing is written) · 1 script error.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canonicalText } = require('./lib/json-writer.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const FILE = path.join(REPO, 'system', 'run-log.jsonl');

const STATUSES = ['COMPLETE', 'PARTIAL', 'BLOCKED', 'SKIPPED', 'RED'];
const CANARIES = ['ok', 'missing'];

const refuse = (msg) => {
  console.error(`run-log: REFUSED - ${msg}`);
  process.exit(2);
};
const rowText = (row) => JSON.stringify(JSON.parse(canonicalText(row)));

function parseOptions(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) refuse(`unexpected argument "${a}"`);
    const key = a.slice(2);
    const val = args[i + 1];
    if (val === undefined || val.startsWith('--')) refuse(`--${key} needs a value`);
    opts[key] = val;
    i++;
  }
  return opts;
}

function readRows() {
  if (!fs.existsSync(FILE)) return [];
  const rows = [];
  const lines = fs.readFileSync(FILE, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      console.error(`run-log: WARN ${path.relative(REPO, FILE)}:${i + 1} is not JSON, skipped`);
    }
  }
  return rows;
}

function newestPerJob(rows) {
  // newest by `at`; on a tie the later line wins (append order)
  const best = new Map();
  for (const r of rows) {
    if (!r || typeof r.job !== 'string') continue;
    const cur = best.get(r.job);
    if (!cur || String(r.at || '') >= String(cur.at || '')) best.set(r.job, r);
  }
  return best;
}

function append(args) {
  const o = parseOptions(args);
  const known = new Set(['job', 'status', 'reason', 'canary', 'model', 'missed', 'session-url', 'repo', 'sha']);
  for (const k of Object.keys(o)) if (!known.has(k)) refuse(`unknown option --${k}`);
  if (!o.job) refuse('--job is required');
  if (!STATUSES.includes(o.status)) refuse(`--status must be one of ${STATUSES.join(' | ')} (got ${JSON.stringify(o.status)})`);
  if (o.canary !== undefined && !CANARIES.includes(o.canary)) refuse(`--canary must be ok | missing (got ${JSON.stringify(o.canary)})`);
  if (o.sha !== undefined && !/^[0-9a-f]{40}$/i.test(o.sha)) refuse(`--sha must be a 40-character commit sha (got ${JSON.stringify(o.sha)})`);
  if (o.repo !== undefined && (!o.repo.trim() || /\s/.test(o.repo) || o.repo.length > 200)) refuse(`--repo must be one repository name, owner/name (got ${JSON.stringify(o.repo)})`);
  let missed = null;
  if (o.missed !== undefined) {
    if (!/^\d+$/.test(o.missed)) refuse(`--missed must be a non-negative integer (got ${JSON.stringify(o.missed)})`);
    missed = Number(o.missed);
  }
  const row = {
    at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    canary: o.canary === undefined ? null : o.canary,
    job: o.job,
    missed,
    model: o.model === undefined ? null : o.model,
    reason: o.reason === undefined ? null : o.reason,
    repo: o.repo === undefined ? null : o.repo,
    session_url: o['session-url'] === undefined ? null : o['session-url'],
    sha: o.sha === undefined ? null : o.sha.toLowerCase(),
    status: o.status,
  };
  const line = rowText(row);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, line + '\n', 'utf8');
  // verify-after-write: the last line of the file is the row just written
  const tail = fs.readFileSync(FILE, 'utf8').trimEnd().split('\n').pop();
  if (tail !== line) {
    console.error(`run-log: WRITE VERIFY FAILED - the last line of ${path.relative(REPO, FILE)} is not the row just appended`);
    process.exit(1);
  }
  console.log(`run-log: appended ${line}`);
}

function last(args) {
  const rows = readRows();
  const newest = newestPerJob(rows);
  if (args.length === 0) {
    for (const job of [...newest.keys()].sort()) console.log(rowText(newest.get(job)));
    return;
  }
  const row = newest.get(args[0]);
  console.log(row ? rowText(row) : 'none');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'append') append(rest);
  else if (cmd === 'last') last(rest);
  else refuse('usage: run-log.mjs append --job <name> --status <COMPLETE|PARTIAL|BLOCKED|SKIPPED|RED> [--reason ..] [--canary ok|missing] [--model ..] [--missed <n>] [--session-url ..] [--repo ..] [--sha ..] | last [<job>]');
} catch (e) {
  console.error(`run-log: ERROR ${e.message}`);
  process.exit(1);
}
