// @ts-check
// scripts/lib/log.js - the generator's run log: each step printed as it happens and kept for one file.
//
// WHAT. scripts/generate-alex.js reports every step of a run through this module. A person watching sees
// each step on the console; a run that failed leaves refactor/last-run.log behind, so what it did before
// it stopped can still be read afterwards.
//
// HOW. step prints the message to stdout as it is and keeps a copy with an ISO-8601 UTC timestamp in
// front. flush writes the kept lines to refactor/last-run.log under the repository root, one per line
// with a final line break, creating the folder when it is missing and replacing the log of the run
// before. The file is gitignored by the global *.log rule. The root comes from repo-root.js.
//
// NEVER. Fails a run because the log could not be written: flush names the path and the reason on stderr
// and returns. Keeps more than one run: each flush replaces the file.
//
// Usage: module only - const log = require('./log'); log.step('...'); log.flush();
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./repo-root');

const LOG_PATH = path.join(REPO, 'refactor', 'last-run.log');

/** @type {string[]} */
const lines = [];

/**
 * Print one step, and keep it with its time for the log file.
 * @param {string} msg
 */
function step(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  lines.push(line);
  console.log(msg);
}

/** Write every step kept so far to refactor/last-run.log; a failure is reported on stderr, never thrown. */
function flush() {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, `${lines.join('\n')}\n`, 'utf8');
  } catch (e) {
    console.error(`log: could not write ${LOG_PATH}: ${/** @type {Error} */ (e).message}`);
  }
}

module.exports = { step, flush, LOG_PATH };
