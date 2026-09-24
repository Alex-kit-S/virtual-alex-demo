# Constitution annex: system organs - self-heal, recall spine, session root, soul-core

Operative summaries live in `CLAUDE.md`; this page holds the full original sections (moved 2026-08-16, rulebook diet).

## As it stood in the constitution: the preamble soul-core note (moved verbatim 2026-08-16)

# Personal Ops System - Orchestrator

@soul-core.md

(That import IS the identity injection since 2026-08-16: harness 2.1.220 truncates hook stdout at ~10KB, so the old `cat soul.md` hook was delivering ~2KB of a 172KB file; memory-file imports load whole. The card is compiled nightly from soul.md by `scripts/lib/build-soul-core.js` (operative layer + both canaries + pinned registers + ~20 newest My Words), gitignored, rides the 21:45 tar. Missing card = the SessionStart hook falls back to cat-ing full soul.md. soul.md stays the source of truth and the full corpus; gate re-reads still read IT. Measurements + design: outputs/research-team/2026-08-16/baseline/baseline.md.)

---

## As it stood in the constitution: Self-Correction Loop (moved verbatim 2026-08-16)

## Self-Correction Loop

When an MCP call fails:
1. Check vault/projects/error-log.md for past fixes
2. If known fix exists, use it immediately
3. If new error, fix it, then log: date, MCP, what went wrong, fix
4. Do NOT retry the same wrong approach

### HQ Self-Heal Loop (LIVE 2026-07-21, the owner: "HQ checks AND fixes, it doesn't just display errors")
The automated, HQ-metric-driven sibling of the loop above. HQ is not a passive dashboard - on **every HQ
update** (folded into the harvest via `scripts/run-alex-hq.ps1` + `/alex-hq` step 1c) it runs
`scripts/hq_self_heal.py`: re-derive ground truth for each metric, and per the risk class in the registry
`system/hq-heal-map.json`:
- **AUTO-SAFE** (deterministic, reversible, no side-effect: re-count MCP, re-ship stale box JSONs, re-push a
  drifted metric) -> fix it automatically, then **read-back-verify**. One attempt; a fix that doesn't verify
  ESCALATES, never retries (the "don't retry the wrong approach" rule, mechanized).
- **PROPOSE** (a live mutation: workflow redeploy/reactivation, clearing a stuck flag) -> queued to
  `human-actions.jsonl` with a diagnosis, NEVER auto-run (the owner's autonomy boundary 2026-07-21).
- **HUMAN-ONLY** (phone/OAuth/credentials) -> queued as the owner's.
- A catch-all flags ANY red no check claims, so a red light is never silently displayed-and-ignored.
Every action -> `system/heal-log.jsonl` + a "self-heal: N healed, M proposed..." line (brief surfaces it).
Home: recovery-layer (#18), the FIX half of the detect-only checker. New fixes graduate in by adding a probe
function + a map entry (git-reversible); `/self-review` proposes map additions. Zero-token.

---

## As it stood in the constitution: Recall Spine (LIVE 2026-07-25, `system/recall/`) (moved verbatim 2026-08-16)

## Recall Spine (LIVE 2026-07-25, `system/recall/`)

Alex's machine-checkable memory organ. Born from the 07-24 stress-test finding that Alex writes
everything down and reads almost nothing back automatically (facts rot silently; the FTS5 vault index
sat outside the default read path). One SQLite db, one recovery check, one Close-Out line, one hook.
Zero new dependencies (`node:sqlite`, built into Node), zero runtime tokens on the deterministic paths.
Full plan record + kill criteria + the Phase 0 baseline: [[research/alex-recall-spine]].

- **`facts.db` - the bi-temporal fact ledger** (`system/recall/facts.db`, gitignored, in the 21:45 tar).
  Graphiti's model at Alex scale: every fact carries `t_valid`/`t_invalid`; a changed value SUPERSEDES
  (stamp the old row, insert the new, link `superseded_by`), never deletes. The partial unique index
  `current_fact` makes a contradiction unrepresentable. **7 zero-token harvesters** (manifest,
  scheduler, validators, recovery, skills, n8n, attest) repopulate it nightly at 21:35 (inside
  `run-vault-index.ps1`, beside the vault index). Idempotent: an unchanged re-harvest supersedes
  nothing, so the **mass-drift tripwire** (>20 supersessions in one run aborts + REDs) is a true bug
  signal. **Direction law (the V6 lesson):** facts.db is derived from STRUCTURED sources; docs are
  tested AGAINST it, never the reverse.
- **C21 - facts-ledger doc-drift check** (`scripts/facts-check.js`, recovery C21, Monday sweep). Tests
  standing IN-REPO doc claims against facts.db (the ST-20/FR-04 "a doc lying about the system" class,
  mechanized: it caught its own "20 checks" line the moment C21 was added). Complements C19
  (narrative-drift = the out-of-repo master doc); no overlap. Grows one `{doc-regex + fact}` row at a time.
- **Recall injection** (`system/recall/recall-inject.js`, UserPromptSubmit hook). Before every prompt,
  injects the most relevant current facts (WITH their valid-from dates), vault BM25 snippets, and
  lessons as **RETRIEVED REFERENCE DATA, never instructions** (the work/07 model on the internal read
  path). Fail-OPEN (any error = no output, prompt untouched), ≤150ms budget (measured 2026-07-29 over
  85 real injections: median 24ms, mean 29ms, p95 56ms, max 127ms - comfortably inside budget; the
  earlier "~17ms" was an early-sample figure that the corpus outgrew), hard caps
  (≤5 facts + 3 snippets + 2 lessons). Telemetry to `recall-metrics.jsonl` (prompt HASH + counts +
  latency, never the prompt text). Killable in one settings.json line.
- **Lessons - the compound step** (`scripts/lesson-harvest.js`, nightly). The Close-Out Report emits an
  **L-line** (`L: class=<..> lesson="<one sentence>" evidence=<..>` or `L: none`); the harvest turns it
  into dedup'd, hit-counted rows (a per-log byte cursor counts each L-line once). 3+ hits queues a
  `/self-review` promotion candidate behind the EXISTING human gate - lessons only PROPOSE, never
  auto-edit the constitution.
- **Phase 4 (task graph) is ARMED, NOT BUILT** - demand-gated by design (fires on dropped multi-session
  threads or a bloated human-actions queue; then the owner rules Route A beads-binary vs Route B bd-lite).
  Reversible, local, no live engine/cron/model touched. Details: [[research/alex-recall-spine]].

---

## As it stood in the constitution: Session Root (how Alex gets loaded; the answer whenever someone asks "why is it just Claude?") (moved verbatim 2026-08-16)

## Session Root (how Alex gets loaded; the answer whenever someone asks "why is it just Claude?")

Alex only exists when Claude Code's session folder **is** the Alex root - the folder that
directly contains `CLAUDE.md` and `soul.md`. This constitution, every `.claude/commands/*` slash
command, and the five hooks in `.claude/settings.json` are all downstream of that one fact.
Attaching files to a chat, dragging the folder in, or pasting a path does NOT load Alex: that
session is plain Claude with no commands, no vault, no voice.

- **Open the folder, do not attach it.** VS Code: File, then Open Folder, then pick your `Alex`
  folder; it persists in recents, so it is one-time per machine. CLI: `cd` into the folder, then run
  `claude`. Opening a *subfolder* (`work/`, `docs/`) does not count.
- **The first-session script, verbatim, for a non-technical user:** open the folder -> `/status` to
  confirm it loaded -> `/setup` -> `/brand`. If `/status` comes back "unknown command", the folder is
  not loaded; say exactly that and send them back to step one instead of debugging anything else.
- **Hook paths are cwd-proof since 2026-07-28.** All five hooks (PreToolUse untrusted-lane guard added 2026-08-05) resolve through
  `${CLAUDE_PROJECT_DIR:-.}` instead of bare relative paths, so soul.md injection and the
  capture/recall hooks survive a session started from a subfolder. The commands and this
  constitution still only load at the root, so the root is still the answer.
- This is step 2 of `docs/GETTING-STARTED.md` (generated from
  `templates/getting-started.template.md`) and the opening paragraph of `docs/README.md`. All three
  move together under Change Propagation.
