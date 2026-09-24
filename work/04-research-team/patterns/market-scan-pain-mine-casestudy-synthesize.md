---
class: market-scan
created: 2026-07-22
last_used: 2026-07-22
times_used: 1
---
# Market-Scan Pain-Mine + Case-Study + Synthesize (Alex-master sequential relay)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"What do [a market segment] actually struggle with, and where could [X] help?" An EXTERNAL-evidence market scan that must separate real demand from vendor noise, and separate what's already solved from what's still open. Pure-evidence deliverable (no build recommendation) unless the owner asks for the wedge.

## Team (3 sequential senior-researcher lanes, master reviews each handoff)
- **Agent 1 - Demand + Gap miner:** the pain side. Lane A = mine communities/surveys for the specific hated tasks + how they cope + willingness-to-pay proxy + demand signal. Lane B = read the NEGATIVE / 3-star tool reviews (complaints = unmet needs): why they quit, the line right before giving up, what they wish it did automatically. | tools: WebSearch + WebFetch, Chrome fallback for gated sites | output: sourced evidence table + gap list, every row a named source + engagement signal.
- **master gate 1:** kill fabricated demand/pay signals, patch a weak lane at the master level (here: added US survey corroboration when the agent's data skewed to one country), down-weight vendor-marketing-sourced rows to DIRECTIONAL.
- **Agent 2 - Case-study / what-people-automate:** confirm/extend/challenge the demand list with REAL automation case studies (Indie Hackers founder stories are the least-biased; vendor blogs mined for the use-case, labelled biased). Classify each task SATURATED vs STILL-OPEN through the non-technical-owner lens. | output: recurring-task list + solved-vs-open table.
- **master gate 2:** reconcile Agent 2 vs Agent 1; convergence from INDEPENDENT evidence bases = the highest-confidence tier (this is the anti-laundering test passing).
- **Agent 3 - Synthesizer:** reads the working files (baseline + both agents + both gates) and builds ONE findings document around the required table (Task | How often | Current fix | Pain level | Would they pay? | Confidence). Adds no new research. Per-row confidence, unknown stays unknown.
- **master final:** owns the findings in Alex voice, renders MD + branded PDF, pixel-verifies.

## Synthesis approach
Findings first, per-row confidence (HIGH = both agents + a survey; MEDIUM = one lane / vendor-only). "Would they pay?" reads from revealed workaround spend, never invented. Carry the honesty caveats as a "How to read this" block.

## Lessons (run 1, small-business automation pain scan, 2026-07-22)
- **Access reality bit hard:** Reddit hard-blocked (WebFetch refuses it, WebSearch won't resolve site:reddit.com) AND the Chrome fallback was down (extension not connected). The demand side's firsthand emotional texture was the casualty; surveys + review sites + founder stories carried it. Log the gate honestly, patch with reachable corroboration, offer a re-run.
- **Master patch is real work:** when Agent 1's demand data skewed to one country (AU), the master added US survey corroboration at the gate rather than shipping the doubt.
- **The non-technical-owner lens is the sharpest tool:** it flips several "solved" tasks to PARTIAL/OPEN (Calendly reminders behind a paywall, content AI drafts but voice unsolved), and surfaces "the glue" + "keep-alive burden" as tasks in their own right.
- **Render gotcha (not pattern-specific but cost time):** headless Chrome print-to-pdf needs a WINDOWS file path (`pwd -W`), not the Git Bash MSYS `/c/...` path, or it silently emits a 1-page ERR_FILE_NOT_FOUND stub. The pixels rule (rasterize + LOOK) caught it.
