#!/usr/bin/env node
// scripts/tests/test-validate-known-bad-structure.mjs - the KNOWN-BAD set for validate-alex, part 1:
// the structural guards and the legs that compare a generated or derived surface with its source
// (G1-G4, V1, V2's documentation half, V3, V4, V5, V7, V9 (a), V16, V17), plus V15, which cannot fail.
//
// WHAT. Deleted, none of these legs would be proven to refuse the defect it exists for: one tree per
// test, built with the smallest change that makes exactly one check FAIL. The test asserts the exact
// FAILED line(s), the exit code, and what the online hook does with it: a drift leg is degraded to a
// WARNING under CLAUDE_CODE_REMOTE=true, a content leg still blocks. Every test named `KNOWN-BAD <leg>`
// is a member of the set the validator must refuse the same way. `PINNED DEFECT <id>` asserts a
// behaviour this tree proved wrong, as it behaves today, so the fix flips that named test.
//
// HOW. scripts/tests/fixtures/validator-tree.mjs builds the temp git repository from this checkout's
// tracked files (`.agents/` left out: no validator leg reads it - V18 (a) skips it by name, it holds no
// .ps1 for V18 (f), and it is outside V21's scope globs; leaving it out makes each tree about 300 files,
// not 860). Every run loads scripts/tests/fixtures/scheduler-stub.cjs first, which refuses every
// schtasks, launchctl and crontab call and answers liveJobs() with an empty list, so V2's live half
// never asks this machine anything; the clock is pinned the same way where a message carries a date
// (C4_NOW). Contexts: LAPTOP is the laptop hook's exact form (`--context=pre-commit --changed`,
// CLAUDE_CODE_REMOTE empty); ONLINE is the same line with CLAUDE_CODE_REMOTE=true (every autosave);
// GENERATOR is the default context generate-alex.js uses. Each test runs the contexts whose verdict
// differs.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-validate-known-bad-structure.mjs
// Exit: 0 every case passed - 1 one failed

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  makeRoot,
  pinnedGitEnv,
  writeGitConfig,
  buildBaseTree,
  makeTreeFactory,
  spawnCollect,
  lines
} from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const ROOT = makeRoot('alex-kb-structure-');
const BASE = path.join(ROOT, 'base');
const ENV = pinnedGitEnv(ROOT);
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);

const LAPTOP = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: '' } };
const ONLINE = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: 'true' } };
const GENERATOR = { args: [], env: { CLAUDE_CODE_REMOTE: '' } };
const SUITE = 'G1-G4 + V1-V21 (V6, V8, V20 retired)';

function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}
function write(dir, rel, text) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
}
function replaceOnce(dir, rel, from, to) {
  const text = read(dir, rel);
  const at = text.indexOf(from);
  assert.ok(
    at >= 0 && text.indexOf(from, at + 1) < 0,
    `fixture: ${rel} must hold ${JSON.stringify(from)} exactly once`
  );
  write(dir, rel, text.slice(0, at) + to + text.slice(at + from.length));
}
// Rewrite system/manifest.json keeping its 2-space layout and its line endings.
function editManifest(dir, fn) {
  const rel = 'system/manifest.json';
  const text = read(dir, rel);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = JSON.parse(text);
  fn(m);
  write(dir, rel, JSON.stringify(m, null, 2).split('\n').join(eol) + eol);
}

function run(dir, ctx, extraEnv = {}, extraArgs = []) {
  return spawnCollect(['-r', STUB, path.join(dir, 'scripts', 'validate-alex.js'), ...ctx.args, ...extraArgs], {
    cwd: dir,
    env: { ...ENV, C4_LIVEJOBS_DIRECT: '1', ...ctx.env, ...extraEnv }
  }).then((r) => ({
    ...r,
    failed: lines(r.stderr).filter((l) => l.startsWith('FAILED ')),
    warnings: lines(r.stderr).filter((l) => l.startsWith('WARNING'))
  }));
}

const tree = makeTreeFactory(BASE, ROOT);

// The laptop hook refuses with exactly these lines and exit 1.
function assertRefused(r, expected, label) {
  assert.equal(r.status, 1, `${label}: exit code\n${r.stderr}`);
  assert.deepEqual(r.failed, expected, `${label}: the FAILED lines`);
  assert.equal(r.stdout, '', `${label}: no PASS verdict on stdout`);
}
// The online hook turns each drift line into a WARNING that names the degradation, counts them, and passes.
function assertDegraded(r, expected, label) {
  assert.equal(r.status, 0, `${label}: online a drift leg does not block\n${r.stderr}`);
  assert.deepEqual(r.failed, [], `${label}: no FAILED line left online`);
  for (const f of expected)
    assert.ok(
      r.warnings.includes(
        `WARNING (drift, degraded under CLAUDE_CODE_REMOTE=true, context=pre-commit) ${f.slice('FAILED '.length)}`
      ),
      `${label}: degraded line for ${f}`
    );
  assert.ok(
    r.warnings.includes(
      `WARNING validate-alex: ${expected.length} drift failure(s) degraded to warnings because CLAUDE_CODE_REMOTE=true (an autosave that cannot commit is a page that dies with the VM); the content legs still block, and the weekly check turns a persisting drift red`
    ),
    `${label}: the count line`
  );
  assert.equal(
    r.stdout.trim(),
    `validate-alex: ${SUITE} PASS (context=pre-commit, ${r.warnings.length} warning(s) - see above)`,
    `${label}: the verdict`
  );
}

before(() => {
  writeGitConfig(ROOT, 'known-bad fixture');
  buildBaseTree(KIT, BASE, ENV);
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('validate-alex known-bad trees: structure and generated surfaces', { concurrency: CONCURRENCY }, () => {
  test('control: the unplanted tree passes the laptop hook, the online hook and the generator, with no FAILED line', async () => {
    const dir = tree();
    for (const [label, ctx] of [
      ['laptop', LAPTOP],
      ['online', ONLINE],
      ['generator', GENERATOR]
    ]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 0, `${label}\n${r.stderr}`);
      assert.deepEqual(r.failed, [], label);
      const ctxName = label === 'generator' ? 'generator' : 'pre-commit';
      assert.equal(
        r.stdout.trim(),
        `validate-alex: ${SUITE} PASS (context=${ctxName}, ${r.warnings.length} warning(s) - see above)`,
        label
      );
    }
  });

  test('KNOWN-BAD G1: a {{PLACEHOLDER}} left in .staging fails the generator (armed by default); the hooks ignore .staging unless named', async () => {
    const dir = tree();
    write(dir, '.staging/docs/zz-slot.md', '# zz\n\n{{ZZ_SLOT}}\n');
    const line = `FAILED G1: unresolved placeholder(s) {{ZZ_SLOT}} in staged ${path.join('docs', 'zz-slot.md')}`;
    assertRefused(await run(dir, GENERATOR), [line], 'generator');
    const hook = await run(dir, LAPTOP);
    assert.equal(hook.status, 0, hook.stderr);
    assert.ok(
      lines(hook.stderr).includes(
        'validate-alex: NOTE .staging/ exists and is IGNORED in context=pre-commit - the working tree is what a commit ships (pass --staged=<dir> to validate a preview tree deliberately)'
      )
    );
    const staged = [`--staged=${path.join(dir, '.staging')}`];
    assertRefused(await run(dir, LAPTOP, {}, staged), [line], 'laptop, --staged named');
    assertRefused(await run(dir, ONLINE, {}, staged), [line], 'online, --staged named: G1 is content and blocks');
  });

  test('KNOWN-BAD G2: the routing END marker renamed in CLAUDE.md; content, blocks online too', async () => {
    const dir = tree();
    replaceOnce(dir, 'CLAUDE.md', '<!-- ROUTING-TABLE:END -->', '<!-- ROUTING-TABLE:ENDED -->');
    const expected = [
      'FAILED G2: CLAUDE.md (repo) must contain exactly one ROUTING-TABLE BEGIN/END pair - found BEGIN=1, END=0'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD G2 (order): END moved above BEGIN', async () => {
    const dir = tree();
    const text = read(dir, 'CLAUDE.md');
    const end = '<!-- ROUTING-TABLE:END -->';
    const without = text.replace(end, '');
    const bi = without.indexOf('<!-- ROUTING-TABLE:BEGIN');
    write(dir, 'CLAUDE.md', without.slice(0, bi) + end + '\n' + without.slice(bi));
    const expected = ['FAILED G2: CLAUDE.md (repo) routing markers out of order (END before BEGIN)'];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
  });

  test('KNOWN-BAD G3: the CUSTOM_END marker renamed in docs/README.md; blocks online', async () => {
    const dir = tree();
    replaceOnce(dir, 'docs/README.md', '<!-- CUSTOM_END -->', '<!-- CUSTOM_ENDED -->');
    const expected = ['FAILED G3: docs/README.md (repo) must contain exactly one custom zone - found START=1, END=0'];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD G4: the PROJECT-TABLE END marker renamed in docs/projects/README.md; blocks online', async () => {
    const dir = tree();
    replaceOnce(dir, 'docs/projects/README.md', '<!-- PROJECT-TABLE:END -->', '<!-- PROJECT-TABLE:ENDED -->');
    const expected = [
      'FAILED G4: docs/projects/README.md (repo) must contain exactly one PROJECT-TABLE BEGIN/END pair - found BEGIN=1, END=0'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V1: the GETTING-STARTED automation count raised by one; a drift leg, degraded online', async () => {
    const dir = tree();
    const m = JSON.parse(read(dir, 'system/manifest.json'));
    const live = m.projects.filter((p) => p.state !== 'RETIRED');
    const heading = read(dir, 'docs/GETTING-STARTED.md').match(
      /^(## \d+\. The automations \()(\d+)( registered, non-retired\))/m
    );
    assert.ok(heading && Number(heading[2]) === live.length, 'fixture: the heading carries the manifest count');
    replaceOnce(dir, 'docs/GETTING-STARTED.md', heading[0], `${heading[1]}${live.length + 1}${heading[3]}`);
    const expected = [
      `FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (repo) says ${live.length + 1}, system/manifest.json says ${live.length}; manifest non-retired: ${live.map((p) => p.work_dir).join(', ')}`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V1 (registry unreadable): a manifest that is not JSON; "not valid JSON" is never drift, so it blocks online', async () => {
    const dir = tree();
    const text = read(dir, 'system/manifest.json');
    write(dir, 'system/manifest.json', text.replace(/\s*$/, '') + ',\n');
    let message;
    try {
      JSON.parse(read(dir, 'system/manifest.json'));
    } catch (e) {
      message = e.message;
    }
    const expected = [`FAILED V1: system/manifest.json is not valid JSON: ${message}`];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V2 (documentation half): one scheduled-jobs row drifted in GETTING-STARTED; degraded online', async () => {
    const dir = tree();
    const text = read(dir, 'docs/GETTING-STARTED.md');
    const sec = text.slice(text.indexOf('### The scheduled jobs'));
    const row = sec.split(/\r?\n/).find((l) => l.startsWith('| ') && !l.startsWith('| Job |') && !l.startsWith('|---'));
    assert.ok(row, 'fixture: the jobs table has a row');
    replaceOnce(dir, 'docs/GETTING-STARTED.md', row, row.replace(/ \|$/, ' zz |'));
    const name = row.split(' | ')[0].replace(/^\| /, '').trim();
    const expected = [
      `FAILED V2: scheduled-jobs table row for '${name}' in docs/GETTING-STARTED.md (repo) does not match scheduler/schedule.md (command/frequency drift)`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('V2 (documentation half, missing/extra): a whole row deleted from GETTING-STARTED names its fix', async () => {
    const dir = tree();
    const text = read(dir, 'docs/GETTING-STARTED.md');
    const sec = text.slice(text.indexOf('### The scheduled jobs'));
    const row = sec.split(/\r?\n/).find((l) => l.startsWith('| ') && !l.startsWith('| Job |') && !l.startsWith('|---'));
    assert.ok(row, 'fixture: the jobs table has a row');
    const name = row.split(' | ')[0].replace(/^\| /, '').trim();
    replaceOnce(dir, 'docs/GETTING-STARTED.md', `${row}\n`, '');
    const expected = [
      `FAILED V2: scheduled-jobs table drift - scheduler/schedule.md entries missing from docs/GETTING-STARTED.md (repo): [${name}]; rows in the doc with no schedule.md entry: [none]; regenerate: node scripts/generate-alex.js --only=docs (--only=scheduler also regenerates this table, outside the online tree)`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V2 (source missing): scheduler/schedule.md deleted; "not found" blocks online', async () => {
    const dir = tree();
    fs.rmSync(path.join(dir, 'scheduler', 'schedule.md'));
    const expected = ['FAILED V2: scheduler/schedule.md not found'];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V3: an ON-DEMAND project flipped to RETIRED in the registry; three V3 lines beside the three V1 counts, all degraded online', async () => {
    const dir = tree();
    const before = JSON.parse(read(dir, 'system/manifest.json'));
    const target = before.projects.find((p) => p.state === 'ON-DEMAND');
    assert.ok(target, 'fixture: an ON-DEMAND project exists');
    editManifest(dir, (m) => {
      m.projects.find((p) => p.num === target.num).state = 'RETIRED';
    });
    const nn = String(target.num).padStart(2, '0');
    const nonRetired = before.projects.filter((p) => p.state !== 'RETIRED' && p.num !== target.num);
    const n = nonRetired.length;
    const expected = [
      `FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (repo) says ${n + 1}, system/manifest.json says ${n}; manifest non-retired: ${nonRetired.map((p) => p.work_dir).join(', ')}`,
      `FAILED V1: docs/GETTING-STARTED.md (repo) automation list has ${n + 1} numbered rows but system/manifest.json has ${n} non-retired numbered projects`,
      `FAILED V1: automation count mismatch - docs/README.md (repo) says ${n + 1}, system/manifest.json says ${n}`,
      `FAILED V3: retired project ${nn} ${target.title} (system/manifest.json state=RETIRED) appears in the docs/GETTING-STARTED.md (repo) automation list`,
      `FAILED V3: retired project ${nn} ${target.title} listed WITHOUT the RETIRED state in the CLAUDE.md (repo) routing region`,
      `FAILED V3: retired project ${nn} ${target.title} listed with state 'ON-DEMAND' instead of RETIRED in docs/projects/README.md (repo)`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V4: an MCP name only GETTING-STARTED section 5 lists; degraded online', async () => {
    const dir = tree();
    const text = read(dir, 'docs/GETTING-STARTED.md');
    const h = text.match(/^## \d+\. The tools Alex reaches \(MCP\)\s*$/m);
    assert.ok(h, 'fixture: the MCP section exists');
    const at = h.index + h[0].length;
    const firstItem = text.slice(at).match(/^- .+$/m);
    const cut = at + firstItem.index;
    write(dir, 'docs/GETTING-STARTED.md', text.slice(0, cut) + '- Zz Nowhere\n' + text.slice(cut));
    const expected = [
      'FAILED V4: MCP set difference between CLAUDE.md and docs/GETTING-STARTED.md section 5 (repo) - in CLAUDE.md but not there: [none]; there but not in CLAUDE.md: [Zz Nowhere]'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V4 (unparseable embedded reference): the MCP heading renamed inside docs/ARCHITECTURE.md; "cannot parse" blocks online', async () => {
    const dir = tree();
    replaceOnce(dir, 'docs/ARCHITECTURE.md', '\n## MCP Reference\n', '\n## MCP Reference (renamed)\n');
    const expected = [
      'FAILED V4: cannot parse the embedded MCP Reference of docs/ARCHITECTURE.md (repo): read-sources: CLAUDE.md has no "## MCP Reference" section'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V5: a hex no token defines, in a docs page; degraded online', async () => {
    const dir = tree();
    const { parseColorTokens } = require(path.join(dir, 'scripts', 'lib', 'read-sources.js'));
    assert.ok(
      !parseColorTokens(read(dir, 'brand/config/color-system.md')).allHexes.has('#123456'),
      'fixture: #123456 is not a token'
    );
    write(dir, 'docs/zz-hex.md', '# zz\n\ncolour #123456\n');
    const expected = [
      'FAILED V5: hex value(s) outside brand/config/color-system.md matching no defined token in docs/zz-hex.md (repo): #123456 (line 3)'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V5 (law file missing): brand/config/color-system.md deleted; "not found" blocks online', async () => {
    const dir = tree();
    fs.rmSync(path.join(dir, 'brand', 'config', 'color-system.md'));
    const expected = ['FAILED V5: brand/config/color-system.md not found - the color law file is required'];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('PINNED DEFECT R5-15: an issue number (#412) and a heading anchor (#add-...) are read as colours and block', async () => {
    const dir = tree();
    write(dir, 'docs/zz-issue.md', '# zz\n\nsee issue #412 and [the section](#add-a-job)\n');
    const expected = [
      'FAILED V5: hex value(s) outside brand/config/color-system.md matching no defined token in docs/zz-issue.md (repo): #412 (line 3), #add (line 3)'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
  });

  // V7's association rule, restated only to CHOOSE a fixture: a "### " section belongs to a registry row by
  // the row's title, a "(#NN)" tag, or a /command on its "- Command:" line.
  function owners(m, section) {
    const title = section[0];
    const cmd = section.find((l) => /^\s*-\s*Command:/i.test(l)) || '';
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...m.projects, ...(m.meta.unnumbered || [])].filter(
      (p) =>
        (p.title && new RegExp(`\\b${esc(p.title)}\\b`, 'i').test(title)) ||
        (p.num != null && new RegExp(`\\(#0?${p.num}\\)`).test(title)) ||
        (p.commands || []).some((c) => new RegExp(`/${c}\\b`).test(cmd))
    );
  }
  function sections(text) {
    const ls = text.split(/\r?\n/);
    const out = [];
    for (let i = 0; i < ls.length; i++)
      if (ls[i].startsWith('### ')) {
        if (out.length) out[out.length - 1].end = i;
        out.push({ start: i, end: ls.length });
      }
    return { ls, out };
  }

  test('KNOWN-BAD V7: a "- Status: PARKED" line under a LIVE project\'s schedule section; degraded online', async (t) => {
    const dir = tree();
    const m = JSON.parse(read(dir, 'system/manifest.json'));
    const text = read(dir, 'scheduler/schedule.md');
    const { ls, out } = sections(text);
    const pick = out
      .map((s) => ({ s, who: owners(m, ls.slice(s.start, s.end)) }))
      .find((x) => x.who.length && x.who.every((p) => p.state === 'LIVE'));
    if (!pick) {
      t.skip('no schedule.md section here belongs only to LIVE projects');
      return;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    ls.splice(pick.s.start + 1, 0, '- Status: PARKED');
    write(dir, 'scheduler/schedule.md', ls.join(eol));
    const expected = pick.who.map(
      (p) =>
        `FAILED V7: scheduler/schedule.md:${pick.s.start + 2} asserts PARKED but system/manifest.json says ${p.name} is ${p.state}`
    );
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('PINNED DEFECT R5-19: the last "### " section runs to the end of schedule.md, so a Status line under a later "## " section is read as its claim', async (t) => {
    const dir = tree();
    const m = JSON.parse(read(dir, 'system/manifest.json'));
    const text = read(dir, 'scheduler/schedule.md');
    const { ls, out } = sections(text);
    const last = out[out.length - 1];
    const who = owners(m, ls.slice(last.start, last.end));
    const hasLaterH2 = ls.slice(last.start + 1).some((l) => /^## /.test(l));
    if (!who.length || !hasLaterH2) {
      t.skip('the last "### " section here has no owner or no "## " section after it');
      return;
    }
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = text.replace(/(\r?\n)*$/, '');
    const appended =
      body + eol + eol + '## Zz later notes' + eol + '- Status: PAUSED' + eol + '- Status: DORMANT' + eol;
    write(dir, 'scheduler/schedule.md', appended);
    const lineNo = body.split(/\r?\n/).length + 4;
    const expected = [];
    for (const [word, ln] of [
      ['PAUSED', lineNo - 1],
      ['DORMANT', lineNo]
    ])
      for (const p of who)
        if (!(word === p.state || (word === 'PAUSED' && p.state === 'PARKED')))
          expected.push(
            `FAILED V7: scheduler/schedule.md:${ln} asserts ${word} but system/manifest.json says ${p.name} is ${p.state}`
          );
    assert.ok(expected.length > 0, 'fixture: at least one word contradicts the owner');
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
  });

  test('KNOWN-BAD V9 (a): a LIVE project whose first_fire is in the future; content, blocks online', async () => {
    const dir = tree();
    const m0 = JSON.parse(read(dir, 'system/manifest.json'));
    const p = m0.projects.find((x) => x.state === 'LIVE');
    editManifest(dir, (m) => {
      const q = m.projects.find((x) => x.num === p.num);
      q.first_fire = '2999-01-01';
      q.first_fire_kind = 'live';
    });
    const env = { C4_NOW: '2026-09-25T12:00:00Z' };
    const expected = [
      `FAILED V9: #${String(p.num).padStart(2, '0')} ${p.name} has first_fire "2999-01-01", which is in the FUTURE (today 2026-09-25) - first_fire records a fire that ALREADY happened; set the real date, or null to let the 14-day aging clock run (a documented drill counts, first_fire_kind=drill)`
    ];
    assertRefused(await run(dir, LAPTOP, env), expected, 'laptop');
    assertRefused(await run(dir, ONLINE, env), expected, 'online');
  });

  test('PINNED DEFECT R5-17: "today" is the UTC date, so a first_fire stamped with the local date after local midnight fails and blocks', async () => {
    const dir = tree();
    const m0 = JSON.parse(read(dir, 'system/manifest.json'));
    const p = m0.projects.find((x) => x.state === 'LIVE');
    editManifest(dir, (m) => {
      const q = m.projects.find((x) => x.num === p.num);
      q.first_fire = '2026-09-25';
      q.first_fire_kind = 'live';
    });
    // 23:30 UTC on the 24th is 01:30 on the 25th under CEST: a local date one day ahead of the UTC one.
    const env = { C4_NOW: '2026-09-24T23:30:00Z', TZ: 'Europe/Berlin' };
    const expected = [
      `FAILED V9: #${String(p.num).padStart(2, '0')} ${p.name} has first_fire "2026-09-25", which is in the FUTURE (today 2026-09-24) - first_fire records a fire that ALREADY happened; set the real date, or null to let the 14-day aging clock run (a documented drill counts, first_fire_kind=drill)`
    ];
    assertRefused(await run(dir, ONLINE, env), expected, 'online');
  });

  test('KNOWN-BAD V16: the constitution byte budget set below CLAUDE.md; content, blocks online', async () => {
    const dir = tree();
    editManifest(dir, (m) => {
      m.meta.constitution.byte_budget = 1000;
    });
    const bytes = Buffer.byteLength(read(dir, 'CLAUDE.md'));
    const expected = [
      `FAILED V16: CLAUDE.md is ${bytes} B against meta.constitution.byte_budget 1000 B - the constitution is regrowing. Keep the operative sentence here and move the narrative to docs/constitution-annex/ (the 2026-08-16 diet pattern); raise the budget only as a deliberate manifest edit.`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V17: an empty .claude/skills folder, so no MANDATORY binding resolves; degraded online', async () => {
    const dir = tree();
    fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
    const known = new Set(Object.keys(JSON.parse(read(dir, 'skills-lock.json')).skills || {}));
    const skills = new Set();
    for (const row of read(dir, 'CLAUDE.md')
      .split(/\r?\n/)
      .filter((l) => /^\|.*\|\s*MANDATORY\s*\|/.test(l)))
      for (const tok of row
        .split('|')
        .map((c) => c.trim())[2]
        .match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [])
        if (known.has(tok) || tok.includes('-')) skills.add(tok);
    assert.ok(skills.size > 0, 'fixture: CLAUDE.md has MANDATORY rows');
    const expected = [
      `FAILED V17: MANDATORY skill binding(s) do not resolve to a live .claude/skills link: ${[...skills].join(', ')}. Rebuild with: node scripts/bootstrap.mjs --repair-links (every platform - junctions on Windows, symlinks on macOS); a MANDATORY row must never point at a parked or missing skill.`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('PARITY dup-mandatory-parse: skills-json.js and skill-state.js agree on every MANDATORY row, over a plain table, a row with extra spaces, a non-MANDATORY row and an empty table', () => {
    // dup-mandatory-parse is SANCTIONED, not consolidated: skills-json.js's V17 reads the staged preview a
    // run is about to ship, and skill-state.js's parseMandatory only ever reads the file on disk, which is
    // the sanctioned reason the two stay separate copies. This holds their PARSE to one answer, so a change
    // to either one's regex, cell index or known/hyphenated rule is caught here instead of drifting silently.
    const skillsJson = require(path.join(KIT, 'scripts', 'lib', 'validate', 'skills-json.js'));
    const skillState = require(path.join(KIT, 'scripts', 'lib', 'skill-state.js'));
    const KNOWN = new Set(['pdf', 'pptx']);
    const CASES = {
      'a plain table': ['| Task | Skill(s) | Strength |', '|---|---|---|', '| a | pdf | MANDATORY |'].join('\n'),
      'a row with extra spaces': [
        '| Task | Skill(s) | Strength |',
        '|---|---|---|',
        '|   b   |   pdf   |   MANDATORY   |'
      ].join('\n'),
      'a non-MANDATORY row (mixed with a hyphenated MANDATORY one)': [
        '| Task | Skill(s) | Strength |',
        '|---|---|---|',
        '| a | pdf | ADVISORY |',
        '| b | some-hyphenated-thing | MANDATORY |'
      ].join('\n'),
      'an empty table': '# CLAUDE.md\n\nno Skill Bindings table here.\n'
    };
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-mandatory-parity-'));
    try {
      for (const [label, text] of Object.entries(CASES)) {
        fs.writeFileSync(path.join(probeRoot, 'CLAUDE.md'), text);
        const fromSkillsJson = [...skillsJson.mandatorySkillTokens(text, KNOWN)].sort();
        const fromSkillState = [...skillState.parseMandatory(probeRoot, KNOWN)].sort();
        assert.deepEqual(fromSkillsJson, fromSkillState, label);
      }
    } finally {
      fs.rmSync(probeRoot, { recursive: true, force: true });
    }
  });

  test('PINNED DEFECT R5-22: V15 cannot fail; a LIVE command file with no header and one with a drifted header are WARNINGS and the hook passes', async (t) => {
    const dir = tree();
    const genCmd = require(path.join(dir, 'scripts', 'lib', 'gen-command-headers.js'));
    const m = JSON.parse(read(dir, 'system/manifest.json'));
    const targets = genCmd
      .targets(m)
      .filter((x) => fs.existsSync(path.join(dir, x.rel)) && read(dir, x.rel).includes(genCmd.BEGIN));
    if (targets.length < 2) {
      t.skip('fewer than two LIVE/EVENT command files carry a header here');
      return;
    }
    const [a, b] = targets;
    const ta = read(dir, a.rel);
    write(dir, a.rel, ta.slice(0, ta.indexOf(genCmd.BEGIN)) + ta.slice(ta.indexOf(genCmd.END) + genCmd.END.length));
    const tb = read(dir, b.rel);
    write(dir, b.rel, tb.replace(`· ${b.project.state} ·`, '· PARKED ·'));
    for (const ctx of [LAPTOP, GENERATOR]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.failed, []);
      assert.ok(
        r.warnings.includes(
          `WARNING V15: LIVE/EVENT command file(s) missing the generated CMD-HEADER block: ${a.rel} - run 'node scripts/generate-alex.js'`
        ),
        r.stderr
      );
      assert.ok(
        r.warnings.includes(
          `WARNING V15: command header(s) drifted from system/manifest.json: ${b.rel} (state/trigger no longer matches #${b.project.num} in the registry) - run 'node scripts/generate-alex.js' (never hand-edit between the markers)`
        ),
        r.stderr
      );
    }
  });

  test('PINNED DEFECT R5-20: a linked directory whose name ends in .md under docs/ is read as a file, and the run dies as an internal error', async () => {
    const dir = tree();
    const link = path.join(dir, 'docs', 'zz-linked.md');
    fs.symlinkSync(path.join(dir, 'docs', 'projects'), link, process.platform === 'win32' ? 'junction' : 'dir');
    let message;
    try {
      fs.readFileSync(link);
    } catch (e) {
      message = e.message;
    }
    assert.ok(message, 'fixture: reading the link as a file throws');
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(lines(r.stderr), [`validate-alex: internal error: ${message}`]);
  });
});
