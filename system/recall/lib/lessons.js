// @ts-check
// system/recall/lib/lessons.js - the Close-Out L-line: its one parser, and the one writer of the lessons table.
//
// WHAT. Every Close-Out Report ends with an L-line: `L: none`, or
// `L: class=<class> lesson="<one sentence>" evidence=<where>`. parseLLine reads the lesson out of a report line.
// Online, scripts/close-out-online.sh writes it as a row of vault/projects/self-review/lessons.jsonl; on a
// laptop, scripts/lesson-harvest.js writes it into the Recall Spine's lessons table through upsertLesson, where
// a lesson seen again bumps a hit count instead of adding a row, so a lesson that keeps coming back carries its
// own count to /self-review.
//
// HOW. parseLLine trims the line and finds the L segment anywhere in it: an L in either case, at the start or
// after any character that is not an ASCII letter or digit, with or without its colon, because a scheduled
// Close-Out Report is ONE line of segments separated by middle dots and one automation writes `L class=`. The
// class is lower-cased, and a class outside the five becomes process; the lesson is everything between its
// two double quotes, trimmed; the evidence runs to the next middle dot or the end of the line, trimmed, and is
// null when absent or blank, but a line whose `evidence=` has nothing after it at all is not a lesson: no
// segment matches, and the whole line is null, the same as `L: none`. normalize is the dedup key: lower case,
// every run of characters outside a-z, 0-9 and the space turned into one space, and every run of spaces left
// by that collapsed to one the same way, trimmed. upsertLesson bumps the hits of the current row with the
// same key, or inserts a first row dated today in UTC, and reports promote from the third hit on.
//
// NEVER. Requires no repository file. scripts/close-out-online.sh loads this file by its exact path in a
// tree that may have no node:sqlite; scripts/tests/test-close-out-online.mjs and
// scripts/tests/test-routine-prompt-commands.mjs copy it with scripts/lib/json-writer.js and
// scripts/lib/write-lock.js beside it, not alone, scripts/tests/test-lesson-harvest-inject.mjs copies it with
// no scripts/lib/ at all, and scripts/tests/test-recall-online-closure.mjs holds it to loading nothing else;
// so any re-export of the parser points here, never the reverse. Opens a database:
// upsertLesson is handed one. Edits the constitution: a promotion is a candidate for /self-review, never a
// rule. Fixes the two defects scripts/tests/test-lesson-harvest-inject.mjs pins, before the defect ledger
// schedules them: normalize keeps ASCII letters only, so an Arabic lesson has an empty key and a Swedish letter
// becomes a space (R8-7), and a lesson that carries a double quote is not a lesson (R8-23).
//
// Usage: module only - const { parseLLine } = require('./lessons');
'use strict';

/** The five lesson classes. A class outside them is written as FALLBACK_CLASS. */
const CLASSES = new Set(['propagation', 'verification', 'cost', 'security', 'process']);
const FALLBACK_CLASS = 'process';

/** The hit count from which a lesson is a /self-review promotion candidate. */
const PROMOTE_AT = 3;

/**
 * The L segment: a start or a character that is not an ASCII letter or digit, `L` with or without its colon,
 * `class=<letters>`, `lesson="<no double quote>"`, then an optional `evidence=` that runs to the next middle
 * dot or the end of the line. The middle dot is U+00B7, the separator of every one-line Close-Out Report.
 */
const L_SEGMENT = /(?:^|[^A-Za-z0-9])L:?\s*class=([a-z]+)\s+lesson="([^"]+)"(?:\s+evidence=(.+?))?\s*(?:·|$)/i;

/**
 * @typedef {object} ParsedLesson
 * @property {string} cls one of CLASSES
 * @property {string} lesson the sentence between the double quotes, trimmed
 * @property {string | null} evidence what follows `evidence=`, trimmed, or null
 */

/**
 * @typedef {object} LessonInput
 * @property {string} [date] YYYY-MM-DD; today in UTC when absent
 * @property {string | null} [source_runid] the log or run the lesson came from
 * @property {string} cls
 * @property {string} lesson
 * @property {string | null} [evidence]
 */

/**
 * @typedef {object} UpsertResult
 * @property {'insert' | 'bump'} action
 * @property {number} id the row's id
 * @property {number} hits the row's hit count after this call
 * @property {boolean} promote true from the PROMOTE_AT hit on
 */

/**
 * The dedup key of a lesson's text.
 * @param {unknown} text
 * @returns {string}
 */
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Now in UTC as `YYYY-MM-DD HH:MM:SS`, the lessons table's time format. */
function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Inserts a lesson, or bumps the hit count of the current row with the same normalized text.
 * @param {import('node:sqlite').DatabaseSync} db an open Recall Spine database that holds the lessons table
 * @param {LessonInput} input
 * @returns {UpsertResult}
 * @throws {Error} when the lesson normalizes to nothing, and whatever the database throws
 */
function upsertLesson(db, { date, source_runid = null, cls, lesson, evidence = null }) {
  const norm = normalize(lesson);
  if (!norm) throw new Error('upsertLesson: empty lesson text');
  const ts = nowIso();
  const existing = /** @type {{ id: number, hits: number } | undefined} */ (
    db.prepare('SELECT * FROM lessons WHERE norm=? AND t_invalid IS NULL').get(norm)
  );
  if (existing) {
    const hits = existing.hits + 1;
    db.prepare('UPDATE lessons SET hits=? WHERE id=?').run(hits, existing.id);
    return { action: 'bump', id: existing.id, hits, promote: hits >= PROMOTE_AT };
  }
  const info = db
    .prepare(
      `INSERT INTO lessons(date, source_runid, class, lesson, norm, evidence, hits, t_valid)
     VALUES(?,?,?,?,?,?,1,?)`
    )
    .run(date || ts.slice(0, 10), source_runid, cls, String(lesson), norm, evidence, ts);
  return { action: 'insert', id: Number(info.lastInsertRowid), hits: 1, promote: false };
}

/**
 * The lesson an L-line carries.
 * @param {unknown} line a Close-Out Report line, or its L segment alone
 * @returns {ParsedLesson | null} null for `L: none` and for any line with no well-formed L segment
 */
function parseLLine(line) {
  const m = L_SEGMENT.exec(String(line).trim());
  if (!m) return null;
  const cls = m[1].toLowerCase();
  return { cls: CLASSES.has(cls) ? cls : FALLBACK_CLASS, lesson: m[2].trim(), evidence: m[3]?.trim() || null };
}

module.exports = { upsertLesson, parseLLine, normalize };
