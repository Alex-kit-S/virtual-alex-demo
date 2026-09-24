// log.js - step-by-step run log for the unified generator (refactor P1-S3).
// Every step prints to stdout AND accumulates; flush() writes refactor/last-run.log
// (gitignored via the global *.log rule) so a failed run leaves a readable trail.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const LOG_PATH = path.join(REPO, 'refactor', 'last-run.log');
const lines = [];

function step(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  lines.push(line);
  console.log(msg);
}

function flush() {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, lines.join('\n') + '\n', 'utf8');
  } catch (e) {
    console.error(`log: could not write ${LOG_PATH}: ${e.message}`);
  }
}

module.exports = { step, flush, LOG_PATH };
