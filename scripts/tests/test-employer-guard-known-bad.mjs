#!/usr/bin/env node
// scripts/tests/test-employer-guard-known-bad.mjs - the employer-data wall, pinned as it behaves today.
//
// WHAT. Proves scripts/employer-data-guard.mjs against the KNOWN-BAD set (one test per leg, the smallest
// planted violation, its exit code and its refusal lines, in --file and in --staged), the CLI's exact
// sentences and flag-order quirks, the profile variants, the allowlist the CLI writes byte for byte, and
// eleven known bypasses, each pinned as it behaves today (its own PINNED DEFECT test below names the id;
// NEVER lists what each is). Deleted, it would let a rewrite silently narrow or widen what the guard
// refuses. Not repeated here (already held by test-employer-data-guard.mjs): the online hook end to end,
// the owner address in any case, a subdomain, a longer domain, a trailing period, the dashed ten- and
// twelve-digit numbers, the dashless numbers and check digit, the reasonless row and foreign schema.
//
// HOW. Every personal identity number is ASSEMBLED at run time from fragments, so no line of this file
// carries one (T0 in test-employer-data-guard.mjs scans every tracked file for the shape). The employer
// domain is a reserved example domain and every address is invented. Fixtures live in throwaway git
// repositories under the OS temp folder; git runs with no system or global configuration.
//
// NEVER. Writes outside its own temp folder. Flips a PINNED DEFECT assertion on its own; each pins
// today's behaviour until a FIX row in the ratchet changes it. R7-8: the allowlist is read from the
// WORKING TREE while the content is read from the index, so a row written and never staged lets a staged
// colleague page pass --staged. R7-14: a UTF-16 file carrying an address and a number is read as binary
// and passes. R7-16: every file under .claude/skills/ and .agents/skills/ is skipped by the content legs.
// R7-PN-SEP: a personnummer separated by a space or an en dash passes. R7-ADDR-SPELLED: an address spelled
// with [at] or %40 passes the address leg. R7-EXPORT-SCOPE: .xlsm, .ods and .tsv under vault/, a capital
// Vault/, a csv under outputs/ and one at the root all pass the export leg. R7-17: a TYPE CHANGE (a
// tracked symlink replaced by a file carrying an address and a number) is never read by --staged. R7-20: a
// YYYYMMDD-HHMM stamp in a file name reads as a personnummer, and this leg has no allowlist. R7-21: a
// staged gitlink makes git show fail, so --staged exits 1 with git's raw error. R7-9: the same guard run
// under another file name checks nothing and exits 0. R7-NONARRAY: an allowlist whose addresses field is
// not an array is read as empty with no error, so every reviewed exception silently vanishes.
//
// Usage: node scripts/tests/test-employer-guard-known-bad.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// realpathSync.native, not realpathSync: where the temp folder is reached through an 8.3 short name (a
// Windows runner's C:\Users\RUNNER~1\...), the JavaScript realpath keeps the short form while git reports
// the long one from --show-toplevel, so a path built from TMP would not sit under the root git names.
const TMP = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-edg-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const DOMAIN = 'acme.example';
const OWNER = 'Robin.Owner@acme.example';
const COLLEAGUE = 'firstname.lastname@acme.example';
const PN10 = ['850101', '1234'].join('-');
const REFUSAL = (n) =>
  `employer-data-guard: ${n} hit(s); the value is never printed. Employer data stays out of the vault: remove it, or record a reviewed exception with its reason through this script (legs 1 and 3 only).\n`;
const DISARMED =
  'employer-data-guard: leg 1 (employer address) disarmed: no employer recorded in system/install-profile.json (employer_domain and owner_work_address are both empty); legs 2 (personnummer) and 3 (spreadsheet export) still run\n';
const USAGE =
  'employer-data-guard: usage: node scripts/employer-data-guard.mjs --file <path> | --staged | --init-allowlist | --allow-address <a> --reason <r> | --allow-path <p> --reason <r>\n';
const PURPOSE =
  'Reviewed exceptions for scripts/employer-data-guard.mjs: addresses at the employer domain and spreadsheet paths under vault/ or inbox/ that somebody looked at and decided are fine, each with its reason written down.';

// ---------------------------------------------------------------- environment and fixture
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '');
function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/.test(k)) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_CEILING_DIRECTORIES: TMP };
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
function put(dir, rel, content) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function profileText(domain, owner) {
  return `{\n  "employer_domain": ${JSON.stringify(domain)},\n  "owner_work_address": ${JSON.stringify(owner)},\n  "locale": "en"\n}\n`;
}
let n = 0;
// armed = the profile names the employer; false = no profile file at all
function repo(armed = true) {
  const dir = path.join(TMP, `r${++n}`);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'employer-data-guard.mjs'),
    path.join(dir, 'scripts', 'employer-data-guard.mjs')
  );
  for (const lib of ['json-writer.js', 'args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', lib), path.join(dir, 'scripts', 'lib', lib));
  }
  if (armed) put(dir, 'system/install-profile.json', profileText(DOMAIN, OWNER));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'seed']);
  return dir;
}
function guard(dir, args, script = path.join(dir, 'scripts', 'employer-data-guard.mjs'), cwd = dir) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: childEnv(), encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const quiet = (r) => [r.status, r.stdout, r.stderr];

// ---------------------------------------------------------------- the KNOWN-BAD set
test('KNOWN-BAD employer-data-guard employer-address: one colleague address on line 2 refuses --file and --staged with exit 2, the hit line and the refusal line, never the address', () => {
  const dir = repo();
  put(dir, 'docs/zz-e.md', `# a page\nmail a@${DOMAIN}\n`);
  const f = guard(dir, ['--file', 'docs/zz-e.md']);
  assert.deepEqual(quiet(f), [2, 'employer-data-guard: docs/zz-e.md:2 employer-address\n', REFUSAL(1)]);
  assert.ok(!`${f.stdout}${f.stderr}`.includes(`a@${DOMAIN}`));
  git(dir, ['add', 'docs/zz-e.md']);
  assert.deepEqual(quiet(guard(dir, ['--staged'])), [
    2,
    'employer-data-guard: docs/zz-e.md:2 employer-address\n',
    REFUSAL(1)
  ]);
});

test('KNOWN-BAD employer-data-guard personnummer: the separated ten-digit shape on line 2 refuses with no profile at all (leg 1 disarmed, said once), --file and --staged', () => {
  const dir = repo(false);
  put(dir, 'docs/zz-pn.md', `# hr\nid ${PN10}\n`);
  const f = guard(dir, ['--file', 'docs/zz-pn.md']);
  assert.deepEqual(quiet(f), [2, DISARMED + 'employer-data-guard: docs/zz-pn.md:2 personnummer\n', REFUSAL(1)]);
  assert.ok(!f.stdout.includes('850101'), 'the number is never printed');
  git(dir, ['add', 'docs/zz-pn.md']);
  assert.deepEqual(quiet(guard(dir, ['--staged'])), [
    2,
    DISARMED + 'employer-data-guard: docs/zz-pn.md:2 personnummer\n',
    REFUSAL(1)
  ]);
});

test('KNOWN-BAD employer-data-guard spreadsheet-export: a one-byte csv under vault/ refuses on its path with the (path) line, --file and --staged', () => {
  const dir = repo();
  put(dir, 'vault/zz.csv', 'x\n');
  assert.deepEqual(quiet(guard(dir, ['--file', 'vault/zz.csv'])), [
    2,
    'employer-data-guard: vault/zz.csv spreadsheet-export (path)\n',
    REFUSAL(1)
  ]);
  git(dir, ['add', '-f', 'vault/zz.csv']);
  assert.deepEqual(quiet(guard(dir, ['--staged'])), [
    2,
    'employer-data-guard: vault/zz.csv spreadsheet-export (path)\n',
    REFUSAL(1)
  ]);
});

test('every leg reports on the same run: an address and a number on one line give two hits, two addresses on a line give one, .xls and a nested vault/ path refuse, outputs/ does not', () => {
  const dir = repo();
  put(dir, 'docs/zz-both.md', `x@${DOMAIN} ${PN10}\n`);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-both.md'])), [
    2,
    'employer-data-guard: docs/zz-both.md:1 employer-address\nemployer-data-guard: docs/zz-both.md:1 personnummer\n',
    REFUSAL(2)
  ]);
  put(dir, 'docs/zz-two.md', `a@${DOMAIN}, b@${DOMAIN}\n`);
  assert.equal(
    guard(dir, ['--file', 'docs/zz-two.md']).stdout,
    'employer-data-guard: docs/zz-two.md:1 employer-address\n'
  );
  put(dir, 'vault/zz.xls', 'x\n');
  put(dir, 'vault/sub/zz.pbix', 'x\n');
  put(dir, 'outputs/zz.xlsx', 'x\n');
  assert.equal(guard(dir, ['--file', 'vault/zz.xls']).status, 2);
  assert.equal(
    guard(dir, ['--file', 'vault/sub/zz.pbix']).stdout,
    'employer-data-guard: vault/sub/zz.pbix spreadsheet-export (path)\n'
  );
  assert.deepEqual(quiet(guard(dir, ['--file', 'outputs/zz.xlsx'])), [0, '', '']);
});

// ---------------------------------------------------------------- the CLI
test('the CLI: every refusal is exit 1 with its exact sentence; the flag-order quirks are pinned as they are', () => {
  const dir = repo(false);
  assert.deepEqual(quiet(guard(dir, [])), [1, '', USAGE]);
  assert.deepEqual(quiet(guard(dir, ['--file'])), [1, '', USAGE], 'a trailing --file reads as absent');
  assert.deepEqual(
    quiet(guard(dir, ['--file', ''])),
    [1, DISARMED, 'employer-data-guard: --file needs a path\n'],
    'an empty path is refused AFTER the profile is read'
  );
  assert.deepEqual(
    quiet(guard(dir, ['--staged', '--file'])),
    [0, DISARMED, ''],
    '--staged with a trailing --file runs staged mode'
  );
  assert.deepEqual(
    quiet(guard(dir, ['--allow-address'])),
    [1, '', USAGE],
    'a trailing --allow-address reads as absent and falls to the scan usage'
  );
  assert.deepEqual(quiet(guard(dir, ['--allow-address', `a@${DOMAIN}`])), [
    1,
    '',
    'employer-data-guard: REFUSED - --reason is required; an entry with no reason is a hole, nothing written\n'
  ]);
  assert.deepEqual(quiet(guard(dir, ['--allow-address', '', '--reason', 'x'])), [
    1,
    '',
    'employer-data-guard: REFUSED - the value to allow is empty\n'
  ]);
  assert.deepEqual(quiet(guard(dir, ['--allow-path', ' ', '--reason', 'x'])), [
    1,
    '',
    'employer-data-guard: REFUSED - the value to allow is empty\n'
  ]);
  assert.deepEqual(quiet(guard(dir, ['--allow-address', 'not-an-address', '--reason', 'x'])), [
    1,
    '',
    'employer-data-guard: REFUSED - not an address: "not-an-address"\n'
  ]);
  const missing = guard(dir, ['--file', 'docs/zz-nope.md']);
  assert.equal(missing.status, 1);
  assert.match(
    missing.stderr,
    /^employer-data-guard: ERROR ENOENT: no such file or directory, open '.*zz-nope\.md'\n$/
  );
  assert.ok(!fs.existsSync(path.join(dir, 'system', 'employer-data-allowlist.json')), 'no refusal wrote anything');
});

test('the allowlist CLI: --init-allowlist writes the empty file once, then only reads it back; --allow-address lowercases, dedupes and re-reasons; --allow-path makes an absolute path relative and keeps ../ verbatim; with both flags only the address is written', () => {
  const dir = repo(false);
  const file = path.join(dir, 'system', 'employer-data-allowlist.json');
  const masked = () => fs.readFileSync(file, 'utf8').replace(/("_generated_at": )"[^"]*"/, '$1"<STAMP>"');
  const header = `{\n  "_generated_at": "<STAMP>",\n  "_purpose": ${JSON.stringify(PURPOSE)},\n  "_schema": "employer-data-allowlist@1",\n  "_writer": "scripts/employer-data-guard.mjs",\n`;
  const init = guard(dir, ['--init-allowlist']);
  assert.deepEqual(quiet(init), [
    0,
    'employer-data-guard: wrote the empty allowlist system/employer-data-allowlist.json (403 B, employer-data-allowlist@1)\n',
    ''
  ]);
  assert.equal(masked(), `${header}  "addresses": [],\n  "paths": []\n}\n`);
  assert.match(fs.readFileSync(file, 'utf8'), /"_generated_at": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/);
  assert.deepEqual(quiet(guard(dir, ['--init-allowlist'])), [
    0,
    'employer-data-guard: system/employer-data-allowlist.json exists and reads back under employer-data-allowlist@1\n',
    ''
  ]);
  const a = guard(dir, ['--allow-address', 'Firstname.Lastname@ACME.example', '--reason', 'a reviewed reference']);
  assert.deepEqual(quiet(a), [
    0,
    'employer-data-guard: system/employer-data-allowlist.json changed (1 address row(s), 0 path row(s), read back under employer-data-allowlist@1)\n',
    ''
  ]);
  guard(dir, ['--allow-address', 'b@acme.example', '--reason', 'first']);
  guard(dir, ['--allow-address', COLLEAGUE, '--reason', 'second reason']);
  guard(dir, ['--allow-path', path.join(dir, 'vault', 'hr.xlsx'), '--reason', 'built at home']);
  guard(dir, ['--allow-path', '../outside.csv', '--reason', 'x']);
  guard(dir, ['--allow-address', `c@${DOMAIN}`, '--allow-path', 'vault/y.csv', '--reason', 'both flags']);
  assert.equal(
    masked(),
    header +
      '  "addresses": [\n' +
      '    {\n      "address": "b@acme.example",\n      "reason": "first"\n    },\n' +
      '    {\n      "address": "firstname.lastname@acme.example",\n      "reason": "second reason"\n    },\n' +
      '    {\n      "address": "c@acme.example",\n      "reason": "both flags"\n    }\n' +
      '  ],\n' +
      '  "paths": [\n' +
      '    {\n      "path": "vault/hr.xlsx",\n      "reason": "built at home"\n    },\n' +
      '    {\n      "path": "../outside.csv",\n      "reason": "x"\n    }\n' +
      '  ]\n}\n'
  );
});

test('the profile variants: domain only flags the owner too; owner only derives the domain; a leading @, capitals, spaces and a byte-order mark are normalised', () => {
  const dir = repo();
  put(dir, 'docs/zz-owner.md', `work ${OWNER.toUpperCase()} and ${OWNER.toLowerCase()}\n`);
  put(dir, 'docs/zz-colleague.md', `mail ${COLLEAGUE}\n`);
  assert.deepEqual(
    quiet(guard(dir, ['--file', 'docs/zz-owner.md'])),
    [0, '', ''],
    'control: the owner passes under the full profile'
  );
  put(dir, 'system/install-profile.json', `{"employer_domain": "${DOMAIN}"}\n`);
  assert.equal(
    guard(dir, ['--file', 'docs/zz-owner.md']).stdout,
    'employer-data-guard: docs/zz-owner.md:1 employer-address\n',
    "no owner recorded: the owner's own address is a colleague"
  );
  put(dir, 'system/install-profile.json', `{"owner_work_address": "${OWNER}"}\n`);
  assert.equal(
    guard(dir, ['--file', 'docs/zz-colleague.md']).status,
    2,
    'the domain is derived from the owner address'
  );
  assert.equal(guard(dir, ['--file', 'docs/zz-owner.md']).status, 0);
  put(
    dir,
    'system/install-profile.json',
    `${String.fromCharCode(0xfeff)}{"employer_domain": "@ACME.Example", "owner_work_address": " ${OWNER} "}\n`
  );
  assert.equal(guard(dir, ['--file', 'docs/zz-colleague.md']).status, 2);
  assert.equal(guard(dir, ['--file', 'docs/zz-owner.md']).status, 0);
  put(dir, 'system/install-profile.json', '{"employer_domain": "", "owner_work_address": ""}\n');
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-colleague.md'])), [0, DISARMED, '']);
  put(dir, 'system/install-profile.json', '{ not json');
  const bad = guard(dir, ['--file', 'docs/zz-colleague.md']);
  assert.equal(bad.status, 1, 'a profile that is not JSON fails closed');
  assert.match(bad.stderr, /^employer-data-guard: ERROR /);
});

test("fail-closed inputs are exit 1; from outside any repository --file still works (the root falls back to the script's own checkout) while --staged is exit 1", () => {
  const dir = repo();
  put(dir, 'docs/zz-colleague.md', `mail ${COLLEAGUE}\n`);
  put(dir, 'system/employer-data-allowlist.json', '{');
  const r = guard(dir, ['--file', 'docs/zz-colleague.md']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^employer-data-guard: ERROR .*employer-data-allowlist\.json: not parseable as JSON/);
  fs.rmSync(path.join(dir, 'system', 'employer-data-allowlist.json'));
  const outside = path.join(TMP, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  const f = guard(dir, ['--file', path.join(dir, 'docs', 'zz-colleague.md')], undefined, outside);
  assert.equal(f.status, 2, "the profile of the script's own checkout armed leg 1");
  assert.match(f.stdout, /zz-colleague\.md:1 employer-address\n$/);
  const s = guard(dir, ['--staged'], undefined, outside);
  assert.equal(s.status, 1);
  assert.match(
    s.stderr,
    /^employer-data-guard: ERROR git diff --cached --name-only --diff-filter=AM --no-renames -z exited 129: /
  );
});

test('the module surface: exactly evaluate, isBinary, main, normalizePath, readAllowlist, readProfile and repoRoot; evaluate is pure and returns line 0 for the path leg', async () => {
  const m = await import(pathToFileURL(path.join(KIT, 'scripts', 'employer-data-guard.mjs')).href);
  assert.deepEqual(Object.keys(m).sort(), [
    'evaluate',
    'isBinary',
    'main',
    'normalizePath',
    'readAllowlist',
    'readProfile',
    'repoRoot'
  ]);
  const allow = { addresses: [], paths: [] };
  const profile = { domain: DOMAIN, owner: OWNER.toLowerCase() };
  assert.deepEqual(m.evaluate({ file: 'inbox/a.csv', buf: Buffer.from(`x@${DOMAIN}\n`), profile, allow }), [
    { line: 0, leg: 'spreadsheet-export' },
    { line: 1, leg: 'employer-address' }
  ]);
  assert.deepEqual(m.evaluate({ file: 'vault/a.xlsx', buf: null, profile, allow }), [
    { line: 0, leg: 'spreadsheet-export' }
  ]);
  const root = path.join(TMP, 'norm');
  assert.equal(m.normalizePath(path.join(root, 'vault', 'x.csv'), root), 'vault/x.csv');
  assert.equal(m.normalizePath('./vault/x.csv', root), 'vault/x.csv');
  assert.equal(m.normalizePath('..\\outside.csv', root), '../outside.csv');
});

// ---------------------------------------------------------------- known bypasses, pinned as they behave today
test('PINNED DEFECT R7-8: the allowlist is read from the WORKING TREE while the content is read from the index, so a row written and never staged lets a staged colleague page pass --staged', () => {
  const dir = repo();
  put(dir, 'docs/zz-x.md', `mail ${COLLEAGUE}\n`);
  git(dir, ['add', 'docs/zz-x.md']);
  assert.equal(guard(dir, ['--staged']).status, 2, 'control: blocked before the row exists');
  assert.equal(guard(dir, ['--allow-address', COLLEAGUE, '--reason', 'written, never staged']).status, 0);
  assert.equal(
    git(dir, ['diff', '--cached', '--name-only']),
    'docs/zz-x.md\n',
    'the allowlist row is not part of the commit'
  );
  assert.deepEqual(quiet(guard(dir, ['--staged'])), [0, '', '']);
  fs.rmSync(path.join(dir, 'system', 'employer-data-allowlist.json'));
  assert.equal(guard(dir, ['--staged']).status, 2, 'the next clone, without the row, refuses the same page');
});

test('PINNED DEFECT R7-14: a UTF-16 file carrying an address and a number is read as binary and passes', () => {
  const dir = repo();
  const text = `id ${PN10} mail ${COLLEAGUE}\n`;
  put(dir, 'docs/zz-u16.md', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
  put(dir, 'docs/zz-u8.md', text);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-u16.md'])), [0, '', '']);
  assert.equal(guard(dir, ['--file', 'docs/zz-u8.md']).status, 2, 'control');
});

test('PINNED DEFECT R7-16: every file under .claude/skills/ and .agents/skills/ is skipped by the content legs', () => {
  const dir = repo();
  const text = `id ${PN10} mail ${COLLEAGUE}\n`;
  put(dir, '.claude/skills/zz/notes.md', text);
  put(dir, '.agents/skills/zz/SKILL.md', text);
  put(dir, 'docs/skills/zz/notes.md', text);
  assert.deepEqual(quiet(guard(dir, ['--file', '.claude/skills/zz/notes.md'])), [0, '', '']);
  assert.deepEqual(quiet(guard(dir, ['--file', '.agents/skills/zz/SKILL.md'])), [0, '', '']);
  assert.equal(guard(dir, ['--file', 'docs/skills/zz/notes.md']).status, 2, 'control: the same text elsewhere');
});

test('PINNED DEFECT R7-PN-SEP: a personnummer separated by a space or an en dash passes', () => {
  const dir = repo();
  put(dir, 'docs/zz-space.md', `id ${['850101', '1234'].join(' ')}\n`);
  put(dir, 'docs/zz-endash.md', `id ${['850101', '1234'].join(String.fromCharCode(0x2013))}\n`);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-space.md'])), [0, '', '']);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-endash.md'])), [0, '', '']);
});

test('PINNED DEFECT R7-ADDR-SPELLED: an address spelled with [at] or %40 passes the address leg', () => {
  const dir = repo();
  put(dir, 'docs/zz-at.md', `mail firstname [at] ${DOMAIN}\n`);
  put(dir, 'docs/zz-pct.md', `mail firstname%40${DOMAIN}\n`);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-at.md'])), [0, '', '']);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-pct.md'])), [0, '', '']);
});

test('PINNED DEFECT R7-EXPORT-SCOPE: .xlsm, .ods and .tsv under vault/, a capital Vault/, a csv under outputs/ and one at the root all pass the export leg', () => {
  const dir = repo();
  for (const rel of [
    'vault/zz.xlsm',
    'vault/zz.ods',
    'vault/zz.tsv',
    'Vault/zz2.csv',
    'outputs/zz.csv',
    'zz-root.xlsx'
  ]) {
    put(dir, rel, 'x\n');
    assert.deepEqual(quiet(guard(dir, ['--file', rel])), [0, '', ''], rel);
  }
});

test('PINNED DEFECT R7-17: a TYPE CHANGE (a tracked symlink replaced by a file carrying an address and a number) is never read by --staged', () => {
  const dir = repo();
  const link = git(dir, ['hash-object', '-w', '--stdin'], 'target.md').trim();
  git(dir, ['update-index', '--add', '--cacheinfo', `120000,${link},docs/zz-link.md`]);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'a symlink entry']);
  const blob = git(dir, ['hash-object', '-w', '--stdin'], `mail ${COLLEAGUE} ${PN10}\n`).trim();
  git(dir, ['update-index', '--cacheinfo', `100644,${blob},docs/zz-link.md`]);
  assert.equal(git(dir, ['diff', '--cached', '--name-status']).trim(), 'T\tdocs/zz-link.md');
  assert.deepEqual(quiet(guard(dir, ['--staged'])), [0, '', '']);
});

test('PINNED DEFECT R7-20: a YYYYMMDD-HHMM stamp in a file name reads as a personnummer, and this leg has no allowlist', () => {
  const dir = repo();
  put(dir, 'docs/zz-stamp.md', `backup-${['20260924', '1530'].join('-')}.tar\n`);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-stamp.md'])), [
    2,
    'employer-data-guard: docs/zz-stamp.md:1 personnummer\n',
    REFUSAL(1)
  ]);
});

test("PINNED DEFECT R7-21: a staged gitlink makes git show fail, so --staged exits 1 with git's raw error", () => {
  const dir = repo();
  git(dir, ['update-index', '--add', '--cacheinfo', `160000,${'1234567890'.repeat(4)},vendor/zz-sub`]);
  const r = guard(dir, ['--staged']);
  assert.equal(r.status, 1);
  // The wall's --staged reader runs `git show :0:<path>` (stage 0, explicit) rather than the ambiguous
  // `git show :<path>`, so git's own error names the same argument the wall actually passed. The gitlink
  // defect itself is unchanged: a staged gitlink still cannot be `git show`n at all.
  assert.match(r.stderr, /^employer-data-guard: ERROR git show :0:vendor\/zz-sub exited 128: fatal: /);
});

test('PINNED DEFECT R7-9: the same guard run under another file name checks nothing and exits 0', () => {
  const dir = repo();
  put(dir, 'docs/zz-x.md', `mail ${COLLEAGUE} ${PN10}\n`);
  assert.equal(guard(dir, ['--file', 'docs/zz-x.md']).status, 2, 'control');
  const copy = path.join(dir, 'scripts', 'guard-copy.mjs');
  fs.copyFileSync(path.join(dir, 'scripts', 'employer-data-guard.mjs'), copy);
  for (const args of [['--file', 'docs/zz-x.md'], []])
    assert.deepEqual(quiet(guard(dir, args, copy)), [0, '', ''], args.join(' ') || '(no mode)');
});

test('PINNED DEFECT R7-NONARRAY: an allowlist whose addresses field is not an array is read as empty with no error, so every reviewed exception silently vanishes', () => {
  const dir = repo();
  put(dir, 'docs/zz-x.md', `mail ${COLLEAGUE}\n`);
  assert.equal(guard(dir, ['--allow-address', COLLEAGUE, '--reason', 'reviewed']).status, 0);
  assert.equal(guard(dir, ['--file', 'docs/zz-x.md']).status, 0, 'control: the row lets the page pass');
  const file = path.join(dir, 'system', 'employer-data-allowlist.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.addresses = {};
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  assert.deepEqual(quiet(guard(dir, ['--file', 'docs/zz-x.md'])), [
    2,
    'employer-data-guard: docs/zz-x.md:1 employer-address\n',
    REFUSAL(1)
  ]);
});
