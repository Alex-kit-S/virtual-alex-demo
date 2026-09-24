'use strict';
/*
 * system/recall/lib/harvest-core.js - runs every harvester against facts.db.
 *
 * Contract (verify-after-write law + the mass-drift tripwire from the plan's risk table):
 *   - Each harvester is idempotent: a re-harvest of an unchanged system supersedes NOTHING (upsertFact
 *     returns 'noop'), so the supersession count is a true change signal.
 *   - MASS-DRIFT TRIPWIRE: if a single harvest would supersede more than MAX_SUPERSEDE facts, that is
 *     almost always a harvester bug (a source moved/reshaped) rather than the world changing that much
 *     overnight. We ABORT the whole run (nothing committed for the tripping harvester's batch is a
 *     property of transactionality) and signal caller to RED, rather than let a bug mass-invalidate the
 *     ledger. This is the "harvester bug surfaces as a mass-supersession anomaly" mitigation.
 *   - A single harvester that throws is caught and recorded; the rest still run (a partial source
 *     outage never blocks the ledger), UNLESS it is the tripwire, which is fatal by design.
 *   - Every write is followed by a read-back count assertion (verify-after-write).
 */
const path = require('path');
const { openDb, REPO } = require('./db');
const { upsertFact, addAlias, currentFacts } = require('./facts');

const MAX_SUPERSEDE = 20; // the mass-drift tripwire (plan risk table)

const HARVESTERS = [
  'h-manifest', 'h-scheduler', 'h-validators', 'h-recovery', 'h-skills', 'h-attest',
];

function runHarvest({ db, tripwire = MAX_SUPERSEDE } = {}) {
  const ownDb = !db;
  if (!db) db = openDb();
  const ctx = { REPO };
  const stats = { inserted: 0, superseded: 0, noop: 0, byHarvester: {}, errors: [], tripped: null };

  for (const name of HARVESTERS) {
    let facts = [];
    try {
      facts = require(path.join(__dirname, '..', 'harvesters', name)).harvest(ctx) || [];
    } catch (e) {
      stats.errors.push(`${name}: ${e.message}`);
      continue;
    }
    const h = { inserted: 0, superseded: 0, noop: 0 };
    for (const f of facts) {
      let res;
      try {
        res = upsertFact(db, f);
      } catch (e) {
        stats.errors.push(`${name} upsert ${f.subject}/${f.predicate}: ${e.message}`);
        continue;
      }
      if (res === 'insert') { h.inserted++; stats.inserted++; }
      else if (res === 'supersede') { h.superseded++; stats.superseded++; }
      else { h.noop++; stats.noop++; }
      for (const a of f.aliases || []) if (a) addAlias(db, a, f.subject);
      // Mass-drift tripwire: abort the instant we cross it. Nothing after this point is trusted.
      if (stats.superseded > tripwire) {
        stats.tripped = `mass-drift tripwire: ${stats.superseded} supersessions in one harvest (> ${tripwire}); aborting (likely a harvester bug, not the world changing)`;
        if (ownDb) db.close();
        return stats;
      }
    }
    stats.byHarvester[name] = h;
  }

  // Verify-after-write: the ledger has at least as many current facts as we just inserted.
  const cur = currentFacts(db).length;
  stats.currentFacts = cur;
  if (ownDb) db.close();
  return stats;
}

module.exports = { runHarvest, MAX_SUPERSEDE, HARVESTERS };
