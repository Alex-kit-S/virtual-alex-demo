---
class: other
created: 2026-07-10
last_used: 2026-07-29
times_used: 2
---
# Deck rebuild: content -> design -> QC relay

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Rebuild this existing deck per my page-by-page feedback: keep the approved visual language, replace most copy, keep/adapt/new per graphic, fix readability, deliver in N formats." An implementation relay (document-tailor family), not research: the spec is law, the master maps it to sources and gates every handoff.

## Team
- Senior Presentation Builder (content): reviews every word, applies the per-page spec, polishes for punch while preserving meaning, drafts the few lines the spec delegates | tools: Read/Write | output: a per-page copy doc (kicker, headline with accent phrase marked, ordered body lines, EXACT diagram label strings, keep/adapt/new note per graphic)
- Senior UX Designer: builds the deliverable (here: single-file React HTML, animated canvas background, static render mode `?slide=N&static=1`), places copy verbatim, builds new diagrams in the deck's idiom, bumps type 1-2 steps, renders EVERY slide and self-reviews the PNGs | tools: Read/Write/PowerShell + headless Chrome | output: the deck + renders + a decisions report
- Quality Check: word-for-word copy diff vs the copy doc, dash law, brand hex scan, headless integrity both modes, legibility eyeball, then builds the second format (image-per-slide pptx from fresh scale-2 renders) and cleans outputs/ | output: QA table + final deliverables

## Synthesis approach
Master agent reviews at every handoff (reads the copy doc line by line; personally views all slide renders) and only then passes forward. Separate-context close-out grader runs on the final artifact. Brand pre-flight runs FIRST and exact tokens are pasted into the designer's and QA's prompts.

## Lessons
- MAP BEFORE BUILDING: the brief's stated source path was the wrong deck (a 15-slide business deck); the per-page spec actually matched a different 12-slide deck title-for-title. Verify every "keep this graphic" note exists in the claimed source before accepting the mapping; resolve loudly, never guess silently.
- Copy in rendered decks may live in a JSON blob on one huge line (`window.__ALEXDECK__`), and pptx exports may be image-only (no text layer) - extract pptx media or read the blob instead of trusting greps.
- Making the CSS base state the animation END state (animations only under `body:not(.static)`) guarantees static screenshots can never catch a mid-flight frame.
- Font-size floor that survived the eyeball test at 1920x1080: body 21-22px, diagram labels 19-22px, captions 17px.

## Reuse 2 (2026-07-29, run 38, Alex deck v2 Brain/Spine/Hands) - the seats move, the gating does not
Same three-stage master-gated shape, different seats and a different order. Worth keeping as a variant:
- **Agent 1 becomes an ARCHITECT, not a content writer.** When the deck is about a system we own, stage 1 is an audit against live structured sources (`system/manifest.json`, `system/recall/facts.db`), not a copy pass. Every proposed slide fact carries a file pointer, and a fact with no pointer is not written. That single rule caught three wrong numbers in an existing deck.
- **Agent 3 becomes a WRITER, not QC.** The story and copy pass runs LAST, on the finished build, because a rewrite that lands on a built page can be length-checked against real slack. QC did not vanish, it moved into the master's own render review, which is where it belongs when the master can see pixels.
- **DIRECT HTML BUILD BEATS CLAUDE DESIGN WHEN MOTION IS THE BRIEF.** The standing rule routes decks to Claude Design; it cannot export animation or 3D. When the client asks for animation, say so in one line and build a self-contained HTML deck with the PDF printed from it. Record the override, do not silently obey or silently disobey.
- **MAP BEFORE BUILDING, again, and this time it was the gap round that was wrong.** The named source deck was two weeks old; a better one built the same morning was not found because the file search only matched deck-shaped filenames and it lived under `outputs/sessions/`. Search `outputs/sessions/` before offering source options, and when the right source turns up late, read both rather than re-asking.
- **THE PRINT PATH LIES QUIETLY.** Two slides overflowed and silently dropped their footer. It looked fine in the render. Deterministic text extraction per page caught it (`assert a known footer string appears on every page`), not the eye. Structural fix beats a cosmetic one: `.mid{min-height:0}` plus `flex:0 0 auto` on the fixed rows, so a future overrun shows as visible overlap instead of a silent drop.
- **A BANNED-WORD SCAN CANNOT SEE A PRONOUN THAT IS NOT ON THE LIST.** The pronoun law bans he/she; the violation that survived every automated check was "it" standing in for Alex in a slide title. Read the titles.
- Charts the master killed and why, reusable as a taste rule: no latency gauges for non-technical readers, no counts of implementation artifacts dressed as concepts, no shared-scale bar chart that hides three quarters of its own data, no donut for two values, and never print a note about how a chart was built on the chart.
