---
class: other
created: 2026-07-05
last_used: 2026-07-05
times_used: 1
---
# Pitch Build - Adversarial 3-Loop

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Turn my own system (or a project) into an external-facing persuasion artifact for a specific audience (C-suite, investor, recruiter): explain what it is, how it was built, why it exists, what it costs, why they should care." The deliverable IS a designed deck, not a memo. The user asks for iteration/loops and a quality bar.

## Team
Runs as three sequential loops; the main session synthesizes between them (agents report, the session concludes and builds).
- **Loop 1 (parallel):** two research agents mine the source of truth.
  - Infra/Architecture analyst: what it is, capabilities, how built, the logic, limits. | tools: Read/Glob/Grep | output: sourced dossier, LOGGED vs unknown.
  - Cost/Value analyst: hard costs, cost-control design, ROI, the per-seat/per-audience business case, risks. | tools: Read/Grep | output: sourced dossier, LOGGED vs ESTIMATE separated every time.
- **Loop 2 (one agent):** QA / outside-perspective reviewer. Reads the synthesized outline + both dossiers, gap-checks from the target audience's skeptical seat: coverage vs the mandate, fact integrity (recompute every number), the hardest objections not yet answered, narrative/persuasion, and which numbers to animate. Returns a ranked fix list. Does NOT rewrite.
- **Loop 3 (one agent):** the Judge. Role-plays the actual decision-maker. READS THE RENDERED SLIDES (pass the slide PNG paths) plus the narrative. Scores conviction/clarity/credibility/design-craft/audience-fit, gives a FUND / FUND-WITH-CHANGES / DO-NOT-FUND verdict + a short ranked final punch-list separating DESIGN from CONTENT fixes, plus a "do not change" list.

## Synthesis approach
Main session writes the master narrative + slide outline after Loop 1, applies Loop 2 fixes before building, builds the deck, renders it, then applies Loop 3 fixes. Resolve agent disagreements with objective checks (e.g. recompute contested arithmetic; show a number with its components so it is unimpeachable rather than picking a side). Brand pre-flight gate runs before any generation. Deliverable branded to the ALEX brand (color-system.md).

## Lessons (run 11, 2026-07-05 - Alex to a C-suite)
- The QA loop earns its cost: caught a real arithmetic error, an overclaim (feature designed but not live), a wrong count, a buried hook, a missing competitor comparison, a weak close. All would have shipped.
- Have the Judge read the actual rendered PNGs, not the narrative. It caught brand violations (red used decoratively on the limits slide; red = alarm only) and a render artifact the outline could never show.
- When two review loops disagree on a fact, do the arithmetic yourself and make the slide self-verifying (show $1.38 + $2.82 next to ~$4.20), rather than trusting either agent's read of the source.
- Tag LOGGED / MODEL / ESTIMATE visibly on any animated stat wall, or a counted-up estimate reads as a measured fact.
- Honesty (cost gaps, single-machine, not-all-live) scored as the deck's biggest trust asset with an exec. Do not sand it off.
- For an animated HTML deck deliverable, see the render-to-PDF/PPTX recipe in [[research/alex-c-level-briefing]].
