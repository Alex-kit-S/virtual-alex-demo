#!/usr/bin/env node
// scripts/tests/test-build-template-defects.mjs - the known defects of scripts/build-online-template.mjs,
// each asserted AS IT IS TODAY so the rewrite's fix flips a NAMED test.
//
// WHAT. Each test is named PINNED DEFECT <id>, except the two plain behaviour legs beside them that show
// what a fix must keep. A test that fails after a fix is either that fix (list it as a documented diff)
// or a regression; its name says which.
//
// HOW. The same miniature Kit as test-build-template-results.mjs, built in the OS temp directory per
// test: the builder and the seven libraries it requires, copied from this checkout, a test double for
// scripts/clone-scrub-check.js (a drop row online), and a bare repository as the remote. Every folder a
// test lets the builder wipe is one the test created. No network.
//
// NEVER. Writes inside the repository it runs in, or points --out at a folder it did not make. Flips a
// PINNED DEFECT assertion on its own: each pins today's behaviour, and only a FIX row in the ratchet
// flips one. R3-1: --out at any existing folder deletes its content, and an existing clone's history
// too. R3-4: a rejected push leaves a phantom build row written and staged in the Kit. R3-6: the
// manifest is read from the working copy while everything else is read from the commit. R3-8: a
// committed changelog without a trailing newline is corrupted in the Kit. R3-9: a dirty build directory
// breaks the next run once the remote has moved, and the fleet script's failure filter keeps no line of
// the error. R3-L1: changelog errors exit 1 with a stack, not a refusal with 2, even under --check.
// R3-L3: seed files bypass the duplicate-destination check, so the seed copy wins and is counted twice.
// R3-L4: a second donor-scrub refusal leaves the Kit row already written and staged. R3-L6: a tracked
// symlink reads as an uncommitted change (POSIX). R3-L7: a symlink inside a seed's starter/ is skipped
// without a word. R3-L8: a seed file with a lone CR is refused, with the Kit's own remedy. R3-L9: an
// empty changelog leaves CHANGELOG.md written before the VERSION render throws.
//
// Usage: node scripts/tests/test-build-template-defects.mjs
// Exit: 0 every assertion held - 1 one failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as B from '../build-online-template.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const TEMPLATE_URL = 'https://github.com/example/virtual-alex';
const FLEET_FAILURE_FILTER = /CHECK FAILED|REFUSED|drift:/; // the fleet's own failure filter in scripts/new-virtual-alex.mjs

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

function miniKit(t, { changelog = `${ROW1}\n${ROW2}\n`, extra = {} } = {}) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-bd-')));
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
  const BUILDER_FILES = [
    'scripts/build-online-template.mjs',
    'scripts/lib/write-lock.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/render-changelog.mjs',
    'scripts/lib/manifest-claim.js',
    'scripts/lib/errors.js',
    'scripts/lib/exit-codes.js',
    'scripts/lib/repo-root.js'
  ];
  for (const rel of BUILDER_FILES) {
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  put('scripts/clone-scrub-check.js', SCANNER_DOUBLE);
  put('CLAUDE.md', '# the laptop constitution\n');
  put('variants/online/CLAUDE.md', '# the online constitution\n');
  put('docs/guide.md', '# guide\n\nline one\n');
  put('.gitignore', '.alex-lock-*/\n');
  put('system/kit-manifest.json', `${JSON.stringify(MANIFEST, null, 2)}\n`);
  put('system/template-changelog.jsonl', changelog);
  for (const [rel, text] of Object.entries(extra)) put(rel, text);
  const g = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env });
  const must = (cwd, ...args) => {
    const r = g(cwd, ...args);
    if (r.status !== 0) {
      throw new Error(
        `git ${args.join(' ')}: exit ${r.status}${r.signal ? ` (signal ${r.signal})` : ''}${r.error ? ` (${r.error.code})` : ''}: ${r.stderr}`
      );
    }
    return r.stdout;
  };
  must(kit, 'init', '-q', '-b', 'main');
  must(kit, 'config', 'user.name', 'Kit Maintainer');
  must(kit, 'config', 'user.email', 'maintainer@example.invalid');
  must(kit, 'add', '-A');
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
    const cause =
      r.error || r.signal
        ? `${r.error ? ` (${r.error.code || r.error.message})` : ''}${r.signal ? ` (signal ${r.signal})` : ''}`
        : '';
    const stderr = cause ? `${r.stderr || ''}exit ${r.status}${cause}\n` : r.stderr;
    return { status: r.status, stdout: r.stdout, stderr, text: `${r.stdout || ''}${stderr || ''}` };
  };
  const out = path.join(T, 'build');
  const push = (more = [], extraEnv = {}) =>
    build(['--push', '--remote', remote, '--out', out, '--template-remote', TEMPLATE_URL, ...more], extraEnv);
  const check = (more = []) =>
    build(['--check', '--remote', remote, '--out', out, '--template-remote', TEMPLATE_URL, ...more]);
  const status = () => must(kit, 'status', '--porcelain', '--untracked-files=no');
  const jsonl = () => fs.readFileSync(path.join(kit, 'system/template-changelog.jsonl'), 'utf8');
  const remoteHas = () => g(remote, 'rev-parse', '--verify', '-q', 'refs/heads/main').status === 0;
  return { T, kit, remote, env, g, must, bare, build, put, out, push, check, status, jsonl, remoteHas };
}
const hook = (bare, name, body) => {
  const f = path.join(bare, 'hooks', name);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(f, 0o755);
};

// ------------------------------------------------------------------ --out at an existing folder
test('PINNED DEFECT R3-1: --out at an existing folder deletes everything in it that is not .git', (t) => {
  const k = miniKit(t);
  const victim = path.join(k.T, 'my-folder');
  fs.mkdirSync(path.join(victim, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(victim, 'keep-me.txt'), 'a file nobody asked the build to touch\n');
  fs.writeFileSync(path.join(victim, 'notes', 'n.md'), 'n\n');
  const r = k.build(['--check', '--remote', k.remote, '--out', victim]);
  assert.equal(r.status, 2, r.text);
  assert.ok(!fs.existsSync(path.join(victim, 'keep-me.txt')), 'keep-me.txt is GONE');
  assert.ok(!fs.existsSync(path.join(victim, 'notes')), 'notes/ is GONE');
  assert.ok(fs.existsSync(path.join(victim, '.git')), 'a build repository was made in its place');
  assert.ok(fs.existsSync(path.join(victim, 'docs', 'guide.md')), 'and the generated tree written into it');
});

test("PINNED DEFECT R3-1: --out at an existing clone, against an empty remote, deletes that clone's history too", (t) => {
  const k = miniKit(t);
  const victim = path.join(k.T, 'a-clone');
  k.must(k.T, 'init', '-q', '-b', 'main', victim);
  fs.writeFileSync(path.join(victim, 'work.txt'), 'committed work\n');
  k.must(victim, 'add', '-A');
  k.must(
    victim,
    '-c',
    'user.name=o',
    '-c',
    'user.email=o@example.invalid',
    'commit',
    '-q',
    '-m',
    'a commit only this clone has'
  );
  k.must(victim, 'remote', 'add', 'origin', path.join(k.T, 'elsewhere.git'));
  const r = k.build(['--check', '--remote', k.remote, '--out', victim]);
  assert.equal(r.status, 2, r.text);
  assert.ok(!fs.existsSync(path.join(victim, 'work.txt')), 'the working file is gone');
  assert.equal(
    k.g(victim, 'rev-parse', '--verify', '-q', 'HEAD').status,
    1,
    "the clone's commit is gone: HEAD is unborn"
  );
  assert.equal(
    k.must(victim, 'remote', 'get-url', 'origin').trim(),
    k.remote,
    'and origin now names the template remote'
  );
});

// ------------------------------------------------------------------ a rejected push
test('PINNED DEFECT R3-4: a rejected push exits 1 and leaves a phantom build row written and staged in the Kit', (t) => {
  const k = miniKit(t);
  hook(k.remote, 'pre-receive', 'echo "refused by a test hook" >&2\nexit 1');
  const before = k.jsonl();
  const r = k.push();
  assert.equal(r.status, 1, r.text);
  assert.match(r.stderr, /^build-online-template: ERROR - Error: git push -q -u origin main failed \(exit 1\) in /);
  assert.ok(!k.remoteHas(), 'nothing reached the remote');
  assert.equal(k.status(), 'M  system/template-changelog.jsonl\n', 'the row is STAGED in the Kit');
  const phantom = JSON.parse(k.jsonl().slice(before.length));
  assert.equal(phantom.build, 3, 'a build 3 row that exists in no template');
  // The next push refuses, and its remedy offers "commit it", which would ship the phantom row.
  fs.rmSync(path.join(k.remote, 'hooks', 'pre-receive'));
  const again = k.push();
  const kit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  assert.equal(again.status, 2);
  assert.equal(
    again.stderr,
    `build-online-template: REFUSED - system/template-changelog.jsonl in the Kit differs from its commit ${kit.slice(0, 12)}; commit it, or restore it with git checkout, before a push appends the next row\n`
  );
});

test('a push the remote moves after receiving (read-back mismatch) refuses with exit 2, the Kit row likewise left staged', (t) => {
  const k = miniKit(t);
  hook(
    k.remote,
    'post-receive',
    'git -c user.name=h -c user.email=h@example.invalid update-ref refs/heads/main "$(git -c user.name=h -c user.email=h@example.invalid commit-tree -m moved "$(git mktree </dev/null)")"'
  );
  const r = k.push();
  assert.equal(r.status, 2, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: REFUSED - push read-back FAILED: local main [0-9a-f]{40}, remote main [0-9a-f]{40}\n$/
  );
  assert.equal(k.status(), 'M  system/template-changelog.jsonl\n');
});

// ------------------------------------------------------------------ an uncommitted manifest edit
test('PINNED DEFECT R3-6: an uncommitted manifest edit changes what ships, while the WARN line says the build reads the commit', (t) => {
  const k = miniKit(t);
  assert.equal(k.push().status, 0);
  k.must(k.kit, 'commit', '-q', '-m', 'row', '--', 'system/template-changelog.jsonl');
  const m = JSON.parse(fs.readFileSync(path.join(k.kit, 'system/kit-manifest.json'), 'utf8'));
  m.components.find((c) => c.id === 'docs').online = 'drop';
  fs.writeFileSync(path.join(k.kit, 'system/kit-manifest.json'), `${JSON.stringify(m, null, 2)}\n`);
  const r = k.check();
  const kit = k.must(k.kit, 'rev-parse', 'HEAD').trim();
  assert.equal(r.status, 2, r.text);
  assert.ok(
    r.stdout.includes(
      `WARN the Kit has 1 uncommitted change(s), found by content: system/kit-manifest.json. The build reads the commit ${kit.slice(0, 12)}, so NONE of them are in it;`
    ),
    r.stdout
  );
  assert.ok(
    r.stdout.includes('build-online-template:   drift: docs/guide.md\n'),
    'the uncommitted drop row removed docs/ from the build'
  );
});

// ------------------------------------------------------------------ a changelog with no trailing newline
test('PINNED DEFECT R3-8: a committed changelog without a trailing newline gets the next row glued onto its last one, staged, exit 1', (t) => {
  const k = miniKit(t, { changelog: `${ROW1}\n${ROW2}` });
  const r = k.push();
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: ERROR - Error: system\/template-changelog\.jsonl row 2 is not JSON; the changelog will not guess what it said/
  );
  const lines = k.jsonl().split('\n');
  assert.equal(lines.length, 3, 'two lines and the final newline');
  assert.ok(lines[1].startsWith(`${ROW2}{"at":"`), 'row 2 now carries the new row glued to it');
  assert.throws(() => JSON.parse(lines[1]));
  assert.equal(k.status(), 'M  system/template-changelog.jsonl\n', 'the corrupted file is staged in the Kit');
  assert.ok(!k.remoteHas(), 'nothing pushed');
});

// ------------------------------------------------------------------ a build directory left dirty
test('PINNED DEFECT R3-9: a build directory left dirty by a drift --check makes the next run exit 1 once the remote moved; the fleet filter keeps no line', (t) => {
  const k = miniKit(t);
  assert.equal(k.push().status, 0);
  k.must(k.kit, 'commit', '-q', '-m', 'row', '--', 'system/template-changelog.jsonl');
  k.put('docs/guide.md', '# guide\n\nthe Kit moved on\n');
  k.must(k.kit, 'commit', '-q', '-am', 'a Kit change');
  assert.equal(k.check().status, 2, 'a drift check: the build directory keeps the drift staged');
  // Someone else moves the template, touching the same file.
  const other = path.join(k.T, 'other');
  k.must(k.T, 'clone', '-q', k.remote, other);
  fs.writeFileSync(path.join(other, 'docs', 'guide.md'), '# guide\n\nthe template moved on\n');
  k.must(other, '-c', 'user.name=o', '-c', 'user.email=o@example.invalid', 'commit', '-q', '-am', 'moved');
  k.must(other, 'push', '-q', 'origin', 'main');
  const r = k.check();
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: ERROR - Error: git checkout -q -B main FETCH_HEAD failed \(exit 1\) in /
  );
  assert.match(r.stderr, /would be overwritten/);
  assert.deepEqual(
    r.text.split('\n').filter((l) => FLEET_FAILURE_FILTER.test(l)),
    [],
    'new-virtual-alex would report only "exit 1"'
  );
});

// ------------------------------------------------------------------ an empty or truncated changelog
test('PINNED DEFECT R3-L1: a deleted changelog row is an ERROR with exit 1 (not a refusal with 2), even under --check', (t) => {
  const row3 = ROW2.replace('"build":2', '"build":3');
  const k = miniKit(t, { changelog: `${ROW1}\n${row3}\n` });
  const r = k.check();
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: ERROR - Error: system\/template-changelog\.jsonl row 2 says build 3; a row was deleted or inserted\n/
  );
});

test('PINNED DEFECT R3-L1 and R3-L9: an empty committed changelog is an ERROR with exit 1, and CHANGELOG.md is left written without VERSION', (t) => {
  const k = miniKit(t, { changelog: '' });
  const r = k.check();
  assert.equal(r.status, 1, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: ERROR - Error: system\/template-changelog\.jsonl has no rows, so there is no build to name\n/
  );
  assert.ok(fs.existsSync(path.join(k.out, 'CHANGELOG.md')), 'CHANGELOG.md was written');
  assert.ok(!fs.existsSync(path.join(k.out, 'VERSION')), 'VERSION was not');
});

// ------------------------------------------------------------------ the donor scrub
test('a donor-scrub hit on the first scan refuses before any result line, with no Kit row', (t) => {
  const k = miniKit(t);
  const r = k.push([], { C3_SCRUB_COUNTER: path.join(k.T, 'scrub-count'), C3_SCRUB_FAIL_ON_CALL: '1' });
  assert.equal(r.status, 2, r.text);
  assert.equal(
    r.stderr,
    'build-online-template: REFUSED - donor scrub: 1 hit(s) in the generated tree, so nothing was reported or pushed. Fix the Kit file, or add a reviewed row WITH its reason to system/clone-scrub-allowlist.json:\n    [donor-name] docs/guide.md:1: a planted hit\n'
  );
  assert.ok(!/donor scrub: CLEAN|build dir |PUSHED/.test(r.stdout), 'no result line');
  assert.equal(k.status(), '', 'the Kit is untouched');
  assert.ok(!k.remoteHas());
});

test('PINNED DEFECT R3-L4: a donor-scrub hit on the SECOND scan (after the row) refuses, but the Kit row is already written and staged', (t) => {
  const k = miniKit(t);
  const r = k.push([], { C3_SCRUB_COUNTER: path.join(k.T, 'scrub-count'), C3_SCRUB_FAIL_ON_CALL: '2' });
  assert.equal(r.status, 2, r.text);
  assert.match(
    r.stderr,
    /^build-online-template: REFUSED - donor scrub: 1 hit\(s\) in the generated tree, so nothing was reported or pushed\./
  );
  assert.equal(k.status(), 'M  system/template-changelog.jsonl\n');
  assert.ok(!k.remoteHas());
});

// ------------------------------------------------------------------ the seed
test('PINNED DEFECT R3-L3: a seed file at a path the Kit also ships is written twice without a refusal; the seed copy wins and is counted twice', (t) => {
  const k = miniKit(t, { extra: { 'starter/ABOUT-ZED.md': "the Kit's own copy\n" } });
  const seedRemote = k.bare('seed.git');
  const seed = path.join(k.T, 'alex-zed');
  fs.mkdirSync(path.join(seed, 'starter'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'starter', 'ABOUT-ZED.md'), "the seed's copy\n");
  const r = k.build(['--push', '--seed', seed, '--remote', seedRemote, '--out', path.join(k.T, 'seed-build')]);
  assert.equal(r.status, 0, r.text);
  assert.ok(!/two sources land at/.test(r.text));
  assert.equal(k.must(seedRemote, 'show', 'main:starter/ABOUT-ZED.md'), "the seed's copy\n");
  assert.ok(
    r.stdout.includes('plan: 14 ship, 1 variant, 0 dropped, 0 link(s) skipped; 16 file(s) in the online tree'),
    r.stdout
  );
});

test("PINNED DEFECT R3-L7: a symlink inside a seed's starter/ is skipped without a word", (t) => {
  const seed = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-seedlink-')));
  t.after(() => fs.rmSync(seed, { recursive: true, force: true }));
  fs.mkdirSync(path.join(seed, 'starter'));
  fs.writeFileSync(path.join(seed, 'starter', 'real.md'), 'real\n');
  try {
    fs.symlinkSync(path.join(seed, 'starter', 'real.md'), path.join(seed, 'starter', 'link.md'), 'file');
  } catch (e) {
    t.skip(`this machine cannot make a file symlink (${e.code}); the skip is platform policy, not the builder`);
    return;
  }
  assert.deepEqual(
    B.seedFiles(seed).files.map((f) => f.dst),
    ['starter/real.md']
  );
});

test('PINNED DEFECT R3-L8: a seed text file with a lone CR is refused, and the remedy sends the owner to the Kit', (t) => {
  const k = miniKit(t);
  const seedRemote = k.bare('seed.git');
  const seed = path.join(k.T, 'alex-cr');
  fs.mkdirSync(path.join(seed, 'starter'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'starter', 'ABOUT-CR.md'), 'an old Mac line\rand the next\n');
  const r = k.build(['--push', '--seed', seed, '--remote', seedRemote, '--out', path.join(k.T, 'seed-build')]);
  assert.equal(r.status, 2, r.text);
  assert.equal(
    r.stderr,
    'build-online-template: REFUSED - 1 file(s) carry a carriage return (CR) and would ship it, which breaks a script on the Linux VM: starter/ABOUT-CR.md. Renormalise them in the Kit (git add --renormalize, in a commit that changes line endings only); only an eol=crlf path, or a -text file that is never executed, may carry CR\n'
  );
});

// ------------------------------------------------------------------ a tracked symlink
test('PINNED DEFECT R3-L6: a tracked symlink reads as an uncommitted change (dirtyPaths hashes the target)', {
  skip:
    process.platform === 'win32' &&
    'Git for Windows checks a symlink out as a plain file (core.symlinks=false), so the link text is what is hashed and nothing reads dirty'
}, (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-symlink-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const env = gitEnv(d);
  fs.writeFileSync(path.join(d, 'gitconfig'), '');
  const g = (...args) => spawnSync('git', args, { cwd: d, encoding: 'utf8', env });
  g('init', '-q');
  fs.writeFileSync(path.join(d, 'target.md'), 'the target\n');
  fs.symlinkSync('target.md', path.join(d, 'link.md'));
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'a link');
  assert.equal(g('status', '--porcelain', '--untracked-files=no').stdout, '', 'git itself calls the tree clean');
  assert.deepEqual(B.dirtyPaths(d), ['link.md']);
});
