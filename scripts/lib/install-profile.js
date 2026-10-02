#!/usr/bin/env node
// @ts-check
// scripts/lib/install-profile.js - the one writer of this machine's install profile, and the owner of its shape.
//
// WHAT. system/install-profile.json holds one machine's own choices. It never ships as content, so an update
// can never conflict with a personal choice; it is gitignored on a laptop and tracked online. Schema
// install-profile@1:
//   wake[]    skills to un-park that the template ships parked (folder names under .agents/skills/)
//   park[]    skills to park that the template ships awake; scripts/lib/skill-state.js refuses to park a
//             MANDATORY-bound skill (the constitution's Skill Bindings table)
//   lanes{}   on/off switches commands consult, keyed by lane id (website, marketing, finance,
//             business-validation). The keys are names, not field names, so this is the JSON standard's one
//             declared identifier map (ID_MAPS in scripts/lib/json-writer.js)
//   locale    the language Alex answers in for generated deliverables ("en", "tr", "ar")
//   radar{}   feeds[] and keywords[] for /radar: https, free and keyless only; kind is rss, atom, json or
//             html, inferred from the url when left out; self_watch: true marks a feed on a tool the owner
//             runs rather than on their field; keywords is an optional prefilter. The live list:
//             node scripts/lib/radar-feeds.js
//   employer_domain, owner_work_address   written by the online /setup, read by scripts/employer-data-guard.mjs
// This file also writes the tracked system/install-profile.example.json: the shape with nobody's choices in it.
//
// HOW. writeProfile(root, profile) writes <root>/system/install-profile.json through scripts/lib/json-writer.js.
// A profile an older Kit wrote has no header and may carry underscore doc keys, or an owner's own. toPayload
// drops the four header fields, which the helper stamps again, and moves every other underscore key, value
// untouched, into legacy_notes under its name without the underscore. writeExample writes the example, and
// writes nothing when it is already current. The example ships no feeds and three examples[] to copy: a feed
// list shipped to everyone gives every other install a radar that is confidently wrong. The example is on
// json_standard.enforced[]; the live profile is not, because /setup still edits it in prose and old copies are
// headerless, so its readers accept both shapes.
//
// NEVER. Decides anything from the profile: skill-state.js and radar-feeds.js read it. Writes a profile anywhere
// but <root>/system/install-profile.json. Renames a key silently: a legacy key that is not snake_case once its
// underscore is gone is refused by name, and the file is left as it was. Fixes in passing what
// scripts/tests/test-install-profile-cli.mjs pins: a hand-written string legacy_notes is spread into one key
// per character and then refused (R4-L21), and a foreign _schema is dropped unchecked (R4-L22).
//
// Usage: node scripts/lib/install-profile.js --write-example
// Exit: 0 the example is written, or already current - 2 any other command line, with the usage on stderr
'use strict';

const path = require('node:path');
const { writeJson, HEADER_KEYS, SNAKE_CASE, JsonWriterError } = require('./json-writer');
const { REPO } = require('./repo-root');

const SCHEMA = 'install-profile@1';
const WRITER = 'scripts/lib/install-profile.js';
const PROFILE_REL = 'system/install-profile.json';
const EXAMPLE_REL = 'system/install-profile.example.json';
const PROFILE_META = {
  purpose:
    "This machine's own choices: skills woken and parked, lane switches, answer language and radar feeds; never shipped as content.",
  writer: WRITER,
  schema: SCHEMA
};
const EXAMPLE_META = {
  purpose:
    "The shape of system/install-profile.json with nobody's choices in it: copy it to that name and edit it, or let /setup do it.",
  writer: WRITER,
  schema: SCHEMA
};
const USAGE = 'usage: node scripts/lib/install-profile.js --write-example';
const EXIT_USAGE = 2;
// The prefix a key an older Kit hand-typed carries, one underscore or more.
const LEADING_UNDERSCORES = /^_+/;

// The example's payload. radar-feeds.js reads only feeds[] and keywords[]; the examples are there to copy.
const EXAMPLE = {
  wake: [],
  park: [],
  lanes: { website: false, marketing: false, finance: false, 'business-validation': false },
  locale: 'en',
  radar: {
    feeds: [],
    keywords: [],
    examples: [
      {
        name: 'Hacker News: your topic',
        url: 'https://hn.algolia.com/api/v1/search_by_date?query=YOUR-TOPIC&tags=story',
        kind: 'json'
      },
      {
        name: 'a tool you depend on',
        url: 'https://github.com/OWNER/REPO/releases.atom',
        kind: 'atom',
        self_watch: true
      },
      {
        name: 'a community you read',
        url: 'https://www.reddit.com/r/SUBREDDIT/.rss',
        kind: 'rss',
        tags: ['community']
      }
    ]
  }
};

/**
 * The payload writeProfile writes for a profile read off disk: the header fields dropped, every other
 * underscore key moved into legacy_notes. Pure; scripts/tests/test-install-profile-cli.mjs holds its rules.
 * @param {unknown} profile the profile as parsed
 * @returns {Record<string, unknown>}
 */
function toPayload(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new JsonWriterError('install-profile: a profile must be a JSON object');
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @type {Record<string, unknown>} */
  const notes = {};
  for (const [key, value] of Object.entries(profile)) {
    if (HEADER_KEYS.includes(key)) continue;
    if (!key.startsWith('_')) {
      out[key] = value;
      continue;
    }
    const name = key.replace(LEADING_UNDERSCORES, '');
    if (!SNAKE_CASE.test(name)) {
      throw new JsonWriterError(
        `install-profile: the legacy key "${key}" cannot be kept as legacy_notes.${name} (not snake_case). Rename it by hand; the writer never renames silently.`
      );
    }
    notes[name] = value;
  }
  if (Object.keys(notes).length) out.legacy_notes = Object.assign({}, out.legacy_notes || {}, notes);
  return out;
}

/**
 * Write <root>/system/install-profile.json through the helper.
 * @param {string} root the tree whose profile to write
 * @param {unknown} profile the profile, in either shape
 * @returns {import('./json-writer').WriteResult}
 */
function writeProfile(root, profile) {
  return writeJson(path.join(root, PROFILE_REL), toPayload(profile), PROFILE_META);
}

/**
 * Write <root>/system/install-profile.example.json; nothing is written when it is already current.
 * @param {string} root the tree whose example to write
 * @returns {import('./json-writer').WriteResult}
 */
function writeExample(root) {
  return writeJson(path.join(root, EXAMPLE_REL), EXAMPLE, EXAMPLE_META);
}

module.exports = { writeProfile, writeExample, toPayload, SCHEMA, WRITER, PROFILE_REL, EXAMPLE_REL, EXAMPLE };

/**
 * The command line: exactly --write-example writes this Kit's example and says what happened.
 * @param {string[]} argv the arguments after the script's path
 * @returns {number} the exit code
 */
function main(argv) {
  if (argv.length !== 1 || argv[0] !== '--write-example') {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const result = writeExample(REPO);
  const what = result.written ? `written (${result.reason}, ${result.bytes} bytes)` : 'unchanged';
  console.log(`install-profile: ${EXAMPLE_REL} ${what}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
