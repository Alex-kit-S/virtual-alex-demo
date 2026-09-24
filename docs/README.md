<!-- CUSTOM_START -->
# Virtual Alex docs

This folder explains the system to a human. Your repository runs Alex, your personal AI agent: the
instructions, memory and commands Claude reads in every session, plus five Routines that work while
you sleep.

Three things to know before you read anything else:

1. **Your Alex runs online.** The page to follow is `INSTALL-ONLINE.md`, at the top of your
   repository. `GETTING-STARTED.md` and `ARCHITECTURE.md` in this folder describe the laptop
   version of Alex: most of the rules are the same, the install is not. For updates, read the
   section of `UPDATING.md` headed "If your Alex runs online".
2. **Sources are written by hand, views are generated.** Some pages here are built from a few
   hand-edited sources by `scripts/generate-alex.js`. If a page disagrees with its source, the page
   is stale: regenerate it, don't edit it.
3. **Your notes live in `vault/`, in a private repository.** Keep it private. The section of
   `INSTALL-ONLINE.md` headed "Who can read your notes" says who else can.

**To check that Alex is loaded,** start a session on your `alex` repository and type `/alex-status`.
Its `Identity:` line names you. In a cloud session `/status` is the web page's own command and never
reaches Alex.
<!-- CUSTOM_END -->

<!-- GENERATED below this line - do not hand-edit. Source: templates/readme.template.md + system/manifest.json. Regenerate: node scripts/generate-alex.js. Generated 2026-09-24. The welcome block above (between CUSTOM_START/CUSTOM_END) is the ONE hand-written zone and is preserved verbatim on every regeneration. -->

## Quick start

- **Set it up / run it:** [GETTING-STARTED.md](GETTING-STARTED.md) - prereqs, first boot, the automations, scheduling.
- **Understand it:** [ARCHITECTURE.md](ARCHITECTURE.md) - the full constitution with a human preamble.
- **The projects, in plain language:** [projects/README.md](projects/README.md) - one page per automation.
- **The live n8n workflows:** [n8n/](n8n/) - node-by-node explanations of what runs on the server.

Right now the registry holds **9 non-retired automations** (4 LIVE). The source of truth is `system/manifest.json`; every table and count in these docs is generated from it by `scripts/generate-alex.js`, then validated. Edit sources, not views.

## License

[MIT](../LICENSE) (since 2026-08-06). The vendored third-party agent skills in `.agents/skills/` keep their own authors' licenses - see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md); per-skill provenance is machine-recorded in `skills-lock.json`.
