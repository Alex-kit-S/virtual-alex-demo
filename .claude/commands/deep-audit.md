# /deep-audit - Deep Adversarial Repo Audit

> ## DISABLED BY DEFAULT. READ THIS BEFORE RUNNING IT.
>
> This command is thorough in a way that costs real money on a Claude Pro plan: it fans out one agent
> per project and re-derives ground truth for the whole repository. On a larger plan it spends a
> usage window. On Pro it can spend most of a day's allowance in one run, and the symptom you will
> see is not an error, it is Alex refusing to do anything else until the limit resets.
>
> **Nothing here needs it.** The weekly system check (`work/18-recovery-layer/check.ps1`) is
> zero-token and catches the same class of drift. `/self-review` covers the judgment half.
>
> If you genuinely want it, say so explicitly and out loud: "run deep-audit, I know it costs a lot".
> Alex should refuse a casual invocation and offer the status command or the system check instead.


<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#23 /deep-audit · LIVE · Trigger: monthly on the 1st**
> Registry: `system/manifest.json` · Spec: `work/23-self-review/CLAUDE.md` · Status: `vault/projects/self-review/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Full spec: `work/23-self-review/deep-audit/README.md` (read it first). Owned by #23 (the review / quality surface).

On-demand ONLY. Fans out one agent per project and makes each prove the manifest's CLAIMS match ground truth, then an adversarial pass tries to break every "verified" verdict. Catches the "file says X, reality is Y" drift class the cheap checks (#18 recovery, weekly /self-review) structurally miss. **NEVER scheduled.**

## Usage
- `/deep-audit` - full sweep, every project in `system/manifest.json`.
- `/deep-audit {project|subsystem}` - scoped, bounded proof run (also how to measure the window cost before committing to the full sweep).

## Before a full run
On Max this spends the usage window and a ~26-project sweep can saturate the 5-hour limit and stall Alex's other work until it resets. State the scope and the window risk, and offer the scoped-proof option, BEFORE fanning out.

## Steps (spec is authoritative)
1. Enumerate scope from `system/manifest.json` (the claims on trial).
2. Fan out one auditor per project: verify each claim (state honest, one-liner does-what-it-says, n8n `active:true` on the live API, `schedule_jobs` exist in Task Scheduler, `first_fire` real, connected surfaces agree) -> `VERIFIED | DRIFT | CANNOT-VERIFY` + evidence. Timebox each lane; an empty lane is a finding.
3. Adversarial pass: refuters try to break every VERIFIED verdict, each attack anchored in a cited system fact (a live API read, a file, a schtasks query), never model reasoning alone.
4. Converge (master; recompute against ground truth, never average a genuine split) -> ranked `DRIFT / CANNOT-VERIFY / CLEAN` report, every finding cites file + exact mismatch.
5. Output: `outputs/deep-audit/YYYY-MM-DD/report.md` (+ `node scripts/outputs-ledger.js add` row) + `vault/projects/self-review/deep-audit-YYYY-MM-DD.md`. DRIFT enters #23's gated propose/approve/apply loop.

## Guardrails
Honesty law binds it (no invented findings; unknown stays CANNOT-VERIFY, never upgraded to a guess). Finds + proposes, NEVER auto-fixes. Generated-surface drift is fixed via manifest + generator, never hand-edits between markers. Identity files gated exactly like /self-review. Resumable (per-project partials to `outputs/deep-audit/YYYY-MM-DD/partial/`). The audit mutates nothing; Verify-after-write applies to any follow-on fix, not the read-only audit.

## Close-Out
Print the Close-Out Report. Deep-audit extras: report written to outputs/ + ledger row; findings page in vault; every finding cites file + mismatch; DRIFT handed to the gated loop, nothing auto-applied.
