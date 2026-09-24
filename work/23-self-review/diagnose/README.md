# Diagnose - instruction attribution for #23 self-review

**Built 2026-07-15 (/prompting item 4). A feature of #23, runs inside the Sunday /self-review, batched.**

## The gap it closes
#22 teach-alex captures THAT Alex was wrong. #23 self-review clusters the corrections. Neither asks WHICH instruction caused the error, so corrections treat symptoms and the same class returns wearing different clothes. Diagnose names the most likely culprit instruction for a correction, behind a hard confidence gate, and **proposes** a fix. It never edits the constitution.

## The split of labour (matches the model-routing rule)
- **Deterministic (`diagnose.js`, zero Claude calls):**
  - `corpus --project <name>` - bound the candidate instruction set to root `CLAUDE.md` + `soul.md` + the relevant `work/NN/CLAUDE.md` (+ the Skill Bindings table, inside root CLAUDE.md). Small, bounded, no AI. The reasoning step may cite ONLY from this set.
  - `record ...` - write a diagnosis behind the >=80 gate and, if attributed, emit the gated proposal to `human-actions`.
  - `resolve` - at 60 days, ask the world "did this correction class recur after the patch?" and score it.
  - `stats` - counts + the one number nothing else in Alex has: how often the diagnoser was right.
- **Reasoning (Alex in the /self-review run, `claude-sonnet-4-6`, NO voice block):** read the bounded corpus, name the culprit with a quoted span + `file:line` + confidence 0-100. Not writing for a human, so it is a reasoning node (no voice block). That single judgement is fed back into `record`.

## The flow (per new correction, batched weekly)
1. `node work/23-self-review/diagnose/diagnose.js corpus --project <project the correction touches>` -> the bounded file list.
2. Alex reads those files and names the culprit instruction: a quoted span, `file:line`, confidence 0-100. If nothing in the set plausibly caused it, confidence stays **below 80**.
3. `node .../diagnose.js record --correction "<ref>" --class <voice|fact|person-label|rule|format|behavior|ambiguous> --file <path> --line <n> --span "<quote>" --confidence <n> [--proposal "<fix>"]`
   - **confidence >= 80:** recorded `open`, `resolve_by` = +60 days, and a **gated proposal row** is queued in `system/human-actions.jsonl` (severity low). Alex proposes; the owner edits the source + regenerates. **Never auto-applied.**
   - **confidence < 80:** recorded `no-attribution`, nothing proposed. This is a legitimate, common answer, and recording it is how we SEE that most errors do not trace to a line.
4. `node .../diagnose.js resolve` (also weekly): for each open diagnosis past `resolve_by`, checks the append-only corrections-log for a NEW correction of the same `class` after the diagnosis date. `recurred=true` means the class came back (the diagnosis likely missed, or the fix was never applied); `recurred=false` is consistent with a correct diagnosis IF the fix was applied.

## The hard rule (enforced by construction)
Diagnose writes **ONLY** to the diagnoses log (`vault/projects/self-review/diagnoses.jsonl`) and the `human-actions` queue. It **NEVER** edits `CLAUDE.md` or `soul.md`. The constitution is hand-authored law ([[me/NEVER-TOUCH]]); it changes only when the owner edits the source + regenerates (the #23 gated propose/approve/apply loop). Auto-patching the law from a semantic inference with no oracle is the single worst thing that could be built here, so it is not built. The script is structurally incapable of it.

## The part that makes it self-checking
A diagnosis is a prediction: this instruction caused this class, so patching it should stop the class. That is checkable without a human, and the world resolves it at 60 days. Over months `stats` produces how often the diagnoser is right. It needs no oracle.

## What it cannot do (say it plainly)
- **Most errors will not trace to an instruction.** They trace to a missing instruction, an ambiguous one, or nothing. Below the gate the honest output is "no attributable instruction", and that is the common case.
- **The resolver is slow.** 60 days per verdict, only for diagnoses acted on. A year is ~a dozen resolved rows: enough to notice a usually-wrong diagnoser, nowhere near enough to tune one. It is a signal, never a scoreboard.
- **It cannot diagnose an error nobody reported.** Its whole world is the corrections you bothered to make. Its blind spot is exactly your blind spot.
- **`recurred=false` is not proof the diagnosis was right** unless the proposed fix was actually applied. `resolve` records `applied` (was the proposal's human-action closed) and only scores applied+resolved diagnoses.

## Records
- `vault/projects/self-review/diagnoses.jsonl` - append-only, latest-per-id wins (a `resolve_event` row supersedes its diagnosis). Created on the first real diagnosis. Currently empty by design: the corrections-log is empty, so there is nothing to diagnose yet (proven by drill 2026-07-15 against temp files; real record clean).
- Gated proposals -> `system/human-actions.jsonl` (the "waiting on you" queue).
- Env overrides for tests/drills: `ALEX_DIAGNOSES_LOG`, `ALEX_CORRECTIONS_LOG`.
