#!/usr/bin/env node
// scripts/tests/test-generate-online-tree.mjs - scripts/generate-alex.js run inside the online (Virtual Alex) tree.
//
// WHAT. An owner's /setup and /new tell the model to run the generator in the online tree, which has no
// variants/. These tests prove that run works there: it renders only the surfaces valid online, names what it
// skipped on its step lines, never writes the laptop routing rows into the online CLAUDE.md, registers nothing,
// and leaves every file the build landed as it was, the day's date stamp aside. They also prove the stale-status
// advisory, a laptop organ the online tree does not ship, is named absent in one line and never started, while a
// tree that holds it runs it as before. Deleted, this file would let through an online generator that fails on
// the missing variants/ path, overwrites the online constitution with the registry's laptop rows, reaches for a
// scheduler on the cloud VM, or prints a missing-module stack trace on every run.
//
// HOW. In the Kit the online tree is laid out by scripts/build-online-template.mjs's own planTree() from a temp
// git repository of this checkout's tracked files (.agents/ left out), exactly as a build lands it; inside a
// generated template the checkout already IS that tree and is copied as it is. Each case copies the tree again
// and runs the real generator as a child process, behind a preload that pins the platform to linux (the cloud
// VM) and refuses every scheduler call. The rule the cases hold, in a tree without variants/online:
//   rendered  docs/GETTING-STARTED.md, docs/README.md, docs/projects/README.md, the command headers, the brand
//             tokens, and the routines surfaces: the ROUTINES region of scheduler/schedule.md (the path the
//             online schedule carries; in the Kit it is variants/online/scheduler/schedule.md) and
//             docs/ROUTINES-FORMS.md. Their render equals the file the build lands, so a second run is a no-op
//   skipped   the CLAUDE.md routing region and docs/ARCHITECTURE.md, which embeds it (the Kit owns the online
//             constitution, and the registry's rows are the laptop's), and the scheduler (the Routines are the
//             schedule; nothing registers on a machine)
// The stale-status cases add a spy ahead of the preload that records every command handed to execSync, which
// tells a step never started from one started and silenced. test-generate-kit-selection.mjs holds the Kit's
// own dry-run selection and its installer hint, split out when a generated online tree has no Kit checkout
// to build that comparison from.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-generate-online-tree.mjs
// Exit: 0 every case passed - 1 a case failed

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makeRoot, pinnedGitEnv, writeGitConfig, gitIn, spawnCollect } from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IN_KIT = fs.existsSync(path.join(KIT, 'variants', 'online'));
const require = createRequire(import.meta.url);
const ROOT = makeRoot('alex-gen-online-');
const KITCOPY = path.join(ROOT, 'kit');
const ONLINE = path.join(ROOT, 'online');
const STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const ENV = { ...pinnedGitEnv(ROOT), CLAUDE_CODE_REMOTE: 'true' };
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);
const MISSING_VARIANT = 'variants/online/scheduler/schedule.md is missing';
const RT_BEGIN = '<!-- ROUTING-TABLE:BEGIN';
const RT_END = '<!-- ROUTING-TABLE:END -->';
const RENDER_ONLINE = /^\[2\/5\] render to \.staging\/ \(online tree, no variants\/online: (.*)\)$/m;
const SKIPPED_ALL = 'skipped the CLAUDE.md routing region and docs/ARCHITECTURE.md, which the Kit ships here';
const SCHEDULER_ONLINE =
  '[4/5] scheduler skipped (online tree: the Routines are the schedule, and nothing registers on this machine)';
const ROUTINES_STAGED = ['scheduler/schedule.md', 'docs/ROUTINES-FORMS.md'];
const VALID_STAGED = ['docs/GETTING-STARTED.md', 'docs/README.md', 'docs/projects/README.md', ...ROUTINES_STAGED];
const NEVER_ONLINE = ['CLAUDE.md', 'docs/ARCHITECTURE.md', 'variants/online/scheduler/schedule.md'];
const STAMP = /Generated \d{4}-\d{2}-\d{2}/g;
const STALE_CMD = 'node scripts/stale-status-check.js --advisory';
const STALE_ABSENT = '  stale-status (advisory): skipped, a laptop organ absent from this tree';
const STACK_FRAME = /^\s+at\s.*:\d+:\d+\)?$/m;

// V2's not-installed warning only prints where a scheduler backend exists. C4_PLATFORM=darwin claims a
// backend with no PowerShell leg (so it runs the same on every CI runner), and the shared stub's default
// empty C4_LIVE answers `launchctl list` with no live jobs, so no real scheduler is ever queried.
const V2_ONLINE_HINT =
  'An online (Virtual Alex) tree registers none of them: its schedule is the Routines, and node scripts/generate-alex.js --only=scheduler skips the scheduler here.';
function v2Warning(dir) {
  const r = spawnSync(process.execPath, ['-r', STUB, path.join(dir, 'scripts', 'validate-alex.js')], {
    cwd: dir,
    env: { ...ENV, C4_PLATFORM: 'darwin' },
    encoding: 'utf8'
  });
  return (
    lines(`${r.stdout}\n${r.stderr}`).find((l) => l.startsWith('WARNING V2: none of')) ||
    `(no V2 not-installed line)\n${r.stdout}${r.stderr}`
  );
}

const git = gitIn(ENV);
function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}
const lines = (s) =>
  String(s || '')
    .split(/\r?\n/)
    .filter(Boolean);
const changed = (dir) =>
  git(dir, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3))
    .sort();
const stagedRels = (r) =>
  lines(r.stdout)
    .map((l) => /^ {2}staged (\S+)/.exec(l))
    .filter(Boolean)
    .map((m) => m[1])
    .filter((p) => p !== 'command' && p !== 'brand');
const region = (text) => text.slice(text.indexOf(RT_BEGIN), text.indexOf(RT_END) + RT_END.length);
function copyTracked(from, to) {
  for (const f of git(from, ['ls-files', '-z']).split('\0').filter(Boolean)) {
    if (f.startsWith('.agents/')) continue;
    const src = path.join(from, f);
    let st;
    try {
      st = fs.lstatSync(src);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(src, path.join(to, f));
  }
}
function commitAll(dir, msg) {
  if (!fs.existsSync(path.join(dir, '.git'))) git(dir, ['init', '-q']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', msg]);
}

let seq = 0;
function tree(from = ONLINE) {
  const dir = path.join(ROOT, `t${++seq}`);
  fs.cpSync(from, dir, { recursive: true });
  return dir;
}
// One spawn-and-collect body for both: C4_PLATFORM=linux is the cloud VM's platform, pinned the same way
// for a plain run and a spied one. `preload` names the extra `-r` modules loaded AHEAD of the shared
// stub (the spy, so it captures execSync before the stub's own platform pin takes effect).
function genRun(dir, args, { preload = [] } = {}) {
  return spawnCollect(
    [...preload.flatMap((p) => ['-r', p]), '-r', STUB, path.join(dir, 'scripts', 'generate-alex.js'), ...args],
    {
      cwd: dir,
      env: { ...ENV, C4_PLATFORM: 'linux' }
    }
  );
}
function gen(dir, args) {
  return genRun(dir, args);
}
// gen() with a spy preloaded ahead of the stub. It records every command the generator hands to execSync,
// so a test can tell a step that was never started from one that ran and was silenced. Loaded before the
// stub pins the platform to linux, it also knows the real host, and on a Windows host it runs each
// command under the host's platform: pinned to linux, execSync starts /bin/sh, which Windows does not
// have, and every command would fail to start whatever the generator did with it.
function genSpied(dir, args) {
  const spawns = `${dir}.spawns`;
  const spy = `${dir}.spy.cjs`;
  fs.writeFileSync(spawns, '');
  fs.writeFileSync(
    spy,
    `'use strict';\nconst cp = require('child_process');\nconst real = cp.execSync;\nconst host = process.platform;\n` +
      `cp.execSync = function (command) {\n  require('fs').appendFileSync(${JSON.stringify(spawns)}, String(command) + '\\n');\n` +
      "  if (host !== 'win32') return real.apply(this, arguments);\n  const pinned = process.platform;\n" +
      "  Object.defineProperty(process, 'platform', { value: host });\n" +
      "  try { return real.apply(this, arguments); } finally { Object.defineProperty(process, 'platform', { value: pinned }); }\n};\n"
  );
  return genRun(dir, args, { preload: [spy] }).then((r) => ({ ...r, spawned: lines(fs.readFileSync(spawns, 'utf8')) }));
}
const staleLines = (r) => lines(r.stdout).filter((l) => l.includes('stale-status'));
// Every tracked file a run changed, read before and after. The only difference allowed against the tree the
// build landed is the day's `Generated YYYY-MM-DD` stamp, which every generated page carries in the Kit too.
function snapshot(dir) {
  return new Map(
    git(dir, ['ls-files', '-z'])
      .split('\0')
      .filter(Boolean)
      .map((f) => [f, read(dir, f)])
  );
}

before(async () => {
  writeGitConfig(ROOT, 'online fixture');
  if (IN_KIT) {
    copyTracked(KIT, KITCOPY);
    commitAll(KITCOPY, 'kit copy');
    const b = await import(pathToFileURL(path.join(KITCOPY, 'scripts', 'build-online-template.mjs')).href);
    const plan = b.planTree(
      b.trackedEntries(KITCOPY),
      b.resolveRows(b.loadManifest(path.join(KITCOPY, b.MANIFEST_REL))),
      KITCOPY
    );
    for (const f of plan.files) {
      fs.mkdirSync(path.dirname(path.join(ONLINE, f.dst)), { recursive: true });
      fs.copyFileSync(f.src, path.join(ONLINE, f.dst));
    }
  } else {
    copyTracked(KIT, ONLINE);
  }
  commitAll(ONLINE, 'online tree');
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('generate-alex in the online tree', { concurrency: CONCURRENCY }, () => {
  test("the tree is the online one: no variants/, the online schedule at its real path, and a constitution whose routing rows are not the registry's laptop render", () => {
    assert.ok(!fs.existsSync(path.join(ONLINE, 'variants')), 'no variants/ online');
    assert.ok(
      read(ONLINE, 'scheduler/schedule.md').includes('<!-- ROUTINES:BEGIN'),
      'the online schedule, with its ROUTINES region, is at scheduler/schedule.md'
    );
    const setup = read(ONLINE, '.claude/commands/setup.md');
    assert.ok(
      setup.split(/\r?\n/).some((l) => /node scripts\/generate-alex\.js(?!\s+--only)/.test(l)),
      'online /setup names the full run'
    );
    const { claudeRegionBlock } = require(path.join(ONLINE, 'scripts', 'lib', 'gen-routing-table.js'));
    const laptop = claudeRegionBlock(JSON.parse(read(ONLINE, 'system/manifest.json'))).replace(/\s+$/, '');
    const own = region(read(ONLINE, 'CLAUDE.md'))
      .split('\n')
      .filter((l) => !laptop.split('\n').includes(l));
    assert.ok(
      own.length > 0 && own.every((l) => /^\| /.test(l)),
      `the online constitution carries routing rows of its own: ${own.join(' || ')}`
    );
    assert.ok(
      read(ONLINE, 'CLAUDE.md').includes(
        'rendered into `scheduler/schedule.md` and `docs/ROUTINES-FORMS.md` by `node scripts/generate-alex.js --only=routines`'
      ),
      'the online constitution tells the agent to add a Routine by rendering routines[] into the schedule and the forms page, online'
    );
  });

  test('the full run /setup prescribes exits 0, renders only the surfaces valid online, and names what it skipped on its step lines', async () => {
    const dir = tree();
    const r = await gen(dir, []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!r.stdout.includes(MISSING_VARIANT), r.stdout);
    assert.doesNotMatch(r.stdout, /^FAILED/m, r.stdout);
    const m = RENDER_ONLINE.exec(r.stdout);
    assert.ok(m, `the render step line names the online tree:\n${r.stdout}`);
    assert.equal(m[1], SKIPPED_ALL);
    assert.deepEqual(stagedRels(r), VALID_STAGED, r.stdout);
    assert.ok(lines(r.stdout).includes(SCHEDULER_ONLINE), r.stdout);
    assert.ok(r.stdout.includes('  staged command headers:'), r.stdout);
    assert.ok(r.stdout.includes('  staged brand tokens:'), r.stdout);
    assert.match(r.stdout, /^\[5\/5\] swapped \d+ file\(s\): /m, r.stdout);
    for (const rel of NEVER_ONLINE)
      assert.ok(!lines(r.stdout).some((l) => l.startsWith(`  staged ${rel}`)), `${rel} is never staged online`);
  });

  test('every --only selection runs online: an invalid surface is named skipped and never fails the run on the missing variants/ path', async () => {
    const dir = tree();
    for (const [sel, rendered, skipped] of [
      ['routines', ROUTINES_STAGED, 'nothing selected is skipped'],
      ['claude', [], 'skipped the CLAUDE.md routing region, which the Kit ships here'],
      ['docs', VALID_STAGED, SKIPPED_ALL],
      ['tokens', [], 'nothing selected is skipped']
    ]) {
      const r = await gen(dir, ['--dry-run', `--only=${sel}`]);
      assert.equal(r.status, 0, `--only=${sel}\n${r.stdout}${r.stderr}`);
      assert.ok(!r.stdout.includes(MISSING_VARIANT), `--only=${sel}: ${r.stdout}`);
      const m = RENDER_ONLINE.exec(r.stdout);
      assert.ok(m, `--only=${sel}: the render step line names the online tree:\n${r.stdout}`);
      assert.equal(m[1], skipped, `--only=${sel}`);
      assert.deepEqual(stagedRels(r), rendered, `--only=${sel}: ${r.stdout}`);
      fs.rmSync(path.join(dir, '.staging'), { recursive: true, force: true });
    }
    const s = await gen(dir, ['--dry-run', '--only=scheduler']);
    assert.equal(s.status, 0, s.stdout + s.stderr);
    assert.ok(lines(s.stdout).includes(SCHEDULER_ONLINE), s.stdout);
    assert.deepEqual(changed(dir), [], 'a dry run writes nothing tracked');
  });

  test('the online CLAUDE.md gains no laptop row: not from --only=claude, not from the full run', async () => {
    const dir = tree();
    const before = read(dir, 'CLAUDE.md');
    const only = await gen(dir, ['--only=claude']);
    assert.equal(only.status, 0, only.stdout + only.stderr);
    assert.equal(read(dir, 'CLAUDE.md'), before, '--only=claude leaves the online constitution byte for byte');
    assert.ok(
      lines(only.stdout).includes('[5/5] nothing staged to swap (the --only selection produced no file outputs)'),
      only.stdout
    );
    const full = await gen(dir, []);
    assert.equal(full.status, 0, full.stdout + full.stderr);
    assert.equal(read(dir, 'CLAUDE.md'), before, 'the full run leaves the online constitution byte for byte');
    assert.ok(!changed(dir).includes('CLAUDE.md'));
  });

  test('every surface a run writes matches what the build landed, the date stamp aside, and a second run is a no-op', async () => {
    const dir = tree();
    const built = snapshot(dir);
    const first = await gen(dir, []);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    for (const rel of changed(dir)) {
      assert.ok(built.has(rel), `the run created ${rel}, which the build does not land`);
      assert.equal(
        read(dir, rel).replace(STAMP, 'Generated <date>'),
        built.get(rel).replace(STAMP, 'Generated <date>'),
        `${rel}: more than the date stamp changed`
      );
    }
    commitAll(dir, 'after the first run');
    const second = await gen(dir, []);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.deepEqual(changed(dir), [], 'the second run changes nothing');
  });

  test('/new online: a project added to system/manifest.json regenerates cleanly, into the docs and its command header, never into the constitution', async () => {
    const dir = tree();
    const mf = JSON.parse(read(dir, 'system/manifest.json'));
    const like = mf.projects[mf.projects.length - 1];
    const num = Math.max(...mf.projects.map((p) => p.num)) + 1;
    mf.projects.push({
      ...like,
      num,
      name: 'fixture-lane',
      title: 'Fixture Lane',
      state: 'LIVE',
      trigger: 'on-demand',
      one_liner: 'A lane an owner adds with /new.',
      docs: `${num}-fixture-lane.md`,
      schedule_jobs: [],
      revisit: null,
      work_dir: `work/${num}-fixture-lane`,
      commands: ['fixture-lane'],
      status_md: 'vault/projects/fixture-lane/status.md',
      cadence: { expected_hours: null, label: 'on-demand' },
      first_fire: null,
      first_fire_kind: null,
      claude_md_sha: null
    });
    fs.writeFileSync(path.join(dir, 'system/manifest.json'), `${JSON.stringify(mf, null, 2)}\n`);
    fs.mkdirSync(path.join(dir, 'work', `${num}-fixture-lane`), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'work', `${num}-fixture-lane`, 'CLAUDE.md'),
      '# Fixture Lane\n\nType: automation.\n'
    );
    fs.writeFileSync(path.join(dir, 'docs', 'projects', `${num}-fixture-lane.md`), '# Fixture Lane\n\nWhat it does.\n');
    fs.writeFileSync(
      path.join(dir, '.claude', 'commands', 'fixture-lane.md'),
      '# /fixture-lane - Fixture Lane\n\nRun the lane.\n'
    );
    commitAll(dir, 'the owner registers a project');
    const claude = read(dir, 'CLAUDE.md');
    const nonRetired = mf.projects.filter((p) => p.state !== 'RETIRED').length;
    const live = mf.projects.filter((p) => p.state === 'LIVE').length;

    const r = await gen(dir, []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(
      changed(dir),
      ['.claude/commands/fixture-lane.md', 'docs/GETTING-STARTED.md', 'docs/README.md', 'docs/projects/README.md'],
      r.stdout
    );
    assert.ok(
      read(dir, 'docs/GETTING-STARTED.md').includes(
        `- **${num} Fixture Lane** (LIVE; trigger: on-demand) - A lane an owner adds with /new.`
      )
    );
    assert.ok(read(dir, 'docs/GETTING-STARTED.md').includes(`The automations (${nonRetired} registered, non-retired)`));
    assert.ok(read(dir, 'docs/README.md').includes(`**${nonRetired} non-retired automations** (${live} LIVE)`));
    assert.ok(
      read(dir, 'docs/projects/README.md').includes(
        `| ${num} | [Fixture Lane](${num}-fixture-lane.md) | LIVE | A lane an owner adds with /new. |`
      )
    );
    assert.ok(
      read(dir, '.claude/commands/fixture-lane.md').includes('<!-- ALEX:CMD-HEADER:BEGIN'),
      'the new LIVE command carries its generated header'
    );
    assert.equal(read(dir, 'CLAUDE.md'), claude, 'the online constitution is not written');

    commitAll(dir, 'after the first run');
    const again = await gen(dir, []);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(changed(dir), [], 'the second run changes nothing');
  });

  test("a Routine the owner adds to routines[] online renders into the schedule's ROUTINES region and the forms page, as the online constitution says, and a second run is a no-op", async () => {
    const dir = tree();
    const mf = JSON.parse(read(dir, 'system/manifest.json'));
    mf.routines.push({
      cadence_hours: 192,
      connectors: [],
      environment: 'Routine',
      first_run_check: 'Tap Run now, then read the newest run-log row: job fixture.',
      model: mf.meta.model_routing.default,
      name: 'fixture',
      preset: 'weekly',
      prompt_file: 'scheduler/routines/fixture.md',
      repositories: 'owner',
      time_local: 'Saturday 03:15'
    });
    fs.writeFileSync(path.join(dir, 'system/manifest.json'), `${JSON.stringify(mf, null, 2)}\n`);
    fs.writeFileSync(
      path.join(dir, 'scheduler', 'routines', 'fixture.md'),
      '# The fixture Routine\n\nWrite one run-log row.\n'
    );
    commitAll(dir, 'the owner adds a Routine');
    const claude = read(dir, 'CLAUDE.md');

    const r = await gen(dir, ['--only=routines']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(changed(dir), ['docs/ROUTINES-FORMS.md', 'scheduler/schedule.md'], r.stdout);
    assert.ok(
      read(dir, 'scheduler/schedule.md').includes(
        '| `alex-fixture` | `fixture` | weekly, Saturday 03:15 | your Alex repository only | Routine | none | `scheduler/routines/fixture.md` | 1 |'
      )
    );
    assert.ok(read(dir, 'docs/ROUTINES-FORMS.md').includes(`## ${mf.routines.length}. alex-fixture`));
    assert.equal(read(dir, 'CLAUDE.md'), claude, 'the online constitution is not written');

    commitAll(dir, 'after the first run');
    const again = await gen(dir, ['--only=routines']);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(changed(dir), [], 'the second run changes nothing');
  });

  test("the texts that describe a run say what it does online: --help, V2's not-installed hint, /new and the online constitution", () => {
    const dir = tree();
    const help = spawnSync(process.execPath, [path.join(dir, 'scripts', 'generate-alex.js'), '--help'], {
      cwd: dir,
      env: ENV,
      encoding: 'utf8'
    });
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.ok(
      help.stdout.includes('in an online (Virtual Alex) tree, one without variants/online, it registers nothing'),
      help.stdout
    );
    const v2 = v2Warning(dir);
    assert.ok(v2.endsWith(V2_ONLINE_HINT), v2);
    assert.ok(!v2.includes('Install-Alex'), `the online hint names no installer the tree does not ship: ${v2}`);
    assert.ok(
      read(dir, '.claude/commands/new.md').includes(
        'In an online (Virtual Alex) tree the root CLAUDE.md routing table comes with the template'
      )
    );
    const claude = read(dir, 'CLAUDE.md');
    for (const stale of [
      '(`README.md`, `ARCHITECTURE.md`, `GETTING-STARTED.md`, `projects/README.md`) refresh with',
      'and diffs the scheduler',
      'the generator its routing region'
    ])
      assert.ok(!claude.includes(stale), `the online constitution no longer says: ${stale}`);
    assert.ok(claude.includes('says on its step lines that it skipped this table and `docs/ARCHITECTURE.md`'));
  });

  test('the stale-status advisory the online tree does not hold is named absent in one line and never started: no missing-module error, no stack frame', async () => {
    const dir = tree();
    assert.ok(
      !fs.existsSync(path.join(dir, 'scripts', 'stale-status-check.js')),
      'fixture: the online tree does not hold the advisory'
    );
    const r = await genSpied(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(staleLines(r), [STALE_ABSENT]);
    for (const [name, text] of [
      ['stdout', r.stdout],
      ['stderr', r.stderr]
    ]) {
      assert.ok(!text.includes('Cannot find module'), `${name} names a missing module:\n${text}`);
      assert.doesNotMatch(text, STACK_FRAME, `${name} carries a stack frame`);
    }
    assert.deepEqual(
      r.spawned.filter((c) => c.includes('stale-status')),
      [],
      'nothing is started for it'
    );
  });

  test('a tree that holds the stale-status advisory runs it as before, and logs every line it prints under the same prefix', async () => {
    const dir = tree();
    fs.writeFileSync(
      path.join(dir, 'scripts', 'stale-status-check.js'),
      "console.log('stale-status: first line');\nconsole.log('stale-status: second line');\n"
    );
    const r = await genSpied(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(staleLines(r), [
      '  stale-status (advisory): stale-status: first line',
      '  stale-status (advisory): stale-status: second line'
    ]);
    assert.deepEqual(
      r.spawned.filter((c) => c.includes('stale-status')),
      [STALE_CMD]
    );
  });

  test('a stale-status advisory that fails costs the run one line, the first line of the error, and the run goes on', async () => {
    const dir = tree();
    fs.writeFileSync(
      path.join(dir, 'scripts', 'stale-status-check.js'),
      "console.error('Error: the check broke');\nconsole.error('    at check (/x/scripts/stale-status-check.js:1:2)');\nprocess.exit(1);\n"
    );
    const r = await genSpied(dir, ['--dry-run', '--only=claude']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(staleLines(r), [`  stale-status advisory skipped (non-fatal): Command failed: ${STALE_CMD}`]);
    assert.ok(!r.stdout.includes('the check broke'), r.stdout);
    assert.doesNotMatch(r.stdout, STACK_FRAME, 'stdout carries a stack frame');
    assert.ok(r.stdout.includes('[5/5] DRY-RUN complete'), r.stdout);
  });
});
