// @ts-check
// scripts/tests/test-changelog.mjs - a template's CHANGELOG.md and VERSION say exactly what its jsonl says.
//
// WHAT. The template build (scripts/build-online-template.mjs) renders CHANGELOG.md and VERSION from
// system/template-changelog.jsonl through scripts/lib/render-changelog.mjs. A generated file drifts two ways: a
// row lands in the jsonl and the files are not rendered again, or someone edits the markdown by hand. Both must
// fail CI. Deleted, this file would let a lagging or hand-edited CHANGELOG.md, one file without the other, a row
// that does not parse or sits out of position, and a VERSION naming another build (or none) ship in a template
// with every other test green, and nothing would check the tree it ships in. Each refusal is shown first:
//   C1  NEGATIVE a row appended to the jsonl after the render: the lagging markdown is refused
//   C2  NEGATIVE one hand-edited byte in the markdown is refused
//   C3  NEGATIVE a jsonl with no CHANGELOG.md beside it is refused
//   C4  NEGATIVE a CHANGELOG.md with no jsonl to be the render of is refused
//   C5  NEGATIVE a row that does not parse is refused, never guessed
//   C6  NEGATIVE a numbered row out of position is refused
//   C7  the render is deterministic, newest first, every build exactly once; CRLF line endings agree
//   C9  NEGATIVE a VERSION that names another build, or no VERSION at all, is refused: VERSION is rendered
//       from the same rows
//   C8  THE REAL TREE. In a generated template or seed (no variants/online/), the shipped CHANGELOG.md and
//       VERSION agree with the shipped jsonl. The Kit ships no CHANGELOG.md by design, so its real jsonl is
//       rendered into a scratch tree and checked there, and the line says so.
//
// HOW. Pure fixture work in the OS temp folder, plus the one read of the real tree in C8. Each leg is its own
// named test(); a failed assertion inside one leaves the rest of that leg unread but never blocks a sibling leg.
//
// NEVER. Writes inside the repository it runs in: the scratch folder is removed at the end.
//
// Usage: node scripts/tests/test-changelog.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHANGELOG_JSONL,
  CHANGELOG_MD,
  VERSION_FILE,
  checkTree,
  parseRows,
  renderChangelog,
  renderVersion,
  writeChangelog
} from '../lib/render-changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-changelog-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/**
 * One jsonl row for build n, its fields overridden by extra.
 * @param {number} n
 * @param {Record<string, unknown>} [extra]
 */
const row = (n, extra = {}) =>
  JSON.stringify({
    at: `2026-09-2${n % 10}T10:0${n % 10}:00Z`,
    changed: n,
    files: 700 + n,
    flagged: n % 2 ? ['CLAUDE.md'] : [],
    kit_commit: `${String(n).repeat(40)}`.slice(0, 40),
    kit_dirty: false,
    previous_template_commit: n === 1 ? null : `${String(n - 1).repeat(40)}`.slice(0, 40),
    ...extra
  });
// A fixture tree gets the VERSION the build would render beside its jsonl, unless a leg says otherwise
// (`version: false` for none, a string for a wrong one), so C1 to C7 keep testing the markdown alone.
/**
 * @param {string} name
 * @param {{ jsonl?: string | null, md?: string | null, version?: string | false }} [files]
 */
const tree = (name, { jsonl = null, md = null, version } = {}) => {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  if (jsonl !== null) fs.writeFileSync(path.join(dir, CHANGELOG_JSONL), jsonl);
  if (md !== null) fs.writeFileSync(path.join(dir, CHANGELOG_MD), md);
  let v = version;
  if (v === undefined && jsonl !== null) {
    try {
      v = renderVersion(jsonl);
    } catch {
      v = false;
    }
  }
  if (typeof v === 'string') fs.writeFileSync(path.join(dir, VERSION_FILE), v);
  return dir;
};
const THREE = `${row(1)}\n${row(2)}\n${row(3)}\n`;
const TWO = `${row(1)}\n${row(2)}\n`;

describe('the changelog and VERSION render', () => {
  test('C1 NEGATIVE a lagging CHANGELOG.md is refused', () => {
    const p = checkTree(tree('c1', { jsonl: THREE, md: renderChangelog(TWO) }));
    assert.equal(p.length, 1, p.join(' | '));
    assert.match(p[0], /not the render/);
  });

  test('C2 NEGATIVE a hand-edited CHANGELOG.md is refused', () => {
    const good = renderChangelog(THREE);
    const p = checkTree(tree('c2', { jsonl: THREE, md: good.replace('Build 3', 'Build 4') }));
    assert.equal(p.length, 1, p.join(' | '));
    assert.match(p[0], /line \d+ reads/);
  });

  test('C3 NEGATIVE a jsonl with no CHANGELOG.md is refused', () => {
    const p3 = checkTree(tree('c3', { jsonl: THREE }));
    assert.equal(p3.length, 1, p3.join(' | '));
    assert.match(p3[0], /does not/);
  });

  test('C4 NEGATIVE a CHANGELOG.md with no jsonl is refused', () => {
    const p4 = checkTree(tree('c4', { md: renderChangelog(THREE) }));
    assert.equal(p4.length, 1, p4.join(' | '));
    assert.match(p4[0], /no system\/template-changelog\.jsonl/);
  });

  test('C5 NEGATIVE an unparseable row is refused, never guessed', () => {
    const broken = `${row(1)}\n{"at": "2026-09-22T10:00:00Z", \n`;
    assert.throws(() => renderChangelog(broken), /not JSON/);
    const p = checkTree(tree('c5', { jsonl: broken, md: '# Changelog\n' }));
    assert.equal(p.length, 1, p.join(' | '));
    assert.match(p[0], /not JSON/);
  });

  test('C6 NEGATIVE a numbered row out of position is refused', () => {
    assert.throws(() => parseRows(`${row(1)}\n${row(2, { build: 5 })}\n`), /says build 5/);
  });

  test('C7 the shape of a good render', () => {
    const a = renderChangelog(THREE);
    const heads = [...a.matchAll(/^## Build (\d+) /gm)].map((m) => Number(m[1]));
    assert.equal(a, renderChangelog(THREE), 'the same rows render the same bytes');
    assert.equal(heads.join(','), '3,2,1', 'newest build first, each build exactly once');
    assert.match(a, /The first build: 701 files/);
    assert.match(a, /- 3 of 703 files changed\./);
    const p = checkTree(tree('c7', { jsonl: THREE, md: a.replace(/\n/g, '\r\n') }));
    assert.deepEqual(p, [], 'a CRLF checkout of a good CHANGELOG.md agrees');
    const dirty = renderChangelog(`${row(1, { kit_dirty: true })}\n`);
    assert.match(dirty, /with uncommitted changes in the Kit/);
  });

  test('C9 VERSION is the render of the same rows', () => {
    const stale = checkTree(tree('c9', { jsonl: THREE, md: renderChangelog(THREE), version: renderVersion(TWO) }));
    assert.equal(stale.length, 1, stale.join(' | '));
    assert.match(stale[0], /VERSION is not the render/);
    const none = checkTree(tree('c9b', { jsonl: THREE, md: renderChangelog(THREE), version: false }));
    assert.equal(none.length, 1, none.join(' | '));
    assert.match(none[0], /VERSION is not the render/);
    assert.equal(
      renderVersion(THREE),
      'Virtual Alex template build 3, 2026-09-23, from Kit commit 333333333333\n',
      'VERSION names the newest build, its day and its Kit commit'
    );
  });

  test('C8 the tree this test ships in', () => {
    const jsonl = path.join(ROOT, CHANGELOG_JSONL);
    if (IS_KIT) {
      const scratch = tree('c8-kit', { jsonl: fs.readFileSync(jsonl, 'utf8') });
      const wrote = writeChangelog(scratch);
      const p = checkTree(scratch);
      assert.equal(
        wrote.length,
        2,
        'both CHANGELOG.md and VERSION were written into the template; neither render is tracked here'
      );
      assert.deepEqual(p, [], p.join(' | '));
    } else {
      const p = checkTree(ROOT);
      assert.deepEqual(
        p,
        [],
        `this generated tree's CHANGELOG.md agrees with system/template-changelog.jsonl: ${p.join(' | ')}`
      );
    }
  });
});
