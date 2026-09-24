---
class: technical-evaluation
created: 2026-07-02
last_used: 2026-07-07
times_used: 4
---
# Internal audit + stack scan (build-something-on-our-own-system questions)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"We want to build X on top of our own system: what of OURS should feed it, what does our INFRA offer, and what's the best external TOOLING to build it with?" Two internal lanes + one web lane. Fits any feature that consumes existing Personal Ops System data (dashboard, digest, API, export).

## Team
- Project Auditor: sweep all builds' status.md + specs + vault/log.md; per build report measurable outputs (real example values), source of truth, cadence, tile/feed-worthiness High/Med/Low | tools: Explore (very thorough, read-only) | output: structured table + cross-cutting metrics list
- Infra Auditor: sweep the machinery (scheduler, error-log, n8n configs, hooks, MCP config, vault size, outputs/); report candidate system signals with capture difficulty EASY/MEDIUM/HARD + freshness; file-system evidence only, no external calls | tools: Explore (very thorough) | output: tiered signal table
- Stack Scout: web-only scan of the current tool landscape against an explicit working hypothesis from prior research; 8-12 searches, told to flag contradictions LOUDLY | tools: general-purpose + WebSearch/WebFetch | output: findings per question + URLs + hypothesis flags

## Synthesis approach
Main session decides, agents report. Key move: give the Scout the prior brief's hypothesis to attack, then resolve flags with a documented judgment call (here: kept Next.js over the practitioner-favored Vite SPA because one requirement, AI-compat, needs server routes). Rank internal findings into shipped rows (v1) vs bench (later) so scope stays honest. Confidence levels per lane; unknowns stay named.

## Lessons
- Feeding the Scout a hypothesis to falsify produced sharper findings than open-ended "find the best stack" (it surfaced the Tremor-is-frozen and Serwist/Turbopack traps a generic scan would have missed).
- Explore agents handled the internal audits well and cheaply; no general-purpose needed for read-only sweeps.
- The two internal lanes overlap slightly on run-log data; acceptable, they read it for different purposes (business numbers vs health signals).
- Reuse 2 (2026-07-02, Recovery layer): the pattern also fits "design a missing SYSTEM layer" questions, not just features. Splitting the internal audit into surface-vs-mechanism (what must stay consistent vs what already checks it) gave a clean gap table. Hypothesis-to-attack again outperformed open scanning: the Scout came back with two design corrections (level-triggered, detect-don't-repair) instead of a generic tool list. Internal lanes found the sharpest evidence themselves (drift the system didn't know it had, /lint never executed, no git).
- Reuse 4 (2026-07-07, Alex HQ live conversation): **security-QC-as-4th-lane variant.** For a "build a remote-access feature onto our own system" question where the risk is security, not tooling, run the 3 lanes in PARALLEL (1 internal Explore reuse/infra audit + 2 external web scouts: one for the transport crux, one for the adjacent stack) then add a SEQUENTIAL 4th adversarial lane that gets the other three's findings and builds the threat model. The 4th lane earned the run: the parallel lanes all repeated "only one port is exposed, the vault is never in the blast radius" (true at the network layer); the QC lane caught that it's false at the APP layer (the port fronts a brain with `Read` over the whole disk → secrets are exfil-able by content), which flipped the whole recommendation (public tunnel → private tailnet + a prerequisite hardening phase). Lesson: when the feature opens a network path to the brain, a dedicated adversarial synthesis lane that assumes the transport lanes are naive about the app layer is worth its cost. Also: feed the QC lane the OTHER lanes' condensed findings verbatim + the internal constraints so it can correct them (it fixed 6 cross-lane claims, incl. the browser-WebSocket-can't-set-headers gotcha the transport scout missed).
- Reuse 3 (2026-07-04, Health Tracker): also fits "review MY proposed architecture and harden it" - the incoming brief already had a v1 solution, so each lane was framed to *falsify/pressure-test* one slice (phone-capability / internal-clone / domain-science) rather than discover from scratch. Variant on the 3 lanes: swapped the second internal Explore for an external **capability scout** (does the platform even support the make-or-break primitive - here native iOS Shortcuts sleep stages) because the true unknown was external, not internal. Kept one internal Explore (clone the existing stack 1:1) + one science/data lane. Best synthesizer move: reconciling the 3 lanes surfaced decisions no single lane owned - where to put the score formula (once, in n8n, batch+single), two triggers to fix both brief-timing AND the reliability caveat, and steps/sleep targeting different dates in one run. Lesson: when the brief hands you a v1, assign each lane a slice to attack; the value is in the cross-lane reconciliation, not the individual findings.
