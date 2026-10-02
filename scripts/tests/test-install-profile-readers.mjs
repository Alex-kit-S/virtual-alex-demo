#!/usr/bin/env node
// @ts-check
// scripts/tests/test-install-profile-readers.mjs - holds the install profile's two readers to what they do today.
//
// WHAT. scripts/lib/skill-state.js (which skills are awake here) and scripts/lib/radar-feeds.js (which feeds
// the radar sweeps) both read system/install-profile.json. This file holds them on the paths nothing else
// tests: no profile, a profile that parses, one that does not, one behind a byte-order mark, fields of the
// wrong type, and the MANDATORY floor. Deleted, a reader could change what an owner's odd or broken profile
// resolves to, or loosen the floor, with nothing in CI noticing.
//
// HOW. Every test builds a small synthetic install in one temp folder (a lock, a constitution with one
// MANDATORY row, and the profile under test) and calls the real modules, copied there so their own paths
// resolve. A test named "PINNED DEFECT <id>" asserts behaviour known to be wrong; the fix flips exactly that
// assertion.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task. Fixes a
// defect it pins, each silent today: a profile that does not parse, or carries a byte-order mark, reverts
// the owner's settings to template defaults with no message (R6-7); a wake list written as a string is read
// letter by letter, and a park list written as a number throws a raw TypeError (R6-26); a feed list that is
// not an array is dropped with no warning (R6-27, still pinned). R6-27's other half, the command line, is
// not: an unknown flag is named on stderr through scripts/lib/args.js's routine edge and the run carries
// on, since radar-feeds.js has a Routine caller; the test asserts that.
//
// Usage: node scripts/tests/test-install-profile-readers.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-profile-readers-')));
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});
const BOM = String.fromCharCode(0xfeff);
const PROFILE = path.join('system', 'install-profile.json');
const LOCK = { skills: { 'alpha-one': {}, 'beta-two': { parked: true }, pdf: {} } };
const CONSTITUTION =
  '# c\n\n| Task trigger | Skill(s) | Strength |\n|---|---|---|\n| Anything | alpha-one | MANDATORY |\n';

let seq = 0;
/**
 * A fresh synthetic install holding copies of both readers, and the profile when one is given.
 * @param {string} [profileText] the profile's exact text; none is written when absent
 */
function install(profileText) {
  const root = path.join(ROOT, `i${++seq}`);
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  for (const f of [
    'skill-state.js',
    'radar-feeds.js',
    'json-writer.js',
    'repo-root.js',
    'args.js',
    'errors.js',
    'exit-codes.js'
  ])
    fs.copyFileSync(path.join(KIT, 'scripts', 'lib', f), path.join(root, 'scripts', 'lib', f));
  fs.writeFileSync(path.join(root, 'skills-lock.json'), JSON.stringify(LOCK, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), CONSTITUTION);
  if (profileText !== undefined) fs.writeFileSync(path.join(root, PROFILE), profileText);
  return {
    root,
    skills: require(path.join(root, 'scripts', 'lib', 'skill-state.js')),
    radar: require(path.join(root, 'scripts', 'lib', 'radar-feeds.js'))
  };
}
/**
 * @typedef {object} Resolution what skill-state's resolve() answers for one install
 * @property {Iterable<string>} awake
 * @property {Iterable<string>} parked
 * @property {Iterable<string>} mandatory
 * @property {unknown} lanes
 * @property {unknown} locale
 * @property {unknown} warnings
 */

/**
 * A resolution with its three sets as sorted arrays, so it compares as plain data.
 * @param {Resolution} r
 */
const plain = (r) => ({
  awake: [...r.awake].sort(),
  parked: [...r.parked].sort(),
  mandatory: [...r.mandatory].sort(),
  lanes: r.lanes,
  locale: r.locale,
  warnings: r.warnings
});
const DEFAULTS = {
  awake: ['alpha-one', 'pdf'],
  parked: ['beta-two'],
  mandatory: ['alpha-one'],
  lanes: {},
  locale: 'en',
  warnings: []
};
const FEEDS = {
  radar: { feeds: [{ name: 'Zz feed', url: 'https://example.invalid/feed.rss' }], keywords: ['zz'] },
  wake: ['beta-two'],
  locale: 'sv'
};

describe('skill-state: the profile layer', () => {
  test('no profile: the template defaults, the MANDATORY floor parsed from the constitution', () => {
    const { root, skills } = install();
    assert.equal(skills.readProfile(root), null);
    assert.deepEqual(plain(skills.resolve({ root })), DEFAULTS);
    assert.equal(skills.PROFILE_REL, PROFILE);
  });

  test('a profile that parses: wake un-parks, locale and lanes are read', () => {
    const { root, skills } = install(JSON.stringify({ ...FEEDS, lanes: { ai: true } }));
    assert.deepEqual(plain(skills.resolve({ root })), {
      ...DEFAULTS,
      awake: ['alpha-one', 'beta-two', 'pdf'],
      parked: [],
      lanes: { ai: true },
      locale: 'sv'
    });
  });

  test('PINNED DEFECT R6-7: a profile that does not parse is read as NO profile, with no warning', () => {
    const { root, skills } = install(JSON.stringify(FEEDS).replace(/}$/, ','));
    assert.equal(skills.readProfile(root), null);
    assert.deepEqual(plain(skills.resolve({ root })), DEFAULTS);
  });

  test('PINNED DEFECT R6-7: a profile with a byte-order mark is read as NO profile, with no warning', () => {
    const { root, skills } = install(BOM + JSON.stringify(FEEDS));
    assert.equal(skills.readProfile(root), null);
    assert.deepEqual(plain(skills.resolve({ root })), DEFAULTS);
  });

  test('PINNED DEFECT R6-26: a wake list written as a string is read letter by letter, and the skill stays parked', () => {
    const { root, skills } = install(JSON.stringify({ wake: 'beta-two' }));
    const r = plain(skills.resolve({ root }));
    assert.deepEqual(r.parked, ['beta-two']);
    assert.deepEqual(
      r.warnings,
      [...'beta-two'].map((c) => `profile wakes unknown skill '${c}' (not in skills-lock.json) - ignored`)
    );
  });

  test('PINNED DEFECT R6-26: a park list written as a number throws a raw TypeError', () => {
    const { root, skills } = install(JSON.stringify({ park: 5 }));
    assert.throws(
      () => skills.resolve({ root }),
      (e) => e instanceof TypeError && /is not iterable/.test(e.message)
    );
  });

  test('the floor: a profile that parks a MANDATORY skill, and a lock that does, are refused by name', () => {
    const a = install(JSON.stringify({ park: ['alpha-one'] }));
    assert.throws(() => a.skills.resolve({ root: a.root }), {
      message:
        "install-profile.json tries to park MANDATORY skill 'alpha-one'. MANDATORY bindings (constitution Skill Bindings table) are the floor no profile may go below - V17 fails the build on the same fact. Remove 'alpha-one' from the profile's park list."
    });
    const b = install();
    fs.writeFileSync(
      path.join(b.root, 'skills-lock.json'),
      JSON.stringify({ skills: { 'alpha-one': { parked: true } } })
    );
    assert.throws(() => b.skills.resolve({ root: b.root }), {
      message:
        "skills-lock.json parks MANDATORY skill 'alpha-one' (and no profile woke it). A MANDATORY binding must always resolve; fix the lock, not the callers."
    });
  });
});

describe('radar-feeds: the radar block of the same profile', () => {
  test('a configured profile: the contract shape the radar command reads', () => {
    const { root, radar } = install(JSON.stringify(FEEDS));
    const r = radar.resolve({ root });
    assert.deepEqual(Object.keys(r), ['configured', 'feeds', 'keywords', 'warnings', 'note']);
    assert.deepEqual(r, {
      configured: true,
      feeds: [{ name: 'Zz feed', url: 'https://example.invalid/feed.rss', kind: 'rss', tags: [], selfWatch: false }],
      keywords: ['zz'],
      warnings: [],
      note: ''
    });
  });

  test('PINNED DEFECT R6-7: a profile that does not parse, or carries a byte-order mark, tells the owner to ADD the feeds it already lists', () => {
    for (const text of [JSON.stringify(FEEDS).replace(/}$/, ','), BOM + JSON.stringify(FEEDS)]) {
      const { root, radar } = install(text);
      assert.deepEqual(radar.resolve({ root }), {
        configured: false,
        feeds: [],
        keywords: [],
        warnings: [],
        note: radar.NOT_CONFIGURED_NOTE
      });
    }
    assert.equal(
      install().radar.NOT_CONFIGURED_NOTE,
      'no feeds configured - add a "radar": { "feeds": [...] } block to system/install-profile.json (copy the shape from system/install-profile.example.json), then run /radar again'
    );
  });

  test('PINNED DEFECT R6-27: a feed list that is not an array is dropped with no warning', () => {
    const { root, radar } = install(
      JSON.stringify({ radar: { feeds: { name: 'one', url: 'https://example.invalid/a.rss' } } })
    );
    const r = radar.resolve({ root });
    assert.equal(r.configured, false);
    assert.deepEqual(r.warnings, []);
  });

  test('a mistyped flag is named on stderr and the run carries on; --json alone still decides the form', () => {
    const { root, radar } = install();
    const cli = path.join(root, 'scripts', 'lib', 'radar-feeds.js');
    const human = spawnSync(process.execPath, [cli, '--jsn'], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(
      [human.status, human.stdout, human.stderr],
      [0, `radar-feeds: ${radar.NOT_CONFIGURED_NOTE}\n`, 'radar-feeds: WARNING - ignored --jsn: unknown flag --jsn\n']
    );
    const both = spawnSync(process.execPath, [cli, '--json', '--jsn'], { cwd: root, encoding: 'utf8' });
    assert.equal(both.status, 0);
    assert.equal(both.stderr, 'radar-feeds: WARNING - ignored --jsn: unknown flag --jsn\n');
    assert.deepEqual(JSON.parse(both.stdout), {
      configured: false,
      feeds: [],
      keywords: [],
      warnings: [],
      note: radar.NOT_CONFIGURED_NOTE
    });
  });
});
