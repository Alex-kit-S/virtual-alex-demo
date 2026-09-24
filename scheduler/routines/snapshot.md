# Routine: snapshot (Virtual Alex)

The form's prompt is one line: "Read `scheduler/routines/snapshot.md` and carry it out exactly."
This file is the order. It is committed, so changing the job is a commit, never a form edit on a
phone. The form: `docs/ROUTINES-FORMS.md`. The row in `system/manifest.json` `routines[]` is the
schedule.

## 1. Where you are

You are running unattended as `snapshot` on Virtual Alex. Stay on `main`; never create a branch
in the Alex repository. Today is the date `date -u` prints: run it first and use nothing else as
the clock.

- This is the ONE two-repository session in the system: the owner's Alex repository and the backup
  repository (the mirror) are both attached. A session with two repositories loads NO hooks: no
  identity card, no guard, no autosave and no commit gate. That is why this prompt does its own
  `git`, and it is the only prompt in this system that may. Nothing is committed for you.
- This Routine keeps NO connector and writes nothing but one run-log row.
- Find the Alex repository first: the directory that contains `CLAUDE.md` and
  `scheduler/routines/snapshot.md`. `cd` into it. Every command below runs there.

## 2. Missed-N opener

Run `node scripts/run-log.mjs last snapshot`. It prints the newest `snapshot` row or `none`.

- `none`: this is the first run. N = 0.
- A row: take its `at` (UTC). This job runs weekly, so N = the number of whole 7-day periods
  between that `at` and now, minus one, and never below zero.

When N is above zero, the run's output OPENS with the line `Missed N snapshot run(s)`.

## 3. The job

1. Read the mirror's name: the `backup_repo:` line in the frontmatter of
   `vault/projects/recovery/status.md`, in the shape `owner/name` (the online `/setup` wrote it).
   If the line is absent, stop here: the status is BLOCKED and the reason is
   `no backup_repo in vault/projects/recovery/status.md`; go to the close.
2. Put the session on GitHub's `main`. The platform starts every Routine on a working branch of its
   own named `claude/<name>`, and it can hand over a cached local `main` that is stale (both
   measured 2026-09-23). This two-repository session has no startup hook, so run the same step the
   hook runs, yourself: `CLAUDE_PROJECT_DIR=. bash scripts/lib/session-branch.sh`. It prints one
   line. If the line starts with `BRANCH: main`, go on (quote it in the run output when it carries
   a note in brackets). If it starts with `---BRANCH-NOT-MAIN---` or `---BRANCH-DIVERGED---`, stop:
   the status is BLOCKED and the reason is that line; go to the close. The second one means this
   copy was never proved equal to GitHub's main, so a snapshot of it would record the wrong tree as
   the backup. Never check out, reset or create a branch yourself.
3. Push the copy. With `DATE` the date from part 1 in `YYYY-MM-DD`:
   `git push https://github.com/<backup_repo> main:refs/heads/claude/backup-<DATE>`
   A branch named `claude/backup-...` is always accepted by the platform's push check; no branch
   is ever deleted (no pruning), because git dedups objects and fifty-two branches a year cost one
   vault plus deltas.
4. Read it back: `git ls-remote --heads https://github.com/<backup_repo>` must list
   `refs/heads/claude/backup-<DATE>` with the same sha as `git rev-parse main`. If the branch is
   absent or the sha differs, the copy did not land: the status is RED and the reason is
   `backup branch claude/backup-<DATE> not read back on <backup_repo>`. Say it in capitals in the
   run output, because nothing else in this system will notice a missing backup until the sweep.
5. The status is COMPLETE only when step 4 read the branch back.

## 4. Close

This session loads no identity card (two repositories, no hooks), so the canary line is
`SOUL-MISSING` and `--canary missing`. That is the expected value for this one job, and it does
not make the run PARTIAL. Then, in this order:

1. `node scripts/run-log.mjs append --job snapshot --status <COMPLETE|BLOCKED|RED> --canary missing --missed <N> --model <id> --reason "<the branch that landed, or why not>" --repo <backup_repo> --sha <sha>`
   `<id>` is the exact model id you are running as, from your own system prompt; leave `--model`
   out if you do not know it. `<backup_repo>` is the `owner/name` you pushed to in step 3, and
   `<sha>` is the sha step 4 read back for the backup branch; leave `--sha` out when nothing was
   read back, and leave both out when step 1 stopped the run. The weekly sweep compares `--repo`
   with `backup_repo`, so a copy that landed anywhere else is caught.
2. Save the row yourself, because no hook will:
   `git add system/run-log.jsonl && git commit -m "alex: snapshot <DATE>" && git push origin main`
   then read it back: `git ls-remote origin refs/heads/main` must print the sha of `git rev-parse HEAD`.
   If the commit fails because the session has no git identity, say so in capitals: the copy still
   landed (step 4 proved it) and only the row is lost until the next session.
3. Quote the read-back line. Then stop: nothing starts after it.
