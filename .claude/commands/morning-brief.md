# /morning-brief - What Should I Deal With Today

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#02 /morning-brief · ON-DEMAND · Trigger: on-demand**
> Registry: `system/manifest.json` · Spec: `work/02-morning-brief/CLAUDE.md` · Status: `vault/projects/morning-brief/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Spec: work/02-morning-brief/CLAUDE.md (read it first).

## What this is
A seven-line index of the day. It points; it does not explain. Detail lives in the files the lines
point at. If a lane has nothing to say, its line is dropped rather than padded.

## Steps

1. **Overnight mail.** Gmail MCP `search_threads` for `in:inbox newer_than:1d`. COUNT what needs a
   reply and name the categories. Do NOT re-classify: `/email-triage` already did that overnight and
   redoing it spends the allowance twice for the same answer. If drafts were staged, say so and say
   they are sitting unsent in Gmail.

2. **Today's calendar.** Google Calendar MCP `list_events` with `startTime`/`endTime` in ISO 8601
   covering today only. **Do not pass a hardcoded `timeZone`.** Use the machine's own time zone, so
   this reads correctly wherever the owner actually is. An empty day gets a line saying so.

3. **Waiting on them.** `node scripts/waiting-on-them.js briefline`. Zero-token, one line out.

4. **Waiting on you.** `node scripts/human-actions.js summary`. These are the things only a human
   can do. Name the count and the oldest one. If the owner says "done: <id>" anywhere in the
   session, run `node scripts/human-actions.js done --id <id>`.

5. **Notes you left yourself.** Anything in `inbox/` that is not `.gitkeep` or `_ingested.md`.
   Report the count and the first line of each. Offer `/ingest`; never run it unasked.

6. **System health, and this is the line that has to be honest.** Read `system/run-status.json`.
   - All GREEN: one short clause, "everything ran".
   - Any AMBER: name it plainly and say it is not urgent.
   - **Any RED: lead line 6 with it, in plain English, with the one command that fixes it.** Never a
     stack trace, never a file path on its own. The shape: *"Last night's email sort did not run.
     Nothing is lost. Type /email-triage to catch up."*
   Then read `vault/projects/recovery/last-sweep.md` if it exists. Report the COUNT of findings and
   offer to walk through them; do not paste the list into the brief.

7. **Write the brief.** Seven lines maximum, numbered, in the owner's voice per soul.md. No preamble,
   no "here is your morning brief", no closing summary. Start with the date line and stop after the
   last lane.

## Post-run
- New people or companies that turned up: vault pages per the People Intake Protocol.
- `vault/log.md` + `vault/index.md` + `vault/projects/morning-brief/status.md`.
- Print the Close-Out Report.

## The rule that keeps this useful
If the brief ever runs longer than seven lines, the answer is to cut, never to summarise harder.
A brief nobody reads is worse than no brief, because you believe you have been told.
