#!/usr/bin/env node
// scripts/tests/test-install-profile.mjs - the install profile's one writer, and the example it owns.
//
// WHAT. scripts/lib/install-profile.js became the ONE node writer of system/install-profile.json and
// the owner of the tracked system/install-profile.example.json on 2026-09-24 (fleet Fix D, F11), once
// the JSON standard gained its declared identifier-map exception for `lanes`. This test holds four
// things in place:
//   P1  the committed example is byte-for-byte what the writer produces (it is enforced, so a
//       hand edit fails V21 too; this leg names the writer to run instead)
//   P2  every reader still works on the new shape: skill-state.js, radar-feeds.js, and the audit
//   P3  a LEGACY profile (headerless, with the old `_what`/`_radar_examples` doc keys and an owner's
//       own `_lanes_note`) is rewritten with nothing lost: every underscore key lands in legacy_notes
//   P4  NEGATIVE a legacy key that is not snake_case without its underscore is refused by name, and
//       the file on disk is left exactly as it was
//   P5  skills-park.js writes the profile through this module, never with a raw JSON.stringify
//
// HOW. Everything runs in throwaway roots under the OS temp directory. NEVER writes into the checkout.
// Run: node scripts/tests/test-install-profile.mjs      (exit 0 = all pass)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-install-profile-')));

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}
function tryLoad(rel) { try { return require(path.join(KIT, rel)); } catch (e) { return { __loadError: e.message }; } }

const ip = tryLoad('scripts/lib/install-profile.js');
const { readJson, canonicalText } = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const audit = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));
const EXAMPLE_REL = 'system/install-profile.example.json';

function root(name, files = {}) {
  const r = path.join(TMP, name);
  fs.mkdirSync(path.join(r, 'system'), { recursive: true });
  fs.writeFileSync(path.join(r, 'skills-lock.json'), JSON.stringify({ version: 1, skills: {} }, null, 2) + '\n');
  fs.writeFileSync(path.join(r, 'CLAUDE.md'), '# fixture\n');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), text);
  }
  return r;
}

ok(!ip.__loadError, 'P0 scripts/lib/install-profile.js loads', ip.__loadError || '');

// ------------------------------------------------------------------ P1. the example is the writer's output
{
  const committed = fs.readFileSync(path.join(KIT, EXAMPLE_REL), 'utf8');
  const r = root('p1', { [EXAMPLE_REL]: committed });
  let res = null, err = null;
  try { res = ip.writeExample(r); } catch (e) { err = e.message; }
  ok(res && res.written === false,
     'P1 the committed example is byte-identical to what `node scripts/lib/install-profile.js --write-example` writes',
     err || (res ? `writer says ${res.reason}` : 'no result'));
  let parsed = null;
  try { parsed = readJson(path.join(KIT, EXAMPLE_REL), 'install-profile@1'); } catch (e) { err = e.message; }
  ok(parsed && parsed._writer === 'scripts/lib/install-profile.js', 'P1 the example carries schema install-profile@1 and names its writer', err || '');
  ok(parsed && parsed.radar && Array.isArray(parsed.radar.feeds) && parsed.radar.feeds.length === 0 &&
     Array.isArray(parsed.radar.examples) && parsed.radar.examples.length === 3,
     'P1 the example ships NO feeds and the three worked examples', parsed ? `feeds ${parsed.radar.feeds.length}, examples ${(parsed.radar.examples || []).length}` : '');
  const row = audit.auditText(EXAMPLE_REL, committed, { root: KIT });
  ok(row.findings.length === 0 && row.canonical, 'P1 the audit finds nothing in the example (the declared `lanes` map included)', row.findings.join(' | ') || 'none');
}

// ------------------------------------------------------------------ P2. every reader on the new shape
{
  const committed = fs.readFileSync(path.join(KIT, EXAMPLE_REL), 'utf8');
  const r = root('p2', { 'system/install-profile.json': committed });
  const skillState = require(path.join(KIT, 'scripts', 'lib', 'skill-state.js'));
  const radar = require(path.join(KIT, 'scripts', 'lib', 'radar-feeds.js'));
  let s = null, f = null, err = null;
  try { s = skillState.resolve({ root: r }); f = radar.resolve({ root: r }); } catch (e) { err = e.message; }
  ok(s && s.locale === 'en' && s.lanes['business-validation'] === false && s.warnings.length === 0,
     'P2 skill-state.js reads the new shape: locale, the kebab lane, no warnings', err || (s ? `warnings ${s.warnings.length}` : ''));
  ok(f && f.configured === false && f.feeds.length === 0 && f.warnings.length === 0,
     'P2 radar-feeds.js reads the new shape and ignores radar.examples (no feeds, no warnings)', err || (f ? `feeds ${f.feeds.length}, warnings ${f.warnings.length}` : ''));
}

// ------------------------------------------------------------------ P3. a legacy profile loses nothing
const LEGACY = {
  _what: 'EXAMPLE of system/install-profile.json - this machine\'s own skill and lane choices.',
  _how: 'wake[] un-parks skills the template ships parked.',
  _lanes_note: 'an owner\'s own note, which must survive',
  _radar_examples: [{ name: 'x', url: 'https://example.com/feed.rss', kind: 'rss' }],
  wake: ['pdf'],
  park: [],
  radar: { feeds: [], keywords: ['gold'] },
  lanes: { website: false, marketing: true, finance: false, 'business-validation': true },
  locale: 'tr',
};
{
  const r = root('p3', { 'system/install-profile.json': JSON.stringify(LEGACY, null, 2) + '\n' });
  let res = null, err = null;
  try { res = ip.writeProfile(r, JSON.parse(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'))); } catch (e) { err = e.message; }
  let after = null;
  try { after = readJson(path.join(r, 'system', 'install-profile.json'), 'install-profile@1'); } catch (e) { err = err || e.message; }
  ok(res && res.written && after, 'P3 a legacy profile is rewritten through the helper as install-profile@1', err || '');
  const n = (after && after.legacy_notes) || {};
  // Compared as canonical text: the helper sorts keys by design, so key ORDER is not content.
  ok(after && n.what === LEGACY._what && n.how === LEGACY._how && n.lanes_note === LEGACY._lanes_note &&
     canonicalText(n.radar_examples || null, { validate: false }) === canonicalText(LEGACY._radar_examples, { validate: false }),
     'P3 every legacy underscore key, the owner\'s own `_lanes_note` included, is kept whole in legacy_notes', Object.keys(n).join(', '));
  ok(after && JSON.stringify(after.wake) === '["pdf"]' && after.locale === 'tr' && after.lanes.marketing === true &&
     after.lanes['business-validation'] === true && JSON.stringify(after.radar.keywords) === '["gold"]',
     'P3 the choices themselves are unchanged (wake, locale, every lane, keywords)');
  const row = after ? audit.auditText('system/install-profile.json', fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'), { root: KIT }) : { findings: ['no file'] };
  ok(row.findings.length === 0, 'P3 the rewritten profile has no audit findings', row.findings.join(' | ') || 'none');
  // Written again from what is now on disk: a no-op, so skills-park never churns an unchanged profile.
  let again = null;
  try { again = ip.writeProfile(r, JSON.parse(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8'))); } catch (e) { err = e.message; }
  ok(again && again.written === false, 'P3 rewriting the migrated profile unchanged is a no-op', again ? again.reason : err);
}

// ------------------------------------------------------------------ P4. a key it cannot keep is refused
{
  const bad = { ...LEGACY, '_Lanes-Note': 'not snake_case once the underscore goes' };
  const text = JSON.stringify(bad, null, 2) + '\n';
  const r = root('p4', { 'system/install-profile.json': text });
  let err = null;
  try { ip.writeProfile(r, bad); } catch (e) { err = e.message; }
  ok(err && /_Lanes-Note/.test(err), 'P4 NEGATIVE a legacy key that is not snake_case without its underscore is refused by name', err || 'no refusal');
  ok(fs.readFileSync(path.join(r, 'system', 'install-profile.json'), 'utf8') === text, 'P4 NEGATIVE ...and the profile on disk is untouched');
}

// ------------------------------------------------------------------ P5. skills-park writes through it
{
  const src = fs.readFileSync(path.join(KIT, 'scripts', 'skills-park.js'), 'utf8');
  const fn = (src.match(/function writeProfileFile\([^)]*\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  ok(/installProfile\.writeProfile\(/.test(fn) && !/JSON\.stringify/.test(fn),
     'P5 skills-park.js writeProfileFile goes through install-profile.js, with no raw JSON.stringify', fn.split('\n').slice(0, 3).join(' ').slice(0, 140));
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
