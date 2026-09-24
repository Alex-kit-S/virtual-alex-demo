#!/usr/bin/env node
/*
 * waiting-on-them.js - the "Reply Zero" ledger (#07 email-triage Phase 1, upgrade 2026-07-25).
 * The mirror twin of human-actions.js: human-actions tracks what YOU owe; this tracks what THEY owe you.
 *
 * The gap it closes (Inbox Zero's sharpest idea): Alex triages INBOUND well but nothing tracks which
 * of the owner's SENT messages are still awaiting the other side's reply. Follow-ups leak. And the
 * outcome loop's most error-prone human step - marking a job application "silence" - becomes automatic.
 *
 * DETERMINISTIC, ZERO Claude calls. The email-triage run already pulls the Sent folder for its
 * sent-vs-draft learning loop; it feeds that same thread data here as JSON and this code decides,
 * by pure arithmetic on dates, which threads are owed and for how long. No model in the loop.
 *
 * Store: system/waiting-on-them.jsonl - append-only JSONL, GITIGNORED (carries recipient labels +
 * subject snippets; local-only, encrypted-backup-covered like human-actions.jsonl). Latest-per-id wins.
 *
 * Row shapes (id = the Gmail threadId, stable across a conversation):
 *   open:     {id, to, subject, sent_date, threshold_days, is_job, created}
 *   resolved: {id, resolved:true, resolved_date, reason:"reply"|"manual"}
 *
 * THRESHOLDS: default 4 days; job-application threads 3 days (they feed the outcome loop faster).
 *
 * Commands:
 *   sweep [file.json]     read [{threadId,to,subject,sent_date,has_reply,is_job}] from a file or stdin;
 *                         resolve any thread that now has a reply, (re)open any past its threshold.
 *                         Prints the job threads newly gone quiet (past the 3-day job threshold) so
 *                         the triage run can report them. Deterministic; nothing further to run.
 *   add --id X --to "..." --subject "..." --sent YYYY-MM-DD [--job] [--threshold N]
 *   resolve <id> [--reason reply|manual]
 *   list                  open items with ages (status/self-review surface)
 *   briefline             ONE morning-brief line if anything is owed, else SILENT
 *   summary               {open_count, oldest_days, jobs_owed, headline} JSON for the HQ push
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'system', 'waiting-on-them.jsonl');
const DEFAULT_THRESHOLD = 4;
const JOB_THRESHOLD = 3;

function load() {
  if (!fs.existsSync(FILE)) return new Map();
  const byId = new Map();
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row; try { row = JSON.parse(t); } catch (_) { continue; }
    if (row.resolved) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return byId;
}

function openItems() {
  return [...load().values()].sort((a, b) =>
    (a.is_job === b.is_job ? 0 : a.is_job ? -1 : 1) || a.sent_date.localeCompare(b.sent_date));
}

function ageDays(date) {
  return Math.floor((Date.now() - new Date(date + 'T00:00:00').getTime()) / 86400000);
}

function append(obj) {
  fs.appendFileSync(FILE, JSON.stringify(obj) + '\n', 'utf8');
  const lines = fs.readFileSync(FILE, 'utf8').trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]);
  if (last.id !== obj.id) { console.error('waiting-on-them: append verify FAILED'); process.exit(1); }
}

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const today = new Date().toISOString().slice(0, 10);

function upsertOpen({ id, to, subject, sent_date, is_job }) {
  const threshold = is_job ? JOB_THRESHOLD : DEFAULT_THRESHOLD;
  const existing = load().get(id);
  if (existing) return false; // already tracked; nothing to write (idempotent)
  append({ id, to: to || 'unknown', subject: (subject || '').slice(0, 80), sent_date,
    threshold_days: threshold, is_job: !!is_job, created: today });
  return true;
}

function resolveId(id, reason) {
  if (!load().has(id)) return false;
  append({ id, resolved: true, resolved_date: today, reason: reason || 'manual' });
  return true;
}

if (cmd === 'sweep') {
  const src = process.argv[3];
  let raw = '';
  try { raw = src ? fs.readFileSync(src, 'utf8') : fs.readFileSync(0, 'utf8'); }
  catch (_) { console.error('sweep: need a JSON file arg or piped JSON on stdin'); process.exit(1); }
  let threads; try { threads = JSON.parse(raw); } catch (_) { console.error('sweep: input is not valid JSON'); process.exit(1); }
  if (!Array.isArray(threads)) { console.error('sweep: expected a JSON array of thread descriptors'); process.exit(1); }
  let opened = 0, resolved = 0;
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
        // A job thread newly crossing silence is worth a line of its own in the triage run. It used to
        // print a command for an application-tracking script the Kit never shipped; the line is the
        // whole signal now (fleet Fix C, 2026-09-24).
        if (isJob) silenceCandidates.push({ threadId: id, subject: (th.subject || '').slice(0, 60), sent_date: th.sent_date });
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
} else if (cmd === 'add') {
  const id = arg('id');
  if (!id || !arg('sent')) { console.error('add needs --id and --sent YYYY-MM-DD'); process.exit(1); }
  const isJob = process.argv.includes('--job');
  const t = arg('threshold');
  if (t) { // explicit threshold override
    append({ id, to: arg('to') || 'unknown', subject: (arg('subject') || '').slice(0, 80),
      sent_date: arg('sent'), threshold_days: parseInt(t, 10), is_job: isJob, created: today });
  } else {
    upsertOpen({ id, to: arg('to'), subject: arg('subject'), sent_date: arg('sent'), is_job: isJob });
  }
  console.log(`tracked: ${id}`);
} else if (cmd === 'resolve') {
  const id = process.argv[3];
  if (!resolveId(id, arg('reason'))) { console.error(`no open thread '${id}'`); process.exit(1); }
  console.log(`resolved: ${id}`);
} else if (cmd === 'list') {
  const items = openItems();
  if (!items.length) { console.log('Waiting on them: nothing. Nobody owes you a reply.'); process.exit(0); }
  console.log(`Waiting on them (${items.length}):`);
  for (const r of items) {
    const tag = r.is_job ? ' [JOB]' : '';
    console.log(`- ${r.to}${tag} (${ageDays(r.sent_date)}d, owed past ${r.threshold_days}d): ${r.subject}`);
  }
} else if (cmd === 'briefline') {
  const items = openItems();
  if (!items.length) process.exit(0); // silent by design
  const oldest = items[0].is_job ? items.reduce((m, r) => Math.max(m, ageDays(r.sent_date)), 0)
    : Math.max(...items.map(r => ageDays(r.sent_date)));
  const top = items.reduce((a, b) => ageDays(a.sent_date) >= ageDays(b.sent_date) ? a : b);
  console.log(`${items.length} owe you replies, oldest ${oldest}d: ${top.to} re: ${top.subject}`);
} else if (cmd === 'summary') {
  const items = openItems();
  const oldest = items.length ? Math.max(...items.map(r => ageDays(r.sent_date))) : 0;
  const jobs = items.filter(r => r.is_job).length;
  const top = items.length ? items.reduce((a, b) => ageDays(a.sent_date) >= ageDays(b.sent_date) ? a : b) : null;
  console.log(JSON.stringify({ open_count: items.length, oldest_days: oldest, jobs_owed: jobs,
    headline: top ? `${top.to} re: ${top.subject.slice(0, 50)} (${ageDays(top.sent_date)}d)` : 'nobody owes you' }));
} else {
  console.error('usage: waiting-on-them.js sweep|add|resolve|list|briefline|summary');
  process.exit(1);
}
