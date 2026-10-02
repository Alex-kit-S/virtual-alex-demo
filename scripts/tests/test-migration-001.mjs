// @ts-check
// scripts/tests/test-migration-001.mjs - migration 001 recognises the structural-tells rule however it is
// worded, and never writes a second copy of it.
//
// WHAT. /setup writes this rule too, in a SHORT version the model adapts to how the owner writes, so on an
// install /setup made the migration's own sentence is absent while the rule is fully there. A migration that
// looks for its own sentence reads that as a missing rule and writes its long block on top, numbered "6." and
// citing "Rule 3" into a Voice Rules section with neither: the same eleven tells twice, in the one file that
// defines the owner's voice. So detection reads the TAXONOMY, the eleven names, and never a number. Deleted,
// this file would let detection go back to a sentence or a number, and every /setup-made soul.md would get a
// second copy on its next update, with nothing in CI noticing. What it proves, negative legs first:
//   M1  NEGATIVE the /setup SHORT variant is present and the migration writes a second block
//   M1b NEGATIVE a variant naming three tells, one a wrapped "superficial -ing analysis", is missed
//   M1c the detector holds eleven names, and the long block the migration writes carries every one
//   M2  NEGATIVE the heading number is read: the same rule as "4." or as a bare bullet is missed
//   M3  the migration's OWN long output is still recognised (the case that always worked)
//   M4  a soul.md with neither variant still gets the rule, once, with a backup taken first
//   M5  running it twice changes nothing the second time
//   M6  a soul.md with no voice rules at all is declined, left byte-identical, and no backup is written
//   M7  one stray tell name is not a rule: a soul.md that merely mentions one still gets the block
//
// HOW. Every leg runs the real migration in-process against a throwaway soul.md in its own folder under the
// OS temp directory, removed in the test's own after() hook even when the test fails.
//
// NEVER. Reads or writes this checkout's own soul.md. Leaves an `alex-mig001-*` OS temp folder behind: every
// fixture root is removed when its test ends.
//
// Usage: node scripts/tests/test-migration-001.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = require(path.join(KIT, 'scripts', 'migrations', '001-structural-voice-tells.js'));

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
  ''
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
  ''
].join('\n');

// The same rule a wizard run numbered differently. Nothing about the rule changed.
const RENUMBERED_VARIANT = SHORT_VARIANT.replace(
  '- Kill the shapes a word list cannot catch:',
  '4. Kill the shapes a word list cannot catch:'
);

/**
 * @param {import('node:test').TestContext} t
 * @param {string} soulBody
 * @returns {string} a fresh root holding that soul.md, removed when the test ends
 */
function install(t, soulBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-mig001-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'soul.md'), soulBody);
  return root;
}

/** @param {string} root @returns {{ status: string, message: string }} what 001 returned */
function run(root) {
  return migration.run({ root, log: () => {} });
}

/** @param {string} root @returns {string} */
const soulOf = (root) => fs.readFileSync(path.join(root, 'soul.md'), 'utf8');

// How many separate statements of the rule the file carries. Counted on the anchor name that no
// version of the rule omits, so it is a count of BLOCKS, not of the word.
/** @param {string} text @returns {number} */
const blocks = (text) => (text.match(/interpretive metadiscourse/gi) || []).length;

describe('migration 001: structural-voice-tells detection', () => {
  test('M1 NEGATIVE the /setup short variant is recognised as already present', (t) => {
    const root = install(t, HEAD + SHORT_VARIANT + TAIL);
    const before = soulOf(root);
    const res = run(root);
    const after = soulOf(root);
    assert.equal(res.status, 'skipped', `status=${res.status} (${res.message})`);
    assert.equal(blocks(after), 1, `${blocks(before)} before, ${blocks(after)} after`);
    assert.equal(after, before, `${before.length} -> ${after.length} bytes`);
  });

  test('M1b NEGATIVE a variant naming three tells, one of them a wrapped "superficial -ing analysis", is recognised and left alone', (t) => {
    const THREE = [
      '### Detection-proofing',
      '- Kill the shapes a word list cannot catch: superficial `-ing`',
      '  analysis, colon reveals and formatting slop, each defined in `brand/config/writing-style.md`.',
      ''
    ].join('\n');
    const root = install(t, HEAD + THREE + TAIL);
    const before = soulOf(root);
    const res = run(root);
    assert.equal(res.status, 'skipped', `status=${res.status}; ${before.length} -> ${soulOf(root).length} bytes`);
    assert.equal(soulOf(root), before);
  });

  test('M1c the detector holds eleven names and the long block the migration writes carries all eleven', (t) => {
    const names = migration.TELL_NAMES || [];
    const root = install(t, HEAD + TAIL);
    run(root);
    const written = soulOf(root);
    const missing = names.filter((/** @type {RegExp} */ re) => !re.test(written)).map(String);
    assert.equal(names.length, 11, `${names.length} name(s)`);
    assert.deepEqual(missing, [], `not in the block: ${missing.join(', ')}`);
  });

  test('M2 NEGATIVE the same rule numbered "4." is still recognised, and the install is left byte-identical', (t) => {
    const root = install(t, HEAD + RENUMBERED_VARIANT + TAIL);
    const before = soulOf(root);
    const res = run(root);
    assert.equal(res.status, 'skipped', `status=${res.status}`);
    assert.equal(soulOf(root), before);
  });

  test("M3 the migration's own long output is still recognised", (t) => {
    const root = install(t, `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n\n${TAIL}`);
    const first = run(root);
    assert.equal(first.status, 'applied', `status=${first.status}`);
    const withLong = soulOf(root);
    assert.ok(withLong.includes('Kill the structural AI tells'), 'the long block landed');

    const root2 = install(t, withLong);
    const res = run(root2);
    assert.equal(res.status, 'skipped', `status=${res.status}`);
    assert.equal(soulOf(root2), withLong);
  });

  test('M4 an install with neither variant gets the rule, exactly once, with a backup taken first', (t) => {
    const root = install(t, `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n\n${TAIL}`);
    const res = run(root);
    assert.equal(res.status, 'applied', `status=${res.status}`);
    assert.equal(blocks(soulOf(root)), 1, `${blocks(soulOf(root))} blocks`);
    assert.ok(
      fs.readdirSync(root).some((f) => f.startsWith('soul.md.bak-')),
      'a backup was taken before the write'
    );
  });

  test('M5 idempotence: a second run is a skip, not a second write', (t) => {
    const root = install(t, `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n\n${TAIL}`);
    run(root);
    const once = soulOf(root);
    const second = run(root);
    assert.equal(second.status, 'skipped', `status=${second.status}`);
    assert.equal(soulOf(root), once, 'the file is byte-identical after the second run');
    assert.equal(blocks(once), 1, 'still exactly one block');
  });

  test('M6 no voice rules section, so it declines, byte-identical, no backup written', (t) => {
    const root = install(t, '# Soul\n\n## My Role\nA translator.\n');
    const before = soulOf(root);
    const res = run(root);
    assert.equal(res.status, 'declined', `status=${res.status}`);
    assert.equal(soulOf(root), before);
    assert.ok(!fs.readdirSync(root).some((f) => f.startsWith('soul.md.bak-')), 'no backup written on a decline');
  });

  test('M7 one tell name alone is not the rule, so the block is still written', (t) => {
    const body = `${HEAD}### Detection-proofing\n1. Keep my real phrasing.\n2. No colon reveals.\n\n${TAIL}`;
    const root = install(t, body);
    const res = run(root);
    assert.equal(res.status, 'applied', `status=${res.status}`);
  });
});
