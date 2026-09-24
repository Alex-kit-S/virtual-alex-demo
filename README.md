# A worked example of Virtual Alex

This repository is what Virtual Alex looks like the day after its owner runs `/setup`. Virtual Alex
is a personal assistant made of Claude Code. A private GitHub repository holds its rules, its memory
and its scheduled jobs, and a Claude Code session in the cloud does the work. Nothing is installed on
a computer.

**The owner is fictional.** Juno Ashgrove, a leadership coach, and her practice, Ashgrove Coaching,
do not exist. Everything she says here was written for this demo. The table further down names, for
every file, whether a script produced it or whether it was written as an example.

The template an owner starts from is private, so this page links only to files in this repository.
The steps an owner follows to set up their own Alex are in [INSTALL-ONLINE.md](INSTALL-ONLINE.md).

## Ten minutes, five stops

### 1. Who Alex works for (two minutes)

Open [soul.md](soul.md). `/setup` writes it from the owner's own words: their role, how they write,
their priorities, and the character they want Alex to be. Every session loads it. The card beside
it, [soul-core.md](soul-core.md), is compiled from it by `scripts/lib/build-soul-core.js`, and its
last line is the builder's stamp. `entries=0` means no phrasing has been collected from real
sessions yet, which is correct on day one. The same canary token sits at the top and the bottom of
`soul.md` so a scheduled run can prove it received the file.

### 2. The memory (two minutes)

Open [vault/me/role.md](vault/me/role.md), then [vault/index.md](vault/index.md) and
[vault/log.md](vault/log.md). The vault is plain Markdown, one topic per page, joined by
`[[wiki links]]`. The pages came from one source, the onboarding chat in
[vault/sources/notes/](vault/sources/notes/onboarding-chat.md). `/ingest` moved it there out of
`inbox/`, and nothing edits it again.

### 3. A scheduled job (two minutes)

Open [scheduler/routines/brief.md](scheduler/routines/brief.md). It is the whole prompt of the
morning brief. The Routine's form in the Claude app holds one line, "Read
`scheduler/routines/brief.md` and carry it out exactly", so changing the job is a commit in this
repository. The five Routines and the settings for each are in
[docs/ROUTINES-FORMS.md](docs/ROUTINES-FORMS.md).

### 4. The run log and the sweep (two minutes)

Open [system/run-log.jsonl](system/run-log.jsonl). Every run appends one JSON row. The six rows
here come from real runs on 2026-09-24: the sweep and the close-out that ends a session, run after
the setup, again after a wording fix to `soul.md`, and again after an update.

Then open [vault/projects/recovery/last-sweep.md](vault/projects/recovery/last-sweep.md). The sweep
is a script with no model in it. It checked 13 things and found 11 green and 2 amber. Both ambers are
accurate. None of the five Routines has run yet, and no backup repository was recorded. In an owner's
repository they clear once the owner names the backup repository and the Routines have run.

### 5. The walls (two minutes)

- [.claude/settings.json](.claude/settings.json) denies 19 tool patterns in every session, the
  owner's included. Among them: sending, replying to or forwarding mail, writing to the calendar,
  and editing the settings, the commands or the commit hooks.
- [scripts/hooks/pre-commit](scripts/hooks/pre-commit) runs on every commit: a secret scan, a 10 MB
  size limit, the employer-data guard and the validator. Every commit in this repository went
  through it.
- [scripts/untrusted-lane-guard.js](scripts/untrusted-lane-guard.js) is the guard a scheduled job
  runs under. A job that reads mail cannot send, share or delete anything, cannot reach any web
  address, and cannot run `gh` or git's remote commands. Its saves go through the autosave, to this
  repository only.
- [SECURITY.md](SECURITY.md) lists each safeguard, what it stops, and how to report a problem.

The design on one page, with one diagram, is [docs/ARCHITECTURE-ONLINE.md](docs/ARCHITECTURE-ONLINE.md).

## Where every file came from

The demo began as the template exactly, at build 28, and was assembled step by step in a working
repository. This repository starts from the result, at build 40, so its history begins there. The
files below are the ones `/setup`, the runs and the updates added.

| File | What it is | Made by |
|---|---|---|
| `vault/sources/notes/onboarding-chat.md` | The owner's onboarding answers | Written for this demo, labelled as fictional in its first line |
| `soul.md` | Who Alex works for | Written for this demo the way `/setup` Step 4B writes it, labelled at the top. The canary token came from the command `/setup` names. The block numbered 6, on structural writing tells, was added by `scripts/migrations/001-structural-voice-tells.js` during the update |
| `soul-core.md` | The card every session loads | `scripts/lib/build-soul-core.js`, from `soul.md` |
| `vault/me/role.md`, `goals.md`, `preferences.md` | Pages about the owner | Written for this demo the way `/setup` Step 4C writes them, labelled in each page's header |
| `vault/business/ashgrove-coaching.md` | A page about the practice | Written for this demo the way `/ingest` writes one, labelled in its header |
| `vault/index.md`, `vault/log.md` | The catalogue and the log | Written for this demo, labelled at the top. The log's timestamps are the real time of the setup |
| `system/install-profile.json` | This owner's settings | Copied from `system/install-profile.example.json` as `/setup` Step 1 says, with the two employer keys left empty (Step 6, a self-employed owner) |
| `system/run-log.jsonl` | The run log | Real: three rows from `work/18-recovery-layer/check.mjs`, three from `scripts/close-out-online.sh` |
| `vault/projects/recovery/last-sweep.md` | The sweep's report | Real: written by `check.mjs` in its last run |
| `system/install-state.json`, `system/migrations-applied.json` | Which template build this copy is on, and which migrations ran | Real: written by `scripts/lib/install-state.js` and `scripts/run-migrations.js` during the update |
| `outputs/INDEX.md`, `vault/outputs-index.md` | The deliverables index, empty | Real: rendered by `scripts/outputs-ledger.js` during the close-out |

In the working repository, the saves were made by the Kit's own scripts: `scripts/autosave.sh`, the
same save an owner's session makes, and each template update the demo took between build 28 and build
40, run step by step as [.claude/commands/update.md](.claude/commands/update.md) writes it. One of
them refused at first, as its step 5 says it should: the template had changed its own `README.md`, and
the demo had replaced that file with this page. It was applied again with `README.md` left out,
because this page belongs to the owner. All of them went through the commit gate above, and so did the
commits that wrote this page.

## How this differs from an owner's repository

- It was assembled on a laptop. The scripts ran for real, with `CLAUDE_CODE_REMOTE=true`, the
  switch a cloud session sets.
- There are no skill links under `.claude/skills/`. `scripts/bootstrap.mjs` creates them as
  symbolic links in the owner's first cloud session, and a Windows checkout would have recorded them
  as copies, so none were made here.
- No mail or calendar is connected, no Routine exists, no backup repository is named, and no
  data-privacy choice is recorded. Each of those needs a real person's accounts.
- The update asks its owner one question before it changes anything. The person who assembled this
  demo answered it.
- The template's own tests do not run here. They run in the template and its seeds. An owner's
  repository runs one workflow, the daily heartbeat, which fails when no Routine has written a row in
  the last 48 hours, so GitHub emails the owner. No Routine runs in this demo, so its run log stops at
  the six rows above.

## Who built it

Alex is designed and built by Shaheen Kiarash. The licence is MIT, in [LICENSE](LICENSE).
