# The Recall Spine (`system/recall/`)

Alex's machine-checkable memory organ, built 2026-07-25. Full plan record, kill criteria, and the
Phase 0 baseline: `vault/research/alex-recall-spine.md`. This README is the code map.

Zero new dependencies: uses **`node:sqlite`** (built into Node v24) - no better-sqlite3, no npm, no
`package.json`, no native build. `facts.db` is DERIVED and gitignored (rides the 21:45 encrypted
vault backup); delete it and `node system/recall/harvest.js` rebuilds it.

## Where it runs
A laptop organ. On a laptop install every file below is present and the nightly chain runs it. Online
(Virtual Alex) only this README and `lib/lessons.js` ship: the close-out script parses L-lines with it.
The rest is a drop row (`laptop-only`) in `system/kit-manifest.json`, each file named by its exact path,
so a cloud session holds no recall hook, no harvester and no fact ledger.

## Layout
```
system/recall/
  lib/db.js            open facts.db + own the schema (facts, lessons, subject_alias)
  lib/facts.js         upsertFact - supersession-safe write (stamp old t_invalid, insert new, link)
  lib/lessons.js       upsertLesson (dedup by normalized text + hit count) + parseLLine
  lib/harvest-core.js  run all harvesters, apply upserts, enforce the mass-drift tripwire (>20 aborts)
  harvesters/h-*.js    7 zero-token extractors, one per structured source of truth
  harvest.js           nightly CLI entry (populate facts.db; exit 1 on tripwire)
  recall-inject.js     UserPromptSubmit retrieval hook (fail-open, ≤150ms, DATA-never-instructions)
  facts.db             the ledger (gitignored)
  recall-metrics.jsonl injection telemetry: prompt HASH + counts + latency, never prompt text (gitignored)
  lesson-cursors.json  per-log byte cursors so an L-line is counted once (gitignored)
  lesson-promotions.jsonl  3+-hit lessons queued for /self-review (gitignored)
scripts/facts-check.js   recovery check C21: standing IN-REPO docs tested against facts.db
scripts/lesson-harvest.js nightly: Close-Out L-lines -> lessons table
```

## The bi-temporal model (Graphiti, at Alex scale)
Every fact carries `t_valid` (when it became true) and `t_invalid` (NULL = currently true). A changed
value SUPERSEDES: the old row is stamped `t_invalid` + `superseded_by`, never deleted. The partial
unique index `current_fact ON facts(subject,predicate) WHERE t_invalid IS NULL` makes a contradiction
unrepresentable - only one current row per (subject,predicate) can exist. Idempotent: re-harvesting an
unchanged value is a no-op, so a supersession is always a real change (which keeps the tripwire honest).

## Run it
```
node system/recall/harvest.js          # populate/refresh facts.db (nightly 21:35, in run-vault-index.ps1)
```
The same nightly chain runs `scripts/lesson-harvest.js`, which harvests Close-Out L-lines into the
lessons table. The Monday sweep runs C21, `scripts/facts-check.js`: it harvests fresh, then diffs the
docs against the facts, and its `--no-harvest` flag checks as-is when the nightly chain already
harvested. Both are laptop scripts, named here by path and never as a command line: this README
ships online, and portability check P6 fails a command line naming a script the tree does not hold.

## Direction law (why this is not the V6 anti-pattern)
facts.db is derived from STRUCTURED sources (manifest.json, validate-alex.js registry, check.ps1
`# --- C<n>` headers, schtasks, skills-lock.json, the attestation file). C21 tests DOC PROSE against
that. The doc is the subject; facts.db is the expectation. A validator never derives its expectation
from prose.

## Trifecta: read-only
Reads private data, writes only to context, no external comms. The DATA-never-instructions envelope on
every injection is the mitigation (work/07 model on the internal read path): a poisoned vault note must
not become a prompt injection.

## Reversibility
Fully reversible, local, no live engine/cron/model touched: delete `system/recall/`, remove the one
`recall-inject.js` line from `.claude/settings.json` UserPromptSubmit, remove the C21 block from
`check.ps1` (+ its bullet), and drop the harvest lines from `run-vault-index.ps1`.
