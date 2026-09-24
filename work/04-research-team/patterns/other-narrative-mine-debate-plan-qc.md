---
class: other
created: 2026-07-20
last_used: 2026-07-20
times_used: 1
---
# Narrative-mine, dual-debate, plan, blind-QC

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Read this DOCUMENT (a narrative / story / write-up about a system we own), pull the ideas that would genuinely upgrade the system, ignore the noise, then debate, plan, QC, and hand me a decision + implementation plan." The source is prose to be mined for signal-vs-noise, NOT a system to audit directly (that is other-system-upgrade-audit-design-plan) and NOT a proposed plan to validate (that is technical-evaluation-sequential-plan-validation). The defining trap: a document that mostly DESCRIBES an existing system reads like a wishlist, so a naive miner "extracts" features the system already has. Grounding every idea against the live system is the whole discipline.

## Team
Master-gated sequential relay, single agent per stage, master debates TWICE:
- **Agent 1, miner (senior dev):** reads the doc end to end, extracts only genuine upgrade ideas, culls the rest, gives each survivor deep thought, and GROUNDS each against the live system (does it already exist? cite the file. does it fit the infra?). Returns kept-ideas + a rejected/noise cull (the cull proves it read critically) + a cross-cutting observation.
- **Master Debate 1 (Alex):** reviews the report first-principles, redesigns/merges/adds/kills ideas, writes the ranked shortlist. Alex holds a first-hand, independent read of the doc + key live files so the debate is reasoning, not deference.
- **Agent 2, planner (senior architect):** turns the shortlist into a technical plan against the real files (files touched, edits, tests, effort, risk, up/down sides, better-fit pushback).
- **Master Debate 2 (Alex):** questions the plan hard, reclassifies, rejects over-reach, adds rollout safety, concludes the final plan.
- **Agent 3, blind QC:** cold context (never saw the reasoning), re-verifies every technical claim against the code, returns PASS / PASS-WITH-FIXES / FAIL + a ranked fix list. Master applies fixes.

## Synthesis approach
The master alone writes both conclusions (Debate 1 shortlist, Debate 2 final plan); agents report, they never conclude (anti-laundering). Every kept idea rides the doc text or a live-system file, never agent agreement. The blind QC is the terminal gate: its separate context is what makes it a real check and not self-grading. Deliverable is a decision + implementation plan (MD + branded PDF), recommendation-only unless the commission says build. The master reads the source + the load-bearing files before each debate, so the master's gates catch what a single agent misses.

## Lessons
- **Run 34 (Alex story-upgrade review):** the source (`Alex-The-Story-EN.md`) was a retelling of the system's own audit, so ~90% of it described existing machinery. Agent 1's live-grounding correctly culled it; the 5 survivors were all one shape, "finish an existing find-out intention into a mechanism that fires." The master's independent read added an idea Agent 1 missed (a numbers-drift check on the identity docs) and killed one Agent 2 kept (an orchestrator refactor that would regress observability + retry). The blind QC (PASS-WITH-FIXES) independently confirmed a live doc contradiction the plan relied on and corrected two facts (a wrapper count, a not-yet-exported function's shape), which self-grading would have missed. Grounding the master personally in the two most load-bearing files (close-out.ps1, vault_search.py) before Debate 2 made the questioning real. Plan-only by the commission, so no identity-doc surfaces moved.
