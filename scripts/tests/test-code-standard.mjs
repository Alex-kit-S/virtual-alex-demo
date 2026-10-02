#!/usr/bin/env node
// scripts/tests/test-code-standard.mjs - the checker of docs/CODE-STANDARD.md section 9.7, one test per leg.
//
// WHAT. Holds every file a finished wave put under the ratchet to the standard, prints every leg's
// count over the whole scope so each wave can be seen driving it down, and fails a wave that inverts a
// pinned-defect assertion the FIX list does not name. Deleted, it would let a finished file regain a
// diary comment, a dangling path, commented-out code or a lost header; let a sixth copy of a
// duplicated concern arrive unnoticed; let CommonJS require an ES module or a CLI lean on
// import.meta.main; let a rewrite flip, skip or unhook a pinned assertion with every other test green;
// and let a wave raise its own ceilings, drop a file from the enforced set or an export from
// docs/L2.json, in the same change that needed it.
//
// HOW. scripts/tests/code-standard.mjs measures and this file judges. Every leg is first shown
// refusing a violation built in a temp folder, then run over the real tree, where four rules apply.
// A counted leg fails when any one file's count rises above that file's ceiling in
// scripts/tests/code-standard-ratchet.json, whatever the other files did. Any finding in the enforced
// set (biome.json files.includes plus the ratchet's enforced list) fails even at its ceiling. The
// pinned leg fails on a pin whose body or run context changed with no FIX row for the ratchet's
// current wave, and on one that gained a reason not to run, whatever the FIX list says. A Python file
// Python reads in any encoding but UTF-8 fails by name. The direction leg compares the tree
// with a base: a ceiling that rose, the wave that moved, a path that left the enforced set, a file or
// export name that left docs/L2.json, a pin the base held that changed or stopped running, each fails
// unless a row new since the base names it. The base is --base, then CODE_STANDARD_BASE; in GitHub
// Actions origin/$GITHUB_BASE_REF on a pull request and HEAD~1 on a push; locally HEAD, the
// uncommitted change. With no base in the clone, one plain line says the direction was not proven.
// The operator modes belong to whoever accepts a wave's changes, never to CI: --record only tightens
// and prints as HELD what it will not record; every loosening needs --reason and writes a dated row.
//
// NEVER. Writes anything when it runs as a test: the checkout is only read, the synthetic cases live
// in a temp folder removed at the end, and a tree it cannot measure ends as one failing test before
// that folder exists. Runs or imports a file it scores, except the builder, whose planTree is the
// scope. Accepts an unknown flag, or a loosening with no reason: an operator CLI refuses both.
//
// Usage: node scripts/tests/test-code-standard.mjs [--base <ref>]
//        node scripts/tests/test-code-standard.mjs --report | --record [--enforce <path>]...
//        node scripts/tests/test-code-standard.mjs --raise <leg>[=<file>] | --fix <id>=<wave> |
//          --unfreeze pin:<id>|pin-context:<file>|enforced:<path>|l2:<path>[#<name>] | --wave <id> ...
//          --reason "<why>"
// Exit: 0 every leg holds, or the operator mode finished - 1 a leg failed, or a flag was refused

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import * as E from './code-standard.mjs';

const MIN_SCOPE = 100;
const LOOSENING = ['raise', 'fix', 'unfreeze', 'wave'];

function refuse(message) {
  console.error(`test-code-standard: REFUSED - ${message}`);
  return 1;
}

/** The parsed flags, or an exit code when they are refused. */
function flags(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        base: { type: 'string' },
        report: { type: 'boolean' },
        record: { type: 'boolean' },
        enforce: { type: 'string', multiple: true },
        raise: { type: 'string', multiple: true },
        fix: { type: 'string', multiple: true },
        unfreeze: { type: 'string', multiple: true },
        wave: { type: 'string' },
        reason: { type: 'string' }
      },
      strict: true,
      allowPositionals: false
    }));
  } catch (e) {
    return refuse(e.message);
  }
  const loosening = LOOSENING.filter((k) => values[k] !== undefined);
  const modes = [values.report && 'report', values.record && 'record', loosening.length && 'loosen'].filter(Boolean);
  if (modes.length > 1) return refuse(`--${modes.join(' and --')} are separate runs`);
  if (values.base !== undefined && modes.length)
    return refuse('--base belongs to the checker, not to an operator mode');
  if (values.enforce && !values.record) return refuse('--enforce goes with --record');
  if (loosening.length && (!values.reason || values.reason.trim().split(/\s+/).length < E.REASON_WORDS_MIN))
    return refuse(
      `--${loosening.join(', --')} writes a dated row, and a row needs --reason of ${E.REASON_WORDS_MIN} words or more`
    );
  if (values.reason !== undefined && !loosening.length)
    return refuse('--reason goes with --raise, --fix, --unfreeze or --wave');
  return values;
}

async function runOperator(values) {
  const ctx = await E.loadContext();
  const previous = E.readRatchet();
  if (values.report) {
    for (const l of E.allLegs(ctx, previous)) {
      console.log(`${l.name} ${l.count} ${l.unit}`);
      for (const f of l.findings) console.log(`  ${f.file}:${f.line} ${f.message}`);
      // Counted, never findings: the reads whose path the contract leg would not guess at.
      if (l.unresolved) {
        console.log(`  ${l.unresolved.length} reads whose path is not resolved`);
        for (const u of l.unresolved) console.log(`    ${u.reader}:${u.line} (${u.via}): ${u.why}`);
      }
      if (l.unseenPairs) {
        console.log(`  ${l.unseenPairs.length} unseen suppressions, each named`);
        for (const u of l.unseenPairs)
          console.log(`    ${u.file}:${u.line} under ${u.readers.join(', ')} (unseen: ${u.how.join('; ')})`);
      }
      if (l.copies) {
        console.log(`  ${l.copies.length} copies of a tracked file, each named with the line that proves it`);
        for (const c of l.copies) console.log(`    copy ${c.reader}:${c.line} -> ${c.target} (${c.via}): ${c.proof}`);
      }
      if (l.unseen) {
        console.log(`  ${l.unseen.length} unseen contracts, each named`);
        for (const u of l.unseen)
          console.log(
            `    ${u.file}:${u.line} names ${u.reader}:${u.from}${u.to !== u.from ? `-${u.to}` : ''} (unseen: ${u.how})`
          );
      }
      // Only a generated tree has any, so the Kit's report reads as it always has.
      if (l.kitOnly?.length) {
        console.log(
          `  ${l.kitOnly.length} tags whose reader only the Kit holds, each named; the Kit's run judges them`
        );
        for (const k of l.kitOnly)
          console.log(`    ${k.file}:${k.line} names ${k.reader}:${k.from}${k.to !== k.from ? `-${k.to}` : ''}`);
      }
    }
    return 0;
  }
  let data = previous;
  if (values.record) {
    const inScope = new Set(ctx.files.map((f) => f.src));
    for (const p of values.enforce || []) {
      if (!inScope.has(p)) return refuse(`--enforce ${p}: not a file in the scope this standard scores`);
      if (/\.(?:js|mjs|cjs)$/.test(p) && !/^scripts\/migrations\//.test(p))
        return refuse(`--enforce ${p}: a JavaScript file belongs in ${E.BIOME_REL} files.includes`);
    }
    const r = E.recordRatchet(ctx, previous, { enforce: values.enforce || [] });
    for (const h of r.held) console.log(`test-code-standard: HELD, not recorded: ${h}`);
    data = r.data;
  } else {
    const rows = [];
    const step = (r) => {
      rows.push(...r.rows);
      data = r.data;
    };
    if (values.wave) step(E.waveRatchet(data, values.wave, values.reason));
    if (values.fix) step(E.fixRatchet(data, values.fix, values.reason));
    if (values.unfreeze) step(E.unfreezeRatchet(ctx, data, values.unfreeze, values.reason));
    if (values.raise) step(E.raiseRatchet(ctx, data, values.raise, values.reason));
    for (const r of rows) console.log(`test-code-standard: ${JSON.stringify(r)}`);
  }
  const w = E.writeRatchet(E.REPO, data);
  console.log(`test-code-standard: ${E.RATCHET_REL} ${w.written ? w.reason : 'unchanged'} (${w.bytes} bytes)`);
  return 0;
}

const values = flags(process.argv.slice(2));
if (typeof values === 'number') process.exitCode = values;
else if (values.report || values.record || LOOSENING.some((k) => values[k] !== undefined)) {
  try {
    process.exitCode = await runOperator(values);
  } catch (e) {
    process.exitCode = refuse(
      e instanceof E.OperatorRefusal ? e.message : `the tree could not be measured: ${e.message}`
    );
  }
} else {
  await checker(values.base);
}

// ------------------------------------------------------------------------------------ the checker

async function checker(baseFlag) {
  // The tree is measured before the temp folder exists, so a tree the engine cannot read ends as one
  // failing test (exit 1, the header's Exit: line) and leaves nothing behind in the temp directory.
  let ctx;
  let ratchet;
  let enforced;
  let problems;
  let legs;
  let base;
  let direction;
  try {
    ctx = await E.loadContext();
    ratchet = E.readRatchet();
    ({ srcs: enforced, problems } = E.enforcedSet(ctx, ratchet));
    legs = new Map(E.allLegs(ctx, ratchet).map((l) => [l.name, l]));
    base = E.resolveBase(E.REPO, baseFlag);
    direction = base.sha ? E.directionFindings(ctx, ratchet, base) : null;
  } catch (e) {
    test('the checker can measure the tree it judges', () => {
      throw e;
    });
    return;
  }
  if (!base.sha && !base.explicit)
    console.log(
      `code-standard: direction: there was no base to compare (${base.ref}, for ${base.why}, is not in this clone), so the direction of the ratchet, biome.json and docs/L2.json was not proven`
    );
  const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-code-standard-')));
  after(() => fs.rmSync(TMP, { recursive: true, force: true }));
  let seq = 0;

  /** A context over synthetic files written into a fresh temp folder: {src: text or Buffer of exact bytes}. */
  function synth(files, extra = {}) {
    const root = path.join(TMP, `s${++seq}`);
    for (const [src, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, src)), { recursive: true });
      fs.writeFileSync(path.join(root, src), text);
    }
    const list = Object.keys(files)
      .map((src) => ({ src, dst: src, lang: E.languageOf(src) }))
      .filter((f) => f.lang);
    const py = E.pythonFacts(
      root,
      list.filter((f) => f.lang === 'python').map((f) => f.src)
    );
    const asText = (v) => (Buffer.isBuffer(v) ? v.toString('latin1') : v);
    const analysed = list.map((f) => E.analyze(f, asText(files[f.src]), py));
    return {
      root,
      isKit: false,
      files: analysed,
      bySrc: new Map(analysed.map((f) => [f.src, f])),
      tracked: new Set(Object.keys(files)),
      manifestPaths: new Set(),
      droppedPaths: new Set(),
      ...extra
    };
  }
  // Pinned the same way test-git.mjs pins its own child git calls: inherited GIT_* stripped (a run
  // under a hook or another repository's context must never leak in), git's own system and global
  // config unreachable, and a ceiling so git never walks up past this temp tree looking for a parent
  // repository.
  const GIT_CONFIG_GLOBAL = path.join(TMP, 'gitconfig');
  fs.writeFileSync(GIT_CONFIG_GLOBAL, '');
  const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL, GIT_CEILING_DIRECTORIES: TMP };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete GIT_ENV[k];
  /** Commit the context's files as a base in a git repo at its root; returns the resolved base. */
  function commitBase(s) {
    const g = (...a) => {
      const r = spawnSync('git', ['-C', s.root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], {
        encoding: 'utf8',
        env: GIT_ENV
      });
      assert.equal(r.status, 0, r.stderr);
    };
    g('init', '-q');
    g('add', '-A');
    g('commit', '-q', '--no-verify', '-m', 'base');
    return E.resolveBase(s.root, 'HEAD');
  }
  const HEAD = '// x.js - a file.\n//\n// WHAT. a.\n//\n// HOW. b.\n//\n// NEVER. c.\n';
  const PIN_HEAD = `${HEAD}import { test } from 'node:test';\n`;
  const REASON = 'named by the master';

  const dstOf = E.shippedPath(ctx);
  const ceilings = E.ceilingsOf(ratchet, dstOf);
  const SHOWN_ON_A_RISE = 40;
  function holds(name) {
    const l = legs.get(name);
    const total = [...ceilings].filter(([k]) => k.startsWith(`${name}\u0000`)).reduce((n, [, c]) => n + c, 0);
    console.log(`code-standard: ${l.name.padEnd(20)} ${String(l.count).padStart(4)} ${l.unit} (ceiling ${total})`);
    const failures = E.ceilingFailures(l, ceilings, enforced, dstOf);
    if (failures.length) {
      for (const f of failures.slice(0, SHOWN_ON_A_RISE)) console.log(`    ${f}`);
      if (failures.length > SHOWN_ON_A_RISE)
        console.log(`    ... ${failures.length - SHOWN_ON_A_RISE} more; --report lists every finding`);
    }
    assert.deepEqual(failures, []);
  }

  describe('the scope and the ratchet', () => {
    test('the scope is the code the online tree ships, and it is not empty', () => {
      assert.ok(ctx.files.length >= MIN_SCOPE, `${ctx.files.length} files; a vacuous scope passes every leg`);
      for (const lang of ['js', 'python', 'shell', 'ci'])
        assert.ok(
          ctx.files.some((f) => f.lang === lang),
          `no ${lang} file in scope`
        );
      assert.ok(
        ctx.files.every((f) => !f.dst.startsWith('.agents/')),
        'the vendored skills are outside the standard'
      );
      assert.ok(
        ctx.files.some((f) => f.dst === 'scripts/hooks/pre-commit'),
        'the online commit gate is scored at the path it ships at'
      );
      console.log(
        `code-standard: scope ${ctx.files.length} files (${ctx.isKit ? 'Kit' : 'generated tree'}), enforced ${enforced.size}, wave ${ratchet.current_wave}`
      );
    });
    test('every ratchet entry names a file the checker can score', () => {
      assert.deepEqual(problems, []);
    });
    test('the ratchet is well formed: one ceiling per leg and file, a wave, dated rows with reasons', () => {
      const names = new Set(E.countedLegs([...legs.values()]).map((l) => l.name));
      assert.deepEqual(E.ratchetProblems(ratchet, names), []);
      const bad = {
        ceilings: [
          { count: 2, file: 'a.js', leg: 'diary' },
          { count: 9999, file: 'a.js', leg: 'diary' },
          { count: 1, leg: 'diary' },
          { count: 0, file: 'b.js', leg: 'header' },
          { count: 1, file: 'c.js', leg: 'nope' }
        ],
        fingerprint_version: 1,
        fix_list: [{ id: 'X1', wave: '1' }],
        raises: [{ date: '2026-01-01', from: 0, to: 1, what: 'ceiling diary a.js', reason: 'x' }]
      };
      assert.deepEqual(
        E.ratchetProblems(bad, names).map((p) => p.split(' ').slice(0, 4).join(' ')),
        [
          'two diary ceiling rows',
          'a diary ceiling row',
          'the header ceiling of',
          'a ceiling row names',
          'the ratchet names no',
          'the pinned snapshot was',
          'the FIX row "X1"',
          'a raises row ("ceiling'
        ]
      );
    });
    test("a glob or a non-JavaScript path in Biome's list, a path outside the scope and a JavaScript path in the ratchet's list are refused", () => {
      const s = synth(
        {
          'scripts/a.js': HEAD,
          'scripts/c.py': '"""C."""\n',
          'biome.json': JSON.stringify({ files: { includes: ['scripts/*.js', 'scripts/a.js', 'scripts/c.py'] } })
        },
        { isKit: true }
      );
      const r = E.enforcedSet(s, { enforced: ['scripts/b.py', 'scripts/a.js'] });
      assert.equal(r.problems.length, 4, r.problems.join('\n'));
      assert.match(r.problems[0], /holds "scripts\/\*\.js"/);
      assert.match(r.problems[1], /names scripts\/c\.py, which is not JavaScript/);
      assert.match(r.problems[2], /names scripts\/b\.py, which is not in the scope/);
      assert.match(r.problems[3], /names scripts\/a\.js, a JavaScript file/);
      assert.deepEqual([...r.srcs], ['scripts/a.js']);
    });
  });

  describe('the Kit-only hook scope', () => {
    test("kitOnlyVariantPaths: a variant row's exact code path counts; a directory claim or a non-code path does not", () => {
      const components = [
        { online: 'variant', paths: ['scripts/hooks/pre-commit'] },
        { online: 'variant', paths: ['.claude/settings.json'] },
        { online: 'variant', paths: ['scheduler/'] },
        { online: 'variant', paths: ['CLAUDE.md', 'soul-core.md'] },
        { online: 'ship', paths: ['scripts/lib/args.js'] },
        { online: 'drop', paths: ['scripts/fleet/run.js'] }
      ];
      assert.deepEqual(E.kitOnlyVariantPaths(components), ['scripts/hooks/pre-commit', '.claude/settings.json']);
    });
    test('a diary line planted in the Kit hook counts under kit:scripts/hooks/pre-commit, never under the online path it is shadowed at', () => {
      const online = E.analyze(
        { src: 'variants/online/scripts/hooks/pre-commit', dst: 'scripts/hooks/pre-commit', lang: 'shell' },
        '#!/bin/sh\necho clean\n',
        new Map()
      );
      const kitOnly = E.analyze(
        { src: 'kit:scripts/hooks/pre-commit', dst: 'kit:scripts/hooks/pre-commit', lang: 'shell' },
        '#!/bin/sh\n# finding F12 lives here\necho clean\n',
        new Map()
      );
      const s = {
        files: [online, kitOnly],
        isKit: true,
        tracked: new Set(),
        manifestPaths: new Set(),
        droppedPaths: new Set()
      };
      assert.deepEqual(
        E.diaryLeg(s, { fix_list: [], pinned: [] }).findings.map((f) => `${f.file}:${f.line}`),
        ['kit:scripts/hooks/pre-commit:2']
      );
    });
    test("the real tree: in the Kit both of today's variant hooks are scored under kit:, read from the Kit's own file; a generated tree holds no kit: key and scores the hook at its shipped path instead", () => {
      const names = ctx.files.filter((f) => f.src.startsWith(E.KIT_ONLY_PREFIX)).map((f) => f.src);
      if (ctx.isKit) {
        assert.deepEqual(names.sort(), ['kit:.claude/settings.json', 'kit:scripts/hooks/pre-commit']);
      } else {
        assert.deepEqual(
          names,
          [],
          'a generated tree scores nothing under a kit: key: it has no variants/online/ of its own'
        );
        assert.ok(
          ctx.files.some((f) => f.src === 'scripts/hooks/pre-commit'),
          'the hook is in scope at the plain path a generated tree ships it at'
        );
      }
    });
    test('homesLeg strips kit: before asking git ls-files, so a kit:-prefixed sanctioned key is judged against the real path', () => {
      const s = { ...ctx, isKit: true };
      const planted = {
        id: 'zz-kit-sanction',
        home: [],
        sanctioned: { 'kit:scripts/hooks/pre-commit': 'named by the master' }
      };
      E.CONCERNS.push(planted);
      try {
        assert.deepEqual(E.homesLeg(s).findings, []);
      } finally {
        E.CONCERNS.length -= 1;
      }
      const phantom = {
        id: 'zz-kit-phantom',
        home: [],
        sanctioned: { 'kit:scripts/does-not-exist.sh': 'named by the master' }
      };
      E.CONCERNS.push(phantom);
      try {
        assert.deepEqual(
          E.homesLeg(s).findings.map((f) => f.file),
          ['kit:scripts/does-not-exist.sh']
        );
      } finally {
        E.CONCERNS.length -= 1;
      }
    });
  });

  describe('ceilings', () => {
    test('a file above its own ceiling fails, even when another file fell by as much; an enforced finding fails at its ceiling', () => {
      const l = {
        name: 'diary',
        unit: 'lines',
        count: 2,
        findings: [
          { file: 'b.js', line: 1, message: 'x' },
          { file: 'c.js', line: 1, message: 'y' }
        ]
      };
      const swap = new Map([
        ['diary\u0000a.js', 1],
        ['diary\u0000b.js', 1]
      ]);
      assert.deepEqual(
        E.ceilingFailures(l, swap, new Set()).map((f) => f.split(' is at')[0]),
        ['diary: c.js'],
        'a.js fell to 0 and c.js rose to 1: the total held at 2, and c.js still fails'
      );
      const held = new Map([
        ['diary\u0000b.js', 1],
        ['diary\u0000c.js', 1]
      ]);
      assert.deepEqual(E.ceilingFailures(l, held, new Set()), [], 'each file at its ceiling');
      assert.equal(E.ceilingFailures(l, held, new Set(['b.js'])).length, 1, 'at its ceiling, inside the enforced set');
    });
    test('a ceiling is keyed by the path a file ships at, so the Kit and a generated tree read one row alike', () => {
      const hook = 'scripts/hooks/pre-commit';
      const kit = E.shippedPath({ files: [{ src: `variants/online/${hook}`, dst: hook }] });
      const inKit = {
        name: 'header',
        unit: 'files',
        count: 1,
        findings: [{ file: `variants/online/${hook}`, line: 1 }]
      };
      const online = { ...inKit, findings: [{ file: hook, line: 1 }] };
      const row = (file) => ({ ceilings: [{ count: 1, file, leg: 'header' }] });
      assert.deepEqual(E.ceilingFailures(inKit, E.ceilingsOf(row(hook), kit), new Set(), kit), [], 'the Kit');
      assert.deepEqual(E.ceilingFailures(online, E.ceilingsOf(row(hook)), new Set()), [], 'a generated tree');
      assert.deepEqual(
        E.ceilingFailures(inKit, E.ceilingsOf(row(`variants/online/${hook}`), kit), new Set(), kit),
        [],
        'a row written under the Kit path is read at the path it ships at'
      );
    });
  });

  describe('the operator modes never raise without a row', () => {
    const tree = (lines) =>
      synth({
        'scripts/a.js': `${HEAD}const x = 1;\n${lines.join('\n')}\n`,
        'scripts/tests/test-p.mjs': `${PIN_HEAD}test('PINNED DEFECT K1: kept', () => { assert.equal(f(), 1); });\n`
      });
    const start = (s) => ({
      ceilings: [{ count: 2, file: 'scripts/a.js', leg: 'diary' }],
      current_wave: 'A1',
      enforced: [],
      fingerprint_version: E.FINGERPRINT_VERSION,
      fix_list: [{ date: '2026-09-25', id: 'K2', reason: 'fixed in wave two', wave: '2' }],
      pinned: E.collectPinned(s).map((p) => ({ ...p, stops: p.stops })),
      raises: [],
      unfrozen: []
    });
    test('--record lowers a ceiling and holds a raise, a new file and a changed pin; it never writes them', () => {
      const s0 = tree(['// 2026-01-01', '// 2026-01-02']);
      const prev = start(s0);
      const lower = E.recordRatchet(tree(['// 2026-01-01']), prev);
      assert.deepEqual(lower.data.ceilings, [{ count: 1, file: 'scripts/a.js', leg: 'diary' }]);
      assert.deepEqual(lower.held, []);
      const s1 = synth({
        'scripts/a.js': `${HEAD}const x = 1;\n// 2026-01-01\n// 2026-01-02\n// 2026-01-03\n`,
        'scripts/b.js': `${HEAD}const y = 1;\n// 2026-01-04\n`,
        'scripts/tests/test-p.mjs': `${PIN_HEAD}test('PINNED DEFECT K1: kept', () => { assert.equal(f(), 0); });\n`
      });
      const r = E.recordRatchet(s1, prev);
      assert.deepEqual(r.data.ceilings, prev.ceilings, 'nothing rose in the record');
      assert.deepEqual(r.data.pinned, prev.pinned, 'the changed pin stays as recorded');
      assert.deepEqual(
        r.held.map((h) => h.split(':')[0]),
        ['ceiling diary scripts/a.js', 'ceiling diary scripts/b.js', 'pin scripts/tests/test-p.mjs ']
      );
    });
    test('--raise, --fix, --unfreeze and --wave each write one dated row naming what moved, from what, to what', () => {
      const s0 = tree(['// 2026-01-01', '// 2026-01-02']);
      const prev = start(s0);
      const s1 = synth({
        'scripts/a.js': `${HEAD}const x = 1;\n// 2026-01-01\n// 2026-01-02\n// 2026-01-03\n`,
        'scripts/tests/test-p.mjs': `${PIN_HEAD}test('PINNED DEFECT K1: kept', () => { assert.equal(f(), 0); });\n`
      });
      const raised = E.raiseRatchet(s1, prev, ['diary'], REASON, '2026-09-26');
      assert.deepEqual(raised.rows, [
        { date: '2026-09-26', from: 2, reason: REASON, to: 3, what: 'ceiling diary scripts/a.js' }
      ]);
      assert.throws(() => E.raiseRatchet(s0, prev, ['diary'], REASON), E.OperatorRefusal, 'nothing rose');
      assert.throws(() => E.raiseRatchet(s0, prev, ['nope'], REASON), E.OperatorRefusal, 'not a leg');
      const fixed = E.fixRatchet(prev, ['K1=A1'], REASON, '2026-09-26');
      assert.deepEqual(fixed.rows, [{ date: '2026-09-26', id: 'K1', reason: REASON, wave: 'A1' }]);
      assert.throws(() => E.fixRatchet(prev, ['K2=2'], REASON), E.OperatorRefusal, 'already listed for that wave');
      const unfrozen = E.unfreezeRatchet(s1, prev, ['pin:K1', 'l2:scripts/x.js#run'], REASON, '2026-09-26');
      assert.deepEqual(
        unfrozen.rows.map((r) => [r.what, r.to === 'removed' ? 'removed' : 'moved']),
        [
          ['pin scripts/tests/test-p.mjs :: PINNED DEFECT K1: kept', 'moved'],
          ['l2 scripts/x.js run', 'removed']
        ]
      );
      assert.throws(() => E.unfreezeRatchet(s0, prev, ['pin:K1'], REASON), E.OperatorRefusal, 'K1 did not move');
      const waved = E.waveRatchet(prev, '2', REASON, '2026-09-26');
      assert.deepEqual(waved.rows, [{ date: '2026-09-26', from: 'A1', reason: REASON, to: '2', what: 'current_wave' }]);
      assert.deepEqual([...E.licensedIds(waved.data)], ['K2'], 'wave 2 licenses K2, and wave A1 never did');
    });
  });

  describe('direction', () => {
    const files = (diary, pinBody, extra = {}) => ({
      'scripts/a.js': `${HEAD}${diary}`,
      'scripts/tests/test-p.mjs': `test('PINNED DEFECT K1: kept', () => { ${pinBody} });\n`,
      'docs/L2.json': JSON.stringify({ files: [{ path: 'scripts/a.js', exports: [{ name: 'run' }] }] }),
      'biome.json': JSON.stringify({ files: { includes: ['scripts/a.js'] } }),
      ...extra
    });
    const ratchetOf = (s, over = {}) => ({
      _schema: E.RATCHET_SCHEMA,
      ceilings: [{ count: 1, file: 'scripts/a.js', leg: 'diary' }],
      current_wave: 'A1',
      enforced: ['scripts/b.sh'],
      fingerprint_version: E.FINGERPRINT_VERSION,
      fix_list: [],
      pinned: E.collectPinned(s),
      raises: [],
      unfrozen: [],
      ...over
    });
    test('refuses a raise, a shrink and a removal with no new row naming it, and passes each once named', () => {
      const s = synth(files('// 2026-01-01\n', 'assert.equal(f(), 1);'));
      const was = ratchetOf(s);
      fs.writeFileSync(path.join(s.root, E.RATCHET_REL), `${JSON.stringify(was)}\n`);
      const base = commitBase(s);
      assert.deepEqual(E.directionFindings(s, was, base).findings, [], 'nothing moved');
      fs.writeFileSync(path.join(s.root, 'docs/L2.json'), JSON.stringify({ files: [] }));
      fs.writeFileSync(path.join(s.root, 'biome.json'), JSON.stringify({ files: { includes: [] } }));
      fs.writeFileSync(
        path.join(s.root, 'scripts/tests/test-p.mjs'),
        "test.skip('PINNED DEFECT K1: kept', () => { assert.equal(f(), 0); });\n"
      );
      const moved = synth(files('// 2026-01-01\n', 'assert.equal(f(), 0);'));
      moved.root = s.root;
      moved.files = moved.files.map((f) =>
        f.src === 'scripts/tests/test-p.mjs'
          ? E.analyze(f, "test.skip('PINNED DEFECT K1: kept', () => { assert.equal(f(), 0); });\n", new Map())
          : f
      );
      const head = ratchetOf(s, {
        ceilings: [{ count: 5, file: 'scripts/a.js', leg: 'diary' }],
        current_wave: '2',
        enforced: [],
        pinned: [],
        // A FIX row for another id: K1's own would license the dropped snapshot row (the next test).
        fix_list: [{ date: '2026-09-26', id: 'K9', reason: REASON, wave: '2' }]
      });
      assert.deepEqual(
        E.directionFindings(moved, head, base).findings.map((f) => f.split(',')[0]),
        [
          'the diary ceiling of scripts/a.js rose from 1 to 5',
          'the current wave moved from A1 to 2',
          'the snapshot dropped scripts/tests/test-p.mjs :: PINNED DEFECT K1: kept',
          'scripts/b.sh left the enforced set',
          'scripts/a.js left the enforced set',
          'scripts/a.js left docs/L2.json',
          'PINNED DEFECT K1 in scripts/tests/test-p.mjs no longer runs (test.skip) since HEAD'
        ]
      );
      const row = (what, from, to) => ({ date: '2026-09-26', from, reason: REASON, to, what });
      const named = {
        ...head,
        raises: [row('ceiling diary scripts/a.js', 1, 5), row('current_wave', 'A1', '2')],
        unfrozen: [
          row('pin scripts/tests/test-p.mjs :: PINNED DEFECT K1: kept', 'x', 'removed'),
          row('enforced scripts/b.sh', 'enforced', 'not enforced'),
          row('enforced scripts/a.js', 'enforced', 'not enforced'),
          row('l2 scripts/a.js', 'frozen', 'removed')
        ]
      };
      assert.deepEqual(E.directionFindings(moved, named, base).findings, [], 'every move named');
      const wrong = { ...named, raises: [row('ceiling diary scripts/a.js', 1, 4), row('current_wave', 'A1', '2')] };
      assert.equal(E.directionFindings(moved, wrong, base).findings.length, 1, 'a row must name from and to exactly');
    });
    test('a FIX row for the current wave licenses a changed pin; one for another wave does not', () => {
      const s = synth(files('', 'assert.equal(f(), 1);'));
      const base = commitBase(s);
      const text = "test('PINNED DEFECT K1: kept', () => { assert.equal(f(), 0); });\n";
      fs.writeFileSync(path.join(s.root, 'scripts/tests/test-p.mjs'), text);
      const flipped = {
        ...s,
        files: s.files.map((f) => (f.src.endsWith('test-p.mjs') ? E.analyze(f, text, new Map()) : f))
      };
      const fix = (wave) =>
        ratchetOf(s, { ceilings: [], fix_list: [{ date: '2026-09-26', id: 'K1', reason: REASON, wave }] });
      assert.deepEqual(E.directionFindings(flipped, fix('A1'), base).findings, []);
      assert.equal(E.directionFindings(flipped, fix('11'), base).findings.length, 1);
    });
    test('a snapshot row dropped under a FIX row for the current wave needs no unfrozen row; one with no FIX row still does', () => {
      const pins = [
        "test('PINNED DEFECT K1: fixed and gone', () => { assert.equal(f(), 1); });",
        "test('PINNED DEFECT K2: dropped with no row', () => { assert.equal(f(), 2); });",
        "test('PINNED DEFECT K3 and K4: one id listed', () => { assert.equal(f(), 3); });"
      ];
      const s = synth(files('', 'assert.equal(f(), 1);', { 'scripts/tests/test-q.mjs': `${pins.join('\n')}\n` }));
      const fixRows = [
        { date: '2026-09-26', id: 'K1', reason: REASON, wave: 'A1' },
        { date: '2026-09-26', id: 'K3', reason: REASON, wave: 'A1' }
      ];
      const was = ratchetOf(s, { ceilings: [], fix_list: fixRows });
      fs.writeFileSync(path.join(s.root, E.RATCHET_REL), `${JSON.stringify(was)}\n`);
      const base = commitBase(s);
      const head = { ...was, pinned: was.pinned.filter((p) => p.file !== 'scripts/tests/test-q.mjs') };
      assert.deepEqual(
        E.directionFindings(s, head, base).findings.map((f) => f.split(',')[0]),
        [
          'the snapshot dropped scripts/tests/test-q.mjs :: PINNED DEFECT K2: dropped with no row',
          'the snapshot dropped scripts/tests/test-q.mjs :: PINNED DEFECT K3 and K4: one id listed'
        ],
        'K1 is licensed by its FIX row; K2 has none; K3 and K4 needs a row for every id it pins'
      );
    });
    // With no base in the clone there is no test here at all, only the plain line printed above: a
    // passing test would claim a direction nobody compared.
    if (base.sha)
      test(`the tree: nothing moved the wrong way since ${base.ref} without a row naming it`, (t) => {
        for (const n of direction.notes) console.log(`code-standard: direction: ${n}`);
        console.log(
          `code-standard: direction against ${base.ref} (${base.sha.slice(0, 12)}, ${base.why}): ${direction.findings.length} moved without a row`
        );
        for (const f of direction.findings) t.diagnostic(f);
        assert.deepEqual(direction.findings, []);
      });
    else if (base.explicit)
      test(`the base ${base.ref} names a commit in this clone`, () => {
        assert.fail(`${base.ref}, from ${base.why}, does not resolve here, so the direction cannot be proven`);
      });
  });

  describe('reading legal code', () => {
    test('a regular expression after an if head and a CRLF line continuation lex; a division after a call stays one', () => {
      const toks = E.lexJs('if (ok) /\\s/.test(v) && go();\nwhile (a) /x/.exec(b);\nconst half = f(x) / 2 / 1;\n');
      assert.deepEqual(
        toks.filter((t) => t.t === 'regex').map((t) => t.v),
        ['/\\s/', '/x/']
      );
      const crlf = E.lexJs("const MSG = 'first half \\\r\nsecond half';\r\nconst T = `a \\\r\nb`;\r\nconst B = 1;\r\n");
      assert.deepEqual(
        crlf.filter((t) => t.t === 'string').map((t) => t.v),
        ['first half second half']
      );
      assert.equal(crlf.find((t) => t.v === 'B').line, 5);
    });
    test('a Python file that opens with a byte order mark is read, as Python reads it', () => {
      const s = synth({ 'scripts/a.py': '\uFEFF"""A.\n\nWHAT. a.\n\nHOW. b.\n\nNEVER. c.\n"""\nX = 1\n' });
      assert.deepEqual(E.headerLeg(s).findings, []);
    });
    test('a form feed, a vertical tab, NEL or a line separator above it does not move a Python line of code', () => {
      const head = '"""WHAT. a.\nHOW. b.\nNEVER. c.\n"""\n';
      const cli =
        'import sys\n\n\ndef main():\n    return 0\n\n\nif __name__ == "__main__":\n    # run the command line and exit with its code, the way every script here does\n    sys.exit(main())\n';
      const exit =
        'import sys\n\n\ndef main():\n    sys.exit(2)\n    # the refusal code of section 5.2, which lists every file that uses it\n    return 0\n';
      const s = synth({
        'scripts/ff.py': `${head}x = 1\n\f\n${cli}`,
        'scripts/vt.py': `${head}x = 1  # a vertical tab \v here\n${cli}`,
        'scripts/nel.py': `${head}# a note\u0085with a NEL in it\n${cli}`,
        'scripts/ls.py': `${head}PAGE = 'a\u2028b'\n${cli}`,
        'scripts/ps.py': `${head}PAGE = 'a\u2029b'\n${cli}`,
        'scripts/fs.py': `${head}# a file separator \x1c here\n${cli}`,
        'scripts/exit.py': `${head}\f\n${exit}`
      });
      for (const f of s.files) {
        assert.equal(
          f.code.split('\n').length,
          f.text.split('\n').length,
          `${f.src}: one line of code per line of the file`
        );
        assert.doesNotMatch(f.code, /run the command line|refusal code/, `${f.src}: the comment is out of the code`);
      }
      assert.deepEqual(
        s.files.filter((f) => /__name__\s*==\s*"__main__"/.test(f.code)).map((f) => f.src),
        ['scripts/ff.py', 'scripts/vt.py', 'scripts/nel.py', 'scripts/ls.py', 'scripts/ps.py', 'scripts/fs.py']
      );
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-exit-two')
          .findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/exit.py:10']
      );
    });
    test('a Python main guard counts however it is spelled: reversed, by in, by __eq__, in parentheses', () => {
      const head = '"""WHAT. a.\nHOW. b.\nNEVER. c.\n"""\n';
      const guards = [
        'if __name__ == "__main__":\n    main()\n',
        'if "__main__" == __name__:\n    main()\n',
        'if __name__ in ("__main__",):\n    main()\n',
        'if __name__ == ("__main__"):\n    main()\n',
        'if __name__.__eq__("__main__"):\n    main()\n',
        'main() if __name__ == "__main__" else None\n',
        'GUARD = \'if __name__ == "__main__":\'\n'
      ];
      const s = synth(Object.fromEntries(guards.map((g, k) => [`scripts/g${k}.py`, `${head}${g}`])));
      assert.deepEqual(
        s.files.map((f) => E.isCli(f)),
        [true, true, true, true, true, true, false],
        'the last one only names a guard inside a string'
      );
    });
    test('a Python file in another encoding is measured and named; one Python cannot decode, parse or walk fails naming itself', () => {
      const head = Buffer.from('# -*- coding: latin-1 -*-\n"""WHAT. a.\nHOW. b.\nNEVER. c.\n"""\n');
      const s = synth({
        'scripts/latin.py': Buffer.concat([
          head,
          Buffer.from([0x43, 0x49, 0x54, 0x59, 0x20, 0x3d, 0x20, 0x27, 0x47, 0xf6, 0x27, 0x0a])
        ]),
        'scripts/plain.py': '"""WHAT. a.\nHOW. b.\nNEVER. c.\n"""\nX = 1\n'
      });
      assert.deepEqual(E.headerLeg(s).findings, [], 'the latin-1 file was read, header and all');
      assert.deepEqual(E.encodingFindings(s), [
        { file: 'scripts/latin.py', line: 1, message: 'Python reads it as iso-8859-1, not UTF-8' }
      ]);
      const root = path.join(TMP, `s${++seq}`);
      const chain = Array.from({ length: 3000 }, (_, k) => `'${k}'`).join(' + ');
      // A NUL on the first line reaches Python 3.14's coding-cookie reader, one on a later line only the parser,
      // and one behind a byte order mark both; the helper names each the same way on every interpreter.
      const files = {
        'scripts/nul.py': Buffer.from([0x78, 0x20, 0x3d, 0x20, 0x27, 0x00, 0x27, 0x0a]),
        'scripts/nul3.py': Buffer.concat([
          Buffer.from('x = 1\r\ny = 2\n# a NUL '),
          Buffer.from([0x00]),
          Buffer.from('\n')
        ]),
        'scripts/nulbom.py': Buffer.from([0xef, 0xbb, 0xbf, 0x78, 0x20, 0x3d, 0x20, 0x27, 0x00, 0x27, 0x0a]),
        'scripts/bad.py': Buffer.from([0x78, 0x20, 0x3d, 0x20, 0x27, 0xf6, 0x27, 0x0a]),
        'scripts/deep.py': `import unittest\n\n\nclass T(unittest.TestCase):\n    def test_long_PINNED_DEFECT_Z1(self):\n        self.assertTrue(${chain})\n`,
        'scripts/fine.py': 'X = 1\n'
      };
      for (const [src, bytes] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, src)), { recursive: true });
        fs.writeFileSync(path.join(root, src), bytes);
      }
      const helper = spawnSync(E.findPython(), [path.join(E.REPO, E.PY_HELPER_REL), ...Object.keys(files)], {
        cwd: root,
        encoding: 'utf8'
      });
      assert.equal(helper.status, 0, `one spawn measures them all, no traceback: ${helper.stderr}`);
      const report = JSON.parse(helper.stdout);
      const nul = (line) => `cannot parse it: a NUL byte on line ${line}, which Python refuses in source code`;
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(report).map(([src, f]) => [
            src,
            f.error?.includes('NUL') ? f.error : (f.error ?? 'measured').split(':')[0]
          ])
        ),
        {
          'scripts/nul.py': nul(1),
          'scripts/nul3.py': nul(3),
          'scripts/nulbom.py': nul(1),
          'scripts/bad.py': 'cannot decode it',
          'scripts/deep.py': 'it nests deeper than this checker can walk',
          'scripts/fine.py': 'measured'
        }
      );
      assert.throws(() => E.pythonFacts(root, Object.keys(files)), /^Error: scripts\/nul\.py: cannot parse it/);
    });
    test('the tree: every Python file is UTF-8, the one encoding the standard and ruff read', () => {
      assert.deepEqual(
        E.encodingFindings(ctx).map((f) => `${f.file}: ${f.message}`),
        []
      );
    });
  });

  describe('header', () => {
    test('refuses a file with no WHAT/HOW/NEVER header, and a Python module docstring without one', () => {
      const s = synth({ 'scripts/a.js': '// a file.\n', 'scripts/b.js': HEAD, 'scripts/c.py': '"""No header."""\n' });
      assert.deepEqual(
        E.headerLeg(s).findings.map((f) => f.file),
        ['scripts/a.js', 'scripts/c.py']
      );
    });
    test('the tree: the header count does not rise, and no enforced file lacks the header', () => holds('header'));
    test('refuses a CLI whose header has no Usage: and Exit:, whichever way its main guard is spelled', () => {
      const s = synth({
        'scripts/a.js': `#!/usr/bin/env node\n${HEAD}`,
        'scripts/b.js': `#!/usr/bin/env node\n${HEAD}// Usage: node b.js\n// Exit: 0 ok\n`,
        'scripts/c.mjs': `${HEAD}import { pathToFileURL } from 'node:url';\nif (import.meta.url === pathToFileURL(process.argv[1]).href) main();\n`,
        'scripts/d.js': `${HEAD}if (process.argv[1] === __filename) main();\n`,
        'scripts/e.mjs': `${HEAD}if (fileURLToPath(import.meta.url) === process.argv[1]) main();\n`,
        'scripts/f.js': `${HEAD}const script = process.argv[1];\nmodule.exports = { script };\n`
      });
      assert.deepEqual(
        E.headerCliLeg(s).findings.map((f) => f.file),
        ['scripts/a.js', 'scripts/c.mjs', 'scripts/d.js', 'scripts/e.mjs']
      );
    });
    test('the home of isMain defines the name without being a CLI; a file that calls it is one, and so is that home run by a shebang', () => {
      const home = `${HEAD}function isMain(self) { return self === process.argv[1]; }\nmodule.exports = { isMain };\n`;
      const caller = `${HEAD}const { isMain } = require('./lib/errors');\nif (isMain(__filename)) main();\n`;
      const s = synth({ 'scripts/lib/errors.js': home, 'scripts/caller.js': caller });
      assert.deepEqual(
        E.headerCliLeg(s).findings.map((f) => f.file),
        ['scripts/caller.js']
      );
      const run = synth({ 'scripts/lib/errors.js': `#!/usr/bin/env node\n${home}` });
      assert.deepEqual(
        E.headerCliLeg(run).findings.map((f) => f.file),
        ['scripts/lib/errors.js']
      );
    });
    test('the tree: the header-cli count does not rise, and no enforced CLI lacks Usage: and Exit:', () =>
      holds('header-cli'));
  });

  describe('diary', () => {
    const NO_IDS = { fix_list: [], pinned: [] };
    test('refuses a date, a seat and a finding id in comments and in a Python docstring; a contract: tag is exempt', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}const a = 1; // fixed 2026-09-01\n// contract: read as text by scripts/tests/test-x.mjs:4, since 2026-09-02\n// contract: kept after the 2026-09-03 incident\n`,
        'scripts/b.sh': '#!/bin/sh\n# seat 3 found this\necho "2026-09-01 is data"\n',
        'scripts/c.py': '"""Doc.\n\nfinding 12 lives here.\n"""\n# fleet seat note\nX = "2026-09-01"\n'
      });
      assert.deepEqual(
        E.diaryLeg(s, NO_IDS).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:8', 'scripts/a.js:10', 'scripts/b.sh:2', 'scripts/c.py:5', 'scripts/c.py:3']
      );
    });
    test("a date in the header's NEVER. paragraph is exempt; one in WHAT. or HOW., or below the header, is not", () => {
      const header = (c) =>
        `${c} x - a file.\n${c}\n${c} WHAT. Made on 2026-09-01.\n${c}\n${c} HOW. b.\n${c}\n${c} NEVER. Keeps the old order (the 2026-09-23 push\n${c} broke on it).\n${c}\n${c} Usage: module only\n`;
      const s = synth({
        'scripts/a.js': `${header('//')}const a = 1; // 2026-09-02\n`,
        'scripts/b.sh': `#!/bin/sh\n${header('#')}echo ok # seat 3\n`,
        'scripts/c.py':
          '"""c.py - a file.\n\nWHAT. finding 12.\n\nHOW. b.\n\nNEVER. Keeps it (finding 13).\n\nUsage: module only\n"""\nX = 1\n'
      });
      assert.deepEqual(
        E.diaryLeg(s, NO_IDS).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:3', 'scripts/a.js:11', 'scripts/b.sh:4', 'scripts/b.sh:12', 'scripts/c.py:3']
      );
    });
    test('a Python module docstring whose text lines are not its source lines exempts nothing below it', () => {
      const tail = 'x = 1\ny = 2  # 2026-09-20 a diary line below the header\nz = 3  # finding F12 another\n';
      const s = synth({
        'scripts/lines.py': `"""WHAT. a one-line header\nHOW. by lines\nNEVER. do this\n"""\n${tail}`,
        'scripts/escapes.py': `"""WHAT. a one-line header\\nHOW. by escapes\\nNEVER. do this\\nq\\nr\\ns\\nt\\nu"""\n${tail}`,
        'scripts/kept.py': '"""WHAT. a.\nHOW. b.\nNEVER. c (finding 13).\n"""\nX = 1\n'
      });
      assert.deepEqual(
        E.diaryLeg(s, NO_IDS).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/lines.py:6', 'scripts/lines.py:7', 'scripts/escapes.py:3', 'scripts/escapes.py:4']
      );
    });
    test("the ratchet's own fix and pinned ids are diary too, minus a bare letter-plus-digits id, plus the fixed phrases", () => {
      const ratchet = { fix_list: [{ id: 'HB-D3' }, { id: 'T1' }], pinned: [{ ids: ['RL-D3', 'D1'] }] };
      const s = synth({
        'scripts/a.js': `${HEAD}const x = 1;\n// HB-D3 RL-D3 CO-EDGE PR-D1 AS-SM1 S7 B7 F11 (review-w6, read seat R5, hotfix 9, at fd41fcf)\n`,
        'scripts/b.js': `${HEAD}const x = 1;\n// T1 and D1 are leg labels on their own, not diary: nothing here should fire\n`
      });
      assert.deepEqual(
        E.diaryLeg(s, ratchet).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:9']
      );
    });
    test("the widened phrase list catches the build effort's own name for itself, whoever runs the ratchet's operator commands, a wave number, a background report, read-r/char-c tokens and the four planning-document names; a bare seat or seats stays clear", () => {
      const s = synth({
        'scripts/a.js':
          `${HEAD}const x = 1;\n` +
          '// this relay built the walls below\n' +
          '// the master decides when a change ships\n' +
          '// wave 12 added this helper\n' +
          '// see the dossier for the full picture\n' +
          '// read-r3 covers this path\n' +
          '// char-c4 mutated this branch\n' +
          '// review-p5 raised this question\n' +
          '// FIX-P5 lists the row for this\n' +
          '// REWRITE-PLAN names this file\n' +
          "// RUN-STATE records today's run\n" +
          '// four tests across three seats passed\n'
      });
      assert.deepEqual(
        E.diaryLeg(s, NO_IDS).findings.map((f) => f.line),
        [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
      );
    });
    test('a title opening with a well-formed defect tag is exempt whole; the same tag elsewhere in a title, or a diary id, is a finding', () => {
      const ratchet = { fix_list: [], pinned: [{ ids: ['R6-22'] }] };
      const s = synth({
        'scripts/tests/test-a.mjs':
          `${PIN_HEAD}test('PINNED DEFECT R6-22: a known defect holds, review-w6 and all', () => {});\n` +
          `test('R6-22 PINNED DEFECT mid-title', () => {});\n` +
          `test('this title cites R6-22 in prose', () => {});\n` +
          `test('a clean title', () => {});\n`
      });
      assert.deepEqual(
        E.diaryLeg(s, ratchet).findings.map((f) => f.line),
        [10, 11]
      );
    });
    test('a local helper that hands its own parameter straight to test() carries the title at its call site too', () => {
      const s = synth({
        'scripts/tests/test-b.mjs':
          `${PIN_HEAD}function denyCase(name) { test(\`DENY \${name}\`, () => {}); }\n` +
          `denyCase('read seat R5 finds this one');\n` +
          `denyCase('a clean case');\n`
      });
      assert.deepEqual(
        E.diaryLeg(s, NO_IDS).findings.map((f) => f.line),
        [10]
      );
    });
    test('the tree: the diary count does not rise, and no enforced file carries a diary line', () => holds('diary'));
  });

  describe('dangling', () => {
    test('refuses a comment naming a script this tree does not hold, and passes one it does', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}// see scripts/b.js and scripts/gone.ps1 and lib/c.js\n// and scripts\\lib\\c.js, scripts\\gone.js\n// vendor/scripts/b.js, scripts/B.js\n`,
        'scripts/b.js': HEAD,
        'scripts/lib/c.js': HEAD
      });
      assert.deepEqual(
        E.danglingLeg(s).findings.map((f) => f.message),
        [
          'names scripts/gone.ps1, which this tree does not hold',
          'names scripts\\gone.js, which this tree does not hold',
          'names vendor/scripts/b.js, which this tree does not hold',
          'names scripts/B.js, which this tree does not hold'
        ]
      );
    });
    test('reads a Python docstring the same way it reads a comment', () => {
      const s = synth({
        'scripts/a.py': '"""WHAT. a.\nHOW. names scripts/heading_rules.py here.\nNEVER. b.\n"""\nX = 1\n'
      });
      assert.deepEqual(
        E.danglingLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.py:2']
      );
    });
    test('resolves a path rooted at a placeholder like <scratchpad> or <tree> by its remainder', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}const x = 1;\n// see <scratchpad>/master/no-such-blocker.cjs and <tree>/scripts/b.js\n`,
        'scripts/b.js': HEAD
      });
      assert.deepEqual(
        E.danglingLeg(s).findings.map((f) => f.message),
        ['names master/no-such-blocker.cjs, which this tree does not hold']
      );
    });
    test('the tree: the dangling count does not rise, and no enforced file names a missing script', () =>
      holds('dangling'));
  });

  describe('commented-out', () => {
    test('refuses commented-out statements, alone or as a block, and passes prose that happens to parse', () => {
      const body = [
        '//   const x = run(a);',
        'const a = 1;',
        '// const x = foo(bar);',
        'const b = 2;',
        '// verify-after-write',
        'const c = 3;',
        '// if (a) {',
        '//   b();',
        '// }',
        '/* return run(a, b); */',
        '// console.log(lines)',
        '// see schedule.md (uppercase-only)',
        '// await fs.promises.rm(P, { force: true });',
        "// import { step } from './next.mjs';",
        '// global.__alexLog = lines;',
        '/* global describe, it */',
        '/**',
        ' * @example',
        ' * const row = parseRow(line);',
        ' */',
        '/*',
        'async function flushAll() {',
        '',
        '  await flush();',
        '}',
        '*/',
        'const d = 4;'
      ];
      const s = synth({ 'scripts/a.js': `${HEAD}${body.join('\n')}\n` });
      assert.deepEqual(
        E.commentedOutLeg(s).findings.map((f) => f.line),
        [10, 14, 15, 16, 17, 18, 20, 21, 22, 29, 31, 32],
        'the header (line 8) and the JSDoc example (26) are documentation; prose (12, 19), a global list (23) and a blank line (30) are not code'
      );
    });
    test('the tree: the commented-out count does not rise, and no enforced file carries any', () =>
      holds('commented-out'));
  });

  describe('contract', () => {
    test('refuses a text read with no tag naming its reader and line, a tag naming no read, and a tag with no reader', () => {
      const reader = [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import { readFile as readText } from 'node:fs/promises';",
        "import { execFileSync as run2 } from 'node:child_process';",
        "const ROOT = '.';",
        "fs.readFileSync(path.join(ROOT, 'scripts', 'a.js'), 'utf8');",
        "fs.readFileSync(path.join(ROOT, 'scripts', 'b.js'), 'utf8');",
        "fs.readFileSync(path.join(ROOT, 'scripts', 'c.js'), 'utf8');",
        "fs.readFileSync(path.join(ROOT, 'scripts', 'd.js'), 'utf8');",
        "await readText(path.join(ROOT, 'scripts', 'e.js'), 'utf8');",
        "fs.createReadStream('scripts/f.js');",
        "const load = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');",
        "load('scripts/g.js');",
        "run2('git', ['show', 'HEAD:scripts/h.js']);",
        "const inDir = (name) => fs.readFileSync(path.join(ROOT, 'scripts', 'deep', name), 'utf8');",
        "const lines = (name) => inDir(name).split('\\n');",
        "lines('i.js');"
      ].join('\n');
      const tag = (t) => `${HEAD}// contract: ${t}\n`;
      const s = synth({
        'scripts/a.js': HEAD,
        'scripts/b.js': tag('read as text by scripts/tests/test-x.mjs:7. Keep on one line.'),
        'scripts/c.js': tag('read as text by scripts/tests/test-x.mjs:9999'),
        'scripts/d.js': tag('nothing reads this since old-test-x.mjs.bak went'),
        'scripts/e.js': HEAD,
        'scripts/f.js': HEAD,
        'scripts/g.js': HEAD,
        'scripts/h.js': HEAD,
        'scripts/deep/i.js': HEAD,
        'scripts/other/i.js': HEAD,
        'scripts/tests/test-x.mjs': `${reader}\n`
      });
      assert.deepEqual(
        E.contractLeg(s).findings.map(
          (f) => `${f.file} ${f.kind}${f.kind === 'untagged' ? ` ${f.message.split(' ')[4]}` : ''}`
        ),
        [
          'scripts/a.js untagged scripts/tests/test-x.mjs:6',
          'scripts/c.js untagged scripts/tests/test-x.mjs:8',
          'scripts/d.js untagged scripts/tests/test-x.mjs:9',
          'scripts/e.js untagged scripts/tests/test-x.mjs:10',
          'scripts/f.js untagged scripts/tests/test-x.mjs:11',
          'scripts/g.js untagged scripts/tests/test-x.mjs:13',
          'scripts/h.js untagged scripts/tests/test-x.mjs:14',
          'scripts/deep/i.js untagged scripts/tests/test-x.mjs:17',
          'scripts/c.js stale-tag',
          'scripts/d.js malformed-tag'
        ]
      );
    });
    test('counts a Python read however it is spelled: a method on a path, a reader it is given to, an alias, a keyword, a built name', () => {
      const reader = [
        '"""WHAT. a. HOW. b. NEVER. c."""',
        'import builtins',
        'import codecs',
        'import io',
        'import unittest',
        'from pathlib import Path',
        '',
        'REPO = Path(__file__).resolve().parent.parent.parent',
        'LOG = REPO / "scripts" / "lib" / "log.js"',
        'LOG_TYPED: Path = REPO / "scripts" / "lib" / "log.js"',
        'NAME = "log" + ".js"',
        'reader = open',
        '',
        '',
        'class Reads(unittest.TestCase):',
        '    def test_forms(self):',
        '        a = open(REPO / "scripts" / "lib" / "log.js")',
        '        b = LOG.read_text(encoding="utf-8")',
        '        c = LOG.open(encoding="utf-8")',
        '        d = io.open(LOG)',
        '        e = codecs.open(str(LOG), encoding="utf-8")',
        '        f = reader(LOG)',
        '        g = builtins.open(LOG)',
        '        h = open(file=LOG)',
        '        i = LOG_TYPED.read_text(encoding="utf-8")',
        '        local = REPO / "scripts" / "lib" / "log.js"',
        '        j = local.read_text(encoding="utf-8")',
        '        k = (REPO / "scripts" / "lib" / NAME).read_text()',
        '        n = Path.read_text(LOG)',
        '        o = (REPO / f"scripts/lib/{\'log\'}.js").read_text()',
        '        p = (REPO / "scripts/lib/log.js").read_bytes()',
        '        return a, b, c, d, e, f, g, h, i, j, k, n, o, p',
        ''
      ].join('\n');
      const s = synth({ 'scripts/lib/log.js': HEAD, 'scripts/tests/test_reads.py': reader });
      assert.deepEqual(
        E.contractLeg(s).findings.map((f) => `${f.file} ${f.message.split(' ')[4]}`),
        [17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31].map(
          (n) => `scripts/lib/log.js scripts/tests/test_reads.py:${n}`
        )
      );
    });
    test('resolves a read path exactly or not at all, and counts every read it cannot resolve', () => {
      const reader = [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "const ROOT = '.';",
        'const load = (d, rel) => fs.readFileSync(path.join(d, rel), "utf8");',
        // 5-6: the nearest binding wins; the first one in the file is another read's.
        "{ const src = path.join(ROOT, 'scripts', 'a.js'); fs.readFileSync(src, 'utf8'); }",
        "{ const src = path.join(ROOT, 'tmp', 'launcher.log'); fs.readFileSync(src, 'utf8'); }",
        // 7-8: member access on a module binding resolves to nothing (audit.CONTRACT_REL).
        "const audit = require(path.join(ROOT, 'scripts', 'b.js'));",
        'load(ROOT, audit.CONTRACT_REL);',
        // 9-10: a parameter resolves to nothing, whatever the file binds by that name elsewhere.
        "const rel = 'scripts/c.js';",
        'function copy(rel) { const t = fs.readFileSync(path.join(ROOT, rel)); return t.length; }',
        // 11-13: a name bound again resolves to nothing.
        "let p = 'scripts/d.js';",
        "p = 'scripts/e.js';",
        'fs.readFileSync(p);',
        // 14-15: a for...of over a literal array, and over a const bound once to one: each element.
        "for (const r of ['scripts/f.js', 'scripts/g.js']) fs.readFileSync(path.join(ROOT, r), 'utf8');",
        "const LIST = ['scripts/h.js']; for (const r of LIST) fs.readFileSync(path.join(ROOT, r), 'utf8');",
        // 16: a loop over anything else resolves to nothing.
        "for (const r of fs.readdirSync('scripts')) fs.readFileSync(path.join(ROOT, r), 'utf8');",
        // 17-18: a condition names each branch; [a, b].find() names each element.
        "const P = process.env.X ? path.join(ROOT, 'variants', 'online', 'scripts', 'i.js') : path.join(ROOT, 'scripts', 'i.js');",
        "fs.readFileSync(P, 'utf8'); fs.readFileSync([path.join(ROOT, 'scripts', 'j.js'), 'k.log'].find((x) => fs.existsSync(x)), 'utf8');",
        // 19: any other call resolves to nothing, its literal arguments included.
        "fs.readFileSync(fixture('scripts/l.js'), 'utf8');",
        // 20: a string's own segments, split at '/', are its parts.
        "const REL = 'scripts/m.js'; fs.readFileSync(path.join(ROOT, ...REL.split('/')), 'utf8');",
        // 21: new URL(<path>, import.meta.url) names <path> from the reader's own folder.
        "fs.readFileSync(new URL('../n.js', import.meta.url), 'utf8');"
      ].join('\n');
      const files = Object.fromEntries('abcdefghijklmn'.split('').map((c) => [`scripts/${c}.js`, HEAD]));
      const s = synth({ ...files, 'scripts/tests/test-r.mjs': `${reader}\n` });
      const l = E.contractLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file} ${f.message.split(' ')[4]}`),
        [
          'scripts/a.js scripts/tests/test-r.mjs:5',
          'scripts/f.js scripts/tests/test-r.mjs:14',
          'scripts/g.js scripts/tests/test-r.mjs:14',
          'scripts/h.js scripts/tests/test-r.mjs:15',
          'scripts/i.js scripts/tests/test-r.mjs:18',
          'scripts/j.js scripts/tests/test-r.mjs:18',
          'scripts/m.js scripts/tests/test-r.mjs:20',
          'scripts/n.js scripts/tests/test-r.mjs:21'
        ]
      );
      assert.deepEqual(
        l.unresolved.map((u) => `${u.reader}:${u.line} ${u.why}`),
        [
          'scripts/tests/test-r.mjs:8 d, a parameter; rel, a parameter; audit.CONTRACT_REL, a member access',
          'scripts/tests/test-r.mjs:10 rel, a parameter',
          'scripts/tests/test-r.mjs:13 p, assigned again after it is bound',
          'scripts/tests/test-r.mjs:16 r, a loop over something that is not a literal array',
          'scripts/tests/test-r.mjs:19 fixture(), a call'
        ]
      );
    });
    test('resolves a Python read path exactly or not at all, the same way', () => {
      const reader = [
        '"""WHAT. a. HOW. b. NEVER. c."""',
        'import unittest',
        'from pathlib import Path',
        '',
        'REPO = Path(__file__).resolve().parent.parent.parent',
        'REL = "scripts/c.py"',
        'TWICE = REPO / "scripts" / "d.py"',
        'TWICE = REPO / "scripts" / "e.py"',
        'NAMES = ["scripts/g.py", "scripts/h.py"]',
        '',
        '',
        'class Reads(unittest.TestCase):',
        '    def test_forms(self):',
        '        audit = REPO / "scripts" / "b.py"',
        '        a = (REPO / "scripts" / "a.py").read_text()',
        '        b = (REPO / audit.CONTRACT_REL).read_text()',
        '        d = TWICE.read_text()',
        '        for rel in ["scripts/f.py", "scripts/i.py"]:',
        '            (REPO / rel).read_text()',
        '        for name in NAMES:',
        '            (REPO / name).read_text()',
        '        return a, b, d',
        '',
        '    def helper(self, REL):',
        '        return (REPO / REL).read_text()',
        ''
      ].join('\n');
      const files = Object.fromEntries(
        'abcdefghi'.split('').map((c) => [`scripts/${c}.py`, '"""WHAT. a. HOW. b. NEVER. c."""\n'])
      );
      const s = synth({ ...files, 'scripts/tests/test_reads.py': reader });
      const l = E.contractLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file} ${f.message.split(' ')[4]}`),
        [
          'scripts/a.py scripts/tests/test_reads.py:15',
          'scripts/f.py scripts/tests/test_reads.py:19',
          'scripts/i.py scripts/tests/test_reads.py:19',
          'scripts/g.py scripts/tests/test_reads.py:21',
          'scripts/h.py scripts/tests/test_reads.py:21'
        ]
      );
      assert.deepEqual(
        l.unresolved.map(
          (u) =>
            `${u.reader}:${u.line} ${u.why
              .split('; ')
              .filter((w) => !w.startsWith('Path(__file__)'))
              .join('; ')}`
        ),
        [
          'scripts/tests/test_reads.py:16 audit.CONTRACT_REL, an attribute',
          'scripts/tests/test_reads.py:17 TWICE, bound more than once where it is read',
          'scripts/tests/test_reads.py:25 REL, a parameter'
        ]
      );
    });
    test('a read names the file that ships at its path: the variant where one ships there, else the Kit file, never a namesake', () => {
      const files = {
        'variants/online/scripts/shipped.js': HEAD,
        'scripts/lonely.js': HEAD,
        'scripts/tests/test-f.mjs': [
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          "fs.readFileSync(path.join(ROOT, 'scripts', 'shipped.js'), 'utf8');",
          "fs.readFileSync(path.join(ROOT, 'variants', 'online', 'scripts', 'shipped.js'), 'utf8');",
          "fs.readFileSync(path.join(ROOT, 'scripts', 'kit-only.js'), 'utf8');",
          "fs.readFileSync(path.join(ROOT, 'elsewhere', 'lonely.js'), 'utf8');",
          ''
        ].join('\n')
      };
      // As in the Kit: the Kit keeps its own copy of the shipped path and a file that ships nowhere, and the
      // variant ships at its path without the variants prefix.
      const s = synth(files, {
        tracked: new Set([...Object.keys(files), 'scripts/shipped.js', 'scripts/kit-only.js'])
      });
      const prefix = 'variants/online/';
      s.files = s.files.map((f) => (f.src.startsWith(prefix) ? { ...f, dst: f.src.slice(prefix.length) } : f));
      const l = E.contractLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file} ${f.message.split(' ')[4]}`),
        [
          'variants/online/scripts/shipped.js scripts/tests/test-f.mjs:3',
          'variants/online/scripts/shipped.js scripts/tests/test-f.mjs:4'
        ]
      );
      assert.deepEqual(l.outOfScope, ['scripts/tests/test-f.mjs:5 -> scripts/kit-only.js']);
    });
    test('a copy of a file is not a text read; a copy that also looks at the content stays a read', () => {
      const reader = [
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "import { spawnSync } from 'node:child_process';",
        "const ROOT = '.';",
        "const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join('fx', rel)), { recursive: true }); fs.writeFileSync(path.join('fx', rel), text); };",
        // 6: through a helper whose parameter goes only into one write.
        "for (const rel of ['scripts/a.js', 'scripts/b.js']) put(rel, fs.readFileSync(path.join(ROOT, rel)));",
        // 7: straight into a write.
        "fs.writeFileSync('fx/c.js', fs.readFileSync(path.join(ROOT, 'scripts', 'c.js'), 'utf8'));",
        // 8: through a const whose one use is a write.
        "const d = fs.readFileSync(path.join(ROOT, 'scripts', 'd.js')); fs.writeFileSync('fx/d.js', d);",
        // 9: the same, and it also asserts on the content: a read.
        "const e = fs.readFileSync(path.join(ROOT, 'scripts', 'e.js'), 'utf8'); fs.writeFileSync('fx/e.js', e); assert.match(e, /x/);",
        // 10: written, but changed first: a read.
        "fs.writeFileSync('fx/f.js', fs.readFileSync(path.join(ROOT, 'scripts', 'f.js'), 'utf8').replace('a', 'b'));",
        // 11: copyFileSync never reads.
        "fs.copyFileSync(path.join(ROOT, 'scripts', 'g.js'), 'fx/g.js');",
        // 12: cp copies another test without looking at it.
        "spawnSync('cp', ['-t', 'fx/', path.join(ROOT, 'scripts', 'tests', 'test-h.mjs')]);",
        // 13-14: a helper that uses its parameter twice is no write helper: a read.
        'const put2 = (rel, text) => { fs.writeFileSync(rel, text); return text.length; };',
        "put2('fx/i.js', fs.readFileSync(path.join(ROOT, 'scripts', 'i.js')));",
        // 15: a helper reached through a member is not followed: a read.
        "fixture.put('fx/j.js', fs.readFileSync(path.join(ROOT, 'scripts', 'j.js')));"
      ].join('\n');
      const files = Object.fromEntries('abcdefgij'.split('').map((c) => [`scripts/${c}.js`, HEAD]));
      const s = synth({ ...files, 'scripts/tests/test-h.mjs': HEAD, 'scripts/tests/test-r.mjs': `${reader}\n` });
      const l = E.contractLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file} ${f.message.split(' ')[4]}`),
        [
          'scripts/e.js scripts/tests/test-r.mjs:9',
          'scripts/f.js scripts/tests/test-r.mjs:10',
          'scripts/i.js scripts/tests/test-r.mjs:14',
          'scripts/j.js scripts/tests/test-r.mjs:15'
        ]
      );
      assert.deepEqual(
        l.copies.map((c) => `copy ${c.reader}:${c.line} -> ${c.target} (${c.via})`),
        [
          'copy scripts/tests/test-r.mjs:6 -> scripts/a.js (readFileSync)',
          'copy scripts/tests/test-r.mjs:6 -> scripts/b.js (readFileSync)',
          'copy scripts/tests/test-r.mjs:7 -> scripts/c.js (readFileSync)',
          'copy scripts/tests/test-r.mjs:8 -> scripts/d.js (readFileSync)',
          'copy scripts/tests/test-r.mjs:12 -> scripts/tests/test-h.mjs (cp)'
        ]
      );
      assert.match(
        l.copies[3].proof,
        /^const d = .*fs\.writeFileSync\('fx\/d\.js', d\);$/,
        'the proof is the line of the write'
      );
    });
    test('an unseen: qualifier names a read the leg cannot see; it never hides one it can', () => {
      const tag = (t) => `${HEAD}// contract: read as text by ${t}\nconst x = 1;\n`;
      const s = synth({
        'scripts/u1.js': tag(
          'scripts/autosave.sh:3 (unseen: sed lifts it at scripts/x.sh:9 into a file). Keep the function name.'
        ),
        'scripts/u2.js': tag('scripts/tests/test-u.mjs:2 (unseen: a loop over what a call returns). Keep x.'),
        'scripts/u3.js': tag('scripts/tests/test-u.mjs:3 (unseen: the leg cannot follow it). Keep x.'),
        'scripts/u4.js': tag('scripts/tests/test-u.mjs:2. Keep x.'),
        'scripts/u5.js': tag('scripts/autosave.sh:3 (unseen: sed). Keep x.'),
        'scripts/u6.js': tag('scripts/nope.sh:1 (unseen: a shell loop reads it). Keep x.'),
        'scripts/autosave.sh': '#!/bin/bash\n# autosave.sh - a.\nsed -n 1p scripts/u1.js\n',
        'scripts/tests/test-u.mjs': [
          "import fs from 'node:fs';",
          "for (const f of listed()) fs.readFileSync(f, 'utf8');",
          "fs.readFileSync('scripts/u3.js', 'utf8');",
          ''
        ].join('\n')
      });
      const l = E.contractLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file} ${f.kind}`),
        [
          'scripts/u3.js unseen-visible',
          'scripts/u4.js stale-tag',
          'scripts/u5.js malformed-tag',
          'scripts/u6.js stale-tag'
        ]
      );
      assert.match(l.findings[0].message, /the tag says unseen, the read is visible$/);
      assert.deepEqual(
        l.unseen.map((u) => `${u.file}:${u.line} ${u.reader}:${u.from} (${u.how})`),
        [
          'scripts/u1.js:8 scripts/autosave.sh:3 (sed lifts it at scripts/x.sh:9 into a file)',
          'scripts/u2.js:8 scripts/tests/test-u.mjs:2 (a loop over what a call returns)'
        ]
      );
      assert.deepEqual(
        E.contractRefs('contract: read as text by a.mjs:3 (unseen: read by b.mjs:4 in a loop), c.mjs:5. Keep it.'),
        [
          { file: 'a.mjs', from: 3, to: 3, unseen: 'read by b.mjs:4 in a loop' },
          { file: 'c.mjs', from: 5, to: 5 }
        ],
        'a qualifier belongs to the reader right before it, and a file:line inside it is not a reader'
      );
    });
    test('refuses a tag line naming more than one reader, the same reader twice included; one tag line per reader holds', () => {
      const tags = (...readers) =>
        `${HEAD}${readers.map((r) => `// contract: read as text by ${r}. Keep x.\n`).join('')}const x = 1;\n`;
      const reads = (...files) => [
        "import fs from 'node:fs';",
        ...files.map((f) => `fs.readFileSync('${f}', 'utf8');`),
        ''
      ];
      const s = synth({
        'scripts/two-readers.js': tags('scripts/tests/test-a.mjs:2, scripts/tests/test-b.mjs:2'),
        'scripts/one-reader-twice.js': tags('scripts/tests/test-a.mjs:3, scripts/tests/test-a.mjs:4'),
        'scripts/stacked.js': tags('scripts/tests/test-a.mjs:5', 'scripts/tests/test-b.mjs:3'),
        'scripts/tests/test-a.mjs': reads(
          'scripts/two-readers.js',
          'scripts/one-reader-twice.js',
          'scripts/one-reader-twice.js',
          'scripts/stacked.js'
        ).join('\n'),
        'scripts/tests/test-b.mjs': reads('scripts/two-readers.js', 'scripts/stacked.js').join('\n')
      });
      assert.deepEqual(
        E.contractLeg(s)
          .findings.map((f) => `${f.file}:${f.line} ${f.kind}`)
          .sort(),
        ['scripts/one-reader-twice.js:8 many-readers', 'scripts/two-readers.js:8 many-readers']
      );
    });
    // A shipped file whose tags name readers this tree may not hold; each tag sits on its own line from 8.
    const tagsFor = (...readers) =>
      `${HEAD}${readers.map((r) => `// contract: read as text by ${r}. Keep the line.\n`).join('')}const X = 1;\n`;
    const READER = 'system/recall/reader.js';
    const kinds = (l) => l.findings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.reader}`);
    test('in the Kit, a tag whose reader the manifest drops online holds while the reader is there', () => {
      const s = synth(
        { 'scripts/writer.js': tagsFor(`${READER}:3`), [READER]: `${HEAD}const a = 1;\n` },
        { isKit: true, droppedPaths: new Set([READER]) }
      );
      assert.deepEqual(kinds(E.contractLeg(s)), []);
    });
    test('in the online tree, a tag whose reader a drop row names is left to the Kit: no finding, and named', () => {
      const s = synth(
        {
          'scripts/writer.js': tagsFor(`${READER}:3`, 'scripts/tests/test-kit-only.mjs:2'),
          'scripts/unseen.js': tagsFor(`${READER}:3 (unseen: the harvester reads it whole)`),
          'scripts/short.js': tagsFor(`${READER}:3 (unseen: grep)`)
        },
        { droppedPaths: new Set([READER, 'scripts/tests/test-kit-only.mjs']) }
      );
      const l = E.contractLeg(s);
      assert.deepEqual(
        kinds(l),
        [`scripts/short.js:8 malformed-tag ${READER}`],
        'a malformed tag is malformed in every tree'
      );
      assert.deepEqual(
        (l.kitOnly ?? []).map((k) => `${k.file}:${k.line} ${k.reader}:${k.from}`),
        [
          `scripts/writer.js:8 ${READER}:3`,
          'scripts/writer.js:9 scripts/tests/test-kit-only.mjs:2',
          `scripts/unseen.js:8 ${READER}:3`
        ]
      );
      assert.deepEqual(l.unseen, [], 'a reader this tree does not hold is not counted as an unseen contract here');
    });
    test('in the online tree, a tag whose reader the manifest ships and the tree lacks is stale', () => {
      const s = synth({ 'scripts/writer.js': tagsFor(`${READER}:3`) }, { manifestPaths: new Set([READER]) });
      assert.deepEqual(kinds(E.contractLeg(s)), [`scripts/writer.js:8 stale-tag ${READER}`]);
    });
    test('in either tree, a tag whose reader is in no tree and in no drop row is stale', () => {
      for (const isKit of [true, false]) {
        const s = synth(
          { 'scripts/writer.js': tagsFor('system/recall/nowhere.js:3') },
          { isKit, droppedPaths: new Set([READER]) }
        );
        assert.deepEqual(
          kinds(E.contractLeg(s)),
          ['scripts/writer.js:8 stale-tag system/recall/nowhere.js'],
          isKit ? 'the Kit' : 'the online tree'
        );
      }
    });
    test('in the Kit, a tag whose reader the manifest drops online is stale once the reader is gone', () => {
      const s = synth(
        { 'scripts/writer.js': tagsFor(`${READER}:3`) },
        { isKit: true, droppedPaths: new Set([READER]) }
      );
      assert.deepEqual(kinds(E.contractLeg(s)), [`scripts/writer.js:8 stale-tag ${READER}`]);
    });
    test('the online tree knows a Kit-only reader from the manifest it ships, by exact path, as the dangling leg does', async () => {
      const manifest = {
        components: [
          { id: 'kit-only-reader', paths: [READER], online: 'drop' },
          { id: 'shipped-reader', paths: ['system/recall/kept.js'], online: 'ship' },
          { id: 'laptop-folder', paths: ['launchd/'], online: 'drop' },
          { id: 'the-rest', paths: ['scripts/', 'system/kit-manifest.json'], online: 'ship' }
        ]
      };
      const s = synth({
        'scripts/writer.js': tagsFor(`${READER}:3`, 'system/recall/kept.js:3', 'launchd/reader.js:3'),
        'system/kit-manifest.json': `${JSON.stringify(manifest, null, 2)}\n`
      });
      commitBase(s);
      const ctx = await E.loadContext(s.root);
      assert.equal(ctx.isKit, false, 'a tree without variants/online/ is a generated tree');
      const l = E.contractLeg(ctx);
      assert.deepEqual(
        kinds(l),
        ['scripts/writer.js:9 stale-tag system/recall/kept.js', 'scripts/writer.js:10 stale-tag launchd/reader.js'],
        'a reader the manifest ships is stale when absent, and a directory drop row names no exact reader'
      );
      assert.deepEqual(
        (l.kitOnly ?? []).map((k) => `${k.file}:${k.line} ${k.reader}`),
        [`scripts/writer.js:8 ${READER}`]
      );
    });
    test('the tree: the untagged-read count does not rise, and no enforced file is read without its tag', () => {
      const l = legs.get('contract');
      console.log(
        `code-standard: contract: ${l.unresolved.length} reads whose path is not resolved, ${l.copies.length} copies of a tracked file, ${l.unseen.length} unseen contracts (--report names each)`
      );
      if (l.kitOnly.length)
        console.log(
          `code-standard: contract: ${l.kitOnly.length} tags whose reader only the Kit holds, left to the Kit's run (--report names each)`
        );
      holds('contract');
    });
  });

  describe('module-split and floor', () => {
    test('refuses require() of an .mjs path from CommonJS, and import.meta.main anywhere', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}const m = require('./b.mjs');\nconst n = require('./c.js');\n`,
        'scripts/d.mjs': `${HEAD}if (import.meta.main) run();\n`
      });
      assert.deepEqual(
        E.moduleSplitLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:8']
      );
      assert.deepEqual(
        E.floorLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/d.mjs:8']
      );
      assert.match(E.floorLeg(s).findings[0].message, /below Node 22\.18, and the laptop floor is 22\.16$/);
    });
    test('the tree: module-split holds its ceiling', () => holds('module-split'));
    test('the tree: floor holds its ceiling', () => holds('floor'));
  });

  describe('suppression', () => {
    test('refuses a bare biome-ignore, a format suppression with no contract: tag above it, and a bare noqa', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}// biome-ignore lint/style/useConst\nlet a = 1;\n// biome-ignore format: kept on one line\nconst b = 2;\n// contract: read as text by scripts/tests/test-x.mjs:1\n// biome-ignore format: the test reads this line\nconst c = 3;\n`,
        'scripts/b.py': '"""Doc."""\nimport os  # noqa\nimport re  # noqa: F401  kept for the re-export\n'
      });
      assert.deepEqual(
        E.suppressionLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:8', 'scripts/a.js:10', 'scripts/b.py:2']
      );
    });
    test('refuses a one-word reason, a noqa in any case, a file-level ruff: noqa and a bare type: ignore', () => {
      const s = synth({
        'scripts/a.js': `${HEAD}// biome-ignore lint/style/useConst: x\nlet a = 1;\n// biome-ignore lint/style/useConst: the loop below reassigns it\nlet b = 2;\n`,
        'scripts/b.py': [
          '"""Doc."""',
          'import os  # NOQA',
          'import re  # noqa: F401  kept for the re-export',
          'X: int = "x"  # type: ignore',
          'Y: int = "y"  # type: ignore[assignment]  # the stub declares it wrong',
          '# ruff: noqa: E501  long lines here are data',
          '# ruff: noqa'
        ].join('\n')
      });
      assert.deepEqual(
        E.suppressionLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/a.js:8', 'scripts/b.py:2', 'scripts/b.py:4', 'scripts/b.py:7']
      );
    });
    test('refuses a shellcheck disable that is bare, blanket, one word, or has its reason where shellcheck refuses it', () => {
      const lines = [
        '#!/bin/sh',
        '# shellcheck disable=SC2086',
        '# shellcheck disable=all # every check, for now',
        '# shellcheck disable=SC2086 the words are split on purpose',
        '# shellcheck disable=SC2086 # split',
        '# shellcheck disable=SC2086,SC2034 # the words are split on purpose',
        '# shellcheck source=scripts/lib/x.sh',
        'echo "a # shellcheck disable=SC2086 inside a string is not a directive"',
        '# the shellcheck disable= form is prose here'
      ];
      const s = synth({ 'scripts/c.sh': `${lines.join('\n')}\n` });
      assert.deepEqual(
        E.suppressionLeg(s).findings.map((f) => `${f.line} ${f.message.split(',')[0]}`),
        [
          '2 a shellcheck disable with no reason',
          '3 a shellcheck disable with no SC code (or all)',
          '4 a shellcheck disable whose reason is not after a second #',
          '5 a shellcheck disable with no reason'
        ]
      );
    });
    test('counts every Python suppression the tools obey: flake8: noqa, a noqa after prose, a ruff range, mypy inline, and a type: ignore reason mypy refuses', () => {
      const s = synth({
        'scripts/b.py': [
          '# flake8: noqa',
          '# flake8: noqa: F401  kept for the re-export',
          'import os  # kept for the re-export  # noqa',
          'import re  # see issue #12  # noqa: F401  kept for the re-export',
          '# mypy: ignore-errors',
          '# mypy: disable-error-code="no-untyped-def"',
          '# ruff: disable[F401]',
          '# ruff: disable[F401]  kept for the re-export below',
          '# ruff: enable[F401]',
          'A: int = "a"  # type: ignore[assignment]  the value is filled in later',
          'B: int = "b"  # type: ignore[assignment]  # the value is filled in later',
          'C = 1  # a sentence that mentions noqa and mypy: is prose'
        ].join('\n')
      });
      assert.deepEqual(
        E.suppressionLeg(s).findings.map((f) => `${f.line} ${f.message.split(',')[0]}`),
        [
          '1 a file-level flake8: noqa with no rule',
          '3 a noqa with no rule or no reason',
          '5 a mypy: inline configuration comment',
          '6 a mypy: inline configuration comment',
          '7 a ruff: disable with no [rule] or no reason',
          '10 a type: ignore whose reason is not after a second #'
        ]
      );
    });
    test("refuses a format suppression whose statement is not the text its tag's reader asserts about", () => {
      const site = (reader, lines) =>
        `${HEAD}// contract: read as text by ${reader}. Keep on one line.\n// biome-ignore format: the test reads this line byte for byte\n${lines.join('\n')}\n`;
      const s = synth({
        'scripts/decoy.js': site('scripts/tests/test-r.mjs:3', [
          'const DECOY = 0;',
          "const CONTRACT_LINE = ['alpha', 'bravo'];"
        ]),
        'scripts/right.js': site('scripts/tests/test-r.mjs:4', [
          "const CONTRACT_LINE = ['alpha', 'bravo'];",
          'const OTHER = 1;'
        ]),
        'scripts/sql.js': site('scripts/tests/test_r.py:8', ['const SQL = "select a " + "from b";']),
        'scripts/tests/test-r.mjs': [
          "import fs from 'node:fs';",
          "test('a', () => {",
          "  const src = fs.readFileSync('scripts/decoy.js', 'utf8');",
          "  const ok = fs.readFileSync('scripts/right.js', 'utf8').includes(\"const CONTRACT_LINE = ['alpha'\");",
          '  assert.ok(src.includes("const CONTRACT_LINE = [\'alpha\'"));',
          '});'
        ].join('\n'),
        'scripts/tests/test_r.py': [
          '"""Doc."""',
          'import unittest',
          'from pathlib import Path',
          '',
          '',
          'class T(unittest.TestCase):',
          '    def test_sql(self):',
          '        text = Path("scripts/sql.js").read_text()',
          '        self.assertIn(\'"select a " + "from b"\', text)',
          ''
        ].join('\n')
      });
      assert.deepEqual(
        E.suppressionLeg(s).findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/decoy.js:9']
      );
    });
    test('a format suppression under an unseen: tag is taken when its statement, with its trailing comment, is what the tag names', () => {
      const tag =
        '// contract: read as text by scripts/tests/portability-check.mjs:4 (unseen: the pragma scan skips this line). The pragma stays at the end of the line.';
      const s = synth({
        'scripts/guard.js': [
          HEAD.trimEnd(),
          tag,
          '// biome-ignore format: portability check P5 exempts only the line that carries the pragma',
          "denyCase('Edit CLAUDE.md', 'C:/Users/Owner/alex/CLAUDE.md'); // portability-ok: a synthetic Windows-shaped input",
          tag,
          '// biome-ignore format: kept on one line for the scan',
          'const unrelated = 1; // a comment that names nothing the scan looks for',
          ''
        ].join('\n'),
        'scripts/tests/portability-check.mjs': [
          "import fs from 'node:fs';",
          'for (const line of fs.readFileSync(0, "utf8").split("\\n")) {',
          '  // the same escape hatch as P2 and P3',
          '  if (/\\/\\/\\s*portability-ok:\\s*\\S/.test(line)) continue;',
          '}',
          ''
        ].join('\n')
      });
      const l = E.suppressionLeg(s);
      assert.deepEqual(
        l.findings.map((f) => `${f.file}:${f.line} ${f.message.split(':')[0]}`),
        ["scripts/guard.js:12 the statement under this format suppression is not text its tag's reader asserts about"],
        'an unseen tag cannot suppress a statement its reader does not look for'
      );
      assert.deepEqual(
        l.unseenPairs.map((u) => `${u.file}:${u.line} ${u.readers.join(', ')} (unseen: ${u.how.join('; ')})`),
        ['scripts/guard.js:9 scripts/tests/portability-check.mjs:4 (unseen: the pragma scan skips this line)']
      );
    });
    test('the tree: the suppression count does not rise, and no enforced file carries a bare one', () => {
      console.log(
        `code-standard: suppression: ${legs.get('suppression').unseenPairs.length} unseen suppressions (--report names each)`
      );
      holds('suppression');
    });
  });

  describe('pinned', () => {
    const body = (n) =>
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('PINNED DEFECT R9-9: it exits one', () => {\n  assert.equal(run(), ${n});\n});\ntest('PINNED DEFECT T1: fixed on purpose', () => { assert.ok(${n === 1}); });\n`;
    test('refuses a pinned assertion that changed unless one of its ids is on the FIX list; a reformat is not a change', () => {
      const before = synth({ 'scripts/tests/test-p.mjs': body(1) });
      const snapshot = E.collectPinned(before);
      assert.equal(snapshot.length, 2);
      assert.deepEqual(
        snapshot.map((p) => p.ids),
        [['R9-9'], ['T1']]
      );
      const reformatted = synth({
        'scripts/tests/test-p.mjs': body(1)
          .replace(/'/g, '"')
          .replace(/\n {2}/g, '\n    // a comment\n    ')
          .replace(/;\n/g, '\n')
      });
      assert.deepEqual(E.pinnedLeg(reformatted, { pinned: snapshot, fix_list: [] }).findings, []);
      const flipped = synth({ 'scripts/tests/test-p.mjs': body(2) });
      const l = E.pinnedLeg(flipped, { pinned: snapshot, current_wave: 'A1', fix_list: [{ id: 'T1', wave: 'A1' }] });
      assert.deepEqual(
        l.findings.map((f) => f.message.slice(0, 40)),
        ['PINNED DEFECT R9-9: its body changed, an']
      );
      assert.equal(l.fixed.length, 1);
    });
    test('refuses a Python pinned test whose body changed, and not one whose docstring did', () => {
      const py = (n, doc) =>
        `"""M."""\nimport unittest\n\n\nclass T(unittest.TestCase):\n    def test_x_PINNED_DEFECT_C1_N1(self):\n        """${doc}"""\n        self.assertEqual(1, ${n})\n`;
      const snapshot = E.collectPinned(synth({ 'scripts/tests/test_p.py': py(1, 'one') }));
      assert.deepEqual(
        snapshot.map((p) => p.ids),
        [['C1-N1']]
      );
      assert.deepEqual(
        E.pinnedLeg(synth({ 'scripts/tests/test_p.py': py(1, 'two') }), { pinned: snapshot }).findings,
        []
      );
      assert.equal(
        E.pinnedLeg(synth({ 'scripts/tests/test_p.py': py(2, 'one') }), { pinned: snapshot }).findings.length,
        1
      );
    });
    test('says why a JS pinned test would not run as written, and accepts only the places a pin always runs', () => {
      const lines = [
        "test('PINNED DEFECT A1: top level', () => { assert.ok(1); });",
        "describe('s', () => {",
        "  test('PINNED DEFECT A2: in a suite', () => { assert.ok(1); });",
        "  describe('inner', function () {",
        "    it('PINNED DEFECT A3: in a nested suite', () => { assert.ok(1); });",
        '  });',
        '});',
        'const CASES = [1, 2];',
        'for (const c of CASES) {',
        `  test(\`PINNED DEFECT A4: case \${c}\`, () => { assert.ok(c); });`,
        '}',
        "test('PINNED DEFECT A5: returns its assertion', () => { return assert.ok(1); });",
        "test.skip('PINNED DEFECT B1: skipped', () => { assert.ok(1); });",
        "test.todo('PINNED DEFECT B2: todo', () => { assert.ok(1); });",
        "test('PINNED DEFECT B4: skip option', { skip: true }, () => { assert.ok(1); });",
        "test('PINNED DEFECT B5: todo option', { todo: 'later' }, () => { assert.ok(1); });",
        "if (false) test('PINNED DEFECT B6: under a condition', () => { assert.ok(1); });",
        'if (process.env.X) {',
        "  test('PINNED DEFECT B7: in an if block', () => { assert.ok(1); });",
        '}',
        'function later() {',
        "  test('PINNED DEFECT B8: in a function', () => { assert.ok(1); });",
        '}',
        "describe.skip('s2', () => { test('PINNED DEFECT B9: in a skipped suite', () => { assert.ok(1); }); });",
        "describe('s3', { skip: true }, () => { test('PINNED DEFECT B10: suite with skip', () => { assert.ok(1); }); });",
        "test('PINNED DEFECT B11: context skip', (t) => { t.skip('no'); assert.ok(1); });",
        "test('PINNED DEFECT B12: early return', () => { if (!process.env.Y) return; assert.ok(1); });",
        "test('PINNED DEFECT B13: options by name', OPTS, () => { assert.ok(1); });",
        "const f = () => test('PINNED DEFECT B14: arrow body', () => { assert.ok(1); });"
      ];
      // it.only in a file of its own: an only mark stops every other test in its file (the run context).
      const s = synth({
        'scripts/tests/test-p.mjs': `${lines.join('\n')}\n`,
        'scripts/tests/test-q.mjs': "it.only('PINNED DEFECT B3: only', () => { assert.ok(1); });\n"
      });
      const stops = Object.fromEntries(E.collectPinned(s).map((p) => [p.ids[0], p.stops]));
      const body = 'it is inside a function body, which may never be called';
      assert.deepEqual(stops, {
        A1: [],
        A2: [],
        A3: [],
        A4: [],
        A5: [],
        B1: ['test.skip'],
        B2: ['test.todo'],
        B3: ['it.only'],
        B4: ['{ skip }'],
        B5: ['{ todo }'],
        B6: ['it sits under a condition'],
        B7: ['it sits under a condition or in a block'],
        B8: [body],
        B9: ['describe.skip'],
        B10: ['a suite with { skip }'],
        B11: ['it calls t.skip()'],
        B12: ['it returns before its last statement'],
        B13: ['its options are passed by name'],
        B14: [body]
      });
    });
    test('says which part of a JS pinned body never runs: a bare return, a literal condition, a break', () => {
      const pin = (id, body) => [`test('PINNED DEFECT ${id}: case', () => {`, ...body.map((l) => `  ${l}`), '});'];
      const lines = [
        "import assert from 'node:assert/strict';",
        "import { test } from 'node:test';",
        ...pin('D1', ['const r = 1', 'return', 'assert.equal(r, 1)']),
        ...pin('D2', ['const r = process.env.R', 'if (r) return', 'assert.equal(r, undefined)']),
        ...pin('D3', ['if (false) {', '  assert.ok(1);', '}']),
        ...pin('D4', ['if (0) assert.ok(1);']),
        ...pin('D5', ['false && assert.ok(1);']),
        ...pin('D6', ['for (const c of [1]) {', '  break;', '  assert.ok(c);', '}']),
        ...pin('D7', ['if (1 === 2) {', '  assert.ok(1);', '}']),
        ...pin('D8', ['if (!true) assert.ok(1);']),
        ...pin('D9', ['while (false) {', '  assert.ok(1);', '}']),
        ...pin('D10', ['if (true) {', '  assert.ok(1);', '} else {', '  assert.ok(0);', '}']),
        ...pin('D11', ['true ? assert.ok(1) : assert.ok(0);']),
        ...pin('D12', ['if (false && process.env.X) {', '  assert.ok(1);', '}']),
        ...pin('D13', ["if ('') assert.ok(1);"]),
        ...pin('D14', ['for (; false; ) {', '  assert.ok(1);', '}']),
        ...pin('D15', ['for (const c of [1]) {', '  continue', '  assert.ok(c)', '}']),
        ...pin('C1', ['if (process.env.X) {', '  assert.ok(1);', '}']),
        ...pin('C2', ['const a = 1;', 'const x = a === false && a;', 'assert.ok(!x);']),
        ...pin('C3', ['do {', '  assert.ok(1);', '} while (false);']),
        ...pin('C4', ['for (const c of [1, 2]) {', '  if (c === 1) continue;', '  assert.ok(c);', '}']),
        ...pin('C5', [
          'switch (1) {',
          '  case 1:',
          '    assert.ok(1);',
          '    break;',
          '  default:',
          '    assert.ok(1);',
          '}'
        ]),
        ...pin('C6', ['assert.ok(1)', 'return']),
        ...pin('C7', ['return Promise.resolve(1)', '  .then((v) => assert.ok(v))']),
        ...pin('C8', ['while (true) {', '  assert.ok(1);', '  break;', '}']),
        ...pin('C9', ['if (true) {', '  assert.ok(1);', '}']),
        ...pin('C10', ['const x = process.env.X;', 'assert.ok(x ? 1 : 2);']),
        ...pin('C11', ['for (const c of [1]) {', '  if (c) break', '  assert.ok(c)', '}'])
      ];
      const s = synth({ 'scripts/tests/test-d.mjs': `${lines.join('\n')}\n` });
      const stops = Object.fromEntries(E.collectPinned(s).map((p) => [p.ids[0], p.stops]));
      const never = (what) => [`part of it sits under ${what}, which never runs`];
      assert.deepEqual(stops, {
        D1: ['it returns before its last statement'],
        D2: ['it returns before its last statement'],
        D3: never('if (false)'),
        D4: never('if (0)'),
        D5: never('false &&'),
        D6: ['part of it sits after a break, which never runs'],
        D7: never('if (1 === 2)'),
        D8: never('if (!true)'),
        D9: never('while (false)'),
        D10: never('the else of if (true)'),
        D11: never('the else branch of true ?'),
        D12: never('if (false && process.env.X)'),
        D13: never("if ('')"),
        D14: never('for (; false;)'),
        D15: ['part of it sits after a continue, which never runs'],
        C1: [],
        C2: [],
        C3: [],
        C4: [],
        C5: [],
        C6: [],
        C7: [],
        C8: [],
        C9: [],
        C10: [],
        C11: []
      });
    });
    test('says why a Python pinned test would not run as written', () => {
      const py = [
        '"""M."""',
        'import unittest',
        '',
        'import pytest',
        '',
        '',
        'class T(unittest.TestCase):',
        '    def test_a_PINNED_DEFECT_P1(self):',
        '        self.assertEqual(1, 1)',
        '',
        '    @unittest.skip("later")',
        '    def test_b_PINNED_DEFECT_P2(self):',
        '        self.assertEqual(1, 1)',
        '',
        '    @unittest.skipIf(True, "x")',
        '    def test_c_PINNED_DEFECT_P3(self):',
        '        self.assertEqual(1, 1)',
        '',
        '    @pytest.mark.skip',
        '    def test_d_PINNED_DEFECT_P4(self):',
        '        self.assertEqual(1, 1)',
        '',
        '    def test_e_PINNED_DEFECT_P5(self):',
        '        raise unittest.SkipTest("x")',
        '',
        '    def test_f_PINNED_DEFECT_P6(self):',
        '        self.skipTest("x")',
        '        self.assertEqual(1, 1)',
        '',
        '    def test_g_PINNED_DEFECT_P7(self):',
        '        if True:',
        '            return',
        '        self.assertEqual(1, 1)',
        '',
        '    if False:',
        '        def test_h_PINNED_DEFECT_P8(self):',
        '            self.assertEqual(1, 1)',
        '',
        '',
        '@unittest.skip("all")',
        'class U(unittest.TestCase):',
        '    def test_i_PINNED_DEFECT_P9(self):',
        '        self.assertEqual(1, 1)',
        '',
        '',
        'if __name__ == "__main__":',
        '    unittest.main()',
        ''
      ].join('\n');
      const stops = Object.fromEntries(
        E.collectPinned(synth({ 'scripts/tests/test_p.py': py })).map((p) => [p.ids[0], p.stops])
      );
      assert.deepEqual(stops, {
        P1: [],
        P2: ["@unittest.skip('later')"],
        P3: ["@unittest.skipIf(True, 'x')"],
        P4: ['@pytest.mark.skip'],
        P5: ['it raises SkipTest'],
        P6: ['it calls self.skipTest'],
        P7: ['it returns before its last statement'],
        P8: ['it sits inside a block (If)'],
        P9: ["its class carries @unittest.skip('all')"]
      });
    });
    // One Python pin in a subclass of a Sandbox base, the layout of the tree's own Python tests.
    const RUN = [
      '"""M."""',
      'import unittest',
      '',
      '',
      'def helper():',
      '    return 1',
      '',
      '',
      'class Sandbox(unittest.TestCase):',
      '    def setUp(self):',
      '        self.n = 1',
      '',
      '    def vs(self, arg):',
      '        return arg',
      '',
      '',
      'class Build(Sandbox):',
      '    def test_other(self):',
      '        self.assertEqual(self.vs(2), 2)',
      '',
      '    def test_x_PINNED_DEFECT_K1(self):',
      '        r = self.vs(1)',
      '        self.assertEqual(r, helper())',
      '',
      '',
      'if __name__ == "__main__":',
      '    unittest.main(verbosity=2)',
      ''
    ].join('\n');
    const plant = (from, to) => {
      assert.ok(RUN.includes(from), `the plant's anchor is in the file: ${from}`);
      return RUN.replace(from, to);
    };
    const PIN_DEF = '    def test_x_PINNED_DEFECT_K1(self):\n';
    const MAIN = '\n\nif __name__ == "__main__":';
    const BUILD = 'class Build(Sandbox):\n';
    /** The one pin of each text, every text a file of its own, measured by one run of the helper. */
    const runsOf = (texts) => {
      const names = texts.map((_, k) => `scripts/tests/test_k${k}.py`);
      const pins = E.collectPinned(synth(Object.fromEntries(names.map((name, k) => [name, texts[k]]))));
      return names.map((name) => {
        const own = pins.filter((p) => p.file === name);
        assert.equal(own.length, 1, `one pinned test in ${name}`);
        return own[0];
      });
    };
    /** One context per text, each holding it as the same file, measured by one run of the helper. */
    const treesOf = (file, texts) => {
      const s = synth(Object.fromEntries(texts.map((text, k) => [`scripts/tests/test_k${k}.py`, text])));
      return s.files.map((f) => {
        const one = { ...f, src: file, dst: file };
        return { ...s, files: [one], bySrc: new Map([[file, one]]), tracked: new Set([file]) };
      });
    };
    // Each way a pin can stop running without its own body changing, in every spelling unittest
    // accepts for it. Each is a reason not to run, which no FIX row licenses.
    const STOPPERS = {
      'the base setUp raises SkipTest': [
        plant('    def setUp(self):\n', '    def setUp(self):\n        raise unittest.SkipTest("later")\n'),
        'Sandbox.setUp raises SkipTest'
      ],
      'a setUpClass on the base skips': [
        plant(
          'class Sandbox(unittest.TestCase):\n',
          'class Sandbox(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls):\n        raise unittest.SkipTest("later")\n\n'
        ),
        'Sandbox.setUpClass raises SkipTest'
      ],
      'a setUpClass on its own class skips': [
        plant(BUILD, `${BUILD}    @classmethod\n    def setUpClass(cls):\n        cls.skipTest(cls, "later")\n\n`),
        'Build.setUpClass calls cls.skipTest'
      ],
      'its class is no longer a TestCase': [
        plant(BUILD, 'class Build:\n'),
        'its class is not a unittest.TestCase, so unittest does not collect it'
      ],
      'the method is shadowed later in its class': [
        plant(MAIN, `\n    test_x_PINNED_DEFECT_K1 = None${MAIN}`),
        'its name is bound again later in its class, so the method unittest runs is another one'
      ],
      'the method is replaced at module level': [
        plant(MAIN, `\n\nBuild.test_x_PINNED_DEFECT_K1 = lambda self: None${MAIN}`),
        'its name is rebound elsewhere in the file (Build.test_x_PINNED_DEFECT_K1 = lambda self: None)'
      ],
      'setUpModule raises SkipTest': [
        plant(MAIN, `\n\ndef setUpModule():\n    raise unittest.SkipTest("later")${MAIN}`),
        'setUpModule raises SkipTest'
      ],
      'load_tests picks the tests': [
        plant(MAIN, `\n\ndef load_tests(loader, tests, pattern):\n    return unittest.TestSuite()${MAIN}`),
        'the module defines load_tests, which picks the tests that run'
      ],
      'unittest.main runs one class': [
        plant('unittest.main(verbosity=2)', 'unittest.main(verbosity=2, defaultTest="Sandbox")'),
        "it runs through unittest.main(verbosity=2, defaultTest='Sandbox'), which can leave it out"
      ],
      'no unittest.main at all': [
        plant('unittest.main(verbosity=2)', 'print("nothing ran")'),
        'the file never calls unittest.main, so running it (as CI does) runs no test'
      ],
      'the class sets __unittest_skip__': [
        plant(BUILD, `${BUILD}    __unittest_skip__ = True\n\n`),
        'Build sets __unittest_skip__'
      ],
      'the class replaces run': [
        plant(BUILD, `${BUILD}    def run(self, result=None):\n        return result\n\n`),
        'Build replaces run, the method that runs the test'
      ],
      'the class replaces _callTestMethod': [
        plant(BUILD, `${BUILD}    def _callTestMethod(self, method):\n        pass\n\n`),
        'Build replaces _callTestMethod, the method that runs the test'
      ],
      'it is marked as an expected failure': [
        plant(MAIN, `\n    test_x_PINNED_DEFECT_K1.__unittest_expecting_failure__ = True${MAIN}`),
        'it is marked as an expected failure, so a failing assertion passes'
      ],
      'a skip bound to a name': [
        plant('def helper():\n', `later = unittest.skip("rewritten later")\n\n\ndef helper():\n`).replace(
          PIN_DEF,
          `    @later\n${PIN_DEF}`
        ),
        '@later'
      ],
      'a skip bound to a name, on its class': [
        plant('def helper():\n', `later = unittest.skip("rewritten later")\n\n\ndef helper():\n`).replace(
          BUILD,
          `@later\n${BUILD}`
        ),
        'its class carries @later'
      ],
      'SkipTest imported under another name': [
        plant('import unittest\n', 'import unittest\nfrom unittest import SkipTest as Pending\n').replace(
          PIN_DEF,
          `${PIN_DEF}        raise Pending("later")\n`
        ),
        'it raises SkipTest'
      ],
      'SkipTest raised through a name': [
        plant(PIN_DEF, `${PIN_DEF}        exc = unittest.SkipTest("later")\n        raise exc\n`),
        'it raises SkipTest'
      ],
      'skipTest through an alias': [
        plant(PIN_DEF, `${PIN_DEF}        skip = self.skipTest\n        skip("later")\n`),
        'it calls skip, which is self.skipTest'
      ],
      'a helper it calls skips': [
        plant('    def vs(self, arg):\n', '    def vs(self, arg):\n        self.skipTest("later")\n'),
        'it calls self.vs, which calls self.skipTest'
      ],
      'a return nested in its last statement': [
        plant(
          '        r = self.vs(1)\n        self.assertEqual(r, helper())\n',
          '        with self.subTest("x"):\n            return\n            r = self.vs(1)\n            self.assertEqual(r, helper())\n'
        ),
        'it returns before its last statement'
      ],
      'its asserts under if False': [
        plant(
          '        self.assertEqual(r, helper())\n',
          '        if False:\n            self.assertEqual(r, helper())\n'
        ),
        'part of it sits under if False, which never runs'
      ],
      'it yields': [
        plant('        self.assertEqual(r, helper())\n', '        yield self.assertEqual(r, helper())\n'),
        'it yields, so unittest gets a generator and runs none of its body'
      ]
    };
    test('says why a Python pinned test would not run, whatever outside its body stops it and however the skip is spelled', () => {
      const renamed = plant(PIN_DEF, '    def check_x_PINNED_DEFECT_K1(self):\n');
      const cases = Object.entries(STOPPERS);
      const [clean, moved, ...pins] = runsOf([RUN, renamed, ...cases.map(([, [text]]) => text)]);
      assert.deepEqual(clean.stops, [], 'the file as written runs its pin');
      assert.deepEqual(moved.stops, ['its name does not start with test, so unittest does not collect it']);
      for (const [k, [what, [, reason]]] of cases.entries())
        assert.ok(pins[k].stops.includes(reason), `${what}: ${JSON.stringify(pins[k].stops)}`);
    });
    test("a Python pin's run context moves with what decides whether it runs, and not with a sibling or a helper it never calls", () => {
      const moves = [
        plant('        self.n = 1\n', '        self.n = 2\n'),
        plant(BUILD, `${BUILD}    def tearDown(self):\n        pass\n\n`),
        plant(BUILD, `${BUILD}    maxDiff = None\n\n`),
        plant(BUILD, `@unittest.mock.patch.dict("os.environ", {})\n${BUILD}`),
        plant('unittest.main(verbosity=2)', 'unittest.main(verbosity=1)'),
        plant(MAIN, `\n\ndef tearDownModule():\n    pass${MAIN}`),
        plant('import unittest\n', 'import unittest as unittest\n'),
        plant(MAIN, `\n\nunittest.TestLoader.sortTestMethodsUsing = None${MAIN}`)
      ];
      const decorated = plant(PIN_DEF, `    @unittest.mock.patch.dict("os.environ", {})\n${PIN_DEF}`);
      const still = [
        plant('        self.assertEqual(self.vs(2), 2)\n', '        self.assertEqual(self.vs(3), 3)\n'),
        plant('class Sandbox(unittest.TestCase):\n', 'class Sandbox(unittest.TestCase):\n    """A doc."""\n'),
        plant('"""M."""\n', '"""M, reworded, the way a header rewrite does."""\n'),
        plant(BUILD, `${BUILD}    "A bare string that stands in for a comment."\n\n`),
        plant('    return 1\n', '    return 1  # a comment\n'),
        plant(MAIN, `\n\nOTHER = 2${MAIN}`)
      ];
      const [was, onPin, ...rest] = runsOf([RUN, decorated, ...moves, ...still]);
      for (const [k, text] of moves.entries()) {
        assert.notEqual(rest[k].context, was.context, text);
        assert.equal(rest[k].fingerprint, was.fingerprint, `what it asserts did not move: ${text}`);
      }
      assert.notEqual(onPin.context, was.context, 'a decorator on the pin is context');
      for (const [k, text] of still.entries()) assert.equal(rest[moves.length + k].context, was.context, text);
    });
    test('a FIX row licenses a changed run context but never a reason not to run; pin-context:<file> re-records contexts only', () => {
      const file = 'scripts/tests/test_k.py';
      const [clean, setUp, expecting, body, both] = treesOf(file, [
        RUN,
        plant('        self.n = 1\n', '        self.n = 2\n'),
        STOPPERS['it is marked as an expected failure'][0],
        plant('        r = self.vs(1)\n', '        r = self.vs(2)\n'),
        plant('        self.n = 1\n', '        self.n = 2\n').replace('self.vs(1)', 'self.vs(2)')
      ]);
      const snapshot = E.collectPinned(clean);
      const ratchet = (extra = {}) => ({
        current_wave: 'A1',
        fingerprint_version: E.FINGERPRINT_VERSION,
        fix_list: [],
        pinned: snapshot,
        ...extra
      });
      const fix = { fix_list: [{ id: 'K1', wave: 'A1' }] };
      assert.deepEqual(
        E.pinnedLeg(setUp, ratchet()).findings.map((f) => f.message.split(', and')[0]),
        ['PINNED DEFECT K1: its run context changed']
      );
      assert.deepEqual(E.pinnedLeg(setUp, ratchet(fix)).findings, [], 'a FIX row for the wave licenses it');
      assert.deepEqual(
        E.pinnedLeg(expecting, ratchet(fix)).findings.map((f) => f.message.split(' (')[0]),
        ['PINNED DEFECT K1: it would no longer run as written'],
        'an expected failure is not fixed, FIX row or none'
      );
      const unfrozen = E.unfreezeRatchet(setUp, ratchet(), [`pin-context:${file}`], REASON, '2026-09-26');
      assert.deepEqual(
        unfrozen.rows.map((r) => [r.what, r.from !== r.to]),
        [[`pin-context ${file}`, true]]
      );
      assert.deepEqual(E.pinnedLeg(setUp, unfrozen.data).findings, [], 'the recorded context is the new one');
      assert.equal(unfrozen.data.pinned[0].fingerprint, snapshot[0].fingerprint, 'and nothing else of the pin moved');
      assert.throws(
        () => E.unfreezeRatchet(body, ratchet(), [`pin-context:${file}`], REASON),
        E.OperatorRefusal,
        'a changed body is not a run context'
      );
      const afterBoth = E.unfreezeRatchet(both, ratchet(), [`pin-context:${file}`], REASON).data;
      assert.deepEqual(
        E.pinnedLeg(both, afterBoth).findings.map((f) => f.message.split(', and')[0]),
        ['PINNED DEFECT K1: its body changed'],
        'pin-context never launders a body'
      );
      const held = E.recordRatchet(setUp, ratchet());
      assert.deepEqual(
        held.held.filter((h) => h.startsWith('pin ')).map((h) => h.split(' (')[1]),
        [`--unfreeze pin-context:${file})`],
        '--record holds a moved context and names the row that licenses it'
      );
    });
    test('the direction leg judges a run context too, and a new pin-context row for its file names it', () => {
      const file = 'scripts/tests/test_k.py';
      const s = synth({ [file]: RUN });
      const base = commitBase(s);
      const stopped = STOPPERS['the base setUp raises SkipTest'][0];
      const [movedTree, skippedTree] = treesOf(file, [plant('        self.n = 1\n', '        self.n = 2\n'), stopped]);
      const moved = { ...movedTree, root: s.root };
      const skipped = { ...skippedTree, root: s.root };
      const head = (unfrozen) => ({
        _schema: E.RATCHET_SCHEMA,
        current_wave: 'A1',
        fingerprint_version: E.FINGERPRINT_VERSION,
        fix_list: [],
        pinned: E.collectPinned(moved),
        raises: [],
        unfrozen
      });
      assert.deepEqual(
        E.directionFindings(moved, head([]), base).findings.map((f) => f.split(' since')[0]),
        [`PINNED DEFECT K1 in ${file} changed its run context`]
      );
      const row = { date: '2026-09-26', from: 'a', reason: REASON, to: 'b', what: `pin-context ${file}` };
      assert.deepEqual(E.directionFindings(moved, head([row]), base).findings, []);
      assert.deepEqual(
        E.directionFindings(skipped, { ...head([row]), pinned: E.collectPinned(skipped) }, base).findings.map(
          (f) => f.split(' (')[0]
        ),
        [`PINNED DEFECT K1 in ${file} no longer runs`],
        'a pin-context row never licenses a reason not to run'
      );
    });
    // A JS pin's run context: a file hook, a suite with its own hook, the pin, and a test beside it.
    const JS_RUN = [
      "import assert from 'node:assert/strict';",
      "import fs from 'node:fs';",
      "import { test, describe, before, after } from 'node:test';",
      '',
      "const TMP = fs.mkdtempSync('x');",
      'after(() => fs.rmSync(TMP, { recursive: true, force: true }));',
      '',
      "describe('the tool', { concurrency: 2 }, () => {",
      "  before(() => { fs.writeFileSync(TMP + '/a', 'a'); });",
      "  test('PINNED DEFECT K1: it reads the file', () => {",
      "    assert.equal(fs.readFileSync(TMP + '/a', 'utf8'), 'a');",
      '  });',
      "  test('another test', () => { assert.ok(1); });",
      '});',
      ''
    ].join('\n');
    const jsPlant = (from, to) => {
      assert.ok(JS_RUN.includes(from), from);
      return JS_RUN.replace(from, to);
    };
    /** The K1 pin of each text, each in a file of its own. */
    const jsRunsOf = (texts) => {
      const pins = E.collectPinned(synth(Object.fromEntries(texts.map((t, k) => [`scripts/tests/test-k${k}.mjs`, t]))));
      return texts.map((_, k) => pins.find((p) => p.file === `scripts/tests/test-k${k}.mjs` && p.ids[0] === 'K1'));
    };
    test("a JS pin's run context moves with its hooks, suites, only marks and exits, and not with an edit beside them", () => {
      const moves = [
        jsPlant("TMP + '/a', 'a');", "TMP + '/a', 'b');"),
        jsPlant('force: true }));', 'force: false }));'),
        jsPlant('{ concurrency: 2 }', '{ concurrency: 1 }'),
        jsPlant("describe('the tool'", "before(() => {});\ndescribe('the tool'"),
        jsPlant("test('another test'", "test.only('another test'"),
        jsPlant("describe('the tool'", "if (!process.env.X) process.exit(0);\ndescribe('the tool'"),
        jsPlant(
          "import { test, describe, before, after } from 'node:test';",
          "import { test, describe, before as b4, after } from 'node:test';"
        ).replace('  before(', '  b4(')
      ];
      const still = [
        jsPlant("describe('the tool'", "// a comment the rewrite adds\ndescribe('the tool'"),
        `${JS_RUN}test('added by the rewrite', () => { assert.ok(1); });\n`,
        jsPlant("import fs from 'node:fs';", "import fs from 'node:fs';\nimport os from 'node:os';"),
        jsPlant('const TMP', 'const ADDED_BY_THE_REWRITE = 1;\nconst TMP'),
        jsPlant("'another test'", "'another test, reworded'"),
        jsPlant(
          'after(() => fs.rmSync(TMP, { recursive: true, force: true }));',
          'after(() =>\n  fs.rmSync(TMP, {\n    recursive: true,\n    force: true,\n  }),\n)'
        ).replace("TMP + '/a', 'a');", 'TMP + "/a", "a")'),
        `${JS_RUN}describe('beside it', () => { beforeEach((t) => t.skip()); });\n`
      ];
      const [was, ...rest] = jsRunsOf([JS_RUN, ...moves, ...still]);
      assert.match(was.context, /^[0-9a-f]{16}$/);
      assert.deepEqual(was.stops, []);
      for (const [k, text] of moves.entries()) {
        assert.notEqual(rest[k].context, was.context, text);
        assert.equal(rest[k].fingerprint, was.fingerprint, `what it asserts did not move: ${text}`);
      }
      for (const [k, text] of still.entries()) {
        const p = rest[moves.length + k];
        assert.deepEqual([p.context, p.fingerprint, p.stops], [was.context, was.fingerprint, []], text);
      }
    });
    test("names each reason a JS pin's run context would not let it run", () => {
      const head = "import assert from 'node:assert/strict';\nimport fs from 'node:fs';";
      const nt = (names) => `import { ${names} } from 'node:test';`;
      const pin = "test('PINNED DEFECT K1: it reads the file', () => { assert.ok(fs); });";
      const cases = {
        'master plant, a beforeEach that skips': [nt('test, after, beforeEach'), 'beforeEach((t) => t.skip());', pin],
        'the same with no import of beforeEach': [nt('test'), 'beforeEach((t) => t.skip());', pin],
        'an aliased hook': [nt('test, beforeEach as each'), 'each((t) => { t.skip(); });', pin],
        'a hook through the namespace': [
          nt('test'),
          "import * as nt from 'node:test';",
          'nt.before((t) => t.skip());',
          pin
        ],
        'a hook-level todo': [nt('test, afterEach'), 'afterEach((t) => { t.todo(); });', pin],
        'a hook running a helper that skips': [
          nt('test, beforeEach'),
          'function guard(t) { t.skip(); }',
          'beforeEach(guard);',
          pin
        ],
        'a hook calling runOnly': [nt('test, before'), 'before((t) => t.runOnly(true));', pin],
        'an after hook that exits': [nt('test, after'), pin, 'after(() => process.exit(0));'],
        'a suite hook': [
          nt('test, describe, beforeEach'),
          "describe('s', () => {",
          '  beforeEach((t) => t.todo());',
          `  ${pin}`,
          '});'
        ],
        'a describe.skip wrapper': [nt('test, describe'), "describe.skip('s', () => {", `  ${pin}`, '});'],
        'a suite skip option': [nt('test, describe'), "describe('s', { skip: 'no' }, () => {", `  ${pin}`, '});'],
        'suite options by name': [
          nt('test, describe'),
          'const O = { skip: true };',
          "describe('s', O, () => {",
          `  ${pin}`,
          '});'
        ],
        'a suite that returns first': [
          nt('test, describe'),
          "describe('s', () => {",
          '  if (!process.env.X) return;',
          `  ${pin}`,
          '});'
        ],
        'a trailing process.exit': [nt('test'), pin, 'process.exit(0);'],
        'an early-exit guard': [nt('test'), 'if (!process.env.CI) process.exit(0);', pin],
        'an exit in a callback the file schedules': [nt('test'), pin, 'setTimeout(() => process.exit(0), 10);'],
        'a helper the file calls that exits': [nt('test'), 'function bail() { process.exit(0); }', 'bail();', pin],
        'a top-level throw': [nt('test'), "if (!fs.existsSync('x')) throw new Error('build first');", pin],
        'another test marked only': [nt('test'), "test.only('other', () => {});", pin],
        'a suite with an only option': [nt('test, describe'), "describe('s', { only: true }, () => {});", pin]
      };
      const quiet = {
        'a hook that cleans up': [
          nt('test, after'),
          "const TMP = fs.mkdtempSync('x');",
          'after(() => fs.rmSync(TMP, { recursive: true }));',
          pin
        ],
        'an exit in a function nobody calls as the file loads': [
          nt('test'),
          'function bail() { process.exit(1); }',
          pin,
          "test('uses it', () => { if (0 > 1) bail(); });"
        ],
        'a return and a throw inside functions': [
          nt('test'),
          "const must = (x) => { if (!x) throw new Error('no'); return x; };",
          pin
        ],
        'a hook of a suite beside it': [
          nt('test, describe, beforeEach'),
          "describe('s', () => { beforeEach((t) => t.skip()); });",
          pin
        ],
        'a skip inside a test, not a hook': [nt('test'), "test('other', (t) => { t.skip(); });", pin],
        'its own only mark': [nt('test'), pin.replace("test('", "test.only('")],
        'an only mark in a string': [nt('test'), "const S = 'test.only(1)';", pin],
        'a local after that is not the hook': [nt('test'), 'function after(x) { return x; }', 'after(1);', pin],
        'a describe the pin sits in, marked only': [
          nt('test, describe'),
          "describe.only('s', () => {",
          `  ${pin}`,
          '});'
        ]
      };
      const files = { ...cases, ...quiet };
      const names = Object.keys(files);
      const cjs = `const { test } = require('node:test');\nif (!process.env.X) return;\n${pin.replace('fs', '1')}\n`;
      const s = synth({
        ...Object.fromEntries(
          names.map((name, k) => [`scripts/tests/test-c${k}.mjs`, `${head}\n${files[name].join('\n')}\n`])
        ),
        'scripts/tests/test-r.cjs': cjs
      });
      const pins = E.collectPinned(s);
      const stopsOf = (k) => pins.find((p) => p.file === `scripts/tests/test-c${k}.mjs`).stops;
      const got = Object.fromEntries(names.map((name, k) => [name, stopsOf(k)]));
      const exit = 'its file calls process.exit() outside any test, so its tests may never run';
      assert.deepEqual(got, {
        'master plant, a beforeEach that skips': ['a beforeEach hook calls t.skip()'],
        'the same with no import of beforeEach': ['a beforeEach hook calls t.skip()'],
        'an aliased hook': ['a beforeEach hook calls t.skip()'],
        'a hook through the namespace': ['a before hook calls t.skip()'],
        'a hook-level todo': ['an afterEach hook calls t.todo()'],
        'a hook running a helper that skips': ['a beforeEach hook runs guard, which calls t.skip()'],
        'a hook calling runOnly': ['a before hook calls t.runOnly()'],
        'an after hook that exits': ['an after hook calls process.exit()'],
        'a suite hook': ['a beforeEach hook of its suite calls t.todo()'],
        'a describe.skip wrapper': ['describe.skip'],
        'a suite skip option': ['a suite with { skip }'],
        'suite options by name': ['a suite around it takes its options by name, so they cannot be read'],
        'a suite that returns first': ['its suite returns before it registers all its tests'],
        'a trailing process.exit': [exit],
        'an early-exit guard': [exit],
        'an exit in a callback the file schedules': [exit],
        'a helper the file calls that exits': ['its file calls bail outside any test, which calls process.exit()'],
        'a top-level throw': ['its file can throw outside any test, before its tests run'],
        'another test marked only': ['another test or suite in its file is marked only'],
        'a suite with an only option': ['another test or suite in its file is marked only'],
        'a hook that cleans up': [],
        'an exit in a function nobody calls as the file loads': [],
        'a return and a throw inside functions': [],
        'a hook of a suite beside it': [],
        'a skip inside a test, not a hook': [],
        'its own only mark': ['test.only'],
        'an only mark in a string': [],
        'a local after that is not the hook': [],
        'a describe the pin sits in, marked only': ['describe.only']
      });
      assert.deepEqual(pins.find((p) => p.file === 'scripts/tests/test-r.cjs').stops, [
        'its file returns at the top level before its tests run'
      ]);
    });
    test('a JS run context is judged like a Python one: FIX rows, pin-context rows, --record and the direction leg', () => {
      const file = 'scripts/tests/test-k.mjs';
      const at = (text) => synth({ [file]: text });
      const clean = at(JS_RUN);
      const moved = at(jsPlant("TMP + '/a', 'a');", "TMP + '/a', 'b');"));
      const skipped = at(jsPlant("describe('the tool'", "beforeEach((t) => t.skip());\ndescribe('the tool'"));
      const snapshot = E.collectPinned(clean);
      const ratchet = (extra = {}) => ({
        current_wave: 'A1',
        fingerprint_version: E.FINGERPRINT_VERSION,
        fix_list: [],
        pinned: snapshot,
        ...extra
      });
      const fix = { fix_list: [{ id: 'K1', wave: 'A1' }] };
      assert.deepEqual(
        E.pinnedLeg(moved, ratchet()).findings.map((f) => f.message.split(', and')[0]),
        ['PINNED DEFECT K1: its run context changed']
      );
      assert.deepEqual(E.pinnedLeg(moved, ratchet(fix)).findings, [], 'a FIX row for the wave licenses it');
      assert.deepEqual(
        E.pinnedLeg(skipped, ratchet(fix)).findings.map((f) => f.message.split(' (')[0]),
        ['PINNED DEFECT K1: it would no longer run as written'],
        'a hook that skips is not fixed, FIX row or none'
      );
      const unfrozen = E.unfreezeRatchet(moved, ratchet(), [`pin-context:${file}`], REASON, '2026-09-26');
      assert.deepEqual(E.pinnedLeg(moved, unfrozen.data).findings, [], 'the recorded context is the new one');
      assert.deepEqual(
        E.recordRatchet(moved, ratchet())
          .held.filter((h) => h.startsWith('pin '))
          .map((h) => h.split(' (')[1]),
        [`--unfreeze pin-context:${file})`]
      );
      assert.ok(
        E.ratchetProblems(ratchet({ pinned: snapshot.map((p) => ({ ...p, context: null })) }), new Set()).some((p) =>
          p.endsWith('carries no run context, and every js pin has one: --record re-records it')
        ),
        'a JS snapshot row with no context is refused'
      );
      const base = commitBase(clean);
      const head = (tree, unfrozenRows) => ({
        _schema: E.RATCHET_SCHEMA,
        current_wave: 'A1',
        fingerprint_version: E.FINGERPRINT_VERSION,
        fix_list: [],
        pinned: E.collectPinned(tree),
        raises: [],
        unfrozen: unfrozenRows
      });
      const onBase = (tree) => ({ ...tree, root: clean.root });
      assert.deepEqual(
        E.directionFindings(onBase(moved), head(moved, []), base).findings.map((f) => f.split(' since')[0]),
        [`PINNED DEFECT K1 in ${file} changed its run context`]
      );
      const row = { date: '2026-09-26', from: 'a', reason: REASON, to: 'b', what: `pin-context ${file}` };
      assert.deepEqual(E.directionFindings(onBase(moved), head(moved, [row]), base).findings, []);
      assert.deepEqual(
        E.directionFindings(onBase(skipped), head(skipped, [row]), base).findings.map((f) => f.split(' (')[0]),
        [`PINNED DEFECT K1 in ${file} no longer runs`],
        'a pin-context row never licenses a reason not to run'
      );
    });
    test('a pin that gains a reason not to run fails even on the FIX list; a recorded reason passes', () => {
      const file = (skip) =>
        `test('PINNED DEFECT R9-9: it exits one', ${skip ? '{ skip: process.platform === "win32" }, ' : ''}() => {\n  assert.equal(run(), 1);\n});\ntest${skip ? '.skip' : ''}('PINNED DEFECT T1: fixed on purpose', () => { assert.ok(true); });\n`;
      const snapshot = E.collectPinned(synth({ 'scripts/tests/test-p.mjs': file(false) }));
      const guarded = E.collectPinned(synth({ 'scripts/tests/test-p.mjs': file(true) }));
      const l = E.pinnedLeg(synth({ 'scripts/tests/test-p.mjs': file(true) }), {
        pinned: snapshot,
        current_wave: 'A1',
        fix_list: [{ id: 'T1', wave: 'A1' }]
      });
      assert.deepEqual(
        l.findings.map((f) => f.message.slice(0, 55)),
        [
          'PINNED DEFECT R9-9: it would no longer run as written (',
          'PINNED DEFECT T1: it would no longer run as written (te',
          'PINNED DEFECT R9-9: its body changed, and no id is on t'
        ]
      );
      const again = E.pinnedLeg(synth({ 'scripts/tests/test-p.mjs': file(true) }), { pinned: guarded, fix_list: [] });
      assert.deepEqual(again.findings, [], 'a reason the snapshot recorded is not new');
    });
    test('a weakened helper moves every pin that calls it; an unrelated top-level change moves none', () => {
      const js = (helper, other) =>
        `const OTHER = ${other};\nconst check = (x) => ${helper};\ntest('PINNED DEFECT H1: uses the helper', () => {\n  assert.equal(check(1).code, 1);\n});\n`;
      const fp = (text) => E.collectPinned(synth({ 'scripts/tests/test-h.mjs': text }))[0].fingerprint;
      assert.equal(fp(js('run(x)', 1)), fp(js('run(x)', 2)), 'OTHER is not named by the pin');
      assert.notEqual(fp(js('run(x)', 1)), fp(js('({ code: 1 })', 1)), 'check is');
      const py = (helper, setup, vs = 'arg', unused = '0') =>
        `"""M."""\nimport unittest\n\n\ndef helper():\n    """Doc."""\n    return ${helper}\n\n\nclass Sandbox(unittest.TestCase):\n    def vs(self, arg):\n        return ${vs}\n\n    def unused(self):\n        return ${unused}\n\n\nclass T(Sandbox):\n    def setUp(self):\n        self.n = ${setup}\n\n    def test_x_PINNED_DEFECT_H2(self):\n        self.assertEqual(helper(), self.vs(1))\n\n\nif __name__ == "__main__":\n    unittest.main()\n`;
      const variants = [
        py('1', '1'),
        py('2', '1'),
        py('1', '1', '1'),
        py('1', '1', 'arg', '1'),
        py('1', '2'),
        py('1', '1').replace('"""Doc."""', '"""Another doc."""')
      ];
      const [was, helper, inherited, unused, setUp, doc] = runsOf(variants);
      assert.notEqual(helper.fingerprint, was.fingerprint, 'a module-level helper it calls');
      assert.notEqual(inherited.fingerprint, was.fingerprint, 'a helper it inherits from a base class of the file');
      assert.equal(unused.fingerprint, was.fingerprint, 'a base-class method it never calls');
      assert.notEqual(setUp.context, was.context, 'the setUp that runs before it: its context');
      assert.equal(setUp.fingerprint, was.fingerprint, 'the setUp is context, not what it asserts');
      assert.equal(doc.fingerprint, was.fingerprint, 'a docstring');
    });
    test('in the Kit a pinned file the online tree drops is still judged; a generated tree skips what it does not hold', () => {
      const s = synth({
        'scripts/tests/test-d.mjs': "test('PINNED DEFECT D9: kit only', () => { assert.equal(r.code, 1); });\n"
      });
      const snapshot = E.collectPinned(s);
      const flipped = synth({
        'scripts/tests/test-d.mjs': "test('PINNED DEFECT D9: kit only', () => { assert.equal(r.code, 0); });\n"
      });
      const kit = { ...flipped, isKit: true, files: [], extraTests: flipped.files };
      assert.equal(E.pinnedLeg(kit, { pinned: snapshot }).findings.length, 1, 'the Kit judges it');
      const online = { ...flipped, isKit: false, files: [], extraTests: [], tracked: new Set() };
      const l = E.pinnedLeg(online, { pinned: snapshot });
      assert.deepEqual([l.findings.length, l.skipped], [0, 1], 'a generated tree without the file skips it');
    });
    test('the tree: no pinned assertion changed outside the FIX list', () => {
      const l = legs.get('pinned');
      console.log(
        `code-standard: pinned ${l.total} assertions in scope, ${(ratchet.pinned || []).length} recorded, ${l.fixed.length} changed under the FIX list, ${l.added} new, ${l.skipped} out of scope here`
      );
      if (!l.comparable)
        console.log(
          `code-standard: pinned: the snapshot was recorded under fingerprint version ${ratchet.fingerprint_version}, not ${E.FINGERPRINT_VERSION}, so it was not compared; --record re-records it, and the direction leg judged every pin`
        );
      for (const f of l.fixed) console.log(`    fixed: ${f}`);
      assert.ok((ratchet.pinned || []).length > 0, 'the snapshot is empty, so nothing is judged; run --record');
      assert.deepEqual(
        l.findings.map((f) => `${f.file}:${f.line} ${f.message}`),
        []
      );
    });
  });

  describe('homes', () => {
    test('a concern whose home or sanctioned key names no tracked file fails; a planned home and a real home do not', () => {
      // Built on the REAL ctx's own tracked set (not a fresh synth(), which would leave every genuine
      // CONCERNS home phantom against a two-file fixture): homesLeg reads the module-level CONCERNS
      // directly, so it always judges the real home list, whatever ctx it is handed.
      const s = { ...ctx, isKit: true, tracked: new Set([...ctx.tracked, 'scripts/lib/zz-real.js']) };
      // The failing-first plant is four throwaway concerns pushed onto the real array, and one planned
      // home added to the real list, each removed again in `finally` either way.
      const planted = [
        { id: 'zz-phantom', home: ['scripts/lib/zz-does-not-exist.js'] },
        { id: 'zz-planned', home: ['scripts/lib/zz-planned.js'] },
        { id: 'zz-sane', home: ['scripts/lib/zz-real.js'] },
        { id: 'zz-sanction', home: [], sanctioned: { 'scripts/lib/zz-also-missing.js': 'named by the master' } }
      ];
      E.CONCERNS.push(...planted);
      E.PLANNED_HOMES['scripts/lib/zz-planned.js'] = 'planted by this test';
      try {
        const findings = E.homesLeg(s).findings.map((f) => f.file);
        assert.deepEqual(
          findings.sort(),
          ['scripts/lib/zz-also-missing.js', 'scripts/lib/zz-does-not-exist.js'],
          'only the true phantom and the phantom sanctioned key are caught; the planned home and the real file are not'
        );
      } finally {
        E.CONCERNS.length -= planted.length;
        delete E.PLANNED_HOMES['scripts/lib/zz-planned.js'];
      }
    });
    test("the real tree's homes and sanctioned keys are each a tracked file, and no home is planned today", () => {
      const l = E.homesLeg(ctx);
      assert.deepEqual(l.findings, []);
      assert.deepEqual(Object.keys(l.planned), []);
    });
    test('the tree: the homes count does not rise, and no enforced file names a phantom home', () => holds('homes'));
  });

  describe('duplication', () => {
    test("every concern counts a planted copy, and never the concern's home or a test", () => {
      const plant = [
        "const R = path.join(__dirname, '..');",
        'const a = process.argv.slice(2);',
        "const j = JSON.parse(fs.readFileSync(p, 'utf8'));",
        "const rows = JSON.parse(fs.readFileSync('system/run-log.jsonl', 'utf8'));",
        'const none = /L:?\\s*none/;',
        "const B = '<!-- ROUTING-TABLE:BEGIN';",
        "spawnSync('git', ['diff', '--cached']);",
        'const hit = c.isDir ? rel.startsWith(c.prefix) : rel === c.prefix;',
        'const rows = text.split(/\\n/).filter((l) => /^\\|.*\\|\\s*MANDATORY\\s*\\|/.test(l));',
        "const L = 'system/migrations-applied.json';",
        "const P = JSON.parse(fs.readFileSync('system/install-profile.json'));",
        'process.exit(2);',
        'class Refusal extends Error {}',
        'const isMain = true;',
        'const job = /Alex-[A-Za-z0-9-]+/g;',
        "const pad = (n) => String(n).padStart(2, '0');",
        'const row = JSON.stringify(JSON.parse(canonicalText(r)));',
        "const S = 'system/template-source.json';"
      ].join('\n');
      const shell = '#!/bin/sh\nlastline() { tail -n 1; }\nMAX_BLOB_BYTES=10\n';
      const s = synth({
        'scripts/planted.js': `${HEAD}${plant}\n`,
        'scripts/planted.sh': shell,
        'scripts/lib/repo-root.js': `${HEAD}const R = path.join(__dirname, '..');\n`,
        'scripts/tests/test-planted.mjs': `${HEAD}import { test } from 'node:test';\nconst R = path.join(__dirname, '..');\n`,
        'scripts/tests/test-handrolled.mjs': `${HEAD}let pass = 0;\n`
      });
      const counts = Object.fromEntries(E.duplicationLegs(s).map((l) => [l.name, l.findings.map((f) => f.file)]));
      for (const c of E.CONCERNS) {
        const want =
          c.id === 'dup-test-helpers'
            ? ['scripts/tests/test-handrolled.mjs']
            : ['dup-lastline', 'dup-max-blob-bytes'].includes(c.id)
              ? ['scripts/planted.sh']
              : ['scripts/planted.js'];
        assert.deepEqual(counts[c.id], want, c.id);
      }
    });
    test('counts a copy spelled the other common way, and a helper under scripts/tests/ that is not a test', () => {
      const other = [
        "const REPO = path.resolve(__dirname, '../..');",
        'const EXIT_REFUSED = 2;',
        "const raw = fs.readFileSync(path.join(REPO, rel), 'utf8');",
        'const config = JSON.parse(raw);',
        'const [, , rel] = process.argv;',
        'if (!rel) process.exit(EXIT_REFUSED);'
      ].join('\n');
      const literal = "export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');\n";
      const s = synth({
        'scripts/other.js': `${HEAD}${other}\n`,
        'scripts/tests/shared-helpers.mjs': `${HEAD}${literal}`,
        'scripts/tests/fixtures/f.js': `${HEAD}${literal}`
      });
      const got = Object.fromEntries(
        E.duplicationLegs(s)
          .filter((l) => l.findings.length)
          .map((l) => [l.name, l.findings.map((f) => f.file)])
      );
      assert.deepEqual(got, {
        'dup-repo-root': ['scripts/other.js', 'scripts/tests/shared-helpers.mjs'],
        'dup-args': ['scripts/other.js'],
        'dup-json-read': ['scripts/other.js'],
        'dup-exit-two': ['scripts/other.js']
      });
    });
    test("a hand-rolled parser literally named parseArgs is not exempt; importing node's own parseArgs is", () => {
      const s = synth({
        'scripts/hand.js': `${HEAD}function parseArgs(argv) { return argv.slice(2); }\nconst a = process.argv.slice(2);\n`,
        'scripts/real.js': `${HEAD}import { parseArgs } from 'node:util';\nconst a = process.argv.slice(2);\n`,
        'scripts/real-cjs.js': `${HEAD}const { parseArgs } = require('node:util');\nconst a = process.argv.slice(2);\n`
      });
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-args')
          .findings.map((f) => f.file),
        ['scripts/hand.js']
      );
    });
    test('a function whose own return value reaches process.exit, and that returns 2 or EXIT.REFUSED in its own body, counts even with no literal process.exit(2) or named constant', () => {
      const s = synth({
        'scripts/via-return.js': `${HEAD}function main(argv) {\n  if (!argv.length) return 2;\n  return 0;\n}\nprocess.exit(main(process.argv.slice(2)));\n`,
        'scripts/via-exit-refused.js': `${HEAD}function run() {\n  return EXIT.REFUSED;\n}\nprocess.exitCode = run();\n`,
        'scripts/no-exit-call.js': `${HEAD}function helper() {\n  return 2;\n}\nconst x = helper();\n`
      });
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-exit-two')
          .findings.map((f) => f.file)
          .sort(),
        ['scripts/via-exit-refused.js', 'scripts/via-return.js']
      );
    });
    test('counts a pad whose value is a member expression, and not one whose value is a call', () => {
      const s = synth({
        'scripts/member.js': `${HEAD}const num = (p) => \`#\${String(p.num).padStart(2, '0')} \`;\n`,
        'scripts/call.js': `${HEAD}const hour = (d) => String(d.getHours()).padStart(2, '0');\n`
      });
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-pad-esc')
          .findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/member.js:8']
      );
    });
    test('leaves out the sanctioned repo-root copies, each with its reason, and still counts any other copy', () => {
      const { sanctioned } = E.CONCERNS.find((c) => c.id === 'dup-repo-root');
      assert.deepEqual(Object.keys(sanctioned), [
        'scripts/lib/atomic-write.js',
        'scripts/capture-typed-input.js',
        'scripts/lib/gen-launchd.js',
        'scripts/lib/write-lock.js',
        'scripts/autosave.sh',
        'scripts/close-out-online.sh',
        'scripts/hooks/pre-commit',
        'kit:scripts/hooks/pre-commit',
        'scripts/run-log.mjs',
        'scripts/outputs-ledger.js',
        'scripts/waiting-on-them.js',
        'scripts/human-actions.js',
        'scripts/untrusted-lane-guard.js',
        'scripts/status-rotate.js',
        'scripts/lib/build-soul-core.js',
        'work/18-recovery-layer/check.mjs',
        'scripts/build-online-template.mjs',
        'scripts/employer-data-guard.mjs'
      ]);
      for (const c of E.CONCERNS)
        for (const [file, reason] of Object.entries(c.sanctioned ?? {}))
          assert.ok(reason.split(/\s+/).length >= 3, `${c.id} ${file}: ${reason}`);
      const root = `${HEAD}const REPO = path.join(__dirname, '..', '..');\n`;
      // kit: is not a real path synth() could write to disk; the sanction check above already covers
      // it by name, so only the plain paths are built into a tree here.
      const plainKeys = Object.keys(sanctioned).filter((f) => !f.startsWith(E.KIT_ONLY_PREFIX));
      const s = synth({
        ...Object.fromEntries(plainKeys.map((f) => [f, root])),
        'scripts/lib/lone.js': root
      });
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-repo-root')
          .findings.map((f) => f.file),
        ['scripts/lib/lone.js']
      );
    });
    test('a sanctioned file stays clean however far down the file its copy sits: the key is the path, never a line', () => {
      const copy = "const staged = spawnSync('git', ['diff', '--cached', '--name-only']);\n";
      const atTop = synth({ 'scripts/secret-scan.mjs': `${HEAD}${copy}` });
      const pushedDown = synth({ 'scripts/secret-scan.mjs': `${HEAD}\n\n\n\n\n${copy}` });
      for (const s of [atTop, pushedDown])
        assert.deepEqual(
          E.duplicationLegs(s)
            .find((l) => l.name === 'dup-staged-paths')
            .findings.map((f) => f.file),
          [],
          'a sanctioned path is skipped before any line in it is ever read'
        );
      // The same file, unsanctioned under a name CONCERNS never names, still counts: the blank lines
      // above prove the copy itself would otherwise be found, at whatever line it has moved to.
      const unsanctioned = synth({ 'scripts/not-sanctioned.mjs': `${HEAD}\n\n\n\n\n${copy}` });
      assert.deepEqual(
        E.duplicationLegs(unsanctioned)
          .find((l) => l.name === 'dup-staged-paths')
          .findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/not-sanctioned.mjs:13']
      );
    });
    test('counts the job prefix anchored at the start of a regular expression', () => {
      const s = synth({ 'scripts/anchored.js': `${HEAD}const suffix = (job) => job.replace(/^Alex-/, '');\n` });
      assert.deepEqual(
        E.duplicationLegs(s)
          .find((l) => l.name === 'dup-job-name-regex')
          .findings.map((f) => `${f.file}:${f.line}`),
        ['scripts/anchored.js:8']
      );
    });
    for (const c of E.CONCERNS) test(`the tree: ${c.id} (concern ${c.concern}) holds its ceiling`, () => holds(c.id));
  });
}
