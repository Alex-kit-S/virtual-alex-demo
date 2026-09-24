#!/usr/bin/env node
/*
 * capture-typed-input.js - auto-capture every typed user message to a local raw transcript,
 * so the soul.md "My Words" harvest never depends on Alex remembering to do it mid-session.
 *
 * This is the TYPED-channel twin of the voice loop's save_transcript() in
 * work/voice/alex_voice.py. The voice side was already guaranteed code; the typed side was only
 * a standing rule (could be skipped under load). This closes that gap (wired 2026-07-07).
 *
 * Wired as a UserPromptSubmit hook in .claude/settings.json. It runs on every prompt submit.
 *
 * HARD RULES (a log write must never harm the owner's message):
 *   - Never write to stdout. UserPromptSubmit stdout is injected into the model context; anything
 *     printed here would silently pollute the conversation. Only ever touch the transcript file.
 *   - Never throw, never exit non-zero. Exit code 2 would BLOCK/erase the owner's prompt. Always exit 0.
 *   - outputs/ is gitignored, so these transcripts are local-only (same privacy tier as voice).
 *
 * Kept verbatim: no cleanup. The imperfections (ESL-direct phrasing, run-ons, dropped -s) ARE the
 * signal the corpus wants, per soul.md's voice-transcription rule.
 */

const fs = require('fs');
const path = require('path');

function main(raw) {
  let prompt = '';
  try {
    prompt = (JSON.parse(raw || '{}').prompt || '').trim();
  } catch (_) {
    return; // unparseable stdin -> drop silently
  }
  if (!prompt) return;                  // empty submit
  if (prompt.startsWith('/') || prompt.startsWith('<')) {
    // Slash-command / harness-wrapper messages are not the owner's prose - dropped. BUG-18 fix (2026-07-15):
    // if the message does NOT look like a real command/wrapper it may be genuine prose being lost
    // from the corpus, so breadcrumb it - NEVER to the transcript (keeps the corpus clean), NEVER to
    // stdout (HARD RULE), just a local skips log so a dropped line is at least discoverable.
    const looksLikeCommand = /^\/[\w-]+(\s|$)/.test(prompt);
    const looksLikeWrapper = /^<[\w!/-]/.test(prompt);
    if (!looksLikeCommand && !looksLikeWrapper) {
      try {
        const d = new Date(); const p = (n) => String(n).padStart(2, '0');
        const st = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        fs.appendFileSync(path.join(__dirname, '..', 'outputs', 'logs', 'typed-capture-skips.log'),
          `${st} dropped-maybe-prose len=${prompt.length}\n`, 'utf8');
      } catch (_) { /* never harm the prompt */ }
    }
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const dir = path.join(__dirname, '..', 'outputs', 'typed', 'transcripts');
  const file = path.join(dir, `${day}.md`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, `# Typed transcript ${day} (raw typed messages, for soul.md My Words harvest)\n\n`, 'utf8');
    }
    // one bullet per message; collapse internal newlines so a multi-line paste stays a single entry,
    // words otherwise untouched (verbatim).
    const line = prompt.replace(/\r?\n/g, ' ').replace(/[ \t]+/g, ' ').trim();
    fs.appendFileSync(file, `- [${hm}] ${line}\n`, 'utf8');
  } catch (err) {
    // Fail VISIBLE, never fatal (c4, upgrade P1 2026-07-12): a locked file or full disk must not
    // silently eat corpus days. stderr surfaces in hook debug output; the breadcrumb log gives the
    // Monday sweep / a human something to find. Still exit 0 - the prompt is never harmed.
    process.stderr.write(`capture-typed-input: transcript write FAILED (${err.code || err.message})\n`);
    try {
      fs.appendFileSync(path.join(__dirname, '..', 'outputs', 'logs', 'typed-capture-errors.log'),
        `${day} ${hm} ${err.code || ''} ${String(err.message).slice(0, 200)}\n`, 'utf8');
    } catch (_) { /* disk truly gone; stderr was the last resort */ }
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => { try { main(raw); } catch (_) { /* never harm the prompt */ } process.exit(0); });
process.stdin.on('error', () => process.exit(0));
