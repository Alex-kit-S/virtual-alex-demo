# /support-bundle - The page you send when Alex needs help (Virtual Alex)

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
<!-- ALEX:CMD-HEADER:END -->

VIRTUAL ALEX VARIANT of the Kit's `/support-bundle` (variants/online/.claude/commands/support-bundle.md
in the Kit, copied into the template by scripts/build-online-template.mjs). There is no zip here, no
log directory, no `launchctl`, no `rclone` and no file to attach from a laptop: the page is written
into the repository, saved by the autosave, and printed into the chat so the owner can long-press,
copy and paste it from a phone.

## What this is

One page the owner can READ, then send to whoever set this up, holding everything needed to work out
what went wrong and nothing they would not want to share. There is no dashboard and no remote access
in this system; without this command the only thing support ever receives is "it's broken".

**Why the session share link is never the support path.** On the Pro and Max plans a shared session
is visible to any logged-in Claude user unless repository verification is on, and the machine behind
the session cloned the whole vault. A share link is the vault. This page is a diagnosis, and it is
the support path, the only one. Never offer the link, even if asked.

**Run it once before you need it.** The worst day to find out a support command does not work is the
day something is already broken.

## Where it goes

`outputs/support/<YYYY-MM-DD>.md`. `outputs/` is tracked online, so the page is part of the
repository. Write it with the Write tool: the autosave hook commits and pushes it within seconds. If
a page for today exists already, overwrite it.

## What goes in, in this order

1. **The redaction report FIRST** (the pass below). The owner reads what is being sent before the
   content, not after.
2. **The last 20 run-log rows:** `tail -20 system/run-log.jsonl`. If the file is absent, one line:
   "no Routine has written a row yet". Usually the answer on its own.
3. **`vault/projects/recovery/last-sweep.md`**, whole. If absent: "the sweep has not run yet". This
   is the ONLY file under `vault/` that ever enters the page.
4. **The version:** `cat VERSION`, and the `version` and `updated` lines of `system/kit-manifest.json`.
5. **`system/install-state.json`**, whole. `template_commit` is the line the maintainer needs; the
   file holds no secret.
6. **The skills lock hash:** `shasum -a 256 skills-lock.json`.
7. **The last 10 commit subjects:** `git log --oneline -10`.
8. **The environment name.** Read `echo "ROUTINE=$ALEX_ROUTINE LANE=$ALEX_UNTRUSTED_LANE REMOTE=$CLAUDE_CODE_REMOTE"`.
   Both empty is `Default`; `ALEX_ROUTINE=1` alone is `Routine`; both set is `Armed`. Write the
   name, not the values. A person runs this command, so the answer is `Default` unless something is
   wrong, which is itself worth knowing.
9. **The `/skills` list** as the menu shows it: the entries under `claude.ai sync` and the project
   entries. If `/skills` does not resolve in this session, one line saying so.

## What must NEVER go in, and this list is the whole point

- **Nothing from `vault/`** except the one sweep report named above. Not a page, not a line, not a
  list of filenames. The vault is the owner's private notes.
- **No `soul.md`**, no compiled card. That is their voice and their life.
- **No email content**, no drafts, no attachments. `work/07-email-triage/state/` stays out whole.
- **No credentials of any kind**, no file whose path appears in `system/credentials-ledger.json`,
  and no environment variable VALUES beyond the three names read in item 8.
- **No `system/human-actions.jsonl`** or `pending-writes.jsonl`: those are personal to-dos.
- **No `outputs/logs/`.** They are session streams, they are not tracked online, and the end of a
  log is in the run-log row already.

## Redaction pass (over every line going in, before the page is written)

1. Replace every email address with `<email>`. Count them.
2. Replace anything that looks like a key or token (a run of 20 or more letters, digits, `_` or `-`
   with no space in it) with `<redacted>`, except a commit sha (7 or 40 hex characters), which is
   diagnostic. Count them.
3. Run both scanners over the finished page and keep their one-line verdicts:
   `node scripts/secret-scan.mjs --file outputs/support/<date>.md` (exit 0 is clean; a hit means step
   2 missed a shape: fix the page and run it again before printing anything) and
   `node scripts/employer-data-guard.mjs --file outputs/support/<date>.md`.
4. The redaction report is the first section of the page: the two counts, the two verdicts, and the
   list of what was included, by the item numbers above. The owner READS what is being sent rather
   than taking a promise about it.

## Steps

1. Gather the nine items, run the redaction pass, write the page with the Write tool.
2. Quote the autosave's result line. If it says `refused`, the page carried something a content leg
   would not save: fix it and write again. Nothing is printed until the save is clean.
3. Ledger row: `node scripts/outputs-ledger.js add --project support --path outputs/support/<date>.md --desc "support page"`.
4. Print the WHOLE page into the chat, redaction report first.
5. Tell the owner, in this order: long-press, copy, paste it to whoever set this up on WhatsApp; the
   same page is at `outputs/support/<date>.md` in the repository on github.com; and, if the run log
   already shows the cause, the cause in one plain sentence.

## What to say at the end

Plain, short, honest about what you can see. For example:

> Support page written: `outputs/support/2026-09-28.md`, saved to your repository.
> It holds the last twenty Routine rows, the last sweep, the version, the template you are on and
> the last ten commit subjects. None of your notes, none of your mail, no passwords; two email
> addresses and one token-shaped string were replaced before it was saved.
> From what I can see, the triage Routine has been BLOCKED for three mornings because Gmail did
> not answer; the connector needs a fresh sign-in at claude.ai/customize/connectors. Send the page
> anyway so it can be confirmed.

If you can see the answer, say the answer. A support page is not a substitute for reading the run
log yourself first.
