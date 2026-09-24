---
squad: build-review
class: iterative (build -> adversarial review -> fix loop)
progression-model: iterative        # doc 2 taxonomy: self-contained | iterative | pipeline
created: 2026-07-20
roster: 1 builder + 1-2 reviewers + master arbiter
---

# Squad: build-review

For "make this thing AND prove it holds": a build lane produces an artifact, an adversarial lane tries to break it, the master arbitrates and loops until it holds or the residual risk is named. The dual-lens design-review pattern (#04 lessons), packaged.

## Question shape it fits
Produce-and-verify work: a script, a workflow, a spec, a migration unit, a document that has to be RIGHT. Anything where "it looks done" is not the same as "it is correct."

## Roster
| Lane | Mission (one sentence) | Tool scope | Output contract |
|---|---|---|---|
| Builder | Produce the artifact to the stated contract | full tools for the build (files, n8n API, etc.) | the artifact + a self-check list of what it claims to do |
| Reviewer-A (adversarial) | DISPROVE that the artifact meets its contract; find the break | read-only over the artifact + its real inputs; recompute/re-run where possible | concrete defects with evidence, or "no defect found on angle X" (a lane failing, not the artifact passing) |
| Reviewer-B (optional, 2nd angle) | A DIFFERENT failure angle than A (edge cases, cost, drift, security) | same read-only + the relevant checker | defects or an evidence-anchored all-clear |

## Convergence (the master session = arbiter)
The master reads the build + every review, decides FIX / SHIP / SHIP-WITH-NAMED-RISK, and loops the builder if a real defect survives. The arbiter does NOT dissolve a live defect to look decisive; a surviving defect blocks SHIP or is shipped only as a NAMED, logged risk (the owner's call).

## Gates (the four)
- **Approval gate.** Show the roster + the artifact's contract before building. approve / modify / build-without-review (only for the genuinely trivial).
- **Anti-laundering.** "Reviewer found nothing" is only meaningful if the reviewer actually tried to break it against real inputs. A rubber-stamp review is a skipped gate. Recompute contested numbers; re-run what can be re-run.
- **Master-only-writes-vault.** Reviewers never write the vault or the live system. The builder writes only its artifact; the master writes the validated result + the review verdict to the vault.
- **Timebox every lane.** A reviewer that finds nothing after real effort reports "no defect on angle X, here is what I checked" and stops. No infinite re-review.

## Relation to the existing gates
This squad does not replace Close-Out or the blind grader; it runs DURING the build. Close-Out still runs after. On identity output the Pre-Flight gate still runs first. On a live external write, verify-after-write still applies to the master's write.

## Commission line
`/research-team squad=build-review target="<what to build>" contract="<how we'll know it's right>"`

## Environment note
- **Laptop:** builder + reviewers can be parallel Agent spawns (reviewer reads the builder's output).
- **claude.ai env:** sequential isolated passes: build, then a fresh isolated review pass that sees ONLY the artifact + contract (never the builder's reasoning), which is the stronger form of the blind-grader discipline anyway.
