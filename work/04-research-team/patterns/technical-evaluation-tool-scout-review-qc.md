---
class: technical-evaluation
created: 2026-07-05
last_used: 2026-07-12
times_used: 5
---
# Tool Scout -> Review -> QC (sequential 3-loop)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Find the best (cheap, fits our stack) external tool/approach to do X, and is the recommendation actually right?" A build-or-buy / tool-selection question answered from the live web (GitHub, X, pricing pages), where the danger is a plausible-but-wrong pick: stale facts, hidden costs, or missing that we already own most of it. Ends in a decision, not a deck necessarily.

## Team (3 sequential agents; the session grounds first + synthesizes between)
- **Pre-step (session):** gather INTERNAL grounding the web agents can't see (what we already run, the real machine specs, the actual constraints) and feed it into every agent prompt. This is what lets the QC catch "you already built 80% of this."
- **Loop 1 Scout (1 agent, web):** scan web/GitHub/X for current candidates. Per candidate: what it is, license, runs-on-our-OS, the one capability that matters (here: barge-in), can-it-use-our-brain, latency, real monthly cost tagged LOGGED (from a pricing page) vs ESTIMATE, effort, maturity (stars/last-commit). Plus an "architectural reality" note. Timebox; empty lane = a finding. | tools: WebSearch/WebFetch | output: sourced candidate table + flagged uncertainties.
- **Loop 2 Reviewer (1 agent, web-light):** VERIFY the scout's flagged uncertainties with targeted checks, recompute costs from first principles, reconcile against our real constraints, rank a 2-3 shortlist with build sketches, correct the scout's overclaims. | output: ranked shortlist + corrections + top pick + fallback.
- **Loop 3 QC (1 agent, adversarial):** role-play the skeptical user. Re-check load-bearing facts/pricing, hunt a simpler/cheaper path the web agents structurally couldn't see (the internal-grounding angle), stress feasibility on the REAL box, check honesty (are tradeoffs stated, is the cheap/private constraint really met). SHIP / SHIP-WITH-FIXES / DO-NOT-SHIP + ranked fix list tagged [FACT]/[COST]/[COMPLETENESS]/[FEASIBILITY]/[HONESTY] + a "do not change" list. | output: verdict + fixes.

## Synthesis approach
Session grounds first, then runs the three sequentially (each sees the prior's output), concluding between each. Keep LOGGED vs ESTIMATE on every number end to end. Trust the QC to overturn the top pick: on run 13 it flipped "adopt external tool" to "evolve our own scripts" because it had the internal grounding the scout couldn't. The verdict can be SHIP-WITH-FIXES where the ROUTE is right but the concrete pick is wrong.

## Lessons (run 13, 2026-07-05 - Alex voice loop)
- The pre-step internal grounding is the whole point: feed every agent the real machine specs + what we already own, or the QC can't catch the "you already built it" miss. On this run the laptop being a 15W CPU and Alex already owning speak.ps1/Whisper were both decisive and invisible to a pure web scan.
- Sequential (not parallel) is right when each stage's job is to pressure-test the last. Scout gathers, Reviewer verifies + ranks, QC tries to break it. Three different jobs, not three copies.
- Make the QC adversarial and give it the internal facts: it earned the run by overturning the recommendation (adopt -> evolve) and inverting a wrong privacy claim (EEA jurisdiction flips the "free tier trains" objection).
- Separate LOGGED (pricing-page) rates from ESTIMATE totals at every hop; the cost of realtime speech-to-speech APIs is the expensive trap, not TTS.
- For a tool pick, the honest deliverable is often the decision + a build plan, not a branded deck. Ask before building slides.

## Lessons (run 16, 2026-07-07 - Alex voice hands-free, reuse 3)
- When the question is a FOLLOW-UP to a past run, the pre-step grounding must include the past run's page + what it already rejected, stated as "do not re-research" - Engine 1 stayed on the new territory (wake word, TTS quality, barge-in) instead of re-buying run 13.
- Give the QC engine license to overrule the Reviewer's OPTION COMPOSITION, not just its facts: here it deleted a whole framework dependency (RealtimeSTT) from the winning option and demoted a fragile tier - structural edits, not fact corrections.
- Make each engine verify PyPI requires-python + dependency chains for anything pip-installed; two "known painful" installs (espeak, openwakeword) turned out solved/avoidable on current versions, which flipped effort estimates.
- Check LANGUAGE coverage of every model tier separately (STT vs TTS): the multilingual requirement survived STT in every option and silently died at TTS in all of them - only the QC pass caught it.
- User-specified team designs (engines named in the ask) map onto this pattern cleanly; take the user's design verbatim as the approval and skip the redundant gate.

## Lessons (run 22, 2026-07-12 - Alex voice in-session, reuse 5)
- Kill lists from a prior run go stale FAST when the vendor is the platform itself: run 16's "#50720 closed not-planned" (5 days old) hid that /voice dictation had SHIPPED as a first-party feature - the run's biggest finding. Re-verify any kill-list item that gates on a fast-moving first-party surface; "closed not-planned" on a feature request says nothing about a differently-shaped ship.
- The master re-reads the primary source before accepting a decision-flipping fact: the QC's elimination pivoted on hold-mode's insert-and-wait-for-Enter, which BOTH earlier agents missed while reading the same doc (they analyzed tap mode as the only behavior). One master WebFetch confirmed it verbatim. When one sentence decides the winner, the synthesizer verifies that sentence.
- Machine facts eliminate what web evidence would ship: `defaultMode: acceptEdits` + the Bash allowlist (read from settings.json) turned P3's auto-Enter injection from "gated by permissions" into a mishear-executes-commands KILLER. Give agents the box, and have the master re-verify the settings claims first-hand.
- Score model-cooperation mechanisms as KILLER for a PRIMARY lane in reliability-class questions, not SERIOUS: an unquantifiable behavior bet (dies on /clear, degrades post-compaction, no bench retires it) recreates the intermittent-failure class the owner is fleeing. Agent 2 said it in prose; only the QC scored it right.
- Mid-relay master verification is cheap and load-bearing: `claude --version` + settings read + one doc fetch (~3 tool calls total) grounded three hand-offs. Reviews between agents are where this pattern earns the word "relay".
- The pattern scales from "pick one tool" to "scan the whole landscape" if the Scout gets explicit LANES (8 here) and a per-lane "nothing new found is a valid finding" clause - 20 candidates came back without padding.
- Give the QC agent the MACHINE, not just the repo: `claude --version`, settings.json, a one-shot SSH. Two of the scan's three scariest headlines (Auto Memory "already writing", Graphiti RAM) died on machine facts no web agent could see. Also grant the QC one bounded remote check the Reviewer was denied; agent permission classes differ per session and the retry cost one command.
- Make the session review spot-check the QC's heaviest overrules DIRECTLY (read the settings file, grep the error-log) instead of trusting the chain; and expect the review to still find one dropped constraint (the caching min-prefix) - three agents don't exempt the synthesizer from working.
- When the ask is "improve system X", feed all agents the system's own audit (weaknesses by number) so every candidate maps to a named weakness; anything that maps to none self-identifies as padding.
