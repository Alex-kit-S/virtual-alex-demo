#!/usr/bin/env node
// scripts/tests/test-secret-scan.mjs - the secret scanner and the two content legs of the commit gate,
// every refusal shown before the pass.
//
// WHAT. Proves scripts/secret-scan.mjs end to end, inside a throwaway repository under the OS temp
// folder that carries the REAL secret-scan.mjs and the REAL scripts/hooks/pre-commit; the hook's other
// node legs (personal-data-scan, clone-scrub-check, validate-alex) are stubs that exit 0, so what runs
// end to end is the secret-scan leg and the size guard, with gitleaks as whatever this machine has.
// Deleted, it would let a real credential shape reach a commit with nothing catching it, and let the
// hook's own wiring around the scanner (the size guard, the stub legs, the pass line) drift unnoticed.
//
// HOW. The fake key is assembled at run time; this file never carries the shape. The personal-data wall
// is a stub here; its own tests run the real scanner, including the legs that hold its patterns to
// POSIX ERE on every platform (scripts/tests/test-personal-data-scan.mjs). The fixture (one throwaway
// repository) is built ONCE, synchronously, at module load, and every section below runs its git/scan
// calls in the order they are written, against that same shared repository; the describe() blocks below
// (one per section) run their bodies immediately to register their tests, so the interleaving of writes,
// commits and resets is unchanged from a plain script.
//
// NEVER. Writes outside its own temp folder; the folder is kept only when run with --keep.
//
// Usage: node scripts/tests/test-secret-scan.mjs [--keep]
// Exit: 0 every assertion held - 1 one failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEEP = process.argv.includes('--keep');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-secret-scan-'));
const REPO = path.join(TMP, 'repo');
const MAX = 10485760;

after(() => {
  if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
});

// Inherited GIT_* vars and the machine's own global or system git config (a signing key, autocrlf, a
// hook path) must never reach a test's git calls: standard section 6. GIT_CONFIG_GLOBAL names an empty
// file in TMP, not /dev/null, because git treats a path it cannot open as an error, not as "no file".
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
function gitEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_CEILING_DIRECTORIES: TMP };
}

/** @param {boolean} cond @param {string} name @param {string} [detail] */
function ok(cond, name, detail) {
  test(`${name}${detail ? ` - ${detail}` : ''}`, () => {
    assert.ok(cond);
  });
}
function show(label, text) {
  const t = String(text || '').trim();
  if (t) console.log(`      ${label}: ${t.split(/\r?\n/).join('\n      ')}`);
}
function run(args, cwd = REPO) {
  return spawnSync(process.execPath, args, { cwd, env: gitEnv(), encoding: 'utf8' });
}
function git(args, cwd = REPO) {
  return spawnSync('git', args, { cwd, env: gitEnv(), encoding: 'utf8' });
}
function gitOut(args, cwd = REPO) {
  return git(args, cwd).stdout.trim();
}
function write(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
// the value under test, never written literally anywhere in this file
const FAKE = ['sk-', 'ant-', 'api03-'].join('') + 'A'.repeat(90);
const MARKER = ['# secret', '-scan: ', 'allow'].join('');

describe('the fixture', () => {
  fs.mkdirSync(REPO);
  git(['init', '-q', '-b', 'main', REPO], TMP);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'user.name', 'Alex Kit']);
  git(['config', 'user.email', 'alex-kit@localhost']);
  git(['config', 'core.hooksPath', 'scripts/hooks']);
  fs.mkdirSync(path.join(REPO, 'scripts', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(REPO, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'secret-scan.mjs'), path.join(REPO, 'scripts', 'secret-scan.mjs'));
  // scripts/hooks/pre-commit is the Kit's gate on the Kit and the Virtual Alex variant on the online
  // tree (where this suite also runs); the variant calls scripts/employer-data-guard.mjs, which needs
  // scripts/lib/, so the fixture carries both and either hook runs end to end (with no profile the
  // employer guard says "nothing to guard" and passes, which is what this suite wants from it).
  fs.copyFileSync(path.join(KIT, 'scripts', 'hooks', 'pre-commit'), path.join(REPO, 'scripts', 'hooks', 'pre-commit'));
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'employer-data-guard.mjs'),
    path.join(REPO, 'scripts', 'employer-data-guard.mjs')
  );
  for (const f of fs.readdirSync(path.join(KIT, 'scripts', 'lib')).filter((n) => n.endsWith('.js')))
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(REPO, 'scripts', 'lib', f));
  fs.chmodSync(path.join(REPO, 'scripts', 'hooks', 'pre-commit'), 0o755);
  fs.copyFileSync(path.join(KIT, '.gitleaks.toml'), path.join(REPO, '.gitleaks.toml'));
  for (const stub of ['personal-data-scan.js', 'clone-scrub-check.js', 'validate-alex.js']) {
    write(`scripts/${stub}`, `// stub for the secret-scan test: this leg is not under test here\nprocess.exit(0);\n`);
  }
  write('vault/log.md', '# Log\n');
  git(['add', '-A']);
  const seed = git(['commit', '-qm', 'seed']);
  show('seed commit hook output', `${seed.stdout}${seed.stderr}`);
  ok(
    seed.status === 0,
    'P0 the seed commit passes the real hook (the scanner scanned its own staged source)',
    `exit ${seed.status}`
  );
  ok(
    /secret-scan staged scan clean/.test(`${seed.stdout}${seed.stderr}`),
    'P0 the hook printed the secret-scan pass line'
  );
  console.log(`fixture: ${REPO}`);
});

const scan = (args) => run([path.join(REPO, 'scripts', 'secret-scan.mjs'), ...args]);

// ---------------------------------------------------------------- N1: --file on a fake key
describe('N1: --file on a fake key', () => {
  write('vault/leak.md', `# Notes\n\nthe key is ${FAKE}\n`);
  const r = scan(['--file', 'vault/leak.md']);
  show('stdout', r.stdout);
  show('stderr', r.stderr);
  ok(r.status === 2, 'N1 NEGATIVE --file on a fake Anthropic key exits 2', `exit ${r.status}`);
  ok(/^secret-scan: vault\/leak\.md:3 anthropic-api-key$/m.test(r.stdout), 'N1 the hit names file, line and pattern');
  ok(
    !`${r.stdout}${r.stderr}`.includes(FAKE) && !`${r.stdout}${r.stderr}`.includes('AAAAAAAA'),
    'N1 the value is never printed'
  );
});

// ---------------------------------------------------------------- N2: --staged and the hook
describe('N2: --staged and the hook', () => {
  git(['add', 'vault/leak.md']);
  const r = scan(['--staged']);
  show('stdout', r.stdout);
  show('stderr', r.stderr);
  ok(r.status === 2, 'N2 NEGATIVE --staged on the same file exits 2', `exit ${r.status}`);
  ok(/^secret-scan: vault\/leak\.md:3 anthropic-api-key$/m.test(r.stdout), 'N2 the same hit line in staged mode');
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'leak']);
  show('commit stderr', c.stderr);
  ok(c.status !== 0, 'N2 NEGATIVE the commit is BLOCKED by the hook', `exit ${c.status}`);
  ok(/BLOCKED - secret-scan/.test(c.stderr), 'N2 the block names the secret-scan leg');
  ok(gitOut(['rev-parse', 'HEAD']) === before, 'N2 HEAD did not move');
  ok(!c.stderr.includes(FAKE), 'N2 the hook output never carries the value');
});

// ---------------------------------------------------------------- N2b: a staged path literally named
// "0:<name>". `git show :<path>` reads a path that starts with `0:` as a stage number, so a staged file
// named `0:s7-clean.md` would be read as stage 0 of `s7-clean.md`, dropping its own `0:` prefix and
// reading a different file's content under this one's name. The scanner reads `git show :0:<path>`
// (stage 0, explicit) instead, which is unambiguous for every path, colon or not.
// Windows git refuses a colon in a path even through --cacheinfo (no working-tree file is ever
// created), so this case is built with a harmless, git-only probe first; if that is refused, the case
// is skipped with a one-line reason, exactly as it would be on any Windows checkout, and is not counted
// as a failure.
describe('N2b: a staged path literally named "0:<name>"', () => {
  write('s7-clean.md', '# S7\n\nnothing here.\n');
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: REPO,
    input: `# Notes\n\nthe key is ${FAKE}\n`,
    encoding: 'utf8'
  }).stdout.trim();
  const probe = git([
    '-c',
    'core.protectNTFS=false',
    'update-index',
    '--add',
    '--cacheinfo',
    `100644,${blob},0:s7-clean.md`
  ]);
  if (probe.status !== 0) {
    console.log(
      'SKIP  N2b a staged path literally named "0:<name>" (Windows git refuses the colon in a path, even through --cacheinfo; the case runs on macOS and Linux only)'
    );
  } else {
    git(['add', 's7-clean.md']);
    const r = scan(['--staged']);
    show('stdout (N2b)', r.stdout);
    show('stderr (N2b)', r.stderr);
    ok(
      r.status === 2,
      'N2b NEGATIVE the staged 0:s7-clean.md (holding the real key) is caught, not read as the clean s7-clean.md',
      `exit ${r.status}`
    );
    ok(
      /^secret-scan: 0:s7-clean\.md:3 anthropic-api-key$/m.test(r.stdout),
      'N2b the hit is attributed to the path literally named 0:s7-clean.md',
      r.stdout
    );
    ok(
      !/^secret-scan: s7-clean\.md:/m.test(r.stdout),
      'N2b NEGATIVE the clean s7-clean.md itself reports no hit (it really is clean)',
      r.stdout
    );
    git(['reset', '-q']);
  }
  fs.rmSync(path.join(REPO, 's7-clean.md'), { force: true });
});

// ---------------------------------------------------------------- P1: the allow marker
describe('P1: the allow marker', () => {
  write('vault/leak.md', `# Notes\n\nthe key is ${FAKE}  ${MARKER}\n`);
  const f = scan(['--file', 'vault/leak.md']);
  ok(f.status === 0, 'P1 the same line with the allow marker passes --file', `exit ${f.status}`);
  git(['add', 'vault/leak.md']);
  const s = scan(['--staged']);
  ok(s.status === 0, 'P1 the same line with the allow marker passes --staged', `exit ${s.status}`);
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'allowed']);
  show('commit output', `${c.stdout}${c.stderr}`);
  ok(
    c.status === 0 && gitOut(['rev-parse', 'HEAD']) !== before,
    'P1 the commit with the marked line passes the hook',
    `exit ${c.status}`
  );
});

// ---------------------------------------------------------------- P2: the scanner on its own source
describe('P2: the scanner on its own source', () => {
  const r = scan(['--file', path.join(KIT, 'scripts', 'secret-scan.mjs')]);
  show('stdout', r.stdout);
  show('stderr', r.stderr);
  ok(r.status === 0, 'P2 the scanner scanning its own source passes', `exit ${r.status}`);
  const t = scan(['--file', fileURLToPath(import.meta.url)]);
  ok(t.status === 0, 'P2 the scanner scanning this test passes', `exit ${t.status}`);
});

// ---------------------------------------------------------------- P3: a clean file, both modes, and the commit
describe('P3: a clean file, both modes, and the commit', () => {
  write('vault/clean.md', '# Clean\n\nA page with nothing in it.\n');
  ok(scan(['--file', 'vault/clean.md']).status === 0, 'P3 a clean file passes --file');
  git(['add', 'vault/clean.md']);
  ok(scan(['--staged']).status === 0, 'P3 a clean file passes --staged');
  const c = git(['commit', '-qm', 'clean']);
  ok(c.status === 0, 'P3 the clean commit passes the hook', `exit ${c.status}`);
});

// ---------------------------------------------------------------- P4: the canary line and a placeholder are not secrets
describe('P4: the canary line and a placeholder are not secrets', () => {
  // assembled: the exception is exact-shape (the whole line), so this source line must not carry it.
  // The value is a fixture, never a token copied from a live soul.md: a real one is a trace of that
  // person's system in every tree this file ships in, and a repeated pattern cannot be one.
  const CANARY_FIXTURE = 'c0de'.repeat(4);
  ok(
    /^([0-9a-f]{2,4})\1+$/.test(CANARY_FIXTURE),
    'P4 NEGATIVE-GUARD the canary fixture is a repeated pattern, never a token copied from a live soul.md'
  );
  const canaryLine = ['SOUL-CANARY', '-TOKEN: ', CANARY_FIXTURE].join('');
  write('soul.md', `# Soul\n\n## Headless injection check\n${canaryLine}\n\n## My Words\n`);
  const r = scan(['--file', 'soul.md']);
  show('stdout', r.stdout);
  ok(r.status === 0, 'P4 the documented SOUL-CANARY-TOKEN line passes (soul.md autosaves online)', `exit ${r.status}`);
  write('docs/token.md', `token: ${CANARY_FIXTURE}\n`);
  ok(
    scan(['--file', 'docs/token.md']).status === 2,
    'P4 NEGATIVE the same value on a line that is not the canary line is a hit, so the pass above is the carve-out and not the value'
  );
  write('docs/example.md', 'encryption_key="your-32-byte-encryption-key-here"\n');
  ok(scan(['--file', 'docs/example.md']).status === 0, 'P4 a placeholder value in an assignment passes');
  write('docs/real.md', `encryption_key="${'q7'.repeat(12)}"\n`);
  const h = scan(['--file', 'docs/real.md']);
  ok(
    h.status === 2 && /assigned-secret/.test(h.stdout),
    'P4 NEGATIVE an opaque value in the same assignment shape is still a hit'
  );
});

// ---------------------------------------------------------------- N5: a quoted key (JSON and the like)
// The Kit's configuration is JSON, where the key is quoted: the generic rule reads a quote after the
// key word the way it reads the plain form, and the placeholder and marker exceptions hold there too.
describe('N5: a quoted key (JSON and the like)', () => {
  const opaque = 'q7'.repeat(12);
  write('system/cfg.json', `{\n  "api_key": "${opaque}"\n}\n`);
  const r = scan(['--file', 'system/cfg.json']);
  show('stdout', r.stdout);
  ok(
    r.status === 2 && /^secret-scan: system\/cfg\.json:2 assigned-secret$/m.test(r.stdout),
    'N5 NEGATIVE a JSON-quoted key with an opaque value is an assigned-secret hit',
    `exit ${r.status}`
  );
  ok(!`${r.stdout}${r.stderr}`.includes(opaque), 'N5 the value is never printed');
  write('docs/cfg.py', `cfg = {'client_secret': '${opaque}'}\n`);
  ok(scan(['--file', 'docs/cfg.py']).status === 2, 'N5 NEGATIVE a single-quoted key is a hit too');
  write('docs/cfg-example.json', '{ "api_key": "your-api-key-goes-here" }\n');
  ok(scan(['--file', 'docs/cfg-example.json']).status === 0, 'N5 a placeholder value under a quoted key passes');
  write('docs/cfg-marked.json', `{ "api_key": "${opaque}", "note": "${MARKER}" }\n`);
  ok(scan(['--file', 'docs/cfg-marked.json']).status === 0, 'N5 the allow marker on a quoted-key line passes');
  git(['add', 'system/cfg.json']);
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'json key']);
  show('commit stderr', c.stderr);
  ok(
    c.status !== 0 && /BLOCKED - secret-scan/.test(c.stderr) && gitOut(['rev-parse', 'HEAD']) === before,
    'N5 NEGATIVE the hook blocks a commit of the JSON file on its secret-scan leg',
    `exit ${c.status}`
  );
  git(['reset', '-q']);
});

// ---------------------------------------------------------------- N3: the size guard leg of the hook
describe('N3: the size guard leg of the hook', () => {
  fs.writeFileSync(path.join(REPO, 'vault', 'scan.pdf'), Buffer.alloc(MAX + 1, 0x41));
  write('vault/small.md', '# Small\n');
  git(['add', 'vault/scan.pdf', 'vault/small.md']);
  const before = gitOut(['rev-parse', 'HEAD']);
  const c = git(['commit', '-qm', 'big']);
  show('commit stderr', c.stderr);
  ok(c.status !== 0, 'N3 NEGATIVE a staged 10 MB + 1 byte file is BLOCKED by the size leg', `exit ${c.status}`);
  ok(
    new RegExp(`vault/scan\\.pdf is ${MAX + 1} bytes, over the ${MAX} byte size guard`).test(c.stderr),
    'N3 the block names the path, its size and the limit'
  );
  ok(gitOut(['rev-parse', 'HEAD']) === before, 'N3 HEAD did not move');
  git(['reset', '-q', 'vault/scan.pdf']);
  fs.unlinkSync(path.join(REPO, 'vault', 'scan.pdf'));
  const c2 = git(['commit', '-qm', 'small']);
  ok(c2.status === 0, 'N3 with the big file unstaged the small one commits', `exit ${c2.status}`);
});

// ---------------------------------------------------------------- N4: the error paths are exit 1, never 0
describe('N4: the error paths are exit 1, never 0', () => {
  ok(scan([]).status === 1, 'N4 NEGATIVE no mode exits 1');
  ok(scan(['--file', 'vault/does-not-exist.md']).status === 1, 'N4 NEGATIVE a missing file exits 1');
  const r = run([path.join(REPO, 'scripts', 'secret-scan.mjs'), '--staged'], TMP);
  ok(r.status === 1, 'N4 NEGATIVE --staged outside a repository exits 1', `exit ${r.status}`);
});

// ---------------------------------------------------------------- P5: a binary is skipped, the size guard owns blobs
describe('P5: a binary is skipped, the size guard owns blobs', () => {
  const buf = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(FAKE)]);
  fs.writeFileSync(path.join(REPO, 'vault', 'blob.bin'), buf);
  ok(scan(['--file', 'vault/blob.bin']).status === 0, 'P5 a file with a NUL byte is binary and is skipped');
});
