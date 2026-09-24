'use strict';
/*
 * system/recall/lib/lessons.js - the lessons write-path. Recall Spine Phase 3 (the compound step).
 *
 * Every's compound-engineering insight at Alex scale: end every unit of work with a deposited lesson
 * the NEXT session reads. The Close-Out gate already emits an L-line; this turns that text into rows.
 *
 * Dedup by NORMALIZED text (lowercased, whitespace-collapsed, punctuation-stripped): a repeated
 * lesson increments a hit counter instead of duplicating, so "this bit us 4 times" becomes evidence a
 * human gate won't wave through by accident. 3+ hits queues a /self-review promotion candidate (never
 * auto-edits the constitution - that law stands).
 */

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Insert a lesson or bump its hit count if the normalized text already exists (current).
 * @returns {{action:'insert'|'bump', id:number, hits:number, promote:boolean}}
 */
function upsertLesson(db, { date, source_runid = null, cls, lesson, evidence = null }) {
  const norm = normalize(lesson);
  if (!norm) throw new Error('upsertLesson: empty lesson text');
  const ts = nowIso();
  const existing = db.prepare('SELECT * FROM lessons WHERE norm=? AND t_invalid IS NULL').get(norm);
  if (existing) {
    const hits = existing.hits + 1;
    db.prepare('UPDATE lessons SET hits=? WHERE id=?').run(hits, existing.id);
    return { action: 'bump', id: existing.id, hits, promote: hits >= 3 };
  }
  const info = db.prepare(
    `INSERT INTO lessons(date, source_runid, class, lesson, norm, evidence, hits, t_valid)
     VALUES(?,?,?,?,?,?,1,?)`
  ).run(date || ts.slice(0, 10), source_runid, cls, String(lesson), norm, evidence, ts);
  return { action: 'insert', id: Number(info.lastInsertRowid), hits: 1, promote: false };
}

/**
 * Parse an L-line from a Close-Out Report. Returns null for `L: none` / non-matches.
 *
 * MATCHES THE L SEGMENT ANYWHERE IN THE LINE, and treats the colon as optional. Both are
 * deliberate, and this is the 2026-07-29 fix for the "compounding loop is half open" finding.
 *
 * The original form anchored on `^L:` after trimming the whole line. No scheduled automation has
 * ever written it that way: every one of them emits its Close-Out Report as a SINGLE line with
 * middle-dot separators, e.g.
 *   `Close-Out [morning-brief]: A1 N/A · ... · L: class=verification lesson="..." evidence=... · Verdict: COMPLETE`
 * so `^L:` matched nothing, and email-triage writes `L class=` with no colon at all. The result was
 * that the lessons table sat at 0 rows for the four days the ledger was live while lesson-harvest.js
 * ran nightly and reported success, because finding nothing to parse is indistinguishable from
 * there being nothing to find. The lessons were in the logs the whole time.
 *
 * The lesson of the lesson: parse what the reports ACTUALLY contain, not what the template draws.
 * A format contract enforced only by asking a model to emit a line in a particular position is not
 * a contract. Covered by scripts/tests/test-lesson-parse.js with the real log lines as fixtures.
 */
function parseLLine(line) {
  const s = String(line).trim();
  const allowed = new Set(['propagation', 'verification', 'cost', 'security', 'process']);
  // Real lesson first, so a stray "none" elsewhere in a long report line cannot mask it.
  // evidence runs to the next middle-dot separator or end of line (it often contains spaces).
  const m = s.match(
    /(?:^|[^A-Za-z0-9])L:?\s*class=([a-z]+)\s+lesson="([^"]+)"(?:\s+evidence=(.+?))?\s*(?:·|$)/i
  );
  if (m) {
    const cls = m[1].toLowerCase();
    const evidence = m[3] ? m[3].trim() : null;
    return { cls: allowed.has(cls) ? cls : 'process', lesson: m[2].trim(), evidence: evidence || null };
  }
  // `L: none` / `L none` anywhere in the line = a deliberate no-lesson run.
  if (/(?:^|[^A-Za-z0-9])L:?\s*none\b/i.test(s)) return null;
  return null;
}

module.exports = { upsertLesson, parseLLine, normalize };
