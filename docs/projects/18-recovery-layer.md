# 18 - Recovery Layer

## What it actually does
Three things, all of them boring until the day they are not.

**It notices.** A zero-token sweep re-checks the whole system against what the registry says should
be true: documents that disagree with the code, broken links, a job that is registered but not
documented, a backup that has not verified in three days. It DETECTS and never repairs, because an
automatic fix for a problem nobody has looked at is how a small drift becomes a confident wrong
answer.

**It backs up.** The system to a private GitHub repo, and the whole vault encrypted with your own
passphrase to your own Google Drive. It decrypts the blob again before shipping it, and reads the
size back afterwards, because "the command exited 0" is not evidence.

**It tells you.** Every job writes GREEN or RED to `system/run-status.json`. RED raises a desktop
notification in plain English, never a stack trace.

## Why it exists
Everything else in this system only happens when a session remembers to make it happen. This layer
cannot forget, because it re-derives everything every time it runs.

## The passphrase
Your backup passphrase is the one thing nobody can recover for you. Not Google, not Anthropic, not
whoever set this up. One check exists purely to make you re-confirm every 90 days that it is still in
your password manager.

## Works together with
- **`system/manifest.json`** - the desired state everything is checked against.
- **`/status`** and **[Morning Brief](02-morning-brief.md)** - where the findings surface.
- **[Self-Review](23-self-review.md)** - reads the pattern behind repeated findings.
