---
class: other
created: 2026-06-11
last_used: 2026-06-11
times_used: 1
---
# Science Explainer (two-lane decomposition)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
A "how/why does X work" question grounded in a real scientific literature, where the ask splits into 2 independent sub-questions that don't depend on each other's findings. Good for biology, physiology, neuroscience, materials - anything where the answer is "what does the evidence actually say" and folklore needs separating from fact. Example: "how does a horse feel touch, and why is each side processed separately?"

## Team
- Lane A agent (general-purpose): owns sub-question 1. Mission framed as plain-language-for-an-expert. Tools: WebSearch + WebFetch. Output: findings by sub-point, key insights, sources with URLs, explicit unknowns.
- Lane B agent (general-purpose): owns sub-question 2, independent of A. Same tooling and output contract.
- Synthesizer (main session): merges both, leads with the bottom line, separates solid science from folklore, keeps unknowns unknown, Alex voice.

## Synthesis approach
Lead with the single most load-bearing fact per half. Actively call out myths the literature refutes (high value - the reader has heard the folklore). Mark population-tendency vs law. End with one memorable one-liner. Persist to vault/research/ + Notion, branded deliverable only if the user wants one (small/personal-curiosity asks can stop at the vault page).

## Lessons
- Both lanes returned in ~2 to 3 min, ~41k tokens each. Two parallel agents was right; a single merged agent would have thinned the science.
- The myth-vs-fact distinction was the most valuable output. Brief future explainer agents explicitly to separate "solid science / oversimplification / rider folklore."
- Instructing each agent to mark unsourced claims "not well established" worked - got honest caveats (Baragli 2021 counter-evidence, secondhand MRI citation) instead of false confidence.
