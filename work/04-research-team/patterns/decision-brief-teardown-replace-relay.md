---
class: decision-brief
created: 2026-08-03
last_used: 2026-08-03
times_used: 1
---
# decision-brief-teardown-replace-relay

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Wipe this existing project/system whole and replace it from an external spec, give me the safe, executable plan." The wipe/replace decision is made up front (owner's call, gap round); the relay decides HOW, never whether. Plan-only, read-only run.

## Team
- **Pre-relay survey** (Explore agent): demolition survey of every file/surface/external-state the target touches, risk-tiered (git-recoverable / shared-surface-edit-only / local-only-unrecoverable / external-live / out-of-repo). Saved as a deliverable; becomes Agent 1's input map.
- **Agent 1, infra reviewer** (senior dev, cold context): verify the survey on disk (spot-checks → CONFIRMED/CORRECTED, plus an independent gap pass), then per-file disposition {archive/delete/edit/migrate/keep + replacement} + ordering constraints + honest UNVERIFIEDs | tools: repo + live read-only | output: disposition report → master debate 1 → concluded dispositions.
- **Agent 2, plan reviewer** (senior dev, cold): the external spec vs Report 1: adoption case steelmanned, the hardest call argued BOTH ways, amendments numbered, spec security holes named; external docs verified where load-bearing | output: adopt/amend report → master debate 2 → the amended plan (frozen-scope changes FLAGGED for the owner, never silently ruled).
- **Agent 3, QC + implementer** (senior dev, cold): adversarial pass over both reports (contradictions between them, validator/checker traps, hard cases worked with mitigations), then the ordered teardown phases + build phases with exact registry mechanics and rollback per phase | output: implementation draft → master final: the deliverable md (per-file table, archive manifest, external-state list, condensed debate record, owner items, claims table).

## Synthesis approach
Master debates EVERY handoff with evidence (file:line or a live check); same-model agreement is never corroboration. Later rulings explicitly kill stale earlier-report text (an executor reading Report 1 alone must not plan work Report 2 dissolved; QC names those). If the verification classifier was unavailable for any agent, the master re-reads that agent's sharpest code claims personally before folding them in.

## Lessons
- First use (retiring one project whole and giving its number to a new one, 2026-08-03): the validator/checker couplings ARE the plan's skeleton: V2(b) forced disable-then-delete task ordering, C3/C4 forced physical-dir removal + a `status_md: null` tombstone, and the nightly 21:30 backup commit is an ACTOR in the teardown timeline, not background. The next scheduled fire of the thing being killed sets the real clock. Survey-first made Agent 1 a verifier instead of a mapper: cheaper, and its corrections (2) + additions (2, incl. the out-of-repo identity docs) were sharper for it.
