---
name: publish
description: "Publish the owner's website: build the static site, run the smoke gate, commit, push, and report the live URL in the owner's language. Use when the user says publish, deploy, yayinla, put it online, or update the website. House-built 2026-08-31; no marketplace equivalent existed (verified: cloudflare/skills has no Pages skill)."
---

# Publish (yayinla)

Take the website project in this repo from edited files to live on the internet, prove it, and
report back in the owner's language. The deploy transport is a git push: Cloudflare Pages watches
the site's repo and rebuilds on every push to its production branch. **This skill never touches
Cloudflare directly and needs no token, no API and no secret - that is the design, not a gap.**

## Configuration (read first, never assume)

Read `work/*-website/publish-config.json` (the site project owns it):

```json
{
  "siteDir": "work/NN-website/site",
  "buildCommand": null,
  "outputDir": "work/NN-website/site",
  "branch": "main",
  "liveUrl": "https://<project>.pages.dev",
  "locale": "tr"
}
```

- `buildCommand: null` means the site is plain static files, nothing to build.
- If the config file is missing, STOP and say so: publishing without knowing what or where is
  how the wrong thing goes live. Offer to create the config with the owner.
- The owner's `locale` (also in `system/install-profile.json`) sets the language of every
  human-facing line this skill produces.

## The gate, in order - no step may be skipped

1. **Build** (only if `buildCommand` is set): run it; a non-zero exit stops everything.
2. **Smoke gate, before anything ships.** Use the `webapp-testing` skill against the built
   output: every internal link resolves, every referenced image exists, no empty `<title>`, and
   the pages parse as HTML. A site with a broken link or a missing product photo does NOT ship -
   report exactly what failed and where, in the owner's language, and stop.
3. **Diff review.** `git status` + a short summary of what is about to go live, shown to the
   owner in one or two sentences. New pages and deleted pages are named. If anything in the diff
   was not part of what the owner asked to publish, ask before pushing.
4. **Commit + push** to the configured branch, with a message that says what changed on the
   site (never "update").
5. **Verify it went live.** Wait for the Pages build (typically under two minutes), then fetch
   `liveUrl` and confirm (a) HTTP 200 and (b) some content from this push is present. "The push
   succeeded" is not "the site is live" - Cloudflare builds can fail after a green push.
6. **Report**: the live URL, what changed, and the check that proved it - in the owner's
   language. For a Turkish owner: "Site yayinda: <url>. Degisen: ... Kontrol edildi: ..."

## Hard rules

- Quotes with prices, stock claims, or anything legally sensitive (see the `try-workbook`
  skill's fatura rule) never go live without the owner having seen the exact wording.
- Never force-push. Never push a branch other than the configured one.
- A failed smoke gate is a full stop, not a warning. The report names the failing file and line.
- If `liveUrl` still serves the OLD content after ~5 minutes, say plainly that the push landed
  but the rebuild has not shown up, and point the owner at the Cloudflare Pages dashboard's
  build log - do not retry-push in a loop.
