# Security Playbook (P5, 2026-07-17)

Hand-written companion to `security-sweep.ps1`. When the monthly sweep turns a red (or you're setting it up), this is the procedure. The sweep DETECTS; a human ROTATES. Nothing here auto-repairs.

## Standing stance on a PUBLIC repo (read first)
The repo is public since 2026-07-16. `.gitignore` is the SOLE barrier between personal data and the whole internet. Two rules follow:
1. **On any leaked secret: ROTATE, do not (only) rewrite.** Forks, clones and GitHub's own caches remember a pushed secret even after a history rewrite. Rewriting history is damage-limitation, not a fix. The fix is a new credential.
2. **Every new gitignored file gets its `.gitignore` line + a `git check-ignore` proof BEFORE its first commit.** One forced `git add -f` of a secret is instantly and permanently public.

## Per-credential response (mirrors system/credentials-ledger.json)

| Credential | Where it lives | Rotate how | What breaks until you do |
|---|---|---|---|
| GitHub sign-in | Windows Credential Manager, put there by Git Credential Manager the first time you push | Run `git push` once by hand and complete the browser sign-in | The system backup to GitHub. Recovery check C15 notices within a week. |
| Google Drive access (rclone) | The rclone config file in your own profile, created once by `rclone config` | `rclone config reconnect alex-drive:` | The encrypted vault backup. This is the one that matters: it is the only off-machine copy. |
| Vault backup passphrase | A local file outside this folder, path recorded in `system/credentials-ledger.json` (gitignored), AND your password manager | Re-encrypt existing backups with the new passphrase, update BOTH places, then refresh `state/passphrase-attested.txt` so C14 sees it | The nightly encrypted backup. **If this machine dies and the passphrase is not in your password manager, every backup you have is permanently unreadable. Nobody can recover it for you, including whoever set this up.** |
| Claude sign-in | The Claude CLI's own config in your profile | Open Alex and sign in again | Every scheduled job. `auth-check` writes a RED row and you get a desktop notification. |

