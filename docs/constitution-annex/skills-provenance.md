# Constitution annex: skills - where they came from and what was checked

The MANDATORY routing table lives in `CLAUDE.md`. This page is the provenance record: what is
installed, where it came from, what was read before it was trusted, and what was deliberately left
out. It exists so that "these skills are safe" is a claim somebody can check rather than a claim
somebody made.

**114 third-party skills are installed**, at `.agents/skills/` (the real content, tracked in the
repo) with junctions in `.claude/skills/` (the discovery layer, gitignored because links do not
survive a clone). Which of them are awake and which are parked depends on the machine's install
profile; `node scripts/skills-park.js --list` prints the split. `skills-lock.json` records a sha256 of every
installed `SKILL.md`, so a skill that changes underneath you is detectable rather than assumed.

## The two sources

**84 came with the system.** A curated set assembled over months: career and CV tooling, a large
marketing pack, Obsidian tooling, diagram generators, document handling, debugging guidance. Each
was installed as DATA rather than as executable code: the markdown was fetched and read, never
`npx`-installed, so nothing third-party ever ran during installation.

**17 were vendored at build time** from the builder's own global skills directory. These are the
ones a rule in `CLAUDE.md` actually points at, and vendoring them was not optional: a constitution
that orders an agent to use `frontend-design` while `frontend-design` lives outside the repo ships a
rule that cannot be obeyed. They carry `sourceType: "vendored-global"` in the lockfile, which means
there is no upstream commit to pin and the recorded hash is the entire tamper baseline for those
rows.

The 17: `babysit`, `banner-design`, `brand`, `context7-mcp`, `design`, `design-is`, `design-system`,
`do`, `frontend-design`, `learn-codebase`, `make-plan`, `oh-my-issues`, `openai-agents-sdk`,
`pathfinder`, `pptx`, `resume-builder`, `slides`.

## Added after the build

**`no-ai-slop` (2026-08-21, +1, count 101 -> 102).** From `petergyang/no-ai-slop`, MIT, pinned at
`sourceCommit` d30eddb9e04562234f2070b5ee63ca4649d9a05e. A 20+ pattern AI-slop checklist with a
companion `eval.md` of 30 self-checks. Installed as DATA on the same posture as everything else:
both files are plain markdown, read in full and passed a banned-pattern gate (zero scripts, zero
install hooks, zero process spawning, zero remote-fetch URLs, zero exfil). The repo's own
`scripts/build_plugin.py` and `.codex-plugin/` were not taken; they are repo tooling, not part of
the skill.

**It carries a locally-added scope guard and a rewritten frontmatter description, so its
`computedHash` differs from upstream on purpose.** Four things in the upstream file are overridden,
and the reason is the same in each case: it is a general-purpose editing checklist and this system
already has a constitution for voice.

1. **Em dashes.** Upstream permits "1 to 2 in longer drafts". `CLAUDE.md` says zero, and
   `brand/config/writing-style.md` rule 5 says zero. There is no draft length at which one becomes
   acceptable here.
2. **A locked format outranks it.** If the owner has locked a recurring shape that deliberately
   uses something upstream calls slop (a binary contrast, one-line-per-thought spacing, a closing
   signature line), the format wins inside that format.
3. **Voice comes from the corpus.** Upstream infers voice from the single draft in front of it.
   The Brand + Soul Pre-Flight Gate requires reading `soul.md` My Words first.
4. **The owner's imperfections are the signal.** Upstream never mentions this, and a generic sharp
   editor corrects dropped articles and unusual word order. The standing rule is the opposite. The
   one legitimate exception is already written down: `brand/config/writing-style.md` governs
   analytical third-person prose and deliberately does not carry the register half across.

Its eleven structural patterns also live in `brand/config/writing-style.md` sections 1.9 to 1.17
and in `soul.md` detection-proofing, because a skill only fires when somebody is in a conversation
and a house-style rule applies to every piece of prose the system writes.

## What was audited, and what it found

Every script file across the vendored set was read in full: 41 of them, `.py` and `.cjs`, across
five skills. Not sampled. The first pass of that audit only found 18 of the 41, for two structural
reasons worth writing down because both will recur:

1. **`find -type f` does not follow symlinks**, and two of the skills WERE symlinks into a different
   directory tree. Everything behind them was silently excluded from the count. `pptx` alone hid 16
   Python files. This is why they were copied with `cp -rL` rather than `cp -r`: a copied dangling
   link would have hashed to nothing and reported clean forever.
2. **The audit only modelled script-level installers.** But a `SKILL.md` is itself a payload: an
   agent reading it will do what it says, and no script file has to exist for that to be dangerous.
   That second class turned out to be the LARGER one.

Findings, all documented rather than patched:
- **No exfiltration anywhere.** No package manifest, no lockfile, no install lifecycle hook.
- `brand/scripts/sync-brand-to-tokens.cjs` builds a shell string with unquoted interpolated paths.
  Local only, not an installer, but a path containing a space will break it.
- `design/*/generate.py` reads a `.env` from the user's global Claude config directory, outside this
  repo, to find an API key. Not exfiltration, but it should be known rather than discovered.
- `design-system/scripts/fetch-background.py` fetches public stock images from an external host.
- `design-system/scripts/slide-token-validator.py` spawns a sibling script with the same Python. No
  network, benign.

## What was deliberately NOT installed, and why

Twelve candidates were rejected. Five for installing or exfiltrating:

- **`ui-styling`** - its script shells `npx shadcn@latest add`, which fetches and executes remote
  code at run time. That is an installer on its face.
- **`find-skills`** - its documented job is `npx skills add <package>`, installing arbitrary
  packages. A skill whose function is unaudited installation has no place in a system with no audit
  lane behind it.
- **`wowerpoint`** - self-installs a tool AND posts deck content to a third-party API. The only
  outbound data path in the whole set.
- **`graphify`** - installs a package from a public index on use.
- **`version-bump`** - a package publishing workflow, irrelevant here.

And seven for depending on infrastructure this system does not have: `ui-ux-pro-max` (its data and
script directories are dangling links to a directory that does not exist, so every documented
command in it fails), plus six skills that drive a memory service which is not installed here.

**The distinction that decided each case:** a skill that says "install X first, here is the command"
and then EXITS with that message if X is absent is fine, and several of the installed ones do
exactly that. A skill that installs X for you, silently, as a side effect of being used, is not.

## Operating rules

- **Never run a bulk skill update.** It overwrites curated descriptions, and the descriptions are
  the discovery layer that decides which skill fires.
- **On restore, rebuild the junctions**: `powershell -File scripts/bootstrap.ps1 -RepairJunctions`.
  Do it BEFORE running the validators, or V17 fails on links that do not exist yet. On Windows, Git
  Bash's `ln -s` silently COPIES instead of linking, so use `cmd /c mklink /J` if doing it by hand.
- **Every skill named in a MANDATORY row must be both vendored and awake**, or V17 fails the build.
  A rule ordering the use of a skill that is not installed looks like a capability and behaves like
  a dead end.
