# Recovery Layer

## Type
System layer (scheduled, zero-token) plus on-demand tools.

## Purpose
The layer that notices when something quietly stopped being true.

Everything else in this system is edge-triggered: a rule fires when a session remembers it. Sessions
end halfway, propagation gets missed, a document keeps claiming something the code stopped doing.
This layer is level-triggered instead. It re-checks the WHOLE system against the desired state in
`system/manifest.json`, every time it runs, and it does not care whether anybody remembered to tell
it something changed.

**It DETECTS. It never repairs by itself.** That is deliberate and it is not timidity: an automatic
fix for a problem nobody has looked at is how a small drift becomes a confident wrong answer.

It also owns the two backups, which is the other half of the same job. A system that notices
problems but cannot be restored has solved the easier half.

## Entry Points
- **Scheduled:** the sweep and both backups run on sign-in with a delay (`scheduler/schedule.md`).
- **On-demand:** `powershell -File work/18-recovery-layer/check.ps1` for the sweep,
  `-DryRun` to run it without writing a status row, `-Init` to re-baseline after real changes.
- **The restore drill:** `powershell -File work/18-recovery-layer/escrow-test.ps1`. Pulls the newest
  backup back down from Drive and decrypts it with the passphrase from the password manager. Run it
  on install day, not "later". An unproven backup is not a backup.
- **The security sweep:** `powershell -File work/18-recovery-layer/security-sweep.ps1`, monthly or
  when something feels wrong.

## Exit codes
`0` clean, `2` drift found, `1` the checker itself broke. Drift is a normal result, not a failure:
exit 2 means "here are three things to look at", and it is meant to be seen rather than feared.

## Virtual Alex: `check.mjs` (2026-09-23, plan Phase 4)
Inside a Claude Code cloud session there is no PowerShell, no Task Scheduler, no passphrase and no
encrypted tar, so the sweep there is `node work/18-recovery-layer/check.mjs`: Node builtins only,
thirteen legs, the same detect-never-repair rule and the same exit semantics with one sharpening,
`1` also means a RED leg (data loss or a wall that is down), `2` an AMBER one. Six legs are ported
from `check.ps1` (C6, C9, C11, C12, C22, C23; C9 and C22 go RED on a shrink) and seven are the
online shape: R1 every Routine has a run-log row inside its `cadence_hours` plus six hours, R2 the
backup repository lists a `claude/backup-*` branch inside eight days, R3 every Routine's newest row
reports the registry's default model, N the never-list is absent from `git ls-files`, H
`core.hooksPath` is `scripts/hooks`, M no auto-memory directory has appeared inside the clone, S the
housekeeping skills snapshot could read its list. Findings go to `vault/projects/recovery/last-sweep.md`,
whose frontmatter carries the high-water marks the next run compares against (there is no `-Init`
and no `state/` baseline online), and one `sweep` row is appended to `system/run-log.jsonl`. It runs
as leg 1 of the weekly housekeeping Routine (`scheduler/routines/housekeeping.md`) and by hand in any
session; `--dry-run` prints and writes nothing. Negative tests: `scripts/tests/test-check-mjs.mjs`.

## Tools Used
PowerShell 5.1 only (`Get-ChildItem`, `Get-FileHash`, `Get-ScheduledTask`), plus Node for the fact
ledger and `git` for the credential probe. **No model calls. No connectors. Zero cost.** The only
network touch is C15's read-only `git ls-remote`, and no network is a SKIP there rather than a
finding.

## Where the findings go
- `vault/projects/recovery/last-sweep.md` - the human-readable report.
- `system/run-status.json` - one row, GREEN when clean and AMBER when drift was found. Drift never
  raises a desktop notification and is never RED: it means a document and the system disagree, which
  is worth an hour this week and is not an emergency tonight. RED is reserved for "something did not
  run at all", so RED keeps meaning exactly one thing.
- `/status` reads both and says them in plain words.

## The checks (21 total, all deterministic, each one grown from a real miss)

The numbers are stable and retired numbers are never reused, because every reference to "C13" in
this repo and in anybody's memory would otherwise silently point somewhere else.

1. **C1 quad completeness** - each manifest project has its work directory, its spec, its status page
   and every command file it declares.
2. **C2 orphan commands** - every `.claude/commands/*.md` is owned by a project or the utility list.
3. **C3 orphan work folders** - every `work/` directory is a manifest project or explicitly known.
4. **C4 orphan vault projects** - every `vault/projects/*` is registered.
5. **C6 wiki-link resolution** - every `[[link]]` resolves to a real page. Valuable for an owner
   whose vault will accumulate broken links faster than they notice.
6. **C7 scheduler versus Task Scheduler** - every documented job is registered and every registered
   job pointing at THIS folder is documented.
7. **C7b trigger shape** - the documented trigger and the live trigger must agree on shape and delay.
   Rewritten for this system: the original compared a wall-clock hour and skipped any task without
   one, which meant it had zero subjects here and would have passed forever while proving nothing.
   It now catches a task that lost its delay or got converted back to a wall clock, which is the
   failure that would also silently kill the desktop notification.
8. **C8 dependent staleness** - a project whose spec changed since the last `-Init` but whose status
   page did NOT. Hash-based, so a mass file rewrite cannot fake it in either direction.
9. **C9 log monotonicity** - `vault/log.md` may never shrink. It is append-only, so a smaller file
   means data loss.
10. **C10 uncommitted spec drift** - a spec that differs from its committed version.
11. **C11 index versus disk** - every project's status page is catalogued in `vault/index.md`.
12. **C12 outputs naming** - `outputs/` top-level directories must be manifest keys.
13. **C13 first-fire aging** - a LIVE or EVENT project that has never actually produced anything may
    age at most 14 days. This is the check that stops a scaffold from masquerading as a system.
14. **C14 passphrase attestation** - the backup passphrase must be re-confirmed every 90 days. It
    never reads the secret, only the date it was last attested. **This is the check that saves an
    owner from themselves**, because a lost passphrase makes every backup permanently unreadable
    and nothing else in the system can tell you it has happened.
15. **C15 git credential freshness** - can the backup push still reach the remote. Rewritten from a
    hardcoded token-expiry date, which only worked if you used a token and remembered to retype a
    constant. **No network is a SKIP, never an amber**: working offline is a normal day, and a check
    that goes amber every time you do is a check people learn to ignore.
16. **C17 skills junction restore guard** - every unparked skill has a resolving junction. They are
    gitignored links, so a clone or a restore silently loses them and the skill just stops loading.
17. **C20 backup destinations** - at least `meta.paths.backup_min_destinations` destinations verified
    a copy inside the window. The threshold is data, not a literal, so it can be raised the day a
    second destination genuinely exists rather than ambering forever until then.
18. **C21 facts-ledger doc drift** - standing documents tested against the fact ledger. This is the
    guard against the pointer-rot class: a document that is still linked, still readable, and no
    longer true, which produces no error anywhere. It also sweeps every project spec against the
    registry.
19. **C22 soul-corpus monotonicity** - `soul.md` "My Words" may never SHRINK. The voice corpus is the
    highest-value irreplaceable content in the system and the easiest to destroy by accident.
20. **C23 soul-core freshness** - the compiled identity card must exist and must match the `soul.md`
    it was built from. A stale card means every session loads a slightly wrong identity and nothing
    reports it.
21. **C24 status byte budget** - every status page stays inside its budget, so a dead rotator cannot
    hide behind a green report.

**RETIRED, numbers not reused:** C5, C16, C18 (machine timezone: logon triggers removed the wall
clock, so the check lost its subject to a design change), C19 (a reference document kept outside
this repo, which does not exist here).

**Not this sweep's job:** semantic drift, stale prose, duplicated topics. That is `/lint`, which is a
judgment pass, not a deterministic one.

## Security Sweep
A monthly, zero-token, detect-never-repair security conscience beside the integrity sweep. Its own
script so the main sweep's "no network" property stays true. Assertions: a secret scan over full
history, a check that no gitignored path is tracked, credential ageing, the skills tamper baseline,
repo visibility against the declaration, and a personal-data scan over the tracked tree.

**S8 is the one to care about.** It asks GitHub directly whether this repo is private and compares
that against `meta.repo_visibility`. `.gitignore` is the only barrier between the vault and the
internet, so a repo flipped public must be noticed the same month, not the same year. An
unauthenticated 404 from GitHub is treated as CONFIRMATION of a private repo rather than an error,
because that is exactly what a private repo does.

## Backups
Two, covering different things, both documented in the constitution under Backup & Recovery.
- `scripts/git-backup.ps1` - the system, to a private GitHub repo.
- `scripts/vault-backup.ps1` - the vault, gpg AES256 encrypted with the owner's own passphrase, to
  the owner's own Google Drive with rclone, last 14 kept. It decrypts the blob again before shipping
  it and reads the remote size back afterwards, because "the command exited 0" is not evidence.
  **rclone missing is a hard failure, not a skip.** With one destination, a silently skipped leg
  means no backup at all under a green log, which is the worst possible outcome.

## Vault Structure
- **Tier 1:** `vault/projects/recovery/status.md`.
- **Tier 2:** `vault/projects/recovery/last-sweep.md`, `last-security-sweep.md`.
- Local state (gitignored): `work/18-recovery-layer/state/` holds the baseline hashes, the log
  high-water mark, the passphrase attestation date and the verified-destination stamps.

## Connections
- **Fed by:** `system/manifest.json` (the desired state), the repo itself, Task Scheduler, git.
- **Feeds into:** `/status` and `/morning-brief` (the findings), `system/run-status.json`, and the
  fact ledger that C21 tests documents against.

## Close-Out Extras
- The sweep report written, even when clean. A clean run that wrote nothing is indistinguishable
  from a run that never happened.
- Any drift found is either fixed or explicitly carried over. Drift acknowledged and forgotten is
  how a checker becomes decoration.
- After propagation work, re-run `check.ps1 -Init` so the baseline moves with it.
