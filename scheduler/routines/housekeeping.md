# Routine: housekeeping (Virtual Alex)

The form's prompt is one line: "Read `scheduler/routines/housekeeping.md` and carry it out
exactly." This file is the order. It is committed, so changing the job is a commit, never a form
edit on a phone. The form: `docs/ROUTINES-FORMS.md`. The row in `system/manifest.json` `routines[]`
is the schedule.

## 1. Where you are

You are running unattended as `housekeeping` on Virtual Alex. Stay on `main`; never create a
branch. Today is the date `date -u` prints: run it first and use nothing else as the clock.

- One repository is attached and its hooks loaded: the guard in its ROUTINE mode (the Routine
  environment: every write to the rules, every send, every `gh`, every remote git command and
  every URL whose host is not on the lane allowlist is denied), the autosave (every file write
  commits and pushes `main`) and the commit gate. If the first screen lacked
  `---DISPATCH-CONTEXT---`, the hooks did not load: write nothing, and end with the close below
  using `--status BLOCKED --reason "hooks did not load"`.
- Never run `git` yourself. The autosave (which you may call directly as `bash scripts/autosave.sh`)
  and the close-out script do every commit and push.
- This Routine keeps NO connector.
- Three legs, in this order, one run-log row each. The sweep writes its own row; you write the
  other two with `node scripts/run-log.mjs append`. A leg that fails never stops the next one.

## 2. Missed-N opener

Run `node scripts/run-log.mjs last housekeeping`. It prints the newest `housekeeping` row or `none`.

- `none`: this is the first run. N = 0.
- A row: take its `at` (UTC). This job runs weekly, so N = the number of whole 7-day periods
  between that `at` and now, minus one, and never below zero.

When N is above zero, the run's output OPENS with the line `Missed N housekeeping run(s)`.

## 3. The job

### Leg 1: the sweep

Run `node work/18-recovery-layer/check.mjs`. Exit 0 is clean, 2 means it found something AMBER, 1
means something RED or the checker itself broke; all three are normal outcomes to report, never a
reason to stop. It prints one line per leg, writes `vault/projects/recovery/last-sweep.md` and
appends its own `sweep` row to the run log. Then run `bash scripts/autosave.sh` so the report and
the row are committed and pushed before the next leg (a Bash-written file is not caught by the
write hook; the autosave is the save path, and it is not `git`). Quote the sweep's summary line.

### Leg 2: the gated self-review

Run `node scripts/run-log.mjs last self-review`.

- If it prints `none`, or the row's `at` is 28 days old or older: run `/self-review`. If the slash
  command does not resolve, follow `.claude/commands/self-review.md` step by step. It PROPOSES; it
  never applies an identity change without the owner's yes, and there is no owner in this session,
  so every proposal stays a proposal in the file it writes. Then append the row:
  `node scripts/run-log.mjs append --job self-review --status <COMPLETE|PARTIAL> --reason "<one line: what it proposed, or why partial>"`.
- Otherwise append `node scripts/run-log.mjs append --job self-review --status SKIPPED --reason "last run <its date>, <D> days ago, the gate is 28 days"`.

### Leg 3: the skills snapshot

Run `/skills` and take the list of skills it shows under `claude.ai sync` (the skills the owner's
claude.ai account syncs into every session). Then `node scripts/run-log.mjs last skills`.

- Readable, and the list equals the one in the newest `skills` row's reason (or there is no row
  yet): append `--job skills --status COMPLETE --reason "claude.ai sync: <the list, comma-separated, or none>"`.
- Readable, and the list differs: append `--job skills --status PARTIAL --reason "claude.ai sync changed: was <old list>; now <new list>"`.
  That is the WARN row the brief and the sweep read: a skill that appeared in every session without
  a commit is worth the owner's look.
- `/skills` does not resolve or shows nothing: append
  `--job skills --status BLOCKED --reason "/skills unreadable in this session: <what happened>"`.
  The sweep's skills leg turns AMBER on that row.

The run's status: COMPLETE when all three legs ran and wrote their rows; PARTIAL when a leg could
not run (say which, in the reason); BLOCKED only when the hooks did not load.

**There is no template-head leg, deliberately (2026-09-23).** A fourth leg used to run
`git ls-remote https://github.com/Alex-kit-S/virtual-alex` to see whether the template had moved.
It was removed rather than unblocked, for two reasons that both stand on their own.

The first is that it cannot work from here whatever the guard says. A cloud session's git
credentials cover the repositories ATTACHED to that session and nothing else, so a read of an
unattached private repository fails with `could not read Username` (measured 2026-09-23 on the
backup repository, in an interactive session and again in a Routine). This Routine has one
repository attached.

The second is the price of making it work. The lane guard blocked the command because `github.com`
is not on `HOST_ALLOW`, and that allowlist is near-empty on purpose. It is not per Routine: putting
a whole internet host on it opens it for the ARMED lane too, where triage and the brief are reading
mail that anybody can send. An allowed host reachable by `curl` from a session processing attacker
controllable text is an exfiltration channel, and buying one with a command that would still fail
on credentials is a bad trade twice over.

Nothing is lost. `/update` compares the heads properly, in the two-repository session where the
read actually works. What the owner sees instead is the age of their own copy, read from local
files: `/alex-status` and the brief's first-Monday line both print
`node scripts/lib/install-state.js line` (the build this copy carries, its date, and when this copy
took it), and the brief adds a standing reminder to run `/update`.

## 4. Close

1. The canary line, without reading any file for it: write `SOUL-OK <token>` where `<token>` is the
   `SOUL-CANARY-TOKEN` value from the identity card already in your context (`soul-core.md`, which
   `CLAUDE.md` imports). If no token is in your context, write `SOUL-MISSING`. Never open a file to
   find it: a token read from disk proves nothing about what was loaded.
2. Print the Close-Out Report (the Close-Out Gate in `CLAUDE.md`), then run exactly one command:

   `bash scripts/close-out-online.sh --job housekeeping --status <COMPLETE|PARTIAL|BLOCKED> --canary <ok|missing> --missed <N> --model <id> --lesson "L: none"`

   `<id>` is the exact model id you are running as, from your own system prompt (the line that
   says "The exact model ID is ..."); if you do not know it, leave `--model` out. Add
   `--reason "<why>"` whenever the status is not COMPLETE. Replace `"L: none"` with a real L-line in
   the Close-Out shape when the run taught something.
3. The script writes the run-log row and does the save (commit, rebase, push, read-back). Quote its
   last line. Then stop: nothing starts after the close-out line has printed.
