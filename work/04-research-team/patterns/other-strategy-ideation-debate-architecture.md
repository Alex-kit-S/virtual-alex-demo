---
class: other
created: 2026-07-18
last_used: 2026-07-18
times_used: 1
---
# Strategy ideation -> adversarial debate -> architecture (master-gated)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Design a completely NEW strategy/plan for a real project of ours, challenge it hard, then hand me a buildable technical design." Distinct from plan-validation (run 28: plans already existed) and from upgrade-audit (run 24: audit of what exists): here Agent 1 CREATES, Agent 2 debates + adds its own ideas, Agent 3 architects. The owner pre-specifies the chain; the /prompting gap round settles scope (what's challengeable) + deliverable.

## Team
- Master (Alex): writes the baseline brief from the vault pages FIRST (facts only, no strategy) - the shared ground truth every agent receives; gates every hand-off with a written review file; the gate reviews carry MANDATORY challenges forward (they are tasking documents, not just commentary).
- Agent 1 (domain strategist, general-purpose + web): evidence-anchored NEW strategy; out-of-the-box mandate explicit; self-review section required (its self-named weaknesses seed the master's challenge list).
- Agent 2 (adversarial debater, general-purpose + web): #04 Adversarial Verification discipline at plan scope - HOLDS/FALLS/AMENDED per element, every attack anchored in external evidence/live loads/recomputation, no manufactured dissent; PLUS a constructive half (its own new ideas) and the converged refined plan (written to be architected from directly).
- Agent 3 (senior AI architect, general-purpose): technical design ONLY (no builds); binds the master's architecture notes; MANDATORY n8n skills read; outputs a ready-to-build registration pack + phased plan where Phase 0 has zero blocked-dependency.

## Synthesis approach
Master concatenates the chain in order (baseline -> A1 -> gate 1 -> A2 -> gate 2 -> A3) under a final master synthesis: verdict, the plan in one paragraph, the audit trail of what the chain CHANGED (the disagreement record is the value), master corrections to the architecture, the owner decision batch, and the carried-assumptions register.

## Lessons
- The debate corrected BOTH directions in one pass: refuted the master's stale background fact (a platform it believed "dead") while still killing the strategist's use of it on better evidence (ghost URL + ToS). Gate reviews should state the master's own uncertain beliefs as challenges - being refuted is the mechanism working.
- The highest-value finding was LEGAL, not strategic (platform ToS prohibit scraping): instruct debaters to check the ToS of any platform an agent-loop touches, not just market facts.
- Making Agent 1 self-review adversarially gave the master a free head start on gate 1; keep the requirement.
- Architect inherits the debate's weakest point unless told otherwise - require it to name where it BUILT ON an unverified assumption (here: alert cadence) and wire the measurement into Phase 0/week 1.
