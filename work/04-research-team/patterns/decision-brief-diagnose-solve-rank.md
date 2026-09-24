---
class: decision-brief
created: 2026-08-16
last_used: 2026-08-16
times_used: 1
---
# Diagnose -> Solve -> Stress-Rank relay (owner-dictated, master-corrected)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"I have a systemic problem with my own system (growth, cost, drift). Diagnose it in every aspect,
design exactly N solutions with up/downsides and H-cases, stress them and rank best/second/third,
deliver plain-English." The owner dictates the relay seats (persona + years = the quality bar);
the handed-plan exemption applies, no Plan Gate re-ask.

## Team
- Agent 1 (diagnosis): measures only, never proposes. Every number carries its command. Gets an
  OPERATIONAL definition of the contested metric (here: "trash") written by the master so agents
  cannot each invent one | tools: full repo read + scratchpad scripts | output: numbered findings.
- Master review 1: re-derive load-bearing numbers, correct, write the corrected diagnosis to a
  scratchpad file. The corrected file, not the agent's original, moves forward.
- Agent 2 (solutions): reads corrected diagnosis, works the H-case checklist BEFORE designing,
  proposes exactly N architecturally distinct solutions with a fixed per-solution structure
  (changes / upsides / downsides / H-cases / blast radius / cost). Hard constraints pasted verbatim
  (here: propose-only, no deletion, named contracts unbreakable) | output: designs + open questions.
- Master review 2: verify the agent's most load-bearing repo claims personally, correct, amend.
- Agent 3 (stress + rank): attacks numbers, H-case tables, contract arguments and cost claims;
  worst-case resolution table (yield if every open question resolves AGAINST); per-axis verdicts
  on the owner's axes; final nomination with the axis-split named, never averaged; conditions on
  the winner | output: ranking report.
- Master final: verify Agent 3's decisive arithmetic personally, accept or overrule, write the
  plain-English deliverable + claims table (sources = commands, since evidence is internal
  measurement, not citations).

## Synthesis approach
Measurement replaces citation for internal diagnosis: the anti-laundering rule becomes "every
number carries the command that produced it", and the master re-derives before accepting. Ranking
discipline: rank AS PROPOSED; a compose note rides separately and must not soften the ranking.

## Lessons
- Run 44 (alex-file-bloat): every review pass overturned something real. Master on A1: token
  conversion understated 40% (measure the ratio, never assume bytes/4), exclusion rules applied
  inside backup trees undercounted disk 2.4x, and the master's own operational definition had a
  self-reference flaw (the system's auto-ledger "references" everything) that the agent caught
  with a sensitivity variant - flip the headline to the variant when the definition is the bug.
- A3's best find was ARITHMETIC: the proposed rotation window steady-states ABOVE today's size at
  the measured accretion rate. Make the stress agent re-derive every steady-state claim from
  measured rates; two prior passes missed it.
- A master correction can open a new hole: R-1 (nightly rebuild) reopened the acceptance gap R-3
  had closed elsewhere. The stress agent must re-run each correction's logic against every
  solution, not just the one it amended.
- Cold-context handoff needs the FULL corrected artifact written to a file; agents cannot see the
  conversation. Corrections block at top, corrected full text below, F/C/R citation ids
  throughout so downstream agents can cite precisely.
