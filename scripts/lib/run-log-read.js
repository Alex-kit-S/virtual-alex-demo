// @ts-check
// scripts/lib/run-log-read.js - reads the run log into its rows and the lines that would not parse.
//
// WHAT. Reads system/run-log.jsonl, the append-only log every Routine and every close-out writes a row
// to. A caller gets the rows in file order and, apart from them, every line that is not JSON, and decides
// for itself whether a torn line deserves a word. Its three readers: scripts/heartbeat-check.mjs,
// scripts/run-log.mjs and the recovery sweep, work/18-recovery-layer/check.mjs.
//
// HOW. A path fs.existsSync says holds nothing is null, and so is one through a file where a folder
// should be; each caller reads null its own way (a FAIL, an empty log, a leg with nothing to compare).
// Otherwise the file is read whole as UTF-8 and split only at a line feed, a carriage return before it
// dropped, so a lone carriage return stays inside its line. A line String#trim leaves empty, a byte-order
// mark or a non-breaking space alone included, is skipped, neither a row nor unparseable, though the
// numbering still counts it. Every other line goes through JSON.parse, and whatever that returns is a
// row, null, a number and an array included, because each caller filters rows by its own rule. A line
// JSON.parse refuses is unparseable and is kept with its 1-based number and its text. By default a line
// is parsed as it stands, so only JSON's own white space may pad it. With trim set, String#trim runs
// first, forgiving either of those at either end; that is scripts/run-log.mjs's habit, chosen per caller.
//
// NEVER. Writes, locks or repairs the file: a torn line is reported and left exactly as it is. Prints
// anything, since the warning is the caller's. Throws over a line: only a path fs.existsSync finds and
// fs cannot read as a file (a folder, a denied read) throws, with the error fs gives.
//
// Usage: module only - const { readRunLog } = require('./run-log-read');
'use strict';

const fs = require('node:fs');

/**
 * @typedef {object} UnparseableLine
 * @property {number} line its 1-based number in the file
 * @property {string} text the line as read, without its line break
 */

/**
 * @typedef {object} RunLog
 * @property {unknown[]} rows every value a line parsed to, in file order
 * @property {UnparseableLine[]} unparseable every line JSON.parse refused, in file order
 */

/**
 * Every row of a JSON Lines log, and every line that would not parse.
 * @param {string} file the log's path
 * @param {{ trim?: boolean }} [options] `trim` parses each line with String#trim applied first
 * @returns {RunLog | null} null when fs.existsSync finds nothing at `file`
 */
function readRunLog(file, options = {}) {
  const { trim = false } = options;
  if (!fs.existsSync(file)) return null;
  /** @type {unknown[]} */
  const rows = [];
  /** @type {UnparseableLine[]} */
  const unparseable = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!text.trim()) continue;
    try {
      rows.push(JSON.parse(trim ? text.trim() : text));
    } catch {
      unparseable.push({ line: i + 1, text });
    }
  }
  return { rows, unparseable };
}

module.exports = { readRunLog };
