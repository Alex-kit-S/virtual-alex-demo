// @ts-check
// scripts/tests/test-install-profile.mjs - the install profile's one writer, and the example it owns.
//
// WHAT. Holds scripts/lib/install-profile.js as the one writer of system/install-profile.json: P1 the committed
// example is byte for byte what --write-example writes; P2 skill-state.js, radar-feeds.js and the audit read that
// shape; P3 a legacy profile keeps every underscore key in legacy_notes; P4 NEGATIVE a legacy key that is not
// snake_case is refused by name, the file untouched; P5 skills-park.js writes through it, never with a raw
// JSON.stringify. Deleted, a hand-edited example, a lost owner note or a raw write of the profile would pass CI.
//
// HOW. Every leg runs in a throwaway root under the OS temp directory, removed when the run ends,
// except P1 and P5, which read the checkout's own committed example and skills-park.js.
//
// NEVER. Writes into the checkout.
//
// Usage: node scripts/tests/test-install-profile.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-install-profile-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** @param {string} rel @returns {any} */
function tryLoad(rel) {
  try {
    return require(path.join(KIT, rel));
  } catch (/** @type {any} */ e) {
    return { __loadError: e.message };
  }
}
const ip = tryLoad('scripts/lib/install-profile.js');
const { readJson, canonicalText } = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const audit = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));
const EXAMPLE_REL = 'system/install-profile.example.json';

/**
 * @param {string} name
 * @param {Record<string, string>} [files]
 */
function root(name, files = {}) {
  const r = path.join(TMP, name);
  fs.mkdirSync(path.join(r, 'system'), { recursive: true });
  fs.writeFileSync(path.join(r, 'skills-lock.json'), `${JSON.stringify({ version: 1, skills: {} }, null, 2)}\n`);
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), '# fixture\n');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), text);
  }
  return r;
}

const LEGACY = {
  _what: "EXAMPLE of system/install-profile.json - this machine's own skill and lane choices.",
  _how: 'wake[] un-parks skills the template ships parked.',
  _lanes_note: "an owner's own note, which must survive",
  _radar_examples: [{ name: 'x', url: 'https://example.com/feed.rss', kind: 'rss' }],
  wake: ['pdf'],
  park: [],
  radar: { feeds: [], keywords: ['gold'] },
  lanes: { website: false, marketing: true, finance: false, 'business-validation': true },
  locale: 'tr'
};

describe('scripts/lib/install-profile.js', () => {
  test('P0 scripts/lib/install-profile.js loads', () => {
    assert.ok(!ip.__loadError, ip.__loadError || '');
  });

  test('P1 the committed example is byte-identical to what --write-example writes, carries its schema and writer, ships no feeds, and the audit finds nothing', () => {
    const committed = fs.readFileSync(path.join(KIT, EXAMPLE_REL), 'utf8');
    const r = root('p1', { [EXAMPLE_REL]: committed });
    const res = ip.writeExample(r);
    assert.equal(res.written, false, `writer says ${res?.reason}`);
    const parsed = readJson(path.join(KIT, EXAMPLE_REL), 'install-profile@1');
    assert.equal(parsed._writer, 'scripts/lib/install-profile.js');
    assert.ok(parsed.radar && Array.isArray(parsed.radar.feeds), JSON.stringify(parsed.radar));
    assert.equal(parsed.radar.feeds.length, 0, 'the example ships NO feeds');
    assert.ok(
      Array.isArray(parsed.radar.examples) && parsed.radar.examples.length === 3,
      `the three worked examples: ${(parsed.radar.examples || []).length}`
    );
    const row = audit.auditText(EXAMPLE_REL, committed, { root: KIT });
    assert.deepEqual(row.findings, [], 'the audit finds nothing in the example (the declared `lanes` map included)');
    assert.ok(row.canonical);
  });

  test('P2 every reader sees the new shape', () => {
    const committed = fs.readFileSync(path.join(KIT, EXAMPLE_REL), 'utf8');
    const r = root('p2', { 'system/install-profile.json': committed });
    const skillState = require(path.join(KIT, 'scripts', 'lib', 'skill-state.js'));
    const radar = require(path.join(KIT, 'scripts', 'lib', 'radar-feeds.js'));
    const s = skillState.resolve({ root: r });
    const f = radar.resolve({ root: r });
    assert.equal(s.locale, 'en');
    assert.equal(s.lanes['business-validation'], false);
    assert.deepEqual(s.warnings, [], 'skill-state.js reads the new shape with no warnings');
    assert.equal(f.configured, false);
    assert.deepEqual(f.feeds, [], `radar-feeds.js ignores radar.examples: ${f.feeds.length} feed(s)`);
    assert.deepEqual(f.warnings, []);
  });

  test('P3 a legacy profile is rewritten through the helper as install-profile@1 and loses nothing', () => {
    const r = root('p3', { 'system/install-profile.json': `${JSON.stringify(LEGACY, null, 2)}\n` });
    const res = ip.writeProfile(r, JSON.parse(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8')));
    const after1 = readJson(path.join(r, 'system', 'install-profile.json'), 'install-profile@1');
    assert.ok(res.written);
    assert.ok(after1);
    const n = after1.legacy_notes || {};
    assert.equal(n.what, LEGACY._what);
    assert.equal(n.how, LEGACY._how);
    assert.equal(n.lanes_note, LEGACY._lanes_note);
    // Compared as canonical text: the helper sorts keys by design, so key ORDER is not content.
    assert.equal(
      canonicalText(n.radar_examples || null, { validate: false }),
      canonicalText(LEGACY._radar_examples, { validate: false }),
      "every legacy underscore key, the owner's own `_lanes_note` included, is kept whole in legacy_notes"
    );
    assert.deepEqual(after1.wake, ['pdf'], 'the choices themselves are unchanged (wake, locale, every lane, keywords)');
    assert.equal(after1.locale, 'tr');
    assert.equal(after1.lanes.marketing, true);
    assert.equal(after1.lanes['business-validation'], true);
    assert.deepEqual(after1.radar.keywords, ['gold']);
    const row = audit.auditText(
      'system/install-profile.json',
      fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'),
      { root: KIT }
    );
    assert.deepEqual(row.findings, [], 'the rewritten profile has no audit findings');
    // Written again from what is now on disk: a no-op, so skills-park never churns an unchanged profile.
    const again = ip.writeProfile(
      r,
      JSON.parse(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'))
    );
    assert.equal(again.written, false, 'rewriting the migrated profile unchanged is a no-op');
  });

  test('P4 NEGATIVE a legacy key that is not snake_case without its underscore is refused by name, and the file on disk is untouched', () => {
    const bad = { ...LEGACY, '_Lanes-Note': 'not snake_case once the underscore goes' };
    const text = `${JSON.stringify(bad, null, 2)}\n`;
    const r = root('p4', { 'system/install-profile.json': text });
    assert.throws(() => ip.writeProfile(r, bad), /_Lanes-Note/);
    assert.equal(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'), text);
  });

  test('P5 skills-park.js writeProfileFile goes through install-profile.js, with no raw JSON.stringify', () => {
    const src = fs.readFileSync(path.join(KIT, 'scripts', 'skills-park.js'), 'utf8');
    const fn = (src.match(/function writeProfileFile\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    assert.match(fn, /installProfile\.writeProfile\(/);
    assert.doesNotMatch(fn, /JSON\.stringify/);
  });
});
