# Keeping Alex Updated

Alex improves over time. This is how those improvements reach your machine.

**You never download Alex again and you never install it again.** There is a file already sitting in
your Alex folder called `Update-Alex`. You double click it. That is the whole process, and it is the
same process every time, forever.

---

## Before you start

If Alex is open, close it. That is the only preparation.

Nothing you have written is at risk. The update saves your own work before it touches anything and
puts it back afterwards.

## The three steps

1. **Open your Alex folder.** The same folder you open when you use Alex.
2. **Double click `Update-Alex`.** A black window opens. That window is Alex working, so leave it
   alone. Windows may warn you the first time because the file came from the internet; choose to run
   it anyway. It is the same file that has been in your folder since the day Alex was installed.
3. **Wait.** Under a minute on a normal connection. The window tells you when it is done and waits
   for you to press a key before closing.

## What you will see

```
  Updating Alex.

  Saving your changes first...
  Downloading the latest version...
  Restoring your changes...
  Setting up the new bits...

  Alex is updated.

  Open Alex and type /status to check everything is running.
```

Some lines only appear when they apply. If you had changed nothing yourself, the saving and restoring
lines are skipped. If you are already up to date it says `Alex is already up to date. Nothing to do.`
and stops, which is also a perfectly good outcome.

## Check it worked

Open Alex and type `/status`. You should get a report back.

If you get an unknown command message instead, Alex was opened in the wrong place and was not broken
by the update. Open the Alex folder itself and try again. See `docs/GETTING-STARTED.md`.

## If something goes wrong

Two things can be reported, and neither leaves Alex broken.

**`Nothing was changed. Alex is exactly as it was and still works.`**
The update touched a file you had also changed, so it stopped and put everything back rather than
leaving a half-merged folder behind. Keep using Alex normally. Send `update-log.txt` from your
Desktop to whoever set this up.

**`One setup step was skipped.`**
The download worked and you have everything that arrives that way. Only a change to a file that
lives outside the shared folder did not go in, because the step could not find what it expected and
refuses to guess. Nothing was modified. Send `update-log.txt` and it can be finished by hand.

In both cases the safe outcome was chosen deliberately. Alex would rather do nothing and tell you
than half do something and stay quiet.

---

## Why there are two halves to an update

Worth understanding once, because it explains why a step can be skipped on its own.

Most of Alex lives in a shared folder that updates cleanly: skills, house rules, the automations,
the documentation you are reading.

**Your `soul.md` does not.** That file holds who you are, how you write, and the record of your own
phrasing that Alex learns from. It is deliberately kept OUT of the shared folder so that nobody
hosting it can read your content. That privacy is the point, and its cost is that the shared folder
can never change that file for you.

So anything that improves how Alex writes arrives by a second route: a small setup step that runs
locally, on your machine, after the download. That is step 6 in the window, the line that says
`Setting up the new bits...`.

That step backs your file up first, checks its own work afterwards, and if the file is not shaped the
way it expects it changes nothing at all and says so. Your `soul.md` is the one thing in the folder
that cannot be fetched again if it breaks, so it is never edited on a guess.

## If your Alex runs online

Virtual Alex has no `Update-Alex` file and nothing to double click. The update is a command you type
in a session of your own: `/update`. Everything above this heading describes the laptop install.
This section is the whole story for the online one.

**When.** Nothing tells you that an update is waiting. A Routine cannot read the template, so no
brief can say that it changed. What you can see is the age of your own copy. `/alex-status` opens
with the template build your Alex carries, the date of that build and when your copy took it, and
the brief prints the same line on the first Monday of each month with a reminder to run `/update`.
Run it then, or when whoever maintains the template tells you something is new. If nothing is
waiting, `/update` says "Alex is already up to date" and changes nothing. Nothing applies on its
own. A Routine never applies an update.

**What `/update` prints before it asks.** One line per template build since your version, taken
from the template's own changelog, with the sensitive files that build touched named in plain words:
the constitution (`CLAUDE.md`), the permission rules and hooks (`.claude/settings.json`), the
commands (`.claude/commands/`), the commit gate (`scripts/hooks/`), the shared code and the
identity-card builder (`scripts/lib/`), the heartbeat and CI (`.github/workflows/`), the Routine
orders (`scheduler/routines/`), connector configuration (`.mcp.json`). Then how many template
commits there are, and one sentence: it will apply the difference as one commit written by you. It
waits for your yes. Anything but yes changes nothing.

**The eight paths an update never touches.** `soul.md`, `soul-core.md`, `vault/`, `starter/`,
`system/install-profile.json`, `outputs/`, `inbox/` and `.claude/skills/`. That is your identity, your
notes, your seed, your choices, your deliverables, your inbox and your skill links, excluded by name
inside the command itself and not by judgement. The one exception is the same as on a laptop:
a migration may write `soul.md`, under the contract in the section above, and its backup is the
commit before the update.

**What "Nothing was changed" means.** The difference did not fit somewhere: a file you had changed
by hand, or a template file that moved under it. `/update` put every file back to the commit it
started from, printed the list of files that did not apply, and stopped. Alex works exactly as
before. Send that list to whoever maintains the template; the fix is theirs, and you run `/update`
again after it lands. The same words appear when the secret scanner or the commit gate refuses the
update, because a template carrying a credential shape is never half-applied.

**Your own front page is kept.** `README.md`, `SECURITY.md` and `LICENSE` are yours to rewrite. If
you changed one of them and the template changed it too, `/update` keeps your version, leaves the
template's change to that file out, and says so before it asks ("You rewrote `README.md` ... yours
stays as it is") and again in its summary ("Kept as yours"). Only those three files are kept this
way. A change you made to anything else, `CLAUDE.md` included, still has to merge, and if it cannot,
the update stops with "Nothing was changed".

**The private template.** Today the template is private, so for the `/update` session only you
attach it as a second repository next to your own. A session with two repositories loads no hooks,
which is why `/update` runs the secret scan and sets the commit gate itself before it commits.
`/update` says so if it cannot reach the template.

**Two files that are tracked here and not on a laptop.** `system/install-state.json` carries
`template_commit`, the template build you are on; `/update` reads it and writes it.
`system/migrations-applied.json` carries the ids of the migrations that ran; online it is committed
with the update, so the record travels with the repository instead of living on one machine.

**Nobody but you ever writes a commit in your repository.** Not the person who maintains the
template, not a helper, not a Routine acting for someone else. An update is your commit. Never accept
a collaborator invitation on your Alex repository; the fix is a template change and a `/update`, or
it is not a fix.

## For whoever maintains this

Updates are published to the template repository this folder was created from. On the receiving side
`Update-Alex.cmd` fetches `upstream/main`, merges, hard rolls back on ANY conflict, repairs skill
junctions via `scripts/bootstrap.ps1 -RepairJunctions`, then runs `node scripts/run-migrations.js`.

Online (Virtual Alex) the receiving side is `/update` (`.claude/commands/update.md`): a fetch of the
template into a temporary ref, the changelog rows since the owner's `template_commit` printed with
their flagged paths, a yes, then `git diff <base> <head>` behind the eight-path exclusion applied
with `git apply -3 --index` as the owner's own commit, the same migration runner, and a reset to
the pre-update commit on any failure. The template build (`scripts/build-online-template.mjs
--push`) appends the changelog row `/update` reads and refuses to publish a build that touched a
privileged path without flagging it.

Anything touching a gitignored file (`soul.md`, the vault) needs a migration in `scripts/migrations/`
or it silently never arrives. The contract is documented at the top of `scripts/run-migrations.js`:
idempotent, back up only immediately before writing, verify by read back, restore on mismatch, and
decline rather than guess. A declined migration is NOT recorded as applied, so it stays pending
instead of being lost. Applied ids live in `system/migrations-applied.json`, which is per machine and
gitignored on a laptop, and tracked online, where the repository is the machine.
