#!/usr/bin/env node
// scripts/tests/test-build-soul-core-paths.mjs - characterization of scripts/lib/build-soul-core.js
// beyond test-soul-core-floor.mjs.
//
// WHAT. The CLI's three exit codes and its lines (skipped, deferred on a held lock, FAILED with the
// existing card untouched), every floor refusal, the non-repository privacy refusal, the pins and
// their log lines, the selection floor through assemble(), the stamp the sweep (C23), /status and
// /setup read, the no-op line, the size warning, an unknown CLI flag, and known defects, each pinned
// as it behaves today. Deleted, a CLI exit code or the privacy/floor refusals could silently drift
// with nothing to catch it.
//
// HOW. The builder and its write-lock are copied into throwaway git repositories this file deletes;
// the builder then works on that repository (it resolves soul.md from its own location). Git runs
// with no system or global config, for this process and its children.
//
// NEVER. Never touches this repository's own soul.md or write-lock state: every builder run is
// against a copy in the OS temp directory. Flips a PINNED DEFECT assertion on its own: each pins
// today's behaviour, and only a FIX row in the ratchet flips one. BSC-D1: the no-op returns before
// the privacy check. BSC-D2: soul-core.md.staging is ignored by neither .gitignore. BSC-D3: a harvest
// appended after the end canary makes every later card refuse (token three times). BSC-D4: a bad pins
// file is reported with the bare parser message, not its name. BSC-D5: a second pin on an already
// pinned entry says "already in the newest slice". BSC-D6: the card has no trailing newline after the
// stamp.
//
// Usage: node scripts/tests/test-build-soul-core-paths.mjs
// Exit: 0 all pass - 1 any failure

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-soulcore-paths-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = GITCONFIG; // the builder's own `git check-ignore` must not see this machine's excludes

const IS_KIT = fs.existsSync(path.join(KIT, 'variants', 'online', '.gitignore'));
const ONLINE_GITIGNORE = IS_KIT ? path.join(KIT, 'variants', 'online', '.gitignore') : path.join(KIT, '.gitignore');

// ---------------------------------------------------------------- a synthetic soul.md
const TOKEN = 'c0de'.repeat(4);
const HEAD = [
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
  '### Standing rule',
  'Harvest verbatim.',
  ''
].join('\n');
const endCanary = (token = TOKEN) =>
  ['## Headless injection check (end)', `SOUL-CANARY-TOKEN: ${token}`, 'Both blocks carry the same value.', ''].join(
    '\n'
  );
// entry i is dated a fixed base day plus i days forward, so a higher i is newer
const entry = (i, tag = 'typed') =>
  `### Harvested ${new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10)} (${tag}, entry ${i})\n- "line ${i}"\n`;
const soul = (count, { tags = {} } = {}) => {
  const body = [];
  for (let i = count; i >= 1; i--) body.push(entry(i, tags[i] || 'typed'));
  return `${HEAD}\n${body.join('\n')}${body.length ? '\n' : ''}${endCanary()}`;
};

let n = 0;
function repo({ gitignore = '', soulText = soul(3), pins = null } = {}) {
  const dir = path.join(TMP, `r${++n}`);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  const r = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'build-soul-core.js'),
    path.join(dir, 'scripts', 'lib', 'build-soul-core.js')
  );
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'write-lock.js'), path.join(dir, 'scripts', 'lib', 'write-lock.js'));
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  if (soulText !== null) fs.writeFileSync(path.join(dir, 'soul.md'), soulText);
  if (pins !== null) {
    fs.mkdirSync(path.join(dir, 'system'));
    fs.writeFileSync(path.join(dir, 'system', 'soul-pins.json'), pins);
  }
  return dir;
}
const builderOf = (dir) =>
  createRequire(path.join(dir, 'scripts', 'lib', 'x.js'))(path.join(dir, 'scripts', 'lib', 'build-soul-core.js'));
function build(dir, opts = {}) {
  const lines = [];
  try {
    return { ok: true, r: builderOf(dir).build({ log: (m) => lines.push(m), ...opts }), log: lines, error: '' };
  } catch (e) {
    return { ok: false, r: null, log: lines, error: e.message };
  }
}
function cli(dir, args = []) {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'lib', 'build-soul-core.js'), ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8'
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const card = (dir) => fs.readFileSync(path.join(dir, 'soul-core.md'), 'utf8');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('the exports', () => {
  assert.deepEqual(Object.keys(builderOf(repo())).sort(), [
    'MIN_ENTRIES',
    'NEWEST_N',
    'OUT',
    'assemble',
    'assertIgnored',
    'build',
    'ignoreState',
    'parseSoul',
    'selectEntries'
  ]);
  const b = builderOf(repo());
  assert.equal(b.NEWEST_N, 20);
  assert.equal(b.MIN_ENTRIES, 12);
});

test('CLI with no soul.md: two skip lines, exit 0, no card, the lock released', () => {
  const dir = repo({ soulText: null });
  const skip = 'no soul.md yet, so there is no card to build. /setup writes it.';
  assert.deepEqual(cli(dir), {
    code: 0,
    stdout: `  soul-core: skipped - ${skip}\nbuild-soul-core: skipped - ${skip}\n`,
    stderr: ''
  });
  assert.equal(fs.existsSync(path.join(dir, 'soul-core.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.alex-lock-alex-surfaces')), false);
});

test('CLI with the write-lock held: "deferred", exit 2, nothing built, the other holder\'s lock left alone', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.alex-lock-alex-surfaces'));
  fs.writeFileSync(
    path.join(dir, '.alex-lock-alex-surfaces', 'holder.json'),
    JSON.stringify({ label: 'fixture', pid: 1, since: '2026-01-01T00:00:00.000Z' })
  );
  assert.deepEqual(cli(dir), {
    code: 2,
    stdout: 'build-soul-core: deferred - held by fixture (pid 1) since 2026-01-01T00:00:00.000Z\n',
    stderr: ''
  });
  assert.equal(fs.existsSync(path.join(dir, 'soul-core.md')), false);
  assert.equal(fs.existsSync(path.join(dir, '.alex-lock-alex-surfaces', 'holder.json')), true);
});

test('CLI on a refusal: one FAILED line on stderr, exit 1, the existing card untouched, the lock released', () => {
  const dir = repo({ soulText: soul(3).replace(/^## Voice Rules$/m, '## Voice') });
  fs.writeFileSync(path.join(dir, 'soul-core.md'), "yesterday's card");
  const r = cli(dir, ['--force']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^ {2}soul\.md: \d+ B, 3 dated entries, canary c0dec0\.\.\n/);
  assert.equal(
    r.stderr,
    'build-soul-core FAILED (no emit, existing card untouched): floor: required heading missing from card: "## Voice Rules"\n'
  );
  assert.equal(card(dir), "yesterday's card");
  assert.equal(fs.existsSync(path.join(dir, '.alex-lock-alex-surfaces')), false);
});

test('CLI success: the parse line, the privacy line, the written line, exit 0', () => {
  const dir = repo();
  const r = cli(dir);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  const lines = r.stdout.split('\n');
  assert.match(lines[0], /^ {2}soul\.md: \d+ B, 3 dated entries, canary c0dec0\.\.$/);
  assert.equal(
    lines[1],
    "  privacy: 'soul.md' tracked, 'soul-core.md' tracked - this repo tracks its own identity, by its own .gitignore"
  );
  assert.match(
    lines[2],
    /^ {2}soul-core\.md written: \d+ B \(~\d+(\.\d)?k tok est\), 3 newest \+ 0 pinned, sha [0-9a-f]{12}\.\.$/
  );
  assert.equal(lines.length, 4);
});

test('an unknown CLI flag warns on stderr by name, the card is still built, exit 0', () => {
  const dir = repo();
  // args.js and the libraries it loads are not part of the shared repo() fixture (every other test in
  // this file calls repo() too, and the ratchet's pinned fingerprints cover what a test's own helpers
  // run): copied here, alone, for this test only.
  for (const name of ['args.js', 'errors.js', 'exit-codes.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', name), path.join(dir, 'scripts', 'lib', name));
  }
  const r = cli(dir, ['--forse']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, 'build-soul-core: WARNING - ignored --forse: unknown flag --forse\n');
  assert.equal(fs.existsSync(path.join(dir, 'soul-core.md')), true);
});

test('the stamp: the last line, raw-byte sha of soul.md, the pins sha, the counts, token-count=2', () => {
  const dir = repo();
  build(dir);
  const text = card(dir);
  const last = text.split('\n').pop();
  const m =
    /^SOUL-CORE-STAMP: source-sha256=([0-9a-f]{64}) pins-sha256=([0-9a-f]{8}) generated-at=(\S+) entries=3 pinned=0 token-count=2$/.exec(
      last
    );
  assert.ok(m, last);
  assert.equal(m[1], sha256(fs.readFileSync(path.join(dir, 'soul.md'))));
  assert.equal(m[2], sha256('').slice(0, 8), 'no pins file hashes as the empty string');
  assert.match(m[3], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(text.split(`SOUL-CANARY-TOKEN: ${TOKEN}`).length - 1, 2);
  assert.ok(
    text.startsWith('SOUL-CORE NOTE: this file is GENERATED nightly from soul.md (scripts/lib/build-soul-core.js).\n')
  );
  assert.ok(
    text.includes('\nNEWEST 3 ENTRIES by parsed heading date (recency slice, rebuilt nightly, newest first):\n')
  );
});

test('PINNED DEFECT BSC-D6: no trailing newline after the stamp', () => {
  const dir = repo();
  build(dir);
  const text = card(dir);
  assert.equal(text.endsWith('\n'), false);
});

test('the no-op: an unchanged soul.md and pins leave the card byte-identical, with the exact log line', () => {
  const dir = repo();
  build(dir);
  const before = card(dir);
  const soulSha = sha256(fs.readFileSync(path.join(dir, 'soul.md')));
  const r = build(dir);
  assert.equal(r.r.noop, true);
  assert.deepEqual(r.log, [
    `  soul-core: unchanged (soul.md sha ${soulSha.slice(0, 12)}.., pins ${sha256('').slice(0, 8)}) - verified no-op`
  ]);
  assert.equal(card(dir), before);
});

test('floor refusals: no token line, no end canary, an end canary with another token', () => {
  assert.equal(
    build(
      repo({
        soulText: soul(3)
          .split('\n')
          .filter((l) => !l.startsWith('SOUL-CANARY-TOKEN'))
          .join('\n')
      }),
      { force: true }
    ).error,
    'floor: no SOUL-CANARY-TOKEN line in soul.md'
  );
  assert.equal(
    build(repo({ soulText: soul(3).replace(endCanary(), '') }), { force: true }).error,
    'floor: end canary block (second "## Headless injection check") not found'
  );
  assert.equal(
    build(repo({ soulText: soul(3).replace(endCanary(), endCanary('f00d'.repeat(4))) }), { force: true }).error,
    'floor: end canary block does not carry the same token'
  );
});

test('PINNED DEFECT BSC-D3: a first harvest appended AFTER the end canary makes the card refuse (the token three times)', () => {
  // the /setup skeleton has no entries and ends with the end canary; an agent that appends the first
  // entry at the bottom instead of at the top puts the canary inside the operative slice
  const dir = repo({ soulText: `${soul(0)}\n${entry(1)}` });
  const r = build(dir, { force: true });
  assert.equal(r.error, 'floor: canary token appears 3x in card, need exactly 2');
  assert.equal(fs.existsSync(path.join(dir, 'soul-core.md')), false);
});

test("privacy outside a repository: refused, with git's exit code", () => {
  const dir = path.join(TMP, 'not-a-repo');
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(
    path.join(KIT, 'scripts', 'lib', 'build-soul-core.js'),
    path.join(dir, 'scripts', 'lib', 'build-soul-core.js')
  );
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'write-lock.js'), path.join(dir, 'scripts', 'lib', 'write-lock.js'));
  fs.writeFileSync(path.join(dir, 'soul.md'), soul(3));
  const r = build(dir, { force: true });
  assert.match(
    r.error,
    /^privacy fail-closed: cannot read the ignore state of 'soul-core\.md' \(git check-ignore exit 128: fatal: not a git repository/
  );
});

test('pins: a bad regex, no match and an entry already newest are skipped and logged; an older entry is pinned into its own section', () => {
  const pins = JSON.stringify({
    pins: [
      { register: 'bad', match: '([' },
      { register: 'none', match: 'no such heading' },
      { register: 'new', match: 'entry 25\\)' },
      { register: 'old', match: 'voice, entry 2\\)' }
    ]
  });
  const dir = repo({ soulText: soul(25, { tags: { 2: 'voice' } }), pins });
  const r = build(dir, { force: true });
  assert.ok(r.ok, r.error);
  assert.match(
    r.log.find((l) => l.startsWith("  pin 'bad'")),
    /^ {2}pin 'bad': BAD REGEX \(.+\) - skipped$/
  );
  assert.ok(r.log.includes("  pin 'none': no matching entry - skipped"));
  assert.ok(r.log.includes("  pin 'new': already in the newest slice (2026-07-26)"));
  assert.ok(r.log.includes('  pin \'old\': + 2026-07-03 "Harvested 2026-07-03 (voice, entry 2)"'));
  const text = card(dir);
  assert.ok(
    text.includes(
      '\nPINNED REGISTERS (system/soul-pins.json, the relevance leg - these never age out of the card):\n\n### Harvested 2026-07-03 (voice, entry 2)\n'
    )
  );
  assert.match(text, / entries=20 pinned=1 token-count=2$/);
  assert.match(text, new RegExp(` pins-sha256=${sha256(pins).slice(0, 8)} `));
});

test('PINNED DEFECT BSC-D5: a second pin on an already pinned entry says "already in the newest slice"', () => {
  const pins = JSON.stringify({
    pins: [
      { register: 'one', match: 'entry 2\\)' },
      { register: 'twice', match: 'entry 2\\)' }
    ]
  });
  const r = build(repo({ soulText: soul(25), pins }), { force: true });
  assert.ok(r.log.includes("  pin 'twice': already in the newest slice (2026-07-03)"));
});

test('PINNED DEFECT BSC-D4: a pins file that is not JSON fails with the bare parser message, not its name', () => {
  const dir = repo({ pins: '{bad' });
  const r = cli(dir, ['--force']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^build-soul-core FAILED \(no emit, existing card untouched\): /);
  assert.doesNotMatch(r.stderr, /soul-pins/);
});

test('the selection floor binds through assemble(): 5 selected from a corpus of 25 refuses', () => {
  const dir = repo({ soulText: soul(25) });
  const b = builderOf(dir);
  const parsed = b.parseSoul(soul(25));
  assert.equal(parsed.entries.length, 25);
  assert.throws(() => b.assemble(parsed, { newest: parsed.entries.slice(0, 5), pinned: [] }, 'a'.repeat(64)), {
    message: 'floor: only 5 entries selected from a corpus of 25, need >= 12'
  });
});

test('a card over 60 KiB is written with a WARN line, never refused', () => {
  const big = soul(3).replace('- "line 1"', `- "${'w'.repeat(70000)}"`);
  const r = build(repo({ soulText: big }), { force: true });
  assert.ok(r.ok, r.error);
  assert.match(
    r.log.find((l) => l.startsWith('  WARN')),
    /^ {2}WARN: card is \d+ B \(> 61440\) - consider lowering NEWEST_N$/
  );
});

test('a card that reads back different after the rename is refused (a fault injected between the rename and the read)', () => {
  const dir = repo();
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    realRename(from, to);
    if (String(to).endsWith('soul-core.md')) fs.appendFileSync(to, '\nsomething else wrote here');
  };
  try {
    assert.equal(build(dir, { force: true }).error, 'read-back verify failed after swap');
  } finally {
    fs.renameSync = realRename;
  }
});

test('PINNED DEFECT BSC-D1: once built, the no-op returns before the privacy check (a card that became trackable is not flagged)', () => {
  const dir = repo({ gitignore: 'soul.md\nsoul-core.md\n' });
  assert.ok(build(dir).ok);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'soul.md\n');
  const r = build(dir);
  assert.equal(r.ok, true);
  assert.equal(r.r.noop, true);
  assert.match(
    build(dir, { force: true }).error,
    /^privacy fail-closed: 'soul\.md' is gitignored but output path 'soul-core\.md' is NOT/
  );
});

test('PINNED DEFECT BSC-D2: the staging name is ignored by neither .gitignore, while the card is ignored on a laptop', () => {
  const check = (gitignoreFile, rel) => {
    const dir = repo({ soulText: null });
    fs.copyFileSync(gitignoreFile, path.join(dir, '.gitignore'));
    return spawnSync('git', ['check-ignore', '-q', rel], { cwd: dir, encoding: 'utf8' }).status;
  };
  assert.equal(check(ONLINE_GITIGNORE, 'soul-core.md.staging'), 1, 'online: not ignored');
  if (IS_KIT) {
    assert.equal(check(path.join(KIT, '.gitignore'), 'soul-core.md.staging'), 1, 'laptop: not ignored');
    assert.equal(check(path.join(KIT, '.gitignore'), 'soul-core.md'), 0, 'laptop: the card itself is ignored');
  }
});
