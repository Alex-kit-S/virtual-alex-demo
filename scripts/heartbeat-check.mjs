#!/usr/bin/env node
// scripts/heartbeat-check.mjs - the 48-hour rule behind the Virtual Alex heartbeat workflow
// (.github/workflows/heartbeat.yml, plan Phase 4, seat 5, 2026-09-23).
//
// WHY. Every Routine writes a row to system/run-log.jsonl and the brief opens with the ones that
// failed. What no Routine can report is the silent-stop class: every Routine switched off after 72
// hours without GitHub, a paused subscription, a daily cap that binds every night. Nothing runs, so
// nothing writes, and the owner notices only that the brief stopped. This check runs on GitHub's
// side of the boundary, on a daily schedule, and FAILS when the newest row is older than 48 hours
// or the file is absent, so GitHub mails the owner about a failed workflow. Zero tokens.
//
// Usage: node scripts/heartbeat-check.mjs [--file <path>] [--max-hours <n>] [--now <iso>]
// Exit 0 = a row inside the window (prints the age) · 1 = stale or absent (prints why) · 2 = bad args.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const file = path.resolve(REPO, opt('--file', 'system/run-log.jsonl'));
const maxHours = Number(opt('--max-hours', '48'));
const now = new Date(opt('--now', new Date().toISOString()));
if (!Number.isFinite(maxHours) || maxHours <= 0 || Number.isNaN(now.getTime())) {
  console.error('heartbeat: REFUSED - --max-hours must be a positive number and --now an ISO date');
  process.exit(2);
}
const rel = path.relative(REPO, file).split(path.sep).join('/');

if (!fs.existsSync(file)) {
  console.log(`heartbeat: FAIL - ${rel} is absent: no Routine has ever written a row on this branch`);
  process.exit(1);
}
// Only ROUTINE rows count (test day 2026-09-23): an interactive session's close-out writes a row
// too (job `session`), and an owner who chats every day would otherwise keep the file fresh while
// every Routine is dead, which is exactly the silent-stop class this check exists to catch.
let newest = null;
let sessionRows = 0;
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (!row || typeof row.at !== 'string') continue;
  if (row.job === 'session') { sessionRows++; continue; }
  if (!newest || row.at >= newest.at) newest = row;
}
if (!newest) {
  console.log(sessionRows
    ? `heartbeat: FAIL - ${rel} holds only interactive session rows (${sessionRows}): no Routine has ever written a row on this branch`
    : `heartbeat: FAIL - ${rel} has no row with an at field`);
  process.exit(1);
}
const ageHours = (now.getTime() - new Date(newest.at).getTime()) / 3600000;
if (!Number.isFinite(ageHours)) {
  console.log(`heartbeat: FAIL - the newest row's at (${newest.at}) is not a date`);
  process.exit(1);
}
const age = `${Math.round(ageHours)} hour(s) old (job ${newest.job}, at ${newest.at})`;
if (ageHours > maxHours) {
  console.log(`heartbeat: FAIL - the newest run-log row is ${age}, over the ${maxHours}-hour window: no Routine has written for two days. Open claude.ai/code/routines and check they are on, the GitHub connection holds, and the subscription is not paused.`);
  process.exit(1);
}
console.log(`heartbeat: OK - the newest run-log row is ${age}, inside the ${maxHours}-hour window`);
