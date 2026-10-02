// @ts-check
// scripts/lib/radar-feeds.js - which feeds the radar sweeps on this machine, read from this machine's profile.
//
// WHAT. The radar (#15) reports what is new in its owner's field. A feed list says what its owner thinks
// is worth knowing, so the template ships none: one person's list shipped to everyone gives every other
// install a radar that is confidently wrong each week while still returning items, so nothing looks
// broken. The list lives in this machine's profile, and this file is the one place that turns it into
// feeds; /radar, its Routine and /setup all ask here.
//
// HOW. resolve({ root }) reads <root>/system/install-profile.json through skill-state.js readProfile, the
// profile's one reader, and never opens the file itself. Rows of radar.feeds keep the owner's order. A row
// that is not an object, has no url, or has a url that is not https is dropped with a warning naming it;
// http is refused rather than upgraded, because a rewritten url is not the one the owner configured. A
// kind other than rss, atom, json or html is inferred from the url (.atom, .rss, /api/ or .json, else
// html); a missing name becomes the url without its scheme, 60 characters at most; self_watch: true marks
// a feed that watches a tool the owner runs. radar.keywords keeps its non-empty strings, trimmed. The
// answer is { configured, feeds, keywords, warnings, note }, where note is the one line a run prints when
// nothing is configured. The CLI prints it as 2-space JSON with --json, for the command and the Routine,
// and as lines for a person otherwise.
//
// NEVER. Substitutes a default feed or keyword, and a caller must not either: an empty list is a
// five-second fix for its owner, an invented one is months of quietly reading somebody else's field. Tells
// a profile that does not parse from an absent one, or warns on a feeds value that is not a list, or a
// keyword or a tag that is not a string: scripts/tests/test-install-profile-readers.mjs pins both as they
// are (R6-7, the non-array-feeds half of R6-27) until their fix wave. Requires anything but skill-state.js,
// repo-root.js, args.js and Node's own modules, because a test copies exactly those alone.
//
// Usage: node scripts/lib/radar-feeds.js [--json]
// Exit: 0 configured or not, an unknown flag warned on stderr and the run carrying on - 1 a bare word or
//       --json given a value (--json=<value>), both refused by node:util parseArgs
'use strict';

const skillState = require('./skill-state');
const { REPO } = require('./repo-root');
const { parseCommandLine } = require('./args');

// Where a run sends its owner when nothing is configured. One string, so the command file, the spec and
// this resolver cannot name three different places.
const NOT_CONFIGURED_NOTE =
  'no feeds configured - add a "radar": { "feeds": [...] } block to system/install-profile.json ' +
  '(copy the shape from system/install-profile.example.json), then run /radar again';

const KINDS = new Set(['rss', 'atom', 'json', 'html']);
const HTTPS = /^https:\/\//i;
// How much of a refused url a warning shows, and how long a name made from a url may be.
const URL_SHOWN = 40;
const NAME_MAX = 60;

/**
 * @typedef {object} Feed
 * @property {string} name the owner's name for it, or the url without its scheme
 * @property {string} url
 * @property {string} kind rss, atom, json or html
 * @property {string[]} tags
 * @property {boolean} selfWatch true when the feed watches a tool the owner runs
 */

/**
 * @typedef {object} RadarFeeds
 * @property {boolean} configured false when the profile is absent or names no usable feed
 * @property {Feed[]} feeds
 * @property {string[]} keywords match terms; [] is legal and means no keyword prefilter
 * @property {string[]} warnings one per dropped row, with its reason
 * @property {string} note the line a run prints when configured is false, '' otherwise
 */

/**
 * A feed's kind from its url, when the owner named none: the extension is reliable for the two feed
 * shapes that matter, and an owner adding a releases.atom should not have to learn a vocabulary first.
 * @param {string} url
 * @returns {string}
 */
function inferKind(url) {
  if (/\.atom(\?|$)/i.test(url)) return 'atom';
  if (/\.rss(\?|$)/i.test(url)) return 'rss';
  if (/\/api\/|\.json(\?|$)/i.test(url)) return 'json';
  return 'html';
}

/**
 * One row of radar.feeds as a Feed, or null with a warning pushed when the row is dropped.
 * @param {any} row the row as the profile holds it
 * @param {number} i its index, for a row with no name
 * @param {string[]} warnings where a dropped row's reason goes
 * @returns {Feed | null}
 */
function classify(row, i, warnings) {
  const where = row?.name ? `feed "${row.name}"` : `feed row ${i + 1}`;
  if (!row || typeof row !== 'object') {
    warnings.push(`${where}: not an object - ignored`);
    return null;
  }
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  if (!url) {
    warnings.push(`${where}: no url - ignored`);
    return null;
  }
  if (!HTTPS.test(url)) {
    warnings.push(
      `${where}: url is not https (${url.slice(0, URL_SHOWN)}) - ignored, fix the scheme in install-profile.json`
    );
    return null;
  }
  const given = typeof row.kind === 'string' ? row.kind.toLowerCase() : '';
  return {
    name: (typeof row.name === 'string' && row.name.trim()) || url.replace(/^https:\/\//, '').slice(0, NAME_MAX),
    url,
    kind: KINDS.has(given) ? given : inferKind(url),
    tags: Array.isArray(row.tags) ? row.tags.filter((/** @type {unknown} */ t) => typeof t === 'string') : [],
    selfWatch: row.self_watch === true
  };
}

/**
 * The feeds this machine's profile configures for the radar.
 * @param {{ root: string }} options the repository root
 * @returns {RadarFeeds}
 */
function resolve({ root }) {
  /** @type {string[]} */
  const warnings = [];
  const profile = skillState.readProfile(root);
  const radar = profile?.radar || null;

  const rawFeeds = Array.isArray(radar?.feeds) ? radar.feeds : [];
  const feeds = rawFeeds
    .map((/** @type {unknown} */ r, /** @type {number} */ i) => classify(r, i, warnings))
    .filter((/** @type {Feed | null} */ f) => f !== null);

  const keywords = Array.isArray(radar?.keywords)
    ? radar.keywords
        .filter((/** @type {unknown} */ k) => typeof k === 'string' && k.trim())
        .map((/** @type {string} */ k) => k.trim())
    : [];

  return {
    configured: feeds.length > 0,
    feeds,
    keywords,
    warnings,
    note: feeds.length > 0 ? '' : NOT_CONFIGURED_NOTE
  };
}

module.exports = { resolve, NOT_CONFIGURED_NOTE };

if (require.main === module) {
  /** @type {{ json?: boolean | string | (boolean | string)[] }} */
  let values;
  try {
    ({ values } = parseCommandLine({ name: 'radar-feeds', edge: 'routine', options: { json: { type: 'boolean' } } }));
  } catch (e) {
    process.stderr.write(`radar-feeds: ${/** @type {Error} */ (e).message}\n`);
    process.exit(/** @type {{ exitCode?: number }} */ (e).exitCode ?? 1);
  }
  const r = resolve({ root: REPO });
  if (values.json) {
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
