# Alex Reviews Alex (Self-Review)

## Type
Automation (MONTHLY, on the 1st, plus on-demand `/self-review`).

## Purpose
Turns Alex's learning loop from passive filing into an active habit. Once a month Alex reads its own trail since the last review: the new corrections (from #22, the corrections-log), the error-log entries, the close-out reports that came back INCOMPLETE, the phrasing added to soul.md My Words, and it looks for patterns. Then it writes a short self-review in plain words, what it got wrong or learned this week, and the exact changes it proposes to its own rules (CLAUDE.md), its voice (soul.md), or its taste (taste-profile). the owner approves / edits / rejects each item, and ONLY then does Alex apply the change and log it. This is the moat: the coherence layer that keeps a year-long agent improving instead of rotting, and a rare "AI that upgrades itself, behind a human gate" to show.

## Entry Points
- **Scheduled: MONTHLY, on the 1st.** Registered as `Alex-self-review`.
- **On-demand:** `/self-review` any time.
- **On-demand, heavy, and DISABLED by default:** `/deep-audit [scope]`, the adversarial whole-system
  audit. Never scheduled, and it should refuse a casual invocation: on a Claude Pro plan it can
  spend most of a day's allowance in one run, and the symptom is not an error message, it is Alex
  refusing to do anything else until the limit resets.

## Why monthly, and why scheduled at all

Both halves of that were decided against alternatives, so both are written down rather than left as
a number somebody can change without knowing what it was protecting.

**Why not on-demand.** Because nothing else drains the queue. `scripts/lesson-harvest.js` collects a
lesson from every run, every night, automatically. The review is the only thing that reads that
queue and proposes a rule from it. Two owners who are not going to type `/self-review` unprompted
would therefore accumulate a growing pile of observations that nothing ever acts on, and the promise
this whole system makes is that a correction sticks. An unscheduled review quietly breaks that
promise while every surface still reads green.

**Why not weekly.** This is a reasoning-heavy run over a month of history. On a Pro plan the
allowance is the binding constraint, and a weekly review for two light users spends allowance they
would rather have for their actual work. The failure mode there is not a broken system, it is a
system that is mysteriously unavailable on Thursday afternoons.

**Why monthly is the right size.** It drains the queue often enough that a pattern is still recent
enough to act on, it matches the `/lint` cadence already in the system so the two land together, and
it costs little enough that the plan carries it without the owner noticing.

**What it must never do.** Propose is the verb. It clusters, it names the instruction behind a
repeated correction, and it writes a proposal. It does not edit the constitution, it does not edit
`soul.md`, and it does not apply its own suggestions. A system that rewrites its own rules on the
strength of its own analysis has removed the only reviewer it had.

## What a run does

**Input stance (framing, 2026-07-15, /prompting item 1).** The review reads its inputs as EXTERNAL RETRIEVED EVIDENCE about the system's behaviour (a log pulled from the record), not as Alex's own recollected reasoning. Audit the trail the way a fresh third party would: no loyalty to the prior decision, willing to name the instruction or habit that caused it. Reflexive "here is what I did, find my pattern" framing suppresses explicit self-correction; external-evidence framing lifts it. Envelope only (the gather/cluster/propose/gate logic below is unchanged), reversible, and made on the argument, not on a measured lift (preprint, math/logic; close-out pattern-clustering is an untested domain). The command file `.claude/commands/self-review.md` carries the same stance verbatim. Note: /deep-audit already reads external by construction (per-project fan-out + adversarial refuters anchored in ground truth), so this change is /self-review only.

1. **Gather the diff** since the last review: new corrections in [[projects/teach-alex/corrections-log]] (#22), new `vault/projects/error-log.md` entries, INCOMPLETE close-out reports from [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), `vault/me/decisions.md` changes, and the week's **`work/**/CLAUDE.md` spec changes** (git diff) - the manifest-entry review nudge (added 2026-07-21, audit F-02/Class B): for each changed spec confirm its `system/manifest.json` one_liner/state/trigger/commands still match, since recovery check C10 no longer raises committed spec edits as "manifest-stale" drift (it now flags only UNCOMMITTED spec edits; committed = accepted). A mismatch becomes a proposed manifest edit; a match is a one-line note.
2. **Cluster** into themes (a recurring voice slip, a wrong contact label, a formatting miss, a repeated failure).
3. For each theme, **draft a concrete proposed change:** the exact file + the exact old -> new text + a one-line rationale + the correction/error it came from.
4. **Write** `vault/projects/self-review/YYYY-MM-DD.md`, then present the proposals in the session and name the file path. That IS the approval surface: no dashboard, no card, no row.
5. the owner **approves / edits / rejects** each item.
6. On approval, Alex **applies** the change through Change Propagation and logs it. Nothing applied without approval.

## The hard rule (the whole point)
Alex NEVER self-edits soul.md or any CLAUDE.md without the owner's explicit approval. Proposing is automatic; applying identity-file changes is gated, always. Low-risk classes (a My Words phrase already confirmed via #22) may be pre-approved, but soul.md / CLAUDE.md edits are never auto-applied here.

**CHEAP-FIX CARVE-OUT (2026-08-28).** A proposal that names a real defect and then waits in a queue nobody works is indistinguishable from never having noticed the defect. That is not hypothetical: upstream, a correctly diagnosed gate hole sat unapproved for 25 days and the exact miss it predicted then happened again. **If you are the only person who reviews this, that queue is even less likely to get worked, so the carve-out matters more here, not less.**

**APPLY on sight, no ask, then tell the owner:** a fix that makes an ALREADY-AGREED rule actually fire (naming an existing obligation's surface in the gate meant to enforce it, wiring a checker to a rule that already exists), or that repairs a factual error in an identity file (a dead path, a moved or renamed file, a broken link, a count that contradicts the table above it).

**STILL GATED. Never apply without the owner's explicit yes:** anything that changes what a rule SAYS (a new rule, a relaxed rule, a moved threshold, a dropped requirement); soul.md Voice Rules and any pinned register; brand colour or font law; anything that alters how the owner's voice reads or what ships under their name.

**The test: does the fix change what a rule says, or only whether an agreed rule fires?** Only the second is cheap. **If you cannot tell which, it is gated.** A cheap fix is still fully propagated and reported; "no ask" never means "no telling".


## Close-Out Grader (separate-context, item C) - added 2026-07-07 (upgrade-scan item 2)
The kit in `work/23-self-review/close-out-grader/` (rubric.md + grader-prompt.md + README.md) implements
Anthropic's Outcomes pattern for Close-Out item C: a fresh subagent that sees ONLY the finished
identity-carrying artifact + the rubric, never the producing session's reasoning, and returns
per-criterion PASS/FAIL (palette / accent / type / red / logo; dashes / AI-tells / softeners / rhythm /
the owner's words; pre-flight). It fixes the self-grading bias that let the 2026-07-03 brand incident ship.
**ADVISORY ONLY, hard constraint:** it flags, it never blocks a run; it is deliberately NOT wired into
`scripts/lib/close-out.ps1`, so a grader FAIL / slow grader / unavailable grader can never fail one of
the 15 scheduled jobs. Invoked via the Agent tool (Alex's existing inline-subagent convention, no new
Claude Code config). Verified 2026-07-07 against a reconstructed 07-03 violator (FAIL) + a compliant
artifact (PASS). #23 owns the kit because it owns the review/quality surface; the invocation is global
(every session's item C), driven from the root CLAUDE.md Close-Out Gate.

## Deep Audit (on-demand adversarial repo audit) - added 2026-07-14 (dynamic-workflows build)
The heavy on-demand sibling of the weekly review. `/deep-audit [scope]` fans out one agent per project and makes each prove the project's manifest CLAIMS (state, "does what the one-liner says", n8n `active:true` on the live API, schedule_jobs exist, first_fire real, connected surfaces agree) match GROUND TRUTH, then an adversarial pass tries to break every "verified" verdict from a cited system fact. It catches the "file says X, reality is Y" drift class that #18's pattern-checker and the cheap weekly review structurally miss (proven by the 07-10 silent dual-engine deactivation, the stale deployed-inactive note, the recurring audit-null corrections in commits). **Never scheduled** - on Max it spends the usage window; a full ~26-project run is the quarterly deep sweep, scope it to one project for a bounded proof. **Finds + proposes only:** DRIFT enters #23's gated propose/approve/apply loop (generated-surface drift is fixed via `system/manifest.json` + the generator, never hand-edits between markers; identity files stay gated exactly like `/self-review`). Full spec + workflow: `work/23-self-review/deep-audit/README.md`. It is the whole-repo sibling of #04's single-claim Adversarial Verification Mode (shared evidence-anchored refutation discipline: dissent must cite a fact, never model reasoning alone).

## Diagnose (instruction attribution) - added 2026-07-15 (/prompting item 4)
The batched sub-step that asks WHICH instruction caused a correction, so #23 stops treating symptoms. Runs inside the weekly review. Split per the model-routing rule: DETERMINISTIC `work/23-self-review/diagnose/diagnose.js` (`corpus` bounds the candidate set to root CLAUDE.md + soul.md + the relevant work/NN/CLAUDE.md; `record` writes a diagnosis behind a hard **>=80 confidence gate**; `resolve` scores it at 60 days by asking "did this class recur after the patch?"), and one REASONING pass (Alex, `claude-sonnet-4-6`, NO voice block) that reads the bounded corpus and names the culprit with a quoted span + file:line + confidence. Below 80 -> "no attributable instruction" (the common, honest case, still recorded). At/above 80 -> a **gated proposal** to `system/human-actions.jsonl`.
**Hard rule (by construction):** diagnose writes ONLY to `vault/projects/self-review/diagnoses.jsonl` + the human-actions queue. It NEVER edits CLAUDE.md or soul.md ([[me/NEVER-TOUCH]]); the constitution changes only when the owner edits the source + regenerates. Ships WITH its resolver in the same pass (a diagnoser without a resolver would be an unchecked semantic surface, the exact thing this refuses to add). Limits stated plainly: most errors will not trace to a line; the resolver is slow (~a dozen resolved rows/year, a signal never a scoreboard); it cannot diagnose an error nobody reported. Full spec: `work/23-self-review/diagnose/README.md`. Proven by drill 2026-07-15 (all four subcommands + both resolver branches, against temp files; real record clean, corrections-log still empty so nothing to diagnose yet).

## Data / infra it uses (all live)
Git history (weekly diff of the identity files), `vault/projects/error-log.md`, [[projects/teach-alex/corrections-log]] (#22), [[projects/self-review/close-out-log]], soul.md My Words, `vault/me/decisions.md`, `vault/me/taste-profile.md`, the vault, Notion (approval rows), Alex HQ (approval card). No new external service; this is reasoning over files that already exist.

## Approval surface
Phase 1: the self-review doc itself + the owner approves inline (or a small "Alex Improvements" Notion view / an Alex HQ card). Phase 2: approve-in-HQ with auto-apply on approval for safe classes.

## Vault Structure
- **Tier 1:** `vault/projects/self-review/status.md`.
- **Tier 2:** `vault/projects/self-review/YYYY-MM-DD.md` (one per review) + `close-out-log.md` (the INCOMPLETE-verdict persistence the Close-Out Gate appends to).

## Vault Reads
error-log.md, teach-alex/corrections-log, self-review/close-out-log, soul.md (+ git diff), decisions.md, taste-profile.md, log.md.

## Vault Writes
The self-review doc; on approval, the target identity/rule/taste files (via Change Propagation) + log.md; status.md; index.md.

## Guardrails
Proposes, never applies identity-file changes without approval. Fabricates nothing; every proposed change cites the correction/error it came from. If nothing meaningful accumulated in a week, says so plainly (a quiet week is a valid result), never invents proposals to look busy.

## Model Routing
Claude for the clustering and the reasoning. **claude-sonnet-4-6 fed from soul.md** for the human-readable weekly summary line written into the Monday brief (prose model per the model-routing rule, corrected 2026-07-08). *(Corrected 2026-07-29, architecture review: this line still said "OpenAI + soul.md" three weeks after the rule changed. #21 and #22 carry the same correction from 07-08 and 07-14; #23 was the one that got missed. The enforced contract is `meta.model_routing` in `system/manifest.json`, which names no OpenAI anywhere, and the wrapper `scripts/run-self-review.ps1` pins `--model claude-sonnet-4-6`, so this file was the only surface still advertising a forbidden provider.)*

## Connections
- **Fed by:** #22 Teach-Alex (corrections-log), error-log, close-out-log, soul.md My Words, decisions.
- **Feeds into:** soul.md, CLAUDE.md (root + work), taste-profile, decisions.md, the Monday brief ("what Alex learned this week"), a Building Alex episode.

## Close-Out Extras
- Every review cites its sources; proposals cite their origin correction/error.
- Nothing applied without approval; applied changes go through full Change Propagation + log.
- The close-out-grader kit stays ADVISORY: never add it to scripts/lib/close-out.ps1 or gate any run on it.

## Phasing
- **Phase 1 (now):** the weekly proposal doc, the owner applies approved items; the general taste-profile + close-out-log seeded so the inputs actually exist. A first self-review proof written.
- **Phase 2:** approve-in-HQ + auto-apply on approval for safe classes + the "what Alex learned" brief line.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 01 via `/new`. Persistence gaps the earlier validation flagged are CLOSED: a general `vault/me/taste-profile.md` and `vault/projects/self-review/close-out-log.md` created, and the Close-Out Gate now appends INCOMPLETE verdicts to that log. First self-review proof doc written. Weekly Sunday 20:00 pending /cron-setup.
