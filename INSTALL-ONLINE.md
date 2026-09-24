# Virtual Alex: the install with no install

For an owner with a phone, a paid Claude account and one evening. Written 23 September 2026.

Read this page once before you start. Day one takes about 75 minutes of your attention, and
about 20 of those are waiting for a screen to finish. Nothing on this page needs a computer.

**The claim, in one sentence:** Alex runs on your own Claude subscription inside your own private
GitHub repository, and nothing is installed anywhere, not even by Alex.

Two accounts, then, a Claude account for the brain and a GitHub account for the disk. "No install"
was never "no account", and this page does not pretend otherwise.

## Tonight, in thirteen lines

1. Make a GitHub account. Turn on two-factor with a passkey.
2. Accept the invitation email from the person who set this up.
3. Open the seed link. Tap "Use this template". Name it `alex`. Private.
4. Make a second private repository, empty, named `virtual-alex-backup`.
5. Install the Claude app. Sign in with the paid account.
6. In the browser at `claude.ai/code`, sign in with GitHub and put the Claude GitHub App on both repositories.
7. Two settings: "Help improve Claude" OFF. Shared sessions require repository access ON.
8. Create two cloud environments, `Routine` and `Armed`. Leave `Default` alone.
9. Connect Google. Your personal account only.
10. Tap the session link. Type `/setup`. Twenty to thirty minutes with Alex.
11. Close that session. Open a new one. Type `/alex-status`. The `Identity:` line names you.
12. Create the five Routines from `docs/ROUTINES-FORMS.md`, snapshot first.
13. Next morning, read the brief in the app.

Everything below explains those thirteen lines.

---

## 1. What you need

- **A paid Claude account.** Alex is not a separate program with its own intelligence. **Alex is
  Claude**, running inside a repository of instructions, memory and commands. No subscription, no
  brain. The Pro plan is what this is built for; section 12 says when Max is worth it.
- **A GitHub account.** Free. It holds your notes. Section 5 says who else can read them.
- **A phone** with a browser and the Claude app. A laptop works too. A terminal is never opened.
- **A personal Google account** for Gmail and Calendar. Never the one your employer gave you.
- **The two links** the person who set this up sends you: the seed repository, and the session
  link that opens Alex with `/setup` already typed.

## 2. Who does what

**The person who set this up, once, about 30 minutes, before you start.** Builds your seed (your
own description of yourself is inside it, at `starter/ABOUT-<YOUR NAME>.md`), pushes it to a
private repository marked as a template, invites your GitHub username to read it, and sends you
the two links on WhatsApp. That person never sees your notes, and after tonight never touches your
repository at all. Section 8 says why.

**You, once, about 75 minutes.** The thirteen steps below. Then Alex runs every day on its own.

## 3. The thirteen steps

Each step says who does it, how long it takes, and what "it worked" looks like. Do them in order.
The browser is for the account pages and the forms. The Claude app is for the session.

**Step 1. The GitHub account. 8 minutes.**
Go to `github.com/signup`. Verify the email. Then Settings, Password and authentication, and turn
on two-factor with a passkey (your phone's face or fingerprint). This account holds your notes. A
password alone is not enough, and a lost account is a lost repository, which is what step 4 and
section 6 are for.
It worked: the signed-in GitHub home page, and a green "2FA enabled" on the authentication page.

**Step 2. The invitation. 1 minute.**
Open the invitation email from the person who set this up. Tap Accept.
It worked: the seed repository opens and you can read it.

**Step 3. Your own copy. 2 minutes.**
On the seed repository page, tap "Use this template", then "Create a new repository". Owner: you.
Name: `alex`. Visibility: Private. Tap "Create repository from template". If the button is not in
the phone layout, use the browser's "Request desktop website".
It worked: a repository under your own name with one commit, and `INSTALL-ONLINE.md` in it, which
is this page.

**Step 4. The backup repository. 1 minute.**
Go to `github.com/new`. Name: `virtual-alex-backup`. Private. Nothing else. Create it empty.
It worked: an empty private repository. Every Sunday a Routine copies your notes into it.

**Step 5. The Claude app. 3 minutes.**
Install the Claude app from the app store. Sign in with the paid account.
It worked: the app opens on the chat screen.

**Step 6. Connect GitHub to Claude. 5 minutes.**
In the browser, open `claude.ai/code`. Tap "Sign in with GitHub". Approve. Then install the
Claude GitHub App on your account and select exactly two repositories: `alex` and
`virtual-alex-backup`. Do not use the `/web-setup` command; it stores a token that reaches every
repository you own, and the App is scoped to the two you picked.
It worked: `alex` appears in the repository selector on `claude.ai/code`, and an environment
named `Default` exists.

**Step 7. The two settings that decide who reads your notes. 3 minutes.**
Open `claude.ai/settings/data-privacy-controls`. Read it. Set "Help improve Claude" to OFF. Then
open the Claude Code settings on `claude.ai/code`, Sharing, and set "require recipients to have
repository access" to ON. Section 5 says what each one does. `/setup` will ask you later whether
you read the first page, and it will not finish until you say yes.
It worked: both switches sit where this page says.

**Step 8. The two cloud environments. 5 minutes.**
On `claude.ai/code`, open the environment selector and create two environments next to `Default`.
Type the names and the variables exactly:

| Environment | Variables | Network |
|---|---|---|
| `Routine` | `ALEX_ROUTINE` = `1` | Trusted (the default) |
| `Armed` | `ALEX_ROUTINE` = `1` and `ALEX_UNTRUSTED_LANE` = `cloud` | Trusted (the default) |

`Default` stays as it is. It is yours; a Routine never runs in it. `Routine` is for the jobs that
never read your mail or calendar (the sweep, the weekly copy, and the radar, which reads public web
feeds). `Armed` is for the two jobs that read your mail and calendar, and it adds one more wall: in
`Armed`, Alex cannot fetch a web page, so a hostile email cannot send it anywhere.
It worked: three names in the selector.

**Step 9. Connectors. 2 minutes.**
Open `claude.ai/customize/connectors` and connect Google, signing in with your PERSONAL account.
Never the mailbox your employer gave you. The rule this whole system runs on: employer data stays
out of your notes, and the line is the person, not the subject.
It worked: Google shows as connected.

**Step 10. `/setup`. 20 to 30 minutes, with Alex.**
Tap the session link from the person who set this up. It opens a session on `alex` with `/setup`
already typed. (Without the link: in the app, Code tab, pick `alex`, branch `main`, and type
`/setup`.) The screen takes a minute or two to start; that is a fresh machine being built for
you. The first screen shows a line reading `---DISPATCH-CONTEXT---`. That line is the proof the
repository loaded.

`/setup` reads your own words from the seed first. Then it asks you, one thing at a time: the
four settings from steps 1, 6, 7 and 9; five to ten things you have actually written (messages,
posts, emails, pasted into the chat); who Alex should be as a character; your goals; your colours
and fonts, or "skip"; your employer's email domain and your own address there; the name of your
backup repository; and finally whether you read the data-privacy page and what you chose. It
writes your identity file and the first pages of your notes as it goes, and every write is saved
to your repository within seconds.

It will push back if what you paste is thin, and it is right to. An identity built from three
sentences produces an assistant that writes like a machine. Give it more.
It worked: the last thing `/setup` prints is the instruction for step 11.

**Step 11. The proof. 3 minutes.**
Close the session. Open a NEW one on `alex`. That new session runs on a machine that did not exist
five minutes ago. Type `/alex-status`. It first prints which build of Alex you have and which
version of Claude Code runs it. The line after those must read:

```
Identity: loaded (<your name>, card <today's date>)
```

Then open `github.com/<you>/alex` on the phone. `soul.md` and a `vault/` folder sit in a commit
made minutes ago. One screen proves two things: your Alex survived a machine that was thrown
away, and your notes are on a disk you own.
If that line says `Identity: NONE`, `/setup` did not finish. Open a session and type `/setup`
again; it stops itself before overwriting anything real.

**Step 12. The five Routines. 12 minutes.**
In the browser, open `claude.ai/code/routines`. In a second tab, open `docs/ROUTINES-FORMS.md` in
your repository on github.com. That page is a table per Routine: the name, the one-line prompt,
the model, the schedule, which repositories, which environment, which connectors to keep. Copy
each field as written. Create them in this order, because the backup must exist before anything
else runs:

1. `alex-snapshot` (weekly, Sunday 04:15, BOTH repositories, environment `Routine`, no
   connectors). Tap Run now. Wait for it. Then open `virtual-alex-backup` on github.com: a branch
   named `claude/backup-<today>` exists. That is your first backup.
2. `alex-housekeeping` (weekly, Sunday 04:45, `alex` only, `Routine`, no connectors).
3. `alex-triage` (daily 05:00, `alex` only, `Armed`, Gmail only).
4. `alex-brief` (weekdays 06:15, `alex` only, `Armed`, Gmail and Calendar).
5. `alex-radar` (weekly, Sunday 23:30, `alex` only, `Routine`, no connectors).

The form adds every connector you have by default. Remove every one the table does not list.
It worked: five rows on the routines page, and one green run on the snapshot.

**Step 13. The next morning. 2 minutes.**
Open the app, Code tab, the `alex-brief` run. Read it. It opens with the health of every Routine
before it opens your inbox. That is Alex, every day after.

**What you never do:** open a terminal, type `git`, install anything, hold a passphrase, or read a
log file.

## 4. Where Alex lives, and how to read your notes

Your notes are plain text files in the `vault/` folder of your repository. Read them at
`github.com/<you>/alex` in the browser, or in the GitHub app. The `[[double bracket]]` links
between pages do not click there; they are names, and the search box finds the page by name. There
is no Obsidian in this version and nothing to install to read your own notes.

Every file Alex writes is saved to the repository within seconds, by code, not by Alex
remembering to. If a session is cut off mid-sentence, the last save is the last file write.

## 5. Who can read your notes

This section is the honest one. Read it once.

- **You.** Everything, always, from any device.
- **GitHub, the company.** The whole private repository, in plain text, for as long as it exists,
  plus their own backups. Anyone with your GitHub password reads the same, which is why step 1
  turned on two-factor. The backup repository is under the SAME account, so it protects you from a
  deleted repository, not from a taken account.
- **Anthropic.** Every session clones your repository onto one of their machines, and Alex reads
  whatever the job reads: your notes, the mail the triage Routine pulls, your calendar, every
  prompt, every answer. How long they keep the session is the setting from step 7: with "Help
  improve Claude" OFF, deleted within 30 days; ON, kept de-identified for up to five years and
  used for training. Those are their published numbers on 22 September 2026; read the current
  page before you decide.
- **The Claude GitHub App.** Write access to the two repositories you selected, and nothing else.
  Your real GitHub password never reaches the machine.
- **Google.** The mail and calendar it already holds. The traffic to it passes through Anthropic.
- **Anyone you share a session with.** On the Pro and Max plans a shared session link is public to
  any logged-in Claude user unless the second setting from step 7 is ON. Never share a session.
  Section 9 says what to send instead.
- **The person who set this up.** Can change what your Alex RUNS, because an update carries new
  rules and new commands, and you accept each one with a yes (section 7). Cannot read your
  repository, has no access to it, and never asks for any. That is a feature, and it is why support
  works the way section 9 describes.

**The two settings that change the picture:** "Help improve Claude" (30 days or five years) and
"require repository access" for shared sessions (a link that opens for anyone, or only for you).
Both are yours, both are in step 7.

**STOP and read this sentence twice.** Your notes live inside this repository. The repository
being Private is the only thing keeping them off the internet. Never make it public. Never add a
collaborator. Never share a session. Nobody will ever need you to do any of those three to help
you, and anyone who says otherwise is wrong.

## 6. Your copies, and the one thing that was lost

Three copies exist.

1. **The repository itself.** Every write, within seconds.
2. **The weekly snapshot** on `virtual-alex-backup`, a branch named `claude/backup-<date>`, made by
   the snapshot Routine every Sunday. Same GitHub account.
3. **The monthly ZIP download.** The only copy outside your GitHub account. On the first Monday
   of each month the brief carries one line with the link, shaped like
   `https://github.com/<you>/alex/archive/refs/heads/main.zip`. Keep the file somewhere that is
   not GitHub. It is never automatic and nobody nags you twice.

The laptop version of Alex kept an encrypted copy on your Google Drive that no account lockout
could touch. This version does not, and this page says so plainly. A lost GitHub account with a
lost two-factor device is a lost repository. The passkey from step 1 and the ZIP from this section
are the two things that stand in for it.

## 7. Getting updates later

When the person who set this up improves something, the improvement lands in the template your
repository was born from. It does not arrive on its own, and nothing announces it. No Routine can
see the template, so no brief can tell you that it changed.

What you can see is how old your own copy is. Type `/alex-status`. Its first line names the
template build your Alex carries, the date of that build, and when your copy took it. The brief
prints the same line on the first Monday of each month, with a reminder to run `/update`.

Run `/update` on that first Monday, or when the person who set this up tells you something is new.
If nothing is waiting, it says so and changes nothing. In a session of your own, type:

```
/update
```

It shows you every change since your version, in plain words, including which of the sensitive
files each change touches (the rules, the commands, the commit gate, the Routine orders). It waits
for your yes. Then it applies the difference as ONE commit written by you. It never touches your
identity file, your notes, your seed, your profile, your outputs, your inbox or your skill links.

**If a file does not apply cleanly, it puts everything back exactly as it was** and prints the
list of files. Alex keeps working as before. Send the list to the person who set this up.

One extra tap: for the `/update` session only you attach the template as a second repository,
next to `alex`. Type `/update` in a normal session first and it tells you the template's name (it
reads it from `system/template-source.json`), then start a session with both. It also checks that
the template's own tests passed, and it will not apply a version whose tests failed.

Two honest limits: updates arrive when that person pushes them, and nothing pushes them into your
repository without your yes. Running `/update` does not upgrade Claude, only Alex.

## 8. The rule about who writes in your repository

Nobody but you ever authors a commit in your repository. Not the person who set this up, not a
helper, not a Routine acting for someone else. Updates arrive as YOUR commit through `/update`.
Support arrives as text you copy out (section 9). Never accept a collaborator invitation on `alex`
to "fix something quickly"; the fix is a template change and a `/update`, or it is not a fix.

Why this is a law: a commit by anyone else breaks the promise that the repository is yours, and
the Routines refuse to push to a branch carrying commits by someone other than you, which would
stop Alex saving.

## 9. When something goes wrong

Three tiers. Pick the first one that matches.

| What happened | What to do |
|---|---|
| Alex runs, but something is wrong | Type `/support-bundle`. It writes one page, saves it, and prints it into the chat with a redaction report first. Long-press, copy, paste it to the person who set this up on WhatsApp. It contains no notes and no mail. |
| A session starts, but Alex sounds generic and has no commands | Take a screenshot of the first screen. Whether `---DISPATCH-CONTEXT---` is there is the whole diagnosis: absent means the session has two repositories or the wrong one. Start a new session with `alex` only. |
| No session starts at all | Open `status.claude.com`. If Anthropic is up, take a screenshot of the Runs pane on `claude.ai/code/routines` and send that. |

**Never send a session share link as support.** Read section 5 for why.

**The one alarm that reaches you without Alex.** A small check runs on GitHub's side every day at
07:00 UTC (the "Heartbeat" workflow). If no Routine has written for 48 hours, it fails, and GitHub
emails you. That email is the only signal that does not depend on Alex being alive.
**Day-one check:** open `github.com/settings/notifications` and confirm the email address is your
personal one and that Actions failures are emailed. Then, on your repository, Actions tab,
Heartbeat, "Run workflow". Before the snapshot has run, it fails on purpose, and the failure email
in your inbox is the proof the bell reaches you. After step 12 it passes every morning.

**What CI looks like on your repository.** Every save shows a run named `CI` on the Actions tab,
marked skipped. That is correct: the job only runs on the template, and a skipped job costs
nothing. The Heartbeat is the only workflow that runs on yours.

**The "uncommitted changes" line at the end of a turn.** After Alex writes a file, the screen may
say your repository has uncommitted changes; that is the platform looking a moment before the save
finishes, and the save lands right after it.

## 10. Two commands you may meet

Both appear only when a save says `refused` and names a file. Neither is ever a hand edit.

1. **A line that looks like a password but is not.** The secret scanner refuses any line shaped
   like a credential. If the line is a reviewed exception (a sample, a documented shape), put this
   at the end of that line and save again: `# secret-scan: allow`. The marker sits in the file
   where anyone can see it. A real credential is never allowed; it is removed and, if it was ever
   saved, rotated.
2. **A colleague's address at your employer's domain.** The employer-data guard refuses it. If the
   address belongs in your notes for a reason you can write down, tell Alex to run
   `node scripts/employer-data-guard.mjs --allow-address <the address> --reason "<why>"`. The
   reason is required and empty is refused. Nobody edits the allowlist by hand.

## 11. Skills, and what not to switch on

Your claude.ai account syncs Anthropic's own skills into every session (`pdf`, `xlsx` and others).
They are welcome; `xlsx` is how Alex makes spreadsheets here. Enable no third-party skill on
claude.ai. The skills in your repository were audited before they shipped; a skill switched on at
claude.ai skips that audit. The housekeeping Routine records the synced list every week, and the
brief says when it changed, so a surprise is visible even if nobody switched it on.

## 12. Pro or Max

Start on Pro. Fifteen runs a week, all at night, inside your own subscription. Switch to Max when
you see the signal, and not before: two rejected runs in one week (a rejected run shows up as a
"Missed 1" line at the top of the next brief), or the usage page at `claude.ai/settings/usage`
pinned to the weekly limit by Thursday. One week on Pro, then read the Runs pane and the usage
page on day seven and count.

## 13. What the person who set this up promises, and what they do not

Promises: the template works on the day it ships (its own checks pass before it is published);
every update shows you what it touches before you say yes; a support page you can read before
you send it.

Does not promise: to read your repository (no access, by design); anything Anthropic changes,
pauses or withdraws (both features this stands on are labelled research preview); the daily run
cap or your plan's limits; GitHub account recovery (a lost two-factor device is a lost repository,
which is what section 6 is for); same-day help.

## The shortest version

GitHub account with a passkey. Use the template, name it `alex`, Private. Empty `virtual-alex-backup`.
Claude app. GitHub App on both repositories. Improvement OFF, sharing verification ON. Two
environments, `Routine` and `Armed`. Google, personal only. Tap the link, `/setup`. New session,
`/alex-status`, your name on the `Identity:` line. Five Routines, snapshot first, Run now. Read the brief tomorrow.
