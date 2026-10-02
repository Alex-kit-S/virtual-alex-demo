#!/usr/bin/env node
// @ts-check
// scripts/tests/test-update-command-contract.mjs - the commands an owner's OLD /update and the laptop Update-Alex
// launchers run into scripts/lib/template-gate.mjs, scripts/run-migrations.js and scripts/lib/install-state.js,
// frozen word for word and run against THIS code.
//
// WHAT. An owner's /update is read from the update.md their repository ALREADY holds, and then runs the NEW code
// the update brings (step 6 onward runs after `git apply`). A laptop's Update-Alex.cmd or .command is likewise the
// file on their machine running the scripts git just pulled. So these command texts are copied from update.md and
// both launchers as the oldest /update and launchers in the field run them, and each runs here through the shell the owner's side uses, with the
// line its caller reads back asserted exactly:
//   update.md:103    REMOTE="$(node scripts/lib/template-gate.mjs remote)"      one url, or REFUSED + exit 2
//   update.md:113    node scripts/lib/template-gate.mjs ci "$HEAD_T"            "CI green ..." or REFUSED + exit 2
//   update.md:133-134, :162-163   the changelog rows the builder writes, read with sed, git log -S, wc, tail
//   update.md:250    node scripts/run-migrations.js                              everything it prints is quoted
//   update.md:280-281  node -e "...stamp('.', process.argv[1], {by:'/update'})" "$HEAD_T"; git add ...
//   Update-Alex.cmd:125, :137 and Update-Alex.command:124, :133   the runner's exit and the stamp
// Deleted, this file would let a change to those programs break a line an owner's older /update or launcher reads
// back, with every other test green. If a rewrite changes a command in the CURRENT files, the "still carries"
// tests fail and say so; the frozen copies keep running, because the owners who have not updated yet still run
// them.
//
// HOW. A fixture owner repository in the OS temp folder holds COPIES of the code under test and the files it
// reads. gh is a stub on PATH (the gate's one network call), so nothing reaches GitHub. bash is Git's own on
// Windows (ALEX_BASH overrides). No test in this file is a PINNED DEFECT.
// test-update-command-contract-kit.mjs holds the Update-Alex.cmd/.command launchers' own two cases (the
// frozen-text check and the cmd.exe runner), split out when a generated online tree ships neither launcher.
//
// NEVER. Writes inside the repository it runs in. Lets an online /update quote a support-bundle request over migration
// 002's decline by design there: the runner records that decline as not applicable and prints nothing.
//
// Usage: node scripts/tests/test-update-command-contract.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { changelogRow, rowText } from '../build-online-template.mjs';
import { findBash } from './fixtures/find-bash.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { writeJson } = require('../lib/json-writer.js');

// ------------------------------------------------------------------ the frozen command texts
const OLD = {
  updateRemote: 'REMOTE="$(node scripts/lib/template-gate.mjs remote)"',
  updateFetchCi: 'node scripts/lib/template-gate.mjs ci "$HEAD_T"',
  updateLastAt: 'LAST_AT="$(tail -1 system/template-changelog.jsonl | sed \'s/^{"at":"//; s/".*//\')"',
  updateBase:
    'BASE="$(git log refs/alex/template-head --format=%H -S"$LAST_AT" -- system/template-changelog.jsonl | tail -1)"',
  updateNBase: 'N_BASE="$(git show "$BASE":system/template-changelog.jsonl | wc -l | tr -d \' \')"',
  updateNewRows: 'git show refs/alex/template-head:system/template-changelog.jsonl | tail -n +"$((N_BASE + 1))"',
  updateMigrations: 'node scripts/run-migrations.js',
  updateStamp:
    "node -e \"require('./scripts/lib/install-state.js').stamp('.', process.argv[1], {by:'/update'})\" \"$HEAD_T\"",
  updateAdd: 'git add system/install-state.json system/migrations-applied.json',
  cmdStamp:
    'call node -e "require(\'./scripts/lib/install-state.js\').stamp(\'.\', process.argv[1], {by:\'Update-Alex.cmd\', at:process.argv[2]})" "%AFTER%" "%TODAY%" >>"%LOG%" 2>&1',
  shMigrations:
    'node scripts/run-migrations.js >>"$LOG" 2>&1 || echo "  One setup step needs a person; Alex still works." >> "$LOG"',
  shStamp:
    'node -e "require(\'./scripts/lib/install-state.js\').stamp(\'.\', process.argv[1], {by:\'Update-Alex.command\', at:process.argv[2]})" "$AFTER" "$TODAY" >>"$LOG" 2>&1'
};

const BASH = findBash();

// ------------------------------------------------------------------ the fixture owner repository
const SOUL_WITH_RULE =
  '# Soul\n\n## Voice Rules\n### Detection-proofing\n- No colon reveals, no importance puffery, no formatting slop.\n\n## Things I Never Want\nFlattery.\n';
const STUB_GH = `// a stub gh: records its arguments, answers from the environment, never reaches GitHub
const fs = require('fs');
if (process.env.C3_GH_LOG) fs.appendFileSync(process.env.C3_GH_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.C3_GH_STDERR) process.stderr.write(process.env.C3_GH_STDERR);
process.stdout.write(process.env.C3_GH_ANSWER || '');
process.exit(Number(process.env.C3_GH_EXIT || 0));
`;

/**
 * @typedef {object} Owner a fixture owner repository holding copies of the code the frozen commands run
 * @property {string} T the fixture's temp folder
 * @property {string} repo the owner's repository
 * @property {(rel: string, text: string | Buffer) => void} put writes a file into the repository
 * @property {NodeJS.ProcessEnv} env the commands' environment, with the stub gh first on PATH when asked for
 * @property {(...args: string[]) => import('node:child_process').SpawnSyncReturns<string>} g git in the repository
 * @property {(script: string, extra?: Record<string, string>) => { status: number | null, stdout: string, stderr: string, error?: Error }} bash
 *   runs a command text through the shell the owner's side uses
 * @property {(remote: string) => void} source writes system/template-source.json naming remote
 * @property {() => string[][]} ghLog every argument list the stub gh was called with
 */

/**
 * A fresh owner repository with the code under test copied in and soul.md holding the writing rules.
 * @param {import('node:test').TestContext} t
 * @param {{ gh?: boolean }} [options] gh: put the stub gh on PATH
 * @returns {Owner}
 */
function owner(t, { gh = false } = {}) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-upd-')));
  t.after(() => fs.rmSync(T, { recursive: true, force: true }));
  const repo = path.join(T, 'owner');
  const put = (/** @type {string} */ rel, /** @type {string | Buffer} */ text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  for (const rel of [
    'scripts/lib/template-gate.mjs',
    'scripts/lib/json-writer.js',
    'scripts/lib/install-state.js',
    'scripts/lib/repo-root.js',
    'scripts/run-migrations.js',
    // run-migrations.js now reads the ledger through migration-ledger.js and parses its command line
    // through args.js, which needs errors.js and exit-codes.js as it loads.
    'scripts/lib/migration-ledger.js',
    'scripts/lib/args.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js',
    'scripts/migrations/001-structural-voice-tells.js',
    'scripts/migrations/002-install-state-seed.js'
  ]) {
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  put('soul.md', SOUL_WITH_RULE);
  fs.writeFileSync(
    path.join(T, 'gitconfig'),
    '[core]\n\tautocrlf = false\n[user]\n\tname = Owner\n\temail = owner@example.invalid\n'
  );
  // The stub gh, for the tests that reach it: a shell script on POSIX, node.exe itself as gh.exe on Windows
  // (the gate spawns gh with no shell, and Windows finds only .exe that way), which then runs the file
  // named `api` from the cwd. Made only when asked: on Windows it is a copy of node.exe.
  const bin = path.join(T, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(T, 'gh-stub.js'), STUB_GH);
  if (!gh) {
    /* no gh on this fixture's own PATH entry */
  } else if (process.platform === 'win32') {
    try {
      fs.linkSync(process.execPath, path.join(bin, 'gh.exe'));
    } catch {
      fs.copyFileSync(process.execPath, path.join(bin, 'gh.exe'));
    }
    put('api', STUB_GH);
  } else {
    fs.writeFileSync(
      path.join(bin, 'gh'),
      `#!/bin/sh\nexec "${process.execPath}" "${path.join(T, 'gh-stub.js')}" "$@"\n`
    );
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  }
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k) || k === 'CLAUDE_CODE_REMOTE') delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(T, 'gitconfig'),
    [pathKey]: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`,
    C3_GH_LOG: path.join(T, 'gh-log.jsonl')
  });
  const g = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
  g('init', '-q', '-b', 'main');
  const bash = (/** @type {string} */ script, /** @type {Record<string, string>} */ extra = {}) => {
    const r = spawnSync(BASH, ['-c', script], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
  };
  const source = (/** @type {string} */ remote) =>
    writeJson(
      path.join(repo, 'system', 'template-source.json'),
      { template_remote: remote },
      {
        purpose: 'fixture',
        writer: 'scripts/build-online-template.mjs',
        schema: 'template-source@1',
        generatedAt: '2026-09-24T00:00:00Z'
      }
    );
  return {
    T,
    repo,
    put,
    env,
    g,
    bash,
    source,
    ghLog: () =>
      fs.existsSync(/** @type {string} */ (env.C3_GH_LOG))
        ? fs
            .readFileSync(/** @type {string} */ (env.C3_GH_LOG), 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l))
        : []
  };
}
const record = (/** @type {string} */ repo) =>
  JSON.parse(fs.readFileSync(path.join(repo, 'system', 'install-state.json'), 'utf8'));
const SHA_T = '0123456789abcdef0123456789abcdef01234567';

// ------------------------------------------------------------------ the current files still carry them
test('the current update.md still carries every frozen /update command, word for word', () => {
  const text = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'update.md'), 'utf8');
  for (const k of /** @type {(keyof typeof OLD)[]} */ (Object.keys(OLD).filter((k) => k.startsWith('update'))))
    assert.ok(text.includes(OLD[k]), `update.md no longer carries ${k}: ${OLD[k]}`);
});

// ------------------------------------------------------------------ step 2: the gate
test('update.md:103 REMOTE="$(... remote)": exactly the url, exit 0, nothing on stderr', (t) => {
  const o = owner(t);
  o.source('https://github.com/Example-Org/virtual-alex.git/');
  const r = o.bash(`${OLD.updateRemote}; rc=$?; printf 'REMOTE=[%s] rc=%s\\n' "$REMOTE" "$rc"`);
  assert.equal(r.stdout, 'REMOTE=[https://github.com/Example-Org/virtual-alex] rc=0\n');
  assert.equal(r.stderr, '');
});

test('update.md:103 on a tree with no source: no url, exit 2, one REFUSED line on stderr for the model to quote', (t) => {
  const o = owner(t);
  const r = o.bash(`${OLD.updateRemote}; rc=$?; printf 'REMOTE=[%s] rc=%s\\n' "$REMOTE" "$rc"`);
  assert.equal(r.stdout, 'REMOTE=[] rc=2\n');
  assert.equal(
    r.stderr,
    'template-gate: REFUSED - system/template-source.json is missing, so I do not know which template this Alex updates from. Nothing has changed. Send this line to whoever maintains the template.\n'
  );
});

test('update.md:113 ci "$HEAD_T" on a green head: the one line the model quotes, exit 0, one gh call of the pinned shape', (t) => {
  const o = owner(t, { gh: true });
  o.source('https://github.com/Example-Org/virtual-alex');
  const answer = JSON.stringify({
    check_runs: [
      {
        id: 7,
        name: 'portable-tests',
        head_sha: SHA_T,
        status: 'completed',
        conclusion: 'success',
        details_url: 'https://github.com/Example-Org/virtual-alex/actions/runs/7/job/1'
      }
    ]
  });
  const r = o.bash(`${OLD.updateFetchCi}; echo "rc=$?"`, { HEAD_T: SHA_T, C3_GH_ANSWER: answer });
  assert.equal(
    r.stdout,
    `CI green on the template head ${SHA_T.slice(0, 12)}: https://github.com/Example-Org/virtual-alex/actions/runs/7/job/1\nrc=0\n`
  );
  assert.equal(r.stderr, '');
  const calls = o.ghLog();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][calls[0].length - 1],
    `repos/Example-Org/virtual-alex/commits/${SHA_T}/check-runs?check_name=portable-tests&per_page=100`
  );
});

test('update.md:113 ci "$HEAD_T" on a red head: exit 2 and one REFUSED line naming the run', (t) => {
  const o = owner(t, { gh: true });
  o.source('https://github.com/Example-Org/virtual-alex');
  const answer = JSON.stringify({
    check_runs: [
      {
        id: 8,
        name: 'portable-tests',
        head_sha: SHA_T,
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/x/runs/8'
      }
    ]
  });
  const r = o.bash(`${OLD.updateFetchCi}; echo "rc=$?"`, { HEAD_T: SHA_T, C3_GH_ANSWER: answer });
  assert.equal(r.stdout, 'rc=2\n');
  assert.equal(
    r.stderr,
    `template-gate: REFUSED - the template head ${SHA_T.slice(0, 12)} FAILED its tests (failure, https://github.com/x/runs/8), so I will not apply it. Nothing has changed. Send this line to whoever maintains the template.\n`
  );
});

// ------------------------------------------------------------------ step 3 and 4 read what the builder writes
test("update.md:133-134 and :162-163 read the builder's own row lines: LAST_AT, BASE, and exactly the newer rows", (t) => {
  const o = owner(t);
  const rows = [1, 2, 3].map((b) =>
    rowText({
      ...changelogRow({
        kitCommit: String(b).repeat(40),
        kitDirty: false,
        previous: b === 1 ? null : 'p',
        files: 10,
        changed: [String(b)],
        flagged: [],
        build: b
      }),
      at: `2026-09-2${b}T10:00:0${b}Z`
    })
  );
  const tpl = path.join(o.T, 'template');
  const tg = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: tpl, encoding: 'utf8', env: o.env });
  fs.mkdirSync(tpl);
  tg('init', '-q', '-b', 'main');
  const shas = [];
  for (let i = 0; i < rows.length; i++) {
    fs.mkdirSync(path.join(tpl, 'system'), { recursive: true });
    fs.writeFileSync(path.join(tpl, 'system', 'template-changelog.jsonl'), `${rows.slice(0, i + 1).join('\n')}\n`);
    tg('add', '-A');
    tg('commit', '-q', '-m', `build ${i + 1}`);
    shas.push(tg('rev-parse', 'HEAD').stdout.trim());
  }
  // The owner's tree was born from build 2: its jsonl holds two rows.
  o.put('system/template-changelog.jsonl', `${rows.slice(0, 2).join('\n')}\n`);
  o.g('fetch', '-q', tpl, 'main:refs/alex/template-head');
  const r = o.bash(
    [
      OLD.updateLastAt,
      OLD.updateBase,
      'echo "LAST_AT=$LAST_AT"',
      'echo "BASE=$BASE"',
      OLD.updateNBase,
      'echo "N_BASE=$N_BASE"',
      OLD.updateNewRows
    ].join('\n')
  );
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, `LAST_AT=2026-09-22T10:00:02Z\nBASE=${shas[1]}\nN_BASE=2\n${rows[2]}\n`);
});

// ------------------------------------------------------------------ step 6: the runner, quoted
test('update.md:250 online: migration 002 is recorded as not-applicable and nothing asks for a support bundle, on the first run or any later one', (t) => {
  const o = owner(t);
  const first = o.bash(`${OLD.updateMigrations}; echo "rc=$?"`, { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(first.stdout, ['  the writing rules are already there.', 'rc=0', ''].join('\n'));
  assert.equal(first.stderr, '');
  const second = o.bash(`${OLD.updateMigrations}; echo "rc=$?"`, { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(
    second.stdout,
    ['Nothing new to set up.', 'rc=0', ''].join('\n'),
    'the second /update has nothing to quote'
  );
  const ledger = JSON.parse(fs.readFileSync(path.join(o.repo, 'system', 'migrations-applied.json'), 'utf8'));
  assert.deepEqual(
    ledger.applied.map((/** @type {{ id: string, status: string }} */ a) => `${a.id}/${a.status}`),
    ['001-structural-voice-tells/skipped', '002-install-state-seed/not-applicable'],
    '002 is recorded online, as not applicable'
  );
  assert.ok(
    !fs.existsSync(path.join(o.repo, 'system', 'install-state.json')),
    '002 wrote no version record: /update step 7 writes the real one'
  );
});

// ------------------------------------------------------------------ step 7: the stamp and the add
test('update.md:280-281 the stamp: nothing printed, exit 0, the record written with by=/update, and both files git-add cleanly', (t) => {
  const o = owner(t);
  assert.equal(o.bash(OLD.updateMigrations, { CLAUDE_CODE_REMOTE: 'true' }).status, 0);
  const r = o.bash(`${OLD.updateStamp}\necho "rc=$?"\n${OLD.updateAdd}\necho "add=$?"`, { HEAD_T: SHA_T });
  assert.equal(r.stdout, 'rc=0\nadd=0\n');
  assert.equal(r.stderr, '');
  const rec = record(o.repo);
  assert.deepEqual(Object.keys(rec), [
    '_generated_at',
    '_purpose',
    '_schema',
    '_writer',
    'previous_template_commit',
    'stamped_by',
    'template_commit',
    'template_updated_at'
  ]);
  assert.deepEqual(
    { ...rec, _generated_at: 'X', template_updated_at: 'D' },
    {
      _generated_at: 'X',
      _purpose: 'Which template version this copy carries, and when it got there.',
      _schema: 'install-state@1',
      _writer: 'scripts/lib/install-state.js',
      previous_template_commit: null,
      stamped_by: '/update',
      template_commit: SHA_T,
      template_updated_at: 'D'
    }
  );
  assert.match(rec.template_updated_at, /^\d{4}-\d{2}-\d{2}$/, 'today, as the code chose it (UTC)');
  assert.equal(
    o.g('diff', '--cached', '--name-only').stdout,
    'system/install-state.json\nsystem/migrations-applied.json\n'
  );
});

test('update.md:280 a second /update moves the old commit to previous_template_commit', (t) => {
  const o = owner(t);
  o.bash(OLD.updateStamp, { HEAD_T: 'a'.repeat(40) });
  o.bash(OLD.updateStamp, { HEAD_T: SHA_T });
  assert.equal(record(o.repo).previous_template_commit, 'a'.repeat(40));
  assert.equal(record(o.repo).template_commit, SHA_T);
});

test('update.md:280 with an empty HEAD_T: exit 1, the refusal on stderr, and no record written', (t) => {
  const o = owner(t);
  const r = o.bash(`${OLD.updateStamp}; echo "rc=$?"`, { HEAD_T: '' });
  assert.match(r.stdout, /^rc=1\n$/);
  assert.match(r.stderr, /install-state: "" is not a commit sha; nothing written/);
  assert.ok(!fs.existsSync(path.join(o.repo, 'system', 'install-state.json')));
});

// ------------------------------------------------------------------ the laptop launchers
test("Update-Alex.command:133 the stamp through bash: by=Update-Alex.command and the launcher's own date, nothing but the log touched", (t) => {
  const o = owner(t);
  const log = path.join(o.T, 'update-log.txt');
  const r = o.bash(OLD.shStamp, { AFTER: SHA_T, TODAY: '2026-09-24', LOG: log });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(`${r.stdout}${r.stderr}`, '');
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'a good stamp writes nothing to the log');
  const rec = record(o.repo);
  assert.deepEqual(
    [rec.stamped_by, rec.template_commit, rec.template_updated_at],
    ['Update-Alex.command', SHA_T, '2026-09-24']
  );
});

test("Update-Alex.cmd:137 the stamp: by=Update-Alex.cmd and the launcher's date (through cmd.exe on Windows, the same JavaScript elsewhere)", (t) => {
  const o = owner(t);
  const log = path.join(o.T, 'update-log.txt');
  if (process.platform === 'win32') {
    const r = spawnSync('cmd.exe', ['/d', '/v:on', '/s', '/c', `"${OLD.cmdStamp}"`], {
      cwd: o.repo,
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      env: { ...o.env, AFTER: SHA_T, TODAY: '2026-09-24', LOG: log }
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), '');
  } else {
    const js = /** @type {RegExpMatchArray} */ (OLD.cmdStamp.match(/node -e "([^"]+)"/))[1];
    assert.ok(!/[$%`\\!]/.test(js), 'the script text holds nothing either shell would expand');
    const r = spawnSync(process.execPath, ['-e', js, SHA_T, '2026-09-24'], {
      cwd: o.repo,
      encoding: 'utf8',
      env: o.env
    });
    assert.equal(r.status, 0, r.stderr);
  }
  const rec = record(o.repo);
  assert.deepEqual(
    [rec.stamped_by, rec.template_commit, rec.template_updated_at],
    ['Update-Alex.cmd', SHA_T, '2026-09-24']
  );
});

test('Update-Alex.command:124 the runner exits 0 on a laptop, so the "needs a person" line is never logged for a handled step', (t) => {
  const o = owner(t);
  o.g('add', '-A');
  o.g('commit', '-q', '-m', 'a laptop checkout');
  const log = path.join(o.T, 'update-log.txt');
  const r = o.bash(OLD.shMigrations, { LOG: log });
  assert.equal(r.status, 0);
  const head = o.g('rev-parse', 'HEAD').stdout.trim();
  assert.equal(
    fs.readFileSync(log, 'utf8'),
    [
      '  the writing rules are already there.',
      `    version record seeded at ${head.slice(0, 12)}`,
      '  Alex can now answer "am I up to date?" without reading git.',
      ''
    ].join('\n')
  );
  assert.equal(record(o.repo).stamped_by, '002-install-state-seed');
});
