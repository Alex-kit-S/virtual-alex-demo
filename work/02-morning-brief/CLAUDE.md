# Morning Brief

## Type
Automation (on-demand)

## Purpose
One short answer to "what should I deal with today?", built from what Alex already knows: overnight
mail, today's calendar, what you are waiting on from other people, what other people are waiting on
from you, and any notes you left yourself.

**It is on-demand, not scheduled, and that is a deliberate choice rather than an omission.** A daily
scheduled brief spends part of a Claude Pro allowance every single morning whether you read it or
not. Typing `/morning-brief` costs you thirty seconds and spends nothing on the mornings you do not
want it. If you would rather have it fire on its own, add it to `scheduler/schedule.md` and register
it, and understand that you are trading allowance for thirty seconds.

## Output format: the Index (7-line cap)
The brief is an INDEX, not a report. Its job is to point, not to explain. Seven lines maximum, one
per lane, each naming the thing and where it is. If a lane has nothing, its line is dropped, not
padded.

The reason for the cap: a long brief is not read, and a brief that is not read is worse than none,
because you then believe you have been told. Detail lives in the files the lines point at.

```
Morning brief, Tuesday 12 August
1. Mail (4 need you): 2 clients, 1 invoice, 1 recruiter. Drafts staged in Gmail.
2. Calendar: 10:00 handover call (Nadia), 15:00 dentist. Nothing else booked.
3. Waiting on them: 3 chased, 1 overdue by 9 days (Ministry contract).
4. Waiting on you: 2 open, oldest 4 days (renew the Drive backup sign-in).
5. Notes you left: 1 in inbox/ ("check the Kurdish glossary file").
6. System: everything ran. Backup verified last night.
```

Line 6 is the only one that is ever alarming, and it must say what to do in plain words, never a
stack trace: "Last night's email sort did not run. Nothing is lost. Type /email-triage to catch up."

## Entry Points
- `/morning-brief` in a session. That is the only entry point.
- Natural language works too: "what's my day look like", "brief me".

## Tools Used
- Gmail MCP: `search_threads` for overnight mail (read-only here; #07 does the sorting and drafting).
- Google Calendar MCP: `list_events` for today. `startTime`/`endTime` in ISO 8601, and the time zone
  is whatever the machine is set to. Do not hardcode one.
- Local, zero-token: `node scripts/waiting-on-them.js briefline`, `node scripts/human-actions.js
  summary`, `system/run-status.json`, `vault/projects/recovery/last-sweep.md`, `inbox/`.
- Notion MCP: OPTIONAL and only if the owner uses Notion. If it is not connected, skip it and say so
  in one clause. Never block a brief on Notion.

## Run Checks (every brief, before writing output)
1. **Overnight mail.** Count what needs a reply. Do NOT re-classify: #07 already did that, and
   redoing it costs allowance twice for the same answer.
2. **Today's calendar.** Events only for today, with times. An empty day is a line that says so.
3. **Waiting on them.** `node scripts/waiting-on-them.js briefline`. Zero-token.
4. **Waiting on you.** `node scripts/human-actions.js summary`. These are the things only a human can
   do, and the oldest one gets named.
5. **Notes you left yourself.** Anything in `inbox/` that is not `.gitkeep` or `_ingested.md`.
   Offer `/ingest`, never run it unasked.
6. **System health.** Read `system/run-status.json`. Any RED or AMBER row leads line 6 in plain
   words, with the one command that fixes it. Also read
   `vault/projects/recovery/last-sweep.md` if it exists and mention the count, not the contents.

## Classification Rules
- **Needs you today** = a reply is expected, a deadline is today or tomorrow, or a person is blocked
  on you.
- **Can wait** = worth reading, no clock on it.
- **Noise** = counted, never listed. A brief that lists noise has become noise.

## Vault Reads
- `soul.md` (voice).
- `vault/people/` for context on names that appear.
- `vault/projects/*/status.md` for what is in flight.
- `vault/projects/recovery/last-sweep.md` for the system line.

## Vault Writes
- `vault/log.md` entry per run.
- `vault/projects/morning-brief/status.md` last_run + outcome.
- Any new person or company that turned up gets a page, per the People Intake Protocol.

## Connections
- **Fed by:** #07 email-triage (the sorting and the drafts), #18 recovery-layer (the sweep and
  `run-status.json`), #22 teach-alex (notes in `inbox/`), Google Calendar.
- **Feeds into:** nothing automatic. It is read by a human and then it is over. That is the point.

## Post-Run (mandatory)
1. New people or companies found -> vault pages, per the intake protocols.
2. `vault/log.md` + `vault/index.md` updated.
3. `status.md` last_run refreshed.
4. Print the Close-Out Report.

## Trifecta
Gate: **read-only**. Legs: private_data=true, untrusted_content=true, external_comm=false. It
aggregates private surfaces and untrusted email content, and it emits nothing anywhere. Source of
truth: the `trifecta` block in system/manifest.json. Validator V12 fails the build if this gate stops
matching the manifest.

## Implementation Notes
- Rewritten for this system 2026-08-17. The version it replaces aggregated a job pipeline, an AI
  capability radar, a health tracker, an interview tracker and a dashboard. None of those exist
  here, and a brief whose job is aggregating lanes that were removed is not a brief, it is a shell.
- **The four things the brief used to be the only home for**, now that it is unscheduled: the
  recovery sweep's findings, the waiting-on-them line, the waiting-on-you queue, and the notes
  sweep. **All four are also read by `/status`**, deliberately, so that unscheduling the brief did
  not silently orphan them. If you change what the brief reads, change `/status` in the same session.
