#!/usr/bin/env node
'use strict';
/*
 * system/recall/harvest.js - the nightly entry point for the bi-temporal fact ledger.
 *
 * Runs in the nightly chain at 21:35, right after the vault-search index rebuild and before the
 * 21:45 encrypted backup (so facts.db is fresh in the tar). Zero LLM tokens: pure node/SQLite.
 *
 *   node system/recall/harvest.js            populate facts.db, log, exit 0 (or 1 on tripwire)
 *   node system/recall/harvest.js --quiet    same, only the summary line
 *
 * On the mass-drift tripwire it exits 1 (a harvester bug must be loud), and the nightly wrapper pushes
 * RED. On a clean run it exits 0. A per-harvester error is logged but never fatal (partial-source
 * resilience). This process NEVER makes a network call itself; the RED push is the wrapper's job.
 */
const fs = require('fs');
const path = require('path');
const { runHarvest } = require('./lib/harvest-core');
const { REPO } = require('./lib/db');

const quiet = process.argv.includes('--quiet');
const logDir = path.join(REPO, 'outputs', 'logs');
const logFile = path.join(logDir, 'recall-harvest.log');
function log(m) {
  try { fs.mkdirSync(logDir, { recursive: true }); fs.appendFileSync(logFile, m + '\n', 'utf8'); } catch (_) {}
  if (!quiet) process.stdout.write(m + '\n');
}

const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
log(`=== recall harvest ${stamp} ===`);

let stats;
try {
  stats = runHarvest();
} catch (e) {
  log(`FATAL: ${e.message}`);
  process.exit(1);
}

if (stats.tripped) {
  log(`TRIPWIRE: ${stats.tripped}`);
  process.exit(1);
}

const summary = `inserted=${stats.inserted} superseded=${stats.superseded} noop=${stats.noop} current=${stats.currentFacts} errors=${stats.errors.length}`;
log(summary);
if (stats.superseded > 0) {
  log(`  superseded by harvester: ${Object.entries(stats.byHarvester).filter(([, v]) => v.superseded).map(([k, v]) => `${k}:${v.superseded}`).join(', ') || 'n/a'}`);
}
for (const e of stats.errors) log(`  ERROR ${e}`);
log('OK');
// stdout the machine summary too, so the nightly wrapper can echo it into its own log.
if (quiet) process.stdout.write(summary + '\n');
process.exit(0);
