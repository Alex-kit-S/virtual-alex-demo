---
class: decision-brief
created: 2026-07-05
last_used: 2026-07-05
times_used: 1
---
# Venture Ideation -> Validate (4-loop)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Given everything this system/person can do, what are the best N near-future business ideas, and are they real?" Ends in a designed deliverable (briefing slides + a detailed plan). The user wants divergent ideation, a hard cut, real validation, and a QC gate before ship.

## Team (4 sequential loops; the session synthesizes + builds between them)
- **Loop 1 Ideate (1 agent):** brainstorm WIDE (10-14 diverse candidates), each grounded in the system's real capabilities + the owner's real situation (reuse prior dossiers if they exist). Do not narrow. Flag the strongest few. | output: candidate cards (concept, what the system does, buyer, edge, revenue, first-dollar, buildability, risk).
- **Loop 2 Identify (1 agent):** score all candidates on a weighted rubric (weight time-to-first-dollar + buildability-today x2 when runway is the constraint), rank, cut to exactly N. Pick complementary winners, not N flavors of one thing. Sanity-check no winner needs a capability the system lacks. | output: scoring table + N winner specs + defended cuts.
- **Loop 3 Validate (1 agent):** pressure-test each winner into a build-ready plan with light web search (competitors, pricing reality). Per idea: verdict (GO / GO-WITH-CONDITIONS / RECONSIDER), offer/tiers, pricing (EST, market-anchored), market+named competitors, unit economics, riskiest assumption + a cheap 30-day test, first-90-days, kill criterion. Plus fit-together + a cross-cutting reality check with the skeptic headline + rebuttal. | output: validated plans.
- **Loop 4 Output QC (1 agent):** BEFORE ship, read the rendered deliverables (slide PNGs + the PDF via the Read tool) against the validated source. Check fact fidelity (every number matches across all surfaces), completeness, honesty (verdicts/conditions not sanded off), brand/design, and altitude. | output: SHIP / SHIP-WITH-FIXES verdict + ranked fix list tagged [SLIDE]/[PDF] + [FACT]/[BRAND]/[COPY].

## Synthesis approach
Session writes the candidate synthesis, applies the cut, builds the deliverables (briefing slides in the deck's dark brand; a detailed plan as a light branded PDF per the brand PDF spec), then applies Loop-4 fixes. Brand pre-flight before any generation. Keep LOGGED vs ESTIMATE tags on every number end to end; the QC loop's job is partly to confirm no tag got stripped.

## Lessons (run 12, 2026-07-05 - three businesses out of Alex)
- Weighting time-to-first-dollar + buildability x2 (runway constraint) cleanly separated a 3-flavors-of-freelancing pile into a land/expand/leverage trio.
- The validate loop's web search found the load-bearing wedge (Microsoft's own Power BI Copilot fails on messy models -> someone fixes the model), which reframed the biggest objection into the demand engine. Give the validate lane web search.
- The output-QC loop returned SHIP with only nice-to-haves because the LOGGED/ESTIMATE discipline was carried from the source into both artifacts. QC caught two real accuracy nuances (a hero number that hid the first-dollar wedge; a run-cost figure worded as a build cost). Worth the loop.
- Two aesthetics per run: briefing slides stay in the deck's dark brand; the deep plan is a light branded PDF (brand PDF spec: dark-teal header bar + logo, teal headings, custard callouts). Do not force one on the other.
