#!/usr/bin/env node
// scripts/tests/test-changelog.mjs - the template's CHANGELOG.md says exactly what its jsonl says.
//
// WHAT. CHANGELOG.md is generated from system/template-changelog.jsonl by the template build
// (scripts/lib/render-changelog.mjs, called from scripts/build-online-template.mjs). A generated file
// drifts in two ways: a row lands in the jsonl and the markdown is not re-rendered, or someone edits
// the markdown by hand. Both must fail CI, and the negative legs below show each one failing before
// the real tree is checked.
//   C1  NEGATIVE a row appended to the jsonl after the render: the lagging markdown is refused
//   C2  NEGATIVE one hand-edited byte in the markdown is refused
//   C3  NEGATIVE a jsonl with no CHANGELOG.md beside it is refused
//   C4  NEGATIVE a CHANGELOG.md with no jsonl to be the render of is refused
//   C5  NEGATIVE a row that does not parse is refused, never guessed
//   C6  NEGATIVE a numbered row out of position is refused
//   C7  the render is deterministic, newest first, every build exactly once; CRLF line endings agree
//   C9  NEGATIVE a VERSION that names another build, or no VERSION at all, is refused (fleet Fix A:
//       VERSION is rendered from the same rows, review finding F44)
//   C8  THE REAL TREE. In a generated template or seed (no variants/online/), the shipped CHANGELOG.md
//       agrees with the shipped jsonl. In the Kit there is no CHANGELOG.md by design, so the Kit's real
//       jsonl is rendered into a scratch tree and checked there, and the line says so.
//
// HOW. Pure fixture work in a temporary directory, plus the one read of the real tree in C8.
// Run: node scripts/tests/test-changelog.mjs      (exit 0 = all pass, 1 = any failure)
//
// NEVER. It never writes inside the repository it runs in. The scratch directory is removed at the
// end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderChangelog, renderVersion, writeChangelog, checkTree, parseRows, CHANGELOG_MD, CHANGELOG_JSONL, VERSION_FILE,
} from '../lib/render-changelog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-changelog-'));
const row = (n, extra = {}) => JSON.stringify({
  at: `2026-09-2${n % 10}T10:0${n % 10}:00Z`, changed: n, files: 700 + n, flagged: n % 2 ? ['CLAUDE.md'] : [],
  kit_commit: `${String(n).repeat(40)}`.slice(0, 40), kit_dirty: false,
  previous_template_commit: n === 1 ? null : `${String(n - 1).repeat(40)}`.slice(0, 40), ...extra,
});
// A fixture tree gets the VERSION the build would render beside its jsonl, unless a leg says otherwise
// (`version: false` for none, a string for a wrong one), so C1 to C7 keep testing the markdown alone.
const tree = (name, { jsonl = null, md = null, version } = {}) => {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  if (jsonl !== null) fs.writeFileSync(path.join(dir, CHANGELOG_JSONL), jsonl);
  if (md !== null) fs.writeFileSync(path.join(dir, CHANGELOG_MD), md);
  let v = version;
  if (v === undefined && jsonl !== null) { try { v = renderVersion(jsonl); } catch { v = false; } }
  if (typeof v === 'string') fs.writeFileSync(path.join(dir, VERSION_FILE), v);
  return dir;
};
const THREE = `${row(1)}\n${row(2)}\n${row(3)}\n`;
const TWO = `${row(1)}\n${row(2)}\n`;

try {
  // C1: the build appended a row and nothing re-rendered the markdown.
  {
    const p = checkTree(tree('c1', { jsonl: THREE, md: renderChangelog(TWO) }));
    ok(p.length === 1 && /not the render/.test(p[0]), 'C1 NEGATIVE a lagging CHANGELOG.md is refused', p[0] || 'no problem reported');
  }
  // C2: a hand edit, one byte.
  {
    const good = renderChangelog(THREE);
    const p = checkTree(tree('c2', { jsonl: THREE, md: good.replace('Build 3', 'Build 4') }));
    ok(p.length === 1 && /line \d+ reads/.test(p[0]), 'C2 NEGATIVE a hand-edited CHANGELOG.md is refused', p[0] || 'no problem reported');
  }
  // C3 and C4: one file without the other.
  {
    const p3 = checkTree(tree('c3', { jsonl: THREE }));
    ok(p3.length === 1 && /does not/.test(p3[0]), 'C3 NEGATIVE a jsonl with no CHANGELOG.md is refused', p3[0] || 'no problem reported');
    const p4 = checkTree(tree('c4', { md: renderChangelog(THREE) }));
    ok(p4.length === 1 && /no system\/template-changelog\.jsonl/.test(p4[0]), 'C4 NEGATIVE a CHANGELOG.md with no jsonl is refused', p4[0] || 'no problem reported');
  }
  // C5: a row that does not parse.
  {
    const broken = `${row(1)}\n{"at": "2026-09-22T10:00:00Z", \n`;
    let threw = null;
    try { renderChangelog(broken); } catch (e) { threw = e.message; }
    const p = checkTree(tree('c5', { jsonl: broken, md: '# Changelog\n' }));
    ok(Boolean(threw) && p.length === 1 && /not JSON/.test(p[0]), 'C5 NEGATIVE an unparseable row is refused, never guessed', threw || 'rendered anyway');
  }
  // C6: a numbered row sitting at the wrong position.
  {
    let threw = null;
    try { parseRows(`${row(1)}\n${row(2, { build: 5 })}\n`); } catch (e) { threw = e.message; }
    ok(Boolean(threw) && /says build 5/.test(threw), 'C6 NEGATIVE a numbered row out of position is refused', threw || 'accepted');
  }
  // C7: the shape of a good render.
  {
    const a = renderChangelog(THREE);
    const heads = [...a.matchAll(/^## Build (\d+) /gm)].map((m) => Number(m[1]));
    ok(a === renderChangelog(THREE), 'C7 the same rows render the same bytes');
    ok(heads.join(',') === '3,2,1', 'C7 newest build first, each build exactly once', heads.join(','));
    ok(/The first build: 701 files/.test(a) && /- 3 of 703 files changed\./.test(a), 'C7 the first build and a later build read as such');
    const p = checkTree(tree('c7', { jsonl: THREE, md: a.replace(/\n/g, '\r\n') }));
    ok(p.length === 0, 'C7 a CRLF checkout of a good CHANGELOG.md agrees', p[0] || 'agrees');
    const dirty = renderChangelog(`${row(1, { kit_dirty: true })}\n`);
    ok(/with uncommitted changes in the Kit/.test(dirty), 'C7 a build from a dirty Kit says so');
  }
  // C9: VERSION is the render of the same rows.
  {
    const stale = checkTree(tree('c9', { jsonl: THREE, md: renderChangelog(THREE), version: renderVersion(TWO) }));
    ok(stale.length === 1 && /VERSION is not the render/.test(stale[0]), 'C9 NEGATIVE a VERSION naming an older build is refused', stale[0] || 'no problem reported');
    const none = checkTree(tree('c9b', { jsonl: THREE, md: renderChangelog(THREE), version: false }));
    ok(none.length === 1 && /VERSION is not the render/.test(none[0]), 'C9b NEGATIVE a tree with no VERSION is refused', none[0] || 'no problem reported');
    ok(/^Virtual Alex template build 3, 2026-09-23, from Kit commit 333333333333\n$/.test(renderVersion(THREE)), 'C9c VERSION names the newest build, its day and its Kit commit', JSON.stringify(renderVersion(THREE)));
  }
  // C8: the tree this test ships in.
  {
    const jsonl = path.join(ROOT, CHANGELOG_JSONL);
    if (IS_KIT) {
      const scratch = tree('c8-kit', { jsonl: fs.readFileSync(jsonl, 'utf8') });
      const wrote = writeChangelog(scratch);
      const p = checkTree(scratch);
      const n = parseRows(fs.readFileSync(jsonl, 'utf8')).length;
      ok(wrote.length === 2 && p.length === 0,
        'C8 the Kit: its real jsonl renders and the render agrees (CHANGELOG.md and VERSION are generated into the template; neither render is tracked here)',
        `${n} builds rendered`);
    } else {
      const p = checkTree(ROOT);
      ok(p.length === 0, 'C8 this generated tree: CHANGELOG.md agrees with system/template-changelog.jsonl',
        p[0] || `${fs.existsSync(jsonl) ? parseRows(fs.readFileSync(jsonl, 'utf8')).length : 0} builds, agree`);
    }
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? `test-changelog: ${failures} FAILED` : 'test-changelog: all pass');
process.exit(failures ? 1 : 0);
