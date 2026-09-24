# /research-team - Adaptive Multi-Agent Research

Spec: work/04-research-team/CLAUDE.md (read it first; it defines the full runtime flow).

Usage: `/research-team {question or topic}`. If no question given, ask for one - don't invent a topic.

## Modes
- **Research (default):** `/research-team {question}` - gather external evidence, synthesize, ship. Steps below.
- **Adversarial verification:** `/research-team verify: {claim}` (or "stress-test / red-team {claim}") - put a claim Alex or the owner already holds ON TRIAL. Refuters are mandated to DISPROVE it and must anchor every attack in EXTERNAL evidence (not model reasoning), a convergence judge returns CONFIRMED / REFUTED / UNRESOLVED and never averages a split, and the honesty law binds the debate. This is the only sanctioned way to check an Alex conclusion here (default-flow agreement is consensus laundering). Full spec: work/04-research-team/CLAUDE.md "Adversarial Verification Mode". On-demand sibling of #23 `/deep-audit`.

## Steps (condensed; spec is authoritative)
1. Classify the question; check work/04-research-team/patterns/index.md for a reusable team.
2. Check vault/research/ and notion-search first - partial answers may exist; don't re-buy them.
3. Design the team: **3 spawned sub-agents maximum**, parallel where independent, or adapt the matched pattern DOWN to that cap. A pattern that names more lanes gets run in passes of three, not all at once. State the cost at the approval gate before spawning.
4. AskUserQuestion: approve / modify / answer-without-team. NO sub-agents before approval.
5. Execute, synthesize in Alex voice. Unknown stays unknown; cite sources.
5b. **Claims table (output contract, 2026-07-25).** End every deliverable with a claims table: `| Claim | Source (URL) | Retrieved | Confidence |`, one row per load-bearing claim. A claim with no external source = `source: none (reasoning)`, confidence capped `med` (label inference, never dress it as a fact). An empty lane = `nothing found | - | date | -`. Spec: work/04-research-team/CLAUDE.md step 6b.
6. Write vault/research/{topic-slug}.md + Notion page "Research: {topic}" under the Personal Ops System parent.
7. Save/refresh the pattern in patterns/ + index.md.
8. AskUserQuestion: "Claude Design deck or PDF?" → **Deck = Claude Design (DesignSync)** on claude.ai/design (slides as components, finalize_plan → write_files, branded from brand config), export PDF; OR PDF = reportlab with brand config. NOT the `pptx` skill (standing rule 2026-06-15). Output the PDF (+ note the claude.ai/design link) to outputs/research-team/YYYY-MM-DD/. Delete build scripts and temp artifacts after.

## Post-Run
- New people → vault/people/, new companies → vault/business/, with [[wiki links]].
- vault/projects/research-team/status.md (last run, topic, output path).
- vault/log.md: `## [YYYY-MM-DD HH:MM] research-team | {topic}, {n} agents, {deliverable}`.
- vault/index.md for the new research page.
