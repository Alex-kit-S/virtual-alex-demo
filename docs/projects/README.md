# The Projects - Plain-Language Guide

One file per project in the Personal Ops System: **what it actually does, why it exists, and which other projects it works with.** Written for a non-technical reader. The table below is GENERATED from the project registry (`system/manifest.json`) by `scripts/generate-alex.js`, so it cannot drift by hand (since 2026-07-06; unified generator since 2026-07-08).

The system in one paragraph: the owner runs a personal AI agent ("Alex") that keeps a markdown knowledge base (the vault) and a handful of projects that feed it. The projects feed each other: the email triage feeds the morning brief, everything writes what it learns into the vault, and the weekly self-review reads all of it. The technical specs live in `work/{NN}/CLAUDE.md`; the project registry is `system/manifest.json`.

<!-- PROJECT-TABLE:BEGIN (generated from system/manifest.json by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->
| # | Project | State | One line |
|---|---------|-------|----------|
| 02 | [Morning Brief](02-morning-brief.md) | ON-DEMAND | The on-demand brief: overnight mail from #07, today's calendar, what you are waiting on, what is waiting on you, and any notes you left yourself. Type /morning-brief when you want it. |
| 04 | [Research Team](04-research-team.md) | ON-DEMAND | Adaptive multi-agent research squads for EXTERNAL evidence, plus an evidence-anchored Adversarial Verification Mode (verify: a claim, refuters grounded in external facts, converge to CONFIRMED/REFUTED/UNRESOLVED, never consensus-laundered). Capped at 3 parallel lanes. |
| 06 | [Meeting Intel](06-meeting-intel.md) | ON-DEMAND | Drop any file in (text, PDF, VTT, audio, image) and get a transcript, the decisions, the action items and a structured note. Also builds a one-page dossier before a meeting. |
| 07 | [Email Triage](07-email-triage.md) | LIVE | Inbox triage once each morning plus voice-matched reply drafts behind the Draft Gate; learns from the edits you make. The only scheduled reasoning job in the system. |
| 15 | [Radar](15-radar.md) | LIVE | The staying-current engine: once a week it sweeps the feeds you chose, scores what it finds against your own taste and your own friction list, and hands you the one or two things worth acting on. It proposes; you decide. Nothing is ever installed, built or bought on its own say-so. |
| 18 | [Recovery Layer](18-recovery-layer.md) | LIVE | Backups (git plus an encrypted vault tar to your own Drive), the zero-token drift checker, the status rotation caps, and the Recall Spine fact ledger. This is the layer that notices when something quietly stopped working. |
| 22 | [Teach-Alex](22-teach-alex.md) | EVENT | Ten-second corrections: tell Alex it got something wrong, and the correction is classified, filed, confirmed for identity files, and logged so /self-review can spot the pattern. |
| 23 | [Self-Review](23-self-review.md) | LIVE | Alex reviews Alex once a month: clusters the corrections you made, the errors that happened and the runs that closed incomplete, then proposes changes behind your approval. Also /deep-audit, the whole-repo adversarial sweep, which is DISABLED by default because on Claude Pro it can spend most of a day. |
| 26 | [Prompting](26-prompting.md) | ON-DEMAND | The translator function: say what you want in plain English, get back a lean CONTEXT/INPUT/OUTPUT prompt for Claude Code, with an overlap check against what this system already does. |
<!-- PROJECT-TABLE:END -->

Maintained under the Change Propagation standing order: when a project changes for real, its file here changes in the same session.
