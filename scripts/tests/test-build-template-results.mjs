#!/usr/bin/env node
// scripts/tests/test-build-template-results.mjs - what scripts/build-online-template.mjs prints, writes and
// leaves behind on a real build, pinned as the contract its readers depend on.
//
// WHAT. The builder is read by BEHAVIOUR as much as by import:
//   - scripts/new-virtual-alex.mjs parses its stdout with three regexes (:480 PUSHED, :481 nothing to push,
//     :489 CHECK OK, the last on stdout alone) and filters a failure with /CHECK FAILED|REFUSED|drift:/ (:458);
//   - it reads the build directory as a non-shallow clone whose HEAD is the pushed main (realSeedHistory,
//     :231-245);
//   - every owner tree reads the three files the build generates: VERSION (install-state.js's
//     VERSION_BUILD regex), system/template-source.json (template-gate.mjs's readTemplateSource) and
//     CHANGELOG.md (test-changelog.mjs C8);
//   - /update seds the changelog row line (update.md:133) and counts rows (:162-163).
// This file runs the REAL builder end to end and holds each of those, plus the refusals no test reached
// (the write lock, the git identity, --check on an empty remote).
//
// HOW. A MINIATURE KIT is built in the OS temp directory for every test: the builder and the three
// libraries it loads are COPIED from this checkout (so the code under test is exactly this tree's),
// beside a twelve-file tree, a manifest that claims it, and a two-row changelog. Its remote is a bare
// repository in the same temp folder. The donor scanner (scripts/clone-scrub-check.js, a drop row
// online, and a scanner of one person's identity) is replaced by a TEST DOUBLE that finds nothing
// unless a test asks it to: the real scanner's integration is held by test-build-online-template.mjs B0
// and test-clone-scrub-scope.mjs, and a double keeps these legs deterministic and runnable in any tree.
// No network, no real remote.
//
// NEVER. Never writes inside the repository it runs in, never pushes anywhere but a bare repository it
// created, never reads the real template.
//
// Usage: node scripts/tests/test-build-template-results.mjs
// Exit: 0 every assertion held - 1 one failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GENERIC = 'https://github.com/Alex-kit-S/virtual-alex';
const TEMPLATE_URL = 'https://github.com/example/virtual-alex';

// The four regexes and the failure filter as scripts/new-virtual-alex.mjs holds them.
const FLEET = {
  pushed: /PUSHED \S+ main = ([0-9a-f]{40})/,
  idle: /nothing to push: .* main ([0-9a-f]{40})/,
  checkOk: /CHECK OK: .* main ([0-9a-f]{40})/,
  failure: /CHECK FAILED|REFUSED|drift:/
};

// ------------------------------------------------------------------ the miniature Kit
function gitEnv(home) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig') };
}

const MANIFEST = {
  components: [
    { id: 'constitution', online: 'variant', paths: ['CLAUDE.md'] },
    { id: 'scripts', online: 'ship', paths: ['scripts/'] },
    { id: 'docs', online: 'ship', paths: ['docs/'] },
    { id: 'launchers', online: 'drop', paths: ['Install-Alex.cmd'] },
    { id: 'variants', online: 'drop', paths: ['variants/'] },
    { id: 'system', online: 'ship', paths: ['system/kit-manifest.json', 'system/template-changelog.jsonl'] },
    { id: 'meta', online: 'ship', paths: ['.gitignore'] },
    { id: 'generated', online: 'drop', paths: ['CHANGELOG.md', 'VERSION', 'system/template-source.json'] },
    { id: 'seed', online: 'ship', paths: ['starter/', 'HOW-SHARING-WORKS.md', 'WHAT-ALEX-CAN-DO.md'] }
  ]
};
const ROW1 =
  '{"at":"2026-01-01T10:00:00Z","changed":5,"files":5,"flagged":["CLAUDE.md"],"kit_commit":"1111111111111111111111111111111111111111","kit_dirty":false,"previous_template_commit":null}';
const ROW2 =
  '{"at":"2026-01-02T11:30:00Z","build":2,"changed":1,"files":5,"flagged":[],"kit_commit":"2222222222222222222222222222222222222222","kit_dirty":false,"previous_template_commit":"3333333333333333333333333333333333333333"}';

const SCANNER_DOUBLE = `'use strict';
// A test double for scripts/clone-scrub-check.js. Finds nothing, unless C3_SCRUB_FAIL_ON_CALL
// names the call (counted in the file C3_SCRUB_COUNTER) on which it must report one planted hit.
const fs = require('fs');
function scan() {
  let n = 1;
  const counter = process.env.C3_SCRUB_COUNTER;
  if (counter) { n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1; fs.writeFileSync(counter, String(n)); }
  if (Number(process.env.C3_SCRUB_FAIL_ON_CALL) === n) return [{ cat: 'donor-name', file: 'docs/guide.md', line: 1, text: 'a planted hit' }];
  return [];
}
module.exports = { scan };
`;

function miniKit(t) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-bt-')));
  t.after(() => fs.rmSync(T, { recursive: true, force: true }));
  const home = path.join(T, 'home');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, 'gitconfig'), '[core]\n\tautocrlf = false\n');
  const env = gitEnv(home);
  const kit = path.join(T, 'kit');
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
    fs.writeFileSync(path.join(kit, rel), text);
  };
  for (const rel of [
    'scripts/build-online-template.mjs',
    'scripts/lib/write-lock.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/render-changelog.mjs',
    'scripts/lib/manifest-claim.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js',
    'scripts/lib/repo-root.js'
  ]) {
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  put('scripts/clone-scrub-check.js', SCANNER_DOUBLE);
  put('scripts/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  // Executable on disk too: where core.filemode is true (Linux, macOS) a 0644 working copy of a 100755
  // blob reads as a mode change, and `commit -a` would commit it.
  fs.chmodSync(path.join(kit, 'scripts', 'hooks', 'pre-commit'), 0o755);
  put('CLAUDE.md', '# the laptop constitution\n');
  put('variants/online/CLAUDE.md', '# the online constitution\n');
  put('docs/guide.md', '# guide\n\nline one\n');
  put('Install-Alex.cmd', '@echo off\r\n');
  put('.gitignore', '.alex-lock-*/\n');
  put('system/kit-manifest.json', `${JSON.stringify(MANIFEST, null, 2)}\n`);
  put('system/template-changelog.jsonl', `${ROW1}\n${ROW2}\n`);
  const g = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env });
  const must = (cwd, ...args) => {
    const r = g(cwd, ...args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  must(kit, 'init', '-q', '-b', 'main');
  must(kit, 'config', 'user.name', 'Kit Maintainer');
  must(kit, 'config', 'user.email', 'maintainer@example.invalid');
  must(kit, 'add', '-A');
  must(kit, 'update-index', '--chmod=+x', 'scripts/hooks/pre-commit');
  must(kit, 'commit', '-q', '-m', 'the miniature Kit');
  const bare = (name) => {
    const b = path.join(T, name);
    must(T, 'init', '-q', '--bare', b);
    must(b, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    return b;
  };
  const remote = bare('template.git');
  const build = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [path.join(kit, 'scripts', 'build-online-template.mjs'), ...args], {
      cwd: kit,
      encoding: 'utf8',
      env: { ...env, ...extraEnv }
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, text: `${r.stdout}${r.stderr}` };
  };
  return { T, kit, remote, env, g, must, bare, build, put, out: path.join(T, 'build') };
}

const firstPush = (k, extra = []) =>
  k.build(['--push', '--remote', k.remote, '--out', k.out, '--template-remote', TEMPLATE_URL, ...extra]);
const commitRow = (k) => k.must(k.kit, 'commit', '-q', '-m', 'the build row', '--', 'system/template-changelog.jsonl');

// ------------------------------------------------------------------ the result lines the fleet script parses
test('a first --push prints the PUSHED line new-virtual-alex.mjs parses, and the sha is the remote main', (t) => {
  const k = miniKit(t);
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  const m = r.stdout.match(FLEET.pushed);
  assert.ok(m, r.stdout);
  const remoteMain = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  assert.equal(m[1], remoteMain);
  const line = r.stdout.split('\n').find((l) => l.includes('PUSHED'));
  assert.equal(
    line,
    `build-online-template: PUSHED ${k.remote} main = ${remoteMain} (read back with git ls-remote: ${remoteMain})`
  );
  assert.equal(r.stderr, '', 'a successful build writes nothing on stderr');
});

test('--check against the pushed main prints CHECK OK on STDOUT with that sha (new-virtual-alex reads stdout alone for it)', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  const r = k.build(['--check', '--remote', k.remote, '--out', k.out, '--template-remote', TEMPLATE_URL]);
  assert.equal(r.status, 0, r.text);
  const main = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  assert.equal((r.stdout.match(FLEET.checkOk) || [])[1], main);
  assert.ok(
    r.stdout.includes(`build-online-template: CHECK OK: the generated tree is identical to ${k.remote} main ${main}\n`)
  );
  assert.ok(!FLEET.failure.test(r.text), 'no line the failure filter would keep');
});

test('--push with nothing new prints the idle line new-virtual-alex.mjs parses, exit 0, and writes no row', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  const rows = fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8');
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  const main = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  assert.equal((r.stdout.match(FLEET.idle) || [])[1], main);
  assert.ok(
    r.stdout.includes(
      `build-online-template: nothing to push: the generated tree is identical to ${k.remote} main ${main}\n`
    )
  );
  assert.equal(fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8'), rows);
});

test('drift: --check names each path, then refuses CHECK FAILED on stderr with exit 2; the fleet filter keeps exactly those lines', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  const main = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  k.put('docs/guide.md', '# guide\n\nline one, changed\n');
  k.must(k.kit, 'commit', '-q', '-am', 'a committed change');
  const r = k.build(['--check', '--remote', k.remote, '--out', k.out, '--template-remote', TEMPLATE_URL]);
  assert.equal(r.status, 2, r.text);
  assert.ok(r.stdout.includes('build-online-template:   drift: docs/guide.md\n'), r.stdout);
  assert.equal(
    r.stderr,
    `build-online-template: REFUSED - CHECK FAILED: 1 path(s) differ from ${k.remote} main ${main}\n`
  );
  const kept = r.text.split('\n').filter((l) => FLEET.failure.test(l));
  assert.deepEqual(kept, [
    'build-online-template:   drift: docs/guide.md',
    `build-online-template: REFUSED - CHECK FAILED: 1 path(s) differ from ${k.remote} main ${main}`
  ]);
  // The build directory is left with the drift STAGED (a --push would have committed it).
  assert.equal(k.must(k.out, 'diff', '--cached', '--name-only').trim(), 'docs/guide.md');
});

test('--check against an empty remote refuses: drift by definition', (t) => {
  const k = miniKit(t);
  const r = k.build(['--check', '--remote', k.remote, '--out', k.out, '--template-remote', TEMPLATE_URL]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, `build-online-template: REFUSED - ${k.remote} has no main yet: drift by definition\n`);
  assert.ok(r.stdout.includes('remote main none (first build)'), r.stdout);
});

// ------------------------------------------------------------------ the three generated files
test("VERSION is one line naming the build, its UTC day and the Kit commit (the shape install-state.js's VERSION_BUILD regex reads)", (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  const row = JSON.parse(
    fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8').trim().split('\n').pop()
  );
  const kitCommit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  const version = k.must(k.remote, 'show', 'main:VERSION');
  assert.equal(
    version,
    `Virtual Alex template build 3, ${row.at.slice(0, 10)}, from Kit commit ${kitCommit.slice(0, 12)}\n`
  );
  assert.match(version, /build (\d+), (\d{4}-\d{2}-\d{2})/, 'install-state.js describe() regex');
});

test('system/template-source.json: the JSON writer shape, the fixed purpose, the normalised --template-remote', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k, ['--template-remote', `${TEMPLATE_URL}.git/`]).status, 0);
  const text = k.must(k.remote, 'show', 'main:system/template-source.json');
  const j = JSON.parse(text);
  assert.deepEqual(Object.keys(j), ['_generated_at', '_purpose', '_schema', '_writer', 'template_remote']);
  assert.match(j._generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(
    text,
    `{\n  "_generated_at": "${j._generated_at}",\n  "_purpose": "The template /update fetches from and checks CI on. Written by every template and seed build; a seed names the generic template, because owners update from the template and never from their seed.",\n  "_schema": "template-source@1",\n  "_writer": "scripts/build-online-template.mjs",\n  "template_remote": "${TEMPLATE_URL}"\n}\n`
  );
});

test('template-source keeps its _generated_at across a rebuild while the remote is unchanged', async (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  const before = JSON.parse(k.must(k.remote, 'show', 'main:system/template-source.json'))._generated_at;
  k.put('docs/guide.md', '# guide\n\nline two\n');
  k.must(k.kit, 'commit', '-q', '-am', 'a change');
  // A second later at least, so a fresh stamp would differ.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  assert.equal(JSON.parse(k.must(k.remote, 'show', 'main:system/template-source.json'))._generated_at, before);
});

test('without --template-remote a template build names its own --remote, normalised (a trailing slash and ".git" are cut, even from a local path)', (t) => {
  const k = miniKit(t);
  const r = k.build(['--push', '--remote', `${k.remote}/`, '--out', k.out]);
  assert.equal(r.status, 0, r.text);
  assert.equal(
    JSON.parse(k.must(k.remote, 'show', 'main:system/template-source.json')).template_remote,
    k.remote.replace(/\.git$/, '')
  );
});

test("CHANGELOG.md is the render of the tree's jsonl, newest first, with the fixed introduction", (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  const row = JSON.parse(
    fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8').trim().split('\n').pop()
  );
  const md = k.must(k.remote, 'show', 'main:CHANGELOG.md');
  const hhmm = row.at.slice(11, 16);
  assert.equal(
    md,
    [
      '# Changelog',
      '',
      'Every build of the Virtual Alex template, newest first. This file is generated from',
      '`system/template-changelog.jsonl` each time the template is built, so it always agrees with',
      'that file. Do not edit it by hand: CI compares the two and fails on any difference.',
      '',
      'Sensitive files are the ones that change how Alex behaves: settings, commands, hooks and their',
      'libraries, workflows, Routine orders and `CLAUDE.md`. `/update` names them before it asks for',
      'your yes.',
      '',
      `## Build 3 (${row.at.slice(0, 10)} ${hhmm} UTC)`,
      '',
      `- The first build: ${row.files} files.`,
      `- Sensitive files: ${row.flagged.map((p) => `\`${p}\``).join(', ')}.`,
      `- Built from Kit commit \`${row.kit_commit.slice(0, 12)}\`.`,
      '',
      '## Build 2 (2026-01-02 11:30 UTC)',
      '',
      '- 1 of 5 files changed.',
      '- Sensitive files: none.',
      '- Built from Kit commit `222222222222`.',
      '',
      '## Build 1 (2026-01-01 10:00 UTC)',
      '',
      '- The first build: 5 files.',
      '- Sensitive files: `CLAUDE.md`.',
      '- Built from Kit commit `111111111111`.',
      ''
    ].join('\n')
  );
});

test('what ships: ship rows copy, drop rows vanish, the variant lands at its real path, the three generated files join', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  const files = k.must(k.remote, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n');
  assert.deepEqual(files, [
    '.gitignore',
    'CHANGELOG.md',
    'CLAUDE.md',
    'VERSION',
    'docs/guide.md',
    'scripts/build-online-template.mjs',
    'scripts/clone-scrub-check.js',
    'scripts/hooks/pre-commit',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/manifest-claim.js',
    'scripts/lib/render-changelog.mjs',
    'scripts/lib/repo-root.js',
    'scripts/lib/write-lock.js',
    'system/kit-manifest.json',
    'system/template-changelog.jsonl',
    'system/template-source.json'
  ]);
  assert.equal(k.must(k.remote, 'show', 'main:CLAUDE.md'), '# the online constitution\n');
  assert.match(
    k.must(k.remote, 'ls-tree', 'main', 'scripts/hooks/pre-commit'),
    /^100755 /,
    'the Kit executable bit arrives'
  );
});

test('the progress lines a first build prints, in order (ABSENT reports, plan, rendered, donor scrub, build dir)', (t) => {
  const k = miniKit(t);
  const r = firstPush(k);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, 11), [
    'build-online-template: ABSENT drop path CHANGELOG.md (row "generated"): listed, not tracked here, nothing to drop',
    'build-online-template: ABSENT drop path VERSION (row "generated"): listed, not tracked here, nothing to drop',
    'build-online-template: ABSENT drop path system/template-source.json (row "generated"): listed, not tracked here, nothing to drop',
    'build-online-template: ABSENT ship path starter/ (row "seed"): listed, not tracked here, nothing to ship',
    'build-online-template: ABSENT ship path HOW-SHARING-WORKS.md (row "seed"): listed, not tracked here, nothing to ship',
    'build-online-template: ABSENT ship path WHAT-ALEX-CAN-DO.md (row "seed"): listed, not tracked here, nothing to ship',
    'build-online-template: plan: 14 ship, 1 variant, 1 dropped, 0 link(s) skipped; 15 file(s) in the online tree',
    `build-online-template: rendered CHANGELOG.md, VERSION, system/template-source.json (the changelog and the version from the tree's jsonl; the template source names ${TEMPLATE_URL})`,
    "build-online-template: donor scrub: CLEAN over the staged tree (the Kit's clone-scrub patterns and allowlist; the online tree carries neither)",
    `build-online-template: build dir ${k.out}; remote main none (first build); 18 path(s) differ; privileged: CLAUDE.md, scripts/hooks/pre-commit, scripts/lib/errors.js, scripts/lib/exit-codes.js, scripts/lib/json-writer.js, scripts/lib/manifest-claim.js, scripts/lib/render-changelog.mjs, scripts/lib/repo-root.js, scripts/lib/write-lock.js`,
    lines[10]
  ]);
  assert.match(
    lines[10],
    /^build-online-template: changelog row appended to system\/template-changelog\.jsonl and staged in the Kit: \{"at":"/
  );
});

// ------------------------------------------------------------------ the changelog row
test('a generic push appends ONE row: one LF-terminated line, keys in canonical order, "at" first for /update\'s sed', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  const text = fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8');
  assert.ok(text.startsWith(`${ROW1}\n${ROW2}\n`), 'the committed rows are kept byte for byte');
  const tail = text.slice(`${ROW1}\n${ROW2}\n`.length);
  assert.match(tail, /^\{[^\n]*\}\n$/, 'exactly one new line');
  const row = JSON.parse(tail);
  assert.deepEqual(Object.keys(row), [
    'at',
    'build',
    'changed',
    'files',
    'flagged',
    'kit_commit',
    'kit_dirty',
    'previous_template_commit'
  ]);
  assert.match(row.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.deepEqual(
    {
      build: row.build,
      changed: row.changed,
      files: row.files,
      kit_dirty: row.kit_dirty,
      previous_template_commit: row.previous_template_commit
    },
    { build: 3, changed: 18, files: 18, kit_dirty: false, previous_template_commit: null }
  );
  assert.deepEqual(row.flagged, [
    'CLAUDE.md',
    'scripts/hooks/pre-commit',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/manifest-claim.js',
    'scripts/lib/render-changelog.mjs',
    'scripts/lib/repo-root.js',
    'scripts/lib/write-lock.js'
  ]);
  assert.equal(row.kit_commit, k.must(k.kit, 'rev-parse', 'HEAD').trim());
  assert.equal(tail.replace(/^\{"at":"/, '').replace(/".*/s, ''), row.at, 'update.md:133 sed recovers "at"');
  // The same bytes ship in the template.
  assert.equal(k.must(k.remote, 'show', 'main:system/template-changelog.jsonl'), text);
});

test("the row is written into the Kit AND staged there (the Kit's next commit carries it); nothing else is staged", (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  assert.equal(k.must(k.kit, 'status', '--porcelain', '--untracked-files=no'), 'M  system/template-changelog.jsonl\n');
});

test('a later push: "changed" counts the paths that differ BEFORE the row is added (the commit also carries the row\'s own three files), previous_template_commit is the old main', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  const prev = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  k.put('docs/guide.md', '# guide\n\nline three\n');
  k.must(k.kit, 'commit', '-q', '-am', 'a change');
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  const row = JSON.parse(
    fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8').trim().split('\n').pop()
  );
  assert.deepEqual(
    {
      build: row.build,
      changed: row.changed,
      files: row.files,
      flagged: row.flagged,
      previous: row.previous_template_commit
    },
    { build: 4, changed: 1, files: 18, flagged: [], previous: prev }
  );
  const kit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  assert.equal(
    k.must(k.remote, 'log', '-1', '--format=%s', 'main').trim(),
    `Virtual Alex template build 4 from kit ${kit.slice(0, 12)}: 1 path(s) changed; flagged: none`
  );
  assert.deepEqual(k.must(k.remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'main').trim().split('\n'), [
    'CHANGELOG.md',
    'VERSION',
    'docs/guide.md',
    'system/template-changelog.jsonl'
  ]);
  assert.equal(
    k.must(k.remote, 'log', '-1', '--format=%an <%ae>', 'main').trim(),
    'Kit Maintainer <maintainer@example.invalid>',
    "committed as the Kit's identity"
  );
});

// ------------------------------------------------------------------ the build directory contract
test('after --push the build directory is a non-shallow clone whose HEAD is the pushed main (realSeedHistory reads it)', (t) => {
  const k = miniKit(t);
  assert.equal(firstPush(k).status, 0);
  commitRow(k);
  k.put('docs/guide.md', 'x\n');
  k.must(k.kit, 'commit', '-q', '-am', 'a change');
  assert.equal(firstPush(k).status, 0);
  const main = k.must(k.remote, 'rev-parse', 'refs/heads/main').trim();
  assert.equal(k.must(k.out, 'rev-parse', 'HEAD').trim(), main);
  assert.equal(k.must(k.out, 'rev-parse', '--is-shallow-repository').trim(), 'false');
  assert.equal(k.must(k.out, 'rev-list', '--count', 'HEAD').trim(), '2');
  assert.equal(k.must(k.out, 'rev-list', '--max-parents=0', 'HEAD').trim().split('\n').length, 1, 'one root commit');
  assert.equal(k.must(k.out, 'status', '--porcelain'), '', 'a push leaves the build directory clean');
  assert.equal(k.must(k.out, 'config', '--get', 'core.autocrlf').trim(), 'false');
});

// ------------------------------------------------------------------ the seed
test('a seed push: no Kit row, the seed subject, the GENERIC template named, starter/ and the owner docs shipped, CRLF text written LF', (t) => {
  const k = miniKit(t);
  const seedRemote = k.bare('seed.git');
  const seed = path.join(k.T, 'alex-zed');
  fs.mkdirSync(path.join(seed, 'starter'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'starter', 'ABOUT-ZED.md'), '# About Zed\r\n\r\nZed writes on Windows.\r\n');
  fs.writeFileSync(path.join(seed, 'HOW-SHARING-WORKS.md'), '# Sharing\n');
  fs.writeFileSync(path.join(seed, 'INSTALL-ZED.md'), '# a laptop guide\n');
  const rows = fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8');
  const seedOut = path.join(k.T, 'seed-build');
  const r = k.build(['--push', '--seed', seed, '--remote', seedRemote, '--out', seedOut]);
  assert.equal(r.status, 0, r.text);
  assert.ok(
    r.stdout.includes(
      'build-online-template: seed alex-zed: 1 file(s) from starter/ and 1 owner doc(s) (HOW-SHARING-WORKS.md)\n'
    ),
    r.stdout
  );
  assert.ok(
    r.stdout.includes(
      "build-online-template: seed alex-zed: 1 text file(s) had CRLF line endings, written LF (a seed folder is not a commit, and the tree's law is eol=lf)\n"
    )
  );
  assert.ok(
    r.stdout.includes(
      "build-online-template: seed build: no changelog row (a seed is one person's copy of a template version, not a version); privileged paths in this diff: CLAUDE.md, scripts/hooks/pre-commit, scripts/lib/errors.js, scripts/lib/exit-codes.js, scripts/lib/json-writer.js, scripts/lib/manifest-claim.js, scripts/lib/render-changelog.mjs, scripts/lib/repo-root.js, scripts/lib/write-lock.js\n"
    )
  );
  const main = (r.stdout.match(FLEET.pushed) || [])[1];
  assert.equal(main, k.must(seedRemote, 'rev-parse', 'refs/heads/main').trim());
  assert.equal(fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8'), rows, 'no Kit row');
  assert.equal(k.must(k.kit, 'status', '--porcelain', '--untracked-files=no'), '', 'nothing staged in the Kit');
  const kit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  assert.equal(
    k.must(seedRemote, 'log', '-1', '--format=%s', 'main').trim(),
    `Virtual Alex seed alex-zed from kit ${kit.slice(0, 12)}: 20 path(s) changed; flagged: CLAUDE.md, scripts/hooks/pre-commit, scripts/lib/errors.js, scripts/lib/exit-codes.js, scripts/lib/json-writer.js, scripts/lib/manifest-claim.js, scripts/lib/render-changelog.mjs, scripts/lib/repo-root.js, scripts/lib/write-lock.js`
  );
  assert.equal(JSON.parse(k.must(seedRemote, 'show', 'main:system/template-source.json')).template_remote, GENERIC);
  assert.equal(k.must(seedRemote, 'show', 'main:starter/ABOUT-ZED.md'), '# About Zed\n\nZed writes on Windows.\n');
  assert.ok(!k.must(seedRemote, 'ls-tree', '-r', '--name-only', 'main').includes('INSTALL-ZED.md'));
  // VERSION in a seed names the last generic build the Kit's committed jsonl holds.
  assert.equal(
    k.must(seedRemote, 'show', 'main:VERSION'),
    'Virtual Alex template build 2, 2026-01-02, from Kit commit 222222222222\n'
  );
  // new-virtual-alex step 8 reads the seed back with --check --seed on stdout.
  const back = k.build(['--check', '--seed', seed, '--remote', seedRemote, '--out', seedOut]);
  assert.equal(back.status, 0, back.text);
  assert.equal((back.stdout.match(FLEET.checkOk) || [])[1], main);
});

// ------------------------------------------------------------------ refusals no other test reaches
test('a held write lock refuses before anything is read: exit 2, the holder named', (t) => {
  const k = miniKit(t);
  const lock = path.join(k.kit, '.alex-lock-alex-surfaces');
  fs.mkdirSync(lock);
  fs.writeFileSync(
    path.join(lock, 'holder.json'),
    JSON.stringify({ label: 'generate-alex', pid: 4242, since: new Date().toISOString() })
  );
  const r = firstPush(k);
  assert.equal(r.status, 2);
  assert.match(
    r.stderr,
    /^build-online-template: REFUSED - another repo-surface mutator holds the write lock \(.+\)\n$/
  );
  assert.ok(r.stderr.includes('generate-alex'), r.stderr);
  assert.ok(fs.existsSync(path.join(lock, 'holder.json')), "the other holder's lock is left alone");
  assert.equal(k.g(k.remote, 'rev-parse', '--verify', '-q', 'refs/heads/main').status, 1, 'nothing pushed');
});

test('a stale write lock (older than 30 minutes) is stolen, said on stdout, and released at the end', (t) => {
  const k = miniKit(t);
  const lock = path.join(k.kit, '.alex-lock-alex-surfaces');
  fs.mkdirSync(lock);
  fs.writeFileSync(
    path.join(lock, 'holder.json'),
    JSON.stringify({ label: 'a crashed run', pid: 4242, since: '2026-01-01T00:00:00Z' })
  );
  const old = new Date(Date.now() - 31 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  assert.match(r.stdout, /^build-online-template: write-lock: stealing a STALE/m);
  assert.ok(!fs.existsSync(lock), 'released');
});

test("no git identity in the Kit refuses: the template commits as the Kit's identity and never guesses one", (t) => {
  const k = miniKit(t);
  k.must(k.kit, 'config', '--unset', 'user.name');
  k.must(k.kit, 'config', '--unset', 'user.email');
  const r = firstPush(k);
  assert.equal(r.status, 2);
  assert.equal(
    r.stderr,
    "build-online-template: REFUSED - the Kit has no git user.name and user.email; the template commits as the Kit's identity and will not guess one\n"
  );
  assert.equal(r.stdout, '');
});

test("an unfetchable remote refuses with git's own reason (exit 2)", (t) => {
  const k = miniKit(t);
  const r = k.build(['--check', '--remote', path.join(k.T, 'no-such-remote.git'), '--out', k.out]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^build-online-template: REFUSED - cannot fetch .*no-such-remote\.git main: /);
});

test('an uncommitted edit is reported by content and not built; a pushed row then says kit_dirty true', (t) => {
  const k = miniKit(t);
  k.put('docs/guide.md', '# guide\n\nan edit nobody committed\n');
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  const kit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  assert.ok(
    r.stdout.includes(
      `build-online-template: WARN the Kit has 1 uncommitted change(s), found by content: docs/guide.md. The build reads the commit ${kit.slice(0, 12)}, so NONE of them are in it; a pushed row says kit_dirty=true\n`
    ),
    r.stdout
  );
  assert.equal(k.must(k.remote, 'show', 'main:docs/guide.md'), '# guide\n\nline one\n');
  const row = JSON.parse(
    fs.readFileSync(path.join(k.kit, 'system/template-changelog.jsonl'), 'utf8').trim().split('\n').pop()
  );
  assert.equal(row.kit_dirty, true);
  assert.match(
    k.must(k.remote, 'log', '-1', '--format=%s', 'main'),
    / \(the Kit had uncommitted changes, not built\): /
  );
});

test('an untracked file under variants/online/ is not read, and the WARN line says so', (t) => {
  const k = miniKit(t);
  k.put('variants/online/docs/new.md', 'not added\n');
  const r = firstPush(k);
  assert.equal(r.status, 0, r.text);
  assert.ok(
    r.stdout.includes(
      'build-online-template: WARN 1 untracked file(s) under variants/online/ are NOT read (the source set is what git tracks; git add them first): variants/online/docs/new.md\n'
    ),
    r.stdout
  );
});
