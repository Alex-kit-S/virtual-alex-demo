---
class: other
created: 2026-07-12
last_used: 2026-07-12
times_used: 1
---
# System Upgrade: Audit -> Design -> QC/Plan (master-gated relay)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Upgrade my whole owned system (or a big slice of it): review everything, design the upgrade, give me a quality-checked implementation plan." Evidence is INTERNAL (the system itself) plus already-harvested landscape files; the deliverable is a plan, not a change (recommendation-only run, execution separately approved). the owner hand-specified the choreography (2026-07-12); same master-gated family as decision-brief-inventory-architect-debate, but the middle agent designs an upgrade instead of debating options, and the end agent QCs + writes the phased plan instead of eliminating.

## Team
- Agent 1, Senior AI Engineer (audit): executed as N parallel read-only Explore lanes (here 5: projects split in two, system layer, design surfaces, output quality), each timeboxed, flags-only with per-lane ID prefixes (a*, b*, c*, d*, e*); the MASTER consolidates into one corrected audit report. | tools: read-only repo | output: current-state map, up/downsides, numbered flags, cross-cutting patterns (P*)
- Master review 1: verify lane claims against ground truth (registry, git history, live greps) BEFORE consolidating; dismiss/reverse/correct with cited evidence (9 corrections in run 24, including two lanes contradicting each other and two false positives killed by a single grep).
- Agent 2, Senior AI Architect (upgrade design, general-purpose): corrected audit + landscape evidence in; design against the cross-cutting patterns, per-project keep/upgrade/retire for EVERY project, concrete UX redesign, explicit "what NOT to do" rejection list, [OWNER DECIDES] flags on anything touching standing orders. No sequencing. | output: 02-upgrade-design.md
- Master review 2: standing-order compliance sweep (privacy scrub caught real leaks: personal data in proposed git-tracked files); BINDING annotations (MR2-*) appended to the design doc itself.
- Agent 3, Senior AI Engineer/Architect (QC + plan, general-purpose): spot-VERIFIES design assumptions against real code (SV*), verdicts SHIP/SHIP-WITH-FIX/REJECT per item, missed-flags sweep, over-engineering check; then the phased plan (dependencies, per-phase files/verification/rollback/quality bar, routing calls, risk register, deadline opportunism). | output: 03-implementation-plan.md
- Master review 3 + synthesis: full-coverage check (every audit flag planned/dispositioned/rejected), accept, write 04-master-synthesis.md (the owner-readable layer: verdict, confidence, unknowns, decision batch, same-model caveat).

## Synthesis approach
Four working docs, written to disk the moment each exists (write-first): 01 audit, 02 design (+MR2 annotations), 03 QC/plan (+MR3 acceptance), 04 synthesis. The synthesis leads with the verdict and the owner's decision batch; the caveat (same model reviewing itself = structured self-review, not independent validation) is stated up front. Flag IDs are the shared vocabulary across all four docs.

## Lessons
- Run 24 (the full Alex upgrade): worked first pass. The load-bearing master moves: (1) verifying lane contradictions with cheap greps before consolidation killed 2 false-positive MED flags and reversed one drift direction (the manifest was right, the prose was stale); (2) the privacy-scrub check in review 2 caught the design putting people names + Notion content into git-tracked files; (3) Agent 3's code-level spot-verifications (SV1-SV10) corrected the design's coupling map (cadence_days had ZERO code consumers) and found the one genuinely missed MED flag (c7). Give Agent 3 explicit license to correct Agent 2's assumptions against real code, and require the missed-flags sweep by ID register.
- Lane raw reports go to the scratchpad as they arrive (context-summarization insurance); the consolidated audit carries the condensed truth.
- Deliverable format was decided in the /prompting gap round (markdown working docs, no deck) - right call for a plan that will be executed; a deck would have been ceremony.
