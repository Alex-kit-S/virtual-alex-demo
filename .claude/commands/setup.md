# /setup - First-Run Onboarding (Virtual Alex)

This is the Virtual Alex wizard: Alex running inside a Claude Code cloud session, on a private
GitHub repository born from a template, with nothing installed anywhere. Guide the owner through
it one step at a time. Wait for input before moving on. Every file you write is committed and
pushed by the autosave hook as you go; the last step reads the whole result back.

**`/setup --import` runs one section only.** If the arguments are `--import` (they are:
$ARGUMENTS), do not run the wizard. Go straight to the last section, "Bring your memory", and run
only that. It has its own check before it replaces anything, so the STOP CONDITION below does not
apply to it.

**STOP CONDITION, check this before anything else.** `/setup` is a FIRST-RUN wizard and every
write below assumes a fresh repository. Before running a single step, check whether `soul.md`
exists and contains a `## My Words` heading. **If it does, this is not a fresh install: STOP and
say so, naming the file and its size, and require explicit confirmation before any write.** That
corpus is months of harvested phrasing, it is the input to every prose surface Alex generates
(CVs, cover letters, posts, email drafts), and overwriting it fails silently: everything keeps
working, it just stops sounding like the owner. Online the file is IN git: the repository being
private is the barrier, and `soul.md`, the card and the vault live inside it, so a bad overwrite
is one commit back in history rather than gone. One commit back is a rescue, not a reason.
Never treat this as a formality.

Prerequisites (the owner did these before tapping the link; INSTALL-ONLINE.md is the step list):
- **This session has ONE repository attached: the owner's own private Alex repository.** If the
  first screen did not show `---DISPATCH-CONTEXT---`, the session has more than one repository or
  the wrong one, and the hooks, the commands and this constitution are not loaded. Say so, and
  tell them to start a new session with only this repository. Do not try to work around it.
- Connectors: the owner's PERSONAL Google account (Gmail, Calendar). Never an employer mailbox;
  Step 0 checks.
- If something is not connected, the system still works. Do not ask them to set up missing
  connections.

## Step 0: The four settings that decide who can read this repository

Ask each one as a yes or no question, one at a time, and WAIT. Record the answers for the
summary. A shrug is not a yes.

1. **GitHub two-factor.** "Is two-factor authentication on for your GitHub account, with a passkey
   or an authenticator app?" This account holds the vault. A password alone is not enough.
2. **The Claude GitHub App on both repositories.** "Is the Claude GitHub App installed on this
   repository AND on your backup repository (the step list calls it `virtual-alex-backup`)?" It
   is installed from claude.ai/code when connecting GitHub, never with `/web-setup`.
3. **Sharing verification.** "In the Claude Code settings at claude.ai/code, is 'require
   repository verification' for shared sessions switched ON?" Without it, a shared session link
   on Pro or Max opens for any logged-in user.
4. **Personal Gmail only.** "Is the Google account connected here your personal one, not your
   employer's?" The rule this system runs on: employer data stays out of this vault. The line is
   the person, not the subject.

If any answer is no: stop here, say exactly what to fix and where, and resume when they say it
is done. Do not go on with a no.

## Step 1: The profile, the skill links, the connections

1. **The install profile.** If `starter/install-profile.json` exists, copy it to
   `system/install-profile.json` (it carries this owner's wake and park choices from the seed).
   Otherwise copy `system/install-profile.example.json` to `system/install-profile.json` as it
   is. The file is tracked here, so the autosave commits it like everything else.
   **The locale file.** If `starter/` also holds a file named `locale-<code>-<domain>.md` (for
   example `locale-tr-gold.md`), copy it as it is, under the same name, into `vault/business/`.
   It is this owner's formatting rules and trade vocabulary, and the skills that write owner-facing
   text read it from `vault/business/locale-*.md` (`docs/LOCALE-LAYER.md`, item 3). Do not
   translate, tidy or merge it. No such file means the owner writes in English; skip this.
2. **The skill links and the commit gate.** Run:

```bash
node scripts/bootstrap.mjs --repair-links
```

   Read its two PASS lines back and quote them: the skill store (links match) and
   `core.hooksPath` (`scripts/hooks`, set and read back). Online the links under
   `.claude/skills/` are COMMITTED, and this is where they are born: the template never carries
   them, and a fresh VM checks them out with the repository from now on. If either line is a MISS,
   stop and show it.
3. **Connections.** Try Gmail (list 1 recent subject) and Calendar (today's events). Notion only
   if a Notion connector is attached; a missing Notion is not a fault.

Report: "I can see your [Gmail/Calendar]. [Anything not connected] isn't set up but we can work
without it."

## Step 2: Build Identity, seed first

**Read the committed seed first.** List `starter/`. If a file named `starter/ABOUT-<NAME>.md`
exists, read it whole. It is the owner's own words, carried here verbatim: do not rewrite it,
tidy it or summarise it back to them. Everything Alex learns about register starts there. If
`inbox/` holds files the owner committed on github.com, read those too and keep a "what I read"
list.

**Unless the file's first line is a draft label**: `> Draft, not <Name>'s own words.` followed by
who wrote it. Then the person who set this up wrote it FOR the owner, from what they know, and it
is facts to confirm, never a voice sample. Learn nothing about register from it. Take the owner's
voice only from what they write in this session. Where they correct a fact, their words win, and
their own words are what `soul.md` is built from. Leave the file itself as it is.

Then tell the owner, exactly:

```
I have read what you wrote about yourself. A few things I still need, in chat:
paste 5 to 10 things you have actually written (messages, posts, emails), tell me
who your agent should be as a character, and name your current goals. Type 'go'
when you are ready, or 'skip' on anything I can already answer from your file.
```

For a labelled draft, say this instead, exactly, and then ask what in it is wrong or missing:

```
I have read the notes someone who knows you wrote for me. They are not your words,
so I will not copy your voice from them. Tell me what is wrong or missing, then
paste 5 to 10 things you have actually written (messages, posts, emails), tell me
who your agent should be as a character, and name your current goals.
```

**WAIT.** Then extract from the seed and the chat: role, company, writing style, priorities,
people, projects. ONLY ask for what is missing:

- If the seed gives their role, do not ask again. Same for company.
- Always ask about personality: "If your agent was a character, who would it be? A sharp
  colleague? A calm mentor? Describe the vibe."
- Always ask about goals if the seed does not make them clear.
- If writing samples are not in the seed or the chat: "Paste 5-10 things you've actually
  written. Posts, messages, emails. I need your real voice."

Aim for 3 to 5 questions total.

### Sanity check on input quality (do NOT skip)

Before Step 3, verify you have real material: one of seed / resume / bio / detailed
self-description; a character answer (not one word); at least one concrete goal; 3+ writing
snippets or one long piece. If anything is thin or looks like filler ("idk", single words), push
back: "I need more on [X] before I can build a real soul.md. Otherwise you'll get a generic
agent." WAIT for more. Do NOT proceed with thin material.

## Step 3: Brand, in chat

YOU MUST STOP AND ASK THE USER. Do NOT skip this step automatically.

"Every report, chart and Excel I generate reads `brand/config/brand-config.md`. Two options:
1. **Give me your brand**: tell me your colours as hex codes and your fonts, here in chat. If you
   have a logo, commit it into `brand/images/` on github.com and tell me the filename.
2. **Use the defaults**: type 'skip'. You can change it later with /brand.
Which one?"

WAIT. Colours and fonts come from the owner, in chat, never from a file format. Exact hex values
live ONLY in `brand/config/color-system.md`; write them there and reference, never retype them
across files. Confirm: "Brand updated. Here's what I'm using: [colours], [fonts], [logo or none]."
On 'skip': "Using default brand. Run /brand anytime to update with your own."

## Step 4: Ingest Identity Into the Wiki

### A. Run /ingest

Run the `/ingest --batch` flow from `.claude/commands/ingest.md` against the seed and anything in
`inbox/`. Pasted chat text is saved to `inbox/onboarding-chat.md` first, then ingested too. That
command handles archiving to `vault/sources/`, the manifest `inbox/_ingested.md`, wiki pages and
`[[wiki links]]`.

### B. Write soul.md

**Re-check the STOP CONDITION at the top of this file before writing.** On a fresh repository
proceed.

Write `soul.md` fresh. Fill in EVERY section from what you collected. The card builder reads this
file, so the skeleton is not optional; write these headings in this order and nothing above the
first one:

```
# Soul - Who I Am
## Headless injection check (do not remove; anchored here on day one)
SOUL-CANARY-TOKEN: <token>
## My Role
## My Company/Business
## Writing Style
## How I Communicate
## My Priorities (most to least)
## Agent Personality - Alex
## Voice Rules (always active)
## Things I Never Want
## My Words (live corpus, agent-maintained)
### Standing rule (set on day one)
## Headless injection check (do not remove)
SOUL-CANARY-TOKEN: <the same token>
```

Generate the token once with `node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"`
and write the SAME value into both blocks. The top block is the one the model finds first; the
bottom block is how a Routine proves it received this file. The end block is the LAST thing in the
file. `## My Words` holds the standing rule only for now: the dated entries arrive from real
sessions, never from this wizard.

Generate the **Agent Personality** section using meta-prompting: core identity (one sentence),
how Alex talks (4-5 specific rules), addressing style (write the line as `**Addressing:** calls
the owner <name>`, because `/alex-status` reads that name back), emotional range, 5 example responses,
anti-patterns, and voice rules: the defaults are not blank. Write a `### Detection-proofing`
block under `## Voice Rules`, adapted to how THEY write: preserve their real phrasing and its
imperfections; vary sentence length hard; kill the word-level tells (hedges, stock transitions,
*delve*, *leverage*, *underscore*); present tense, direct statements, vocabulary from My Words;
their simple direct register beats correct formal English; and the structural tells a word list
cannot catch (colon reveals, faux-insight setups, importance puffery, weasel attribution,
summary-recap endings, fake-profound kickers, formatting slop). The long form with examples is in
`brand/config/writing-style.md` sections 1.9 to 1.17; write the short version and point there.
Alex has no gender: never he, him, she, her for Alex. Then **Things I Never Want**, inferred from
character and style.

soul.md MUST be fully filled. No placeholders. Keep the fresh draft tight, roughly 2 to 3 KB.
That is a floor for a new file, never a cap on a grown one.

### C. Top-up wiki pages

Add `vault/me/role.md`, `vault/me/goals.md`, `vault/me/preferences.md` from soul.md and the chat
answers, cross-referenced to the entity pages `/ingest` created.

### D. Index and log

Verify the pages from C are in `vault/index.md`. Append `## [YYYY-MM-DD HH:MM] /setup |
onboarding complete` to `vault/log.md`.

### E. Verify (no-dummy gate, do NOT skip)

1. **soul.md placeholder scan.** Fail on `TODO`, `TBD`, `FIXME`, `[your `, `[name]`,
   `<placeholder`, `<token>`, `lorem ipsum`, `Jane Doe`, `John Doe`, `example.com`, or a heading
   followed immediately by another heading.
2. **Real names.** Every `vault/people/*.md` filename is a real name from the seed or chat.
3. **Non-empty pages.** Every wiki page has more than 50 characters of body.
4. **Cross-references.** Every page has at least one `[[wiki link]]` (index and log excepted).
5. **Source provenance.** soul.md and the pages reflect `vault/sources/`. A fact you could not
   extract is left absent, never invented.
6. **Voice match.** The example responses use the owner's actual style, not generic phrasing.
7. **The card builds.** Run `node scripts/lib/build-soul-core.js` and read `tail -1 soul-core.md`
   back: a `SOUL-CORE-STAMP` line with `entries=0 pinned=0 token-count=2`. A refusal names the
   missing heading or the token problem; fix soul.md and run it again.

If any check fails: say which, fix it, re-run. Do not move on until all seven pass.

### F. Show the owner

Read soul.md back. List the vault pages with their cross-references. Ask: "Does this sound like
you? Anything to fix?" WAIT for confirmation before Step 5.

## Step 5: Notion, and it is OPTIONAL

Ask first: "Do you use Notion? It is not required." If no, skip and say so. If yes: create a
"Personal Ops System" parent page, store its id in `vault/projects/notion-parent-id.md`, and
create no boards. Each project creates its own database lazily, the first time it needs one.

## Step 5b: What the Radar should watch, and it is OPTIONAL

`/radar` runs as a weekly Routine and reads a source list that **ships empty; do not fill it in
from your own head.** Ask: "Is there anything you check regularly to keep up with your field? A
newsletter, a subreddit, a tool whose release notes you read? Name two or three and I will watch
them once a week. Or say skip." If they skip: "Fine. /radar will say it has no sources until you
name some." If they name sources: find the free, keyless feed for each (a GitHub project is
`https://github.com/{owner}/{repo}/releases.atom`), fetch each one before writing it down, leave
out anything with no free feed and say so, write them into `system/install-profile.json` under
`radar.feeds` (shape in `system/install-profile.example.json`), and read the list back with
`node scripts/lib/radar-feeds.js`. The honest limit here: the radar runs on Sunday night as a
Routine; a week it did not run shows as `missed` in the run log, visible, not undone.

## Step 6: The employer line

Ask two things and WAIT for each:
1. "What is your employer's email domain?" (the part after the @, for example `company.example`)
2. "What is your own address at that domain?"

Write them into `system/install-profile.json` as two keys, `employer_domain` and
`owner_work_address`. Say what they do: the employer-data guard reads them, and any OTHER address
at that domain in a file about to be saved is refused by the autosave and by the commit gate,
named, never silently dropped; the owner's own address passes. This is the mechanical half of
the rule from Step 0, item 4. If they have no employer, write both keys as empty strings and say
the guard has nothing to match.

## Step 6b: The second copy

A private repository on GitHub is one copy, and GitHub is not a backup of itself: a locked
account or a deleted repository takes the vault with it. Ask: "Which private repository did you
create as the backup? The step list names it `virtual-alex-backup`." Record the answer as
`backup_repo: <owner>/<name>` in the frontmatter of `vault/projects/recovery/status.md` (create
the page if it does not exist). Then say, in these words or close: "The weekly snapshot Routine
copies this repository to that one as a branch named `claude/backup-<date>`. You create that
Routine after this wizard, from `docs/ROUTINES-FORMS.md`, with BOTH repositories attached. The
first `Run now` is the proof: the branch appears on the backup repository, and `/alex-status` reads
it back from then on. The monthly ZIP download is the only copy outside your account."

## Step 6c: The weekly bell in the owner's own calendar

One reminder that lives outside GitHub, outside the Routines and outside this repository, so it
still fires the week everything else has gone quiet. The permission rules of this repository deny
every calendar write (`mcp__*__create_event` is in the deny list, in every session, the owner's
included), so the owner creates it and you read it back:

1. Say: "Open your calendar app and create one weekly event: title `Did Alex write this week?`,
   every Sunday at 09:00 your local time, no attendees, no invitation. Tell me when it exists."
   WAIT.
2. Read it back through the Calendar connector: search the next fourteen days for that title and
   quote the first instance (date, time, and that it repeats weekly). If nothing comes back, say
   so and ask again; do not go on with a bell that does not ring.
3. Say what it is for: "When that reminder fires, open github.com/<you>/alex and check that the
   newest commit is from this week. If it is not, Alex has stopped writing, and nothing else may
   have told you."

## Step 6d: Stamp the registry

1. **`created:` in each status page.** Every `vault/projects/{name}/status.md` gets a `created:`
   date in its frontmatter; the sweep ages a project against it.
2. **`first_fire` stays null** until something first really runs. Stamp `first_fire` and
   `first_fire_kind` in `system/manifest.json` the first time each project produces something
   real, then run `node scripts/generate-alex.js`.

## Step 7: Data privacy. BLOCKING. Do not skip this and do not let them skip it.

This is the single largest data transfer in the whole design, and it is one settings page.

Tell them: "Open `claude.ai/settings/data-privacy-controls` on your phone or laptop, read it, and
choose. The one-sentence fact: with 'help improve Claude' ON, Anthropic keeps de-identified
conversation data for up to five years; OFF, it is deleted within thirty days. Come back and tell
me two things: that you read the page, and what you chose."

WAIT. **Refuse to finish the wizard until they say both.** "I'll do it later" is not a yes; say
that the setup stays open and wait. When they answer, write one line into
`vault/me/preferences.md`: the date, "read the data-privacy page", and the choice in their words.

## Step 8: Save, and prove it

1. Rebuild the card one last time (`node scripts/lib/build-soul-core.js`; it is a verified no-op
   when nothing changed) and quote `tail -1 soul-core.md`.
2. Save everything through the autosave, in stop mode so it rebases, pushes and reads back:

```bash
bash scripts/autosave.sh --stop
```

   Quote its result line. It commits `soul.md`, `soul-core.md`, `vault/`, `.claude/skills/`,
   `system/install-profile.json` and the brand files together as the owner's own commit, pushes
   `main`, and reads the pushed ref back. A `refused` in that line names a file the content legs
   would not save; show it and fix it before going on.
3. Read it back from the outside: `git ls-files soul.md soul-core.md system/install-profile.json
   | wc -l` must print 3, and `git ls-files -s .claude/skills | head -3` must show mode `120000`
   entries.

## Step 9: Done

Summary, with REAL numbers read from the tree rather than typed here:
- Settings confirmed: 2FA [yes], the App on both repositories [yes], sharing verification [ON],
  personal Gmail [yes]
- Connections: [what answered, what did not]
- soul.md: written, [N] KB, built from the seed plus [N] writing samples; card built, entries=0
- Brand: [their own / neutral default]
- Vault: [X pages] created
- Employer line: [domain recorded, own address recorded / none]
- Backup repository: [owner/name recorded; the snapshot Routine still to create]
- Weekly bell: [`Did Alex write this week?` read back from the calendar, first on <date> / NOT created, and this is the one to finish]
- Data privacy: [read, chose ON/OFF on <date>]
- Saved: [the autosave result line, with the pushed commit]

### Final message

**Read the command list from disk before printing it.** `ls .claude/commands/` is the truth; a
list typed into this file drifts the first time a command is added or removed.

Tell them, in this shape:

```
Alex is set up.

Start with something real, not a settings screen. Commit a document you are
actually working on into the inbox folder on github.com and say: process this.

The things you will use most:

  /morning-brief    what to deal with today, in seven lines
  /meeting-intel    drop any file in, get the decisions and the action items
  /research-team    proper research on a question, with sources
  /prompting        say what you want in plain English, get a precise brief back
  /email-triage     your inbox sorted, replies drafted, nothing ever sent
  /teach-alex       tell me when I get something wrong, and I stop getting it wrong

  /alex-status      is Alex ok
  /self-review      Alex reviews Alex and proposes improvements

Housekeeping: /brand, /ingest, /lint, /new, /support-bundle, /update.

Three things worth knowing on day one:
  I draft email. I never send it. You press send.
  Your notes live in this private repository and nowhere else; the weekly
  snapshot copies them to your backup repository.
  Next: create the five Routines from docs/ROUTINES-FORMS.md, snapshot first.
```

Then print this, as the last thing the wizard says, exactly:

"close this session, open a new one on this repo, type /alex-status; if the line that starts Identity: says loaded with your name, Alex is you"

## Bring your memory (`/setup --import`)

For an owner who already runs Alex on a laptop and wants that memory here. It carries `soul.md` and
`vault/` and nothing else. **Run it after `/setup`, never before:** `/setup` writes the settings
this repository needs, including the employer line the content check reads, and this step then
replaces its fresh `soul.md` with the laptop one, only with a yes.

**The ZIP must never become a commit.** Online, every committed byte stays in the repository's
history forever, and uploading a file on github.com with "Add file" is a commit. So the ZIP arrives
as a release attachment on this repository, which is not in the history, and it is deleted at the
end.

1. **The ZIP, on the laptop.** Ask the owner to compress their Alex folder, or just `soul.md` and
   the `vault` folder, into one file named `memory.zip`. Nothing else in it is read.
2. **Attach it to a release on THIS repository.** On github.com, in this repository: Releases,
   "Draft a new release", create the tag `memory-import`, attach `memory.zip`, tick "Set as a
   pre-release", Publish. Say it plainly: **do not use "Add file" and "Upload files"; that makes a
   commit, and a commit of your whole memory stays in the history forever.** WAIT until they say
   it is done.
3. **Download it outside the working tree.** `<owner>/<repo>` is the repository this session is
   attached to, as the dispatch context names it:

```bash
gh release download memory-import --repo <owner>/<repo> --pattern memory.zip --dir "${TMPDIR:-/tmp}/alex-import" --clobber
```

4. **The plan, before anything is written.**

```bash
node scripts/import-memory.mjs "${TMPDIR:-/tmp}/alex-import/memory.zip"
```

   It is a dry run. Show the owner its last line, what it skips and why, and every file it would
   replace. On `REFUSED`, show every REFUSED line and stop: nothing was written. A file flagged by
   the content check (a credential shape, employer data) is fixed on the laptop and attached
   again, or, if the owner says so, left out with `--skip-flagged`, which leaves out exactly the
   files it named.
5. **Replace only with a yes.** If the plan names files it would replace (`soul.md`, after
   `/setup`), list them and ask. Then write:

```bash
node scripts/import-memory.mjs "${TMPDIR:-/tmp}/alex-import/memory.zip" --apply
```

   Add `--overwrite` only after the owner said yes to that list; without it `--apply` refuses
   while any target exists. Quote the `WROTE` line.
6. **Save and prove it.** `node scripts/lib/build-soul-core.js`, then `bash scripts/autosave.sh
   --stop`, and quote its result line. A `refused` in it names a file the commit gate would not
   save; show it.
7. **Delete the release, with a yes.** Until it is deleted, the ZIP is a full copy of their memory
   on GitHub. Ask, then:

```bash
gh release delete memory-import --repo <owner>/<repo> --cleanup-tag --yes
gh release view memory-import --repo <owner>/<repo>   # must fail now: that is the read-back
rm -rf "${TMPDIR:-/tmp}/alex-import"
```

8. **Tell them** how many files came in, what was skipped and why, and that the release is gone.
   Their laptop keeps its own copy; nothing flows back to it.
