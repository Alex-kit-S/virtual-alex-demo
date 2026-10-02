#!/usr/bin/env node
// scripts/tests/test-hook-contracts.mjs - the Claude Code hook contracts of the online settings file
// (and the laptop one, where this tree has it), asserted the way the harness drives them: the REAL
// command string read out of the settings file, run under a shell with CLAUDE_PROJECT_DIR set, the
// event's JSON piped to stdin, and stdout, stderr and the exit code read back.
//
// WHAT. The contract per event, checked against the hooks reference:
//   PreToolUse       the guard, only when $ALEX_UNTRUSTED_LANE$ALEX_ROUTINE is non-empty; exit 2 +
//                    stderr to deny, exit 0 otherwise, nothing on stdout
//   PostToolUse      the autosave --json, only when CLAUDE_CODE_REMOTE=true; stdin ignored; nothing on
//                    a clean save, otherwise ONE object carrying BOTH systemMessage (the owner) and
//                    hookSpecificOutput.additionalContext (the model); exit 0 always
//   Stop             the autosave --stop --json, same gate, timeout 120; nothing, or ONE
//                    {"decision":"block","reason":...} unless stop_hook_active is true; exit 0 always
//   SessionStart     the chain: BRANCH line, CLI line or nothing, hooksPath, card build, identity
//                    (nothing when the card exists, else soul.md, else ---NO-IDENTITY-YET---),
//                    ---DISPATCH-CONTEXT--- and five lines, ---INBOX-NOTICE---, WAITING ON YOU; exit 0
//   UserPromptSubmit the typed-input capture; nothing on stdout, exit 0
// test-hook-contracts-kit.mjs holds the laptop file's own two contracts (its SessionStart tail and its
// shared guard/capture), split out when a generated online tree has no laptop settings file to compare
// against; the laptop-vs-online comparison inside UserPromptSubmit's own case stays here, gated on IS_KIT.
//
// HOW. Every fixture is a throwaway git repository with a bare origin in a temp folder this file
// deletes. A fake `claude` on the PATH answers the version probe, so no line depends on this machine's
// CLI. Git runs with no system or global config.
//
// NEVER. Reaches a network. Flips a PINNED DEFECT assertion on its own: each pins the settings file's
// behaviour as it is today, and only a FIX row in the ratchet flips one. ST-D1: the write hook matcher
// misses Bash-written files (and NotebookEdit). ST-D2: SessionStart has no matcher, so it runs on
// resume, clear and compact. ST-D3: the write hook has no timeout (the 600 s default), while Stop has
// 120 s. ST-D4: the allow list admits arbitrary execution (node, awk, find, source, npm, mv). ST-D5: the
// Edit deny list is not the identity list the autosave calls "the third copy". SB-D5: a second
// SessionStart finds the card the first one built and reports BRANCH-DIVERGED. HA-D2: a crashing
// sessionline is silent in SessionStart (its stderr is discarded).
//
// Usage: node scripts/tests/test-hook-contracts.mjs
// Exit: 0 all pass - 1 a failure

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBash } from './fixtures/find-bash.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-hook-contracts-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

// In the Kit the online settings are a variant under variants/online/ and .claude/settings.json is the
// laptop file; in the generated online tree .claude/settings.json IS the online file and there is no
// laptop file. The laptop cases run only where both exist.
const IS_KIT = fs.existsSync(path.join(KIT, 'variants', 'online', '.claude', 'settings.json'));
const ONLINE = JSON.parse(
  fs.readFileSync(
    IS_KIT
      ? path.join(KIT, 'variants', 'online', '.claude', 'settings.json')
      : path.join(KIT, '.claude', 'settings.json'),
    'utf8'
  )
);
const LAPTOP = IS_KIT ? JSON.parse(fs.readFileSync(path.join(KIT, '.claude', 'settings.json'), 'utf8')) : null;
const ONLINE_GITIGNORE = IS_KIT ? path.join(KIT, 'variants', 'online', '.gitignore') : path.join(KIT, '.gitignore');
const cmdOf = (settings, event, i = 0) => settings.hooks[event][0].hooks[i].command;

const BASH = findBash();
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');

// The fake CLI the SessionStart version probe asks.
const BIN = path.join(TMP, 'bin');
fs.mkdirSync(BIN);
function fakeClaude(version) {
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(BIN, 'claude.cmd'), `@echo off\r\necho ${version} (Claude Code)\r\n`);
  else {
    fs.writeFileSync(path.join(BIN, 'claude'), `#!/bin/sh\necho "${version} (Claude Code)"\n`);
    fs.chmodSync(path.join(BIN, 'claude'), 0o755);
  }
}
fakeClaude('2.1.259');
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
// CLAUDE_CODE_REMOTE, ALEX_ROUTINE and ALEX_UNTRUSTED_LANE default to UNSET, not blank: a laptop
// install never sets any of them at all, and unset (not '') is the shape `set -u` inside autosave.sh
// actually depends on for ALEX_ROUTINE once a case here invokes it with CLAUDE_CODE_REMOTE=true (see
// T1 in test-autosave.mjs). Node's spawnSync drops an env entry whose value is undefined.
const ENV = {
  ...process.env,
  [PATH_KEY]: `${BIN}${path.delimiter}${process.env[PATH_KEY] || ''}`,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  CLAUDE_CODE_REMOTE: undefined,
  ALEX_ROUTINE: undefined,
  ALEX_UNTRUSTED_LANE: undefined,
  ALEX_CLI_VERSION_TIMEOUT_MS: '10000'
};
function git(cwd, args, allowFail = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return allowFail ? r : (r.stdout || '').trim();
}
const W = (dir, rel, text) => {
  const p = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

const SCRIPTS = [
  'scripts/untrusted-lane-guard.js',
  'scripts/autosave.sh',
  'scripts/capture-typed-input.js',
  'scripts/human-actions.js',
  'scripts/lib/session-branch.sh',
  'scripts/lib/cli-version.js',
  'scripts/lib/build-soul-core.js',
  'scripts/lib/write-lock.js'
];
let n = 0;
function project({ scripts = SCRIPTS, soul = null } = {}) {
  const base = path.join(TMP, `p${++n}`);
  const bare = path.join(base, 'origin.git');
  const dir = path.join(base, 'work');
  fs.mkdirSync(base);
  git(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(base, ['init', '-q', '-b', 'main', dir]);
  for (const rel of scripts) {
    const d = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(KIT, ...rel.split('/')), d);
  }
  fs.copyFileSync(ONLINE_GITIGNORE, path.join(dir, '.gitignore'));
  // a stub secret scanner (the autosave's leg contract: --file <path>, exit 2 on a hit)
  W(
    dir,
    'scripts/secret-scan.mjs',
    "import fs from 'node:fs';\nconst f = process.argv[process.argv.indexOf('--file') + 1];\n" +
      "if (fs.readFileSync(f, 'utf8').includes('SECRET-MARK')) { console.log('secret-scan: ' + f + ':1 fake-hit'); process.exit(2); }\n"
  );
  W(dir, 'CLAUDE.md', '# rules\n');
  if (soul) W(dir, 'soul.md', soul);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'seed']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', '-u', 'origin', 'main']);
  return { dir, bare };
}
function hook(command, dir, input, env = {}) {
  const r = spawnSync(BASH, ['-c', command], {
    cwd: dir,
    input,
    encoding: 'utf8',
    env: { ...ENV, CLAUDE_PROJECT_DIR: dir, ...env },
    timeout: 120000
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const mask = (s) => s.replace(/\b[0-9a-f]{7,12}\b/g, '<sha>');

const DISPATCH = [
  '---DISPATCH-CONTEXT---',
  'MCP tools are deferred. Before using Notion/Gmail/Calendar tools, load them via ToolSearch first.',
  'Notion date format: date:FieldName:start not flat string. Checkbox: __YES__/__NO__ not true/false.',
  'Gmail drafts: use gmail_create_draft MCP, not Chrome. Alex drafts and never sends.',
  'Calendar list_events: startTime/endTime in ISO 8601 (the older timeMin/timeMax names 404).',
  'Check vault/projects/error-log.md for past MCP fixes before retrying.'
];
const NO_IDENTITY =
  '---NO-IDENTITY-YET--- No soul.md exists yet, so Alex has no voice or priorities loaded. This is the normal state of a brand new install. Tell the owner to run /setup, and do not pretend to have an identity you have not been given.';

// A soul.md the card builder accepts: every required heading, zero dated entries, both canaries.
const TOKEN = 'c0de'.repeat(4);
const SOUL = [
  '# Soul - Who I Am',
  '',
  '## Headless injection check (top)',
  `SOUL-CANARY-TOKEN: ${TOKEN}`,
  '',
  '## My Role',
  'Fixture.',
  '',
  '## My Company/Business',
  'Fixture.',
  '',
  '## Writing Style',
  'Plain.',
  '',
  '## How I Communicate',
  'Direct.',
  '',
  '## My Priorities',
  '1. Test.',
  '',
  '## Agent Personality - Alex',
  'Calm.',
  '',
  '## Voice Rules',
  'No filler.',
  '',
  '## Things I Never Want',
  'Invented facts.',
  '',
  '## My Words',
  'Newest first.',
  '',
  '## Headless injection check (end)',
  `SOUL-CANARY-TOKEN: ${TOKEN}`,
  ''
].join('\n');

test('the online wiring: five events, the matchers, the gates, the timeouts and the env block', () => {
  assert.deepEqual(Object.keys(ONLINE.hooks), [
    'PreToolUse',
    'PostToolUse',
    'SessionStart',
    'UserPromptSubmit',
    'Stop'
  ]);
  for (const ev of Object.keys(ONLINE.hooks)) assert.equal(ONLINE.hooks[ev].length, 1, ev);
  assert.equal(
    ONLINE.hooks.PreToolUse[0].matcher,
    'Bash|PowerShell|WebFetch|WebSearch|Write|Edit|MultiEdit|NotebookEdit|mcp__.*'
  );
  assert.equal(
    cmdOf(ONLINE, 'PreToolUse'),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the real hook command string (bash's own ${VAR:-.} expansion), not a forgotten template literal
    'if [ -n "$ALEX_UNTRUSTED_LANE$ALEX_ROUTINE" ]; then node "${CLAUDE_PROJECT_DIR:-.}/scripts/untrusted-lane-guard.js"; fi'
  );
  assert.equal(
    cmdOf(ONLINE, 'PostToolUse'),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the real hook command string (bash's own ${VAR:-.} expansion), not a forgotten template literal
    'if [ "$CLAUDE_CODE_REMOTE" = "true" ]; then bash "${CLAUDE_PROJECT_DIR:-.}/scripts/autosave.sh" --json; fi'
  );
  assert.equal(
    cmdOf(ONLINE, 'Stop'),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the real hook command string (bash's own ${VAR:-.} expansion), not a forgotten template literal
    'if [ "$CLAUDE_CODE_REMOTE" = "true" ]; then bash "${CLAUDE_PROJECT_DIR:-.}/scripts/autosave.sh" --stop --json; fi'
  );
  assert.equal(ONLINE.hooks.Stop[0].hooks[0].timeout, 120);
  assert.equal(ONLINE.hooks.Stop[0].matcher, undefined);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the real hook command string (bash's own ${VAR:-.} expansion), not a forgotten template literal
  assert.equal(cmdOf(ONLINE, 'UserPromptSubmit'), 'node "${CLAUDE_PROJECT_DIR:-.}/scripts/capture-typed-input.js"');
  assert.equal(ONLINE.hooks.UserPromptSubmit[0].hooks.length, 1, 'online carries no recall injection');
  assert.deepEqual(ONLINE.env, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  assert.equal(ONLINE.permissions.defaultMode, 'acceptEdits');
  assert.ok(ONLINE.permissions.deny.includes('Edit(/scripts/lib/**)'), 'test-template-gate reads this literal');
});

test('PINNED DEFECT ST-D1 and ST-D3: the write hook matches Write|Edit|MultiEdit only and has no timeout', () => {
  assert.equal(ONLINE.hooks.PostToolUse[0].matcher, 'Write|Edit|MultiEdit');
  assert.equal(ONLINE.hooks.PostToolUse[0].hooks[0].timeout, undefined);
});

test('PINNED DEFECT ST-D2: SessionStart has no matcher (startup, resume, clear and compact all run the chain)', () => {
  assert.equal(ONLINE.hooks.SessionStart[0].matcher, undefined);
});

test('PINNED DEFECT ST-D4 and ST-D5: the allow list admits arbitrary execution, and the Edit denies are not the identity list', () => {
  for (const rule of ['Bash(node *)', 'Bash(awk *)', 'Bash(find *)', 'Bash(source *)', 'Bash(npm *)', 'Bash(mv *)'])
    assert.ok(ONLINE.permissions.allow.includes(rule), rule);
  const edits = ONLINE.permissions.deny.filter((r) => r.startsWith('Edit('));
  assert.deepEqual(edits, [
    'Edit(/.claude/settings.json)',
    'Edit(/.claude/commands/**)',
    'Edit(/scripts/hooks/**)',
    'Edit(/scripts/lib/**)',
    'Edit(/.github/workflows/**)',
    'Edit(/.mcp.json)',
    'Edit(/system/soul-pins.json)',
    'Edit(/skills-lock.json)'
  ]);
  for (const missing of ['CLAUDE.md', 'soul.md', 'scheduler/routines', '.gitignore', 'system/manifest.json']) {
    assert.ok(!edits.some((r) => r.includes(missing)), `${missing} is not denied to an owner-session Edit`);
  }
});

test('PreToolUse: unarmed the shell gate never starts node; armed it denies with exit 2 on stderr; a payload that does not parse passes', () => {
  const bare = project({ scripts: [] }); // no guard file at all: if node ran, it would fail
  const identityEdit = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'CLAUDE.md' } });
  assert.deepEqual(hook(cmdOf(ONLINE, 'PreToolUse'), bare.dir, identityEdit), { code: 0, stdout: '', stderr: '' });
  const armedMissing = hook(cmdOf(ONLINE, 'PreToolUse'), bare.dir, identityEdit, { ALEX_UNTRUSTED_LANE: 'x' });
  assert.equal(armedMissing.code, 1, 'with the gate open, node does run (and here fails on the missing file)');

  const p = project();
  const deny = hook(cmdOf(ONLINE, 'PreToolUse'), p.dir, identityEdit, { ALEX_UNTRUSTED_LANE: 'email-triage' });
  assert.equal(deny.code, 2);
  assert.equal(deny.stdout, '');
  assert.match(
    deny.stderr,
    /^BLOCKED by untrusted-lane-guard \(lane=email-triage\): Edit to an identity surface is not allowed in an untrusted lane\. /
  );
  const routineFetch = hook(
    cmdOf(ONLINE, 'PreToolUse'),
    p.dir,
    JSON.stringify({ tool_name: 'WebFetch', tool_input: { url: 'https://example.org/feed' } }),
    { ALEX_ROUTINE: '1' }
  );
  assert.deepEqual(routineFetch, { code: 0, stdout: '', stderr: '' });
  const routineRules = hook(
    cmdOf(ONLINE, 'PreToolUse'),
    p.dir,
    JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'scheduler/routines/radar.md' } }),
    { ALEX_ROUTINE: '1' }
  );
  assert.equal(routineRules.code, 2);
  assert.match(routineRules.stderr, /^BLOCKED by untrusted-lane-guard \(routine session, ALEX_ROUTINE set\): /);
  assert.deepEqual(hook(cmdOf(ONLINE, 'PreToolUse'), p.dir, 'not json', { ALEX_UNTRUSTED_LANE: 'x' }), {
    code: 0,
    stdout: '',
    stderr: ''
  });
  if (IS_KIT)
    assert.equal(
      hook(cmdOf(LAPTOP, 'PreToolUse'), p.dir, identityEdit, { ALEX_UNTRUSTED_LANE: 'x' }).code,
      2,
      'the laptop string behaves the same'
    );
});

test('PostToolUse: off the cloud nothing at all; in the cloud stdin is ignored, a clean save is silent, a refused file reaches the owner AND the model', () => {
  const p = project();
  const payload = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: 'vault/a.md' },
    tool_response: { success: true }
  });
  W(p.dir, 'vault/a.md', 'fine\n');
  assert.deepEqual(hook(cmdOf(ONLINE, 'PostToolUse'), p.dir, payload), { code: 0, stdout: '', stderr: '' });
  assert.equal(
    git(p.dir, ['status', '--porcelain', '--', 'vault/a.md']),
    '?? vault/a.md',
    'off the cloud (CLAUDE_CODE_REMOTE truly unset) nothing is saved'
  );
  // the '' shape stays pinned once too: nothing stops a caller from handing this an explicit blank
  assert.deepEqual(hook(cmdOf(ONLINE, 'PostToolUse'), p.dir, payload, { CLAUDE_CODE_REMOTE: '' }), {
    code: 0,
    stdout: '',
    stderr: ''
  });
  assert.equal(
    git(p.dir, ['status', '--porcelain', '--', 'vault/a.md']),
    '?? vault/a.md',
    "off the cloud (CLAUDE_CODE_REMOTE='') nothing is saved either"
  );

  assert.deepEqual(hook(cmdOf(ONLINE, 'PostToolUse'), p.dir, payload, { CLAUDE_CODE_REMOTE: 'true' }), {
    code: 0,
    stdout: '',
    stderr: ''
  });
  assert.equal(git(p.dir, ['status', '--porcelain']), '', 'the clean save committed');

  W(p.dir, 'vault/leak.md', 'SECRET-MARK\n');
  W(p.dir, 'vault/b.md', 'fine\n');
  const r = hook(cmdOf(ONLINE, 'PostToolUse'), p.dir, 'this stdin is never read', { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(r.code, 0);
  assert.equal(
    r.stderr,
    'autosave: refused vault/leak.md: scripts/secret-scan.mjs exit 2: secret-scan: vault/leak.md:1 fake-hit (left unstaged)\n'
  );
  assert.ok(
    r.stdout.startsWith('{') && r.stdout.endsWith('}'),
    'stdout is exactly one JSON object, so the harness parses it'
  );
  const o = JSON.parse(r.stdout);
  // A synchronous PostToolUse hook's systemMessage is a notice shown to the OWNER only;
  // hookSpecificOutput.additionalContext is what the model actually reads, so both ship, over
  // the same text.
  assert.deepEqual(Object.keys(o), ['systemMessage', 'hookSpecificOutput']);
  assert.equal(
    mask(o.systemMessage),
    'autosave: committed <sha>; main at <sha> pushed to origin/main; refused 1: vault/leak.md'
  );
  assert.deepEqual(o.hookSpecificOutput, { hookEventName: 'PostToolUse', additionalContext: o.systemMessage });
});

test('Stop: off the cloud nothing; a refusal blocks once with a decision and a reason; stop_hook_active true never blocks', () => {
  const p = project();
  W(p.dir, 'vault/leak.md', 'SECRET-MARK\n');
  assert.deepEqual(hook(cmdOf(ONLINE, 'Stop'), p.dir, '{"stop_hook_active":false}'), {
    code: 0,
    stdout: '',
    stderr: ''
  });
  const block = hook(
    cmdOf(ONLINE, 'Stop'),
    p.dir,
    JSON.stringify({ session_id: 's', hook_event_name: 'Stop', stop_hook_active: false }),
    { CLAUDE_CODE_REMOTE: 'true' }
  );
  assert.equal(block.code, 0);
  const o = JSON.parse(block.stdout);
  assert.deepEqual(Object.keys(o), ['decision', 'reason']);
  assert.equal(o.decision, 'block');
  assert.equal(
    mask(o.reason),
    'autosave: no new commit; main at <sha> pushed to origin/main and read back; refused 1: vault/leak.md'
  );
  assert.deepEqual(
    hook(cmdOf(ONLINE, 'Stop'), p.dir, '{"session_id":"s","stop_hook_active":true}', { CLAUDE_CODE_REMOTE: 'true' })
      .stdout,
    ''
  );
  fs.rmSync(path.join(p.dir, 'vault', 'leak.md'));
  assert.deepEqual(
    hook(cmdOf(ONLINE, 'Stop'), p.dir, '{"stop_hook_active":false}', { CLAUDE_CODE_REMOTE: 'true' }),
    { code: 0, stdout: '', stderr: '' },
    'a clean stop is silent'
  );
});

test('SessionStart on a brand-new tree: the BRANCH line, no identity yet, the dispatch block, the commit gate armed, exit 0', () => {
  const p = project();
  const r = hook(
    cmdOf(ONLINE, 'SessionStart'),
    p.dir,
    JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' })
  );
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, ['BRANCH: main', NO_IDENTITY, ...DISPATCH, ''].join('\n'));
  assert.equal(git(p.dir, ['config', '--get', 'core.hooksPath']), 'scripts/hooks');
});

test('SessionStart with an old CLI: the CLI-OLD line comes second', () => {
  const p = project();
  fakeClaude('2.1.100');
  try {
    const r = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, '');
    assert.equal(
      r.stdout.split('\n')[1],
      '---CLI-OLD--- Claude Code 2.1.100 is older than 2.1.227: whether a save the commit gate refuses reaches Alex on this CLI has not been measured. Say so in your first reply, and ask the owner to check the autosave log with /alex-status before trusting that anything was saved.'
    );
  } finally {
    fakeClaude('2.1.259');
  }
});

test('SessionStart with a soul.md the builder refuses: the card is not built, silently, and the full soul.md is printed instead', () => {
  const p = project({ soul: '# Soul\n\nA soul.md with none of the required headings.\n' });
  const r = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, '');
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(
    r.stdout,
    ['BRANCH: main', '# Soul', '', 'A soul.md with none of the required headings.', ...DISPATCH, ''].join('\n')
  );
  assert.equal(fs.existsSync(path.join(p.dir, 'soul-core.md')), false);
});

test('SessionStart with a valid soul.md: the card is built and the identity group prints nothing (the card rides the @import)', () => {
  const p = project({ soul: SOUL });
  const r = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, '');
  assert.equal(r.stdout, ['BRANCH: main', ...DISPATCH, ''].join('\n'));
  assert.match(
    fs.readFileSync(path.join(p.dir, 'soul-core.md'), 'utf8'),
    /SOUL-CORE-STAMP: source-sha256=[0-9a-f]{64} pins-sha256=[0-9a-f]{8} generated-at=\S+ entries=0 pinned=0 token-count=2$/
  );
});

test('PINNED DEFECT SB-D5: the card the first SessionStart built is an unsaved file, so a second one (compact) reports BRANCH-DIVERGED', () => {
  const p = project({ soul: SOUL });
  hook(cmdOf(ONLINE, 'SessionStart'), p.dir, JSON.stringify({ source: 'startup' }));
  assert.equal(git(p.dir, ['status', '--porcelain']), '?? soul-core.md');
  const again = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, JSON.stringify({ source: 'compact' }));
  assert.equal(
    again.stdout.split('\n')[0],
    "---BRANCH-DIVERGED--- This session is on main, but this copy is NOT known to match GitHub's main (it has unsaved files, so nothing was synced with GitHub). What you read here may be old, and a save from here can land on top of work you cannot see. Tell the owner that in one plain sentence in your first reply, before any other work."
  );
});

test('SessionStart: files in inbox/ add the notice (.gitkeep, _ingested.md and .DS_Store do not count); an item 7+ days old adds WAITING ON YOU', () => {
  const p = project();
  for (const f of ['.gitkeep', '_ingested.md', '.DS_Store', 'note-1.md', 'sub/scan.pdf']) W(p.dir, `inbox/${f}`, 'x');
  const created = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  W(
    p.dir,
    'system/human-actions.jsonl',
    JSON.stringify({ id: 'renew', what: 'Renew it', severity: 'high', created }) + '\n'
  );
  git(p.dir, ['add', '-A']);
  git(p.dir, ['commit', '-qm', 'inbox']);
  git(p.dir, ['push', '-q', 'origin', 'main']);
  const r = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, '', { TZ: 'UTC' });
  const lines = r.stdout.split('\n');
  assert.deepEqual(lines.slice(-4), [
    '---INBOX-NOTICE---',
    'You have 2 file(s) in inbox/ that may need ingesting. If new, suggest running /ingest.',
    'WAITING ON YOU: 1 item(s) only you can do, oldest 8d (say "waiting list" for the queue).',
    ''
  ]);
});

test('PINNED DEFECT HA-D2: a queue row that crashes sessionline is silent in SessionStart: no WAITING line, no error, exit 0', () => {
  const p = project();
  const old = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  W(
    p.dir,
    'system/human-actions.jsonl',
    [
      JSON.stringify({ id: 'a', what: 'A', severity: 'high', created: old }),
      JSON.stringify({ id: 'b', what: 'B', severity: 'high' })
    ].join('\n') + '\n'
  );
  git(p.dir, ['add', '-A']);
  git(p.dir, ['commit', '-qm', 'q']);
  git(p.dir, ['push', '-q', 'origin', 'main']);
  const r = hook(cmdOf(ONLINE, 'SessionStart'), p.dir, '');
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.doesNotMatch(r.stdout, /WAITING ON YOU/);
  assert.equal(r.stdout.trimEnd().split('\n').pop(), DISPATCH[DISPATCH.length - 1]);
});

test('UserPromptSubmit: the capture writes the transcript under the project and prints nothing, exit 0', () => {
  const p = project();
  const r = hook(
    cmdOf(ONLINE, 'UserPromptSubmit'),
    p.dir,
    JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hello from the owner' }),
    { TZ: 'UTC' }
  );
  assert.deepEqual(r, { code: 0, stdout: '', stderr: '' });
  const dir = path.join(p.dir, 'outputs', 'typed', 'transcripts');
  const [file] = fs.readdirSync(dir);
  assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /\n- \[\d{2}:\d{2}\] hello from the owner\n$/);
  if (IS_KIT)
    assert.deepEqual(hook(cmdOf(LAPTOP, 'UserPromptSubmit', 0), p.dir, JSON.stringify({ prompt: 'again' })), {
      code: 0,
      stdout: '',
      stderr: ''
    });
});
