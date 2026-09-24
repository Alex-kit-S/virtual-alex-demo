# /lint - Vault Health Check

Periodic quality scan of the wiki. Karpathy's "lint" operation: catches the small drift that accumulates as the wiki grows. Read-only by default - proposes fixes, applies only with user approval (or `--fix`).

## When this runs

- **Manually**, when the user types `/lint`.
- **Suggested weekly** by the status command, and triggered automatically inside `/self-review` (read-only mode, included in the report).
- It is NOT a hook. The agent never auto-fixes the vault without invocation.

## Modes

- `/lint` - Report-only. Lists every issue with a suggested fix. Asks the user "want me to fix these?".
- `/lint --fix` - Apply all auto-safe fixes. Still reports unsafe ones (contradictions, data gaps) for user review.
- `/lint --quick` - Run only checks 1, 4, 7 (orphans, broken links, index drift). Cheap. Suitable for daily use.
- `/lint --section {me,people,business,projects,research,meetings}` - Limit to one vault section.

## Step 1: Inventory the vault

1. List every markdown file under `vault/` (excluding `vault/sources/`).
2. Build an in-memory map: `{path → {frontmatter, body, outbound_links, inbound_links}}`.
3. Parse `[[wiki links]]` from each body. Build the inbound-link index.
4. Read `vault/index.md` and `vault/log.md`.
5. Read `inbox/_ingested.md` to know which sources have been processed.

## Step 2: Run checks

For each check, build a list of findings: `(severity, path, problem, suggested_fix, auto_safe)`.

### Check 1 - Orphan pages
A page is an orphan if it has zero inbound `[[wiki links]]` from any other page (and isn't `index.md` or `log.md`).

For each orphan, suggest: a candidate page that SHOULD link to it (look for keyword overlap with existing pages). Auto-safe: no, requires judgment.

### Check 2 - Stale pages
A page is stale if its `date_updated` frontmatter is more than 30 days old AND its content references a date or time-sensitive claim ("currently", "this quarter", "Q1 2026", etc.).

Suggest: re-ingest the source, or mark the section "## As of {date}" so it's clearly historical. Auto-safe: no.

### Check 3 - Contradictions
Scan every page for the explicit `## Contradictions` section that `/ingest` adds. Also scan for soft contradictions: pages that say different things about the same entity.

Pattern: same `[[entity]]` mentioned across multiple pages with different facts (different role, different company, different status).

Suggest: surface the contradiction to the user with the conflicting claims side by side. Auto-safe: no.

### Check 4 - Broken wiki links
A `[[wiki link]]` that points to a page that doesn't exist.

For each broken link, suggest:
- Create the missing page as a stub with `## TODO: ingest a source about this`.
- Or, if a similarly-named page exists (`vault/people/john.md` vs `[[John]]`), suggest the rename.

Auto-safe: yes, for the stub creation. Rename suggestions need user approval.

### Check 5 - Missing cross-references
Two pages mention the same entity (by name) but neither links to the other or to a shared entity page.

Example: `vault/meetings/2026-04-12.md` and `vault/meetings/2026-04-19.md` both mention "Acme Corp" but neither links to `vault/business/acme.md`.

Suggest: add the `[[acme]]` link to both meeting pages. Auto-safe: yes if the target page exists.

### Check 6 - Data gaps
A topic is mentioned across 3+ pages but has no dedicated page of its own.

Example: "RAG retrieval" gets mentioned in 5 research notes but `vault/research/rag-retrieval.md` doesn't exist.

Suggest: create a stub page or run `/research-team` on the topic. Auto-safe: stub yes, research no.

### Check 7 - Index drift
Pages that exist on disk but aren't listed in `vault/index.md`. Or entries in `vault/index.md` that point to pages that don't exist.

Auto-safe: yes, mechanical.

### Check 8 - Source coverage
Files in `vault/sources/` that don't appear in `inbox/_ingested.md`. Means a file was added directly without going through `/ingest`, so the wiki may not reflect it.

Suggest: run `/ingest <path>` on the unprocessed source. Auto-safe: no, requires judgment about emphasis.

### Check 9 - Empty pages
Pages with less than 50 chars of body beyond frontmatter and headings.

Suggest: delete, or flag for re-ingestion. Auto-safe: no (may be intentionally minimal).

### Check 10 - Frontmatter compliance
Pages missing required YAML frontmatter (`tags`, `date_created`, `date_updated`, `sources`).

Auto-safe: yes, fill in defaults from file mtime and infer tags from path.

### Check 11 - Command-layer semantic drift (added 2026-07-28, command-layer review)
Read every `.claude/commands/*.md` against its `system/manifest.json` entry and flag SEMANTIC
contradictions, the class no deterministic check can catch.

**Not state or trigger.** Those are generated into the `ALEX:CMD-HEADER` block and asserted by validator
V15, so they cannot drift. This check owns what a regex cannot judge:
- **A retired METHOD documented as the live one.** `/ingest` carried six steps of the retired
  Phase 1 screen-scrape with no mention of the proven Phase 2 path, so invoking it sent an agent down a
  route the registry calls a dead end, with nothing to fall back to (F-4).
- **Two competing sources of truth** feeding one generative command, where the wrong pick is invisible in
  the artifact because every downstream gate still passes (F-12 class).
- **A count or scope that has quietly narrowed** as the system grew: `/self-review` said it
  aggregates "all 9 automations" while the registry carries 32 (F-14).
- **Direction inverted:** a command naming X as primary and Y as fallback while the registry says the
  reverse. Check which one reality agrees with before assuming the command is the stale side; on
  `/meeting-intel` the command was right and the manifest was wrong (F-5).

Suggest: name both sides and which one ground truth supports. **Auto-safe: no** - every one of these is a
judgment call, and one of them was resolved in the opposite direction to the obvious guess.

## Step 3: Report

In soul.md voice. Group by severity:

```
Vault health: {good | needs attention | bad}
{N pages, {M} links, {K} sources}

CRITICAL ({N}):
- {path}: {problem} → {suggested_fix}

WARNINGS ({N}):
- ...

NITS ({N}):
- ...
```

End with: "Want me to apply the auto-safe fixes? ({N} can be applied automatically. {M} need your call.)"

## Step 4: Apply (if --fix or user approves)

For each auto-safe finding:
- Apply the fix.
- Append to `vault/log.md`: `## [YYYY-MM-DD HH:MM] /lint --fix | {check} | {path} | {action}`.

For non-auto-safe findings, walk the user through them one at a time. Apply only with explicit confirmation.

After applying:
- Update `vault/index.md` if pages were created or renamed.
- Append a `/lint` summary entry to `vault/log.md`: `## [YYYY-MM-DD HH:MM] /lint | {N fixed, M deferred}`.

## Step 5: Health score

Compute a simple score:
- `pages_total`
- `pages_with_inbound_links / pages_total` (link density)
- `pages_with_sources / pages_total` (source coverage)
- `1 - (broken_links / total_links)` (link integrity)
- `1 - (orphans / pages_total)` (connection rate)

Average → health 0-1. Map to a label: ≥0.85 healthy, ≥0.65 needs attention, <0.65 unhealthy.

Save the score and counts to `vault/projects/_lint-history/{YYYY-MM-DD}.md` so trend can be tracked across runs.

## What /lint does NOT do

- Never modifies `vault/sources/` (immutability rule).
- Never deletes pages without explicit user approval per page.
- Never invents content. If a page is sparse, it suggests sources to ingest, not made-up text.
- Does not run other automations.
