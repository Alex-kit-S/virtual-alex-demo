#!/usr/bin/env node
// scripts/tests/test-generate-no-soul.mjs - a checkout with no soul.md is not a broken checkout.
//
// WHAT. The generator and the soul-card builder treat a missing soul.md as a stated skip, and the legs
// G1 to G5 below prove it. Deleted, a fresh clone or an install before /setup could regress to printing
// FAILED and exiting 1 for a condition that is not a failure.
//
//   G1  NEGATIVE the generator on this soul-less checkout exits 0, and says why it skipped
//   G2  NEGATIVE the builder CLI on this soul-less checkout exits 0, and says why it skipped
//   G3  build() with an absent soul.md reports skipped and writes no card
//   G4  build() with a soul.md present still builds the card, so the skip did not swallow the step
//   G5  a card that already exists is left untouched by the skip
//
// HOW. soul.md is gitignored, so a fresh clone has none and the skip is the right verdict. G1 and G2
// run the REAL generator (`--only=soulcore`) and the REAL builder CLI, in a COPY of
// this checkout under the OS temp dir. Both resolve their repository from their own folder and write
// into it: the generator its run log (refactor/last-run.log) and both of them the shared write lock, so
// run in the checkout they would leave files there. The copy holds what git sees in this tree (tracked
// files plus untracked ones it does not ignore, symlinks kept as links), committed to a fresh
// repository: exactly what a fresh clone has, which is the condition under test. G3 to G5 use
// throwaway repos under the OS temp dir. Inherited GIT_* is stripped and git reads a fixture config.
// G1's `--only=soulcore` still runs the generator's step 3, the FULL validate-alex suite ("never
// narrowed by --only"), which reaches V2; G1's spawn loads scripts/tests/fixtures/scheduler-stub.cjs
// with an empty C4_LIVE, so that check is a clean, silent WARNING regardless of the real machine.
//
// NEVER. Writes into this checkout (everything runs under the temp folder, which it removes) or
// reaches a real scheduler binary.
//
// Usage: node scripts/tests/test-generate-no-soul.mjs
// Exit: 0 all legs passed - 1 a leg failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');

// realpathSync, and it is load-bearing on macOS: there os.tmpdir() is /var/folders/..., a symlink to
// /private/var/folders/.... The builder resolves ITS OWN repository root from __dirname, which node
// gives already resolved, so an unresolved path handed in as soulPath/outPath makes the two disagree
// and the privacy assertion computes a relative path git reads as outside the repository.
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'alex-nosoul-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));
const SKIP_WORDS = /no soul\.md/i;

// Every git call, and both CLIs below, run with inherited GIT_* removed (a GIT_DIR from a hook would
// point them back at the checkout) and git pinned to a fixture config.
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '[core]\n\tautocrlf = false\n');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
Object.assign(ENV, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG });
const git = (cwd, args) => spawnSync('git', args, { cwd, env: ENV, encoding: 'utf8' });

// The copy G1 and G2 run in. A path git lists that the working tree no longer has is left out, the way
// a clone of this tree's state would leave it out.
function copyOfCheckout(dest) {
  const ls = git(KIT, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (ls.status !== 0) throw new Error(`git ls-files failed in ${KIT}: ${ls.stderr}`);
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const src = path.join(KIT, rel);
    const dst = path.join(dest, rel);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dst);
    else if (st.isFile()) fs.copyFileSync(src, dst);
  }
  const who = ['-c', 'user.name=no-soul fixture', '-c', 'user.email=fixture@example.invalid'];
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
    [...who, 'commit', '-qm', 'copy']
  ]) {
    const r = git(dest, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in the copy: ${r.stderr}`);
  }
  return dest;
}
const COPY = copyOfCheckout(path.join(TMP, 'checkout'));

// The copy has no soul.md, which is the condition under test, unless this tree carries one git does
// not ignore.
const kitHasSoul = fs.existsSync(path.join(COPY, 'soul.md'));

const TOKEN = 'a1b2c3d4e5f6a7b8'; // # secret-scan: allow (the canary fixture, a nonce that proves injection, not a credential)

const canaryBlock = () =>
  [
    '## Headless injection check (do not remove)',
    `SOUL-CANARY-TOKEN: ${TOKEN}`,
    'This token is how a scheduled run proves soul.md reached the model. Both blocks carry the same value.',
    ''
  ].join('\n');

// A soul.md with the headings the builder's floor requires and no dated entries, which is what /setup
// writes on day one. The canary block appears at the top and at the end, as the real file does.
function freshSoul() {
  return [
    '# Soul - Who I Am',
    '',
    canaryBlock(),
    '## My Role',
    'A bookbinder in a harbour town.',
    '',
    '## My Company/Business',
    'Freelance.',
    '',
    '## Writing Style',
    '- Short sentences.',
    '',
    '## How I Communicate',
    'Direct.',
    '',
    '## My Priorities (most to least)',
    '1. Work.',
    '',
    '## Agent Personality - Alex',
    '**Core:** calm and direct.',
    '',
    '## Voice Rules (always active)',
    '- No filler.',
    '',
    '## Things I Never Want',
    'Flattery.',
    '',
    '## My Words (live corpus, agent-maintained)',
    '',
    '### Standing rule (set on day one)',
    'Capture real phrasing.',
    '',
    canaryBlock()
  ].join('\n');
}

// The builder's privacy assertion asks git about paths relative to ITS OWN repository, so a copy has to
// live inside the throwaway repo. Same arrangement as test-soul-core-floor.mjs.
function repo(name, { withSoul }) {
  const d = path.join(TMP, name);
  fs.mkdirSync(path.join(d, 'scripts', 'lib'), { recursive: true });
  git(TMP, ['init', '-q', d]);
  for (const f of ['build-soul-core.js', 'write-lock.js']) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(d, 'scripts', 'lib', f));
  }
  // Both files tracked: the privacy assertion only refuses when soul.md is ignored and the card is
  // not, and this test is about absence, not privacy.
  fs.writeFileSync(path.join(d, '.gitignore'), '');
  if (withSoul) fs.writeFileSync(path.join(d, 'soul.md'), freshSoul());
  return d;
}

function loadBuilder(d) {
  return createRequire(path.join(d, 'scripts', 'lib', 'probe.js'))(
    path.join(d, 'scripts', 'lib', 'build-soul-core.js')
  );
}
const buildIn = (d, extra = {}) =>
  loadBuilder(d).build({
    log: () => {},
    outPath: path.join(d, 'soul-core.md'),
    soulPath: path.join(d, 'soul.md'),
    pinsPath: path.join(d, 'pins.json'),
    ...extra
  });

describe('a checkout with no soul.md is not a broken checkout', () => {
  test('G1 NEGATIVE the generator exits 0 on a checkout with no soul.md, prints no FAILED, and says which file is missing', (t) => {
    if (kitHasSoul) {
      t.skip('this checkout HAS a soul.md git does not ignore, so the absent-file path cannot be measured');
      return;
    }
    const r = spawnSync(process.execPath, ['-r', SCHED_STUB, 'scripts/generate-alex.js', '--only=soulcore'], {
      cwd: COPY,
      encoding: 'utf8',
      env: { ...ENV, C4_LIVE: '' }
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `exit=${r.status}\n${out}`);
    assert.ok(!/FAILED/.test(out), `it does not print FAILED\n${out}`);
    assert.ok(SKIP_WORDS.test(out), (out.split('\n').find((l) => SKIP_WORDS.test(l)) || '(no such line)').trim());
  });

  test('G2 NEGATIVE the builder CLI exits 0 with no soul.md and states the skip', (t) => {
    if (kitHasSoul) {
      t.skip('this checkout HAS a soul.md git does not ignore, so the absent-file path cannot be measured');
      return;
    }
    // The builder's own CLI, which a fresh clone also meets (setup.md's check 7 inside Step 4 tells them to run it).
    // No scheduler stub needed: this CLI never touches validate-alex.js or the scheduler.
    const r = spawnSync(process.execPath, ['scripts/lib/build-soul-core.js'], {
      cwd: COPY,
      encoding: 'utf8',
      env: ENV
    });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, `exit=${r.status}\n${out}`);
    assert.ok(!/FAILED/.test(out), `it does not print FAILED\n${out}`);
    assert.ok(SKIP_WORDS.test(out), (out.trim().split('\n').pop() || '').trim());
  });

  test('G3 build() with an absent soul.md reports skipped, names the reason, and writes no card', () => {
    const d = repo('absent', { withSoul: false });
    const out = path.join(d, 'soul-core.md');
    let res;
    let threw = null;
    try {
      res = buildIn(d);
    } catch (e) {
      threw = e;
    }
    assert.equal(threw, null, threw ? threw.message : '');
    assert.ok(res && res.skipped === true, res ? JSON.stringify(res) : '(threw)');
    assert.ok(res && SKIP_WORDS.test(String(res.reason || '')), res ? String(res.reason) : '');
    assert.ok(!fs.existsSync(out), 'no card was written');
  });

  test('G4 a soul.md present is NOT skipped: the card is written and carries its stamp', () => {
    const d = repo('present', { withSoul: true });
    const out = path.join(d, 'soul-core.md');
    const res = buildIn(d);
    assert.ok(!res.skipped, JSON.stringify(res));
    assert.ok(fs.existsSync(out), 'the card was written');
    assert.ok(fs.readFileSync(out, 'utf8').includes('SOUL-CORE-STAMP'), 'the card carries its stamp');
  });

  test('G5 a skip never damages a card that already exists', () => {
    const d = repo('absent-with-card', { withSoul: false });
    const out = path.join(d, 'soul-core.md');
    fs.writeFileSync(out, 'an older card\n');
    const res = buildIn(d);
    assert.equal(res.skipped, true);
    assert.equal(fs.readFileSync(out, 'utf8'), 'an older card\n', 'the existing card is byte-identical');
  });
});
