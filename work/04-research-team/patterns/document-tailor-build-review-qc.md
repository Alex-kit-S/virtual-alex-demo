---
class: other
created: 2026-07-07
last_used: 2026-07-07
times_used: 1
---
# Document tailor: build -> domain-expert review -> QC

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Take my real source document (CV, profile, proposal) and restructure it for a specific audience brief (a recruiter's shopping list, a client's requirements), branded, with a hard no-invention rule." The brief drives the structure; the source document is the only permitted fact base (plus explicitly sanctioned additions from the owner).

## Team
- **Agent 1 Build:** restructure + draft against the brief; produce the artifact (self-contained HTML -> headless Chrome `--print-to-pdf`), self-verify the render (page count, clipping, keyword placement) before reporting. | tools: general-purpose, Write/Bash/Chrome | output: artifact paths + restructure map + judgment calls. Same agent takes the revision relay (SendMessage) after review.
- **Agent 2 Domain-expert reviewer:** the audience's seat (senior HR recruiter hiring for THIS role): 6-second skim, then 2-minute read; MUST-FIX vs NICE-TO-HAVE, each WHAT/WHERE/HOW, achievable from source material only; also verify ATS/parser text-layer extraction. | tools: general-purpose, Read | output: ordered feedback + "do not break" list.
- **Agent 3 QC + final judgment:** confirm every reviewer item addressed (re-verify item 5-style claims YOURSELF), then the client checklist item by item (prominence, headline, traceability of every number/name, sanctioned-addition accuracy, brand, layout), verdict READY or exact fix list. | tools: general-purpose, Read/Bash | output: PASS/FAIL table + verdict.

## Synthesis approach
Orchestrator runs the Brand + Soul pre-flight, pastes exact brand tokens + the FULL VERBATIM source into every prompt, validates Agent 2's feedback before relaying (strike false positives), relays revisions to Agent 1 via SendMessage (keeps roles clean), ships only on Agent 3 READY, then runs the advisory close-out grader.

## Lessons
- **Give reviewers the verbatim source, never a compressed excerpt.** Run 1: the session compressed the Menigo line in Agent 2's briefing; Agent 2 flagged the draft's (correct, source-true) line as an invention. Orchestrator caught it and voided the fix before relaying.
- Agent 2's ATS extraction check earned its slot: `position:relative` bullet markers made Chrome paint all bullet text AFTER flow text in the PDF content stream (chips/bullets detached from headers for any parser). Fix: normal-flow inline-block markers + text-indent hanging indent; DOM order = visual order = paint order.
- Real overclaim caught in review (a years-of-experience figure longer than the platform it described had existed): reattach the years to what the source supports, keep the emphasis word first in the sentence.
- Glossing real named systems with their category ("<product> (ERP)", "<product> (financial planning)") is a permitted clarification for non-technical screeners, not an invention.
- Spelling hedge for ATS: keep the brief's variant (modelling) in the headline zone, the source's variant (modeling) in Skills, so both live in the text layer.
