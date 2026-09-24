---
class: other
created: 2026-07-18
last_used: 2026-07-18
times_used: 1
---
# Evidence upgrade pass (parallel scouts + master debate)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Here is a finished plan/design we already believe in - sweep the live web (named sources: Reddit, GitHub, ...) for the most recent + creative improvements, debate them against the original, conclude the upgraded version." Distinct from a fresh research run (there is a v1 on trial) and from Adversarial Verification (not one claim - a whole plan, and the goal is UPGRADE, not verdict-only).

## Team
- Master (Alex): holds v1 FULLY in context (ideally wrote/assembled it), so no agent re-derives it; dispatches scouts in PARALLEL; runs the debate personally with the scouts' citations as the refutation anchor (legitimate because dissent rides external evidence, not the master's own reasoning - the anti-consensus-laundering test).
- Scout per source-domain (general-purpose + web), 2-3 max: each gets (a) the v1 file to read, (b) named research lanes, (c) an explicit CHALLENGE lane ("hunt evidence that CONTRADICTS the plan's load-bearing bets - disconfirming is worth MORE than confirming"), (d) evidence-strength labeling (strong/moderate/anecdotal, N=1 vs N=many), (e) a top-10 ranked candidates section, (f) timebox + empty-lanes honesty.

## Synthesis approach
Master debates finding-by-finding: FELL / AMENDED / CONFIRMED per v1 element, every verdict citing the scout's source. v2 is written SELF-CONTAINED (strategy + technical plan readable standalone), with a verdict table as the audit trail, a "what did NOT change" section, and the assumptions register updated. v1 stays on disk as the audit trail; v2 declares "supersedes v1 for build decisions".

## Lessons
- Run 30: fetch-blocks are lane facts, not failures - Reddit was blocked, the scout rerouted via an archive and LABELED the evidence age (late-2024->mid-2025); the label goes in the v2 header, not a footnote.
- CONFIRMED verdicts earned under a real kill attempt are deliverables too (Postiz reach-safety via a controlled 2025 test ended a standing doubt).
- Check ground truth immediately before shipping v2: a parallel session had independently hit one scout finding (Postiz topology) AND the owner had already decided the response (8 GB box) - v2 had to state the decision, not re-offer the menu.
- The verify-by-pixels rule caught a silent PDF failure (file:/// URL malformed -> Chrome printed its error page; "N bytes written" looked like success). Page-count + LOOK at the render, always.
