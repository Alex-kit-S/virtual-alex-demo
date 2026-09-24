# Meeting Intel

## Type
Automation (on-demand, two modes)

## Purpose
Turns meetings and documents into leverage on both ends. **Pre-meeting:** given a calendar event or "prep me for my 2pm", it resolves the attendees from the calendar event, pulls what the vault already knows about each of them from vault/people/, searches Notion for relevant docs, does light web research on the attendees, and produces a one-page prep dossier. **Post-meeting, and this is the half that carries the project:** the owner drops any file into work/06-meeting-intel/inbox/ (text, markdown, PDF, VTT, audio, or image) or pastes text; it normalizes that into a transcript (transcribing audio with Whisper), extracts decisions / action items / follow-ups, writes structured meeting notes to Notion + vault, files the action items into the vault note and the waiting-on-you queue, updates vault/people/ for every attendee, and stages a follow-up email draft in the owner's voice behind the constitution's Draft Gate.

## Entry Points
- On-demand only. Not scheduled.
- `/meeting-intel prep "<event or 2pm>"` - pre-meeting dossier.
- `/meeting-intel process [file]` - post-meeting. With no arg, processes everything in inbox/.
- Natural language: "prep me for my 2pm", "process my meeting notes".

## Tools Used
- Google Calendar MCP: list_events / get_event (resolve the meeting + attendees).
- Notion MCP: notion-search (relevant docs), notion-create-pages (Meeting Notes row), notion-update-page (status). Notion is OPTIONAL: if it is not connected, write the note to the vault only and say so in the run output. Never block a run on Notion.
- Gmail MCP: gmail_create_draft (follow-up draft). NEVER Chrome for Gmail.
- Chrome: web research on attendees ONLY (background, public info). Never for Gmail/Calendar/Notion.
- Whisper (openai-whisper, base model): transcribe audio. Installed by `Install-Alex.cmd` as an explicit, named step, not silently on first use (see Audio below).
- Python: parse VTT/transcripts, light text cleanup. Read tool: PDFs and images (Read renders both).
- Sub-agents (optional): attendee web research in parallel for multi-person meetings.

## Audio Transcription (Whisper)

**Audio is the one input format with a real install behind it, and the install is NOT silent.** `Install-Alex.cmd` installs `ffmpeg` and `openai-whisper` as a named step, and the guide says so in plain words. This project never runs `pip install` on a user's machine as a side effect of them dropping a file in.

On any audio file (.mp3 / .m4a / .wav):
1. Check it is there: `python -c "import whisper"` and `ffmpeg -version`.
2. **If either is missing, STOP and say so in one plain sentence**: "Audio transcription is not set up on this machine yet. Everything else in this run worked. Run Install-Alex.cmd again, or tell me and I will walk you through it." Then process every non-audio file normally and report the audio file as skipped. Never install anything mid-run.
3. Transcribe: `whisper <file> --model base --output_format txt --output_dir <tmp>`, then process the .txt.

Timebox long files; if a transcription stalls, report it rather than hanging.

## Input Format Handling
| Format | How it's read |
|--------|---------------|
| .txt .md | Read directly |
| .vtt | Strip WebVTT timestamps/cues with Python, keep speaker text |
| .pdf | Read tool (pages param) |
| .jpg .png | Read tool (vision - whiteboard photos, screenshots) |
| .mp3 .m4a .wav | Whisper → .txt |
| pasted text | Process directly, no file |

## Notion Integration
**Meeting Notes** database under the Personal Ops System parent page (ID in vault/projects/notion-parent-id.md).
Columns:
- **Title** (title)
- **Date** (date)
- **Attendees** (text)
- **Action Items** (number - count of items extracted)
- **Status** (select: Prep, Complete, Follow-up Sent)

Views:
- **Recent** (table, sort by Date desc)
- **Pending Follow-ups** (table, filter Status != "Follow-up Sent")

Each row's page **content** holds the full structured notes: Summary, Decisions, Action Items (with owners), Follow-ups, raw transcript link. Properties are for scanning; the body is for reading.

**No cross-database writes.** Action items land in the vault meeting note and, where they are something only the owner can do, in the waiting-on-you queue (`node scripts/human-actions.js add ...`). There is no sprint board and no CRM database in this system, so nothing is pushed to either.

## Vault Structure
- **Tier 1:** vault/projects/meeting-intel/status.md - DB IDs, last run, recent meetings, dossiers/notes index.
- **Tier 2:** vault/meetings/YYYY-MM-DD-<slug>.md - one structured note per meeting (THIS is the knowledge). Pre-meeting dossiers: vault/meetings/dossiers/YYYY-MM-DD-<slug>.md.

## Vault Reads
- soul.md (follow-up email voice).
- vault/people/ (attendee context - the source of truth for who a person is).
- vault/business/ (company context for attendees).
- vault/projects/*/status.md (project context for action-item routing).

## Vault Writes
- vault/meetings/ structured note (+ dossier for prep mode).
- vault/people/ pages for every attendee (new or updated).
- vault/business/ for new companies.
- status.md refresh, vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Google Calendar (events + attendees), vault/people/ (who these people are), and any file dropped into inbox/.
- **Feeds into:** vault/meetings/ (the structured note, which is the knowledge), vault/people/ (attendee context, updated every run), the waiting-on-you queue (`system/human-actions.jsonl`) for action items only the owner can do, and a gated follow-up draft.

## Post-Run (mandatory)
1. vault/people/ pages for new attendees.
2. vault/business/ pages for new companies.
3. [[wiki links]] across meeting note, people and projects.
4. Notion: Meeting Notes row created (skipped with a stated reason if Notion is not connected).
5. vault/index.md updated.
6. vault/log.md updated.
7. Move processed inbox files to work/06-meeting-intel/processed/.

## Draft Gate (owned by the constitution, see "The Draft Gate" in root CLAUDE.md)
Follow-up drafts obey the constitution's Draft Gate: real email on file, recipient not personal/family, not a do-not-contact/sensitive contact, draft only (never auto-send). A meeting with an off-limits attendee still gets notes + action items; it just doesn't get an auto-drafted email. The rule is stated in full in the root `CLAUDE.md`; this project applies it, it does not define it.

## Implementation Notes (as built, 2026-06-11)
- Scaffolded with inbox/ + processed/. Meeting Notes DB created under Personal Ops System parent; IDs in status.md.
- Whisper is NOT installed at build (no audio yet). First audio file triggers the install + base-model download + the user message above. ffmpeg dependency checked at that point.
- No live meeting processed at build (on-demand; first real file/dossier starts the history). vault/meetings/ created empty with a .gitkeep.
- Outbound follow-up drafts run behind the constitution's Draft Gate (root CLAUDE.md). The gate is owned there, not here, and not by any sibling project.

## Trifecta
Gate: **read-only**. Legs: private_data=true, untrusted_content=true, external_comm=false (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). Private vault + calendar context, plus untrusted dropped files and web research; notes and action items stay internal and outbound mail never leaves as more than a draft. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.
