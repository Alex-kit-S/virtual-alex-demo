#!/usr/bin/env node
// @ts-check
// scripts/tests/test-skills-park-cli.mjs - scripts/skills-park.js as the owner runs it, pinned as it behaves.
//
// WHAT. scripts/tests/test-skills-park.mjs tests a copy of one primitive; this file runs the real script.
// Deleted, it would let a change break --list and its lines, park and wake through this machine's profile
// or through the tracked lock (--lock), the read-back, the MANDATORY floor refused up front, a name not in
// the lock or with no content skipped by name, the content left untouched when a link goes, the usage line
// and exit 1, or the write lock and exit 2, with every other test green.
//
// HOW. Each test builds a throwaway tree under one OS temp folder, with the REAL script and the four
// scripts/lib modules it loads copied in, a synthetic lock, a synthetic constitution and three invented
// skills, and runs the script there as a child process with the ALEX_ variables removed. A test named
// "PINNED DEFECT <id>" asserts behaviour known to be wrong; its fix flips exactly that assertion when the
// defect ledger schedules it.
//
// NEVER. Touches a link outside a fixture, or reaches a network. Fixes a defect it still pins (R8-15,
// its other two symptoms): --wake cannot repair a dangling link, and a --lock wake fails while this
// machine's profile still parks the skill. R8-15's flag half - a flag in the value position read as a
// skill name and the write target rewritten anyway, and an unknown flag silently ignored - is not:
// scripts/skills-park.js parses through scripts/lib/args.js for real, and the test proves nothing is
// written with the lock file made read-only for the case, not by a byte compare alone.
//
// Usage: node scripts/tests/test-skills-park-cli.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-sp-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/**
 * @param {string} root
 * @param {string} rel
 * @param {string} content
 */
function put(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
/** A fresh fixture tree holding the real script and the modules it loads; returns its root. */
function tree() {
  const root = path.join(TMP, `t${++n}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'scripts', 'skills-park.js'), path.join(root, 'scripts', 'skills-park.js'));
  for (const f of [
    'skill-state.js',
    'install-profile.js',
    'write-lock.js',
    'json-writer.js',
    'repo-root.js',
    'args.js',
    'errors.js',
    'exit-codes.js'
  ]) {
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(root, 'scripts', 'lib', f));
  }
  for (const s of ['alpha', 'beta', 'mand']) put(root, `.agents/skills/${s}/SKILL.md`, `# ${s}\n`);
  put(
    root,
    'skills-lock.json',
    `${JSON.stringify({ version: 2, skills: { alpha: {}, beta: { parked: true }, mand: {} } }, null, 2)}\n`
  );
  put(
    root,
    'CLAUDE.md',
    '# Alex\n\n| Task trigger | Skill(s) | Strength |\n|---|---|---|\n| do a thing | mand | MANDATORY |\n'
  );
  return root;
}
/** This process's environment without the ALEX_ switches. */
function env() {
  /** @type {NodeJS.ProcessEnv} */
  const e = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^ALEX_/.test(k)) e[k] = v;
  return e;
}
/**
 * Run the fixture's skills-park.js with these arguments.
 * @param {string} root
 * @param {string[]} [args]
 */
function park(root, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'skills-park.js'), ...args], {
    cwd: root,
    env: env(),
    encoding: 'utf8'
  });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    out: r.stdout.trimEnd().split('\n').filter(Boolean),
    err: r.stderr.trimEnd().split('\n').filter(Boolean)
  };
}
const profile = (/** @type {string} */ root) =>
  JSON.parse(fs.readFileSync(path.join(root, 'system', 'install-profile.json'), 'utf8'));
const lock = (/** @type {string} */ root) => JSON.parse(fs.readFileSync(path.join(root, 'skills-lock.json'), 'utf8'));
// lstat reports a link as a SYMLINK on both platforms, Windows junctions included, as skills-park.js
// removeLink's own comment says. Pinned as measured.
const linkState = (/** @type {string} */ root, /** @type {string} */ name) => {
  const p = path.join(root, '.claude', 'skills', name);
  try {
    const st = fs.lstatSync(p);
    return `${st.isSymbolicLink() ? 'link' : 'dir'} ${fs.existsSync(path.join(p, 'SKILL.md')) ? 'live' : 'dead'}`;
  } catch {
    return 'absent';
  }
};

test('--list on a fresh tree: the effective counts come from the lock alone, the parked name is listed, and a skill awake in the lock with no link yet is a warning', () => {
  const root = tree();
  const r = park(root, ['--list']);
  assert.deepEqual(
    [r.status, r.out],
    [
      0,
      [
        'skills: 3 total, 2 awake, 1 parked (effective = lock, no profile)',
        'parked: beta',
        'WARN awake-but-dead links (run: node scripts/bootstrap.mjs --repair-links): alpha, mand'
      ]
    ]
  );
  assert.deepEqual(park(root, []).out, r.out, 'no argument at all is --list');
});

test('--list is not a short-circuit: --list --bogus and --wake --list both refuse, exit 1, nothing written', () => {
  const root = tree();
  const bogus = park(root, ['--list', '--bogus']);
  assert.deepEqual(
    [bogus.status, bogus.out, bogus.err],
    [1, [], ['usage: skills-park --park a,b | --wake a,b | --list']]
  );
  const wakeList = park(root, ['--wake', '--list']);
  assert.deepEqual(
    [wakeList.status, wakeList.out, wakeList.err],
    [1, [], ['usage: skills-park --park a,b | --wake a,b | --list']]
  );
  assert.ok(!fs.existsSync(path.join(root, 'system', 'install-profile.json')), 'neither case wrote a profile');
});

test("wake and park through this machine's profile: the link is created and removed while the content stays, the profile carries the choice, and the tracked lock never moves", () => {
  const root = tree();
  const lockBefore = fs.readFileSync(path.join(root, 'skills-lock.json'), 'utf8');
  const woke = park(root, ['--wake', 'beta']);
  assert.deepEqual([woke.status, woke.out], [0, ["woke 1 in this machine's profile (link verified live)"]]);
  assert.equal(linkState(root, 'beta'), 'link live');
  assert.deepEqual([profile(root).wake, profile(root).park], [['beta'], []]);
  assert.equal(
    fs.readFileSync(path.join(root, 'skills-lock.json'), 'utf8'),
    lockBefore,
    'the template lock is untouched, so an update can never conflict on a personal choice'
  );
  assert.equal(
    park(root, ['--list']).out[0],
    "skills: 3 total, 3 awake, 0 parked (effective = lock + this machine's profile)"
  );
  const parked = park(root, ['--park=beta']);
  assert.deepEqual(
    [parked.status, parked.out],
    [0, ["parked 1 in this machine's profile (link removed, content untouched)"]]
  );
  assert.equal(linkState(root, 'beta'), 'absent');
  assert.equal(
    fs.readFileSync(path.join(root, '.agents', 'skills', 'beta', 'SKILL.md'), 'utf8'),
    '# beta\n',
    'the content is never touched'
  );
  assert.deepEqual([profile(root).wake, profile(root).park], [[], ['beta']]);
});

test('park skips, by name and with its reason, a MANDATORY-bound skill, a name not in the lock and a name with no content; the others are still parked', () => {
  const root = tree();
  const r = park(root, ['--park', 'alpha,mand,not-in-lock']);
  assert.deepEqual(
    [r.status, r.out],
    [
      0,
      [
        "parked 1 in this machine's profile (link removed, content untouched); skipped: mand (MANDATORY-bound, refusing to park); not-in-lock (not in lock)"
      ]
    ]
  );
  assert.deepEqual(profile(root).park, ['alpha']);
  const root2 = tree();
  fs.rmSync(path.join(root2, '.agents', 'skills', 'alpha'), { recursive: true });
  assert.equal(
    park(root2, ['--park', 'alpha']).out[0],
    "parked 0 in this machine's profile (link removed, content untouched); skipped: alpha (no .agents/skills content - refusing)"
  );
});

test('--lock writes the TEMPLATE default instead of the profile, and no profile file is created', () => {
  const root = tree();
  const r = park(root, ['--park', 'alpha', '--lock']);
  assert.deepEqual([r.status, r.out], [0, ['parked 1 in the template LOCK (link removed, content untouched)']]);
  assert.equal(lock(root).skills.alpha.parked, true);
  assert.match(lock(root).skills.alpha.parkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    !fs.existsSync(path.join(root, 'system', 'install-profile.json')),
    "template development never writes this machine's profile"
  );
  const woke = park(root, ['--wake', 'alpha', '--lock']);
  assert.deepEqual([woke.status, woke.out], [0, ['woke 1 in the template LOCK (link verified live)']]);
  assert.deepEqual(Object.keys(lock(root).skills.alpha), [], 'both flags are deleted, not set to false');
});

test('the usage line and exit 1 on an unknown flag or a flag with no names; a held write lock is exit 2 and names the holder', () => {
  const root = tree();
  for (const args of [['--bogus'], ['--park'], ['--wake']]) {
    const r = park(root, args);
    assert.deepEqual([r.status, r.err], [1, ['usage: skills-park --park a,b | --wake a,b | --list']], args.join(' '));
  }
  put(
    root,
    '.alex-lock-alex-surfaces/holder.json',
    JSON.stringify({ label: 'fixture-holder', pid: 4242, since: '2026-09-20T10:00:00.000Z' })
  );
  const held = park(root, ['--park', 'alpha']);
  assert.deepEqual(
    [held.status, held.err],
    [2, ['skills-park: write lock busy (held by fixture-holder (pid 4242) since 2026-09-20T10:00:00.000Z)']]
  );
  assert.ok(!fs.existsSync(path.join(root, 'system', 'install-profile.json')), 'a deferred run writes nothing');
  assert.equal(park(root, ['--list']).status, 0, 'a read needs no lock');
});

test('PINNED DEFECT R8-15: --wake cannot repair a DANGLING link: it exits 1 on the raw EEXIST, and the owner must park it first', () => {
  const root = tree();
  fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
  const link = path.join(root, '.claude', 'skills', 'alpha');
  fs.symlinkSync(path.resolve(root, '.agents', 'skills', 'alpha-gone'), link, 'junction');
  assert.equal(linkState(root, 'alpha'), 'link dead');
  const r = park(root, ['--wake', 'alpha']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^skills-park FAILED: (EEXIST|wake verify FAILED)/);
  assert.equal(park(root, ['--park', 'alpha']).status, 0, 'parking removes the dead link');
  assert.equal(linkState(root, 'alpha'), 'absent');
  const fixed = park(root, ['--wake', 'alpha']);
  assert.deepEqual([fixed.status, fixed.out], [0, ["woke 1 in this machine's profile (link verified live)"]]);
});

test('a flag in value position, or an unknown flag, refuses (exit 1) with the usage line, and writes nothing at all', () => {
  const root = tree();
  const lockFile = path.join(root, 'skills-lock.json');
  const before = fs.readFileSync(lockFile, 'utf8');
  // Read-only, not just a before/after byte compare: this refusal path never reaches readSkillsLock() at
  // all, so a regression that tried to read-then-write it would throw EACCES/EPERM here and crash the
  // case below (a different status and stderr, not a quiet pass), rather than merely rewriting the same
  // bytes back and looking identical to a byte compare.
  fs.chmodSync(lockFile, 0o444);
  try {
    for (const args of [
      ['--park', '--lock'],
      ['--wake', '--lock'],
      ['--park', 'alpha', '--bogus']
    ]) {
      const r = park(root, args);
      assert.deepEqual(
        [r.status, r.out, r.err],
        [1, [], ['usage: skills-park --park a,b | --wake a,b | --list']],
        args.join(' ')
      );
    }
  } finally {
    fs.chmodSync(lockFile, 0o666);
  }
  assert.equal(fs.readFileSync(lockFile, 'utf8'), before, 'the lock file is not touched at all');
  assert.ok(!fs.existsSync(path.join(root, 'system', 'install-profile.json')), 'no profile is written either');
});

test("PINNED DEFECT R8-15: a lock-mode wake FAILS while this machine's profile still parks the same skill, because the resolver answers with the profile on top", () => {
  const root = tree();
  park(root, ['--park', 'alpha']);
  assert.deepEqual(profile(root).park, ['alpha']);
  const r = park(root, ['--wake', 'alpha', '--lock']);
  assert.deepEqual([r.status, r.err], [1, ['skills-park FAILED: wake verify FAILED for: alpha']]);
  assert.equal(
    linkState(root, 'alpha'),
    'link live',
    'the link was made before the verify threw, so the tree is left half changed'
  );
  assert.deepEqual(profile(root).park, ['alpha'], 'and the profile still parks it');
});

const UNREADABLE_PROFILE =
  'skills-park FAILED: system/install-profile.json is there but does not parse as JSON (a byte-order mark, a syntax ' +
  'error, or not a file), so writing this change would replace every setting it holds with defaults. Nothing was ' +
  'changed: fix the file, then run skills-park again.';

test('a profile that is there but cannot be read refuses a park or a wake before any link or file changes, exit 1, the file byte-identical', () => {
  const settings =
    '"wake":["beta"],"park":[],"locale":"sv","employer_domain":"corp.example","owner_work_address":"me@corp.example"';
  /** @type {Record<string, string | null>} null puts a folder at the path */
  const shapes = {
    'a byte-order mark': `\ufeff{${settings}}\n`,
    'a trailing comma': `{${settings},}\n`,
    'an empty file': '',
    'a folder at the path': null
  };
  for (const [what, text] of Object.entries(shapes)) {
    for (const args of [
      ['--park', 'alpha'],
      ['--wake', 'beta']
    ]) {
      const root = tree();
      const file = path.join(root, 'system', 'install-profile.json');
      if (text === null) fs.mkdirSync(file, { recursive: true });
      else put(root, 'system/install-profile.json', text);
      fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });
      fs.symlinkSync(
        path.resolve(root, '.agents', 'skills', 'alpha'),
        path.join(root, '.claude', 'skills', 'alpha'),
        'junction'
      );
      const r = park(root, args);
      const label = `${what}, ${args.join(' ')}`;
      assert.deepEqual([r.status, r.out, r.err], [1, [], [UNREADABLE_PROFILE]], label);
      if (text === null) assert.deepEqual(fs.readdirSync(file), [], `${label}: the folder is left as it was`);
      else assert.equal(fs.readFileSync(file, 'utf8'), text, `${label}: the profile is byte-identical`);
      assert.deepEqual(
        [linkState(root, 'alpha'), linkState(root, 'beta')],
        ['link live', 'absent'],
        `${label}: no link was removed or made`
      );
    }
  }
  const absent = tree();
  assert.equal(park(absent, ['--park', 'alpha']).status, 0, 'no profile at all still starts from the defaults');
});
