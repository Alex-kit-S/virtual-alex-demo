# /meeting-intel - Pre-Meeting Dossiers + Post-Meeting Processing

Spec: work/06-meeting-intel/CLAUDE.md (read it first). On-demand, two modes.

## Mode: prep
`/meeting-intel prep "<event or 2pm>"`
1. Resolve the meeting via Calendar MCP (list_events/get_event). Pull attendees.
2. For each attendee: `vault/people/` for who they are and what is between you. Light web research (Chrome, public info only, background reading and never outreach).
3. notion-search for relevant Notion docs (past meetings, projects, threads).
4. Write a one-page dossier → vault/meetings/dossiers/YYYY-MM-DD-<slug>.md and a Meeting Notes row (Status: Prep). Lead with "who they are + what matters + your angle", Alex voice.

## Mode: process
`/meeting-intel process [file]` (no arg = process all of work/06-meeting-intel/inbox/)
1. Normalize input → transcript:
   - .txt/.md: read · .vtt: strip timestamps (Python) · .pdf/.jpg/.png: Read tool · pasted text: use directly
   - audio (.mp3/.m4a/.wav): Whisper. First time, install (`pip install openai-whisper`, base model), check ffmpeg, and tell the user verbatim: "Installed Whisper for voice transcription. Using the base model. If you need better accuracy for longer meetings, you can upgrade to small later."
2. Extract: Summary · Decisions · Action Items (with owner) · Follow-ups.
3. Write vault/meetings/YYYY-MM-DD-<slug>.md (structured, [[wiki links]] to attendees/projects).
4. Notion Meeting Notes row (Status: Complete; Action Items = count; full notes in page content).
5. Push each action item owned by the owner onto the sprint board (Progress Tracker) as a task.
6. Update CRM rows for attendees: Last Contact = meeting date, set Follow-Up Date, append Notes.
7. Draft a follow-up email in soul.md voice via gmail_create_draft - ONLY if the recipient passes the CRM draft gate (real email, not personal/family, not a do-not-contact/sensitive contact). Never send. If gated, note "needs your call".
8. Move processed files to work/06-meeting-intel/processed/.

## Notion / IDs
- Meeting Notes DB: id in vault/projects/meeting-intel/status.md. Always write full notes to page content.
- Sprint board + CRM data_source IDs in their status.md files.

## Post-Run
- New attendees → vault/people/, new companies → vault/business/, with [[wiki links]].
- Update meeting-intel/status.md (last run, recent meetings) + vault/index.md (new pages) + vault/log.md.
- Do NOT re-mark the sprint row (Done at build).
