# /status - Is Alex OK?

Two modes: a quick check, or a full report.

**Why this command matters more here than it looks.** There is no dashboard and no server in this
system. `/status` IS the health board. And because `/morning-brief` runs on demand rather than on a
schedule, four things that used to reach a human through the brief now reach them through here as
well: the system check's findings, what you are waiting on, what is waiting on you, and any notes
left in the inbox. **If you ever change what the brief reads, change this file in the same session.**

## Quick Mode (default, when the owner asks "status", "what's going on", "is Alex ok")

Answer the actual question first, then the detail. Never open with a heading. Two lines open every
quick status, in this order:

1. **The identity line, from the files, never from memory.** Read `tail -1 soul-core.md` (the
   `SOUL-CORE-STAMP`) and the `**Addressing:**` line of `soul.md`. Print exactly one line first:
   `Identity: loaded (<the name Alex calls the owner>, card <generated-at date>)`. No card but a
   `soul.md`: `Identity: loaded from soul.md, no card yet (<name>)`. Neither: `Identity: NONE. Run
   /setup.` This is the line the Virtual Alex `/setup` tells a new owner to look for in their first
   fresh session, so it comes first and it comes from the files.
2. **The verdict:** "Everything is running." or "One thing needs you."

Then read, in this order:

1. **The health board.** Which file it is depends on where Alex runs, and the file decides:
   - **If `system/run-log.jsonl` exists (Virtual Alex, the cloud variant):** run
     `node scripts/run-log.mjs last` and print what it returns, the newest row per job, one JSON
     line each: `{job, at, status, reason, canary, model, missed, session_url, repo, sha}` (`repo` and `sha` are the snapshot's). Statuses are
     COMPLETE, PARTIAL, BLOCKED, SKIPPED or RED. `canary: missing` means the run could not prove
     it had its identity loaded, with ONE exception the reader states instead of reporting: the
     `snapshot` job always carries `canary: missing`, by construction, because it is the one
     two-repository session in the system and loads no identity card (no hooks, no `CLAUDE.md`
     import). For `snapshot` say "no identity card by design" and never "could not prove", or the
     owner learns to ignore the word on the jobs where it matters. `missed` is how many scheduled
     runs a Routine found it had skipped. A job with no row has never run. This file replaces `run-status.json` online because
     one JSON document rewritten by two writers is a merge conflict and an appended row is not.
   - **Otherwise (a laptop install): `system/run-status.json`.** One row per job: GREEN, AMBER
     or RED, with a reason and a timestamp.
   - All green (GREEN, or COMPLETE in the run log) -> "Everything ran." Name the last backup time,
     because that is the one people actually want to know.
   - AMBER -> say it plainly and say it is not urgent.
   - **RED -> lead with it, in plain English, and give the one command that fixes it.** Never a
     stack trace and never a bare file path. The shape: *"Last night's email sort did not run.
     Nothing is lost. Type /email-triage to catch up."*
   - A job that has NO row at all has never run. Say that, because "no news" and "never ran" look
     identical from the outside and only one of them is fine.

2. **`vault/projects/recovery/last-sweep.md`, the system check.** Report the count of findings and
   the date. Offer to walk through them. Do not paste the list. If the file does not exist, say the
   system check has not run yet rather than saying everything is clean.

3. **Waiting on you:** `node scripts/human-actions.js list`. Print the open queue with ages. If the
   owner says "done: <id>" anywhere in the session, run `node scripts/human-actions.js done --id <id>`.
   Also flush whatever is flushable from `system/pending-writes.jsonl` while here.

4. **Waiting on them:** `node scripts/waiting-on-them.js briefline`. One line.

5. **Notes you left yourself:** anything in `inbox/` that is not `.gitkeep` or `_ingested.md`.
   Report the count and offer `/ingest`. Never run it unasked.

6. **Recent activity:** the last 3 to 5 entries of `vault/log.md`. What ran, when, what came of it.

Keep it to 10 lines. This is a snapshot, not a report.

## Full Mode (when the owner asks "full status" or "system health")

### 1. Identity
Read `soul.md`. Confirm it exists and has real content. **If it does not exist, say so plainly and
stop pretending**: a system with no soul.md has no voice and no priorities, and the fix is `/setup`.

### 2. Connections
Test each MCP live rather than reporting what is configured:
- Gmail: list 1 recent message
- Google Calendar: read today
- Notion: list databases (optional; a missing Notion is not a fault here)
A connection that is configured but not answering is worth more attention than one that was never
set up, so report those differently.

### 3. Jobs
Read `scheduler/schedule.md` for what SHOULD be registered, then ask THIS platform what IS.
Check which scheduler the machine runs before typing either command - `schtasks` does not exist
on a Mac and `launchctl` does not exist on Windows, and the not-found error reads like a broken
install rather than a wrong command:

- **macOS** (`uname -s` says Darwin): `launchctl list | grep Alex`
- **Windows:** `schtasks /query /fo csv | findstr Alex`

Report the difference in plain words. A documented job that is not registered has never run and
never will. One exception worth naming rather than reporting as a fault: on macOS
`Alex-recovery-check` is deliberately never registered, because the weekly sweep has no macOS
port yet.

### 4. Backups, the one worth being paranoid about
- `system/run-status.json` -> the `vault-backup` and `git-backup` rows. On Virtual Alex those
  jobs do not exist: read `node scripts/run-log.mjs last snapshot` (the weekly copy to the backup
  repo) and `git log -1 --format=%cd` for the last autosave, which IS the backup there.
- `work/18-recovery-layer/state/backup-destinations.json` -> when a copy last verified.
- Say the date of the last VERIFIED backup, not the last attempt. If it is more than three days old,
  say so as a problem rather than a fact.

### 5. Recent activity
Last 10 entries of `vault/log.md` with timestamps.

### 6. Vault health
Count pages in `vault/me/`, `vault/business/`, `vault/people/`, `vault/meetings/`,
`vault/projects/`, `vault/research/`. Last vault update timestamp.

### 7. What is installed
List each folder in `work/` and whether it has a `CLAUDE.md`. Compare against
`system/manifest.json`: anything in one and not the other is drift worth naming.

### 8. Brand
Check `brand/config/brand-config.md` exists and holds real values rather than placeholders. A
placeholder brand means `/brand` has not been run, which is worth saying before the owner ships a
document that looks like nobody's.

## Support
If something is broken and the answer is not obvious, run `/support-bundle`. It packages the logs,
the last system check and the health board into one file that can be sent to whoever set this up.
