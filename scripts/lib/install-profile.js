#!/usr/bin/env node
'use strict';
/*
 * scripts/lib/install-profile.js - the ONE node writer of the per-install profile, and the owner of
 * its shape (schema install-profile@1).
 *
 * WHAT. system/install-profile.json holds this machine's own choices. It is gitignored on a laptop
 * and never shipped as content, so an update can never conflict with a personal choice:
 *   wake[]      skills to un-park that the template ships parked (folder names under .agents/skills/)
 *   park[]      skills to park that the template ships awake. A MANDATORY-bound skill (the
 *               constitution's Skill Bindings table) cannot be parked; scripts/lib/skill-state.js refuses
 *   lanes{}     broad on/off switches that commands consult, keyed by LANE ID (website, marketing,
 *               finance, business-validation). The keys are names, not field names, which is why this
 *               map is the standard's one declared identifier map (json-writer.js ID_MAPS, rule 5)
 *   locale      the language Alex answers in for generated deliverables ("en", "tr", "ar")
 *   radar{}     feeds[] and keywords[] for /radar (#15), and in the EXAMPLE only, examples[] to copy
 *               from. The template ships NO feeds on purpose: a feed list says what its owner thinks is
 *               worth knowing, and one person's list shipped to everyone gives every other install a
 *               radar that is confidently wrong while still looking like it works. Rules: https only,
 *               free and keyless only. kind is rss | atom | json | html, inferred from the url when left
 *               out. self_watch: true marks a feed that watches a tool the owner RUNS rather than their
 *               field. keywords is an optional prefilter. Read the live list: node scripts/lib/radar-feeds.js
 *   employer_domain, owner_work_address   written by online /setup, read by scripts/employer-data-guard.mjs
 *
 * Until 2026-09-24 that documentation lived INSIDE the example as `_what`, `_how`, `_lanes`, `_radar`
 * and `_radar_examples`, which the JSON standard's rule 2 retires (four generated header fields, no
 * hand-typed doc keys). It lives here now, beside the code that writes the file (fleet Fix D, F11).
 *
 * HOW.
 *   const { writeProfile } = require('./install-profile');
 *   writeProfile(root, profile)      write system/install-profile.json through scripts/lib/json-writer.js
 *   node scripts/lib/install-profile.js --write-example
 *                                    (re)write the tracked system/install-profile.example.json
 *
 * A profile written before this date has no header and may carry those underscore doc keys, or an
 * owner's own (one carried profile has `_lanes_note`). The helper refuses an underscore payload key,
 * so writeProfile drops the four header fields (the helper stamps them again) and moves every OTHER
 * underscore key, value untouched, into `legacy_notes` under its name without the underscore. Nothing
 * an owner wrote is lost, and nothing is renamed silently: a legacy key that is not snake_case once
 * its underscore is gone is refused by name.
 *
 * NOT ENFORCED, and why. The EXAMPLE is on json_standard.enforced[]: tracked, and written only here.
 * The LIVE profile is not: /setup (both trees) still edits it in prose, and old laptop copies are
 * headerless, so its readers (skill-state.js, radar-feeds.js, employer-data-guard.mjs) stay tolerant
 * of both shapes and never demand a schema. Enforce it once /setup writes through this module too.
 *
 * NEVER. It never decides anything from the profile: skill-state.js and radar-feeds.js own reading.
 * It never writes a profile anywhere but <root>/system/install-profile.json.
 * Test: node scripts/tests/test-install-profile.mjs
 */

const path = require('path');
const { writeJson, HEADER_KEYS, SNAKE_CASE, JsonWriterError } = require('./json-writer');

const SCHEMA = 'install-profile@1';
const WRITER = 'scripts/lib/install-profile.js';
const PROFILE_REL = 'system/install-profile.json';
const EXAMPLE_REL = 'system/install-profile.example.json';
const PROFILE_META = {
  purpose: 'This machine\'s own choices: skills woken and parked, lane switches, answer language and radar feeds; never shipped as content.',
  writer: WRITER,
  schema: SCHEMA,
};
const EXAMPLE_META = {
  purpose: 'The shape of system/install-profile.json with nobody\'s choices in it: copy it to that name and edit it, or let /setup do it.',
  writer: WRITER,
  schema: SCHEMA,
};

// The example's payload. Empty feeds on purpose (see radar{} above); the three examples are there to
// be copied, and radar-feeds.js reads only feeds[] and keywords[].
const EXAMPLE = {
  wake: [],
  park: [],
  lanes: { website: false, marketing: false, finance: false, 'business-validation': false },
  locale: 'en',
  radar: {
    feeds: [],
    keywords: [],
    examples: [
      { name: 'Hacker News: your topic', url: 'https://hn.algolia.com/api/v1/search_by_date?query=YOUR-TOPIC&tags=story', kind: 'json' },
      { name: 'a tool you depend on', url: 'https://github.com/OWNER/REPO/releases.atom', kind: 'atom', self_watch: true },
      { name: 'a community you read', url: 'https://www.reddit.com/r/SUBREDDIT/.rss', kind: 'rss', tags: ['community'] },
    ],
  },
};

/**
 * The payload writeProfile would write for a profile read off disk: header fields dropped, every
 * other underscore key moved into legacy_notes. Pure; exported so the test can show the move.
 */
function toPayload(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new JsonWriterError('install-profile: a profile must be a JSON object');
  }
  const out = {};
  const notes = {};
  for (const [k, v] of Object.entries(profile)) {
    if (HEADER_KEYS.includes(k)) continue;
    if (k.startsWith('_')) {
      const name = k.replace(/^_+/, '');
      if (!SNAKE_CASE.test(name)) {
        throw new JsonWriterError(`install-profile: the legacy key "${k}" cannot be kept as legacy_notes.${name} (not snake_case). Rename it by hand; the writer never renames silently.`);
      }
      notes[name] = v;
      continue;
    }
    out[k] = v;
  }
  if (Object.keys(notes).length) out.legacy_notes = Object.assign({}, out.legacy_notes || {}, notes);
  return out;
}

/** Write <root>/system/install-profile.json through the helper. Returns the helper's result. */
function writeProfile(root, profile) {
  return writeJson(path.join(root, PROFILE_REL), toPayload(profile), PROFILE_META);
}

/** Write <root>/system/install-profile.example.json. A no-op when nothing changed. */
function writeExample(root) {
  return writeJson(path.join(root, EXAMPLE_REL), EXAMPLE, EXAMPLE_META);
}

module.exports = { writeProfile, writeExample, toPayload, SCHEMA, WRITER, PROFILE_REL, EXAMPLE_REL, EXAMPLE };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--write-example') {
    const root = path.resolve(__dirname, '..', '..');
    const r = writeExample(root);
    console.log(`install-profile: ${EXAMPLE_REL} ${r.written ? `written (${r.reason}, ${r.bytes} bytes)` : 'unchanged'}`);
    process.exit(0);
  }
  console.error('usage: node scripts/lib/install-profile.js --write-example');
  process.exit(2);
}
