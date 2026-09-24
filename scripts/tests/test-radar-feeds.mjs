#!/usr/bin/env node
// scripts/tests/test-radar-feeds.mjs - the radar's feed resolver, proven on fixtures.
// (2026-09-20, radar port.)
//
// The resolver (scripts/lib/radar-feeds.js) answers one question: which feeds does #15 sweep on
// THIS machine. The answer must come from the per-install profile and from nowhere else, because
// the template deliberately ships none. These tests pin that contract, and the negatives are the
// point: R1 and R2 are what stop a future edit from "helpfully" adding a default list.
//
//   R1  NEGATIVE no profile at all      -> configured:false, zero feeds, a note naming the file
//   R2  NEGATIVE profile with no radar  -> same (a profile written for skills alone is normal)
//   R3  a configured list resolves, in order, with kinds inferred from the url
//   R4  self_watch survives the round trip (it is what marks a feed about YOUR stack)
//   R5  NEGATIVE a non-https feed is DROPPED with a warning, never silently upgraded
//   R6  NEGATIVE malformed rows (no url, not an object) are dropped WITH a reason each
//   R7  keywords default to [] and never to an invented set
//   R8  the SHIPPED example file parses and its radar.feeds is EMPTY (the template must not
//       ship a feed list, which is the whole design constraint of this port)
//
// Exit 0 = all pass, 1 = any failure.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const radarFeeds = require('../lib/radar-feeds.js');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

function fixture(profile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-radarfeeds-'));
  if (profile) {
    fs.mkdirSync(path.join(root, 'system'), { recursive: true });
    fs.writeFileSync(path.join(root, 'system', 'install-profile.json'), JSON.stringify(profile, null, 2));
  }
  return root;
}
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

// --- R1 + R2: the empty states, which must stay empty -----------------------------------------
{
  const root = fixture(null);
  const r = radarFeeds.resolve({ root });
  ok(r.configured === false && r.feeds.length === 0, 'R1 no profile -> configured:false, zero feeds');
  ok(/install-profile\.json/.test(r.note), 'R1b the note names the file to edit', r.note.slice(0, 60));
  cleanup(root);
}
{
  const root = fixture({ wake: [], park: [], lanes: {} });
  const r = radarFeeds.resolve({ root });
  ok(r.configured === false && r.feeds.length === 0, 'R2 profile without a radar block -> still zero feeds');
  cleanup(root);
}

// --- R3 + R4: a real list ----------------------------------------------------------------------
{
  const root = fixture({
    radar: {
      feeds: [
        { name: 'HN topic', url: 'https://hn.algolia.com/api/v1/search_by_date?query=x&tags=story' },
        { name: 'a tool I run', url: 'https://github.com/o/r/releases.atom', self_watch: true },
        { name: 'a community', url: 'https://www.reddit.com/r/s/.rss', tags: ['community'] },
        { name: 'a changelog page', url: 'https://example.com/news' },
      ],
      keywords: ['agents', 'automation'],
    },
  });
  const r = radarFeeds.resolve({ root });
  ok(r.configured === true && r.feeds.length === 4, 'R3a four configured feeds resolve', `got ${r.feeds.length}`);
  ok(r.feeds.map((f) => f.kind).join(',') === 'json,atom,rss,html', 'R3b kind inferred from the url', r.feeds.map((f) => f.kind).join(','));
  ok(r.feeds[0].name === 'HN topic' && r.feeds[3].name === 'a changelog page', 'R3c order is the owner order');
  ok(r.feeds[1].selfWatch === true && r.feeds[0].selfWatch === false, 'R4 self_watch survives the round trip');
  ok(r.keywords.join(',') === 'agents,automation', 'R7a keywords pass through');
  ok(r.warnings.length === 0, 'R3d a clean list warns about nothing', r.warnings.join('; '));
  cleanup(root);
}

// --- R5: http is DROPPED, never upgraded -------------------------------------------------------
{
  const root = fixture({ radar: { feeds: [{ name: 'plaintext', url: 'http://example.com/feed.rss' }] } });
  const r = radarFeeds.resolve({ root });
  ok(r.configured === false && r.feeds.length === 0, 'R5a non-https feed is DROPPED, not silently upgraded');
  ok(r.warnings.length === 1 && /https/.test(r.warnings[0]), 'R5b ...and the drop is reported with a reason', r.warnings[0]);
  cleanup(root);
}

// --- R6: malformed rows each get their own reason ----------------------------------------------
{
  const root = fixture({
    radar: { feeds: [{ name: 'no url here' }, 'a bare string', { name: 'good', url: 'https://github.com/o/r/releases.atom' }] },
  });
  const r = radarFeeds.resolve({ root });
  ok(r.feeds.length === 1 && r.feeds[0].name === 'good', 'R6a malformed rows dropped, the good one survives');
  ok(r.warnings.length === 2, 'R6b one warning per dropped row (no silent skips)', r.warnings.join(' | '));
  cleanup(root);
}

// --- R7: keywords never invented ---------------------------------------------------------------
{
  const root = fixture({ radar: { feeds: [{ name: 'x', url: 'https://github.com/o/r/releases.atom' }] } });
  const r = radarFeeds.resolve({ root });
  ok(Array.isArray(r.keywords) && r.keywords.length === 0, 'R7b no keywords configured -> [], never a guessed set');
  cleanup(root);
}

// --- R8: the SHIPPED template must carry no feeds ----------------------------------------------
// This is the design constraint of the whole port, asserted against the real file rather than a
// fixture: the moment somebody adds a "helpful" starter feed to the example, every install that
// copies it inherits a stranger's idea of what matters. Fail loudly here instead.
{
  const example = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'install-profile.example.json'), 'utf8'));
  ok(example.radar && Array.isArray(example.radar.feeds), 'R8a the example carries a radar.feeds array');
  ok(example.radar && example.radar.feeds.length === 0, 'R8b ...and it is EMPTY - the template ships nobody feeds', `got ${example.radar && example.radar.feeds.length}`);
}

console.log('');
if (failures === 0) {
  console.log('test-radar-feeds: ALL PASS');
  process.exit(0);
} else {
  console.log(`test-radar-feeds: ${failures} FAILURE(S)`);
  process.exit(1);
}
