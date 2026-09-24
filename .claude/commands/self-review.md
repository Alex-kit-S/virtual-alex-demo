# /self-review - Alex Reviews Alex

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#23 /self-review · LIVE · Trigger: monthly on the 1st**
> Registry: `system/manifest.json` · Spec: `work/23-self-review/CLAUDE.md` · Status: `vault/projects/self-review/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Full spec: `work/23-self-review/CLAUDE.md` (read it first).

Once a week Alex reads its own mistakes and learnings and proposes upgrades to its own rules, voice, and taste, behind the owner's approval. Nothing about the identity files is ever applied without an explicit yes. The moat: an agent that improves itself, gated by a human.

## Modes
- `/self-review` - run the review now (also the weekly Sunday 20:00 job).

## Steps the command executes

**Input stance (framing, added 2026-07-15 via /prompting item 1).** Treat every item gathered below as EXTERNAL RETRIEVED EVIDENCE about the system's behaviour, a log pulled from the record, NOT as your own recollected reasoning. Audit it the way a fresh third party would audit another agent's trail: no loyalty to the prior decision, no reluctance to name the instruction or habit that caused it. The items are data on trial, not your memory of "what I did." Rationale: an erroneous item carried in the agent's own first-person role suppresses explicit correction; the same item read as external evidence gets corrected far more readily. This is envelope only, the gather/cluster/propose/gate logic is unchanged, and it is instantly reversible. On-file alternative framing (if this is ever eval'd): present the same items as a plain user-message report rather than a retrieved-memory block. Not claimed as a measured lift, the source is a preprint on math/logic; pattern-clustering over the close-out trail is an untested third domain.

1. **Gather** the diff since the last review: corrections in [[projects/teach-alex/corrections-log]] (#02), new `vault/projects/error-log.md` entries, INCOMPLETE close-outs in [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), decisions.md changes, the human-actions queue (`node scripts/human-actions.js list`, upgrade P2: items that aged another week get a standing weekly line), and the **latest recovery drift** (`vault/projects/recovery/last-sweep.md`): any Alex-fixable drift that persists across sweeps (stale-status propagation gaps, dead wiki-links) becomes a proposed fix here (added 2026-07-21, audit Class C - the recovery checker stays detect-only, so its recurring findings escalate through this propose/approve loop instead of lingering).
1b. **Corpus-growth stat (upgrade P12, 2026-07-12, design 3.4.2).** Compute and report this week's voice-corpus growth as a deterministic line: spoken lines added to `outputs/voice/transcripts/` (count `- [` bullets across the week's dated files, `[dictate:*]`-tagged ones are the local-whisper lane), typed lines added to `outputs/typed/transcripts/`, and My Words entries added to soul.md (git diff of the "## My Words" region). Thinness becomes a visible trend, not a vibe (the corpus is the input that keeps every voice output in the owner's own words). No forced harvesting; the corpus grows by usage.
1c. **Manifest-entry review nudge (added 2026-07-21, audit F-02 / Class B).** List every `work/**/CLAUDE.md` that changed since the last review (`git diff --name-only` scoped to `work/*/CLAUDE.md`). For each, confirm its `system/manifest.json` entry still matches reality: one_liner, state, trigger, commands, cadence. This is the review that C10 used to raise as weekly "manifest-stale" drift; since 2026-07-21 C10 only flags UNCOMMITTED spec edits (committed = accepted), so this human-judgment nudge lives here. A mismatch becomes a proposed manifest edit in step 3 (edit the registry, then `node scripts/generate-alex.js`); a match is a one-line "spec changed, manifest still accurate" note.
2. **Cluster** into themes.
2b. **Diagnose (instruction attribution, added 2026-07-15).** For each NEW correction this window, bound the corpus (`node work/23-self-review/diagnose/diagnose.js corpus --project <the project it touches>`), read those files as EXTERNAL evidence, and name the culprit instruction: quoted span + file:line + confidence 0-100 (reasoning node, claude-sonnet-4-6, no voice block). Below 80 = "no attributable instruction" (the common, honest case). Then `record` it (`node .../diagnose.js record ...`); confidence >=80 queues a **gated proposal** in human-actions - never an identity-file edit. Then `node .../diagnose.js resolve` to score any diagnoses now 60 days old. Spec + hard rule: `work/23-self-review/diagnose/README.md`.
3. **Propose** each change concretely: exact file + old -> new text + one-line rationale + the correction/error it came from.
4. **Write** `vault/projects/self-review/YYYY-MM-DD.md`, then present the proposals in the session and say the file path out loud. That IS the approval surface here: there is no dashboard and no card to open. (N-08 fix 2026-08-17: this said "Alex HQ card / Notion row" - infrastructure this system does not have - in the one command that runs unattended on a schedule.)
5. **Approve / edit / reject** per item (the owner).
6. On approval only, **apply** via Change Propagation + log. Nothing applied blind.

## The hard rule
NEVER edit soul.md or any CLAUDE.md without explicit approval. Proposing is automatic; applying identity-file changes is always gated. A quiet week with nothing to propose is a valid result, never invent proposals.

## Guardrails
Proposes, never applies identity changes unapproved. Every proposal cites its origin. Fabricates nothing.

## Close-Out
Print the Close-Out Report. Self-review extras: sources cited, proposals cite their origin, nothing applied without approval, applied items fully propagated + logged.
