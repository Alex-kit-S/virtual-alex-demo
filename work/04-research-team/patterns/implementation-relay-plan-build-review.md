---
class: other
created: 2026-07-06
last_used: 2026-07-06
times_used: 1
---
# implementation-relay-plan-build-review

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Here is a batch of feedback/changes for a system we own - implement all of it." Not a research question: the deliverable is shipped, verified change. Fits any multi-item refinement round (dashboard feedback, spec revisions, batch fixes) where every change must be grounded in real system values, not invented ones.

## Team
- **Agent 1 - Research & Processing**: map every feedback item to the actual code/tile/file (including garbled voice-transcription names, interpretation stated per item); pull the REAL values each change needs (live APIs, vault, Notion); pick the data channel per item; write a per-item plan + sequencing + reference-data appendix to a shared scratchpad file. Implements nothing. | tools: read/grep/glob, curl to live APIs, Notion MCP | output: plan file + summary
- **Agent 2 - Implementation**: execute the plan phase by phase (helpers -> data plumbing + seeds -> one frontend pass -> ONE deploy -> QA renders -> doc propagation). Gets the brand pre-flight tokens PASTED into its prompt by the orchestrator (delegation rule). CHECKPOINT DISCIPLINE: append to its own report file after every phase so a session cut never loses state; on resume, read own report, continue from last checkpoint. | tools: all | output: report file + Close-Out
- **Agent 3 - Review & Validation**: independent audit, never trusts Agent 2's word: re-read touched files, curl the live surface, take FRESH renders (including overlays the implementer never shot), grep for leaked secrets, verify doc propagation, classify findings BLOCKER/MINOR/NIT, verdict SIGNED OFF / NOT. Read-only. | tools: read/grep/curl/screenshot scripts | output: review file + verdict

## Synthesis approach
Strictly sequential (each agent consumes the previous one's file). The orchestrator runs the brand + soul pre-flight BEFORE dispatching Agent 2, relays findings between stages, and only closes when Agent 3 signs off; BLOCKERs go back to Agent 2 via SendMessage (context intact), never a fresh spawn.

## Lessons
- 2026-07-06 (Alex HQ v2.1, 18 items): session limit killed Agent 1 BEFORE it wrote its plan; SendMessage resume recovered all 45 tool-calls of context for one write. Consequence: every agent's prompt now carries write-first/checkpoint discipline from the start.
- Real-value grounding caught real errors: the planner's guess at where a recurring schedule stood was wrong; the implementer's ordered source-check (the owner's own tracking sheet first) found the date the cycle had restarted. Planner contradictions must be flagged as data-gaps with a source order, and the implementer must actually walk that order.
- Reviewer earned its seat: 3 MINOR findings (glance tiles show metric status not project worst-status; failed-sync states keep a green dot; missing as-of line) that neither builder saw.
