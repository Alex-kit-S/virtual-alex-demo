#!/usr/bin/env node
// @ts-check
// scripts/tests/test-setup-command-contract.mjs - the commands /setup (both trees), /alex-status, the brief and the
// install launchers run into scripts/bootstrap.mjs, scripts/import-memory.mjs and scripts/lib/install-state.js,
// frozen word for word and run against THIS code, with the lines each caller reads back asserted exactly.
//
// WHAT. A command file is text a model follows, and an owner's tree may hold an older one than the scripts it
// calls, so the command texts are copied here as they stand and run as they are:
//   .claude/commands/setup.md:44, Install-Alex.command:246, Update-Alex.command:119
//       node scripts/bootstrap.mjs --repair-links            (laptop: nothing parsed; links made)
//   variants/online/.claude/commands/setup.md:68 (under CLAUDE_CODE_REMOTE=true)
//       node scripts/bootstrap.mjs --repair-links            "read its two PASS lines back and quote them"
//   variants/online/.claude/commands/setup.md:422, :434
//       node scripts/import-memory.mjs "${TMPDIR:-/tmp}/alex-import/memory.zip" [--apply]
//       the last line, every skip line with its reason, every "replaces an existing file" line,
//       every REFUSED line, the WROTE line
//   variants/online/.claude/commands/alex-status.md:11, brief.md's install-state line
//       node scripts/lib/install-state.js line               printed as it prints
// test-setup-command-contract-kit.mjs holds Install-Alex.cmd:251 and Update-Alex.cmd:118's own case
// (scripts\bootstrap.ps1 -RepairJunctions, Windows only), split out when a generated online tree ships no
// .ps1 shim to run.
// Deleted, this file would let a change to any of those three programs break a line an owner's older command
// text reads back, or a current command file drop a frozen command, with every other test green.
//
// HOW. Fixture repositories in the OS temp folder hold COPIES of the code under test, a small synthetic
// environment schema (one tool, node, so the answer does not depend on this machine), a three-skill lock and
// store, and a temp home folder. ZIPs are built by a small writer here. A test named "PINNED DEFECT <id>" asserts
// behaviour known to be wrong; its fix flips exactly that assertion when the defect ledger schedules it.
//
// NEVER. Writes inside the repository it runs in, or registers anything. Fixes a defect it pins: R4-L15, the
// importer lists a Finder ZIP's folder entries as skipped "not soul.md or vault/", one of them with no name at
// all, and setup.md tells the model to show the owner that list; R4-L23, online setup.md expects the skill-store
// line to say "links match", which only a second repair says (a first says "repaired ...").
//
// Usage: node scripts/tests/test-setup-command-contract.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));
const ONLINE_SETUP = IS_KIT
  ? path.join(ROOT, 'variants', 'online', '.claude', 'commands', 'setup.md')
  : path.join(ROOT, '.claude', 'commands', 'setup.md');
const ONLINE_STATUS = IS_KIT
  ? path.join(ROOT, 'variants', 'online', '.claude', 'commands', 'alex-status.md')
  : path.join(ROOT, '.claude', 'commands', 'alex-status.md');

const OLD = {
  repair: 'node scripts/bootstrap.mjs --repair-links',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion inside a frozen command text
  importPlan: 'node scripts/import-memory.mjs "${TMPDIR:-/tmp}/alex-import/memory.zip"',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion inside a frozen command text
  importApply: 'node scripts/import-memory.mjs "${TMPDIR:-/tmp}/alex-import/memory.zip" --apply',
  line: 'node scripts/lib/install-state.js line',
  shInstallRepair: 'node scripts/bootstrap.mjs --repair-links >>"$LOG" 2>&1',
  cmdRepair:
    'call powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\\bootstrap.ps1" -RepairJunctions >>"%LOG%" 2>&1',
  onlineRepairReadBack:
    'Read its two PASS lines back and quote them: the skill store (links match) and\n   `core.hooksPath` (`scripts/hooks`, set and read back).'
};

function findBash() {
  if (process.env.ALEX_BASH) return process.env.ALEX_BASH;
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const cand = line.trim() && path.join(path.dirname(path.dirname(line.trim())), 'bin', 'bash.exe');
    if (cand && fs.existsSync(cand)) return cand;
  }
  return 'bash';
}
const BASH = findBash();

/**
 * @typedef {object} Fixture a throwaway repository with its own home, tmp folder and git config
 * @property {string} T the fixture's temp folder
 * @property {string} repo the repository the commands run in
 * @property {(rel: string, text: string | Buffer) => void} put writes a file into the repository
 * @property {NodeJS.ProcessEnv} env the commands' environment
 * @property {(...args: string[]) => import('node:child_process').SpawnSyncReturns<string>} g git in the repository
 * @property {(script: string, extra?: Record<string, string>) => import('node:child_process').SpawnSyncReturns<string>} bash
 *   runs a command text through the shell /setup runs under
 */

/**
 * A throwaway repository holding copies of the named files from this checkout, removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {{ files?: string[] }} [options]
 * @returns {Fixture}
 */
function fixture(t, { files = [] } = {}) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-setup-')));
  t.after(() => fs.rmSync(T, { recursive: true, force: true }));
  const repo = path.join(T, 'repo');
  const put = (/** @type {string} */ rel, /** @type {string | Buffer} */ text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  for (const rel of files) put(rel, fs.readFileSync(path.join(ROOT, rel)));
  fs.mkdirSync(path.join(T, 'home'));
  fs.mkdirSync(path.join(T, 'tmp'));
  fs.writeFileSync(
    path.join(T, 'gitconfig'),
    '[core]\n\tautocrlf = false\n[user]\n\tname = Owner\n\temail = owner@example.invalid\n'
  );
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (/^GIT_/.test(k) || k === 'CLAUDE_CODE_REMOTE' || k === 'ALEX_TODAY') delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(T, 'gitconfig'),
    HOME: path.join(T, 'home'),
    USERPROFILE: path.join(T, 'home'),
    TMPDIR: path.join(T, 'tmp'),
    TMP: path.join(T, 'tmp'),
    TEMP: path.join(T, 'tmp'),
    [pathKey]: `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`
  });
  const g = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
  fs.mkdirSync(repo, { recursive: true });
  g('init', '-q', '-b', 'main');
  const bash = (/** @type {string} */ script, /** @type {Record<string, string>} */ extra = {}) =>
    spawnSync(BASH, ['-c', script], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });
  return { T, repo, put, env, g, bash };
}

// The doctor's world: one tool, a three-skill lock (gamma parked by the template), the hook file.
/** @param {import('node:test').TestContext} t */
function doctorTree(t) {
  const f = fixture(t, {
    files: [
      'scripts/bootstrap.mjs',
      'scripts/lib/skill-state.js',
      'scripts/lib/json-writer.js',
      'scripts/lib/repo-root.js'
    ]
  });
  const schema = {
    tools: [{ id: 'node', version_args: '--version', required: true, restore: 'install node' }],
    git_expectations: { remote: 'origin' },
    junction_rule: { target_dir: '.agents/skills', link_dir: '.claude/skills' }
  };
  f.put('system/environment-schema.online.json', JSON.stringify(schema));
  f.put('system/environment-schema.json', JSON.stringify(schema));
  f.put('system/manifest.json', JSON.stringify({ projects: [] }));
  f.put('skills-lock.json', JSON.stringify({ version: 1, skills: { alpha: {}, beta: {}, gamma: { parked: true } } }));
  for (const s of ['alpha', 'beta', 'gamma']) f.put(`.agents/skills/${s}/SKILL.md`, `# ${s}\n`);
  f.put('CLAUDE.md', '# a constitution with no Skill Bindings table\n');
  f.put('scripts/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  f.g('remote', 'add', 'origin', 'https://example.invalid/owner/alex');
  return f;
}
const links = (/** @type {string} */ repo) =>
  fs.existsSync(path.join(repo, '.claude', 'skills'))
    ? fs.readdirSync(path.join(repo, '.claude', 'skills')).sort()
    : [];
const maskVersion = (/** @type {string} */ text) =>
  text.replace(/^(\[PASS\] tool {11}node {25})v\d+\.\d+\.\d+$/m, '$1v<node>');

// A ZIP writer, stored entries only: enough for the shapes /setup --import meets.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (/** @type {Buffer} */ b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
/**
 * @param {string} file
 * @param {{ name: string, data?: string }[]} entries
 */
function zip(file, entries) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const en of entries) {
    const name = Buffer.from(en.name, 'utf8');
    const data = Buffer.from(en.data ?? '', 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
}
const FINDER_ZIP = [
  { name: 'alex/' },
  { name: 'alex/soul.md', data: '# Soul\n\n## My Role\nTranslator.\n' },
  { name: 'alex/vault/' },
  { name: 'alex/vault/me/' },
  { name: 'alex/vault/me/goals.md', data: '# Goals\nFinish the deck.\n' },
  { name: '__MACOSX/alex/._soul.md', data: 'x' }
];
// The same memory without the folder entries Finder adds: the tests that are not about the pinned
// Finder-ZIP defect use it, so a fix to that defect flips its own test and no other.
const PLAIN_ZIP = FINDER_ZIP.filter((e) => !e.name.endsWith('/'));
/**
 * @param {import('node:test').TestContext} t
 * @param {{ name: string, data?: string }[]} [entries]
 */
function importTree(t, entries = FINDER_ZIP) {
  const f = fixture(t, {
    files: [
      'scripts/import-memory.mjs',
      'scripts/secret-scan.mjs',
      'scripts/employer-data-guard.mjs',
      'scripts/lib/json-writer.js',
      // import-memory.mjs takes REPO from repo-root.js, subclasses errors.js's Refusal, and parses its
      // command line through args.js; args.js and errors.js both need exit-codes.js as they load.
      'scripts/lib/repo-root.js',
      'scripts/lib/errors.js',
      'scripts/lib/exit-codes.js',
      'scripts/lib/args.js'
    ]
  });
  zip(path.join(f.T, 'tmp', 'alex-import', 'memory.zip'), entries);
  return f;
}

// ------------------------------------------------------------------ the current files still carry them
test('the current command files still carry every frozen command, word for word', () => {
  const online = fs.readFileSync(ONLINE_SETUP, 'utf8').replace(/\r\n/g, '\n');
  for (const k of /** @type {(keyof typeof OLD)[]} */ (['repair', 'importPlan', 'importApply', 'onlineRepairReadBack']))
    assert.ok(online.includes(OLD[k]), `online setup.md no longer carries ${k}`);
  assert.ok(fs.readFileSync(ONLINE_STATUS, 'utf8').includes(OLD.line), 'alex-status.md');
  assert.ok(
    fs.readFileSync(path.join(ROOT, 'scheduler', 'routines', 'brief.md'), 'utf8').includes(OLD.line),
    'brief.md'
  );
  if (IS_KIT) {
    assert.ok(
      fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'setup.md'), 'utf8').includes(OLD.repair),
      'the laptop setup.md'
    );
    assert.ok(fs.readFileSync(path.join(ROOT, 'Install-Alex.command'), 'utf8').includes(OLD.shInstallRepair));
    assert.ok(fs.readFileSync(path.join(ROOT, 'Update-Alex.command'), 'utf8').includes(OLD.shInstallRepair));
    assert.ok(fs.readFileSync(path.join(ROOT, 'Install-Alex.cmd'), 'utf8').includes(OLD.cmdRepair));
    assert.ok(fs.readFileSync(path.join(ROOT, 'Update-Alex.cmd'), 'utf8').includes(OLD.cmdRepair));
  }
});

// ------------------------------------------------------------------ bootstrap --repair-links
test('online setup.md:68: the first repair prints the rows the model quotes, both PASS, exit 0; the links and the hook path are really there', (t) => {
  const f = doctorTree(t);
  const r = f.bash(OLD.repair, { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(
    maskVersion(r.stdout),
    [
      '[INFO] schema         environment-schema.online.json CLAUDE_CODE_REMOTE=true, the cloud schema',
      '[PASS] tool           node                         v<node>',
      '[PASS] links          skill store                  repaired 2 missing + removed 0 parked link(s); 2 awake, 1 parked',
      "[PASS] git            remote 'origin'              configured",
      '[PASS] git            core.hooksPath               scripts/hooks (set and read back)',
      '',
      'bootstrap: environment COMPLETE (0 required items missing)',
      ''
    ].join('\n')
  );
  assert.deepEqual(links(f.repo), ['alpha', 'beta'], 'the awake skills, never the parked one');
  assert.equal(f.g('config', '--get', 'core.hooksPath').stdout.trim(), 'scripts/hooks');
});

test('PINNED DEFECT R4-L23: online setup.md tells the model the skill-store line says "links match"; only a SECOND run says that', (t) => {
  assert.ok(fs.readFileSync(ONLINE_SETUP, 'utf8').includes('the skill store (links match)'));
  const f = doctorTree(t);
  const first = f.bash(OLD.repair, { CLAUDE_CODE_REMOTE: 'true' });
  assert.ok(!first.stdout.includes('links match'), 'the first repair says "repaired ..."');
  const second = f.bash(OLD.repair, { CLAUDE_CODE_REMOTE: 'true' });
  assert.ok(
    second.stdout.includes('[PASS] links          skill store                  2 awake + 1 parked, links match\n')
  );
  assert.ok(
    second.stdout.includes('[PASS] git            core.hooksPath               scripts/hooks (set and read back)\n')
  );
});

test('laptop setup.md:44 and the .command launchers: the same repair on the laptop schema, links made, exit 0, the log written', (t) => {
  const f = doctorTree(t);
  const log = path.join(f.T, 'install-log.txt');
  const r = f.bash(OLD.shInstallRepair, { LOG: log });
  assert.equal(r.status, 0);
  assert.equal(`${r.stdout}${r.stderr}`, '', 'the launcher sends everything to its log');
  assert.match(fs.readFileSync(log, 'utf8'), /^\[INFO\] schema {9}environment-schema\.json {6}the laptop schema\n/);
  assert.deepEqual(links(f.repo), ['alpha', 'beta']);
  assert.ok(
    fs.existsSync(path.join(f.repo, 'outputs', 'logs', 'bootstrap-check.log')),
    "the doctor's own log is in the tree"
  );
});

// ------------------------------------------------------------------ /setup --import
test('PINNED DEFECT R4-L15: online setup.md:422, the dry run on a Finder-style ZIP: the skip lines the owner is shown, one of them nameless, and the last line', (t) => {
  const f = importTree(t);
  const r = f.bash(OLD.importPlan);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(
    r.stdout,
    [
      '  skip   (not soul.md or vault/)',
      '  skip  vault/ (not soul.md or vault/)',
      '  skip  vault/me/ (not soul.md or vault/)',
      '  skip  __MACOSX/alex/._soul.md (macOS resource data)',
      'import-memory: PLAN 2 file(s) to write, nothing written (dry run); 4 skipped, 0 left out, 0 would replace an existing file',
      ''
    ].join('\n')
  );
  assert.ok(
    !fs.existsSync(path.join(f.repo, 'soul.md')) && !fs.existsSync(path.join(f.repo, 'vault')),
    'nothing written'
  );
});

test('online setup.md:422-436 after /setup wrote soul.md: the "replaces" line, the Z7 refusal on --apply, then the WROTE line with --overwrite', (t) => {
  const f = importTree(t, PLAIN_ZIP);
  f.put('soul.md', 'the soul /setup wrote today\n');
  const plan = f.bash(OLD.importPlan);
  assert.equal(plan.status, 0);
  assert.deepEqual(plan.stdout.trim().split('\n').slice(-2), [
    '  replaces an existing file  soul.md',
    'import-memory: PLAN 2 file(s) to write, nothing written (dry run); 1 skipped, 0 left out, 1 would replace an existing file'
  ]);
  const apply = f.bash(OLD.importApply);
  assert.equal(apply.status, 2);
  assert.equal(
    apply.stdout,
    'REFUSED Z7 1 file(s) already exist and would be replaced: soul.md; show the owner this list, and rerun with --overwrite only after they say yes\nimport-memory: REFUSED - nothing was written\n'
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'soul.md'), 'utf8'), 'the soul /setup wrote today\n');
  const over = f.bash(`${OLD.importApply} --overwrite`);
  assert.equal(over.status, 0);
  assert.equal(
    over.stdout.trim().split('\n').pop(),
    'import-memory: WROTE 2 file(s); 1 skipped, 0 left out, 1 would replace an existing file'
  );
  assert.equal(fs.readFileSync(path.join(f.repo, 'soul.md'), 'utf8'), '# Soul\n\n## My Role\nTranslator.\n');
  assert.equal(fs.readFileSync(path.join(f.repo, 'vault', 'me', 'goals.md'), 'utf8'), '# Goals\nFinish the deck.\n');
});

test('online setup.md\'s --skip-flagged sentence: the "left out" line names exactly the flagged file, and the rest is written', (t) => {
  const f = importTree(t);
  const token = ['gh', 'p_', 'B'.repeat(36)].join('');
  zip(path.join(f.T, 'tmp', 'alex-import', 'memory.zip'), [
    { name: 'soul.md', data: '# Soul\n' },
    { name: 'vault/notes.md', data: `old ${token}\n` }
  ]);
  const refused = f.bash(OLD.importApply);
  assert.equal(refused.status, 2);
  assert.equal(
    refused.stdout,
    'REFUSED Z6 vault/notes.md:1 secret-scan github-token\nREFUSED Z6 nothing was written; remove those files from the archive, or rerun with --skip-flagged once the owner agrees to leave exactly these out\nimport-memory: REFUSED - nothing was written\n'
  );
  assert.ok(!refused.stdout.includes(token), 'the value is never printed');
  const r = f.bash(`${OLD.importApply} --skip-flagged`);
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout,
    '  left out (flagged, --skip-flagged)  vault/notes.md\nimport-memory: WROTE 1 file(s); 0 skipped, 1 left out, 0 would replace an existing file\n'
  );
});

// ------------------------------------------------------------------ /alex-status and the brief
test("alex-status.md:11 and brief.md's install-state line: `install-state.js line` prints one sentence, exit 0 (ALEX_TODAY pins the clock)", (t) => {
  const f = fixture(t, {
    files: [
      'scripts/lib/install-state.js',
      'scripts/lib/args.js',
      'scripts/lib/errors.js',
      'scripts/lib/exit-codes.js',
      'scripts/lib/json-writer.js',
      'scripts/lib/repo-root.js'
    ]
  });
  f.put('VERSION', 'Virtual Alex template build 41, 2026-09-24, from Kit commit fd41fcf00000\n');
  /** @param {Record<string, string>} [extra] the environment beside the pinned clock */
  const run = (extra) => f.bash(OLD.line, { ALEX_TODAY: '2026-09-25', ...extra });
  const before = run();
  assert.equal(before.status, 0);
  assert.equal(
    before.stdout,
    'Alex is on template build 41, built 2026-09-24 (1 day ago); this copy has not run /update yet. Type /update to see whether a newer build is waiting.\n'
  );
  const stamp = spawnSync(
    process.execPath,
    [
      '-e',
      "require('./scripts/lib/install-state.js').stamp('.', process.argv[1], {by:'/update', at:'2026-09-24'})",
      `fd41fcf${'0'.repeat(33)}`
    ],
    { cwd: f.repo, encoding: 'utf8', env: f.env }
  );
  assert.equal(stamp.status, 0, stamp.stderr);
  assert.equal(
    run().stdout,
    'Alex is on template build 41, built 2026-09-24 (1 day ago); this copy was updated to it on 2026-09-24 by /update, template commit fd41fcf. Type /update to see whether a newer build is waiting.\n'
  );
});
