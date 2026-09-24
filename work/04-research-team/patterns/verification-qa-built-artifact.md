---
class: verification
created: 2026-07-04
last_used: 2026-07-04
times_used: 2
---
# Verify a built artifact (QA a script/system already shipped)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

"Is this thing I just built actually correct and complete?" - a post-build QA of code + its outputs,
NOT a concept validation (that's decision-brief) and NOT a design (that's technical-evaluation). Three
parallel lanes, each answering a different truth question, so no single perspective self-certifies.

## When it fits
A concrete artifact exists on disk (a checker, a pipeline, a generator) and you want independent
confidence it is correct, robust, and its outputs are true - before you rely on it as a standing tool.

## Team (3 lanes, parallel)
1. **Static auditor** (read-only): read the code line by line. Per feature/check: is the logic right?
   false-positive and false-negative risks, language gotchas, invariants (does it honor its own
   contracts - idempotence, safety, "detect-never-repair", secret-handling), exit codes, and
   **restore/portability** (hardcoded paths, machine coupling). Cite line numbers + severity.
2. **Dynamic edge-case tester** (ISOLATED fixture, never the real tree): build a minimal synthetic
   fixture that mirrors what the artifact expects, run a copy of it (repoint any hardcoded root) against
   the fixture, inject ONE fault per feature and assert it fires + stays silent on clean + no co-firing.
   Crash-test empty/unicode/malformed inputs. Report a per-feature fired? table.
3. **Findings verifier + false-negative hunter** (read-only): independently RE-DERIVE each output the
   artifact produced (don't trust its own report) to confirm true positives, then hunt for what it
   MISSED - uncovered classes from the design, real drift on disk it didn't flag, and self-referential
   bugs (does it measure/consume its own output?).

## Synthesizer
Merge into MUST-FIX / SHOULD-FIX / NICE-TO-ADD / DEFERRED. Weight convergence: a defect all three lanes
imply is real. Separate "the artifact is trustworthy to use now" from "the artifact needs work" - both
can be true (PASS-WITH-CONCERNS is the common verdict for a v1).

## Lessons
- **Reuse 1 (2026-07-04, recovery-layer checker):** the dynamic lane is the high-signal one - an isolated
  fixture proved all 10 checks fire in isolation with zero co-firing, which static reasoning alone can't.
  The findings-verifier caught the two things static + dynamic both missed: a self-pollution bug (the
  checker counted its own report) and a mislabeled aggregate finding hiding distinct real problems. Key
  move: give the dynamic lane a HARD constraint to work only in scratch (repoint the hardcoded root) so
  it can't corrupt the very thing under test. Best synthesis insight: the sharpest defects were the
  artifact re-committing the exact sins it was built to prevent (a recovery tool that can't survive a
  restore or announce its own failure) - look for that self-referential class explicitly.
- **Reuse 2 (2026-07-04, recovery GC content-QA):** works for a content/GC task, not just code. Swap the
  dynamic-fixture lane for a **new-page accuracy verifier** (re-derive every claim against sources) when the
  artifact is reconstructed pages, not a script. That lane caught a fabricated number (a borrowed interest
  score) and under-read trip dates that the decision + completeness lanes both missed. Rule: decision +
  completeness lanes verify the *judgment*; a dedicated accuracy lane verifies the *facts*, and they catch
  different failure classes, so keep both.
