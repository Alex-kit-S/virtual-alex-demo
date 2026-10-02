#!/usr/bin/env node
// @ts-check
// scripts/capture-typed-input.js - saves every message the owner types to a raw transcript for the day.
//
// WHAT. The owner's own words are the soul corpus, and the My Words harvest in soul.md reads them back from
// here. This hook writes each typed message to the day's transcript as the owner typed it, so the harvest
// never depends on Alex remembering to save a line mid-session. It is the typed twin of the voice
// transcripts.
//
// HOW. Claude Code runs it as the UserPromptSubmit hook in both settings files, with the event's JSON on
// stdin, and only the prompt field is read. An empty prompt, or stdin that is not JSON, is dropped. A
// prompt that opens with / or < is a slash command or a harness wrapper, not prose, and is dropped too;
// when it does not look like one (a name after the slash, a tag after the bracket), one line with its
// length goes to outputs/logs/typed-capture-skips.log, so a line of prose dropped by mistake can be found.
// Any other prompt becomes one bullet, "- [HH:MM] <text>", appended to outputs/typed/transcripts/<day>.md
// under the header the file is created with. Line breaks and runs of spaces and tabs become one space and
// nothing else changes: the imperfections are the signal the corpus wants. The day and the time are the
// machine's local ones. A transcript that cannot be written gets one FAILED line on stderr and one row in
// outputs/logs/typed-capture-errors.log. Neither log line creates outputs/logs/, so on a tree without that
// folder both are lost, as the tests pin today. Every path resolves from this file's folder, never from
// CLAUDE_PROJECT_DIR. The root and the two-digit pad are written here rather than taken from repo-root.js
// and render-templates.js: under standard 3.6 a sibling that failed to load would end this hook in a
// silent exit 0 that loses the owner's words, and its tests and the hook-contract test run it copied alone.
//
// NEVER. Writes to stdout: UserPromptSubmit stdout is injected into the model's context. Throws or exits
// non-zero: a blocking exit erases the owner's prompt, so every path ends in exit 0, and a failed log line
// is dropped without a word. Loads a module that is not a builtin (standard 3.6). Changes a word of the
// prompt. Writes a transcript outside outputs/typed/transcripts/, which both trees' .gitignore keep out of
// git.
//
// Usage: node scripts/capture-typed-input.js < <UserPromptSubmit event JSON>
// Exit: 0 always, whatever the input, the prompt or the disk
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const TRANSCRIPTS = path.join(REPO, 'outputs', 'typed', 'transcripts');
const SKIPS_LOG = path.join(REPO, 'outputs', 'logs', 'typed-capture-skips.log');
const ERRORS_LOG = path.join(REPO, 'outputs', 'logs', 'typed-capture-errors.log');

/** A slash command: the slash, a name, then whitespace or the end. */
const COMMAND = /^\/[\w-]+(\s|$)/;
/** A harness wrapper: the bracket, then a tag name, a comment, or a closing tag. */
const WRAPPER = /^<[\w!/-]/;

/**
 * @param {number} n
 * @returns {string} n in two digits, zero-padded
 */
const pad = (n) => String(n).padStart(2, '0');

/**
 * The machine's local day and minute, as every line this hook writes names them.
 * @returns {[string, string]} ['YYYY-MM-DD', 'HH:MM']
 */
function localStamp() {
  const now = new Date();
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  ];
}

/**
 * The trimmed prompt of a UserPromptSubmit event, or '' for stdin that is not JSON or a prompt that is not
 * a string.
 * @param {string} raw
 * @returns {string}
 */
function readPrompt(raw) {
  try {
    const { prompt } = JSON.parse(raw || '{}');
    return typeof prompt === 'string' ? prompt.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Appends one line to a log and drops it on any failure, because a log line must never cost the prompt.
 * @param {string} file
 * @param {string} line
 */
function appendLogLine(file, line) {
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    // the disk refused the log line; the prompt goes on regardless
  }
}

/**
 * Appends the prompt to the day's transcript, creating the folder and the header first; a failure is
 * reported on stderr and in the error log, never thrown.
 * @param {string} prompt
 * @param {string} day
 * @param {string} time
 */
function writeTranscript(prompt, day, time) {
  const file = path.join(TRANSCRIPTS, `${day}.md`);
  try {
    fs.mkdirSync(TRANSCRIPTS, { recursive: true });
    if (!fs.existsSync(file)) {
      const header = `# Typed transcript ${day} (raw typed messages, for soul.md My Words harvest)\n\n`;
      fs.writeFileSync(file, header, 'utf8');
    }
    const line = prompt
      .replace(/\r?\n/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
    fs.appendFileSync(file, `- [${time}] ${line}\n`, 'utf8');
  } catch (caught) {
    const err = /** @type {NodeJS.ErrnoException} */ (caught);
    process.stderr.write(`capture-typed-input: transcript write FAILED (${err.code || err.message})\n`);
    appendLogLine(ERRORS_LOG, `${day} ${time} ${err.code || ''} ${String(err.message).slice(0, 200)}\n`);
  }
}

/** @param {string} raw the event JSON, as read from stdin */
function main(raw) {
  const prompt = readPrompt(raw);
  if (!prompt) return;
  const [day, time] = localStamp();
  if (prompt.startsWith('/') || prompt.startsWith('<')) {
    if (!COMMAND.test(prompt) && !WRAPPER.test(prompt)) {
      appendLogLine(SKIPS_LOG, `${day} ${time} dropped-maybe-prose len=${prompt.length}\n`);
    }
    return;
  }
  writeTranscript(prompt, day, time);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    main(raw);
  } catch {
    // nothing here throws by design; if something does, the prompt still goes on
  }
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
