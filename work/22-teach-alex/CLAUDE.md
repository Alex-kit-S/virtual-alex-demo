# Teach-Alex Button

## Type
Automation (event-driven: a note dropped in `inbox/`, plus a sweep at every touchpoint, plus
on-demand).

## Purpose
Correcting Alex should take ten seconds and should stick forever. Say "you filed Lena as a
recruiter, she is HR, fix it" or "that draft was too formal, I say deal not engagement", and Alex
works out what kind of correction it is, files it in the right place, shows the exact edit, applies
it once confirmed, and tells you what changed. Every correction is logged so `/self-review` can spot
the pattern behind a run of them.

**This is the verb the whole system compounds on.** Nothing else here turns a moment of annoyance
into a permanent rule.

## Entry Points, and this is the part that was rebuilt

1. **Drop a note in `inbox/`.** Any plain text or markdown file. One correction per file, or one per
   line, whichever is easier. This is a plain folder on disk, so it works from a phone via any
   file-sync app, from a text editor, from anywhere.
2. **Say it in a session.** `/teach-alex "<correction>"`, or just say it. Alex should notice a
   correction without being told it is one.
3. **The touchpoint sweep.** `/morning-brief` and `/status` both check `inbox/` for correction-shaped
   notes and route them here.

**What changed and why it matters.** The original entry point was a two-way inbox table living
inside a dashboard project backed by a hosted automation server. None of that exists here, so a
correction dropped into it would have gone nowhere at all. A folder on disk has no moving parts, no
account, nothing to expire, and nothing to pay for. **The trade is real and should be stated: with
`/morning-brief` on demand rather than on a schedule, there is no automatic watcher on `inbox/`.**
`/status` and `/morning-brief` both sweep it, and both are things a human types. A note left in
`inbox/` waits until one of them runs.

## The correction classifier (the core logic)
Given a note, classify it into ONE type and route it:
- **voice / phrasing** ("I say deal not engagement") -> `soul.md` "My Words", date-stamped.
  CONFIRM before applying: this is an identity file.
- **fact / person-label** ("Lena is HR, not a recruiter") -> the relevant `vault/people/` or
  `vault/business/` page, and fix inbound links per the People Intake Protocol. Applies
  automatically when the target is unambiguous; CONFIRM if it moves a person between category
  folders.
- **rule / behaviour** ("always X", "stop doing Y") -> a rule in the relevant `CLAUDE.md`, root or
  `work/{n}`. CONFIRM before applying: identity file.
- **format** ("put the total at the top") -> a format note in the relevant command or spec. Applies
  automatically to a work file; CONFIRM for root.
- **ambiguous** -> ask ONE sharp question if someone is there to answer it. Otherwise file it to the
  corrections log tagged `needs-review`. Never guess silently.

## Corrections log (the bridge to /self-review)
Every correction, whatever the type, is appended to
`vault/projects/teach-alex/corrections-log.md` (append-only): date, the raw note, the type, the
target file, the status (proposed / applied / confirmed / needs-review), and the edit that resulted.
**`/self-review` reads this weekly** and clusters repeated corrections into a proposed rule change.

## Guardrails (HARD)
Never edits an identity file (`soul.md`, any `CLAUDE.md`) without explicit confirmation. Confirms
the interpretation before any large change. Sends nothing outward, ever. Invents nothing: if the
target is unclear, ask, or file `needs-review`.

## Confirmation
The reply is in the session, in Alex's voice, naming the file and the exact edit. If the correction
arrived as a file in `inbox/`, the processed file moves to `inbox/_ingested.md` as a dated entry so
the same note is never applied twice.

## Tools / infra
The vault, `inbox/`, and the files being corrected. **No server, no database, no account.** That is
the whole design: the thing you use to correct the system must never itself be the thing that breaks.

## Vault Structure
- **Tier 1:** `vault/projects/teach-alex/status.md`.
- **Tier 2:** `vault/projects/teach-alex/corrections-log.md` (append-only), plus a running
  "what Alex learned" digest inside status.

## Vault Reads
`soul.md`, the target file for each correction (`vault/people/`, `vault/business/`, root and work
`CLAUDE.md`, command specs), the corrections log.

## Vault Writes
The corrected file (on confirmation), `corrections-log.md` (every correction, always),
the "what Alex learned" digest, `vault/log.md`, `vault/index.md`.

## Outputs
No file deliverable. The output is a corrected file, a spoken confirmation, and a log entry.

## Connections
- **Fed by:** `inbox/`, and any session where a correction is spoken.
- **Feeds into:** `soul.md` My Words, people and business pages, `CLAUDE.md` rules, and
  `/self-review`, which batches them weekly.

## Close-Out Extras
- Every correction produces a corrections-log entry. A correction that was heard and not logged is
  a correction that will be needed again.
- Identity-file edits confirmed; everything else logged with the edit that was applied.
- A new person mentioned in a correction goes through the People Intake Protocol.

## Build status
- **2026-08-17:** entry point rebuilt on a plain `inbox/` folder. The classifier, the corrections
  log, the confirmation discipline and the `/self-review` handoff are unchanged from the original
  design, because none of them depended on the infrastructure that was removed.
