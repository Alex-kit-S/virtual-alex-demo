# Research Team

## Type
Automation (on-demand, adaptive multi-agent)

## Purpose
An adaptive research system that designs its own team per question. Given a research question, it: analyzes the question type, checks patterns/ for a reusable team architecture from past research, designs (or reuses) the right agent team, shows the design for approval, executes with parallel sub-agents, synthesizes, saves findings to the vault and Notion, asks "Claude Design deck or PDF?", and ships a branded deliverable. The team is never fixed; the question shapes it.

## Entry Points
- On-demand only: `/research-team {question}` or "research {topic}". NOT scheduled.

## Tools Used
- Agent tool (sub-agents: Explore for breadth, general-purpose for deep dives)
- WebSearch + WebFetch (load via ToolSearch first)
- Chrome only for sites that block plain fetch (deep scraping; never for Gmail/Calendar/Notion)
- Python (data analysis, charts) - via Bash, cleanup after
- Notion MCP: notion-search (internal context), notion-create-pages (research page under Personal Ops System parent)
- **Claude Design (DesignSync) for branded decks** (standing rule 2026-06-15; NOT the `pptx` skill), the `xlsx` skill skill (data tables), Python/reportlab (standalone PDF)

## The Runtime Flow (executed by Claude Code per run)
1. **Analyze the question.** Classify: market-scan | competitor-deep-dive | technical-evaluation | decision-brief | person-or-company-profile | other. Identify what evidence would settle it.
2. **Check patterns/.** Read work/04-research-team/patterns/index.md. If a pattern matches the question class, load it and adapt; note "reusing pattern {name}".
3. **Design the team. THREE spawned sub-agents at a time, maximum, and that is a hard cap rather than a guideline.** Each gets a name, a one-sentence mission, its tools and its expected output. Parallel where independent. One synthesizer, which is the main session: sub-agents report, they do not conclude.
   **The cap is about allowance, and it binds the PATTERNS too.** This runs on Claude Pro, where parallel agents are the fastest way to spend a day's allowance before lunch. Several patterns in `patterns/` were written for a bigger plan and name four to fourteen lanes. **Loading a pattern does not lift the cap.** Take the first three lanes, let them report, then run the rest as a second pass against what came back. That is usually the better research anyway, because the later lanes see the earlier findings instead of guessing alongside them. Say the number of passes at the approval gate, before spawning anything.
4. **Approval gate.** Show the design via AskUserQuestion: approve / modify / answer-without-team (for questions too small for a team). Do NOT spawn agents before approval - sub-agents are the expensive path.
5. **Execute.** Spawn approved sub-agents (parallel calls in one block where independent). Each returns findings + sources. **Timebox every lane:** each sub-agent's mission includes "if reasonable effort turns up nothing, report 'nothing found' with what was tried; do not keep digging." A lane that comes back empty is a finding, not a failure. Never re-spawn an agent to retry an empty lane without a changed approach.
6. **Synthesize.** Main session writes the answer: findings first, confidence levels, what's unknown stays unknown. Alex voice, no padding.
6b. **Claims table (OUTPUT CONTRACT, 2026-07-25).** Every squad deliverable (vault page, Notion page, deck/PDF) ENDS with a claims table so downstream consumers and /deep-audit can verify instead of trust. This makes the Adversarial Verification Mode's evidence discipline the default OUTPUT FORMAT, not an optional mode - it closes the known "detects inconsistency, not incorrectness" gap at the research layer, where wrong facts enter the system. Format:

   | Claim | Source (URL) | Retrieved | Confidence |
   |---|---|---|---|
   | one load-bearing claim | https://... | YYYY-MM-DD | high/med/low |

   Rules: one row per load-bearing claim (the ones a decision rests on), not every sentence. A claim with no external source is marked `source: none (reasoning)` and confidence capped at `med` - inference is allowed but must be LABELLED as inference, never dressed as a cited fact. A lane that found nothing contributes the row `nothing found | - | date | -`. The table is deterministic to produce (the sub-agents already return findings + sources per step 5); this just fixes where they land.
7. **Save knowledge.** vault/research/{topic-slug}.md (concise findings, key insights, sources, [[wiki links]]). Notion page "Research: {topic}" under the Personal Ops System parent (ID in vault/projects/notion-parent-id.md) with the full findings as content.
8. **Save the pattern.** If the team design was new or meaningfully adapted: write patterns/{class}-{slug}.md (see Pattern Format) and update patterns/index.md.
9. **Deliverable (team runs only).** If the run went through the answer-without-team path, the vault page + Notion page IS the deliverable - do not build a file for a two-paragraph answer. For team runs, ask via AskUserQuestion: "Claude Design deck or PDF?" Then:
   - **Deck → Claude Design (DesignSync)** (standing rule 2026-06-15): build on claude.ai/design as a design-system deck, slides as components one at a time (finalize_plan → write_files), branded from brand/config/brand-config.md (ALEX brand: #001219 canvas, #005f73 + #0a9396 teal structure, one #ee9b00 accent, Calibri, ALEX logo block), then export PDF. NOT the `pptx` skill (no native .pptx).
   - PDF → Python reportlab/weasyprint, brand colors + fonts, dark teal header bar with the ALEX logo block
   - Save the exported PDF (and note the claude.ai/design project link) to outputs/research-team/YYYY-MM-DD/. Delete ALL build scripts and temp dirs after. Team-run deliverables are always branded, never just markdown.

## Squad Templates (added 2026-07-20, agent-architecture decision run item 6.2)

Doc 2's workflow-file idea applied to doc 1's roster idea, on Alex's #04. Instead of re-dictating the relay every time (the owner has dictated the same shape at least four times, the owner's My Words corpus in soul.md), the roster is a checked-in template the owner commissions by name. Three live templates in `work/04-research-team/squads/`:

| Template | Class (doc 2 progression model) | Shape | Commission line |
|---|---|---|---|
| `research.md` | iterative (fan-out then converge) | up to 3 evidence lanes + 1 synthesizer; the default | `/research-team squad=research question="..."` |
| `build-review.md` | iterative (build -> adversarial review -> fix) | builder + adversarial reviewer(s) + master arbiter | `/research-team squad=build-review target="..." contract="..."` |
| `merge-decide.md` | pipeline (validate -> cross-check -> merge -> decide) | one lane per input, staged handoff to a decision | `/research-team squad=merge-decide inputs="A,B" question="..."` |

Every template encodes the same four gates: the **approval gate** (show the roster before spawning), the **anti-laundering rule** (same-model agreement is never corroboration; conclusions ride external evidence), the **master-only-writes-vault rule** (lanes report, only the master writes the validated result), and a **per-lane timebox** (an empty lane is a finding). Each also carries the environment note: parallel Agent spawns on the laptop, sequential isolated lanes in the claude.ai project env, identical discipline either way. This document's own 2026-07-20 run is the first `merge-decide` exemplar. No new project number: this is #04 capability, not a new automation.

## Pattern Format (patterns/{class}-{slug}.md)
```
---
class: market-scan | competitor-deep-dive | technical-evaluation | decision-brief | profile | other
created: YYYY-MM-DD
last_used: YYYY-MM-DD
times_used: N
---
# {Pattern name}
## Question shape
{What kind of question this fits}
## Team
- {agent name}: {mission} | tools: {list} | output: {what it returns}
## Synthesis approach
{How findings get combined}
## Lessons
{What worked, what to change next time}
```
patterns/index.md lists every pattern: name, class, times_used, one-line description.

## Notion Integration
No new database. One page per research run under the parent page whose id is in `vault/projects/notion-parent-id.md` (never hardcode an id in a tracked file: it belongs to one account, and it is exactly the kind of thing that survives a copy and quietly points at a stranger), titled "Research: {topic}", full findings as page content. notion-search before researching: internal docs may already answer part of the question.

## Vault Structure
- Tier 1: vault/projects/research-team/status.md (last run, run count, recent topics, output paths)
- Tier 2: vault/research/{topic-slug}.md (one page per research output - this IS the knowledge)
- Patterns live in work/04-research-team/patterns/ (architecture = config, not knowledge)

## Vault Reads
- soul.md (voice + priorities: research that serves the owner's stated priorities outranks curiosities)
- vault/research/ (don't re-research what's answered; link instead)
- vault/business/ (market/competitor context). NOTE: vault/business/competitors/ is fed by Market Pulse, which is NOT BUILT yet - if absent, skip gracefully, never error.
- vault/people/, vault/projects/ for context on names that appear

## Vault Writes
- vault/research/{topic-slug}.md per run
- vault/business/ and vault/people/ pages for new companies/people found (post-run ingestion)
- status.md refresh, vault/log.md entry, vault/index.md for new research pages

## Connections
- Fed by: Market Pulse (vault/business/competitors/) once built; Notion internal docs.
- Feeds into: vault/research/ (consumed by everything) and whatever decision the owner asked the question for.

## House Writing Style (BLOCKING for prose deliverables, added 2026-08-06)

Every running-prose deliverable this project writes (papers, reports, plans, scans, decision
briefs, speaker scripts, the prose body of any PDF or .docx) is edited against
**`brand/config/writing-style.md`** before it ships. Generate the argument first, then run the
guide as a separate editing pass; do not try to write and police at the same time.

The six rules: banned constructions (hedging, connective filler, makeweight tricolons,
restatement, nominalisation, summarising conclusions), sentence rhythm (no three consecutive
sentences within 5 words of each other), claims (citation or marked inference, never a
confident unsourced middle), structure (paragraphs argue, they do not enumerate), punctuation
(no em-dashes), register (sparse and factual, state the point).

Two things the pass must NOT do: it must not touch citations, reference entries or quoted
source titles, and it must not paper over vagueness that comes from thin research. The latter
gets flagged **CONTENT GAP** and left for the owner. Log every edit as original / replacement /
rule triggered.

Baseline measured at adoption across 5 recent outputs: hedging 0, connective filler 0
(soul.md's Detection-proofing already holds those at zero), tricolons up to 14.4 per 100
sentences, uniform-rhythm runs up to 7.7 per 100, and 70 em-dashes in a single 1,850-word plan.
The dash rule is old; the compliance was not.

## Post-Run (mandatory)
0. Prose deliverable? Edited against `brand/config/writing-style.md`, edit log produced, CONTENT GAPs surfaced
1. vault/people/ pages for new people
2. vault/business/ pages for new companies
3. [[wiki links]] across research, people, business pages
4. Notion research page created
5. vault/index.md + vault/log.md updated
6. Sprint board: marked Done at build (2026-06-10); rows never re-touched per run

## Implementation Notes (as built, 2026-06-10)
- Built as spec + command + pattern library scaffold. No live run yet (on-demand; first question starts the pattern library for real).
- patterns/ seeded with index.md and the format spec only - no padding with invented patterns.
- Guardrails carried from soul.md: no invented facts (unknown stays "unknown"), no model-verifier chains - sub-agents gather, deterministic checks + one synthesizer conclude.

## Adversarial Verification Mode (evidence-anchored refutation, added 2026-07-14, dynamic-workflows build)
The default flow gathers external evidence and lets the synthesizer (Alex) conclude. That is the right shape for "what is true out there" and the WRONG shape for "is THIS conclusion right" (see What this is NOT). This mode is the sanctioned way to stress-test a claim Alex or the owner already holds, without consensus laundering. It is the on-demand, single-claim sibling of #23's `/deep-audit` (same refutation discipline, pointed at one claim instead of the whole repo).

Invoke: `/research-team verify: {claim}` (or "stress-test / red-team {claim}"). The claim is the thing on trial, not a topic to research.

What makes it a real check and not a same-model echo:
1. **Isolate the claim.** The master (or a first agent) extracts the exact falsifiable statement + the load-bearing assumptions under it. A claim too vague to be shown false gets sharpened, or the run stops and says so. You cannot refute a fog.
2. **Refutation mandate, not a research mandate.** Each refuter's job is to DISPROVE the claim from one distinct angle. "Found nothing wrong" is the lane failing, not the claim passing. Minimum two refuters on independent angles.
3. **Every attack is anchored in external evidence.** A refuter must ground its case in something outside this model (web evidence, a document, data, a recomputation), not model reasoning alone. This is the whole mechanism: dissent that could be wrong the same way Alex is wrong proves nothing; dissent anchored in an external fact does. A lane that can only argue from reasoning reports "no external disconfirming evidence found" and that verdict is flagged as weak.
4. **A steelman defender** argues FOR the claim, also evidence-anchored, so it is a debate and not a pile-on. Optional on simple claims.
5. **Converge or surface the split.** A convergence judge reads every lane and returns CONFIRMED (refuters found no surviving external disconfirming evidence and the defender's evidence holds), REFUTED (a refuter produced disconfirming evidence that survives), or UNRESOLVED (genuine evidence-backed disagreement). The judge NEVER averages a split into a false middle.
6. **The honesty law binds the debate.** (Carried from the design-review-dual-lens + pitch-adversarial lessons: an unbound debate ships tidy fabrications.) Every claimed fact traces to a source; recompute contested numbers; unknown stays unknown; a refuter may not invent a weakness to look useful.

Master's job here: it does NOT get to dissolve an UNRESOLVED verdict to look decisive. It reports the verdict, the disconfirming evidence, and the residual disagreement, then gives the owner its own read SEPARATELY and labelled as such. The verdict belongs to the workflow; the opinion belongs to Alex; they are never merged. First real run writes the `verification-claim-refutation` pattern to patterns/ (patterns earn their file by use, not by being imagined).

## What this is NOT
The default flow is a real research tool because its evidence is external. It is NOT, by default, a validator of Alex's own reasoning: same model, hub-and-spoke authority, and the synthesizer is the same Alex being checked. Treating default-flow agent agreement as corroboration of an Alex conclusion is consensus laundering, and stays banned. The one sanctioned way to check an Alex conclusion here is Adversarial Verification Mode (above), and it works ONLY because the verdict rides on external disconfirming evidence the refuters did or did not find, never on agent agreement. If a verification run reaches CONFIRMED without a single lane anchoring in an external fact, that is consensus laundering in a debate costume: discard it.

## Trifecta
Gate: **read-only**. Legs: private_data=false, untrusted_content=true, external_comm=false (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). Ingests external web evidence (untrusted); reports stay local. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.
