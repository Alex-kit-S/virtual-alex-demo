#!/usr/bin/env node
// scripts/tests/test-online-pre-commit.mjs - characterization of the Virtual Alex commit gate
// (variants/online/scripts/hooks/pre-commit in the Kit, scripts/hooks/pre-commit in the online tree)
// as a HOOK.
//
// WHAT. The order of its four legs, the exact lines on each stream, the exit code git reads, that
// the first failing leg stops the rest, that every leg which cannot run fails closed, and the
// arguments it hands each leg. test-employer-data-guard.mjs drives the same file with the REAL
// scanners for a hit on each leg; this file uses recording stubs so the hook's own contract is what
// is measured: node absent, a scanner that errors, validate-alex's own exit status, the clean lines.
// Deleted, a leg could silently stop blocking, run out of order, or leak a scanner's own output onto
// the wrong stream, with nothing here to catch it.
//
// HOW. Every fixture is a throwaway git repository in a temp folder this file deletes, with
// core.hooksPath pointed at the copied hook. Git runs with no system or global config.
// test-online-pre-commit-kit.mjs compares the size guard's own loop, byte for byte, against the online
// hook's copy, split out when a generated online tree has only its own hook to read.
//
// NEVER. Never reaches a network, and never runs the real scanners (that is
// test-employer-data-guard.mjs's job) - every leg here is a recording stub. Known defects, pinned AS
// THEY ARE TODAY under "PINNED DEFECT <id>" (the fix flips exactly that assertion):
//   PC-D1 a staged gitlink has no blob to size, so it gets the big-file advice instead of passing through
//   PC-D3 a type change (status T) is not size-checked
//
// Usage: node scripts/tests/test-online-pre-commit.mjs
// Exit: 0 all pass - 1 any failure

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_KIT = fs.existsSync(path.join(KIT, 'variants', 'online', 'scripts', 'hooks', 'pre-commit'));
const HOOK_REL = IS_KIT ? 'variants/online/scripts/hooks/pre-commit' : 'scripts/hooks/pre-commit';
const HOOK = path.join(KIT, ...HOOK_REL.split('/'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-online-gate-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

// git.exe on Windows lives in <git>/cmd or <git>/bin; the POSIX shell that runs hooks is <git>/usr/bin/sh.exe
function gitRoot() {
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const root = line.trim() && path.dirname(path.dirname(line.trim()));
    if (root && fs.existsSync(path.join(root, 'usr', 'bin', 'sh.exe'))) return root;
  }
  throw new Error('Git for Windows not found next to git.exe');
}
const WIN = process.platform === 'win32';
const SH = WIN ? path.join(gitRoot(), 'usr', 'bin', 'sh.exe') : '/bin/sh';
const REAL_GIT = WIN
  ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.split(/\r?\n/)[0].trim()
  : spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  STUB_SECRET: '0',
  STUB_EMPLOYER: '0',
  STUB_VALIDATE: '0'
};
const git = (cwd, args, env = {}) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const W = (dir, rel, text) => {
  const p = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};

// A recording stub for each leg: it appends "<name> <args>" to .stub-calls, prints one line, and exits
// with the code its environment variable names.
const stub = (name, variable, hitLine) =>
  `import fs from 'node:fs';\n` +
  `fs.appendFileSync('.stub-calls', ${JSON.stringify(name)} + ' ' + process.argv.slice(2).join(' ') + '\\n');\n` +
  `const code = Number(process.env.${variable} || 0);\nif (code) console.log(${JSON.stringify(hitLine)});\nprocess.exit(code);\n`;

let n = 0;
function repo() {
  const dir = path.join(TMP, `r${++n}`);
  assert.equal(git(TMP, ['init', '-q', '-b', 'main', dir]).status, 0);
  W(dir, 'scripts/hooks/pre-commit', fs.readFileSync(HOOK, 'utf8'));
  fs.chmodSync(path.join(dir, 'scripts', 'hooks', 'pre-commit'), 0o755);
  W(dir, 'scripts/secret-scan.mjs', stub('secret-scan', 'STUB_SECRET', 'secret-scan: vault/page.md:1 fake-pattern'));
  W(
    dir,
    'scripts/employer-data-guard.mjs',
    stub('employer-data-guard', 'STUB_EMPLOYER', 'employer-data-guard: vault/page.md:1 fake-leg')
  );
  W(dir, 'scripts/validate-alex.js', stub('validate-alex', 'STUB_VALIDATE', 'FAILED V99 a stubbed finding'));
  W(dir, '.git/info/exclude', '.stub-calls\n');
  assert.equal(git(dir, ['add', '-A']).status, 0);
  assert.equal(git(dir, ['commit', '-qm', 'seed', '--no-verify']).status, 0);
  assert.equal(git(dir, ['config', 'core.hooksPath', 'scripts/hooks']).status, 0);
  W(dir, 'vault/page.md', 'a page\n');
  assert.equal(git(dir, ['add', 'vault/page.md']).status, 0);
  return dir;
}
// run the hook the way git does (cwd the repository root), reading both streams apart
function gate(dir, env = {}) {
  const r = spawnSync(SH, [path.join(dir, 'scripts', 'hooks', 'pre-commit')], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...ENV, ...env }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const calls = (dir) =>
  fs.existsSync(path.join(dir, '.stub-calls'))
    ? fs.readFileSync(path.join(dir, '.stub-calls'), 'utf8').split('\n').filter(Boolean)
    : [];
const ANNOUNCE =
  'pre-commit: validate-alex (full suite, context=pre-commit; V10 = NEVER-TOUCH guard, V11 = forced-add guard on the staged changeset, V21 = JSON standard on enforced files; drift legs WARN under CLAUDE_CODE_REMOTE=true).';

test('the hook ships executable (mode 100755 in the index)', () => {
  const r = spawnSync('git', ['ls-files', '-s', HOOK_REL], { cwd: KIT, encoding: 'utf8' });
  assert.match(r.stdout, /^100755 /);
});

test('a clean commit: the four legs in order with their arguments, the clean lines on stdout, nothing on stderr, exit 0', () => {
  const dir = repo();
  const r = gate(dir);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(
    r.stdout,
    [
      'pre-commit: secret-scan staged scan clean.',
      'pre-commit: size guard clean (no staged blob over 10485760 bytes).',
      ANNOUNCE,
      ''
    ].join('\n')
  );
  assert.deepEqual(calls(dir), [
    'secret-scan --staged',
    'employer-data-guard --staged',
    'validate-alex --context=pre-commit --changed'
  ]);
  assert.equal(git(dir, ['commit', '-qm', 'through the gate']).status, 0, 'git commit passes through it');
});

test('a secret hit (exit 2): two BLOCKED lines on stderr, exit 1, and no later leg runs', () => {
  const dir = repo();
  const r = gate(dir, { STUB_SECRET: '2' });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, 'secret-scan: vault/page.md:1 fake-pattern\n');
  assert.equal(
    r.stderr,
    'pre-commit: BLOCKED - secret-scan found a credential shape in the STAGED content (file:line and pattern above; the value is never printed).\n' +
      "pre-commit: remove it, or put '# secret-scan: allow' on that line to accept a reviewed exception. A pushed secret must be ROTATED, not just deleted.\n"
  );
  assert.deepEqual(calls(dir), ['secret-scan --staged']);
  assert.notEqual(git(dir, ['commit', '-qm', 'x'], { STUB_SECRET: '2' }).status, 0, 'git refuses the commit');
});

test('a secret scanner that errors (any exit but 0 or 2) blocks, fail-closed', () => {
  const dir = repo();
  const r = gate(dir, { STUB_SECRET: '3' });
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    'pre-commit: BLOCKED - secret-scan errored (exit 3); fail-closed (cannot certify the commit is secret-free).\n'
  );
  assert.deepEqual(calls(dir), ['secret-scan --staged']);
});

test('the size guard: one byte over 10 MB blocks with the path and the advice; exactly 10 MB and a deletion pass', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'vault', 'big.bin'), Buffer.alloc(10485761, 0x41));
  git(dir, ['add', 'vault/big.bin']);
  const r = gate(dir);
  assert.equal(r.code, 1);
  assert.equal(r.stdout, 'pre-commit: secret-scan staged scan clean.\n');
  assert.equal(
    r.stderr,
    'pre-commit: BLOCKED - vault/big.bin is 10485761 bytes, over the 10485760 byte size guard (10 MB). A file nobody can diff does not belong in a repo that is the disk.\n' +
      "pre-commit: unstage it (git restore --staged <path>) and keep it outside the repo, or gitignore it. 'git commit --no-verify' overrides deliberately.\n"
  );
  assert.deepEqual(calls(dir), ['secret-scan --staged']);
  fs.writeFileSync(path.join(dir, 'vault', 'big.bin'), Buffer.alloc(10485760, 0x41));
  git(dir, ['add', 'vault/big.bin']);
  assert.equal(gate(dir).code, 0, 'exactly the limit passes');
  assert.equal(git(dir, ['commit', '-qm', 'at the limit']).status, 0);
  git(dir, ['rm', '-q', 'vault/big.bin']);
  assert.equal(gate(dir).code, 0, 'a staged deletion is not size-checked');
});

test('PINNED DEFECT PC-D3: a type change (a symlink replaced by a blob over 10 MB, status T) is not size-checked', () => {
  // built entirely in the index, so it needs no symlink support on the machine running the test
  const dir = repo();
  const big = path.join(TMP, `big-${n}.bin`);
  fs.writeFileSync(big, Buffer.alloc(10485761, 0x41));
  const bigBlob = git(dir, ['hash-object', '-w', big]).stdout.trim();
  const target = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: dir,
    input: 'target',
    encoding: 'utf8',
    env: ENV
  }).stdout.trim();
  assert.equal(git(dir, ['update-index', '--add', '--cacheinfo', `120000,${target},vault/link`]).status, 0);
  assert.equal(git(dir, ['commit', '-qm', 'a link', '--no-verify']).status, 0);
  assert.equal(git(dir, ['update-index', '--cacheinfo', `100644,${bigBlob},vault/link`]).status, 0);
  assert.equal(git(dir, ['diff', '--cached', '--name-status']).stdout.trim(), 'T\tvault/link');
  const r = gate(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^pre-commit: size guard clean \(no staged blob over 10485760 bytes\)\.$/m);
});

test('PINNED DEFECT PC-D1: a staged gitlink has no blob to size, so it gets the big-file advice instead of passing through', () => {
  const dir = repo();
  const notAnObject = 'a'.repeat(40);
  assert.equal(git(dir, ['update-index', '--add', '--cacheinfo', `160000,${notAnObject},vault/submodule`]).status, 0);
  const r = gate(dir);
  assert.equal(r.code, 1);
  assert.match(
    r.stderr,
    /^pre-commit: BLOCKED - cannot read the staged blob for vault\/submodule \(git cat-file failed\); fail-closed\n/
  );
  assert.match(
    r.stderr,
    /\npre-commit: unstage it \(git restore --staged <path>\) and keep it outside the repo, or gitignore it\. /
  );
});

test('a staged path shaped <digit>:<name> is read as itself at its own stage, never misread as a merge stage of a different path', {
  skip: WIN && 'Git for Windows refuses a colon in an index path, so the shape cannot be staged here'
}, () => {
  const dir = repo();
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: dir,
    input: 'hi\n',
    encoding: 'utf8',
    env: ENV
  }).stdout.trim();
  assert.equal(git(dir, ['update-index', '--add', '--cacheinfo', `100644,${blob},2:y.md`]).status, 0);
  const r = gate(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^pre-commit: size guard clean \(no staged blob over 10485760 bytes\)\.$/m);
});

test('a big blob staged under a digit-colon-named path is still blocked, never bypassed by a same-stage sibling at the bare name', {
  skip: WIN && 'Git for Windows refuses a colon in an index path, so the shape cannot be staged here'
}, () => {
  const dir = repo();
  const big = path.join(TMP, `big-pcd2-${n}.bin`);
  fs.writeFileSync(big, Buffer.alloc(10485761, 0x42));
  const bigBlob = git(dir, ['hash-object', '-w', big]).stdout.trim();
  const smallBlob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: dir,
    input: 'hi\n',
    encoding: 'utf8',
    env: ENV
  }).stdout.trim();
  assert.equal(git(dir, ['update-index', '--add', '--cacheinfo', `100644,${bigBlob},0:x`]).status, 0);
  assert.equal(git(dir, ['update-index', '--add', '--cacheinfo', `100644,${smallBlob},x`]).status, 0);
  const r = gate(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /0:x is 10485761 bytes, over the 10485760 byte size guard/);
});

test('an employer-data hit blocks with two lines; an employer guard that errors blocks fail-closed; validate never runs', () => {
  const hit = repo();
  const r = gate(hit, { STUB_EMPLOYER: '2' });
  assert.equal(r.code, 1);
  assert.equal(
    r.stderr,
    'pre-commit: BLOCKED - employer-data-guard found employer data in the STAGED content (file:line and leg above; the value is never printed).\n' +
      'pre-commit: employer data stays out of the vault. Remove it, or record a reviewed exception WITH ITS REASON: node scripts/employer-data-guard.mjs --allow-address <a> --reason <r> (or --allow-path).\n'
  );
  assert.deepEqual(calls(hit), ['secret-scan --staged', 'employer-data-guard --staged']);
  const broken = repo();
  const e = gate(broken, { STUB_EMPLOYER: '1' });
  assert.equal(e.code, 1);
  assert.equal(
    e.stderr,
    'pre-commit: BLOCKED - employer-data-guard errored (exit 1); fail-closed (cannot certify the commit is employer-data-free).\n'
  );
});

test("validate-alex failing: the hook exits with validate-alex's OWN status and says so on stderr", () => {
  const dir = repo();
  const r = gate(dir, { STUB_VALIDATE: '3' });
  assert.equal(r.code, 3);
  assert.ok(r.stdout.endsWith(`${ANNOUNCE}\nFAILED V99 a stubbed finding\n`), r.stdout);
  assert.equal(r.stderr, 'pre-commit: BLOCKED - validation failed (see FAILED lines above).\n');
});

test('validate-alex CRASHING (exiting non-zero with no FAILED line anywhere) is named as a crash, never "see FAILED lines above"', () => {
  const dir = repo();
  W(
    dir,
    'scripts/validate-alex.js',
    '#!/usr/bin/env node\nconsole.error("Error: Cannot find module \'./lib/validate/structure\'");\nprocess.exit(1);\n'
  );
  const r = gate(dir);
  assert.equal(r.code, 1);
  assert.ok(
    !/^FAILED /m.test(r.stdout) && !/^FAILED /m.test(r.stderr),
    `no line starting "FAILED " anywhere\n${r.stdout}${r.stderr}`
  );
  assert.equal(
    r.stderr,
    "Error: Cannot find module './lib/validate/structure'\npre-commit: BLOCKED - validate-alex exited 1 with no FAILED line above; it crashed rather than failed a named check (see the error printed above).\n"
  );
  assert.ok(!r.stderr.includes('(see FAILED lines above)'), r.stderr);
});

test('node absent: blocked before any leg, fail-closed, exit 1', () => {
  const dir = repo();
  const shim = path.join(TMP, 'shim-bin');
  fs.mkdirSync(shim, { recursive: true });
  const realGit = WIN ? `/${REAL_GIT[0].toLowerCase()}${REAL_GIT.slice(2).replace(/\\/g, '/')}` : REAL_GIT;
  fs.writeFileSync(path.join(shim, 'git'), `#!/bin/sh\nexec "${realGit}" "$@"\n`);
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const env = { ...ENV };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env[PATH_KEY] = shim;
  const r = spawnSync(SH, [path.join(dir, 'scripts', 'hooks', 'pre-commit')], { cwd: dir, encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.equal(
    r.stderr,
    'pre-commit: BLOCKED - node not found; the content legs and validate-alex CANNOT run, so this commit is not validated (fail closed).\n'
  );
  assert.deepEqual(calls(dir), []);
});
