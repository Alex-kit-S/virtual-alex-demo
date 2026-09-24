#!/usr/bin/env node
'use strict';
/*
 * scripts/lesson-harvest.js - Recall Spine Phase 3: harvest Close-Out L-lines into the lessons table.
 *
 * Runs nightly (beside the fact harvest). Zero LLM tokens. The Close-Out Report already emits an
 * L-line - `L: class=<..> lesson="<one sentence>" evidence=<file:line|runid>` (or `L: none`) - this
 * turns that text into structured, dedup'd, hit-counted rows that the next session reads (Phase 2
 * Query 3) and that Sunday's /self-review clusters with a SELECT instead of an excavation.
 *
 * IDEMPOTENCY: a per-log byte cursor (system/recall/lesson-cursors.json, gitignored) means each L-line
 * is processed exactly once - re-scanning the same growing log every night can never re-inflate a hit
 * counter. A truncated/rotated log (cursor > size) resets to 0. This is the discipline that keeps
 * "seen 4x" a true signal.
 *
 * On the 3rd hit of a lesson, one promotion candidate is queued to system/recall/lesson-promotions.jsonl
 * (gitignored) for the weekly /self-review to consider as a Standing Order / CLAUDE.md edit - behind
 * the EXISTING human gate; this never auto-edits the constitution.
 */
const fs = require('fs');
const path = require('path');
const { openDb, REPO } = require('../system/recall/lib/db');
const { upsertLesson, parseLLine } = require('../system/recall/lib/lessons');

// Paths are env-overridable so the dedup/promotion logic can be exercised in a sandbox (matching
// vault_search.py's freshness-test design) without touching real cursors or the real ledger.
const LOG_DIR = process.env.ALEX_LOG_DIR || path.join(REPO, 'outputs', 'logs');
const CURSORS = process.env.ALEX_LESSON_CURSORS || path.join(REPO, 'system', 'recall', 'lesson-cursors.json');
const PROMOTIONS = process.env.ALEX_LESSON_PROMOTIONS || path.join(REPO, 'system', 'recall', 'lesson-promotions.jsonl');
const HARVEST_LOG = path.join(LOG_DIR, 'lesson-harvest.log');

function log(m) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(HARVEST_LOG, m + '\n', 'utf8'); } catch (_) {}
  process.stdout.write(m + '\n');
}

function loadCursors() {
  try { return JSON.parse(fs.readFileSync(CURSORS, 'utf8')); } catch (_) { return {}; }
}
function saveCursors(c) {
  try { fs.writeFileSync(CURSORS, JSON.stringify(c, null, 2), 'utf8'); } catch (e) { log(`cursor save failed: ${e.message}`); }
}

function main() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  log(`=== lesson harvest ${stamp} ===`);
  if (!fs.existsSync(LOG_DIR)) { log('no outputs/logs yet - nothing to harvest'); return 0; }

  const cursors = loadCursors();
  const db = openDb();
  let processed = 0; let inserted = 0; let bumped = 0; let promoted = 0;

  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log'));
  for (const f of files) {
    if (f === 'lesson-harvest.log') continue; // never harvest our own log
    const fp = path.join(LOG_DIR, f);
    let size = 0;
    try { size = fs.statSync(fp).size; } catch (_) { continue; }
    let start = Number(cursors[f] || 0);
    if (start > size) start = 0; // log rotated/truncated
    if (start >= size) continue;
    let chunk = '';
    try {
      const fd = fs.openSync(fp, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch (e) { log(`read failed ${f}: ${e.message}`); continue; }
    cursors[f] = size;

    for (const line of chunk.split(/\r?\n/)) {
      // Cheap screen only; parseLLine does the real work and owns the shape contract.
      // NOT line-anchored, and the colon is optional: every scheduled automation emits its
      // Close-Out Report as ONE middle-dot-separated line, so the L segment sits mid-line, and
      // email-triage writes `L class=`. The old `^\s*L:` screen here was the SECOND of two
      // line-anchored gates (the other was in parseLLine) that between them kept the lessons
      // table at 0 rows for four days while this harvester reported success nightly. Fixed
      // 2026-07-29; pinned by scripts/tests/test-lesson-parse.js.
      if (!/(?:^|[^A-Za-z0-9])L:?\s*(?:class=|none\b)/i.test(line)) continue;
      const parsed = parseLLine(line.trim());
      if (!parsed) continue; // `L: none` or malformed
      processed++;
      try {
        const res = upsertLesson(db, { cls: parsed.cls, lesson: parsed.lesson, evidence: parsed.evidence, source_runid: f });
        if (res.action === 'insert') inserted++; else bumped++;
        if (res.hits === 3) { // crosses the promotion threshold exactly once
          promoted++;
          try {
            fs.appendFileSync(PROMOTIONS, JSON.stringify({
              ts: stamp, class: parsed.cls, lesson: parsed.lesson, hits: res.hits, evidence: parsed.evidence,
            }) + '\n', 'utf8');
          } catch (e) { log(`promotion queue write failed: ${e.message}`); }
        }
      } catch (e) { log(`upsert failed: ${e.message}`); }
    }
  }

  db.close();
  saveCursors(cursors);
  log(`processed=${processed} inserted=${inserted} bumped=${bumped} promoted=${promoted}`);
  log('OK');
  return 0;
}

process.exit(main());
