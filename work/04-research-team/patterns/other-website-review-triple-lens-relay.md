---
class: other
created: 2026-07-18
last_used: 2026-07-19
times_used: 2
---
# Website review: domain-buyer lens + design lens in parallel, then dev plan (master-gated)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Review my live website through the eyes of the person who BUYS from it AND a design expert, benchmark it against the best peers, then hand me a buildable upgrade plan" - any owned web surface with a conversion job (portfolio, landing page, product site). Descends from design-review-dual-lens-debate (run 25) + the master-gated relays; adds the domain-buyer lane, live peer benchmarking, and a bilingual full-package deliverable.

## Team
- Master baseline FIRST: fetch the live page, screenshot RENDERED at both widths (Playwright when 100vh heroes break the tall-window Chrome trick), download linked artifacts (PDF), locate local source, form own top-findings before any agent reports (enables convergence detection + gate spot-checks).
- Agent 1 (domain buyer seat, e.g. the senior person who hires or buys from sites like this one): deep site + artifact review through the buyer's decision path; find + VERIFY the best 5 live comparable sites (open each, cite URLs, declare widenings and rejected candidates); prioritized recommendations, each evidence-anchored, OBSERVED/ESTIMATE tagged | tools: renders + source + WebSearch/WebFetch | output: report file (write-first, on disk before returning)
- Agent 2 (senior UX/UI designer, INDEPENDENT - never sees Agent 1): rendered-pages review both widths + code-level facts; explicit KEEP list (protects what's good from "fixes"); findings evidence->why->severity; ordered upgrade plan with impact/effort | tools: renders + source | output: plan file
- Agents 1+2 run PARALLEL (independence is by design, so parallelism is free wall-clock).
- Master gate after each: validate (spot-check top claims vs own baseline; re-fetch ONE load-bearing benchmark), debate keep/kill/amend, write ConclusionN with [OWNER] gates flagged inline. Record independent convergences - they are the highest-confidence tier.
- Agent 3 (senior web developer): both conclusions + reports -> numbered step plan against the REAL stack (measure assets itself, `magick identify`); waves fixed by the master (0 deploy-discovery/rollback -> A zero-risk -> B engineering -> C owner-gated); per-step file/lines/code/effort/deps/verification/rollback; consolidated owner-inputs table; VERIFY-AT-BUILD on every uncertain behavior; declared backlog for accepted-but-not-schedulable items (never smuggle).
- Master gate 3: trace every step to an accepted conclusion item; check keep-list protection; accept or bounce.

## Synthesis approach
Master assembles the FULL PACKAGE as one document: preamble (verdict, convergence register, compressed plan, reading order) + Part I-V (report, gate 1, review, gate 2, plan). Bilingual deliverable: English MD + translated branded PDF (translation by a dedicated subagent under write-first incremental appends; code blocks/URLs/paths stay verbatim; RTL shell for Arabic with LTR-embedded code, brand PDF rules, pixels-rule verification).

## Lessons
- Second use (a MARKETING plan): the shape generalizes cleanly beyond website review - seats swapped to marketing assistant + social content manager + a BUDGET-HOLDER third agent, target = a plan not a site. What made reuse 2 work: (a) handing Agent 3 the gate CONCLUSIONS as BINDING (conclusion wins over report on any diff) plus a trace-tag requirement on every step killed scope invention; (b) a NEW-items cap (2-3, justified from accepted evidence) kept the budget-holder honest - it allocated 27 of 100 EUR and left the rest unspent because the evidence said so; (c) the master baseline again produced catches no agent could see (a background-edit honesty hazard, a source-folder fact) - baseline-first pays even when the master isn't the domain expert; (d) both agents' riskiest claim classes (file existence, platform price, search absence, indexing eligibility) were re-verified by the master in minutes - cheap, and twice it upgraded agent ESTIMATEs to OBSERVED.
- First use (a personal portfolio site): the master's own baseline catch (credits in the linked PDF, absent on the site) converged with BOTH lanes = instant top-confidence finding. Parallel lanes hit a session-quota wall mid-run and lost NOTHING because reports were written to disk before final summaries - write-first is what made the relay resumable. Anchor-jump screenshots fail on smooth-scroll one-pagers (mid-scroll black frames); Playwright scroll-through + per-section scrollIntoView is the reliable capture. Sub-agent PDFs: pre-render pages to PNGs (pdftoppm absent; PyMuPDF works) and TELL the agent, or its Read calls fail. The buyer-seat lane found benchmark scarcity itself (personal sites in a niche profession are thin) and declared its widening honestly - require that declaration in the brief or you get padded benchmarks.
