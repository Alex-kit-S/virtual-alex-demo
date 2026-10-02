#!/usr/bin/env node
// @ts-check
// scripts/tests/test-template-gate-cli.mjs - scripts/lib/template-gate.mjs, the two refusals /update runs before
// it changes anything, held on every input shape and every answer.
//
// WHAT. test-template-gate.mjs holds the gate's main refusals by regex and one green answer; this file holds
// what an owner's session actually meets. Deleted, it would let a change alter which template_remote spellings
// `remote` accepts or the exact sentence for each it refuses, let `ci` read a file or call gh before it has
// checked the sha, change the gh call, misjudge a check-run answer (cancelled, skipped, neutral, queued, string
// ids, the url fallbacks), take an unreadable answer, reword the usage refusal, rename an export, or start
// writing files, with every other test green.
//
// HOW. Fixture trees in the OS temp folder; gh is injected through main()'s `run` for the answers, and for the
// missing-gh leg the command line runs with PATH cut to node's own folder. Nothing reaches GitHub. A test named
// "PINNED DEFECT <id>" asserts behaviour known to be wrong; its fix flips exactly that assertion when the defect
// ledger schedules it.
//
// NEVER. Writes inside the repository it runs in. Fixes a defect it pins (R4-7, R4-L1, R4-L3): an SSH
// template_remote, which the builder writes unvalidated, is refused for ever; a missing gh gets the "attach the
// template" remedy, which cannot install gh; and one page of check runs is read, never a second.
//
// Usage: node scripts/tests/test-template-gate-cli.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as G from '../lib/template-gate.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = path.join(ROOT, 'scripts', 'lib', 'template-gate.mjs');
const { writeJson } = require('../lib/json-writer.js');
const SHA = 'c'.repeat(40);
const TAILS = 'Nothing has changed. Send this line to whoever maintains the template.';

/**
 * A fixture tree holding system/template-source.json written through json-writer.js, or raw text, or no file
 * when both are absent; removed when the test ends.
 * @param {import('node:test').TestContext} t
 * @param {unknown} value the source's data
 * @param {{ schema?: string, raw?: string | null }} [options]
 */
function tree(t, value, { schema = 'template-source@1', raw = null } = {}) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-gate-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'system'));
  const file = path.join(d, 'system', 'template-source.json');
  if (raw !== null) fs.writeFileSync(file, raw);
  else if (value !== undefined)
    writeJson(file, value, {
      purpose: 'fixture',
      writer: 'scripts/build-online-template.mjs',
      schema,
      generatedAt: '2026-09-24T00:00:00Z'
    });
  return d;
}
/**
 * @param {() => unknown} fn
 * @returns {any} what fn threw, or null when it returned
 */
const refusal = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};
/**
 * The gate's command line as an owner's session runs it.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
const cli = (args, opts = {}) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', ...opts });
/**
 * A check run of the CI job on SHA that finished with success, its fields overridden by extra.
 * @param {number | string} id
 * @param {Record<string, unknown>} [extra]
 */
const run = (id, extra = {}) => ({
  id,
  name: 'portable-tests',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  ...extra
});

test('the exports and constants other files share', () => {
  assert.deepEqual(Object.keys(G).sort(), [
    'CI_CHECK',
    'Refusal',
    'SOURCE_REL',
    'SOURCE_SCHEMA',
    'ciVerdict',
    'main',
    'readChecks',
    'readTemplateSource'
  ]);
  assert.deepEqual(
    [G.SOURCE_REL, G.SOURCE_SCHEMA, G.CI_CHECK],
    ['system/template-source.json', 'template-source@1', 'portable-tests']
  );
  const r = new G.Refusal('x');
  assert.deepEqual([r.name, r.exitCode, r instanceof Error], ['Refusal', 2, true]);
});

test('remote: the spellings it accepts, each printed as https://github.com/<owner>/<repo>', (t) => {
  const cases = [
    ['https://github.com/Alex-kit-S/virtual-alex', 'https://github.com/Alex-kit-S/virtual-alex'],
    ['https://github.com/Alex-kit-S/virtual-alex.git', 'https://github.com/Alex-kit-S/virtual-alex'],
    ['https://github.com/Alex-kit-S/virtual-alex/', 'https://github.com/Alex-kit-S/virtual-alex'],
    ['https://github.com/Alex-kit-S/virtual-alex.git/', 'https://github.com/Alex-kit-S/virtual-alex'],
    ['  https://github.com/o-1/r.e_p-2  ', 'https://github.com/o-1/r.e_p-2']
  ];
  for (const [value, want] of cases) {
    const d = tree(t, { template_remote: value });
    assert.deepEqual(G.readTemplateSource(d), { remote: want, repo: want.slice('https://github.com/'.length) }, value);
  }
  const bom = tree(t, undefined, {
    raw: `\uFEFF${JSON.stringify({ _generated_at: '2026-09-24T00:00:00Z', _purpose: 'p', _schema: 'template-source@1', _writer: 'w', template_remote: 'https://github.com/o/r' }, null, 2)}\n`
  });
  assert.equal(G.readTemplateSource(bom).remote, 'https://github.com/o/r', 'a byte-order mark is tolerated');
});

test('remote: every spelling it refuses, with the exact sentence the owner is shown', (t) => {
  const names = (/** @type {unknown} */ v) =>
    `system/template-source.json names no GitHub repository (template_remote is ${JSON.stringify(v)}). ${TAILS}`;
  for (const v of [
    'http://github.com/o/r',
    'https://www.github.com/o/r',
    'https://gitlab.com/o/r',
    'virtual-alex',
    'https://github.com/o',
    'https://github.com/o/r/tree/main'
  ]) {
    assert.equal(refusal(() => G.readTemplateSource(tree(t, { template_remote: v }))).message, names(v), v);
  }
  assert.equal(refusal(() => G.readTemplateSource(tree(t, { other: 'x' }))).message, names(null));
  assert.equal(refusal(() => G.readTemplateSource(tree(t, { template_remote: 42 }))).message, names(42));
  assert.equal(
    refusal(() => G.readTemplateSource(tree(t, undefined))).message,
    'system/template-source.json is missing, so I do not know which template this Alex updates from. Nothing has changed. Send this line to whoever maintains the template.'
  );
  for (const [label, d] of [
    ['another schema', tree(t, { template_remote: 'https://github.com/o/r' }, { schema: 'something-else@1' })],
    ['no header', tree(t, undefined, { raw: '{"template_remote":"https://github.com/o/r"}\n' })],
    ['not JSON', tree(t, undefined, { raw: '{' })]
  ]) {
    const e = refusal(() => G.readTemplateSource(d));
    assert.ok(e instanceof G.Refusal, label);
    assert.match(
      e.message,
      /^system\/template-source\.json cannot be read \(.+\)\. Nothing has changed\. Send this line to whoever maintains the template\.$/s,
      label
    );
  }
});

test('PINNED DEFECT R4-7: an SSH template_remote, which the builder writes unvalidated (R3-5), is refused by the gate', (t) => {
  for (const v of ['git@github.com:Alex-kit-S/virtual-alex.git', 'ssh://git@github.com/Alex-kit-S/virtual-alex.git']) {
    const e = refusal(() => G.readTemplateSource(tree(t, { template_remote: v })));
    assert.equal(
      e.message,
      `system/template-source.json names no GitHub repository (template_remote is ${JSON.stringify(v)}). ${TAILS}`
    );
  }
});

test('the CLI: --root before or after the command, the url alone on stdout, exit 0; a refusal is one stderr line and exit 2', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r.git' });
  for (const args of [
    ['remote', '--root', d],
    ['--root', d, 'remote']
  ]) {
    const r = cli(args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, 'https://github.com/o/r\n', ''], args.join(' '));
  }
  const miss = cli(['remote', '--root', tree(t, undefined)]);
  assert.deepEqual([miss.status, miss.stdout], [2, '']);
  assert.equal(
    miss.stderr,
    'template-gate: REFUSED - system/template-source.json is missing, so I do not know which template this Alex updates from. Nothing has changed. Send this line to whoever maintains the template.\n'
  );
});

test('the CLI: no command or an unknown one is the usage refusal, exit 2', () => {
  for (const args of [[], ['remotes'], ['CI', SHA]]) {
    const r = cli(args);
    assert.deepEqual(
      [r.status, r.stdout, r.stderr],
      [2, '', 'template-gate: REFUSED - usage: node scripts/lib/template-gate.mjs remote | ci <sha> [--root <dir>]\n'],
      args.join(' ')
    );
  }
});

test('ci refuses anything but a full lowercase 40-hex sha BEFORE it reads a file or calls gh', (t) => {
  const d = tree(t, undefined); // no source file: the sha check must come first
  let called = 0;
  for (const [sha, shown] of [
    [undefined, 'null'],
    ['abc1234', '"abc1234"'],
    [SHA.toUpperCase(), JSON.stringify(SHA.toUpperCase())],
    [`${SHA}0`, JSON.stringify(`${SHA}0`)]
  ]) {
    const argv = sha === undefined ? ['ci', '--root', d] : ['ci', sha, '--root', d];
    const e = refusal(() =>
      G.main(argv, {
        run: () => {
          called++;
          return { status: 0, stdout: '{}' };
        }
      })
    );
    assert.equal(e.message, `ci needs the full 40-character template head, got ${shown}`);
  }
  assert.equal(called, 0);
});

test('ci calls gh exactly once, with the pinned arguments, and prints the green line naming the run', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/Example-Org/virtual-alex' });
  /** @type {string[][]} */
  const calls = [];
  const out = G.main(['ci', SHA, '--root', d], {
    run: (args) => {
      calls.push(args);
      return {
        status: 0,
        stdout: JSON.stringify({ check_runs: [run(5, { details_url: 'https://github.com/x/runs/5/job/1' })] })
      };
    }
  });
  assert.deepEqual(calls, [
    ['api', `repos/Example-Org/virtual-alex/commits/${SHA}/check-runs?check_name=portable-tests&per_page=100`]
  ]);
  assert.deepEqual(out, {
    out: `CI green on the template head ${SHA.slice(0, 12)}: https://github.com/x/runs/5/job/1`
  });
});

test('ciVerdict: every conclusion that is not success is a refusal that names it, and the url falls back to html_url, then the run id', () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', null]) {
    const v = G.ciVerdict({ check_runs: [run(9, { conclusion, html_url: 'https://h/9' })] }, SHA);
    assert.deepEqual(
      [v.green, v.why],
      [
        false,
        `the template head ${SHA.slice(0, 12)} FAILED its tests (${conclusion}, https://h/9), so I will not apply it. ${TAILS}`
      ],
      String(conclusion)
    );
  }
  assert.equal(
    G.ciVerdict({ check_runs: [run(9)] }, SHA).why,
    `CI green on the template head ${SHA.slice(0, 12)}: check run 9`
  );
  for (const status of ['queued', 'in_progress', 'waiting']) {
    assert.equal(
      G.ciVerdict({ check_runs: [run(3, { status, conclusion: null })] }, SHA).why,
      `the template head ${SHA.slice(0, 12)} is still being tested (check run 3). Try /update again in ten minutes. Nothing has changed.`
    );
  }
});

test('ciVerdict: only the newest run of THIS job on THIS sha counts; ids compare as numbers', () => {
  const none = `the template head ${SHA.slice(0, 12)} has no CI result yet. Its CI may still be starting: try /update again in ten minutes. Nothing has changed.`;
  assert.equal(G.ciVerdict(null, SHA).why, none);
  assert.equal(
    G.ciVerdict({ check_runs: [run(1, { name: 'heartbeat' }), run(2, { head_sha: 'd'.repeat(40) })] }, SHA).why,
    none
  );
  assert.equal(
    G.ciVerdict({ check_runs: [run('9', { conclusion: 'failure' }), run('10')] }, SHA).green,
    true,
    '"10" is newer than "9"'
  );
  assert.equal(
    G.ciVerdict({ check_runs: [run(10, { conclusion: 'failure' }), run(9)] }, SHA).green,
    false,
    'an older success under a newer failure is red'
  );
});

test('readChecks: gh failing (its first stderr line), gh not starting (the error), and an answer that is not JSON, each a refusal', () => {
  const at = (/** @type {{ status?: number, stdout?: string, stderr?: string, error?: Error }} */ r) =>
    refusal(() => G.readChecks('o/r', SHA, () => r)).message;
  assert.equal(
    at({ status: 1, stderr: 'HTTP 404: Not Found\nmore\n', stdout: '' }),
    'I cannot read the CI result of o/r (HTTP 404: Not Found). Attach o/r to this session as a second repository and type /update again. Nothing has changed.'
  );
  assert.equal(
    at({ status: 1, stderr: '', stdout: '' }),
    'I cannot read the CI result of o/r (exit 1). Attach o/r to this session as a second repository and type /update again. Nothing has changed.'
  );
  assert.equal(
    at({ error: new Error('boom') }),
    'I cannot read the CI result of o/r (boom). Attach o/r to this session as a second repository and type /update again. Nothing has changed.'
  );
  assert.equal(
    at({ status: 0, stdout: '<html>' }),
    'the CI answer from o/r was not readable. Try /update again. Nothing has changed.'
  );
});

test('PINNED DEFECT R4-L1: with no gh on PATH the owner is told to attach the template, which cannot install gh', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r' });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env.PATH = path.dirname(process.execPath);
  const probe = spawnSync('gh', ['--version'], { env });
  if (!probe.error) {
    t.skip("gh lives in node's own folder on this machine, so it cannot be cut from PATH");
    return;
  }
  const r = cli(['ci', SHA, '--root', d], { env });
  assert.equal(r.status, 2);
  assert.equal(
    r.stderr,
    'template-gate: REFUSED - I cannot read the CI result of o/r (spawnSync gh ENOENT). Attach o/r to this session as a second repository and type /update again. Nothing has changed.\n'
  );
});

test('a trailing --root with no value refuses, exit 1, rather than silently reading the current folder', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/cwd-owner/cwd-repo' });
  const r = cli(['remote', '--root'], { cwd: d });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /template-gate: REFUSED -.*--root.*argument missing/s);
});

test('an unknown flag refuses, exit 1, naming the flag; `--root=<dir>` is read the same as `--root <dir>`', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r' });
  const bogus = cli(['remote', '--root', d, '--bogus']);
  assert.deepEqual([bogus.status, bogus.stdout], [1, '']);
  assert.match(bogus.stderr, /unknown flag --bogus/);

  const eq = cli([`--root=${d}`, 'remote']);
  assert.deepEqual([eq.status, eq.stdout, eq.stderr], [0, 'https://github.com/o/r\n', '']);
});

test('a stray word after the command refuses, exit 1, naming it', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r' });
  const remoteExtra = cli(['remote', '--root', d, 'extra-word']);
  assert.deepEqual([remoteExtra.status, remoteExtra.stdout], [1, '']);
  assert.match(remoteExtra.stderr, /remote takes no argument.*"extra-word"/);

  const ciExtra = cli(['ci', SHA, 'extra-word', '--root', d]);
  assert.deepEqual([ciExtra.status, ciExtra.stdout], [1, '']);
  assert.match(ciExtra.stderr, /ci takes one argument.*"extra-word"/);
});

test('PINNED DEFECT R4-L3: one page of 100 runs is read and never a second; the verdict is whatever that page holds', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r' });
  const page = Array.from({ length: 100 }, (_, i) => run(i + 1, { conclusion: 'failure' }));
  let calls = 0;
  const e = refusal(() =>
    G.main(['ci', SHA, '--root', d], {
      run: () => {
        calls++;
        return { status: 0, stdout: JSON.stringify({ total_count: 101, check_runs: page }) };
      }
    })
  );
  assert.equal(calls, 1);
  assert.match(e.message, /FAILED its tests \(failure, check run 100\)/);
});

test('the gate never writes a file', (t) => {
  const d = tree(t, { template_remote: 'https://github.com/o/r' });
  const before = fs.readFileSync(path.join(d, 'system', 'template-source.json'), 'utf8');
  cli(['remote', '--root', d]);
  G.main(['ci', SHA, '--root', d], { run: () => ({ status: 0, stdout: JSON.stringify({ check_runs: [run(1)] }) }) });
  assert.deepEqual(fs.readdirSync(d), ['system']);
  assert.deepEqual(fs.readdirSync(path.join(d, 'system')), ['template-source.json']);
  assert.equal(fs.readFileSync(path.join(d, 'system', 'template-source.json'), 'utf8'), before);
});
