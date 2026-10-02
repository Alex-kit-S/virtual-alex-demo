#!/usr/bin/env node
// @ts-check
// scripts/tests/test-capture-typed-input.mjs - the typed-input hook, run the way Claude Code runs it.
//
// WHAT. Pins scripts/capture-typed-input.js, the UserPromptSubmit hook in both settings files, as it
// behaves today: nothing on stdout, because UserPromptSubmit stdout is injected into the model's context,
// and exit 0, because a blocking exit erases the owner's prompt, on every input shape; the transcript
// format the My Words harvest reads; the day file and the minute in the local zone; the breadcrumb for a
// dropped line of prose; and the failure path. Deleted, a hook that printed into the model's context,
// blocked a prompt, lost a day of the owner's words or rewrote them on the way in would pass with every
// other test green.
//
// HOW. The hook writes beside itself, so each test copies it alone into a fresh tree in a temp folder and
// runs it as a child with the event JSON on stdin, TZ pinned and ALEX_ROUTINE emptied. The day is read
// from the real clock before and after each call, so a run across midnight still passes.
//
// NEVER. Writes outside its own temp folder, which it removes at the end. Flips a PINNED DEFECT assertion
// on its own: each pins today's behaviour, and only a FIX row in the ratchet flips one. CT-D1: the skip
// breadcrumb and the error log are lost when outputs/logs/ does not exist. CT-D2: a Routine's prompt is
// captured as the owner's typed words, with no ALEX_ROUTINE gate.
//
// Usage: node scripts/tests/test-capture-typed-input.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-capture-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

let n = 0;
/** A fresh tree in the temp folder holding the hook alone, with outputs/logs/ when asked. */
function tree({ logs = false } = {}) {
  const t = path.join(TMP, `tree-${++n}`);
  fs.mkdirSync(path.join(t, 'scripts'), { recursive: true });
  if (logs) fs.mkdirSync(path.join(t, 'outputs', 'logs'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'capture-typed-input.js'),
    path.join(t, 'scripts', 'capture-typed-input.js')
  );
  return t;
}
/**
 * Runs the hook in tree t with input on stdin, the way the harness does.
 * @param {string} t
 * @param {string} input
 * @param {Record<string, string>} [env]
 */
function capture(t, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(t, 'scripts', 'capture-typed-input.js')], {
    input,
    encoding: 'utf8',
    cwd: os.tmpdir(),
    env: { ...process.env, TZ: 'UTC', ALEX_ROUTINE: '', ...env }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const day = () => new Date().toISOString().slice(0, 10);
/** @param {string} t */
const DIR = (t) => path.join(t, 'outputs', 'typed', 'transcripts');
/** @param {string} t */
const transcripts = (t) => (fs.existsSync(DIR(t)) ? fs.readdirSync(DIR(t)) : []);
const SILENT = { code: 0, stdout: '', stderr: '' };

test('a prompt: nothing on stdout or stderr, exit 0, one bullet under the day header, newlines and runs of blanks collapsed', () => {
  const t = tree();
  const before = day();
  assert.deepEqual(capture(t, JSON.stringify({ prompt: '  first line\r\nsecond\tline   with   gaps  ' })), SILENT);
  assert.deepEqual(capture(t, JSON.stringify({ prompt: 'and a second message', session_id: 'x' })), SILENT);
  const files = transcripts(t);
  assert.equal(files.length, 1);
  const d = files[0].replace(/\.md$/, '');
  assert.ok([before, day()].includes(d), files[0]);
  const text = fs.readFileSync(path.join(DIR(t), files[0]), 'utf8');
  const m =
    /^# Typed transcript (\d{4}-\d{2}-\d{2}) \(raw typed messages, for soul\.md My Words harvest\)\n\n- \[(\d{2}:\d{2})\] first line second line with gaps\n- \[(\d{2}:\d{2})\] and a second message\n$/.exec(
      text
    );
  assert.ok(m, JSON.stringify(text));
  assert.equal(m[1], d, 'the header carries the same day as the file name');
});

test('the day file and the HH:MM follow the local zone (TZ), not UTC', () => {
  const t = tree();
  const local = () => new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10); // Etc/GMT-14 is UTC+14
  const before = local();
  capture(t, JSON.stringify({ prompt: 'hello' }), { TZ: 'Etc/GMT-14' });
  assert.ok([before, local()].includes(transcripts(t)[0].replace(/\.md$/, '')), transcripts(t)[0]);
});

test('slash commands and <wrapper> messages are dropped: no transcript and no breadcrumb', () => {
  const t = tree({ logs: true });
  for (const prompt of [
    '/status',
    '/alex-status now',
    '<command-name>/status</command-name>',
    '<!-- note -->',
    '</x>'
  ]) {
    assert.deepEqual(capture(t, JSON.stringify({ prompt })), SILENT, prompt);
  }
  assert.deepEqual(transcripts(t), []);
  assert.deepEqual(fs.readdirSync(path.join(t, 'outputs', 'logs')), []);
});

test('prose that merely starts with / or < is dropped from the transcript but breadcrumbed with its length', () => {
  const t = tree({ logs: true });
  const before = day();
  assert.deepEqual(capture(t, JSON.stringify({ prompt: '/usr/local is where I keep my notes' })), SILENT);
  assert.deepEqual(capture(t, JSON.stringify({ prompt: '< 3 is less than it looks' })), SILENT);
  assert.deepEqual(transcripts(t), []);
  const log = fs.readFileSync(path.join(t, 'outputs', 'logs', 'typed-capture-skips.log'), 'utf8');
  const lines = log.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  for (const [i, len] of [
    [0, 35],
    [1, 25]
  ]) {
    const m = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2} dropped-maybe-prose len=(\d+)$/.exec(lines[i]);
    assert.ok(m, lines[i]);
    assert.ok([before, day()].includes(m[1]));
    assert.equal(Number(m[2]), len);
  }
});

test('PINNED DEFECT CT-D1: on a tree with no outputs/logs/ the breadcrumb is lost, and nothing at all is created', () => {
  const t = tree();
  assert.deepEqual(capture(t, JSON.stringify({ prompt: '/usr/local is where I keep my notes' })), SILENT);
  assert.equal(fs.existsSync(path.join(t, 'outputs')), false);
});

test('every malformed or empty input exits 0 silently and writes nothing', () => {
  const t = tree({ logs: true });
  for (const input of ['', 'not json', 'null', '{}', '{"prompt":5}', '{"prompt":"   "}', '{"prompt":null}', '[1,2]']) {
    assert.deepEqual(capture(t, input), SILENT, input);
  }
  assert.deepEqual(transcripts(t), []);
  assert.deepEqual(fs.readdirSync(path.join(t, 'outputs', 'logs')), []);
});

test('a transcript that cannot be written: one FAILED line on stderr, a row in the error log, still exit 0 and silent on stdout', () => {
  const t = tree({ logs: true });
  fs.writeFileSync(path.join(t, 'outputs', 'typed'), 'a file where the directory should be');
  const before = day();
  const r = capture(t, JSON.stringify({ prompt: 'this will not land' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
  const m = /^capture-typed-input: transcript write FAILED \(([A-Z]+)\)\n$/.exec(r.stderr);
  assert.ok(m, r.stderr);
  const err = fs.readFileSync(path.join(t, 'outputs', 'logs', 'typed-capture-errors.log'), 'utf8');
  assert.match(err, new RegExp(`^(${before}|${day()}) \\d{2}:\\d{2} ${m[1]} ${m[1]}: `));
  assert.equal(err.split('\n').filter(Boolean).length, 1);
});

test('PINNED DEFECT CT-D1: the same failure on a tree with no outputs/logs/ keeps only the stderr line', () => {
  const t = tree();
  fs.mkdirSync(path.join(t, 'outputs'));
  fs.writeFileSync(path.join(t, 'outputs', 'typed'), 'a file where the directory should be');
  const r = capture(t, JSON.stringify({ prompt: 'this will not land' }));
  assert.equal(r.code, 0);
  assert.match(r.stderr, /^capture-typed-input: transcript write FAILED \(/);
  assert.equal(fs.existsSync(path.join(t, 'outputs', 'logs')), false);
});

test('PINNED DEFECT CT-D2: a Routine session (ALEX_ROUTINE=1) is captured as if the owner typed it', () => {
  const t = tree();
  assert.deepEqual(capture(t, JSON.stringify({ prompt: 'Run the triage Routine' }), { ALEX_ROUTINE: '1' }), SILENT);
  const [file] = transcripts(t);
  assert.match(fs.readFileSync(path.join(DIR(t), file), 'utf8'), /- \[\d{2}:\d{2}\] Run the triage Routine\n$/);
});
