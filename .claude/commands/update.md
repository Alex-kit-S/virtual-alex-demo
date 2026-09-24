# /update - Bring this Alex up to the template, as your own commit (Virtual Alex)

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
<!-- ALEX:CMD-HEADER:END -->

## What this is

The online replacement for the laptop Kit's `Update-Alex` file. There is no file to double-click
here and nothing to download. The owner types `/update` in an interactive cloud session, Alex
fetches the template this repository was born from, shows what changed, waits for a yes, and
applies the difference as ONE commit authored by the owner. Pull, never push. The template is
never merged: a merge would put the maintainer's commits into the owner's history, and the routine
push check refuses a branch carrying commits by someone other than the owner. The template's
delta, applied as the owner's own commit, has neither problem. Nobody but the owner ever authors a
commit in the owner's repository, the maintainer included.

**A Routine never applies an update, and no Routine can even tell you one is waiting.** The guard
denies `git fetch` in the Routine and Armed environments, and a cloud session's git credentials
cover only the repositories attached to it, so a Routine cannot read the template head at all
(2026-09-23: the housekeeping leg that tried was removed rather than unblocked, and the reasoning
is in `scheduler/routines/housekeeping.md`). Comparing the heads is this command's job, in the
two-repository session where the read works. The brief carries a standing line telling the owner to
run it; the owner decides when, in a session of their own.

## Where this runs, and the two-repository case

This file ships to every install. Check where you are first: `echo "$CLAUDE_CODE_REMOTE"`. If it
does not print `true`, this is a laptop install: say "On a laptop the update is the `Update-Alex`
file in the Alex folder; double-click it. `/update` is the Virtual Alex path." and stop, because
nothing below applies to a laptop.

Run this first thing in a fresh session, before any other work, so the tree is clean.

- **Which template.** This repository names it in `system/template-source.json`, which the template
  build writes into every tree it makes. `node scripts/lib/template-gate.mjs remote` prints its address.
  It is never typed from memory here: a template other than the family's has owners too.
- **Two repositories in the session.** Before anything is applied, step 2 reads the template head's
  CI result through the session's GitHub proxy, and the proxy answers only for repositories attached
  to the session (a private template cannot even be fetched otherwise). So for THIS session only,
  the owner attaches the template as a SECOND repository (in the app: add the repository in that
  address next to their own). A two-repository session loads NO hooks. No identity card, no guard,
  no autosave, no commit gate set by SessionStart, and the first screen lacks
  `---DISPATCH-CONTEXT---`. That is expected here. It is why this command sets `core.hooksPath`
  itself and runs the secret scan itself before it commits. Every command below runs in the OWNER's
  repository: `cd` into the directory that contains `CLAUDE.md` and `INSTALL-ONLINE.md` and stay
  there. Never `cd` into the template checkout and never commit there.

Say how many repositories this session has before step 1. If it has one, say which one to add,
from the address the gate prints, and stop until the owner has started a session with both.

## Steps

### 1. Where this repository stands

```bash
git status --porcelain --untracked-files=all
```

If that prints anything, stop: "There is unsaved work in this session. End it, start a fresh one,
and type /update first." A dirty tree under an update is the one thing the reset in step 6 cannot
put back.

Then put the session on GitHub's `main`. The platform starts every session on a working branch of
its own named `claude/<name>` and can hand over a stale cached `main` (both measured 2026-09-23),
and in the two-repository case no startup hook has moved it. If `scripts/lib/session-branch.sh`
exists, run it; it prints one line:

```bash
CLAUDE_PROJECT_DIR=. bash scripts/lib/session-branch.sh
```

A line starting `BRANCH: main` means go on (quote it when it carries a note in brackets). A line
starting `---BRANCH-NOT-MAIN---` or `---BRANCH-DIVERGED---` means stop, quote it, and change
nothing. The second one means the session is on main but this copy was never proved equal to
GitHub's main, so an update applied here would land on top of work nobody can see.

If the file does not exist (a repository born before template build 14, and this update is what
brings it), do the same by hand, in this order, and stop at the first step that fails:

1. `git fetch -q origin main`
2. On a `claude/` branch: `git rev-list --count FETCH_HEAD..HEAD` must print `0` (no commits of its
   own). Anything else: stop, this branch holds work.
3. If a local `main` exists and `git rev-list --count FETCH_HEAD..refs/heads/main` prints more
   than `0`, keep those commits first:
   `git push -q origin refs/heads/main:refs/heads/claude/rescue-stale-main-$(date -u +%Y%m%dT%H%M%SZ)`,
   and stop if that push fails.
4. `git checkout -q -B main FETCH_HEAD`

```bash
PRE="$(git rev-parse HEAD)"
git branch --show-current
```

The branch must now be `main`. Keep `PRE`: it is the commit everything is reset to if anything fails.

Read `system/install-state.json` and take `template_commit`. The file exists and is tracked
online; the key may be absent on a repository that has never run `/update` (nothing before this
command writes it). Absent is handled in step 3; do not invent a value.

### 2. Fetch the template into a temporary ref, and check its CI

```bash
REMOTE="$(node scripts/lib/template-gate.mjs remote)"
```

If that exits non-zero, quote its line and stop: the file is missing or names no GitHub repository,
and an update fetched from a guessed address is the one thing this step exists to prevent. Nothing
has changed.

```bash
git fetch "$REMOTE" main:refs/alex/template-head
HEAD_T="$(git rev-parse refs/alex/template-head)"
node scripts/lib/template-gate.mjs ci "$HEAD_T"
```

If the fetch is refused: the template is not attached to this session. Say so, name the fix (attach
the repository in `$REMOTE` as a second repository and run `/update` again), and stop. Nothing has
changed.

The last line passes only when the template's own CI finished GREEN on exactly `HEAD_T`; quote the
line it prints, which names the run. If it exits non-zero (the tests failed, are still running, have
not started, or cannot be read from this session), quote its line, delete the ref (step 8) and stop.
A template head whose tests did not pass is never applied, however small the change looks.

### 3. The base: which template build this repository is on

If `template_commit` was present, `BASE` is that value. If it was absent, derive it from the
changelog this repository carries: the newest row of `system/template-changelog.jsonl` names the
build this tree was generated from (a seed build copies the changelog as it stood, so the newest
row is the last generic build), and the template commit that ADDED that row is the base:

```bash
LAST_AT="$(tail -1 system/template-changelog.jsonl | sed 's/^{"at":"//; s/".*//')"
BASE="$(git log refs/alex/template-head --format=%H -S"$LAST_AT" -- system/template-changelog.jsonl | tail -1)"
```

If `BASE` is empty, stop and say: "I cannot find the template build this repository was born from
(its newest changelog row is dated `<LAST_AT>` and the template's history does not contain it).
Nothing has changed. Send that line to whoever maintains the template." Then delete the ref (step
8) and end.

Then:

```bash
git merge-base --is-ancestor "$BASE" "$HEAD_T" && echo base-ok
```

`base-ok` must print. If it does not, the base is not an ancestor of the template head and the
delta has no meaning: stop with the same message.

If `BASE` equals `HEAD_T`: print "Alex is already up to date. Nothing to do." If `template_commit`
was absent, still write it (step 7 without a commit of anything else: the stamp alone is worth a
commit, `Alex update: stamp template <short>`), so the next `/update` starts from a recorded base
and `/alex-status` can say when this copy took its build. Delete the ref and end.

### 4. What changed, in the owner's words, then WAIT

The template's changelog carries one row per pushed build. The rows newer than the base are the
lines beyond the base's line count:

```bash
N_BASE="$(git show "$BASE":system/template-changelog.jsonl | wc -l | tr -d ' ')"
git show refs/alex/template-head:system/template-changelog.jsonl | tail -n +"$((N_BASE + 1))"
N_COMMITS="$(git rev-list --count "$BASE".."$HEAD_T")"
```

Print the rows as they are, then one plain line per row saying what its `flagged` paths mean.
The flagged list is the set of privileged paths that build touched; an empty list means the build
touched none of them. The paths and what they are:

| Flagged path | What it is |
|---|---|
| `CLAUDE.md` | the constitution: the rules Alex runs by |
| `.claude/settings.json` | the permission rules, the deny list and the hooks |
| `.claude/commands/` | the slash commands, this one included |
| `scripts/hooks/` | the commit gate |
| `scripts/lib/` | the identity-card builder and the shared code |
| `.github/workflows/` | the heartbeat and CI |
| `scheduler/routines/` | the five Routine orders |
| `.mcp.json` | connector configuration |

Then find the front-page files the owner made their own. `README.md`, `SECURITY.md` and `LICENSE`
are what GitHub shows as the repository's face, an owner may rewrite them, and none of them carries
a rule Alex runs by. When the owner changed one since their base AND the template changed it too, a
three-way merge cannot reconcile a rewritten page, and before 2026-09-24 that refused the WHOLE
update, every time, for good (measured on the demo). So the owner's version stays and the
template's change to that one file is left out:

```bash
KEEP=""
for f in README.md SECURITY.md LICENSE; do
  git diff --quiet "$BASE" HEAD -- "$f" || git diff --quiet "$BASE" "$HEAD_T" -- "$f" || KEEP="$KEEP $f"
done
echo "kept as yours:${KEEP:- none}"
```

Keep `KEEP` for step 5. Only these three files are ever kept this way. A change the owner made to
anything else, `CLAUDE.md` included, still goes through the three-way merge, and a conflict there
still refuses the update: the rules are never silently left behind.

Then say exactly what will happen: "`<N_COMMITS>` template commit(s), from `<BASE short>` to
`<HEAD_T short>`. I will apply the difference as one commit by you. It never touches `soul.md`,
`soul-core.md`, `vault/`, `starter/`, `system/install-profile.json`, `outputs/`, `inbox/` or
`.claude/skills/`. If any file does not apply cleanly, I put everything back exactly as it is now
and tell you which files. Type yes to go on." When `KEEP` names a file, add before "Type yes": "You
rewrote `<file>` and the template changed it too, so yours stays as it is and the template's change
to it is left out."

**WAIT for yes.** Anything else: delete the ref (step 8) and end with "Nothing was changed."

### 5. Apply the delta

The eight excluded paths are excluded by the pathspec, mechanically, not by judgement, and so is
every file step 4 put in `KEEP`. `--full-index` is what lets `git apply -3` find the blobs for a
three-way merge; `--binary` carries a changed image or font (the brand defaults) through a text pipe.

```bash
set -- . ':!soul.md' ':!soul-core.md' ':!vault/' ':!starter/' ':!system/install-profile.json' ':!outputs/' ':!inbox/' ':!.claude/skills/'
for f in $KEEP; do set -- "$@" ":!$f"; done
git diff --full-index --binary "$BASE" "$HEAD_T" -- "$@" > /tmp/alex-update.patch
```

If `/tmp/alex-update.patch` is empty (every template change sat inside the excluded paths), skip
to step 7: there is nothing to apply and the stamp still moves.

```bash
git apply -3 --index /tmp/alex-update.patch
```

The static `Edit()` denies on `.claude/settings.json`, `.claude/commands/`, `scripts/hooks/`,
`scripts/lib/` and `.github/workflows/` do not reach `git apply`: it writes through git plumbing,
and those paths are exactly the ones an update exists to carry.

**On any non-zero exit** (a hunk that does not fit, a conflict the three-way merge could not
resolve):

```bash
git diff --name-only --diff-filter=U
git reset --hard "$PRE"
git status --porcelain --untracked-files=all
```

Print the file list from the first command, then, in these words: "Nothing was changed. Alex is
exactly as it was and still works. These files did not apply: `<list>`. Send this list to whoever
maintains the template." The third command must print nothing. Delete the ref (step 8) and end.

### 6. Migrations, under the existing contract

```bash
node scripts/run-migrations.js
```

The contract at the top of `scripts/run-migrations.js` holds unchanged: run once, never fail the
update, a decline is not recorded as applied and stays pending, plain English out. Online, "back
up before writing" is the commit before this one (`PRE`); a migration that writes `soul.md` is the
ONE writer that may reach it, and only under that contract. `system/migrations-applied.json` is
tracked here, so the applied ids go into this update's commit. Quote what it printed.

### 7. The scans, the stamp, the commit

Set the hook path first: in a one-repository session SessionStart already did this and the line
is a no-op; in the two-repository session nothing did, and a commit without it would skip the gate.

```bash
git config core.hooksPath scripts/hooks
node scripts/secret-scan.mjs --staged
```

A hit (exit 2, `file:line pattern`, the value never printed) refuses the WHOLE update: a template
carrying a credential shape is a maintainer problem, never something to half-apply.
`git reset --hard "$PRE"`, print the lines, say "Nothing was changed", delete the ref, end. The
commit below runs the same scan again plus the size guard (no staged blob over 10 MB), the
employer-data guard and the validators, through `scripts/hooks/pre-commit`.

Write the stamp. `scripts/lib/install-state.js` is the ONE writer of that record: it moves the
current commit to `previous_template_commit`, writes through the JSON standard, and reads the file
back before returning. Do not hand-edit the file and do not write it any other way.

```bash
node -e "require('./scripts/lib/install-state.js').stamp('.', process.argv[1], {by:'/update'})" "$HEAD_T"
git add system/install-state.json system/migrations-applied.json
```

(If `system/migrations-applied.json` does not exist because no migration has ever run, add the
state file alone: `git add` refuses a path that is not there.)

```bash
git commit -m "Alex update: ${HEAD_T:0:7} (${N_COMMITS} template commits)"
```

The author is the owner's git identity on this VM, the same one every autosave commit carries.
If the gate blocks the commit (`pre-commit: BLOCKED`), that is a refusal of the whole update:
`git reset --hard "$PRE"`, print the gate's lines, "Nothing was changed", delete the ref, end.
Under `CLAUDE_CODE_REMOTE=true` the drift legs of the validator print WARNING lines and let the
commit through; quote them, they are for the maintainer.

### 8. Push, read back, clean up

```bash
git push origin main
git ls-remote --heads origin main
git rev-parse HEAD
git update-ref -d refs/alex/template-head
rm -f /tmp/alex-update.patch
```

The sha from `ls-remote` must equal `git rev-parse HEAD`. If it does not, the push did not land:
say so with both values and stop; the commit is local and safe, and the next Stop hook (in a
one-repository session) or a `git push origin main` by hand lands it.

Then, in this shape:

```
Alex is updated to template <HEAD_T short> (<N_COMMITS> template commits, <k> files changed).
The rows above are what changed. Nothing in your notes, your identity or your skill links moved.
Kept as yours: <KEEP, or "nothing">. The template changed these too; your version stayed.
Open a NEW session and type /alex-status: the new rules and hooks load at session start, not now.
```

`<k>` from `git diff --stat "$PRE" HEAD | tail -1`. Drop the "Kept as yours" line when `KEEP` is
empty.

## What never happens here

- No merge, no rebase, no branch. One commit by the owner, on `main`.
- No write to the eight excluded paths, by pathspec. A migration is the only exception, under its
  contract.
- No push to the template, ever. The template is read.
- No run inside a Routine, and no Routine reports a new build: none can see the template. The brief's
  first-Monday line shows the build this copy carries and reminds the owner, who runs this.
