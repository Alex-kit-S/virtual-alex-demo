#!/usr/bin/env node
// scripts/tests/test-migration-001.mjs - migration 001 must recognise the structural-tells rule
// however it is worded, and must never write a second copy of it. (2026-09-23, fleet seat 2.)
//
// WHY. The defect, measured on a real test install. The migration decided "already present" by looking
// for one literal sentence of its own prose, `Kill the structural AI tells`. But that sentence is
// not the rule. /setup writes this rule too, in a SHORT version the model adapts to how the owner
// writes, so on an install created by /setup the literal is absent while the rule is fully there.
// The migration read that as a missing rule and appended its own long block on top, numbered "6."
// and citing "Rule 3" into a Voice Rules section that has neither a rule 6 nor a rule 3. The owner
// ends up with the same eleven tells stated twice in the one file that defines their voice, and the
// second copy points at numbers that are not there.
//
// WHAT. Detection reads the TAXONOMY, not the sentence. Every version of this rule, short or
// long, names the eleven tells, because the names ARE the rule; the heading number, the surrounding
// prose and the cross-references are all writer's choice. So the check counts how many of the names
// appear and never reads a number at all.
//
//   M1  NEGATIVE the /setup SHORT variant is present and the migration writes a second block
//   M2  NEGATIVE the heading number is read: the same rule as "4." or as a bare bullet is missed
//   M3  the migration's OWN long output is still recognised (the case that always worked)
//   M4  a soul.md with neither variant still gets the rule, once
//   M5  running it twice changes nothing the second time
//   M6  a soul.md with no voice rules at all is declined and left byte-identical
//   M7  one stray tell name is not a rule: a soul.md that merely mentions one still gets the block
//
// HOW. Every leg runs the real migration against a throwaway soul.md under the OS temp directory.
//   node scripts/tests/test-migration-001.mjs      (exit 0 = all pass)
//
// NEVER. Never reads or writes this checkout's own soul.md.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = require(path.join(KIT, 'scripts', 'migrations', '001-structural-voice-tells.js'));

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-mig001-'));

// The head of a soul.md as /setup writes one. No canary line: this migration never reads one, and
// a fixture that carries a token shape only teaches the secret scanner to expect them in tests.
const HEAD = [
  '# Soul - Who I Am',
  '',
  '## My Role',
  'A bookbinder in a harbour town.',
  '',
  '## Voice Rules (always active)',
  '- Never sound like a machine.',
  '- No em-dashes, no filler.',
  '',
].join('\n');

const TAIL = ['', '## Things I Never Want', 'Flattery I did not earn.', ''].join('\n');

// What /setup actually produces: the short version, in the owner's own register, as BULLETS under
// the Voice Rules heading. It names the eleven and points at writing-style.md, exactly as the
// wizard instructs, and it carries none of this migration's sentences.
const SHORT_VARIANT = [
  '### Detection-proofing',
  '- Keep my real phrasing, dropped articles and all. Cleaning them up is what makes text read as a machine.',
  '- Vary sentence length hard. Even cadence is a tell by itself.',
  '- Kill the word-level tells: moreover, furthermore, in conclusion, delve, leverage.',
  '- Present tense, direct statements, vocabulary from My Words.',
  '- My simple direct register beats correct formal English.',
  '- Kill the shapes a word list cannot catch: colon reveals, faux-insight setups, superficial -ing',
  '  analysis, importance puffery, weasel attribution, synonym cycling, interpretive metadiscourse,',
  '  fake-strong verbs, summary-recap endings, fake-profound kickers, formatting slop. Each one is',
  '  defined with an example in `brand/config/writing-style.md` sections 1.9 to 1.17.',
  '',
].join('\n');

// The same rule a wizard run numbered differently. Nothing about the rule changed.
const RENUMBERED_VARIANT = SHORT_VARIANT.replace(
  '- Kill the shapes a word list cannot catch:',
  '4. Kill the shapes a word list cannot catch:',
);

function install(soulBody) {
  const root = fs.mkdtempSync(path.join(TMP, 'root-'));
  fs.writeFileSync(path.join(root, 'soul.md'), soulBody);
  return root;
}

function run(root) {
  return migration.run({ root, log: () => {} });
}

const soulOf = (root) => fs.readFileSync(path.join(root, 'soul.md'), 'utf8');

// How many separate statements of the rule the file carries. Counted on the anchor name that no
// version of the rule omits, so it is a count of BLOCKS, not of the word.
const blocks = (text) => (text.match(/interpretive metadiscourse/gi) || []).length;

// M1 - the defect itself.
{
  const root = install(HEAD + SHORT_VARIANT + TAIL);
  const before = soulOf(root);
  const res = run(root);
  const after = soulOf(root);
  ok(res.status === 'skipped', 'M1 NEGATIVE the /setup short variant is recognised as already present',
    `status=${res.status} (${res.message})`);
  ok(blocks(after) === 1, 'M1 NEGATIVE soul.md still states the eleven tells exactly once',
    `${blocks(before)} before, ${blocks(after)} after`);
  ok(after === before, 'M1 NEGATIVE soul.md is byte-identical, so nothing was appended',
    `${before.length} -> ${after.length} bytes`);
}

// M1b - the eleventh name (fleet review F20). The detector said "the eleven names are the rule" and
// held ten: "superficial analysis" was missing. A short /setup variant that names exactly three tells,
// one of them that one (and wrapped across a line, as a wizard writes it), counted two, read as
// absent, and got the long block written on top: the M1 defect through a different door.
{
  const THREE = [
    '### Detection-proofing',
    '- Kill the shapes a word list cannot catch: superficial `-ing`',
    '  analysis, colon reveals and formatting slop, each defined in `brand/config/writing-style.md`.',
    '',
  ].join('\n');
  const root = install(HEAD + THREE + TAIL);
  const before = soulOf(root);
  const res = run(root);
  ok(res.status === 'skipped' && soulOf(root) === before,
    'M1b NEGATIVE a variant naming three tells, one of them a wrapped "superficial -ing analysis", is recognised and left alone',
    `status=${res.status}; ${before.length} -> ${soulOf(root).length} bytes`);
}

// M1c - the list is the eleven, and the migration's own block names every one of them.
{
  const names = migration.TELL_NAMES || [];
  const root = install(HEAD + TAIL);
  run(root);
  const written = soulOf(root);
  const missing = names.filter((re) => !re.test(written)).map(String);
  ok(names.length === 11 && missing.length === 0,
    'M1c the detector holds eleven names and the long block the migration writes carries all eleven',
    `${names.length} name(s)${missing.length ? `; not in the block: ${missing.join(', ')}` : ''}`);
}

// M2 - the number is not part of the rule.
{
  const root = install(HEAD + RENUMBERED_VARIANT + TAIL);
  const before = soulOf(root);
  const res = run(root);
  ok(res.status === 'skipped', 'M2 NEGATIVE the same rule numbered "4." is still recognised',
    `status=${res.status}`);
  ok(soulOf(root) === before, 'M2 NEGATIVE the renumbered install is left byte-identical');
}

// M3 - the case that always worked keeps working.
{
  const root = install(HEAD + '### Detection-proofing\n1. Keep my real phrasing.\n\n' + TAIL);
  const first = run(root);
  ok(first.status === 'applied', 'M3 the long block is written when nothing is there', `status=${first.status}`);
  const withLong = soulOf(root);
  ok(withLong.includes('Kill the structural AI tells'), 'M3 the long block landed');

  const root2 = install(withLong);
  const res = run(root2);
  ok(res.status === 'skipped', 'M3 an install already carrying the long block is recognised', `status=${res.status}`);
  ok(soulOf(root2) === withLong, 'M3 that install is left byte-identical');
}

// M4 - the migration still does its job.
{
  const root = install(HEAD + '### Detection-proofing\n1. Keep my real phrasing.\n\n' + TAIL);
  const res = run(root);
  ok(res.status === 'applied', 'M4 an install with neither variant gets the rule', `status=${res.status}`);
  ok(blocks(soulOf(root)) === 1, 'M4 it is stated exactly once', `${blocks(soulOf(root))} blocks`);
  ok(fs.readdirSync(root).some((f) => f.startsWith('soul.md.bak-')), 'M4 a backup was taken before the write');
}

// M5 - idempotence, the plain form.
{
  const root = install(HEAD + '### Detection-proofing\n1. Keep my real phrasing.\n\n' + TAIL);
  run(root);
  const once = soulOf(root);
  const second = run(root);
  ok(second.status === 'skipped', 'M5 a second run is a skip, not a second write', `status=${second.status}`);
  ok(soulOf(root) === once, 'M5 the file is byte-identical after the second run');
  ok(blocks(once) === 1, 'M5 still exactly one block');
}

// M6 - the safety rule the migration's own header sets out.
{
  const root = install('# Soul\n\n## My Role\nA translator.\n');
  const before = soulOf(root);
  const res = run(root);
  ok(res.status === 'declined', 'M6 no voice rules section, so it declines', `status=${res.status}`);
  ok(soulOf(root) === before, 'M6 soul.md is byte-identical');
  ok(!fs.readdirSync(root).some((f) => f.startsWith('soul.md.bak-')), 'M6 no backup written on a decline');
}

// M7 - detection must not fire on a passing mention.
{
  const body = HEAD + '### Detection-proofing\n1. Keep my real phrasing.\n2. No colon reveals.\n\n' + TAIL;
  const root = install(body);
  const res = run(root);
  ok(res.status === 'applied', 'M7 one tell name alone is not the rule, so the block is still written',
    `status=${res.status}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
