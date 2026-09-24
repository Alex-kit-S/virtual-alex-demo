<!-- BLOCK:PAGE -->
{{CUSTOM_ZONE}}

<!-- GENERATED below this line - do not hand-edit. Source: templates/readme.template.md + system/manifest.json. Regenerate: node scripts/generate-alex.js. Generated {{GENERATED_STAMP}}. The welcome block above (between CUSTOM_START/CUSTOM_END) is the ONE hand-written zone and is preserved verbatim on every regeneration. -->

{{QUICK_START}}

<!-- BLOCK:QUICK_START -->
## Quick start

- **Set it up / run it:** [GETTING-STARTED.md](GETTING-STARTED.md) - prereqs, first boot, the automations, scheduling.
- **Understand it:** [ARCHITECTURE.md](ARCHITECTURE.md) - the full constitution with a human preamble.
- **The projects, in plain language:** [projects/README.md](projects/README.md) - one page per automation.
- **The live n8n workflows:** [n8n/](n8n/) - node-by-node explanations of what runs on the server.

Right now the registry holds **{{AUTOMATION_COUNT}} non-retired automations** ({{LIVE_COUNT}} LIVE). The source of truth is `system/manifest.json`; every table and count in these docs is generated from it by `scripts/generate-alex.js`, then validated. Edit sources, not views.

## License

[MIT](../LICENSE) (since 2026-08-06). The vendored third-party agent skills in `.agents/skills/` keep their own authors' licenses - see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md); per-skill provenance is machine-recorded in `skills-lock.json`.
