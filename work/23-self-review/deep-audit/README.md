# Deep Audit - on-demand adversarial whole-system audit

**Built 2026-07-14 (dynamic-workflows build, the owner's call). Owned by #23 because #23 owns the review/quality surface.**

The heavy, on-demand, adversarial sibling of the cheap always-on checks. Where #18's recovery checker pattern-matches (do the files exist, do the shapes match) and the weekly `/self-review` reasons cheaply over the correction/error trail, `/deep-audit` fans out one agent per project and makes each one prove that the project's CLAIMS match GROUND TRUTH, then a second adversarial pass tries to break every "verified" claim. It catches the drift class the pattern-checkers structurally cannot: **the file says X, reality is Y.**

## Why it exists (the drift class it targets)
Real incidents, all "claim vs reality" gaps a shape-checker misses:
- 2026-07-10 silent dual-engine deactivation (manifest + routing said LIVE; the n8n `active` flag was false).
- The stale "deployed inactive" note that survived cleanups.
- The sprint-tracker 3-day silent blackout.
- The recurring "audit-null" corrections that keep showing up in commit messages (a first_fire date modeled, not measured; a merge note that drifted).

A cheap pass confirms `status.md` exists. Only a deep read that traces each claim to code, live API state, schedules, and last-run evidence, then has an adversary attack the "clean" verdicts, catches that the claim is false.

## Trigger
On-demand ONLY: `/deep-audit [scope]`. **Never scheduled** (it is the quarterly deep sweep, not a heartbeat; on Max it spends the usage window). Default scope = every project in `system/manifest.json`. Optional scope = one project or subsystem name for a cheap, bounded proof run (also the way to measure the window cost before committing to the full sweep).

## Cost shape (Max plan)
No per-token dollars; it consumes the 5-hour usage window and can dent the weekly cap. A full ~26-project run fans out ~1 auditor per project + adversarial verifiers + synthesis, and can run long. **Before a full run, state the scope and that it may saturate the window, and give the owner the scoped-proof option.** A killed run resumes from disk (see Resumability).

## The workflow (dynamic-workflow / Agent fan-out)
1. **Enumerate scope from the registry.** `system/manifest.json` is the claim source of truth (states, triggers, one-liners, schedule_jobs, n8n IDs, first_fire, hq_project). Build the in-scope project list. The manifest's claims ARE what is on trial.
2. **Fan out one auditor per project (parallel where the harness allows).** Each auditor receives its project's manifest row and verifies every claim against ground truth, reporting per claim `VERIFIED | DRIFT | CANNOT-VERIFY` with the evidence:
   - Does `work/NN/` code exist and actually do what the one-liner claims?
   - Is the `state` honest (a LIVE project that has not produced; an ON-DEMAND with a dead command)?
   - **n8n projects:** is the workflow `active:true` on the live API right now (the 07-10 gap)? Does the ID resolve?
   - Do the `schedule_jobs` exist in Task Scheduler? Does the cadence match reality?
   - Is `first_fire` real (measured/drill) or modeled? Is `hq_project` pushing or honestly idle?
   - Do the connected surfaces agree (status.md last_run, docs, routing table, index.md)?
   Each auditor timeboxes its lane: reasonable effort, then report what it could not verify rather than digging forever. An empty lane is a finding.
3. **Adversarial pass (the part the weekly review lacks).** A refuter set takes the auditors' `VERIFIED` claims and tries to prove them false from ground truth. A claim survives only if the refuter cannot break it with an external/system fact. Same evidence-anchored refutation discipline as #04's Adversarial Verification Mode: dissent must cite a fact (a live API read, a file, a schtasks query), never model reasoning alone.
4. **Converge + synthesize (master).** Resolve disagreements by recomputing against ground truth, never by picking a side. Produce a ranked findings report: DRIFT (claim vs reality, ranked by severity), CANNOT-VERIFY, and CLEAN. Every finding cites the file + the exact mismatch. The master does not dissolve a genuine UNRESOLVED into a tidy answer.
5. **Output + hand to the gated fix loop.**
   - `outputs/deep-audit/YYYY-MM-DD/report.md` (+ a ledger row via `node scripts/outputs-ledger.js add`).
   - `vault/projects/self-review/deep-audit-YYYY-MM-DD.md` (the findings, [[wiki links]], feeds the weekly review).
   - DRIFT findings enter #23's normal **propose -> approve -> apply** loop. Nothing is auto-fixed. Generated-surface drift (routing table, docs) is fixed by editing `system/manifest.json` then running the generator, NEVER by hand-editing between the markers. Identity-file changes stay gated exactly as in `/self-review`.

## Guardrails
- **Honesty law binds it.** No invented findings; every DRIFT cites the file + mismatch; unknown stays CANNOT-VERIFY, never upgraded to a guess.
- **Finds + proposes, never auto-fixes.** Same hard gate as #23: soul.md / any CLAUDE.md change is proposed and applied only on the owner's yes.
- **Resumability.** Write each project's per-lane result to `outputs/deep-audit/YYYY-MM-DD/partial/{project}.json` as it lands, so a killed or window-capped run resumes from disk instead of restarting the fan-out.
- **Verify-after-write.** Any live read (n8n API `active` flag, schtasks) is a READ; this audit mutates nothing. If a follow-on fix mutates an external system, the standing Verify-after-write order applies to that fix, not to the audit.

## What it is NOT
- Not a replacement for the daily/weekly cheap checks (#18 recovery checker, weekly `/self-review`, the close-out-grader). Those stay; this is the deep sweep on top.
- Not scheduled. Firing it is a deliberate, window-spending act.
- Not a fixer. It produces a gated findings report; humans and the gated propagation flow apply.

## Relationship to the rest of #23
`/self-review` = weekly, cheap, reasons over the correction/error/close-out trail and proposes rule/voice/taste upgrades. `/deep-audit` = on-demand, heavy, adversarially verifies the whole system's claims against ground truth and proposes drift fixes. Both feed the same gated propose/approve/apply loop and the same weekly learning surface. The close-out-grader (separate-context, per-artifact) is the third quality tool in this project.
