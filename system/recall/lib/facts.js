'use strict';
/*
 * system/recall/lib/facts.js - the supersession-safe write path + read helpers for facts.db.
 *
 * upsertFact is the whole bi-temporal contract in one function:
 *   - No current row for (subject,predicate)         -> INSERT (t_valid=now).
 *   - Current row exists and object is UNCHANGED      -> no-op (never churn; keeps the mass-drift
 *                                                        tripwire meaningful - a nightly re-harvest of
 *                                                        an unchanged system supersedes NOTHING).
 *   - Current row exists and object CHANGED           -> supersede: stamp the old row's t_invalid,
 *                                                        INSERT the new current row, then link the old
 *                                                        row's superseded_by to the new id. All inside
 *                                                        one transaction; the old row must lose its
 *                                                        NULL t_invalid BEFORE the new insert or the
 *                                                        `current_fact` partial-unique index rejects it
 *                                                        (that rejection IS the guarantee).
 *
 * Returns 'insert' | 'noop' | 'supersede' so the caller can enforce the mass-drift tripwire and log.
 */

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function getCurrent(db, subject, predicate) {
  return db.prepare(
    'SELECT * FROM facts WHERE subject=? AND predicate=? AND t_invalid IS NULL'
  ).get(subject, predicate);
}

/**
 * @returns {'insert'|'noop'|'supersede'}
 */
function upsertFact(db, { subject, predicate, object, source, harvester, confidence = 'machine' }) {
  if (subject == null || predicate == null || object == null) {
    throw new Error(`upsertFact: subject/predicate/object all required (got ${subject}/${predicate}/${object})`);
  }
  const obj = String(object);
  const ts = nowIso();
  const cur = getCurrent(db, subject, predicate);

  if (!cur) {
    db.prepare(
      `INSERT INTO facts(subject,predicate,object,t_valid,t_invalid,source,harvester,confidence,ingested_at)
       VALUES(?,?,?,?,NULL,?,?,?,?)`
    ).run(subject, predicate, obj, ts, source, harvester, confidence, ts);
    return 'insert';
  }

  if (String(cur.object) === obj) {
    // Same fact, still true. Touch nothing - idempotent re-harvest.
    return 'noop';
  }

  // Supersession, transactionally. Free the partial-unique slot first, then insert, then link back.
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE facts SET t_invalid=? WHERE id=?').run(ts, cur.id);
    const info = db.prepare(
      `INSERT INTO facts(subject,predicate,object,t_valid,t_invalid,source,harvester,confidence,ingested_at)
       VALUES(?,?,?,?,NULL,?,?,?,?)`
    ).run(subject, predicate, obj, ts, source, harvester, confidence, ts);
    const newId = Number(info.lastInsertRowid);
    db.prepare('UPDATE facts SET superseded_by=? WHERE id=?').run(newId, cur.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return 'supersede';
}

/** Register a lowercase alias -> subject mapping for Phase 2 exact-match retrieval. */
function addAlias(db, alias, subject) {
  if (!alias) return;
  db.prepare('INSERT OR IGNORE INTO subject_alias(alias,subject) VALUES(?,?)')
    .run(String(alias).toLowerCase(), subject);
}

/** All currently-true facts (t_invalid IS NULL). */
function currentFacts(db) {
  return db.prepare('SELECT * FROM facts WHERE t_invalid IS NULL ORDER BY subject, predicate').all();
}

/** The single current fact for a (subject,predicate), or undefined. */
function currentFact(db, subject, predicate) {
  return getCurrent(db, subject, predicate);
}

module.exports = { upsertFact, addAlias, currentFacts, currentFact, getCurrent, nowIso };
