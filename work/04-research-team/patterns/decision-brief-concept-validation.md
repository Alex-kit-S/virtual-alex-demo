---
class: decision-brief
created: 2026-07-01
last_used: 2026-07-02
times_used: 4
---
# Concept / Spec Validation

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Validate this idea / spec / plan, give me up/downside, is it worth building." A drafted proposal (often the owner's own) that needs a go/no-go, not open-ended exploration. The trap: re-running the synthesizer's own opinion louder. The fix: the team verifies only the empirical claims the decision hangs on, not the whole doc.

## Team
Isolate the 2-4 load-bearing claims that the author asserted but did NOT verify, then one lane each. For a "build X automation" spec the recurring three:
- **Cost/viability lane** (general-purpose + web): real dollar cost, legal/ToS/ban risk, and the cheapest reliable alternative stack for the "muscle." | tools: WebSearch, WebFetch | output: dollar range + viability verdict + cheaper path.
- **Prior-art/sellability lane** (Explore or general-purpose + web): who already ships this, is it a crowded space or a real gap, WTP signal. | output: landscape table + novelty verdict + personal-tool-vs-product verdict.
- **Core-mechanism lane** (general-purpose + web): does the compounding/learning/"it gets smarter" claim survive known ML/stats reality (cold-start, overfitting, feedback loops, selection bias, pseudoreplication)? | output: real-vs-wishful verdict + named failure modes + cheap mitigations.
Each lane timeboxed; "nothing found" is a finding. Main session synthesizes into up/downside + a concrete "what I'd build instead."

## Synthesis approach
Lead with the verdict. Explicitly CORRECT any first-pass claim the evidence overturned (honesty over consistency - e.g. here Bright Data turned out cheap, not "expensive/fragile"). Then per-lane findings, then a clean upside/downside split, then a numbered "what I'd build." File to vault/research + Notion, then offer branded deck/PDF.

## Lessons
- The highest-value move was verifying the synthesizer's OWN prior assertions, not researching the topic broadly. One lane flipped a cost claim I'd have shipped wrong.
- Cost lanes: get the pricing BASIS (per-record / per-seat / per-GB), not just a number, so the estimate is defensible and volume-scalable.
- Core-mechanism lane pays off most on "it learns / it compounds / it gets smarter" claims - those are almost always cold-start/feedback-loop traps with cheap known fixes. Always ask for the mitigations, not just the verdict.
- Prior-art lane: separate "news/digest" clones (saturated, unsellable) from the actual differentiator axis (here: personalization). The gap is usually one axis, not the whole idea.
- Reuse 2 (2026-07-01, Alex AI Radar auto deep-dive on n8n native MCP): extended the pattern with a **phased "Build in steps" section** and a technical-reality lane (does it work on the owner's self-host, which version, GA/beta, own-servers-or-not). Auto-mode skipped the interactive team-approval gate (score-threshold + rate-cap were the control). The fit/sellable lane again did the most work: it flipped "differentiator" to "table stakes" and reframed the sell from the tech to the outcome. Standing move for tool concepts: always run one "does it actually work on MY box" lane, it changes the build plan.
- Reuse 4 (2026-07-02, radar deep-dive on the MCP spec v2 RC): lanes run INLINE (no sub-agents) since the greenlight came in-session and the synthesizer already held run context; same evidence, cheaper. The "MY box" lane again flipped the story, and the cheapest instrument won: one tokenless read-only curl probe (404 vs 403 diff) overturned a written friction-list claim that four web lanes couldn't settle. Standing move: when a claim is about the owner's own infrastructure, probe the infrastructure (read-only), don't just read about it. Also: for spec/protocol items the phased plan is tripwires + watch triggers, not build steps; forcing a build plan onto a watch item would have been padding.
