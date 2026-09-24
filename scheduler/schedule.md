# Scheduled Tasks (Virtual Alex)

VIRTUAL ALEX VARIANT of the Kit's `scheduler/schedule.md`, from `variants/online/scheduler/`.
Online nothing runs on a machine. The scheduler is five **Routines** on the owner's claude.ai
account, each a saved form that starts a fresh cloud session on this repository at a set time and
reads one committed prompt file. The table below is generated from `system/manifest.json`
`routines[]`; the forms page the owner types from is `docs/ROUTINES-FORMS.md`; the prompt files are
under `scheduler/routines/`. Changing a job is a commit to one of those, never a form edit.

## The Routines

<!-- ROUTINES:BEGIN (generated from system/manifest.json routines[] by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->
| Routine (form name) | Job (run-log row) | When (your local time) | Repositories | Environment | Connectors kept | Prompt file | Runs a week |
|---|---|---|---|---|---|---|---|
| `alex-snapshot` | `snapshot` | weekly, Sunday 04:15 | your Alex repository AND your backup repository (both attached) | Routine | none | `scheduler/routines/snapshot.md` | 1 |
| `alex-housekeeping` | `housekeeping` | weekly, Sunday 04:45 | your Alex repository only | Routine | none | `scheduler/routines/housekeeping.md` | 1 |
| `alex-triage` | `triage` | daily, 05:00 | your Alex repository only | Armed | Gmail | `scheduler/routines/triage.md` | 7 |
| `alex-brief` | `brief` | weekdays, 06:15 | your Alex repository only | Armed | Gmail, Calendar | `scheduler/routines/brief.md` | 5 |
| `alex-radar` | `radar` | weekly, Sunday 23:30 | your Alex repository only | Routine | none | `scheduler/routines/radar.md` | 1 |

15 runs a week, every one of them token-bearing on the owner's subscription. Create them in the order of the table (the snapshot first, so the backup exists before anything else runs).

**The stagger rule.** Never two Routines in the same hour, and every one of them outside the owner's waking hours. The platform adds its own start offset of a few minutes, consistent per Routine; the hour spacing above absorbs it. Two writers are not a lock problem online but a merge problem: the first push wins, the loser rebases in its Stop hook, and the append-only files union-merge. Hour spacing is defence in depth, not the mechanism.

**Times are the owner's local zone.** The form takes the time in the zone the owner is in when they create the Routine, and stores it; travelling afterwards changes nothing. The date every run writes into its row is UTC.

**Every row is the contract the weekly sweep reads back.** `work/18-recovery-layer/check.mjs` ambers a Routine with no run-log row inside its `cadence_hours` plus six hours of grace, and a row whose `model` is not the registry default. `brief` carries 72 hours rather than 24 because the weekday preset skips the weekend and the Sunday sweep would otherwise amber it every week.
<!-- ROUTINES:END -->

## What each run does, and what it never does

Every prompt file has the same four parts: where it runs (unattended, on `main`, never a branch,
the date from `date -u`), a Missed-N opener read from its own newest row in `system/run-log.jsonl`,
the job, and a close that quotes the identity canary from context and runs
`bash scripts/close-out-online.sh`, which writes the run's row and does the save. A Routine never
sends, never applies an update, never edits a rule file, and never runs `git` itself; the one
exception is the snapshot, the only two-repository session in the system, which loads no hooks and
therefore does its own push to `claude/backup-<date>` on the backup repository and reads it back.

There is no retry ladder, no quota gate and no watchdog online: the next slot is the retry, the
platform rejects a run past the daily cap before it starts, and every write is already committed
by the autosave hook. What replaces all three is visibility: the row, the Missed-N line, the brief
that opens with yesterday's failures, and the daily heartbeat workflow on GitHub's side of the
boundary that fails when no row has landed for 48 hours.

## The laptop Kit's jobs, kept for the record

The entries below are the Kit's own machine schedule (Windows Task Scheduler and macOS launchd).
**None of them runs on Virtual Alex** and there is nothing to register here: the Routines above are
the whole schedule. They are kept in this file because the generated `docs/GETTING-STARTED.md`
lists them and the validator (V2) holds the two in step; read them as what the laptop install does,
not as anything this repository will do.

### Email Triage
- Command: `/email-triage`
- Script: `scripts/run-email-triage.ps1`
- Frequency: logon + 10 min (Task Scheduler job Alex-email-triage)
- Frequency (macOS): daily 08:10
- Description: Sorts the inbox into Act Now / Read Later / Archive, applies labels, and stages
  reply drafts in your own voice. It never sends anything. This is the job that
  spends any of your Claude allowance, and it is scheduled because it does work you would otherwise
  have to do by hand.

### Vault Search Index
- Command: (none, zero-token script)
- Script: `scripts/run-vault-index.ps1`
- Frequency: logon + 20 min (Task Scheduler job Alex-vault-index)
- Frequency (macOS): daily 21:20
- Description: Rebuilds the search index over your vault so Alex can find things fast. Costs
  nothing, runs in seconds. Placed before the backup so the fresh index ships inside the encrypted
  blob.

### Git Backup
- Command: (none, zero-token script)
- Script: `scripts/git-backup.ps1`
- Frequency: logon + 25 min (Task Scheduler job Alex-git-backup)
- Frequency (macOS): daily 21:30
- Description: Commits and pushes the system itself (code, specs, configuration) to your private
  GitHub repo. Your vault, your soul file and your credentials are gitignored and never go with it.

### Vault Backup (encrypted, off machine)
- Command: (none, zero-token script)
- Script: `scripts/vault-backup.ps1`
- Frequency: logon + 30 min (Task Scheduler job Alex-vault-backup)
- Frequency (macOS): daily 21:45
- Description: The one that matters if the laptop dies. Tars everything git deliberately ignores
  (the whole vault, your soul file, your writing), encrypts it with your own passphrase, verifies it
  can be decrypted again, then ships it to your Google Drive with rclone and keeps the last 14.
  Google only ever holds ciphertext. **If you lose the passphrase, every backup is permanently
  unrecoverable**, which is why `/setup` refuses to finish until you have stored it in two places.

### System Check
- Command: (none, zero-token script)
- Script: `work/18-recovery-layer/check.ps1`
- Frequency: logon + 40 min (Task Scheduler job Alex-recovery-check)
- Frequency (macOS): not registered - the sweep (check.ps1) has no macOS port yet; gen-launchd names this skip on every run
- Description: The sweep that notices when something quietly stopped being true: a document that
  disagrees with the system, a broken link, a backup that has not verified in three days, a job that
  is registered but not documented. It only ever DETECTS, it never repairs by itself. Findings land
  in `vault/projects/recovery/last-sweep.md` and `/alex-status` reads them out. Exit 2 means "found
  something", which is normal, not a failure.

### Radar
- Command: `/radar`
- Script: `scripts/run-radar.ps1`
- Frequency: weekly Monday 07:30 (Task Scheduler job Alex-radar)
- Frequency (macOS): weekly Monday 07:30
- Description: Reads the sources you chose, scores what it finds against your own taste and your own
  friction list, and hands you the one or two things worth acting on. It runs before the morning
  brief, which surfaces the result, so it is not a separate thing to remember. It proposes only: it
  never installs, buys or builds anything.

### Alex Reviews Alex
- Command: `/self-review`
- Script: `scripts/run-self-review.ps1`
- Frequency: monthly on the 1 at 10:00 (Task Scheduler job Alex-self-review)
- Description: Once a month Alex reads back the corrections you made, the errors that happened and
  the runs that ended incomplete, looks for the pattern behind them, and proposes changes. It never
  edits its own rules by itself: it proposes, you decide.

## Transient tasks (not standing jobs)

- **Alex-catchup** (macOS only, the laptop Kit): the RunAtLoad catch-up agent. Not a Routine and
  not needed online: a cloud VM is never asleep, and the Missed-N opener plus the sweep's
  freshness leg replace it.
- **Alex-retry-***: the laptop Kit's self-scheduled one-shot retries, excluded from every checker.
  Online the next scheduled slot is the retry.

## Turning it off

The on/off toggle on `claude.ai/code/routines` switches one Routine off without deleting it. Nothing
is lost while it is off; the next run opens with how many it missed. Every job can also be run by
hand in an interactive session (`/email-triage`, `/morning-brief`, `/radar`, `/self-review`), and
the sweep with `node work/18-recovery-layer/check.mjs`.
