# What Alex is

Alex is a personal assistant made of Claude, Anthropic's AI model, working inside a folder of
instructions, notes and commands that belongs to one person. Take the folder away and what is left
is plain Claude.

## What it does for its owner

- **Sorts the inbox every morning** and drafts replies. The owner reads each draft and sends it
  themselves.
- **Writes a morning brief**: the day's calendar, the mail that needs an answer, and anything
  waiting on the owner.
- **Keeps notes that last.** People, projects, meetings and decisions go into a set of linked
  pages that Alex updates as the owner talks to it. The pages are plain text the owner can read.
- **Writes in the owner's voice.** During setup the owner pastes things they have actually
  written, and Alex learns their register from those, not from generic business English.
- **Runs a weekly radar** over the news sources and keywords the owner picks.
- **Checks itself.** A weekly sweep looks for anything broken, and a monthly self-review proposes
  improvements, which wait for the owner's yes.

It also has commands for one-off jobs: preparing for a meeting, researching a question, testing a
business idea, or turning a rough request into a clear instruction.

## What it is not

- **Not a chatbot that forgets.** Its memory is files, and the owner can read every one.
- **Not allowed to act alone.** It drafts messages and never sends them. A change to its own
  rules needs the owner's yes.
- **Not a hosted service.** No Alex company runs a server. The owner's files live on their own
  computer or in their own private GitHub repository, and Claude does the thinking.
- **Not free.** It needs a paid Claude subscription. Pro is enough to start.

## Two ways to run it

| | On a laptop | Online (Virtual Alex) |
|---|---|---|
| Where it runs | Claude Code on a Windows or Mac computer | Claude Code cloud sessions, from a phone or a browser |
| Where the notes live | a folder on the computer, with an encrypted backup on Google Drive | the owner's private GitHub repository |
| What runs on a schedule | the computer's own scheduler | five Routines on the owner's Claude account |
| What to read first | [GETTING-STARTED.md](GETTING-STARTED.md) | [INSTALL-ONLINE.md](../INSTALL-ONLINE.md) |

Both run the same rules, commands and skills. How each one is built:
[ARCHITECTURE.md](ARCHITECTURE.md) for the laptop and
[ARCHITECTURE-ONLINE.md](ARCHITECTURE-ONLINE.md) for the online version.

## Who can read the owner's notes

The owner, always. Anthropic, while a session is working on them, for as long as the owner's
privacy setting allows. GitHub, for the online version, because the repository sits there. The
person who set Alex up for someone has no access to their notes. [SECURITY.md](../SECURITY.md)
names every safeguard, and section 5 of the online install guide goes through each reader in turn.
