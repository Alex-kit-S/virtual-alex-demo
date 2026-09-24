# /new - Create a New Automation

This is the master command for creating any automation in the Personal Ops System. Every automation, including the core 10, is created through this flow.

## Step 1: Understand

If the user pasted a detailed prompt, read it and extract: what the automation does, what tools it needs, what it reads/writes, whether it's scheduled.

If the user just described something briefly, ask clarifying questions: "What should it do? What data does it need? Should it run on a schedule or on-demand?"

## Step 2: Register FIRST, then scaffold (registry-first, audit step 3, 2026-07-06)

0. **Write the registry entry BEFORE creating anything.** Add the project to `system/manifest.json` `projects[]` (num, name, title, state, trigger, one_liner, docs, schedule_jobs, work_dir, commands, status_md, `cadence: {expected_hours, label, note?}`, `first_fire: null`, `first_fire_kind: null`, n8n), then run `node scripts/generate-alex.js` - that generates the routing-table row (root CLAUDE.md), the docs/projects/README.md row, and every other generated doc automatically. Do NOT hand-edit those tables. After the build, re-run `work/18-recovery-layer/check.ps1 -Init` to re-baseline.
   - **Cadence (upgrade P4, 2026-07-12):** `expected_hours` = the staleness window HQ ages against (26 daily/weekdays, 192 weekly, 800 monthly, `null` for on-demand/event - null means never stale by age); `label` drives the HQ render rules; `note` is the optional human phrase ("closes month-end").
   - **First fire:** a new scaffold ALWAYS starts `first_fire: null, first_fire_kind: null`. The first REAL run stamps the date (`first_fire_kind: "live"`, or `"drill"` for a documented drill). A LIVE/EVENT project may sit unfired at most 14 days from its status.md `created:` date - past that V9 warns and check.ps1 C13 goes amber (manifest states_doc rule).

1. Find the next available number in work/ (if nothing exists, start with 01)

2. Create the work folder:
```
work/{number}-{name}/
├── CLAUDE.md
├── raw/          (if the automation needs raw input files)
└── config/       (if it needs configuration files)
```

3. Write work/{number}-{name}/CLAUDE.md with ALL sections. **First read [[research/exemplars/gold-automation-spec]]** (`vault/research/exemplars/gold-automation-spec.md`) for the gold-standard spec shape - contract-first, IDs inline, honest limitations, named Close-Out Extras - and match it (lean, not long):
   - Type (automation)
   - Purpose (what it does, one paragraph)
   - Entry Points (scheduled, on-demand, event-driven)
   - Tools Used (Gmail MCP, Calendar MCP, Notion MCP, Chrome, Python, the `pptx` skill, the `xlsx` skill, sub-agents, etc.)
   - Notion Integration (what database to create under the Personal Ops System parent page, what views, what columns. Read parent page ID from vault/projects/notion-parent-id.md)
   - Vault Structure:
     - Tier 1: vault/projects/{name}/status.md (summary, Notion database ID, last run)
     - Tier 2: vault/projects/{name}/{subfolders}/ (dense data: history, archives, data)
   - Vault Reads (soul.md, vault/people/, vault/business/, other project data it depends on)
   - Vault Writes (what it updates in vault after each run)
   - Connections (what other automations feed into this one, what this one feeds into)
   - Post-Run (mandatory):
     1. Create vault/people/ for new contacts found
     2. Create vault/business/ for new companies found
     3. Add [[wiki links]] between pages
     4. Update Notion database entries
     5. Update vault/index.md
     6. Update vault/log.md
     7. If sprint board exists, mark this automation as Done (on first build only)

4. Create vault/projects/{name}/status.md with initial status

5. Create .claude/commands/{name}.md with:
   - Reference to work/{number}-{name}/CLAUDE.md
   - Key steps the command executes
   - What Notion databases to read/update (reference vault/projects/{name}/status.md for IDs)
   - Post-run reminders

6. Update the routing table in CLAUDE.md with the new entry (include "Feeds Into" column)

7. Update vault/index.md with the new project

8. Update vault/log.md

## Step 3: Create Notion Database

Follow the EXACT sequence from CLAUDE.md Notion Protocol:
1. Read vault/projects/notion-parent-id.md for the parent page ID
2. Create the database with notion-create-database
3. Move it under the parent page with notion-move-pages (creation alone doesn't place it correctly)
4. Add select options with notion-update-data-source ALTER COLUMN (they get dropped during creation)
5. Create views
6. Store BOTH the database ID and collection/data_source ID in vault/projects/{name}/status.md

CRITICAL: When creating rows in the database, ALWAYS include `content` with the full readable details. Not just properties. The user opens Notion to READ the page content.

## Step 4: Build

Build the automation. Test it. The prompt usually describes what to do. Follow it.

For outputs, use the installed skills. ALWAYS use the skill, not raw Python:

**When the output is a presentation / deck / slides → Claude Design (standing rule, 2026-06-15):**
- Build it with the **Claude Design (DesignSync)** tool as a design-system deck on claude.ai/design, NOT the the `pptx` skill skill (no native .pptx; deliverable = web deck + PDF).
- `ToolSearch("select:DesignSync")` → reuse or create_project (ask first) → slides as components one at a time (finalize_plan → write_files) → export PDF.
- Read brand/config/brand-config.md for colors, fonts, logo; brand the components.
- Export PDF to outputs/{automation}/YYYY-MM-DD/. See CLAUDE.md Brand Protocol for the full rule.

**When the output is an Excel spreadsheet:**
- Invoke the `xlsx` skill skill
- Read brand/config/brand-config.md for header colors, fonts
- ALWAYS use real Excel formulas (=SUM, =SUMIFS, etc), never hardcoded values
- Save to outputs/{automation}/YYYY-MM-DD/ (Output Hygiene; ledger row per Close-Out A6)

**When the output is a PDF:**
- Use Python (reportlab or weasyprint) with brand colors and fonts from brand-config.md
- Save to outputs/{automation}/YYYY-MM-DD/ (ledger row per Close-Out A6)

**When the output is images (quote cards, charts):**
- Use Python/Pillow with brand colors from brand-config.md
- Save to outputs/{automation}/YYYY-MM-DD/ (one-offs: outputs/sessions/YYYY-MM-DD-{topic}/)

**When the user asks for a report/deck/presentation/spreadsheet:**
- Default to a **Claude Design deck** (web + PDF) for presentations and summaries - NOT .pptx (standing rule 2026-06-15)
- Default to Excel for data and financial reports
- Default to PDF for single-page briefs
- .pptx only if the owner explicitly asks for an editable PowerPoint

**File management rules:**
- All deliverables go to outputs/{automation-name}/YYYY-MM-DD/ (e.g., outputs/research-team/2026-04-08/report.pptx)
- Each run gets its own dated subfolder so outputs accumulate and don't overwrite
- After generating a file (PPT, Excel, PDF, images), clean up ALL temporary artifacts:
  - Delete build scripts: build_deck.py, generate_report.py, create_*.py, etc.
  - Delete unpacked/extracted directories: *-unpacked/, *_extracted/, any folder containing raw XML from pptxthe `xlsx` skill internals ([Content_Types].xml, docProps/, ppt/, _rels/)
  - Delete temp files: *.tmp, *.bak
  - ONLY the final .pptx, .xlsx, .pdf, .png files should remain in the output folder
  - If in doubt whether something is temp: if it's not a final deliverable file, delete it
- Add a reference in vault/projects/{name}/status.md pointing to the output path so it can be found later
- Add a [[wiki link]] in relevant vault pages so Obsidian can reference the output

Write knowledge to vault/. Write deliverables to outputs/{automation-name}/YYYY-MM-DD/.

## Step 5: Finalize

- Update work/{number}-{name}/CLAUDE.md with what was actually built (implementation details)
- Confirm the command works: "/{name} is now available."
- If scheduled, add to scheduler/schedule.md
- **No board row.** There is no project tracker in this system, deliberately: a board of tasks nobody assigned only ever grows. The registry entry IS the record that the project exists, and the status command reads it.

## Cross-Automation Connections

Automations can use each other's data. When building, check:
- vault/projects/{other-name}/status.md for Notion database IDs of other automations
- vault/people/ for contacts (fed by CRM, morning brief, email triage)
- vault/business/competitors/ for competitor data (fed by market pulse)
- vault/research/ for research outputs (fed by research team)
- vault/meetings/ for meeting notes (fed by meeting intel)
- vault/projects/ for project statuses (fed by sprint tracker)

If an automation needs data from another that hasn't been built yet, note the dependency in the CLAUDE.md and handle gracefully (skip that data source, don't error).
