# Third-party notices

The MIT license in [LICENSE](LICENSE) covers the code and documentation written for this
repository by its owner.

It does NOT cover the vendored third-party agent skills in `.agents/skills/` (mirrored as
junction links in `.claude/skills/`). Those are other authors' works, installed as data, and
each remains under its own author's license terms.

**Provenance is machine-recorded, not remembered:** `skills-lock.json` at the repo root maps
every installed skill to its source repository (`source`), the file it was fetched from
(`skillPath`), a content hash of the installed copy (`computedHash`), and - for installs since
2026-08-05 - the exact upstream commit audited and verified at install time (`sourceCommit`).
Look a skill up there first; the upstream repository's license is authoritative for it.

Notes:

- The larger upstream sources include `coreyhaines31/marketingskills` (MIT),
  `anthropics/claude-code` plugin skills, `kepano/obsidian-skills`, `davila7` career skills,
  `breferrari/obsidian-mind`, `czlonkowski` n8n skills, `obra/superpowers`,
  `github/awesome-copilot`, `multica-ai/andrej-karpathy-skills` (MIT), and
  `Panniantong/Agent-Reach` (MIT).
- A few installed skills carry small, documented local modifications (rewritten frontmatter
  descriptions, added scope-guard blocks). Each such deviation is recorded where the skill is
  routed (the root `CLAUDE.md` Skill Bindings section) and reflected in the lock's hash notes;
  the modifications are offered under the same terms as the upstream skill's license.

## The 17 vendored skills (added 2026-08-17)

Seventeen skills were copied in from the builder's own global skills directory rather than fetched
from a named repository, so their lockfile rows carry `sourceType: "vendored-global"` and no upstream
commit to pin. They are:

`babysit`, `banner-design`, `brand`, `context7-mcp`, `design`, `design-is`, `design-system`, `do`,
`frontend-design`, `learn-codebase`, `make-plan`, `oh-my-issues`, `openai-agents-sdk`, `pathfinder`,
`pptx`, `resume-builder`, `slides`.

Every script inside them was read in full before they were included: 41 files across five of the
skills. Findings worth publishing rather than burying, because a reader deserves to know what these
do on their machine:

- **No exfiltration anywhere**, no package manifest, no lockfile, no install lifecycle hook.
- `design/*/generate.py` reads a `.env` from the user's GLOBAL Claude config directory (outside this
  repo) looking for an image-generation API key. It is used for nothing else, but it reaches outside
  the folder and that should be known rather than discovered.
- `design-system/scripts/fetch-background.py` downloads public stock images from an external host.
- `brand/scripts/sync-brand-to-tokens.cjs` builds a shell command with unquoted paths; local only,
  but it will break on a path containing a space.
- `pptx/scripts/office/soffice.py` spawns a local LibreOffice, which is a declared dependency of the
  skill and does not touch the network.

Twelve further candidates were deliberately NOT included: five that install software or send data to
third-party services as a side effect of being used, and seven that depend on a service this system
does not run. The reasoning for each is in `docs/constitution-annex/skills-provenance.md`.

If you are the author of a vendored skill and want it removed or attributed differently, say so and
it will be removed.

## The 9 hand-extracted skills (added 2026-08-31, macOS-port Phase 5)

Nine skills were HAND-EXTRACTED for the third install's lanes (website, marketing, finance):
individual files copied out of a fresh clone, audited per file for install-hooks, process
spawning, credential handling and network egress, and never installed through any script the
source repo ships. `skills-lock.json` carries the exact audited `sourceCommit` for each.

- `events`, `attribution`, `influencer-marketing` - `coreyhaines31/marketingskills` (MIT), the
  same upstream the shipped marketing pack comes from; these three completed the set.
- `google-business-profile` - `Namtanmk/Claude-Skills-Ultimate-Bundle` (author metadata
  `matthewhitcham`). SKILL.md only; the surrounding bundle was NOT taken. Declares
  `allowed-tools: Read Write Glob` - no shell, no network.
- `30x-seo-local` - `norahe0304-art/30x-seo` (MIT). SKILL.md only. The repo's installer,
  hooks, agents and its DataForSEO credential setup were REFUSED - the audit found its setup
  step writes base64 credentials to disk, which is exactly the class the extraction discipline
  exists to keep out. The extracted file references none of that machinery.
- `cash-flow-forecast`, `break-even-calc`, `invoice-aging`, `pricing-optimizer` -
  `openaccountant/skills` (MIT). Four jurisdiction-neutral methodology files. The repo's
  US-tax skills and its bank/payment importers were REFUSED (wrong jurisdiction is a
  confident-wrong-answer surface; importers imply credentials + network).
