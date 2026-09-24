# The Routine forms (Virtual Alex)

<!-- GENERATED from system/manifest.json routines[] by scripts/generate-alex.js (scripts/lib/gen-routines.js). Edit the registry, then regenerate; do NOT hand-edit. -->

This page is what you type into the claude.ai routine form, one Routine at a time, on a phone if that is what you have. Open `claude.ai/code/routines`, tap New routine, and copy each field from the table below. Do them in this order: the snapshot first, so a backup exists before anything else runs.

Three things the form defaults to that you change every time:

- **Connectors.** The form includes every connector on your account by default, with write access and no approval during a run. Each table names the connectors to KEEP; remove every other connector.
- **Environment.** Pick the one named. `Routine` and `Armed` are the two cloud environments you created on day one; `Default` is for you, never for a Routine.
- **Repositories.** Attach exactly what the table says. Every Routine but the snapshot runs on your Alex repository alone; a second repository in the session switches every hook off.

The model is the registry default (`claude-sonnet-4-6`); pick it in the form's model selector. The weekly sweep ambers a run that reports a different model.

The prompt is always one line pointing at a committed file. The file is the order; changing a job later is a commit, never a form edit.

## 1. alex-snapshot

| Field | Type this |
|---|---|
| Name | `alex-snapshot` |
| Prompt | Read `scheduler/routines/snapshot.md` and carry it out exactly. |
| Model | `claude-sonnet-4-6` |
| Schedule | weekly, Sunday 04:15, your local time (preset: weekly) |
| Repositories | your Alex repository AND your backup repository (both attached) |
| Environment | Routine |
| Connectors to KEEP | none; remove every other connector |
| First-run check | Tap Run now, then open your backup repository on github.com: a branch named claude/backup-<today> exists, and the newest row of system/run-log.jsonl on your Alex repository is job snapshot, status COMPLETE. |

## 2. alex-housekeeping

| Field | Type this |
|---|---|
| Name | `alex-housekeeping` |
| Prompt | Read `scheduler/routines/housekeeping.md` and carry it out exactly. |
| Model | `claude-sonnet-4-6` |
| Schedule | weekly, Sunday 04:45, your local time (preset: weekly) |
| Repositories | your Alex repository only |
| Environment | Routine |
| Connectors to KEEP | none; remove every other connector |
| First-run check | Tap Run now, then open vault/projects/recovery/last-sweep.md on github.com: it is dated today, and system/run-log.jsonl gained rows for sweep, self-review, skills and housekeeping. |

## 3. alex-triage

| Field | Type this |
|---|---|
| Name | `alex-triage` |
| Prompt | Read `scheduler/routines/triage.md` and carry it out exactly. |
| Model | `claude-sonnet-4-6` |
| Schedule | daily, 05:00, your local time (preset: daily) |
| Repositories | your Alex repository only |
| Environment | Armed |
| Connectors to KEEP | Gmail; remove every other connector |
| First-run check | Tap Run now, then open Gmail: every thread the run marked Act Now carries an unsent draft from Alex and nothing was sent; the newest run-log row is job triage with canary ok. |

## 4. alex-brief

| Field | Type this |
|---|---|
| Name | `alex-brief` |
| Prompt | Read `scheduler/routines/brief.md` and carry it out exactly. |
| Model | `claude-sonnet-4-6` |
| Schedule | weekdays, 06:15, your local time (preset: weekdays) |
| Repositories | your Alex repository only |
| Environment | Armed |
| Connectors to KEEP | Gmail, Calendar; remove every other connector |
| First-run check | Tap Run now, then read the run in the app: the brief opens with the health lines (every Routine ran, or which did not) before the inbox, and the newest run-log row is job brief with canary ok. |

## 5. alex-radar

| Field | Type this |
|---|---|
| Name | `alex-radar` |
| Prompt | Read `scheduler/routines/radar.md` and carry it out exactly. |
| Model | `claude-sonnet-4-6` |
| Schedule | weekly, Sunday 23:30, your local time (preset: weekly) |
| Repositories | your Alex repository only |
| Environment | Routine |
| Connectors to KEEP | none; remove every other connector |
| First-run check | Tap Run now, then open vault/projects/radar/status.md on github.com: last_run is today and the run named every feed it read or that refused it; the newest run-log row is job radar. |

## After the five exist

Tap Run now on the snapshot and do its first-run check before creating the rest. Then read the next morning's brief in the app: it opens with every Routine that did not finish COMPLETE, and `/alex-status` in any session prints the newest row per job from `system/run-log.jsonl`. A green tick in the routine list means only that a session started and ended without an infrastructure error; the row is the verdict.

Switching a Routine off is the on/off toggle on the routines page; nothing is lost while it is off, and the next run opens with how many it missed.
