#!/usr/bin/env node
// scripts/tests/test-soul-core-floor.mjs - the card builder's privacy and floor guards.
//
// WHAT. The privacy assertion inherits soul.md's own ignore state, shown REFUSING a synthetic
// violation before the pass (N1); the heading floor on a young corpus, also shown refusing (N2); and
// the twelve-entry selection floor, held by P3's golden sha of a mature (fourteen-entry) build, which
// would catch a card that grew thin. Deleted, either guard could silently stop refusing: a card could
// leak identity content to a trackable path, or ship thin from a grown corpus, with nothing to catch it.
//   N1  NEGATIVE the privacy line still holds: a repo where soul.md is gitignored and ONLY the card
//       is un-ignored refuses with "privacy fail-closed" and writes nothing
//   N2  NEGATIVE the heading floor still binds on a young corpus: a fresh soul.md missing one
//       required heading refuses
//   P1  a fresh ~2 KB soul.md with ZERO dated entries and the required headings, in a repo that
//       tracks both files (the online state), builds a card whose stamp reads entries=0, with the
//       canary token exactly twice and every required heading present
//   P1b the same fresh soul.md with BOTH files gitignored (a laptop on day one) builds too
//   P2  a young corpus (3 entries) builds a card carrying all three, newest first, entries=3
//   P3  a mature corpus (14 entries) under a fixed clock builds byte-identical to a known-good
//       build: the sha256 of the card is pinned (GOLDEN_MATURE_SHA); any drift in the mature path
//       fails here
//   P4  the no-op guard: a second build without --force is a verified no-op
//   P5  the CLI path (node scripts/lib/build-soul-core.js --force) exits 0 in the online-state repo
//
// HOW. Throwaway git repos under the OS temp dir; nothing here touches the Kit, its soul.md (it has
// none) or any remote. --builder <file> tests a named builder file instead of the Kit's, against the
// same fixtures and the same golden sha. --keep leaves the temp directory in place and prints its path.
//
// NEVER. Never touches this repository's own soul.md, write-lock state, or a remote.
//
// Usage: node scripts/tests/test-soul-core-floor.mjs [--builder <file>] [--keep]
// Exit: 0 all pass - 1 any failure

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const BUILDER = argv.includes('--builder')
  ? path.resolve(argv[argv.indexOf('--builder') + 1])
  : path.join(KIT, 'scripts', 'lib', 'build-soul-core.js');
const KEEP = argv.includes('--keep');

// P3's pin. Recompute only when the mature path changes ON PURPOSE: run this file with
// --builder <the previous builder> and take the sha it prints for P3.
// contract: read as text by scripts/tests/test-soul-core-floor.mjs:291 (unseen: this file compares itself). This sha of the mature card changes only when the builder's mature path changes on purpose.
const GOLDEN_MATURE_SHA = '6a5ea107b16e0278ae91b82c7546807aa0c990cd63a464558fab56ebf3360234';

// A fixed clock, so two builds of one input are byte-identical (the stamp carries generated-at).
const FIXED_CLOCK = '2026-09-22T00:00:00.000Z';
Date.prototype.toISOString = function toISOString() {
  return FIXED_CLOCK;
};

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- the synthetic corpus
const TOKEN = 'a1b2c3d4e5f6a7b8'; // # secret-scan: allow (the canary fixture, a nonce that proves injection, not a credential)

function operativeLayer() {
  return [
    '# Soul - Who I Am',
    '',
    '## Headless injection check (do not remove; anchored here on day one)',
    `SOUL-CANARY-TOKEN: ${TOKEN}`,
    '',
    'The proof-of-injection token, mirrored at the top of the file on purpose. A scheduled run is asked',
    'to echo it back; only a run that received this file can produce it. The matching block sits at',
    'the end of the file and carries the SAME value.',
    '',
    '## My Role',
    'Fixture owner. Runs a small practice and is learning to build with Alex.',
    '',
    '## My Company/Business',
    'A one-person consultancy in a mid-sized town. No employees, two recurring clients.',
    '',
    '## Writing Style',
    '- Short sentences. Says the number before the reason.',
    '- Asks the question straight and expects the answer straight.',
    '',
    '## How I Communicate',
    'Direct, present tense, no hedging. Warm with people, blunt with plans.',
    '',
    '## My Priorities (most to least)',
    '1. Keep the two clients happy.',
    '2. Learn enough automation to stop doing the same report by hand.',
    '3. Time with the family on weekends.',
    '',
    '## Agent Personality - Alex',
    '**Core:** a calm senior colleague who has seen the mistake before and says so.',
    '**Addressing:** calls the owner by first name.',
    '**Never:** flattery, filler, invented facts.',
    '',
    '## Voice Rules (always active)',
    '- Never sound like a machine. No filler, no stock transitions.',
    "- Preserve the owner's own phrasing, imperfections included.",
    '',
    '## Things I Never Want',
    'Praise I did not earn. Hedging where a direct answer exists. Invented facts.',
    '',
    '## My Words (live corpus, agent-maintained)',
    'The agent harvests my real phrasing from every session and appends here, newest first.',
    '',
    '### Standing rule (set on day one)',
    'ALWAYS update this section with my words, date-stamped, verbatim.',
    ''
  ].join('\n');
}

function endCanaryBlock() {
  return [
    '## Headless injection check (do not remove)',
    `SOUL-CANARY-TOKEN: ${TOKEN}`,
    'This single token is how a scheduled run proves soul.md was actually injected. Removing this',
    'line disarms the check. Rotate the value any time; both blocks must carry the same value.',
    ''
  ].join('\n');
}

function entry(i) {
  // Dates descend from a fixed base day: entry 1 is the newest.
  const day = String(Math.max(1, 30 - i)).padStart(2, '0');
  return [
    `### Harvested 2026-08-${day} (typed, fixture entry ${i})`,
    `- "fixture line ${i}, the owner's own words" (a synthetic quote; the marker to keep is the number)`,
    'Tone read: flat, no caps, no exclamation mark.',
    ''
  ].join('\n');
}

function soulText(nEntries, { dropHeading = null } = {}) {
  let head = operativeLayer();
  if (dropHeading)
    head = head
      .split('\n')
      .filter((l) => !l.startsWith(dropHeading))
      .join('\n');
  const body = [];
  for (let i = 1; i <= nEntries; i++) body.push(entry(i));
  return `${head}\n${body.join('\n')}${body.length ? '\n' : ''}${endCanaryBlock()}`;
}

// ---------------------------------------------------------------- throwaway repos
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-soulcore-'));
after(() => {
  if (KEEP) console.log(`kept: ${TMP}`);
  else fs.rmSync(TMP, { recursive: true, force: true });
});
// Pinned the way test-generate-no-soul.mjs's own git() is: inherited GIT_* removed and git pinned to a
// fixture config, so the privacy guard under test (which reads git check-ignore, and so this machine's
// global core.excludesFile) cannot see this machine's real excludes.
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '[core]\n\tautocrlf = false\n');
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(GIT_ENV, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG });
const git = (cwd, args) => spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });

function repo(name, gitignore, soul) {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  const r = git(TMP, ['init', '-q', dir]);
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  fs.copyFileSync(BUILDER, path.join(dir, 'scripts', 'lib', 'build-soul-core.js'));
  fs.copyFileSync(path.join(KIT, 'scripts', 'lib', 'write-lock.js'), path.join(dir, 'scripts', 'lib', 'write-lock.js'));
  fs.writeFileSync(path.join(dir, '.gitignore'), gitignore, 'utf8');
  fs.writeFileSync(path.join(dir, 'soul.md'), soul, 'utf8');
  return dir;
}
function loadBuilder(dir) {
  const req = createRequire(path.join(dir, 'scripts', 'lib', 'probe.js'));
  return req(path.join(dir, 'scripts', 'lib', 'build-soul-core.js'));
}
function runBuild(dir, opts = {}) {
  const lines = [];
  try {
    const r = loadBuilder(dir).build({ log: (m) => lines.push(m), force: true, ...opts });
    return { ok: true, r, log: lines.join('\n'), error: '' };
  } catch (e) {
    return { ok: false, r: null, log: lines.join('\n'), error: /** @type {Error} */ (e).message };
  }
}
const cardOf = (dir) =>
  fs.existsSync(path.join(dir, 'soul-core.md')) ? fs.readFileSync(path.join(dir, 'soul-core.md'), 'utf8') : null;
const stampOf = (card) => (card ? card.trimEnd().split('\n').pop() : '');
const tokenCount = (card) => card.split(`SOUL-CANARY-TOKEN: ${TOKEN}`).length - 1;
const checkIgnore = (dir, rel) => git(dir, ['check-ignore', '-q', rel]).status; // 0 ignored, 1 not

console.log(`builder: ${BUILDER}`);
console.log(`fixtures in ${TMP}`);

describe('build-soul-core.js', () => {
  test('N1 NEGATIVE the privacy line still holds: soul.md ignored + card NOT ignored refuses, writes nothing', () => {
    // A mature corpus on purpose: a fresh soul.md can refuse on the entry floor before it ever reaches
    // the privacy check, so only a corpus the floor accepts actually shows the privacy line.
    const d = repo('local-card-unignored', 'soul.md\n', soulText(14));
    const r = runBuild(d);
    assert.ok(
      !r.ok && /privacy fail-closed/.test(r.error),
      `expected a privacy-fail-closed refusal; git check-ignore: soul.md exit ${checkIgnore(d, 'soul.md')}, soul-core.md exit ${checkIgnore(d, 'soul-core.md')}; got: ${r.error}`
    );
    assert.ok(
      cardOf(d) === null && !fs.existsSync(path.join(d, 'soul-core.md.staging')),
      'nothing was written (no card, no staging file)'
    );
  });

  test('N2 NEGATIVE the heading floor still binds on a young corpus: a fresh soul.md missing a required heading refuses', () => {
    const d = repo('online-missing-heading', '', soulText(0, { dropHeading: '## Writing Style' }));
    const r = runBuild(d);
    assert.ok(
      !r.ok && /required heading missing/.test(r.error),
      `expected a required-heading refusal, got: ${r.error}`
    );
    assert.equal(cardOf(d), null, 'nothing was written');
  });

  test('P1 a fresh soul.md with zero dated entries builds (online state: both files tracked)', () => {
    const soul = soulText(0);
    const d = repo('online-fresh', '', soul);
    const r = runBuild(d);
    assert.ok(r.ok, `expected a build (${Buffer.byteLength(soul)} B soul.md); error: ${r.error}`);
    const card = cardOf(d) || '';
    assert.match(stampOf(card), / entries=0 /, `the stamp reads entries=0 (got: ${stampOf(card)})`);
    assert.equal(tokenCount(card), 2, `the canary token appears exactly twice in the card (got ${tokenCount(card)}x)`);
    const REQ = [
      '# Soul - Who I Am',
      '## Headless injection check',
      '## My Role',
      '## My Company/Business',
      '## Writing Style',
      '## How I Communicate',
      '## My Priorities',
      '## Agent Personality - Alex',
      '## Voice Rules',
      '## Things I Never Want',
      '## My Words'
    ];
    const missing = REQ.filter((h) => !card.split('\n').some((l) => l.startsWith(h)));
    assert.deepEqual(missing, [], `every required heading is in the card (missing: ${missing.join(', ')})`);
    assert.match(r.log, /'soul\.md' tracked, 'soul-core\.md' tracked/, 'the log names the state: both tracked');
    assert.equal(checkIgnore(d, 'soul.md'), 1, 'git agrees soul.md is not ignored');
    assert.equal(checkIgnore(d, 'soul-core.md'), 1, 'git agrees soul-core.md is not ignored');
  });

  test('P1b the same fresh soul.md, both files gitignored (a laptop on day one), builds too', () => {
    const d = repo('local-fresh', 'soul.md\nsoul-*.md\n', soulText(0));
    const r = runBuild(d);
    assert.ok(
      r.ok && / entries=0 /.test(stampOf(cardOf(d) || '')),
      `expected a build with entries=0; error: ${r.error}`
    );
    assert.match(
      r.log,
      /'soul\.md' gitignored, 'soul-core\.md' gitignored/,
      'the log names the state: both gitignored'
    );
  });

  test('P2 a young corpus (three entries) builds a card carrying all three, newest first, entries=3', () => {
    const d = repo('online-young', '', soulText(3));
    const r = runBuild(d);
    const card = cardOf(d) || '';
    assert.ok(
      r.ok && / entries=3 /.test(stampOf(card)),
      `expected entries=3 (got: ${stampOf(card)}); error: ${r.error}`
    );
    const at = (i) => card.indexOf(`fixture entry ${i})`);
    assert.ok(
      at(1) > 0 && at(2) > at(1) && at(3) > at(2),
      `all three entries ride the card, newest first (${at(1)} < ${at(2)} < ${at(3)})`
    );
    assert.equal(tokenCount(card), 2, 'the canary token appears exactly twice');
  });

  test('P3 a mature corpus (fourteen entries) under a fixed clock builds byte-identical to the golden sha', () => {
    const d = repo('local-mature', 'soul.md\nsoul-*.md\n', soulText(14));
    const r = runBuild(d);
    const card = cardOf(d) || '';
    const sha = sha256(card);
    assert.ok(
      r.ok && / entries=14 /.test(stampOf(card)),
      `expected entries=14 (got: ${stampOf(card)}); error: ${r.error}`
    );
    console.log(`      P3 card sha256: ${sha}`);
    assert.equal(sha, GOLDEN_MATURE_SHA, `the mature card is byte-identical to the golden sha; got ${sha}`);
  });

  test('P4 the no-op guard: a second build of the mature corpus without --force is a verified no-op', () => {
    const d = repo('local-mature-2', 'soul.md\nsoul-*.md\n', soulText(14));
    runBuild(d);
    const r = runBuild(d, { force: false });
    assert.ok(r.ok && r.r && r.r.noop === true, `expected a verified no-op; last log line: ${r.log.split('\n').pop()}`);
  });

  test('P5 the CLI path (node scripts/lib/build-soul-core.js --force) exits 0 in the online-state repo', () => {
    const d = repo('online-cli', '', soulText(0));
    const r = spawnSync(process.execPath, [path.join('scripts', 'lib', 'build-soul-core.js'), '--force'], {
      cwd: d,
      encoding: 'utf8'
    });
    assert.ok(
      r.status === 0 && /soul-core\.md written/.test(r.stdout),
      `expected exit 0 and "soul-core.md written"; got exit ${r.status}: ${r.stdout}${r.stderr}`
    );
    assert.ok(!fs.existsSync(path.join(d, '.alex-lock-alex-surfaces')), 'the CLI released the write-lock');
  });
});
