// @ts-check
// scripts/tests/test-radar-feeds.mjs - the radar's feed resolver, proven on fixtures.
//
// WHAT. scripts/lib/radar-feeds.js answers which feeds the radar (#15) sweeps on this machine, from this
// machine's profile and from nowhere else, because the template deliberately ships none. Deleted, this file
// would let an edit "helpfully" add a default feed list or keyword set, upgrade an http feed instead of
// dropping it, or drop a row without a reason, with every other test green. The negatives are the point:
//   R1  NEGATIVE no profile at all: configured false, zero feeds, and a note naming the file to edit
//   R2  NEGATIVE a profile with no radar block: the same (a profile written for skills alone is normal)
//   R3  a configured list resolves in the owner's order, with kinds inferred from the url
//   R4  self_watch survives the round trip (it marks a feed about a tool the owner runs)
//   R5  NEGATIVE a feed that is not https is DROPPED with a warning, never silently upgraded
//   R6  NEGATIVE malformed rows (no url, not an object) are dropped, each with its reason
//   R7  keywords pass through, and default to [], never to an invented set
//   R8  the SHIPPED system/install-profile.example.json parses and its radar.feeds is EMPTY
//
// HOW. R1 to R7 write a profile into a fresh folder under the OS temp folder and call the module, each
// folder removed in the test's own after() hook; R8 reads the real example file, because a template that
// ships no feeds is the whole design constraint.
//
// NEVER. Writes into this checkout, or reaches a network.
//
// Usage: node scripts/tests/test-radar-feeds.mjs
// Exit: 0 every leg passes - 1 any leg fails

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const radarFeeds = require('../lib/radar-feeds.js');

/**
 * A fresh folder holding system/install-profile.json with this content, or no profile for null. Removed
 * when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {object | null} profile
 * @returns {string} its root
 */
function fixture(t, profile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-radarfeeds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (profile) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'system', 'install-profile.json'), JSON.stringify(profile, null, 2));
  }
  return root;
}

describe('scripts/lib/radar-feeds.js', () => {
  test('R1 no profile -> configured:false, zero feeds, and a note naming the file to edit', (t) => {
    const root = fixture(t, null);
    const r = radarFeeds.resolve({ root });
    assert.equal(r.configured, false);
    assert.equal(r.feeds.length, 0);
    assert.match(r.note, /install-profile\.json/, r.note.slice(0, 60));
  });

  test('R2 a profile without a radar block resolves to the same empty state', (t) => {
    const root = fixture(t, { wake: [], park: [], lanes: {} });
    const r = radarFeeds.resolve({ root });
    assert.equal(r.configured, false);
    assert.equal(r.feeds.length, 0);
  });

  test('R3 + R4 + R7a a real list resolves in the owner order, kinds inferred, self_watch and keywords survive', (t) => {
    const root = fixture(t, {
      radar: {
        feeds: [
          { name: 'HN topic', url: 'https://hn.algolia.com/api/v1/search_by_date?query=x&tags=story' },
          { name: 'a tool I run', url: 'https://github.com/o/r/releases.atom', self_watch: true },
          { name: 'a community', url: 'https://www.reddit.com/r/s/.rss', tags: ['community'] },
          { name: 'a changelog page', url: 'https://example.com/news' }
        ],
        keywords: ['agents', 'automation']
      }
    });
    const r = radarFeeds.resolve({ root });
    assert.equal(r.configured, true);
    assert.equal(r.feeds.length, 4, `got ${r.feeds.length}`);
    assert.equal(r.feeds.map((f) => f.kind).join(','), 'json,atom,rss,html', r.feeds.map((f) => f.kind).join(','));
    assert.equal(r.feeds[0].name, 'HN topic');
    assert.equal(r.feeds[3].name, 'a changelog page');
    assert.equal(r.feeds[1].selfWatch, true, 'R4 self_watch survives the round trip');
    assert.equal(r.feeds[0].selfWatch, false);
    assert.equal(r.keywords.join(','), 'agents,automation');
    assert.deepEqual(r.warnings, [], r.warnings.join('; '));
  });

  test('R5 NEGATIVE a non-https feed is DROPPED, never silently upgraded, and the drop is reported with a reason', (t) => {
    const root = fixture(t, { radar: { feeds: [{ name: 'plaintext', url: 'http://example.com/feed.rss' }] } });
    const r = radarFeeds.resolve({ root });
    assert.equal(r.configured, false);
    assert.equal(r.feeds.length, 0);
    assert.equal(r.warnings.length, 1, r.warnings.join('; '));
    assert.match(r.warnings[0], /https/);
  });

  test('R6 malformed rows are each dropped with their own reason, the good one survives', (t) => {
    const root = fixture(t, {
      radar: {
        feeds: [{ name: 'no url here' }, 'a bare string', { name: 'good', url: 'https://github.com/o/r/releases.atom' }]
      }
    });
    const r = radarFeeds.resolve({ root });
    assert.equal(r.feeds.length, 1);
    assert.equal(r.feeds[0].name, 'good');
    assert.equal(r.warnings.length, 2, r.warnings.join(' | '));
  });

  test('R7b no keywords configured -> [], never a guessed set', (t) => {
    const root = fixture(t, { radar: { feeds: [{ name: 'x', url: 'https://github.com/o/r/releases.atom' }] } });
    const r = radarFeeds.resolve({ root });
    assert.ok(Array.isArray(r.keywords));
    assert.equal(r.keywords.length, 0);
  });

  // R8: the SHIPPED template must carry no feeds. This is the design constraint of the whole port,
  // asserted against the real file rather than a fixture: the moment somebody adds a "helpful" starter
  // feed to the example, every install that copies it inherits a stranger's idea of what matters.
  test('R8 the shipped system/install-profile.example.json carries an empty radar.feeds array', () => {
    const example = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'install-profile.example.json'), 'utf8'));
    assert.ok(example.radar && Array.isArray(example.radar.feeds), 'the example carries a radar.feeds array');
    assert.equal(example.radar.feeds.length, 0, `the template ships nobody feeds: got ${example.radar?.feeds.length}`);
  });
});
