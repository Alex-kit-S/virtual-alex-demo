// @ts-check
// scripts/tests/test-install-state.mjs - one writer and one schema for system/install-state.json.
//
// WHAT. A record carrying two key sets makes a reader take the owner's own commit for a template version,
// so scripts/lib/install-state.js is the one writer, with one key set, held by these legs. Deleted, a second
// writer or the legacy `head` / `previousHead` / `updatedAt` names could come back with CI still green:
//   I1  NEGATIVE the legacy camelCase key set cannot be written through this Kit's JSON standard
//       at all (writeJson throws on `previousHead`), which is why it is the one that lost
//   I2  a legacy-only file reads as a current one, so an installed copy keeps its record
//   I3  stamp writes ONLY the surviving keys and drops the legacy ones
//   I4  stamp moves the current commit to previous_template_commit
//   I5  NEGATIVE stamp refuses anything that is not a commit sha, and writes nothing
//   I6  DRIFT no tracked file outside the library names a legacy key, so there is one schema
//   I7  DRIFT no tracked file outside the library writes the record, so there is one writer
//   I8  migration 002 DECLINES online, where git HEAD is the owner's commit and not a version
//   D1-D4 `install-state.js line` names the template build, its date and age, and when this copy
//       took it, from VERSION or else the changelog, and says "unknown" rather than guess
//   D5  NEGATIVE /alex-status and the brief's monthly line print it, with no ls-remote anywhere
//
// HOW. I1 to I5 and I8 write fixture records under the OS temp directory, each in its own folder removed
// when that test ends; I6 and I7 read the tracked files of this checkout with git ls-files.
//
// NEVER. Writes inside this repository. Leaves an `alex-instate-*` OS temp folder behind: every fixture
// root is removed in the test's own after() hook, even when the test fails.
//
// Usage: node scripts/tests/test-install-state.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const installState = require('../lib/install-state.js');
const { writeJson } = require('../lib/json-writer.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/**
 * A fresh fixture root, removed when the test ends even on failure.
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
const root = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-instate-'));
  fs.mkdirSync(path.join(d, 'system'), { recursive: true });
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
/** @param {string} d a fixture root */
const readRaw = (d) => JSON.parse(fs.readFileSync(path.join(d, 'system', 'install-state.json'), 'utf8'));

describe('scripts/lib/install-state.js', () => {
  test('I1 NEGATIVE writeJson REFUSES the legacy camelCase key set', (t) => {
    const d = root(t);
    assert.throws(
      () =>
        writeJson(
          path.join(d, 'system', 'legacy.json'),
          { head: 'abc1234', previousHead: null, updatedAt: '2026-09-23' },
          { purpose: 'the legacy shape', writer: 'test', schema: 'legacy@1' }
        ),
      /previousHead/
    );
  });

  test('I2 a legacy-only file reads as a current one', (t) => {
    const d = root(t);
    fs.writeFileSync(
      path.join(d, 'system', 'install-state.json'),
      JSON.stringify(
        {
          head: 'aaaaaaabbbbbbbccccccc1111111222222233333334',
          previousHead: 'dddddddeeeeeeefffffff4444444555555566666667',
          updatedAt: '2026-08-31',
          seededBy: '002-install-state-seed'
        },
        null,
        2
      ) + '\n'
    );
    const s = installState.read(d);
    assert.ok(s, 'a legacy-only file still reads as a record');
    assert.equal(
      s.template_commit,
      'aaaaaaabbbbbbbccccccc1111111222222233333334',
      'a legacy `head` reads as template_commit'
    );
    assert.equal(
      s.previous_template_commit,
      'dddddddeeeeeeefffffff4444444555555566666667',
      'a legacy `previousHead` reads as previous_template_commit'
    );
    assert.equal(s.template_updated_at, '2026-08-31', 'a legacy `updatedAt` reads as template_updated_at');
    assert.equal(s.stamped_by, '002-install-state-seed', 'a legacy `seededBy` reads as stamped_by');
  });

  test('I3 + I4 the stamp drops every legacy key, writes template_commit, moves the old one to previous_template_commit, and reads back before returning', (t) => {
    const d = root(t);
    fs.writeFileSync(
      path.join(d, 'system', 'install-state.json'),
      JSON.stringify(
        {
          head: '1111111111111111111111111111111111111111',
          previousHead: null,
          updatedAt: '2026-08-31'
        },
        null,
        2
      ) + '\n'
    );
    const out = installState.stamp(d, '2222222222222222222222222222222222222222', { by: 'test', at: '2026-09-23' });
    const raw = readRaw(d);
    const legacyLeft = Object.keys(raw).filter((k) => ['head', 'previousHead', 'updatedAt', 'seededBy'].includes(k));
    assert.deepEqual(legacyLeft, [], `I3 the stamp drops every legacy key: still there: ${legacyLeft.join(', ')}`);
    assert.equal(raw.template_commit, '2222222222222222222222222222222222222222', 'I3 template_commit written');
    assert.equal(out.template_commit, raw.template_commit, 'I3 the stamp read the record back before returning');
    assert.equal(
      raw.previous_template_commit,
      '1111111111111111111111111111111111111111',
      'I4 the legacy head became previous_template_commit'
    );
    assert.equal(raw.template_updated_at, '2026-09-23', 'I4 the date is the one given');
    assert.equal(typeof raw._schema, 'string');
    assert.equal(raw._schema, installState.SCHEMA, 'I4 the record carries the JSON standard header');
  });

  test('I5 NEGATIVE stamp refuses a non-sha, and writes nothing', (t) => {
    const d = root(t);
    assert.throws(() => installState.stamp(d, 'not-a-sha', { by: 'test' }), /not a commit sha/);
    assert.equal(
      fs.existsSync(path.join(d, 'system', 'install-state.json')),
      false,
      'nothing was written on the refusal'
    );
  });

  test('I6 + I7 DRIFT: one schema, one writer', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((f) => /\.(js|mjs|cjs|md|cmd|command|sh|json|yml)$/.test(f))
      .filter((f) => !f.startsWith('.agents/skills/'))
      .filter((f) => f !== 'scripts/lib/install-state.js' && f !== 'scripts/tests/test-install-state.mjs');

    const legacyNamers = [];
    const foreignWriters = [];
    for (const rel of tracked) {
      let text;
      try {
        text = fs.readFileSync(path.join(REPO, rel), 'utf8');
      } catch {
        continue;
      }
      if (!/install-state/.test(text)) continue;
      for (const line of text.split(/\r?\n/)) {
        if (!/install-state|previousHead|seededBy/.test(line) && !/\bhead\b.*install-state/.test(line)) continue;
        if (/previousHead|seededBy/.test(line)) legacyNamers.push(`${rel}: ${line.trim().slice(0, 100)}`);
        if (/install-state\.json/.test(line) && /writeFileSync|>\s*system|Set-Content|Out-File/.test(line)) {
          foreignWriters.push(`${rel}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    assert.deepEqual(legacyNamers, [], 'I6 no tracked file outside the library names a legacy key');
    assert.deepEqual(foreignWriters, [], 'I7 no tracked file outside the library writes the record');
  });

  test('I8 migration 002 DECLINES in a cloud session, and still seeds on a laptop with the surviving key set', (t) => {
    const mig = require('../migrations/002-install-state-seed.js');
    const d = root(t);
    execFileSync('git', ['init', '-q'], { cwd: d });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'seed'], {
      cwd: d
    });

    const before = process.env.CLAUDE_CODE_REMOTE;
    process.env.CLAUDE_CODE_REMOTE = 'true';
    const online = mig.run({ root: d, log: () => {} });
    if (before === undefined) delete process.env.CLAUDE_CODE_REMOTE;
    else process.env.CLAUDE_CODE_REMOTE = before;
    assert.equal(online.status, 'declined', online.message);
    assert.equal(
      fs.existsSync(path.join(d, 'system', 'install-state.json')),
      false,
      "it wrote no version record online, where git HEAD is the owner's own commit"
    );

    const laptop = mig.run({ root: d, log: () => {} });
    assert.equal(laptop.status, 'applied', laptop.message);
    const raw = readRaw(d);
    assert.equal(typeof raw.template_commit, 'string');
    assert.equal(
      raw.head,
      undefined,
      `it seeds the SURVIVING key set: ${Object.keys(raw)
        .filter((k) => !k.startsWith('_'))
        .join(', ')}`
    );
  });

  // D: how old is this copy, from local files only. A Routine cannot read the template, so
  // `install-state.js line` answers from the tree's own VERSION, changelog and stamp: no fetch,
  // no ls-remote, no network.
  describe('install-state.js line', () => {
    const lib = path.join(REPO, 'scripts', 'lib', 'install-state.js');
    /**
     * The `line` command's output for a fixture root, measured against a fixed day.
     * @param {string} d
     * @param {string} [today]
     */
    const lineOf = (d, today = '2026-10-24') =>
      execFileSync(process.execPath, [lib, 'line', '--root', d], {
        encoding: 'utf8',
        env: { ...process.env, ALEX_TODAY: today }
      }).trim();
    /** @param {string} d @returns {{ out: string, err: string }} never throws */
    const tryLine = (d) => {
      try {
        return { out: lineOf(d), err: '' };
      } catch (/** @type {any} */ e) {
        return {
          out: '',
          err: String(e.stdout || e.message)
            .trim()
            .slice(0, 120)
        };
      }
    };

    test('D1 NEGATIVE names the build, its date and age, and when this copy took it', (t) => {
      const d1 = root(t);
      fs.writeFileSync(
        path.join(d1, 'VERSION'),
        'Virtual Alex template build 35, 2026-09-24, from Kit commit 9213584a0e3b\n'
      );
      installState.stamp(d1, '24bd6cb505735876eff0902ab6953d656e3bc8fa', { by: '/update', at: '2026-09-24' });
      const r1 = tryLine(d1);
      assert.match(r1.out, /template build 35, built 2026-09-24 \(30 days ago\)/, r1.out || r1.err);
      assert.match(r1.out, /updated to it on 2026-09-24 by \/update, template commit 24bd6cb/, r1.out || r1.err);
    });

    test('D2 a copy that never ran /update says so, and still names its build', (t) => {
      const d2 = root(t);
      fs.writeFileSync(
        path.join(d2, 'VERSION'),
        'Virtual Alex template build 26, 2026-09-24, from Kit commit d55b80ffda21\n'
      );
      const r2 = tryLine(d2);
      assert.match(r2.out, /template build 26, built 2026-09-24/, r2.out || r2.err);
      assert.match(r2.out, /has not run \/update yet/, r2.out || r2.err);
    });

    test('D3 an older tree with no VERSION falls back to its changelog', (t) => {
      const d3 = root(t);
      fs.writeFileSync(
        path.join(d3, 'system', 'template-changelog.jsonl'),
        '{"at":"2026-09-20T10:00:00Z","previous_template_commit":null}\n{"at":"2026-09-22T09:00:00Z","build":24,"previous_template_commit":"abc"}\n'
      );
      const r3 = tryLine(d3);
      assert.match(r3.out, /template build 24, built 2026-09-22/, r3.out || r3.err);
    });

    test('D4 a tree with neither says "unknown" and exits 0', (t) => {
      const d4 = root(t); // no fixture files written: neither VERSION nor a changelog
      const r4 = tryLine(d4);
      assert.match(r4.out, /template build unknown/, r4.out || r4.err);
      assert.equal(r4.err, '', 'exits 0 (tryLine would carry stderr/the exception here otherwise)');
    });

    /** @param {string[]} args @param {Record<string,string>} [env] */
    const spawnLine = (args, env = {}) =>
      spawnSync(process.execPath, [lib, ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env }
      });

    test('D6 an unknown flag on `line` warns on stderr and still prints the line', (t) => {
      const d6 = root(t);
      fs.writeFileSync(
        path.join(d6, 'VERSION'),
        'Virtual Alex template build 9, 2026-09-01, from Kit commit 000000000000\n'
      );
      const r = spawnLine(['line', '--bogus', '--root', d6], { ALEX_TODAY: '2026-09-03' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /template build 9, built 2026-09-01 \(2 days ago\)/, r.stdout || r.stderr);
      assert.match(r.stderr, /WARNING.*unknown flag --bogus/, r.stderr);
    });

    test('D7 `--root=<dir>` is read the same as `--root <dir>`', (t) => {
      const d7 = root(t);
      fs.writeFileSync(
        path.join(d7, 'VERSION'),
        'Virtual Alex template build 11, 2026-09-01, from Kit commit 000000000000\n'
      );
      const r = spawnLine([`line`, `--root=${d7}`], { ALEX_TODAY: '2026-09-03' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /template build 11, built 2026-09-01/, r.stdout || r.stderr);
    });

    test('D8 a dangling `--root` or a stray word on `line` warns on stderr and still prints the line, never a crash', () => {
      const dangling = spawnLine(['line', '--root']);
      assert.equal(dangling.status, 0, dangling.stderr);
      assert.match(dangling.stdout, /Alex is on template build/, dangling.stdout || dangling.stderr);
      assert.match(dangling.stderr, /^install-state: WARNING -/, dangling.stderr);
      assert.doesNotMatch(dangling.stderr, /\bat\s+\S+\s+\(/, 'no Node stack trace on stderr');

      const stray = spawnLine(['line', 'stray']);
      assert.equal(stray.status, 0, stray.stderr);
      assert.match(stray.stdout, /Alex is on template build/, stray.stdout || stray.stderr);
      assert.match(stray.stderr, /^install-state: WARNING -/, stray.stderr);
      assert.doesNotMatch(stray.stderr, /\bat\s+\S+\s+\(/, 'no Node stack trace on stderr');
    });

    test("D5 NEGATIVE /alex-status and the brief's monthly line print it, and neither reaches the network for it", () => {
      const tree = fs.existsSync(path.join(REPO, 'variants', 'online')) ? path.join(REPO, 'variants', 'online') : REPO;
      const status = fs.readFileSync(path.join(tree, '.claude', 'commands', 'alex-status.md'), 'utf8');
      const brief = fs.readFileSync(path.join(REPO, 'scheduler', 'routines', 'brief.md'), 'utf8');
      /** @param {string} t2 a command file's text */
      const calls = (t2) => t2.includes('node scripts/lib/install-state.js line');
      assert.ok(calls(status), `alex-status: ${calls(status)}`);
      assert.ok(calls(brief), `brief: ${calls(brief)}`);
      assert.doesNotMatch(status, /ls-remote/);
      assert.doesNotMatch(brief, /ls-remote/);
    });
  });
});
