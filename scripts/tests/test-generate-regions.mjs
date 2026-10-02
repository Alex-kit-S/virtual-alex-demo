#!/usr/bin/env node
// scripts/tests/test-generate-regions.mjs - what scripts/generate-alex.js writes into files an owner edits.
//
// WHAT. Every region marker the generator owns is held exactly: a command file's header is restored under
// its H1 with the right spacing, an orphaned or unrendered header is left alone, a validation failure
// prints once to the console and once (without the validator's own warnings) into refactor/last-run.log,
// and the shared write lock is taken, held and released as the generator takes it, including a steal of a
// lock left over 30 minutes old. Deleted, a marker regression could overwrite an owner's own prose outside
// a region, leave a stale header unmaintained, or let two runs write the same files at once. The docs and
// routines surfaces (the online schedule, the three "Generated" dates, a FULL run, and the drift-and-swap
// behaviour over every region at once) need a variants/online/ source only the Kit holds, so those cases
// are test-generate-regions-kit.mjs's, split out when a generated online tree could not render them.
//
// HOW. scripts/tests/fixtures/validator-tree.mjs builds a temp git repository from this checkout's
// tracked files (`.agents/` left out: the generator and its validation never read it) for each test, and
// the real generator runs in it. scripts/tests/fixtures/scheduler-stub.cjs is the preload, loaded before
// any Kit code: C4_PLATFORM pins process.platform to win32, so the scheduler path is the same on every
// runner; C4_NOW pins the clock, because three generated docs carry the UTC date; C4_LIVE answers
// `schtasks /query /fo CSV` with a list (every documented job, unless a test says otherwise), a
// `schtasks /create` is recorded (C4_SCHED_LOG) without running, and every other schtasks, launchctl and
// crontab call is refused, so no run can register, change or delete a task on this machine. HOME and
// USERPROFILE point at the temp folder.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-generate-regions.mjs
// Exit: 0 all cases passed - 1 a case failed

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
const ROOT = makeRoot('alex-gen-regions-');
const BASE = path.join(ROOT, 'base');
const ENV = { ...pinnedGitEnv(ROOT), CLAUDE_CODE_REMOTE: '' };
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);

// The markers, exactly as the generator and G2-G4 read them.
const RT_BEGIN = '<!-- ROUTING-TABLE:BEGIN';
const RT_END = '<!-- ROUTING-TABLE:END -->';
const PT_BEGIN = '<!-- PROJECT-TABLE:BEGIN';
const PT_END = '<!-- PROJECT-TABLE:END -->';
const CZ_START = '<!-- CUSTOM_START -->';
const CZ_END = '<!-- CUSTOM_END -->';
const RO_BEGIN = '<!-- ROUTINES:BEGIN';
const RO_END = '<!-- ROUTINES:END -->';
const CMD_BEGIN =
  '<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->';
const CMD_END = '<!-- ALEX:CMD-HEADER:END -->';
const ONLINE_SCHEDULE = 'variants/online/scheduler/schedule.md';

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
const count = (text, s) => text.split(s).length - 1;

const tree = makeTreeFactory(BASE, ROOT);
let seq = 0;
let STAMP, DOCUMENTED, HAS_ROUTINES;

function gen(dir, args, env = {}, cwd = dir) {
  const log = path.join(ROOT, `sched-${++seq}.log`);
  return spawnCollect(['-r', STUB, path.join(dir, 'scripts', 'generate-alex.js'), ...args], {
    cwd,
    env: {
      ...ENV,
      C4_PLATFORM: 'win32',
      C4_NOW: `${STAMP}T12:00:00Z`,
      C4_LIVE: DOCUMENTED.join(','),
      C4_SCHED_LOG: log,
      ...env
    }
  }).then((r) => ({
    ...r,
    // schtasks lines only: the shared stub also logs every powershell call it inspects (answered,
    // refused or passed through, V18 (f)'s parse sweep among them), which this file's tests never assert on.
    sched: (fs.existsSync(log) ? lines(fs.readFileSync(log, 'utf8')) : []).filter((l) => l.startsWith('schtasks '))
  }));
}

before(() => {
  writeGitConfig(ROOT, 'generator fixture');
  buildBaseTree(KIT, BASE, ENV);
  STAMP = read(BASE, 'docs/GETTING-STARTED.md').match(/Generated (\d{4}-\d{2}-\d{2})/)[1];
  DOCUMENTED = require(path.join(BASE, 'scripts', 'lib', 'read-sources.js')).parseScheduleJobs(
    read(BASE, 'scheduler/schedule.md')
  ).allJobNames;
  HAS_ROUTINES = fs.existsSync(path.join(BASE, ONLINE_SCHEDULE));
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('generate-alex: the surfaces it owns inside files an owner edits', { concurrency: CONCURRENCY }, () => {
  test('every region marker is where the contract says, exactly once, and the BEGIN lines come from the templates', () => {
    const tpl = read(BASE, 'templates/routing-table.template.md');
    const rtBegin = tpl.split(/\r?\n/).find((l) => l.startsWith(RT_BEGIN));
    const ptBegin = tpl.split(/\r?\n/).find((l) => l.startsWith(PT_BEGIN));
    assert.ok(rtBegin && ptBegin, 'the routing-table template carries both BEGIN lines');
    const claude = read(BASE, 'CLAUDE.md');
    assert.equal(count(claude, rtBegin), 1);
    assert.equal(count(claude, RT_END), 1);
    const arch = read(BASE, 'docs/ARCHITECTURE.md');
    assert.equal(count(arch, rtBegin), 1, 'ARCHITECTURE embeds the constitution, markers included');
    assert.equal(count(arch, RT_END), 1);
    const proj = read(BASE, 'docs/projects/README.md');
    assert.equal(count(proj, ptBegin), 1);
    assert.equal(count(proj, PT_END), 1);
    const readme = read(BASE, 'docs/README.md');
    assert.equal(count(readme, CZ_START), 1);
    assert.equal(count(readme, CZ_END), 1);
    const schedRel = HAS_ROUTINES ? ONLINE_SCHEDULE : 'scheduler/schedule.md';
    const sched = read(BASE, schedRel);
    assert.equal(count(sched, RO_BEGIN), 1, schedRel);
    assert.equal(count(sched, RO_END), 1, schedRel);
    const genCmd = require(path.join(BASE, 'scripts', 'lib', 'gen-command-headers.js'));
    assert.equal(genCmd.BEGIN, CMD_BEGIN);
    assert.equal(genCmd.END, CMD_END);
    const m = JSON.parse(read(BASE, 'system/manifest.json'));
    for (const t of genCmd.targets(m)) {
      if (!fs.existsSync(path.join(BASE, t.rel))) continue;
      const text = read(BASE, t.rel);
      assert.equal(count(text, CMD_BEGIN), 1, t.rel);
      assert.equal(count(text, CMD_END), 1, t.rel);
      assert.ok(text.includes(genCmd.block(t)), `${t.rel} carries exactly the block the registry renders`);
    }
    for (const rel of ['docs/GETTING-STARTED.md', 'docs/ARCHITECTURE.md', 'docs/README.md'])
      assert.match(read(BASE, rel), /Generated \d{4}-\d{2}-\d{2}/, `${rel} carries the generation date`);
  });

  test('a command file that lost its header gets it back directly under its H1, with a blank line before it and the old spacing after', async () => {
    const dir = tree();
    const genCmd = require(path.join(dir, 'scripts', 'lib', 'gen-command-headers.js'));
    const target = genCmd
      .targets(JSON.parse(read(dir, 'system/manifest.json')))
      .find((x) => fs.existsSync(path.join(dir, x.rel)) && /^#\s+/m.test(read(dir, x.rel)));
    const block = genCmd.block(target);
    const text = read(dir, target.rel);
    const planted = text.replace(block, '');
    write(dir, target.rel, planted);
    const h1 = planted.split('\n').find((l) => /^#\s+/.test(l));
    const r = await gen(dir, ['--only=commands']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('  staged command headers: 1 file(s) changed of '), r.stdout);
    assert.equal(read(dir, target.rel), planted.replace(`${h1}\n`, `${h1}\n\n${block}\n`));
  });

  test('PINNED DEFECT R6-13: a header on a command the registry does not render (not LIVE/EVENT) is never maintained, and an empty marker pair stays empty', async () => {
    const dir = tree();
    const genCmd = require(path.join(dir, 'scripts', 'lib', 'gen-command-headers.js'));
    const rendered = new Set(genCmd.targets(JSON.parse(read(dir, 'system/manifest.json'))).map((x) => x.rel));
    const cmdDir = path.join(dir, '.claude', 'commands');
    const withBlock = fs
      .readdirSync(cmdDir)
      .map((f) => `.claude/commands/${f}`)
      .filter((rel) => !rendered.has(rel) && read(dir, rel).includes(CMD_BEGIN));
    assert.ok(withBlock.length > 0, 'fixture: some command file carries a header the registry does not render');
    const orphan = withBlock.find((rel) => {
      const t = read(dir, rel);
      return t.indexOf(CMD_END) - t.indexOf(CMD_BEGIN) > CMD_BEGIN.length + 2;
    });
    const empty = withBlock.filter((rel) => {
      const t = read(dir, rel);
      return t.indexOf(CMD_END) - t.indexOf(CMD_BEGIN) <= CMD_BEGIN.length + 2;
    });
    const before = Object.fromEntries(withBlock.map((rel) => [rel, read(dir, rel)]));
    if (orphan) replaceOnce(dir, orphan, CMD_END, 'ZZ nobody maintains this block.\n' + CMD_END);
    const r = await gen(dir, ['--only=commands']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    if (orphan)
      assert.ok(
        read(dir, orphan).includes('ZZ nobody maintains this block.'),
        `${orphan}: the generator left its block alone`
      );
    for (const rel of empty) assert.equal(read(dir, rel), before[rel], `${rel}: the empty pair is untouched`);
  });

  test('PINNED DEFECT R6-11: the command-header surface reads from the CWD, so run from another folder it stages nothing while V15 tells the owner to run the generator', async () => {
    const dir = tree();
    const genCmd = require(path.join(dir, 'scripts', 'lib', 'gen-command-headers.js'));
    const target = genCmd
      .targets(JSON.parse(read(dir, 'system/manifest.json')))
      .find((x) => fs.existsSync(path.join(dir, x.rel)));
    replaceOnce(dir, target.rel, `· ${target.project.state} ·`, '· PARKED ·');
    const here = await gen(dir, ['--dry-run', '--only=commands']);
    assert.equal(here.status, 0, here.stdout + here.stderr);
    assert.ok(here.stdout.includes('  staged command headers: 1 file(s) changed of '), here.stdout);
    assert.ok(fs.existsSync(path.join(dir, '.staging', ...target.rel.split('/'))), 'staged from the repo root');
    const away = await gen(dir, ['--dry-run', '--only=commands'], {}, ROOT);
    assert.equal(away.status, 0, away.stdout + away.stderr);
    assert.ok(away.stdout.includes('  staged command headers: 0 file(s) changed of '), away.stdout);
    assert.ok(
      lines(away.stderr).some((l) =>
        l.startsWith('WARNING V15: command header(s) drifted from system/manifest.json: ' + target.rel)
      ),
      away.stderr
    );
  });

  test("PINNED DEFECT R6-17 and R6-24: a validation failure is printed twice, and refactor/last-run.log keeps it but none of the validator's warnings", async () => {
    const dir = tree();
    const m = JSON.parse(read(dir, 'system/manifest.json'));
    const n = m.projects.filter((p) => p.state !== 'RETIRED').length;
    const h = read(dir, 'docs/GETTING-STARTED.md').match(
      /^(## \d+\. The automations \()(\d+)( registered, non-retired\))/m
    );
    replaceOnce(dir, 'docs/GETTING-STARTED.md', h[0], `${h[1]}${n + 1}${h[3]}`);
    const r = await gen(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const v1 = `FAILED V1: automation count mismatch - docs/GETTING-STARTED.md (repo) says ${n + 1}, system/manifest.json says ${n}`;
    assert.equal(
      count(r.stdout + r.stderr, v1),
      2,
      "once from the validator, once inside the generator's own FAILED line"
    );
    assert.ok(lines(r.stdout).includes('FAILED: validation failed:'), r.stdout);
    assert.ok(!fs.existsSync(path.join(dir, '.staging')), 'a failed run deletes staging');
    const log = read(dir, 'refactor/last-run.log');
    assert.ok(log.includes('FAILED: validation failed:') && log.includes(v1), 'the log keeps the failure');
    assert.ok(!log.includes('WARNING'), "the validator's warnings are not in the log");
    assert.match(
      log.split('\n')[0],
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] generate-alex: DRY-RUN \(only: claude\)$/
    );
  });

  test('the write lock: a held lock refuses the run before anything is staged, names the holder and the lock path, and is left in place', async () => {
    const dir = tree();
    const lockDir = path.join(dir, '.alex-lock-alex-surfaces');
    fs.mkdirSync(lockDir);
    const holder = { label: 'another session', pid: 424242, since: '2026-09-25T08:00:00.000Z' };
    fs.writeFileSync(path.join(lockDir, 'holder.json'), JSON.stringify(holder, null, 2));
    const r = await gen(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(
      lines(r.stdout).includes(
        `FAILED: another repo-surface mutator holds the write lock (held by another session (pid 424242) since 2026-09-25T08:00:00.000Z). Wait for it to finish, or - if you are sure that process is dead - remove ${lockDir}`
      ),
      r.stdout
    );
    assert.ok(!r.stdout.includes('[1/5]'), 'refused before reading a source');
    assert.ok(fs.existsSync(path.join(lockDir, 'holder.json')), "the holder's lock is untouched");
  });

  test('the write lock: a lock older than 30 minutes is stolen and the steal is logged; the run releases it on success and on failure', async () => {
    const dir = tree();
    const lockDir = path.join(dir, '.alex-lock-alex-surfaces');
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, 'holder.json'),
      JSON.stringify({ label: 'crashed run', pid: 424242, since: '2026-09-25T07:00:00.000Z' }, null, 2)
    );
    const old = new Date(Date.parse(`${STAMP}T12:00:00Z`) - 45 * 60 * 1000); // 45 minutes before the pinned clock
    fs.utimesSync(lockDir, old, old);
    const r = await gen(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(
      lines(r.stdout).includes(
        "write-lock: stealing a STALE 'alex-surfaces' lock (age 45min, holder crashed run pid 424242) - a prior run almost certainly crashed"
      ),
      r.stdout
    );
    assert.ok(!fs.existsSync(lockDir), 'released after a successful run');
    replaceOnce(dir, 'CLAUDE.md', RT_END, '<!-- gone -->');
    const f = await gen(dir, ['--dry-run', '--only=docs']);
    assert.equal(f.status, 1, f.stdout + f.stderr);
    assert.ok(!fs.existsSync(lockDir), 'released after a failed run');
  });
});
