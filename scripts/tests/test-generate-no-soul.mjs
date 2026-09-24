#!/usr/bin/env node
// scripts/tests/test-generate-no-soul.mjs - a checkout with no soul.md is not a broken checkout.
// (2026-09-23, Virtual Alex fleet seat 2, from seat 1's carry-over.)
//
// WHAT. The generator and the soul-card builder treat a missing soul.md as a stated skip, and the
// legs G1 to G5 below prove it.
//
// WHY, THE DEFECT. soul.md is gitignored by design, so a fresh clone of the Kit does not have one and
// neither does any install before /setup runs. The generator's soul-card step read it anyway, so
// `node scripts/generate-alex.js` on a fresh checkout printed
//
//   FAILED: ENOENT: no such file or directory, open '...\soul.md'
//
// and exited 1, AFTER every surface had been rendered and the full validator had passed. The work
// was done and correct; only the verdict was wrong. That is the worst shape a failure can take,
// because the person who sees it either stops and debugs something that is not broken, or learns
// that this tool says FAILED when it has not failed. The second one is how an exit code stops
// being read at all, and the whole update path leans on that exit code.
//
// THE FIX. An absent soul.md is a STATED SKIP. It is the same condition migration 001 already
// declines on, in the same words: there is no identity file yet, /setup writes it.
//
//   G1  NEGATIVE the generator on this soul-less checkout exits 0, and says why it skipped
//   G2  NEGATIVE the builder CLI on this soul-less checkout exits 0, and says why it skipped
//   G3  build() with an absent soul.md reports skipped and writes no card
//   G4  build() with a soul.md present still builds the card, so the skip did not swallow the step
//   G5  a card that already exists is left untouched by the skip
//
// HOW. G1 and G2 run against the REAL Kit with `--only=soulcore`. G3 to G5 use throwaway repos
// under the OS temp dir.
//   node scripts/tests/test-generate-no-soul.mjs      (exit 0 = all pass)
//
// NEVER. Never touches the working tree: `--only=soulcore` stages no files and swaps none.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

// realpathSync, and it is load-bearing on macOS: there os.tmpdir() is /var/folders/..., a symlink
// to /private/var/folders/.... The builder resolves ITS OWN repository root from __dirname, which
// node gives already resolved, so an unresolved path handed in as soulPath/outPath makes the two
// disagree and the privacy assertion computes a relative path git reads as outside the repository.
// Windows never showed it; the macOS runner did, on the first CI run this branch ever had.
const TMP = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'alex-nosoul-'));
const SKIP_WORDS = /no soul\.md/i;

// The Kit itself has no soul.md, which is the condition under test. Say so rather than silently
// passing a test that measured nothing.
const kitHasSoul = fs.existsSync(path.join(KIT, 'soul.md'));
if (kitHasSoul) {
  console.log('SKIP  G1 and G2 - this checkout HAS a soul.md, so the absent-file path cannot be measured here');
} else {
  // G1 - the generator.
  {
    const r = spawnSync(process.execPath, ['scripts/generate-alex.js', '--only=soulcore'],
      { cwd: KIT, encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    ok(r.status === 0, 'G1 NEGATIVE the generator exits 0 on a checkout with no soul.md', `exit=${r.status}`);
    ok(!/FAILED/.test(out), 'G1 NEGATIVE it does not print FAILED');
    ok(SKIP_WORDS.test(out), 'G1 NEGATIVE it says which file is missing and that the step was skipped',
      (out.split('\n').find((l) => SKIP_WORDS.test(l)) || '(no such line)').trim());
  }

  // G2 - the builder's own CLI, which a fresh clone also meets (setup.md step 7 tells them to run it).
  {
    const r = spawnSync(process.execPath, ['scripts/lib/build-soul-core.js'], { cwd: KIT, encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    ok(r.status === 0, 'G2 NEGATIVE the builder CLI exits 0 with no soul.md', `exit=${r.status}`);
    ok(!/FAILED/.test(out), 'G2 NEGATIVE it does not print FAILED');
    ok(SKIP_WORDS.test(out), 'G2 NEGATIVE it states the skip', (out.trim().split('\n').pop() || '').trim());
  }
}

const TOKEN = 'a1b2c3d4e5f6a7b8';  // # secret-scan: allow (the canary fixture, a nonce that proves injection, not a credential)

const canaryBlock = () => [
  '## Headless injection check (do not remove)',
  `SOUL-CANARY-TOKEN: ${TOKEN}`,
  'This token is how a scheduled run proves soul.md reached the model. Both blocks carry the same value.',
  '',
].join('\n');

// A soul.md with the headings the builder's floor requires and no dated entries, which is what
// /setup writes on day one. The canary block appears at the top and at the end, as the real file does.
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
    canaryBlock(),
  ].join('\n');
}

// The builder's privacy assertion asks git about paths relative to ITS OWN repository, so a copy
// has to live inside the throwaway repo. Same arrangement as test-soul-core-floor.mjs.
function repo(name, { withSoul }) {
  const d = path.join(TMP, name);
  fs.mkdirSync(path.join(d, 'scripts', 'lib'), { recursive: true });
  spawnSync('git', ['init', '-q', d], { cwd: TMP });
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
  return createRequire(path.join(d, 'scripts', 'lib', 'probe.js'))(path.join(d, 'scripts', 'lib', 'build-soul-core.js'));
}

const buildIn = (d, extra = {}) => loadBuilder(d).build({
  log: () => {},
  outPath: path.join(d, 'soul-core.md'),
  soulPath: path.join(d, 'soul.md'),
  pinsPath: path.join(d, 'pins.json'),
  ...extra,
});

// G3 - the library call with nothing to read.
{
  const d = repo('absent', { withSoul: false });
  const out = path.join(d, 'soul-core.md');
  let res, threw = null;
  try { res = buildIn(d); }
  catch (e) { threw = e; }
  ok(!threw, 'G3 build() does not throw when soul.md is absent', threw ? threw.message : '');
  ok(res && res.skipped === true, 'G3 it reports skipped', res ? JSON.stringify(res) : '(threw)');
  ok(res && SKIP_WORDS.test(String(res.reason || '')), 'G3 the reason names soul.md', res ? String(res.reason) : '');
  ok(!fs.existsSync(out), 'G3 no card was written');
}

// G4 - the step still does its job when there is something to read.
{
  const d = repo('present', { withSoul: true });
  const out = path.join(d, 'soul-core.md');
  const res = buildIn(d);
  ok(!res.skipped, 'G4 a soul.md present is NOT skipped', JSON.stringify(res));
  ok(fs.existsSync(out), 'G4 the card was written');
  ok(fs.readFileSync(out, 'utf8').includes('SOUL-CORE-STAMP'), 'G4 the card carries its stamp');
}

// G5 - a skip never damages what is already there.
{
  const d = repo('absent-with-card', { withSoul: false });
  const out = path.join(d, 'soul-core.md');
  fs.writeFileSync(out, 'an older card\n');
  const res = buildIn(d);
  ok(res.skipped === true, 'G5 still a skip when a card already exists');
  ok(fs.readFileSync(out, 'utf8') === 'an older card\n', 'G5 the existing card is byte-identical');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
