# Security

Virtual Alex runs in Claude Code cloud sessions on its owner's private GitHub repository. This
page names each safeguard, what it stops, and how to report a problem. The laptop version of the
Kit has a different set; the last table compares the two.

## Reporting a problem

- **In this template's code:** keep the details out of public issues and pull requests. Use the
  Security tab and "Report a vulnerability". If that button is not there, open an issue titled
  "Security contact" with no details, and the maintainer will reply with a private way to send it.
- **In your own Alex:** type `/support-bundle` and send the page it prints to the person who set
  it up. It holds no notes and no mail. Never send a session share link.
- **A secret got saved:** it is in the repository's history now. Change it where it was issued
  first, then remove it.
- **Your GitHub account may be in someone else's hands:** secure the account first (password,
  passkeys, active sessions), then tell the person who set Alex up. The backup repository sits in
  the same account, so it is exposed too.

## The safeguards

1. **A private repository.** It is the only place the notes live. It stays Private with no
   collaborators, and the Claude GitHub App reaches only the two repositories the owner picked.
2. **The deny list** (`.claude/settings.json`). Refused in every session: sending, replying,
   forwarding, sharing or deleting through a connector; creating, changing or answering calendar
   events; and edits to Alex's own settings, commands, hooks, script library, workflows,
   `.mcp.json` and skill lock. Changes to those arrive only through `/update`.
3. **The lane guard** (`scripts/untrusted-lane-guard.js`). Runs before every tool call in
   sessions a Routine starts. It refuses `gh`, remote git, connector actions that send or delete,
   writes to identity files, and web addresses in shell commands other than the machine itself.
   In the Armed environment, where triage and the brief read mail, WebFetch and WebSearch are
   refused too, so a hostile email has nowhere to send what it reads. Every block is written to
   `outputs/logs/untrusted-lane-blocks.jsonl`.
4. **The autosave's checks** (`scripts/autosave.sh`). Before anything is staged, each changed file
   passes a 10 MB size limit, the secret scan and the employer-data guard. A refused file stays
   unsaved and is named to Alex. In a Routine session, any change to an identity file is undone
   first: a scheduled job writes notes, never the rules.
5. **The commit gate** (`scripts/hooks/pre-commit`), on every commit: the secret scan, the size
   limit, the employer-data guard and the validator, which refuses edits to protected files and
   malformed machine files. A check that cannot run blocks the commit.
6. **The privacy choice.** `/setup` does not finish until the owner has read Anthropic's
   data-privacy page and said what they chose: sessions deleted within 30 days, or kept for up to
   five years for training.
7. **The Heartbeat.** An alarm rather than a wall: a GitHub Actions workflow emails the owner when
   no Routine has written for 48 hours.

## What these safeguards do not cover

- GitHub stores the repository, and Anthropic processes every session. Section 5 of
  [INSTALL-ONLINE.md](INSTALL-ONLINE.md) says who can read what, and for how long.
- A lost or taken GitHub account takes the repository and its backup with it.
- A skill switched on at claude.ai skips the audit this repository's skills passed.
- In Routine sessions the web tools stay open, because the radar reads feeds. Anthropic's
  Trusted network list is the limit there.

## Laptop and online, side by side

| | Laptop Kit | Virtual Alex |
|---|---|---|
| Where the notes live | on the laptop, never committed | in the owner's private GitHub repository |
| Copy outside GitHub | encrypted, on the owner's Google Drive | the monthly ZIP the owner downloads |
| Deny list in `.claude/settings.json` | none; the Draft Gate is a written rule | refuses send, reply, forward, share and delete, calendar writes, and edits to Alex's own settings, commands, hooks and workflows |
| Lane guard armed by | the email-triage and morning-brief jobs | the Routine and Armed cloud environments |
| Commit gate | secret scan, size limit, gitleaks, personal-data scan, clone-scrub, validator | secret scan, size limit, employer-data guard, validator |
| Save on every file write | no; the system is saved nightly | yes, with the same content checks before anything is staged |
| A scheduled job changing identity files | not applicable | undone before the save |
| Alarm when nothing ran | the weekly recovery sweep | a daily email from GitHub's Heartbeat workflow |

How the online version is built: [docs/ARCHITECTURE-ONLINE.md](docs/ARCHITECTURE-ONLINE.md).
