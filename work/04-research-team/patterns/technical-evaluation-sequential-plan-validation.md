---
class: technical-evaluation
created: 2026-07-16
last_used: 2026-07-16
times_used: 1
---
# Sequential plan validation (master-gated adversarial relay)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Here are N PROPOSED implementation plans for our own system - validate them against ground truth before we build." The plans are on trial, not a topic to research. Fits any pre-build review where the plans make checkable claims (grounding facts, assumptions ledgers, vendor facts) about a system whose files are readable.

## Team
- **Agent 1 - senior AI architect (validator):** deep infra review from ground-truth FILES (never memory, never the plans' own claims); re-verify every plan's "VERIFIED" claims; probe assumptions ledgers for what the infrastructure makes obvious; verify load-bearing VENDOR claims via WebSearch/WebFetch; verdict per workstream FIT / FIT-WITH-CHANGES / MISFIT, every reason cited | tools: Read/Grep/Glob/Bash + WebSearch/WebFetch | output: per-workstream validation report + numbered findings + honest UNKNOWN list + self-review naming what an adversary should attack.
- **Master gate 1 (main session):** spot-check load-bearing citations against the real files; settle the agent's self-named weakest point personally; bounce anything unsupported. Brief Agent 2 with the report PATH + verification directives (where to attack), never conclusions.
- **Agent 2 - senior AI architect (adversarial):** independently re-verify every verdict-carrying claim by reading the cited files directly; per-verdict AGREE/CHALLENGE/AMEND; hunt misses (security holes, simpler alternatives the system already owns, hidden costs); re-check the vendor evidence flagged weak with DIFFERENT queries | same tools | output: re-verification table (HOLDS/FALLS/AMENDED) + new findings + revised verdicts + UNRESOLVED list.
- **Master gate 2 + debate resolution:** spot-check Agent 2 (start with Agent 2's self-named weak points); rebuttal round to Agent 1 via SendMessage ONLY if a core recommendation is refuted in a way Agent 1 would contest - convergence needs no ceremony; genuine splits stay UNRESOLVED, never averaged.
- **Agent 3 - senior AI engineer (QC + plan):** QC Agent 2's evidence trail on claims the master did NOT re-verify (told which, to avoid duplicate work); then ONE unified implementation plan merging the source plans as amended - build order + dependency graph, per-phase file-level steps READ from the repo's real conventions (copy an existing manifest entry, wrapper, check, rule - never invent a field), tests, rollback, consolidated assumptions ledger (UNRESOLVED items ride unaveraged), consolidated owner-decision table, governance/change-propagation map, self-review naming the weakest specs + builder's first verifications.

## Synthesis approach
The master writes a RUNNING synthesis log stage by stage (write-first, quota-proof), gates every handoff with real file checks, resolves the debate, and delivers the final read in two labelled parts that are never merged: the workflow's verdict (verdicts, kills, downgrades, unresolved) and Alex's own opinion (what to do first, what the run says about the system itself).

## Lessons (run 1, 2026-07-16/17, three expansion plans)
- **Deployed exports beat spec prose.** The run's only killed finding (F6) died because the master read the deployed workflow JSON the agent had skipped; the agent had honestly pre-flagged exactly that. Directive for gate 1: settle the agent's self-named weakness yourself before relaying.
- **Directives, not conclusions.** Briefing Agent 2 with "his self-review names X as weakest - settle it" preserved independence while aiming the adversary; both reviewers converged on the kill from the same artifact independently.
- **The plans inherited OUR drift.** Three top findings traced to the repo's own stale doc surfaces (cadence, version, filter prose). A plan-validation run doubles as a doc-truth audit; budget a P0 doc-fix batch into the output.
- **Quota wall mid-relay is survivable:** resume the dead agent via SendMessage with its context intact; write-first per stage means zero loss. (Same lesson as run 15; now proven for adversarial relays.)
- **Tell Agent 3 what the master already verified** so QC effort lands on unchecked claims instead of re-treading.
- Empirical > argued: the two strongest findings (22/31 hash mismatches; 0-row clean guard baseline) were commands run live, not reasoning. Agents should test cheap claims, not argue them.
