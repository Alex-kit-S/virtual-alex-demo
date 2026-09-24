# /ingest - Process New Raw Sources Into the Wiki

Takes new files from `inbox/`, reads them, and weaves them into the vault. This is Karpathy's "ingest" operation - the LLM does all the bookkeeping (summarizing, cross-referencing, filing) so the wiki compounds over time.

## When this runs

- **Manually**, when the user drops files in `inbox/` and types `/ingest`.
- **Automatically inside `/setup`** during Step 4 (the first ingest happens during onboarding).
- **Suggested at session start** if the SessionStart hook detects unprocessed inbox files.
- It is NOT a hook itself. The agent never auto-runs `/ingest` without the user invoking it.

## Modes

- `/ingest` - Interactive (default). Process ONE file at a time. Discuss takeaways with the user, ask what to emphasize, show the wiki updates as they happen. This matches the Karpathy "LLM open on one side, Obsidian on the other" workflow.
- `/ingest --batch` - Process all unprocessed files in one pass with no discussion. Use when dumping many sources.
- `/ingest <path>` - Force-ingest a specific file (even if already in the manifest).

## Step 1: Read state

1. Read `vault/index.md`. This is the catalog. You read it FIRST so you know what pages already exist before deciding whether to update or create.
2. Read `vault/log.md`. Look at the last 20 entries to understand recent activity.
3. Read `inbox/_ingested.md` (the manifest). If it doesn't exist, create it with this header:
   ```
   # Inbox Ingest Manifest

   Append-only record of files ingested from inbox/. Format: file | sha256-short | date | pages_touched

   | File | Hash | Ingested | Pages Touched |
   |------|------|----------|---------------|
   ```

## Step 2: Find unprocessed files

List `inbox/`. Skip dotfiles (`.gitkeep`, `.DS_Store`) and `_ingested.md`. For each remaining file:

1. Compute sha256 short hash: `shasum -a 256 "{path}" | cut -c1-8`.
2. Check if `{filename}|{hash}` already appears in `_ingested.md`.
3. If yes → skip (already ingested at the same content).
4. If filename matches but hash differs → re-ingest (file was updated).
5. If neither matches → new file, ingest.

Build a list of files to process. If the list is empty, tell the user "Nothing new in inbox/" and exit.

## Step 3: Process each file (per-source loop)

For each unprocessed file, do this in order:

### A. Read the source

- `.pdf` → use the pdf skill.
- `.docx` → use the docx skill.
- `.pptx` → use the pptx skill (extract text from slides).
- `.xlsx` / `.csv` → use the xlsx skill or pandas.
- `.md`, `.txt`, `.html` → use Read directly.
- `.png`, `.jpg` → view with vision (extract text and visible content).
- `.mp3`, `.m4a`, `.wav` → check for whisper (`python -c "import whisper"`). If missing, install (`pip install openai-whisper`). Transcribe to a `.txt` next to the original, then ingest the `.txt`.

### B. Summarize and discuss (interactive mode only)

Tell the user, in soul.md voice:
- 2-3 sentence summary of what the source contains.
- Key entities mentioned (people, companies, products, projects).
- Key claims or data points.
- Anything that might contradict existing wiki content (do a quick scan of relevant existing pages).

Then ask: "Want me to file this with default emphasis, or should I focus on anything specific?" Wait for the user's reply. If they say "default" or just respond with affirmation, proceed.

In `--batch` mode, skip this step.

### C. Update the wiki

Touch every page that should know about this source. A single source typically touches 5-15 pages.

For every entity in the source:
- **Person mentioned** → create or update `vault/people/{name}.md`. Include role, company, relationship to user, what this source says about them. Add `[[wiki links]]` to their company and any projects mentioned.
- **Company / business mentioned** → create or update `vault/business/{company}.md`. Include what they do, signal from this source, link to people from that company.
- **Project mentioned** → create or update `vault/projects/{name}.md`. Update status, add new info, link related people and companies.
- **Topic / concept worth a dedicated page** → create or update `vault/research/{topic}.md` or `vault/me/{topic}.md` depending on whether it's about the user or external.

Every page MUST have:
- YAML frontmatter: `tags`, `date_created`, `date_updated`, `sources` (list of source filenames it draws from).
- At least one `[[wiki link]]` to another page (unless it's `index.md` or `log.md`).
- Real prose body, not stub.

### D. Flag contradictions

If new info contradicts existing wiki content (e.g., source says "Acme has 50 employees" but `vault/business/acme.md` says "20 employees"), do NOT silently overwrite. Add a "## Contradictions" section to the affected page:

```markdown
## Contradictions
- 2026-04-25: source `acme-pitch.pdf` says 50 employees; this page previously said 20 (from `linkedin-export.txt`, ingested 2026-03-12). Newer source wins, but flagged for user review.
```

Tell the user about contradictions in the discussion phase.

### E. Archive the source

Move the file from `inbox/` into `vault/sources/`:
- `.pdf`, `.docx`, `.pptx`, `.xlsx` → `vault/sources/documents/`
- `.md`, `.txt`, `.html` → `vault/sources/notes/`
- Articles / web clips → `vault/sources/articles/`
- Images → `vault/sources/notes/` (alongside any extracted text).
- Audio → keep the `.mp3` AND its transcribed `.txt` in `vault/sources/notes/`.

Use `mv`, not `cp`. After moving, the file is in the immutable archive - do NOT modify it again.

### F. Update the manifest

Append a row to `inbox/_ingested.md`:
```
| {filename} | {hash} | {YYYY-MM-DD} | {N pages touched} |
```

The filename in the manifest reflects where it ORIGINALLY lived in inbox, even though it's now in `vault/sources/`. This way, if the user re-drops the same file with the same content, we recognize it.

### G. Update index and log

- `vault/index.md`: append any new pages to the right category. Each entry: `- [[page-name]] - one-line summary`.
- `vault/log.md`: append `## [YYYY-MM-DD HH:MM] /ingest | {source filename} | {N pages touched}: {comma-list}`.

## Step 4: Report

After all files are processed, summarize to the user in soul.md voice:
- N files ingested.
- M wiki pages created, K updated.
- Any contradictions flagged.
- Suggested next steps (e.g., "you have 3 new people pages without writing samples - want me to research them via /research-team?").

## Special cases

- **Source is just a URL** (user pastes a link in chat instead of dropping a file). Fetch with WebFetch, save the text to `inbox/web-{date}-{slug}.md` first, then ingest.
- **Source is a chat paste** (long text directly in chat). Save to `inbox/chat-{date}.md` first, then ingest.
- **Source is huge (>50KB)** in interactive mode. Skim and summarize first, then ask the user which sections to deep-read before doing the full update.
- **Notion MCP unavailable**: ingest still works (it operates on local vault/). Notion sync is not part of /ingest's job - automations handle that.

## What /ingest does NOT do

- It does not modify `vault/sources/` after archiving (immutability rule).
- It does not run automations (`/morning-brief`, etc.). Pure wiki maintenance.
- It does not deduplicate the wiki - that's `/lint`'s job.
