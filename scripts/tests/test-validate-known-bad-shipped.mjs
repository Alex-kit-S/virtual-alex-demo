#!/usr/bin/env node
// scripts/tests/test-validate-known-bad-shipped.mjs - the KNOWN-BAD set for validate-alex, part 2: the legs
// that read what ships beside the registry (V12 trifecta gate, V13 wrapper model pins, V14 gender law,
// V18's six legs over executables, command pages and links, V19 Routine prompts, V21 the JSON standard).
//
// WHAT. Deleted, none of these legs would be proven to refuse the defect it exists for: `KNOWN-BAD <leg>`
// names a member of the set the validator must refuse the same way, and `PINNED DEFECT <id>` asserts a
// behaviour this tree proved wrong, as it behaves today. test-validate-known-bad-shipped-kit.mjs holds
// every V13 pinned-wrapper leg and V18 (f)'s PowerShell legs, split out when a generated online tree ships
// no pinned .ps1 or run-job.mjs wrapper to plant a defect in and no PowerShell to parse one with.
//
// HOW. Same method as test-validate-known-bad-structure.mjs: one temp git repository per test, built by
// scripts/tests/fixtures/validator-tree.mjs from this checkout's tracked files (`.agents/` left out, no leg
// reads it), the smallest change that makes one leg fail, the exact FAILED line(s) and exit code for the
// laptop hook, and the online hook's verdict (a drift leg is degraded, a content leg blocks). Every run
// loads scripts/tests/fixtures/scheduler-stub.cjs first, which refuses every schtasks, launchctl and
// crontab call and answers liveJobs() with an empty list, so nothing here asks this machine's scheduler
// anything.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task.
//
// Usage: node scripts/tests/test-validate-known-bad-shipped.mjs
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
  gitIn,
  buildBaseTree,
  makeTreeFactory,
  spawnCollect,
  lines
} from './fixtures/validator-tree.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const ROOT = makeRoot('alex-kb-shipped-');
const BASE = path.join(ROOT, 'base');
const ENV = pinnedGitEnv(ROOT);
const CONCURRENCY = Math.max(
  1,
  Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1)
);
const git = gitIn(ENV);

const LAPTOP = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: '' } };
const ONLINE = { args: ['--context=pre-commit', '--changed'], env: { CLAUDE_CODE_REMOTE: 'true' } };
const GENERATOR = { args: [], env: { CLAUDE_CODE_REMOTE: '' } };
const SUITE = 'G1-G4 + V1-V21 (V6, V8, V20 retired)';
const VOCAB = '{draft-only, human-posts, queue-only, read-only}';
const UNKNOWN_CMD =
  'Telling a user to type a command that does not exist produces "unknown command", and this product teaches its users that "unknown command" means they opened the wrong folder.';

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
function editJson(dir, rel, fn) {
  const text = read(dir, rel);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const m = JSON.parse(text);
  fn(m);
  write(dir, rel, JSON.stringify(m, null, 2).split('\n').join(eol) + eol);
}
const nn = (n) => String(n).padStart(2, '0');

function run(dir, ctx, extraEnv = {}) {
  return spawnCollect(['-r', STUB, path.join(dir, 'scripts', 'validate-alex.js'), ...ctx.args], {
    cwd: dir,
    env: { ...ENV, C4_LIVEJOBS_DIRECT: '1', ...ctx.env, ...extraEnv }
  }).then((r) => ({
    ...r,
    failed: lines(r.stderr).filter((l) => l.startsWith('FAILED ')),
    warnings: lines(r.stderr).filter((l) => l.startsWith('WARNING'))
  }));
}

const tree = makeTreeFactory(BASE, ROOT);
const manifest = (dir) => JSON.parse(read(dir, 'system/manifest.json'));
const inKit = (dir) => fs.existsSync(path.join(dir, 'variants', 'online'));

function assertRefused(r, expected, label) {
  assert.equal(r.status, 1, `${label}: exit code\n${r.stderr}`);
  assert.deepEqual(r.failed, expected, `${label}: the FAILED lines`);
  assert.equal(r.stdout, '', `${label}: no PASS verdict on stdout`);
}
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
function assertPassed(r, label) {
  assert.equal(r.status, 0, `${label}\n${r.stderr}`);
  assert.deepEqual(r.failed, [], label);
}

before(() => {
  writeGitConfig(ROOT, 'known-bad fixture');
  buildBaseTree(KIT, BASE, ENV);
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('validate-alex known-bad trees: what ships beside the registry', { concurrency: CONCURRENCY }, () => {
  test('control: the unplanted tree passes the laptop hook with no FAILED line', async () => {
    assertPassed(await run(tree(), LAPTOP), 'laptop');
  });

  // ---------------------------------------------------------------- V12
  test('KNOWN-BAD V12 (a): all three trifecta legs true on a project with no gate; degraded online', async () => {
    const dir = tree();
    const p = manifest(dir).projects.find((x) => x.trifecta && !x.trifecta.gate);
    assert.ok(p, 'fixture: a project with no gate');
    editJson(dir, 'system/manifest.json', (m) =>
      Object.assign(m.projects.find((x) => x.num === p.num).trifecta, {
        private_data: true,
        untrusted_content: true,
        external_comm: true
      })
    );
    const expected = [
      `FAILED V12: project ${nn(p.num)} ${p.title} has all three trifecta legs true but no gate - it MUST declare one of ${VOCAB}`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V12 (b): a gate outside the vocabulary; degraded online', async () => {
    const dir = tree();
    const p = manifest(dir).projects.find((x) => x.trifecta?.gate);
    editJson(dir, 'system/manifest.json', (m) => {
      m.projects.find((x) => x.num === p.num).trifecta.gate = 'zz-gate';
    });
    const expected = [`FAILED V12: project ${nn(p.num)} ${p.title} declares gate "zz-gate" not in the vocab ${VOCAB}`];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V12 (c): the "Gate:" declaration line changed in the project spec; degraded online', async () => {
    const dir = tree();
    const p = manifest(dir).projects.find((x) => x.trifecta?.gate && x.work_dir);
    const rel = `${p.work_dir}/CLAUDE.md`;
    const line = read(dir, rel)
      .split(/\r?\n/)
      .find((l) => new RegExp(`\\bGate:\\s*\\**\\s*${p.trifecta.gate}\\b`, 'i').test(l));
    replaceOnce(dir, rel, line, line.replace(p.trifecta.gate, 'elsewhere'));
    const expected = [
      `FAILED V12: the "## Trifecta" section of ${rel} has no "Gate: ${p.trifecta.gate}" declaration line (a passing mention elsewhere in the section does not count, tightened 2026-07-29)`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('PINNED DEFECT R5-6 (V12): a gated project\'s spec deleted is "was not found", which BLOCKS online while every other V12 line degrades', async () => {
    const dir = tree();
    const p = manifest(dir).projects.find((x) => x.trifecta?.gate && x.work_dir);
    const rel = `${p.work_dir}/CLAUDE.md`;
    fs.rmSync(path.join(dir, rel));
    const expected = [
      `FAILED V12: project ${nn(p.num)} ${p.title} declares gate "${p.trifecta.gate}" but ${rel} was not found`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V12 (no work_dir): a gated project with its work_dir removed; V18 (d) then refuses every pointer at that folder', async () => {
    const dir = tree();
    const p = manifest(dir).projects.find((x) => x.trifecta?.gate && x.state === 'ON-DEMAND');
    assert.ok(p, 'fixture: a gated ON-DEMAND project (no generated command header names its work_dir)');
    editJson(dir, 'system/manifest.json', (m) => {
      delete m.projects.find((x) => x.num === p.num).work_dir;
    });
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    const v12 = `FAILED V12: project ${nn(p.num)} ${p.title} declares gate "${p.trifecta.gate}" but has no work_dir to hold its ## Trifecta line`;
    assert.ok(r.failed.includes(v12), r.stderr);
    const others = r.failed.filter((l) => l !== v12);
    assert.ok(
      others.length > 0 &&
        others.every((l) =>
          new RegExp(
            `^FAILED V18: .+ points at \`${p.work_dir}\`, which is not a project in system/manifest.json$`
          ).test(l)
        ),
      others.join('\n')
    );
  });

  // ---------------------------------------------------------------- V13
  test('KNOWN-BAD V13: an undeclared scripts/run-*.ps1; degraded online', async () => {
    const dir = tree();
    write(dir, 'scripts/run-zz.ps1', "Write-Output 'zz'\n");
    const expected = [
      'FAILED V13: scripts/run-zz.ps1 is in NEITHER meta.model_routing.local_wrappers.pins NOR deterministic_no_pin - every scheduled wrapper must be declared (an unlisted wrapper that calls claude inherits the global model default); add it to the contract'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V13 (stale pin): a pin naming a wrapper that does not exist and no drop row claims; degraded online', async () => {
    const dir = tree();
    editJson(dir, 'system/manifest.json', (m) => {
      m.meta.model_routing.local_wrappers.pins['run-zz-missing.ps1'] = 'claude-sonnet-4-6';
    });
    const expected = ['FAILED V13: local_wrappers.pins names scripts/run-zz-missing.ps1 which does not exist'];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  // ---------------------------------------------------------------- V14
  test('KNOWN-BAD V14 (a): an unpublished draft whose body says "he"; content, blocks online', async () => {
    const dir = tree();
    write(dir, 'outputs/drafts/ep-zz.md', 'title: zz\nstatus: draft\n---\nAlex drafts the post.\nThen he says it.\n');
    const expected = [
      'FAILED V14: outputs/drafts/ep-zz.md body line 2 uses "he" - Alex has no gender. Use the name plus sentence restructuring; "it" is not a substitute. If the pronoun refers to a real third person and not to Alex, rephrase to name them, because a post body cannot distinguish the two: Then he says it.'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
    // a published draft is archive: the same body passes
    replaceOnce(dir, 'outputs/drafts/ep-zz.md', 'status: draft', 'status: published');
    assertPassed(await run(dir, LAPTOP), 'published');
  });

  test('PINNED DEFECT R5-9: a draft about a real colleague ("she said") blocks every online autosave', async () => {
    const dir = tree();
    write(dir, 'outputs/drafts/notes-zz.md', 'status: draft\n---\nMy colleague Sara said she liked it.\n');
    const expected = [
      'FAILED V14: outputs/drafts/notes-zz.md body line 1 uses "she" - Alex has no gender. Use the name plus sentence restructuring; "it" is not a substitute. If the pronoun refers to a real third person and not to Alex, rephrase to name them, because a post body cannot distinguish the two: My colleague Sara said she liked it.'
    ];
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V14 (b): a gendered line in CLAUDE.md passes, because V14 only reads unpublished episode bodies', async () => {
    const dir = tree();
    const text = read(dir, 'CLAUDE.md');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = text.replace(/(\r?\n)*$/, '');
    write(dir, 'CLAUDE.md', body + eol + eol + 'every correction becomes a rule he never breaks again' + eol);
    assertPassed(await run(dir, LAPTOP), 'laptop');
    assertPassed(await run(dir, ONLINE), 'online');
  });

  // ---------------------------------------------------------------- V18
  test('KNOWN-BAD V18 (a): a control byte in a docs page; content, blocks online', async () => {
    const dir = tree();
    write(dir, 'docs/zz-ctrl.md', '# zz\n\nab' + String.fromCharCode(1) + 'cd\n');
    const expected = [
      'FAILED V18: docs/zz-ctrl.md contains control byte(s) (byte 0x1 at offset 8) - almost always a backslash escape eaten by whatever wrote the file. It is invisible in an editor and it changes behaviour silently.'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('PINNED DEFECT R5-8: V18 (a) never reads .claude/ or a .mjs file, and does read a gitignored private file', async () => {
    const dir = tree();
    const ctrl = String.fromCharCode(1);
    write(dir, '.claude/commands/zz-quiet.md', `# zz${ctrl}\n`);
    write(dir, 'scripts/zz-quiet.mjs', `// zz${ctrl}\n`);
    const r = await run(dir, LAPTOP);
    assertPassed(r, 'a control byte in .claude/commands and in a .mjs file');
    const candidates = [
      'vault/zz-private.md',
      'outputs/typed/zz-private.md',
      'outputs/zz-private.md',
      'refactor/zz-private.md'
    ];
    const ignored = candidates.find((c) => {
      try {
        git(dir, ['check-ignore', '-q', c]);
        return true;
      } catch {
        return false;
      }
    });
    assert.ok(ignored, 'fixture: one candidate path is gitignored here');
    write(dir, ignored, `private${ctrl}\n`);
    const expected = [
      `FAILED V18: ${ignored} contains control byte(s) (byte 0x1 at offset 7) - almost always a backslash escape eaten by whatever wrote the file. It is invisible in an editor and it changes behaviour silently.`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'a gitignored file');
  });

  test('KNOWN-BAD V18 (b): a root .cmd whose call to a failure label carries on; content, blocks online', async () => {
    const dir = tree();
    const bad = [
      '@echo off',
      'call :fail',
      'echo carried on',
      'exit /b 0',
      ':fail',
      'echo failing',
      'exit /b 1',
      ''
    ].join('\r\n');
    write(dir, 'zz-guard.cmd', bad);
    const expected = [
      'FAILED V18: zz-guard.cmd:2 uses `call :fail`, but :fail is a failure path ending in `exit /b`. `exit /b` inside a CALLed label RETURNS to the caller, so this guard prints its warning and then carries on. Use `goto :fail`, or follow the call with its own `exit /b 1`.'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
    write(dir, 'zz-guard.cmd', bad.replace('echo carried on', 'exit /b 1'));
    assertPassed(await run(dir, LAPTOP), 'the call followed by its own exit');
  });

  test('KNOWN-BAD V18 (c): a work page naming a command that does not exist; degraded online', async () => {
    const dir = tree();
    write(dir, 'work/zz-notes.md', 'Run /not-a-command now.\n');
    const world = inKit(dir) ? 'in either world' : 'in this system';
    const expected = [
      `FAILED V18: work/zz-notes.md:1 names \`/not-a-command\`, which is not a command ${world}. ${UNKNOWN_CMD}`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('PINNED DEFECT R5-16: `/notes.md` in a work page is read as the command /notes (the file-extension skip is unreachable)', async () => {
    const dir = tree();
    write(dir, 'work/zz-notes.md', 'see `/notes.md`\n');
    const world = inKit(dir) ? 'in either world' : 'in this system';
    assertRefused(
      await run(dir, LAPTOP),
      [`FAILED V18: work/zz-notes.md:1 names \`/notes\`, which is not a command ${world}. ${UNKNOWN_CMD}`],
      'laptop'
    );
  });

  test('PINNED DEFECT R5-7: V18 (c) and (d) never read docs/, so an unknown command and a cut-project pointer there pass', async () => {
    const dir = tree();
    write(dir, 'docs/zz-cmd.md', 'Run /not-a-command, then read work/99-ghost and vault/projects/ghost/status.md.\n');
    assertPassed(await run(dir, LAPTOP), 'laptop');
  });

  test('KNOWN-BAD V18 (d): a work page pointing at an unregistered project and its status page; degraded online', async () => {
    const dir = tree();
    write(dir, 'work/zz-notes.md', 'see work/99-ghost and vault/projects/ghost/status.md\n');
    const expected = [
      'FAILED V18: work/zz-notes.md:1 points at `work/99-ghost`, which is not a project in system/manifest.json',
      'FAILED V18: work/zz-notes.md:1 points at `vault/projects/ghost/status.md`, the status page of a project that does not exist here. If that pointer carries a RULE, the rule now has no source.'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V18 (e): a relative docs link to a page that does not exist; degraded online', async () => {
    const dir = tree();
    write(dir, 'docs/zz-links.md', '# zz\n\n[x](no-such-page.md)\n');
    const expected = ["FAILED V18: docs/zz-links.md:3 links to 'no-such-page.md', which does not exist"];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('V21 fails CLOSED only when git itself is absent: an enforced, absent, untracked file then reads as tracked; V18 (f) warns where .ps1 files exist', async () => {
    const dir = tree();
    const audit = require(path.join(dir, 'scripts', 'json-standard-audit.js'));
    const absent = audit
      .parseContract(read(dir, audit.CONTRACT_REL))
      .filter((rel) => !fs.existsSync(path.join(dir, rel)));
    const kitManifest = JSON.parse(read(dir, 'system/kit-manifest.json'));
    const dropRows = (kitManifest.components || []).filter((c) => c.online === 'drop').flatMap((c) => c.paths);
    const counted = absent.filter((rel) => !dropRows.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p)));
    assert.ok(counted.length > 0, 'fixture: an enforced file is absent here and no drop row claims it');
    const r = await run(dir, GENERATOR, { PATH: path.dirname(process.execPath) });
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(
      r.failed,
      counted.map(
        (rel) =>
          `FAILED V21: ${rel} is listed in json_standard.enforced[] but is not on disk, and git tracks it. A tracked file leaves the enforced list deliberately, in the commit that removes it, never by going missing.`
      )
    );
    assert.ok(!r.warnings.some((w) => /tracked in-scope JSON file/.test(w)), 'no backlog line without git');
    const hasPs1 = git(dir, ['ls-files'])
      .split(/\r?\n/)
      .some((f) => f.toLowerCase().endsWith('.ps1'));
    if (process.platform === 'win32' && hasPs1)
      assert.ok(
        r.warnings.some((w) =>
          /^WARNING V18: could not run the PowerShell parse sweep \(.+\) - \d+ \.ps1 file\(s\) unchecked$/.test(w)
        ),
        r.stderr
      );
  });

  // ---------------------------------------------------------------- V19
  test('KNOWN-BAD V19: an orphan Routine prompt file; degraded online', async () => {
    const dir = tree();
    write(dir, 'scheduler/routines/zz-orphan.md', '# zz\n');
    const expected = [
      'FAILED V19: scheduler/routines/zz-orphan.md has no routines[] row in system/manifest.json - a prompt file nobody scheduled is an order nobody checks; add the row (name, prompt_file, preset, time_local, cadence_hours, environment, connectors, repositories, model, first_run_check) or remove the file'
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V19 (missing file): a routines[] row whose prompt file was deleted; degraded online', async () => {
    const dir = tree();
    const row = manifest(dir).routines[0];
    fs.rmSync(path.join(dir, ...row.prompt_file.split('/')));
    const expected = [
      `FAILED V19: routines[] row "${row.name}" names ${row.prompt_file}, which does not exist - a form pointing at a missing file is a Routine that fails on its first line`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  test("PINNED DEFECT R5-6 (V19): a malformed routines[] registry is degraded online, although the leg's own comment says a broken registry blocks everywhere", async () => {
    const dir = tree();
    const row = manifest(dir).routines[0];
    editJson(dir, 'system/manifest.json', (m) => {
      m.routines[0].preset = 'hourly';
    });
    const expected = [
      `FAILED V19: system/manifest.json routines[] is malformed - routines[0] (${row.name}): preset must be one of daily | weekdays | weekly (got "hourly")`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertDegraded(await run(dir, ONLINE), expected, 'online');
  });

  // ---------------------------------------------------------------- V21
  function enforcedPresent(dir) {
    const audit = require(path.join(dir, 'scripts', 'json-standard-audit.js'));
    const rel = audit.parseContract(read(dir, audit.CONTRACT_REL)).find((x) => fs.existsSync(path.join(dir, x)));
    return { audit, rel };
  }

  test('KNOWN-BAD V21: one extra space of indentation in an enforced file; content, blocks online', async () => {
    const dir = tree();
    const { audit, rel } = enforcedPresent(dir);
    const text = read(dir, rel);
    const planted = text.replace(/\n {2}"/, '\n   "');
    assert.notEqual(planted, text, 'fixture: the enforced file has a two-space indented key');
    write(dir, rel, planted);
    const findings = audit.auditText(rel, planted, { root: dir }).findings;
    assert.ok(findings.length > 0, 'fixture: the audit rejects the planted bytes');
    const expected = [
      `FAILED V21: ${rel} (repo) breaks the JSON standard: ${findings.join('; ')}. It is migrated and enforced, so this is a regression: write it through the script its _writer field names (scripts/lib/json-writer.js underneath), never by editing the bytes.`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V21 (tracked file gone): an enforced file git tracks, deleted from disk; blocks online', async () => {
    const dir = tree();
    const { rel } = enforcedPresent(dir);
    fs.rmSync(path.join(dir, rel));
    const expected = [
      `FAILED V21: ${rel} is listed in json_standard.enforced[] but is not on disk, and git tracks it. A tracked file leaves the enforced list deliberately, in the commit that removes it, never by going missing.`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V21 (contract gone): json_standard removed from system/kit-manifest.json; blocks online', async () => {
    const dir = tree();
    const { audit } = enforcedPresent(dir);
    editJson(dir, audit.CONTRACT_REL, (k) => {
      delete k.json_standard;
    });
    let message;
    try {
      audit.parseContract(read(dir, audit.CONTRACT_REL));
    } catch (e) {
      message = e.message;
    }
    assert.ok(message, 'fixture: the contract reader refuses the file');
    const expected = [
      `FAILED V21: ${message}. That list IS the contract this check reads; without it the check has no scope and silently asserts nothing, which is worse than no check. Restore it (doc: docs/json-standard.md).`
    ];
    assertRefused(await run(dir, LAPTOP), expected, 'laptop');
    assertRefused(await run(dir, ONLINE), expected, 'online');
  });

  test('KNOWN-BAD V21 (engine gone): scripts/json-standard-audit.js deleted; blocks online', async () => {
    const dir = tree();
    const abs = path.join(dir, 'scripts', 'json-standard-audit.js');
    fs.rmSync(abs);
    for (const [label, ctx] of [
      ['laptop', LAPTOP],
      ['online', ONLINE]
    ]) {
      const r = await run(dir, ctx);
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(
        r.failed,
        [`FAILED V21: scripts/json-standard-audit.js could not be loaded (Cannot find module '${abs}'`],
        label
      );
      assert.ok(
        r.stderr.includes('The audit is the rule engine; V21 without it would pass every file by default.'),
        label
      );
    }
  });

  test('PINNED DEFECT R5-24: an audit that throws on an enforced file kills the run as an internal error; one that throws on a backlog file is dropped from the count', async () => {
    const dir = tree();
    const { audit, rel } = enforcedPresent(dir);
    const base = await run(dir, LAPTOP);
    const backlogLine = base.warnings.find((w) =>
      /tracked in-scope JSON file\(s\) are not, and \d+ of those break the standard today/.test(w)
    );
    assert.ok(backlogLine, 'fixture: the backlog line');
    const breaking = Number(/and (\d+) of those break/.exec(backlogLine)[1]);
    const pending = /today \((.+)\)\. Each joins/.exec(backlogLine)[1].split(', ');
    const breaker = pending.find((p) => audit.auditText(p, read(dir, p), { root: dir }).findings.length > 0);
    assert.ok(breaker, 'fixture: a backlog file breaks the standard');
    const auditRel = 'scripts/json-standard-audit.js';
    const src = read(dir, auditRel);
    const patch = (target, msg) =>
      `${src}\n{ const real = module.exports.auditText; module.exports.auditText = (rel, ...rest) => { if (rel === ${JSON.stringify(target)}) throw new Error(${JSON.stringify(msg)}); return real(rel, ...rest); }; }\n`;
    write(dir, auditRel, patch(rel, 'zz audit throw'));
    const r = await run(dir, LAPTOP);
    assert.equal(r.status, 1, r.stderr);
    assert.deepEqual(lines(r.stderr), ['validate-alex: internal error: zz audit throw']);
    write(dir, auditRel, patch(breaker, 'zz backlog throw'));
    const b = await run(dir, LAPTOP);
    assertPassed(b, 'a backlog throw');
    assert.ok(
      b.warnings.some((w) => w.includes(`and ${breaking - 1} of those break the standard today`)),
      b.stderr
    );
  });
});
