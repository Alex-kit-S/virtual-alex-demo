---
squad: merge-decide
class: pipeline (validate -> cross-check -> merge -> decide)
progression-model: pipeline         # doc 2 taxonomy: self-contained | iterative | pipeline
created: 2026-07-20
roster: up to 3 input lanes per pass + master validation + merge lane + decision
first-exemplar: outputs/sessions/2026-07-20-agent-architecture/ (this squad's own decision run)
---

# Squad: merge-decide

For "here are N inputs (concepts, proposals, docs); validate each, force them to sources, merge the real parts, and DECIDE." A staged pipeline, not a fan-out: each stage hands a validated product to the next. This is the shape of the agent-architecture BUILD-A-SUBSET run that created these templates.

## Question shape it fits
Decision briefs from competing/overlapping inputs: two vendor concepts, three design proposals, a build-vs-buy, "should Alex adopt X." The output is a DECISION with reasons and recorded skips, not a survey.

## Pipeline (staged handoff)
| Stage | Lane | Mission | Tool scope | Output contract |
|---|---|---|---|---|
| 1 | Lane-per-input, **capped at 3 per pass** (batch further inputs into a second pass; unbounded fan-out is how a day's Claude allowance disappears before lunch) | Extract the load-bearing claims and FORCE each to a source | WebSearch/WebFetch (read-only) + the input file | claims table: each claim VERIFIED / UNVERIFIED / REFUTED with the source |
| 2 | Master validation | Attack the shakiest claim; run the convergence + anti-laundering check | read-only + recompute | which claims survive; quarantine the unverifiable, labelled |
| 3 | Merge lane | Build the merged position from ONLY the surviving parts | the validated products | the merge + why it beats any single input |
| 4 | Decision | BUILD / BUILD-A-SUBSET / SKIP, each skip with a reason + revisit trigger | none | the verdict + a master's separate read, labelled as opinion |

## Convergence (the master session)
The verdict belongs to the pipeline; the opinion belongs to Alex; they are NEVER merged (carried from Adversarial Verification Mode). An UNRESOLVED does not get dissolved to look decisive; report the split, then give the separate read.

## Gates (the four)
- **Approval gate.** Show the pipeline + which inputs map to which lanes before running. approve / modify / decide-without-team.
- **Anti-laundering.** Two inputs agreeing is not proof (the classic trap in a merge: both docs converge, so it must be true). Convergence is noted only WITH independent grounding, never instead of it. Every load-bearing claim traces to an external source, a file read this run, or is labelled unknown.
- **Master-only-writes-vault.** Lanes never write the vault. The master writes the validated decision + the recorded skips.
- **Timebox every lane.** A claim that cannot be anchored after a real search is labelled UNVERIFIED and quarantined from the decision, not chased forever.

## Output shape (what a merge-decide run produces)
1. Overlap map (inputs vs what Alex already runs).
2. Per-input validation (claims forced to sources).
3. Master validation + convergence/anti-laundering check.
4. The merged architecture.
5. Phased build (reuse existing layers; name what is NEW).
6. Explicit NOT-building list, each skip with a reason + a revisit trigger.
7. Final decision + master's separate labelled read.

## Commission line
`/research-team squad=merge-decide inputs="<docA>,<docB>,..." question="<the decision>"`

## Environment note
- **Laptop:** stage-1 lanes can be parallel Agent spawns (one per input); stages 2-4 are the master session.
- **claude.ai env:** run the stage-1 lanes as SEQUENTIAL isolated passes (this run's own method), same evidence discipline. The pipeline shape is unchanged; only concurrency differs.
