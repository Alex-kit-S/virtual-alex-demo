# Scheduler (Virtual Alex)

VIRTUAL ALEX VARIANT of the Kit's `scheduler/README.md`, from `variants/online/scheduler/`.

On Virtual Alex nothing runs on a machine and there is nothing to register. The scheduler is five
**Routines** on the owner's claude.ai account: saved forms that start a fresh cloud session on this
repository at a set time, each carrying one line, "Read `scheduler/routines/<name>.md` and carry it
out exactly." The file is the order; the form only points at it.

## Where each piece lives

- **The schedule:** the `routines[]` rows of `system/manifest.json` (name, prompt file, preset and
  time, cadence, environment, the connectors to keep, repositories, model, first-run check).
- **The forms page:** `docs/ROUTINES-FORMS.md`, generated from those rows by
  `node scripts/generate-alex.js`. It is what the owner types into `claude.ai/code/routines`, one
  Routine at a time, the snapshot first.
- **The table and the stagger rule:** `scheduler/schedule.md` in this repository, the generated
  ROUTINES region.
- **The orders:** `scheduler/routines/triage.md`, `brief.md`, `radar.md`, `housekeeping.md`,
  `snapshot.md`. Committed, identity-denied to every unattended session, bound to their registry
  rows by validator V19.
- **The record:** `system/run-log.jsonl`, one row per run, appended by the close-out script;
  `/alex-status` prints the newest row per job.
- **The watchers:** the weekly sweep (`work/18-recovery-layer/check.mjs`, leg 1 of housekeeping)
  ambers a Routine with no row inside its cadence, and the daily heartbeat workflow
  (`.github/workflows/heartbeat.yml`) fails on GitHub's side when no row has landed for 48 hours.

## Changing a job

Edit the prompt file, or the registry row and then run the generator; commit. Never edit the form
on the phone beyond the on/off toggle: a form edit is invisible to the repository and to every
checker, and the next `/update` would not know it exists.
