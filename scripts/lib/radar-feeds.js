'use strict';
/*
 * scripts/lib/radar-feeds.js - THE single resolver for which feeds the radar (#15) sweeps on THIS
 * machine. (2026-09-20, radar port.)
 *
 * WHY THE FEED LIST IS NOT IN THE TEMPLATE. This Kit is installed by different people doing
 * different work. A feed list is the most personal thing in the project: it is a statement about
 * what its owner considers worth knowing. Ship one person's feeds to everyone and every other
 * install gets a radar that is confidently wrong every single week - and confidently wrong is the
 * expensive kind, because it still returns items, so nothing looks broken. So the template ships
 * NO feeds, and the list lives in the per-install profile layer.
 *
 * WHY IT REUSES skill-state.js RATHER THAN READING THE FILE ITSELF. install-profile.json already
 * has exactly one reader (skill-state.js:readProfile) and that is deliberate: the moment two
 * modules parse the same per-install file their own way, they get two chances to disagree about a
 * machine whose owner cannot debug either. The skill layer learned this already ("one function,
 * everyone calls it") and the same rule applies to a second consumer of the same file. This module
 * adds an interpretation on top of that reader; it never opens the file.
 *
 * WHAT IT REFUSES TO DO. With no feeds configured it returns configured:false and an empty list. It
 * does not substitute a default, and the caller must not either. A radar that invents a source list
 * to look busy is worse than one that says it has nothing: the empty state is a five-second fix by
 * the owner, the invented state is months of quietly reading somebody else's field.
 *
 * Contract: resolve({ root }) -> {
 *   configured: boolean   false when the profile is absent or names no usable feed
 *   feeds:   [{ name, url, kind, tags, selfWatch }]
 *   keywords: string[]    match terms; [] is legal and means "no keyword prefilter"
 *   warnings: string[]    rows dropped, with the reason (reported, never silently skipped)
 *   note:    string       the one line a run prints when configured is false
 * }
 */
const skillState = require('./skill-state');

// Where the run sends its owner when nothing is configured. One string, so the command file, the
// spec and the resolver cannot drift into naming three different places.
const NOT_CONFIGURED_NOTE =
  'no feeds configured - add a "radar": { "feeds": [...] } block to system/install-profile.json ' +
  '(copy the shape from system/install-profile.example.json), then run /radar again';

const KINDS = new Set(['rss', 'atom', 'json', 'html']);

// http is rejected, not upgraded. Silently rewriting a URL the owner typed means the thing fetched
// is not the thing configured, and on a feed that only serves plaintext the "fix" is a dead feed
// the owner cannot see in their own config.
function classify(row, i, warnings) {
  const where = row && row.name ? `feed "${row.name}"` : `feed row ${i + 1}`;
  if (!row || typeof row !== 'object') { warnings.push(`${where}: not an object - ignored`); return null; }
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!url) { warnings.push(`${where}: no url - ignored`); return null; }
  if (!/^https:\/\//i.test(url)) {
    warnings.push(`${where}: url is not https (${url.slice(0, 40)}) - ignored, fix the scheme in install-profile.json`);
    return null;
  }
  let kind = typeof row.kind === 'string' ? row.kind.toLowerCase() : '';
  if (!KINDS.has(kind)) {
    // Infer rather than refuse: the extension is reliable for the two feed shapes that matter, and
    // an owner adding a releases.atom should not have to learn a vocabulary first.
    if (/\.atom(\?|$)/i.test(url)) kind = 'atom';
    else if (/\.rss(\?|$)/i.test(url) || /\/\.rss(\?|$)/i.test(url)) kind = 'rss';
    else if (/\/api\/|\.json(\?|$)/i.test(url)) kind = 'json';
    else kind = 'html';
  }
  return {
    name: (typeof row.name === 'string' && row.name.trim()) || url.replace(/^https:\/\//, '').slice(0, 60),
    url,
    kind,
    tags: Array.isArray(row.tags) ? row.tags.filter((t) => typeof t === 'string') : [],
    selfWatch: row.self_watch === true,
  };
}

function resolve({ root }) {
  const warnings = [];
  const profile = skillState.readProfile(root); // null when absent - a fresh install, not an error
  const radar = (profile && profile.radar) || null;

  const rawFeeds = radar && Array.isArray(radar.feeds) ? radar.feeds : [];
  const feeds = rawFeeds.map((r, i) => classify(r, i, warnings)).filter(Boolean);

  const keywords = radar && Array.isArray(radar.keywords)
    ? radar.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
    : [];

  return {
    configured: feeds.length > 0,
    feeds,
    keywords,
    warnings,
    note: feeds.length > 0 ? '' : NOT_CONFIGURED_NOTE,
  };
}

// CLI so the command file and a human can both ask the same question without writing a script:
//   node scripts/lib/radar-feeds.js         human-readable
//   node scripts/lib/radar-feeds.js --json   machine-readable
if (require.main === module) {
  const path = require('path');
  const r = resolve({ root: path.join(__dirname, '..', '..') });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
  } else if (!r.configured) {
    console.log(`radar-feeds: ${r.note}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
  } else {
    console.log(`radar-feeds: ${r.feeds.length} feed(s), ${r.keywords.length} keyword(s)`);
    for (const f of r.feeds) console.log(`  ${f.selfWatch ? '[self-watch] ' : ''}${f.name} (${f.kind}) ${f.url}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
  }
  process.exit(0);
}

module.exports = { resolve, NOT_CONFIGURED_NOTE };
