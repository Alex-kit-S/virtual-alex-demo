---
class: other
created: 2026-07-13
last_used: 2026-07-25
times_used: 2
---
# Design review, dual independent lenses + adversarial debate

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Review this UI/page/artifact in detail through multiple specialist lenses and give me a dev-ready
improvement plan." Owner dictates the choreography (Alex master + specialist agents + a debate that
concludes). Fits any shipped visual surface with a stated design goal to judge against.

## Team
- Agent 1 senior UX designer: detailed review of the RENDERED artifact (IA, hierarchy, glanceability vs the
  stated goal, interaction, mobile ergonomics, states, a11y) | tools: Read (screenshots + source), the
  target's spec | output: prioritized findings, each Problem -> Change -> Why + severity, plus a
  do-not-break list and open questions.
- Agent 2 senior UI designer: INDEPENDENT visual pass (never sees Agent 1) - brand adherence vs the law
  files, contrast with computed ratios, type system, spacing/grid, component states, motion | same output
  shape.
- Agent 3 debate agent: steelman then attack every finding from both reviews + the master's curation notes;
  resolve cross-lens conflicts with reasoning; kill/defer/merge; output a single ranked change set with
  effort, sequencing waves, and a QA gate per item. Proposes only.

## Synthesis approach
Master (Alex) between every hand-off: screenshot the LIVE page first (1440 + mobile + a drill-down; puppeteer
viewport emulation, basic-auth via page.authenticate) and READ the PNGs; spot-verify each review's
highest-stakes claims in source BEFORE the debate and pass them to the debate as facts; write curation notes
(keep / keep-with-reservations / weak + carry-ins); give the debate binding ground rules - settled owner
decisions, the honesty law (no fabricated correlation), the brand law file as color tiebreaker, honest
pricing of producer-side changes. Master owns the final verdict and writes the plan; owner-visible decisions
(law-file amendments, convention changes) get a dedicated block at the top of the plan.

## Lessons
- Independence between the lens passes is the value: run 25 got 4 convergent findings (stale values rendered
  bright, raw slugs, reduced-motion holes, numeral formatting) that neither prompt hinted at - instant
  highest-confidence tier.
- Reviews of a UI must see the rendered page; both agents pixel-grounded claims (a face-wash measured by
  pixel sampling, a fold measured in viewports) that source reading alone would have missed.
- The debate WILL ship tidy fabrications unless the honesty law is an explicit binding rule; it killed
  client-side incident-correlation and an invented "likely 1 incident" stat on that rule alone.
- Give the debate the convergence table and the mechanism forks by name; run 25's two forks (dim vs "?" for
  stale values; remove vs enrich a dead-end overlay) both resolved cleanly because they were posed as forks.
- Sequence structure before polish in the concluded set (fold rebuild + alarm-skin fix unlock and re-tune
  the cosmetic items) or the plan polishes surfaces twice.
- (run 37) Mandate the debate to RECOMPUTE contested measurements, not just weigh arguments: it flipped two
  fix shapes (a proposed 24px Rusty count still failed contrast; an "all-time" label was wrong for a stock
  metric) and found bug sites a finding under-counted (duplicate raw aria-labels). Verification license in
  the debate prompt is what made the concluded set dev-ready without a re-round.
- (run 37) Puppeteer gotcha: the HQ header ALSO carries `.tile`; drill-down clicks must target `button.tile`
  or the click lands on a HEADER element and no dialog opens (first overlay shots came back overlay-less).
- (run 37) On a REPEAT review of the same surface, feed the prior round's shipped waves + owner decisions in
  as BINDING precedent and demand a strong stated reason to reverse one: zero re-proposals of shipped work
  survived to the debate, and both lanes spent their effort on genuinely new ground.
