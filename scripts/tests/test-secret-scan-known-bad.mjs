#!/usr/bin/env node
// scripts/tests/test-secret-scan-known-bad.mjs - the secret wall, pinned as it behaves today.
//
// WHAT. Proves scripts/secret-scan.mjs against the KNOWN-BAD set (one test per pattern family, the
// smallest planted violation that makes the wall refuse, with its exit code and its refusal lines), the
// exact length each family starts at, the CLI's refusal sentences, and seven known bypasses, each pinned
// as it behaves today (its own PINNED DEFECT test below names the id; NEVER lists what each is). Deleted,
// it would let a rewrite silently narrow or widen what the wall refuses: the known-bad set is the floor,
// and the PINNED bypasses are the ceiling, until a FIX row moves one on purpose. Not repeated here
// (already held elsewhere): the hook end to end, the allow marker on the line, the canary line in its
// exact form, the JSON-quoted key cases and the canary fixture guard (test-secret-scan.mjs, N1-N5, P1-P5).
//
// HOW. Every credential shape is ASSEMBLED at run time from fragments, so this file never carries one.
// Every fixture lives in a throwaway git repository under the OS temp folder, removed at the end; git
// runs with no system or global configuration. Nothing reaches a network.
//
// NEVER. Writes outside its own temp folder. Flips a PINNED DEFECT assertion on its own; each pins
// today's behaviour until a FIX row in the ratchet changes it. R7-14: a UTF-16 file is read as binary and
// skipped, by --file and by --staged. R7-17: a TYPE CHANGE (a tracked symlink replaced by a file carrying
// a key) is never read by --staged. R7-21: a staged gitlink makes git show fail, so --staged exits 1 with
// git's raw error. R7-9: the same scanner run under another file name scans nothing and exits 0. R7-13:
// the generic rule judges only the first match on a line, passes a value with "/" or "+" in its first 16
// characters, and passes a PGP private-key block whose type word is not RSA. R7-SS-GAPS: several
// credential shapes no pattern covers pass (OpenAI and Stripe prefixes, an AWS STS id, a Slack refresh
// token, a Bearer value, DB_PASS, passwd, a value opening with "Test"). R7-SS-FP: a word that merely ends
// in "key" before an opaque value is refused as a false positive.
//
// Usage: node scripts/tests/test-secret-scan-known-bad.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-ss-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const j = (...parts) => parts.join('');
const MARK = j('# secret', '-scan: ', 'allow');
const REFUSAL = (n) =>
  `secret-scan: ${n} hit(s); the value is never printed. Remove it, rotate it if it was real, or put the marker on that line to accept a reviewed exception.\n`;
const USAGE = 'secret-scan: usage: node scripts/secret-scan.mjs --file <path> | --staged\n';

// ---------------------------------------------------------------- environment and fixture
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_CEILING_DIRECTORIES: TMP, ...extra };
}
function git(cwd, args, input) {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=c5', '-c', 'user.email=c5@localhost', '-c', 'core.autocrlf=false', ...args],
    { cwd, env: childEnv(), encoding: 'utf8', input }
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
let n = 0;
function repo() {
  const dir = path.join(TMP, `r${++n}`);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  fs.copyFileSync(path.join(KIT, 'scripts', 'secret-scan.mjs'), path.join(dir, 'scripts', 'secret-scan.mjs'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'seed']);
  return dir;
}
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function scan(dir, args, script = path.join(dir, 'scripts', 'secret-scan.mjs')) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: childEnv(), encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// The ten families, each with the SMALLEST value the pattern refuses (its minimum length exactly).
const FAMILIES = [
  ['anthropic-api-key', 'key ' + j('sk-', 'ant-', 'A'.repeat(20))],
  ['github-token', 'token ' + j('gh', 'p_', 'A1'.repeat(10))],
  ['github-fine-grained-token', 'token ' + j('github', '_pat_', 'A1'.repeat(10))],
  ['aws-access-key', 'id ' + j('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
  ['google-api-key', 'maps ' + j('AI', 'za', 'B'.repeat(35))],
  ['google-oauth-client-secret', 'client ' + j('GOC', 'SPX-', 'C'.repeat(20))],
  ['private-key-block', j('-----BEGIN ', 'PRIVATE', ' KEY-----')],
  ['slack-token', 'bot ' + j('xo', 'xb-', '1234567890')],
  ['jwt', 'bearer ' + j('ey', 'J', 'a'.repeat(10), '.', 'ey', 'J', 'b'.repeat(10))],
  ['assigned-secret', j('encryption', '_key = "', 'q7'.repeat(8), '"')]
];
const VALUE_TAIL = { 'private-key-block': 'PRIVATE' }; // the part of each plant that must never be printed

// ---------------------------------------------------------------- the KNOWN-BAD set
for (const [family, line] of FAMILIES) {
  test(`KNOWN-BAD secret-scan ${family}: the smallest planted value on line 2 refuses --file and --staged with exit 2, one hit line and the refusal line`, () => {
    const dir = repo();
    const rel = `docs/zz-${family}.md`;
    put(dir, rel, `# ${family}\n${line}\n`);
    const f = scan(dir, ['--file', rel]);
    assert.equal(f.status, 2);
    assert.equal(f.stdout, `secret-scan: ${rel}:2 ${family}\n`);
    assert.equal(f.stderr, REFUSAL(1));
    const secretPart = VALUE_TAIL[family] || line.split(/[ =]/).pop().replace(/"/g, '');
    assert.ok(!`${f.stdout}${f.stderr}`.includes(secretPart), 'the value is never printed');
    git(dir, ['add', rel]);
    const s = scan(dir, ['--staged']);
    assert.equal(s.status, 2);
    assert.equal(s.stdout, `secret-scan: ${rel}:2 ${family}\n`);
    assert.equal(s.stderr, REFUSAL(1));
  });
}

test('KNOWN-BAD secret-scan, the whole set staged at once: one line per family in path order, one refusal line counting ten', () => {
  const dir = repo();
  for (const [family, line] of FAMILIES) put(dir, `docs/zz-${family}.md`, `# ${family}\n${line}\n`);
  git(dir, ['add', 'docs']);
  const s = scan(dir, ['--staged']);
  assert.equal(s.status, 2);
  const expected = FAMILIES.map(([f]) => [`docs/zz-${f}.md`, f])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([p, f]) => `secret-scan: ${p}:2 ${f}\n`)
    .join('');
  assert.equal(s.stdout, expected);
  assert.equal(s.stderr, REFUSAL(10));
});

test('each family starts at exactly its documented length: one character shorter passes, and the AWS key id needs a word boundary after sixteen', () => {
  const short = [
    ['anthropic-api-key', 'key ' + j('sk-', 'ant-', 'A'.repeat(19))],
    ['github-token', 'token ' + j('gh', 'p_', 'A'.repeat(19))],
    ['github-fine-grained-token', 'token ' + j('github', '_pat_', 'A'.repeat(19))],
    ['aws-access-key', 'id ' + j('AK', 'IA', 'ABCDEFGHIJKLMNO')],
    ['google-api-key', 'maps ' + j('AI', 'za', 'B'.repeat(34))],
    ['google-oauth-client-secret', 'client ' + j('GOC', 'SPX-', 'C'.repeat(19))],
    ['slack-token', 'bot ' + j('xo', 'xb-', '123456789')],
    ['jwt', 'bearer ' + j('ey', 'J', 'a'.repeat(9), '.', 'ey', 'J', 'b'.repeat(10))],
    ['assigned-secret', j('encryption', '_key = "', 'q7'.repeat(7), 'q', '"')]
  ];
  const dir = repo();
  for (const [family, line] of short) {
    put(dir, 'docs/zz-short.md', `${line}\n`);
    const r = scan(dir, ['--file', 'docs/zz-short.md']);
    assert.equal(r.status, 0, `${family} one short`);
    assert.equal(r.stdout, '');
  }
  put(dir, 'docs/zz-aws17.md', `id ${j('AK', 'IA', 'ABCDEFGHIJKLMNOPQ')}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-aws17.md']).status,
    0,
    'seventeen characters after the prefix: no word boundary, no hit'
  );
  put(dir, 'docs/zz-aiza36.md', `maps ${j('AI', 'za', 'B'.repeat(36))}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-aiza36.md']).stdout,
    'secret-scan: docs/zz-aiza36.md:1 google-api-key\n',
    'the Google key has no end boundary: 36 still hits'
  );
});

test('line numbers count through CRLF; two families on one line give two hits in pattern order; one family twice on a line gives ONE hit', () => {
  const dir = repo();
  const akia = j('AK', 'IA', 'ABCDEFGHIJKLMNOP');
  const ghp = j('gh', 'p_', 'A1'.repeat(10));
  put(dir, 'docs/zz-crlf.md', `a\r\nb\r\nk ${ghp}\r\n`);
  assert.equal(scan(dir, ['--file', 'docs/zz-crlf.md']).stdout, 'secret-scan: docs/zz-crlf.md:3 github-token\n');
  put(dir, 'docs/zz-two.md', `x ${ghp} ${akia}\n`);
  const two = scan(dir, ['--file', 'docs/zz-two.md']);
  assert.equal(
    two.stdout,
    'secret-scan: docs/zz-two.md:1 github-token\nsecret-scan: docs/zz-two.md:1 aws-access-key\n'
  );
  assert.equal(two.stderr, REFUSAL(2));
  put(dir, 'docs/zz-twice.md', `x ${akia} and ${akia}\n`);
  const twice = scan(dir, ['--file', 'docs/zz-twice.md']);
  assert.equal(twice.stdout, 'secret-scan: docs/zz-twice.md:1 aws-access-key\n');
  assert.equal(twice.stderr, REFUSAL(1));
});

test('the allow marker counts only on its own line and only with its space; the canary carve-out is the exact line and nothing wider', () => {
  const dir = repo();
  const akia = j('AK', 'IA', 'ABCDEFGHIJKLMNOP');
  put(dir, 'docs/zz-a2.md', `id ${akia}\n${MARK}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-a2.md']).stdout,
    'secret-scan: docs/zz-a2.md:1 aws-access-key\n',
    'the marker on the NEXT line exempts nothing'
  );
  put(dir, 'docs/zz-a3.md', `id ${akia}  ${MARK.replace('# ', '#')}\n`);
  assert.equal(scan(dir, ['--file', 'docs/zz-a3.md']).status, 2, 'the marker without its space exempts nothing');
  const canary = j('SOUL-CANARY', '-TOKEN: ', 'c0de'.repeat(4));
  put(dir, 'docs/zz-c2.md', `${canary} (rotated)\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-c2.md']).stdout,
    'secret-scan: docs/zz-c2.md:1 assigned-secret\n',
    'trailing text after the canary value: the carve-out no longer applies'
  );
  put(dir, 'docs/zz-c3.md', `    ${canary}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-c3.md']).stdout,
    'secret-scan: docs/zz-c3.md:1 assigned-secret\n',
    'an indented canary line is refused'
  );
});

test('placeholders: your/changeme/example/xxx and a value too short pass; the "<" alternative is dead because "<" never reaches the value group', () => {
  const dir = repo();
  put(
    dir,
    'docs/zz-p1.md',
    'api_key = your-api-key-goes-here-123\npassword = changeme12345678901\ntoken: example-token-value-abcdef\nsecret = xxxxxxxxxxxxxxxxxxxx\n'
  );
  const p1 = scan(dir, ['--file', 'docs/zz-p1.md']);
  assert.equal(p1.status, 0);
  assert.equal(p1.stdout + p1.stderr, '');
  put(dir, 'docs/zz-p2.md', 'token = short\nsecret = <your-secret-goes-here>\n');
  assert.equal(scan(dir, ['--file', 'docs/zz-p2.md']).status, 0);
  const src = fs.readFileSync(path.join(KIT, 'scripts', 'secret-scan.mjs'), 'utf8');
  assert.ok(
    src.includes("const OPAQUE = '[A-Za-z0-9_\\\\-]';"),
    'the value class holds no "<", which is why the placeholder list\'s "<" alternative can never fire'
  );
  assert.ok(src.includes('x{4,}|<)/i;'), 'the dead alternative is still in the placeholder list');
});

test('the CLI: every refusal is exit 1 with its exact sentence on stderr and nothing on stdout; nothing staged is exit 0 with no output', () => {
  const dir = repo();
  const cases = [
    [[], USAGE],
    [['--file', 'x', '--staged'], USAGE],
    [['--file'], 'secret-scan: --file needs a path\n']
  ];
  for (const [args, err] of cases) {
    const r = scan(dir, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, err);
  }
  const missing = scan(dir, ['--file', 'docs/zz-nope.md']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^secret-scan: ERROR ENOENT: no such file or directory, open '.*zz-nope\.md'\n$/);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const isDir = scan(dir, ['--file', 'docs']);
  assert.equal(isDir.status, 1);
  assert.match(isDir.stderr, /^secret-scan: ERROR EISDIR: illegal operation on a directory, read\n$/);
  const none = scan(dir, ['--staged']);
  assert.deepEqual([none.status, none.stdout, none.stderr], [0, '', '']);
  const outside = path.join(TMP, 'not-a-repo');
  fs.mkdirSync(outside, { recursive: true });
  const o = scan(outside, ['--staged'], path.join(dir, 'scripts', 'secret-scan.mjs'));
  assert.equal(o.status, 1);
  assert.match(
    o.stderr,
    /^secret-scan: ERROR git diff --cached --name-only --diff-filter=AM --no-renames -z exited 129: /
  );
});

test('the module surface: exactly isBinary, main and scanText; importing it runs nothing', async () => {
  const m = await import(pathToFileURL(path.join(KIT, 'scripts', 'secret-scan.mjs')).href);
  assert.deepEqual(Object.keys(m).sort(), ['isBinary', 'main', 'scanText']);
  assert.deepEqual(m.scanText(`a\n${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}\n`), [{ line: 2, name: 'aws-access-key' }]);
  assert.equal(m.isBinary(Buffer.from([0x41, 0x00])), true);
  assert.equal(
    m.isBinary(Buffer.concat([Buffer.alloc(8000, 0x41), Buffer.from([0])])),
    false,
    'a NUL after the first 8000 bytes is text'
  );
});

test('--staged reads a renamed-and-edited file as an add (refused), and a staged deletion of a committed key is never read (passes)', () => {
  const dir = repo();
  const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1} of a clean page`).join('\n') + '\n';
  put(dir, 'docs/zz-r.md', body);
  git(dir, ['add', 'docs/zz-r.md']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'clean page']);
  git(dir, ['mv', 'docs/zz-r.md', 'docs/zz-r2.md']);
  put(dir, 'docs/zz-r2.md', body + `id ${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}\n`);
  git(dir, ['add', 'docs/zz-r2.md']);
  assert.match(
    git(dir, ['diff', '--cached', '--name-status', '-M']),
    /^R\d+\tdocs\/zz-r\.md\tdocs\/zz-r2\.md$/m,
    'git itself sees a rename'
  );
  const r = scan(dir, ['--staged']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, 'secret-scan: docs/zz-r2.md:21 aws-access-key\n');
  git(dir, ['commit', '-q', '--no-verify', '-m', 'key committed past the gate']);
  git(dir, ['rm', '-q', 'docs/zz-r2.md']);
  assert.deepEqual([scan(dir, ['--staged']).status, scan(dir, ['--staged']).stdout], [0, '']);
});

// ---------------------------------------------------------------- known bypasses, pinned as they behave today
test('PINNED DEFECT R7-14: a UTF-16 file is read as binary and skipped, by --file and by --staged; the same text in UTF-8 is refused', () => {
  const dir = repo();
  const text = `id ${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}\n`;
  put(dir, 'docs/zz-u16.md', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  put(dir, 'docs/zz-u8.md', text);
  assert.deepEqual(
    [scan(dir, ['--file', 'docs/zz-u16.md']).status, scan(dir, ['--file', 'docs/zz-u16.md']).stdout],
    [0, '']
  );
  assert.equal(scan(dir, ['--file', 'docs/zz-u8.md']).status, 2, 'control');
  git(dir, ['add', 'docs/zz-u16.md']);
  assert.deepEqual([scan(dir, ['--staged']).status, scan(dir, ['--staged']).stdout], [0, '']);
});

test('PINNED DEFECT R7-17: a TYPE CHANGE (a tracked symlink replaced by a file carrying a key) is never read by --staged', () => {
  const dir = repo();
  const link = git(dir, ['hash-object', '-w', '--stdin'], 'target.md').trim();
  git(dir, ['update-index', '--add', '--cacheinfo', `120000,${link},docs/zz-link.md`]);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'a symlink entry']);
  const blob = git(dir, ['hash-object', '-w', '--stdin'], `id ${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}\n`).trim();
  git(dir, ['update-index', '--cacheinfo', `100644,${blob},docs/zz-link.md`]);
  assert.equal(git(dir, ['diff', '--cached', '--name-status']).trim(), 'T\tdocs/zz-link.md');
  const r = scan(dir, ['--staged']);
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
});

test("PINNED DEFECT R7-21: a staged gitlink (a submodule entry) makes git show fail, so --staged exits 1 with git's raw error and would block a legitimate submodule commit", () => {
  const dir = repo();
  git(dir, ['update-index', '--add', '--cacheinfo', `160000,${'1234567890'.repeat(4)},vendor/zz-sub`]);
  const r = scan(dir, ['--staged']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  // The wall's --staged reader runs `git show :0:<path>` (stage 0, explicit) rather than the ambiguous
  // `git show :<path>`, so git's own error names the same argument the wall actually passed. The gitlink
  // defect itself is unchanged: a staged gitlink still cannot be `git show`n at all.
  assert.match(r.stderr, /^secret-scan: ERROR git show :0:vendor\/zz-sub exited 128: fatal: /);
});

test('PINNED DEFECT R7-9: the same scanner run under another file name scans nothing and exits 0, even with a key planted and no mode given', () => {
  const dir = repo();
  put(dir, 'docs/zz-key.md', `# k\nid ${j('AK', 'IA', 'ABCDEFGHIJKLMNOP')}\n`);
  assert.equal(scan(dir, ['--file', 'docs/zz-key.md']).status, 2, 'control: under its own name it refuses');
  const copy = path.join(TMP, `scan-copy-${n}.mjs`);
  fs.copyFileSync(path.join(dir, 'scripts', 'secret-scan.mjs'), copy);
  for (const args of [['--file', 'docs/zz-key.md'], []]) {
    const r = scan(dir, args, copy);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], args.join(' ') || '(no mode)');
  }
});

test('PINNED DEFECT R7-13: a placeholder earlier on the line hides a real assignment after it (only the first match of the generic rule is judged)', () => {
  const dir = repo();
  const opaque = 'q7'.repeat(12);
  put(dir, 'docs/zz-first.md', `token=your-placeholder-value-x password=${opaque}\n`);
  assert.deepEqual(
    [scan(dir, ['--file', 'docs/zz-first.md']).status, scan(dir, ['--file', 'docs/zz-first.md']).stdout],
    [0, '']
  );
  put(dir, 'docs/zz-second.md', `password=${opaque} token=your-placeholder-value-x\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-second.md']).stdout,
    'secret-scan: docs/zz-second.md:1 assigned-secret\n',
    'control: the same pair in the other order'
  );
});

test('PINNED DEFECT R7-13: a value with "/" or "+" in its first 16 characters (about 40% of AWS secret keys) passes the generic rule', () => {
  const dir = repo();
  put(
    dir,
    'docs/zz-slash.md',
    `aws_secret_access_key = ${j('wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCY', 'Z'.repeat(10))}\n`
  );
  assert.deepEqual(
    [scan(dir, ['--file', 'docs/zz-slash.md']).status, scan(dir, ['--file', 'docs/zz-slash.md']).stdout],
    [0, '']
  );
  put(dir, 'docs/zz-noslash.md', `aws_secret_access_key = ${j('wJalrXUtnFEMIK7MDENGbPxRfiCY', 'Z'.repeat(10))}\n`);
  assert.equal(scan(dir, ['--file', 'docs/zz-noslash.md']).status, 2, 'control: the same value without the slashes');
});

test('PINNED DEFECT R7-13: a PGP private key block passes; the private-key pattern needs "PRIVATE KEY-----" right after the type word', () => {
  const dir = repo();
  put(dir, 'docs/zz-pgp.md', `${j('-----BEGIN ', 'PGP ', 'PRIVATE', ' KEY BLOCK-----')}\n`);
  assert.deepEqual(
    [scan(dir, ['--file', 'docs/zz-pgp.md']).status, scan(dir, ['--file', 'docs/zz-pgp.md']).stdout],
    [0, '']
  );
  put(dir, 'docs/zz-rsa.md', `${j('-----BEGIN ', 'RSA ', 'PRIVATE', ' KEY-----')}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-rsa.md']).stdout,
    'secret-scan: docs/zz-rsa.md:1 private-key-block\n',
    'control'
  );
});

test('PINNED DEFECT R7-SS-GAPS: credential shapes no pattern covers pass (OpenAI and Stripe prefixes, an AWS STS id, a Slack refresh token, a Bearer value, DB_PASS, passwd, a value opening with "Test"); an env-style OpenAI key is caught only by the generic rule', () => {
  const dir = repo();
  const opaque = 'q7'.repeat(12);
  const openai = j('sk-', 'proj-', 'Ab3'.repeat(20));
  const walkPast = {
    'openai-bare': `key ${openai}`,
    'stripe-bare': `key ${j('sk_', 'live_', 'Ab3'.repeat(10))}`,
    'aws-sts': `id ${j('AS', 'IA', 'ABCDEFGHIJKLMNOP')}`,
    'slack-xoxe': `refresh ${j('xo', 'xe-', '1234567890', 'abcdefghij')}`,
    bearer: `Authorization: Bearer ${opaque}`,
    'db-pass': `DB_PASS=${opaque}`,
    passwd: `passwd: ${opaque}`,
    'test-prefixed-value': `password = Testing${opaque}`
  };
  for (const [name, line] of Object.entries(walkPast)) {
    put(dir, `docs/zz-${name}.md`, `${line}\n`);
    const r = scan(dir, ['--file', `docs/zz-${name}.md`]);
    assert.deepEqual([r.status, r.stdout], [0, ''], name);
  }
  put(dir, 'docs/zz-openai-env.md', `OPENAI_API_KEY=${openai}\n`);
  assert.equal(
    scan(dir, ['--file', 'docs/zz-openai-env.md']).stdout,
    'secret-scan: docs/zz-openai-env.md:1 assigned-secret\n'
  );
});

test('PINNED DEFECT R7-SS-FP: a word that merely ends in "key" before an opaque value is refused (monkey = ...)', () => {
  const dir = repo();
  put(dir, 'docs/zz-monkey.md', j('mon', 'key = ', 'abcdefghij', 'klmnopq', '\n')); // assembled: the plain line would refuse this file
  const r = scan(dir, ['--file', 'docs/zz-monkey.md']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, 'secret-scan: docs/zz-monkey.md:1 assigned-secret\n');
});
