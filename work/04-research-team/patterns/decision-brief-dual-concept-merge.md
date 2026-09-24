---
class: decision-brief
created: 2026-07-20
last_used: 2026-07-20
times_used: 1
---
# Dual-Concept Validate + Merge

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Here are TWO external concept docs. Validate each against our real system, then conclude ONE new function that is the validated merge of both." Two independent source docs (not one), each needing its own evidence-anchored validation before they can be reconciled. Distinct from `decision-brief-concept-validation` (one doc, 3 internal lanes) because the parallelism is per-DOCUMENT and the payload is a MERGE, not a single verdict.

## Team
- **Agent 1 (Senior AI architect), doc A:** validate the load-bearing claims via web (LOGGED-FACT / ESTIMATE / UNVERIFIABLE), map every claim to what the system ACTUALLY has (cite real files), name the ONE genuine gap and try to REFUTE it against existing projects, up/down, new ideas, a reuse-first plan with Hcases. Writes a full report to scratch + returns a tight summary. | tools: Read, Grep, WebSearch, WebFetch | output: validation + infra-map + gap(confirmed/refuted) + reuse plan.
- **Agent 2 (Senior AI architect), doc B:** identical treatment on the second doc. **Runs PARALLEL to Agent 1** (independent).
- **Master (Alex) debate, each in turn:** source-verify the load-bearing claim personally (re-grep, re-read the cited file), sharpen what the agent left generic, promote/demote the justification, name the honest case AGAINST building anything, conclude on each before handing forward.
- **Agent 3 (Senior AI architect), merge:** read both validated reports + the master's binding ruling; design ONE function; write the detailed technical plan (function-in-a-paragraph, why-good, exact file map new-vs-touched, walkthroughs, phased roadmap, consolidated Hcases, honest up/down + kill signals, first-fire). Writes full plan to scratch + returns a summary.
- **Master final gate:** debate whether the merge is genuinely best, correct what's weak (scope, build-order, over-reach), deliver.

## Synthesis approach
Master holds its own baseline BEFORE the agents report (enables convergence detection vs echo). The merge is only honest if the two concepts share a real spine (here: the `*.jsonl`-sibling idiom + an optional action->artifact link + a shared "layer" in the owner's mental model) - otherwise conclude "two thin layers, don't force one." Hard constraint handed to Agent 3: **ship-independently, compose-optionally** (each component works alone; the link is optional value-add), which is the direct antidote to the "build everything at once" failure mode both concept docs tend to invite.

## Lessons
- Give each validator the REAL ground-truth files (manifest, identity, the specific work/NN specs), never a master summary - the gap tests must run against actual file contents + a repo grep, or they're guesses.
- Master must source-verify the load-bearing grep/claim itself between hand-offs (run 33: re-grepped the "empty middle rung" claim + re-read #26 to confirm before trusting it).
- The final gate's biggest catch on run 33 was SCOPE: Agent 3 listed build-time propagation surfaces (plain-English guide, identity.md, T03 redraw) as THIS run's close-out. A research run delivers a PLAN; those surfaces belong to the eventual build (runs 24/27/28 precedent). Correct that or you propagate a capability that doesn't exist yet.
- Sequence merged components by conviction, don't present co-equal (run 33: Outcome Ledger first = confirmed gap + priority #1; Reusable Workflows second = product bet).
- Run 33 (this file's birth): the Compounding Layer (Outcome Ledger + Reusable Workflows) from the multi-agent + no-code concept docs. Verdict BUILD, B-first.
