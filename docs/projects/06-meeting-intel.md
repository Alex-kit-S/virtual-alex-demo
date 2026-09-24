# 06 - Meeting Intel

## What it actually does
Two halves. **Before** a meeting: give it a calendar event and it builds a one-page dossier on who is
in the room and what matters to them. **After**, and this is the half people actually use every week:
drop any file into `work/06-meeting-intel/inbox/` (text, PDF, subtitles, a photo of a whiteboard, an
audio recording) and it turns that into a transcript, pulls out the decisions, the action items and
who owns each one, and writes a structured note into the vault.

## Why it exists
"Drop a document in, get back what it says and what it commits you to" is the most common thing a
document-heavy week actually needs. Research answers questions; this one takes in artifacts, which is
a different verb.

## Audio needs one setup step
Transcription needs Whisper and ffmpeg. `Install-Alex.cmd` installs both as a named step. If they are
missing it will tell you so in one sentence and process everything else, rather than quietly
installing multi-gigabyte software on your machine because you dropped in a voice memo.

## Works together with
- **`vault/people/`** - who the attendees are. Read before, updated after.
- **[Email Triage](07-email-triage.md)** - shares the never-send Draft Gate for follow-ups.
- **Google Calendar** - resolves the meeting and its attendees.
