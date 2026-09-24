'use strict';
/*
 * system/recall/lib/db.js - the one place the recall spine opens facts.db and owns its schema.
 *
 * Zero new dependencies: node:sqlite is built into Node (v22.5+), so "SQLite only, already in the
 * stack" (the vault FTS5 index proves SQLite is in-stack; this adds no native build, no npm, no
 * package.json). The Recall Spine upgrade plan (2026-07-24) named better-sqlite3; node:sqlite is the
 * faithful zero-infra substitute and the deliberate deviation is recorded in the plan record
 * (vault/research/alex-recall-spine.md) and system/recall/README.md.
 *
 * facts.db is GITIGNORED (mirrors the vault FTS5 index) and rides the 21:45 encrypted vault backup,
 * so it never reaches the public repo and is fully regenerable from the sources it mirrors.
 *
 * The bi-temporal model is Graphiti's, implemented at Alex scale (Zep paper arXiv 2501.13956): every
 * fact carries t_valid/t_invalid; supersession stamps the old row and links superseded_by, never
 * DELETEs. The `current_fact` partial unique index is the supersession engine in one line - only one
 * row per (subject,predicate) may have t_invalid NULL, so a contradiction is unrepresentable.
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const REPO = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = process.env.ALEX_FACTS_DB || path.join(REPO, 'system', 'recall', 'facts.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY,
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT,
  superseded_by INTEGER REFERENCES facts(id),
  source        TEXT NOT NULL,
  harvester     TEXT NOT NULL,
  confidence    TEXT NOT NULL DEFAULT 'machine',
  ingested_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS current_fact ON facts(subject, predicate) WHERE t_invalid IS NULL;
CREATE INDEX IF NOT EXISTS facts_subject ON facts(subject);

CREATE TABLE IF NOT EXISTS lessons (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,
  source_runid  TEXT,
  class         TEXT NOT NULL,
  lesson        TEXT NOT NULL,
  norm          TEXT NOT NULL,          -- normalized lesson text, for dedup + hit counting
  evidence      TEXT,
  hits          INTEGER NOT NULL DEFAULT 1,
  t_valid       TEXT NOT NULL,
  t_invalid     TEXT,
  superseded_by INTEGER REFERENCES lessons(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_norm_current ON lessons(norm) WHERE t_invalid IS NULL;

-- Subject alias table (Phase 2 retrieval): maps a lowercase token that may appear in a prompt to a
-- fact subject, so injection is exact-match (no embeddings). Populated by the harvesters.
CREATE TABLE IF NOT EXISTS subject_alias (
  alias   TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (alias, subject)
);
`;

/**
 * Open facts.db (creating + migrating the schema if needed) and return the handle.
 * WAL keeps the per-prompt reader (recall-inject) from blocking the nightly writer.
 */
function openDb(readonly = false) {
  const db = new DatabaseSync(DB_PATH, { readOnly: readonly && require('fs').existsSync(DB_PATH) });
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec(SCHEMA);
  }
  return db;
}

module.exports = { openDb, DB_PATH, REPO, SCHEMA };
