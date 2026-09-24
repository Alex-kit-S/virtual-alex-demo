<!-- GENERATED FILE - do not hand-edit. Source: templates/getting-started.template.md + system/manifest.json + scheduler/schedule.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated {{GENERATED_STAMP}}. -->

# Getting Started

What you need, how to open Alex, what runs on its own, and how to tell it is working.

This is the technical version. If somebody handed you a printed guide, use that one instead: it has
pictures. For how the system is designed and why, read `docs/ARCHITECTURE.md`.

## 1. What you need

- **A paid Claude account.** Alex IS Claude. No subscription, no brain. This system is tuned for the
  Pro plan: only two scheduled jobs spend any allowance, and `/deep-audit` ships disabled.
- **Claude Code**, either the VS Code extension or the CLI. Windows 10/11, or macOS 13+.
- **A Google account** for Gmail, Calendar and Drive. Drive is where the encrypted backup goes.
- **Obsidian**, free, to read the vault as a linked notebook.
- **Notion is OPTIONAL.** Everything works without it. It adds a view you can share with somebody.
- About an hour, most of which is unattended.

## 2. Install and first boot

1. **Run the installer for your machine.** Windows: double-click `Install-Alex.cmd` and approve
   one Windows prompt. Mac: double-click `Start-Here.command` and type your Mac password once, near
   the beginning. Either way: sign in to GitHub and Google when the browser opens, and wait. It
   installs the tools, downloads the system, connects the backup and registers the scheduled jobs.
   If anything fails it stops and writes one plain sentence to `install-log.txt` on your Desktop.

   Doing it by hand instead - Windows: `git clone -c core.longpaths=true <your repo url>
   "%USERPROFILE%\Alex"` · Mac: `git clone <your repo url> ~/Alex` - then, on both:
   `node scripts/bootstrap.mjs --repair-links`.

   **A fresh clone has no vault and no `soul.md`.** Both are gitignored on purpose, and `/setup`
   writes them from your own answers. So a clone is a working system with no memories yet, not a
   broken one.

2. **Your repository is PRIVATE, and it must stay that way.** `.gitignore` is the only thing between
   your notes and the internet. Never make the repo public, and never force-add a file the system
   tells you is being kept out. The monthly security sweep asks GitHub directly and reports a
   mismatch, but the setting is yours to protect.

3. **Open the FOLDER. This is the step everything depends on and the one people get wrong.**
   Claude Code only becomes Alex inside the folder it is opened in. Dragging the folder into the
   chat, attaching `CLAUDE.md`, or pasting a path does not work: you get plain Claude, no commands,
   no memory, no personality.
   - **VS Code:** File, then Open Folder, then pick the `Alex` folder itself. It stays in your
     recent folders, so every later session is one click.
   - **Command line:** move into the folder FIRST, then start Claude Code
     (Windows shown; on a Mac it is `cd ~/Alex` then `claude`):
     ```
     cd "%USERPROFILE%\Alex"
     claude
     ```
     On Mac or Linux: `cd ~/Alex` then `claude`. Starting `claude` from your home folder and opening
     files from there is the single most common first-session mistake.
   - **Do not open a subfolder** like `work/` or `docs/`. The folder you open must be the one that
     directly contains `CLAUDE.md`.

4. **Check it worked before doing anything else.** Type `/status`.
   - Alex answers with a health report: the folder is loaded. Go to step 5.
   - **"unknown command": the folder is NOT loaded.** Close the session and redo step 3. Nothing
     below will work until `/status` answers, and no other cause is worth investigating first.
   - Alex answers but sounds generic: that is correct before `/setup`. There is no `soul.md` yet, so
     there is no voice yet. The session start will say so plainly rather than pretending.

5. **Run `/setup`.** It interviews you and writes `soul.md` and the vault. **Bring three or four
   things you have actually written**, real emails or documents. It will push back if the material
   is too thin, and it is right to: an assistant built from three sentences writes like a machine.

   `/setup` also asks you to choose the backup passphrase. Put it in your password manager the
   moment you choose it. **If it is lost, every backup becomes permanently unreadable and nobody can
   recover it for you.**

6. **Connect services** at claude.ai, Settings, Connectors: Gmail, Calendar and Drive in one Google
   sign-in, Notion if you want it. These are one-time authentications and they persist. Install the
   Claude in Chrome extension if you want Alex to read web pages.

**The first session, in four lines.** Open the `Alex` folder (the folder, not a file). Type
`/status` to confirm it loaded. Type `/setup` and answer the questions. Then `/brand`.

## 3. Make it yours

- **`/setup` first.** Then `/brand` so documents look like you rather than like nobody.
- **Then hand-refine `soul.md`.** It is the biggest lever in the system: it is your voice.
- **Correct it as you go.** `/teach-alex` turns a moment of annoyance into a permanent rule. That is
  the mechanism the whole system compounds on.

## 4. The automations ({{AUTOMATION_COUNT}} registered, non-retired)

`system/manifest.json` is the source of truth; this list is generated from it.

{{AUTOMATION_LIST}}

**Utility commands:** {{UTILITY_COMMANDS}}

## 5. The tools Alex reaches (MCP)

MCP tools are deferred: load them with `ToolSearch("select:<tool>")` before calling. Prefer an MCP
tool when one exists; use Chrome only for sites with no connector, and never for Gmail, Calendar,
Drive or Notion. Connected surfaces, from the MCP Reference of `CLAUDE.md`:

{{MCP_LIST}}

## 6. What runs on its own

**Everything triggers on sign-in with a delay, not at a set hour**, except the monthly review. A
laptop is not reliably awake at 05:00, and a job that never runs looks exactly like a day where
nothing happened. You open the laptop, and the work has happened by the time you have finished your
coffee.

**Two scheduled jobs spend Claude allowance**: `/email-triage` on every sign-in, and `/self-review`
once a month. Everything else is a zero-token script that costs nothing.

That split is deliberate. `/morning-brief` is on demand because typing it costs you thirty seconds
and scheduling it would cost allowance every single day whether you read it or not. `/self-review`
IS scheduled, because it is the only thing that reads the pile of lessons the system collects every
night, and two people who never type it by hand would end up with a system that learns nothing.
Monthly rather than weekly for the same reason in the other direction: a weekly reasoning run spends
allowance you want for real work.

- **How a scheduled job works:** the scheduler fires, runs `claude -p "Run /{command}"`, the work
  happens, the process exits. Each run is a fresh session.
- **The jobs are hardened, not naive one-shots.** The wrappers detect failure, write GREEN or RED to
  `system/run-status.json`, raise a desktop notification on RED, and self-schedule a retry.
  Neither scheduler's own restart setting covers a run that fails cleanly, so it is not the retry.
- **Check them** - Windows: `schtasks /query /fo LIST | findstr Alex` · Mac:
  `launchctl list | grep Alex` - logs in `outputs/logs/`.
  Pause everything: `/cron-setup off`. Resume: `/cron-setup on`. Nothing is lost while paused.

### The scheduled jobs (from scheduler/schedule.md)

| Job | Command | Frequency |
|---|---|---|
{{SCHEDULED_JOBS}}

## 7. Backup and recovery, in one paragraph

Two backups. Git pushes the functional system (code and docs, never the vault, never `soul.md`) to
your PRIVATE GitHub repo. The personal half (the whole vault, `soul.md`, your writing) is tarred,
encrypted with gpg AES256 using your own passphrase, **decrypted again to prove it can be opened**,
and shipped to your own Google Drive with rclone, last 14 kept. Google holds ciphertext only. Prove
the whole chain on install day rather than trusting it. Windows:
`powershell -File work/18-recovery-layer/escrow-test.ps1` pulls the newest backup back down and
decrypts it with the passphrase from your password manager. Mac: no ported escrow test yet - pull
the newest `vault-*.tar.gpg` with rclone and decrypt it by hand, same proof. Full detail: the Backup & Recovery
section of `CLAUDE.md`.

## 8. Success checklist

- `/status` runs and reports.
- After `/setup`, Alex has a voice.
- Services connected: a real `/morning-brief` produces a real brief.
- A scheduled job has fired (check `outputs/logs/` or `system/run-status.json`).
- **The backup has verified once, and the passphrase is in your password manager.** This is the only
  item on this list that cannot be fixed later.

## 9b. Getting improvements later

You never download or install Alex again. Double click **`Update-Alex`** in your Alex folder, wait
under a minute, then type `/status` to confirm. Full walkthrough including what the screen says and
what to do if a step is skipped: **`docs/UPDATING.md`**.

## 9. When something looks broken

- `/status` says "unknown command" -> wrong folder. Section 2, step 3.
- Alex sounds generic -> `/setup` has not run.
- A message says a job did not run -> nothing is lost, type the command by hand to catch up.
- Everything is slow or refusing -> you have used this window of your Claude plan. It comes back on
  its own. Nothing is broken.
- Anything else -> `/support-bundle` packages the logs, with your notes and email deliberately left
  out, into one file you can send for help.
