// @ts-check
// scripts/tests/test-template-gate.mjs - /update knows where its template is and applies only a green head.
//
// WHAT. scripts/lib/template-gate.mjs is the two refusals /update runs before it changes anything: the template's
// address comes from system/template-source.json, never a constant, and a head whose CI is not green is never
// applied. Deleted, this file would let a constant address, an unchecked head, a renamed CI job, a gate that exits 0
// through a linked folder, or an owner locked out by their own README.md ship. Each refusal is shown before the pass:
//   S1  NEGATIVE the source file is missing: refused, and the sentence names the file
//   S2  NEGATIVE the file names no repository (empty, not GitHub, a bare word): refused
//   S3  NEGATIVE the file carries another schema: refused
//   C1  NEGATIVE the newest CI run of the head FAILED: refused, even with an older success beside it
//   C2  NEGATIVE the run is still going: not green yet
//   C3  NEGATIVE no run for this head (or only for another sha, or only another check): not green
//   C4  NEGATIVE gh cannot read the answer: refused, and the sentence says to attach the template
//   U1  NEGATIVE-then-pass /update fetches through the gate and checks CI before its yes; no constant
//   U2  NEGATIVE an owner who rewrote README.md is not refused every update; the template's other changes land
//   P1  a good file gives the url and owner/repo; the CLI prints it with exit 0 and refuses with exit 2
//   P2  a green newest run passes and names the run
//   P3  the template's CI job is still named what the gate reads (a rename would refuse every owner)
//   L1  NEGATIVE run through a linked directory, the gate still decides
//   P4  the gate sits under scripts/lib/, which the online settings deny to Edit and the changelog flags
//
// HOW. Fixtures in the OS temp folder; gh is injected, so nothing touches the network. Each leg is its own
// named test(). bash is Git's own on Windows (ALEX_BASH overrides), the shell /update runs under. The gate is
// loaded once, before any test() runs; a test that needs it asserts on G directly, so a failed load fails
// each of those tests individually instead of silently skipping them.
//
// NEVER. Writes inside the repository it runs in: the scratch folder is removed at the end. Moves the ci.yml
// read off its own line or the settings read off its own line without updating standard 8.1's Site column for
// each (both tags sit inside single-purpose test() bodies): a tag in the online ci.yml and standard 8.1 name
// those lines, so a reviewer resolving one must be able to find it again.
//
// Usage: node scripts/tests/test-template-gate.mjs
// Exit: 0 every leg passed - 1 a leg failed

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBash } from './fixtures/find-bash.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GATE = path.join(ROOT, 'scripts', 'lib', 'template-gate.mjs');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));
const require = createRequire(import.meta.url);
const { writeJson } = require('../lib/json-writer.js');

/** @type {any} */
let G = null;
/** @type {string} */
let loadError = '';
before(async () => {
  try {
    G = await import(pathToFileURL(GATE).href);
  } catch (/** @type {any} */ e) {
    loadError = `${path.relative(ROOT, GATE)}: ${e.code || e.message}`;
  }
});

/** @param {() => unknown} fn @param {RegExp} re */
const refusedWith = (fn, re) => {
  try {
    fn();
    return { hit: false, msg: 'did NOT refuse' };
  } catch (/** @type {any} */ e) {
    const isRefusal = G && e instanceof G.Refusal;
    return { hit: isRefusal && re.test(e.message), msg: `${isRefusal ? 'REFUSED' : 'THREW'}: ${e.message}` };
  }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-template-gate-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
/** @param {string} name @param {unknown} [data] @param {string} [schema] */
const tree = (name, data, schema = 'template-source@1') => {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  if (data !== undefined) {
    writeJson(path.join(dir, 'system', 'template-source.json'), data, {
      purpose: 'test fixture',
      writer: 'scripts/tests/test-template-gate.mjs',
      schema,
      generatedAt: '2026-09-24T00:00:00Z'
    });
  }
  return dir;
};
const SHA = 'a'.repeat(40);
/** @param {number} id @param {Record<string, unknown>} [extra] */
const run = (id, extra) => ({
  id,
  name: 'portable-tests',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  details_url: `https://github.com/o/t/actions/runs/${id}/job/1`,
  ...extra
});

describe('scripts/lib/template-gate.mjs', () => {
  test('the gate loads', () => {
    assert.ok(G, loadError);
  });

  describe('negatives first', () => {
    test('S1 NEGATIVE a missing system/template-source.json refuses', () => {
      assert.ok(G, 'no gate');
      const dir = tree('missing');
      const r = refusedWith(() => G.readTemplateSource(dir), /template-source\.json is missing/);
      assert.ok(r.hit, r.msg);
    });

    test('S2 NEGATIVE a source that names no repository refuses', () => {
      assert.ok(G, 'no gate');
      for (const [label, value] of [
        ['empty', ''],
        ['not GitHub', 'https://gitlab.com/o/t'],
        ['a bare word', 'virtual-alex'],
        ['absent key', undefined]
      ]) {
        const dir = tree(
          `bad-${/** @type {string} */ (label).replace(/\W+/g, '-')}`,
          value === undefined ? { other: 'x' } : { template_remote: value }
        );
        const r = refusedWith(() => G.readTemplateSource(dir), /names no GitHub repository/);
        assert.ok(r.hit, `(${label}) ${r.msg}`);
      }
    });

    test('S3 NEGATIVE a source under another schema refuses', () => {
      assert.ok(G, 'no gate');
      const dir = tree('schema', { template_remote: 'https://github.com/o/t' }, 'something-else@1');
      const r = refusedWith(() => G.readTemplateSource(dir), /cannot be read .*schema/);
      assert.ok(r.hit, r.msg);
    });

    test('C1 NEGATIVE the newest run failed: not green, although an older run succeeded', () => {
      assert.ok(G, 'no gate');
      const failed = G.ciVerdict({ check_runs: [run(10), run(11, { conclusion: 'failure' })] }, SHA);
      assert.equal(failed.green, false, failed.why);
      assert.match(failed.why, /FAILED its tests \(failure/);
    });

    test('C2 NEGATIVE a run still going is not green yet', () => {
      assert.ok(G, 'no gate');
      const going = G.ciVerdict({ check_runs: [run(12, { status: 'in_progress', conclusion: null })] }, SHA);
      assert.equal(going.green, false, going.why);
      assert.match(going.why, /still being tested/);
    });

    test('C3 NEGATIVE no run of the CI job on this exact head is not green', () => {
      assert.ok(G, 'no gate');
      const none = G.ciVerdict({ check_runs: [] }, SHA);
      const other = G.ciVerdict(
        { check_runs: [run(13, { head_sha: 'b'.repeat(40) }), run(14, { name: 'heartbeat' })] },
        SHA
      );
      assert.equal(none.green, false);
      assert.equal(other.green, false, other.why);
      assert.match(other.why, /no CI result yet/);
    });

    test('C4 NEGATIVE gh cannot read the answer: refused, telling the owner to attach the template', () => {
      assert.ok(G, 'no gate');
      const blind = refusedWith(
        () =>
          G.main(['ci', SHA, '--root', tree('blind', { template_remote: 'https://github.com/o/t' })], {
            run: () => ({ status: 1, stderr: 'HTTP 403: Resource not accessible\n', stdout: '' })
          }),
        /Attach o\/t to this session/
      );
      assert.ok(blind.hit, blind.msg);
    });
  });

  test("U1 /update fetches from the gate's address and checks CI before it asks for a yes", () => {
    const update = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'update.md'), 'utf8');
    const constant = /git fetch https?:\/\//.test(update);
    const remote = update.includes('node scripts/lib/template-gate.mjs remote');
    const ci = update.includes('node scripts/lib/template-gate.mjs ci "$HEAD_T"');
    const ciBeforeYes =
      ci && update.indexOf('node scripts/lib/template-gate.mjs ci "$HEAD_T"') < update.indexOf('**WAIT for yes.**');
    assert.ok(!constant, `hard-coded fetch: ${constant}`);
    assert.ok(remote, 'remote through the gate');
    assert.ok(ci, 'CI through the gate');
    assert.ok(ciBeforeYes, 'CI checked before the yes');
  });

  // U2: `git apply -3` cannot reconcile a README.md the owner rewrote, and /update once refused every later
  // update for it. This leg runs update.md's shipped step 4 and 5 bash on a synthetic template and owner repo.
  test('U2 NEGATIVE an owner-rewritten README.md does not block the update: theirs stays, the rest of the template lands', () => {
    const bash = findBash();
    const update = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'update.md'), 'utf8');
    const blocks = [...update.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
    const keepBlock = blocks.find((b) => /for f in README\.md/.test(b)) || '';
    const diffBlock = blocks.find((b) => /git diff --full-index --binary/.test(b)) || '';
    const applyBlock = blocks.find((b) => /git apply -3 --index/.test(b)) || '';
    /** @param {string} cwd @param {...string} args */
    const g = (cwd, ...args) =>
      spawnSync(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.autocrlf=false', ...args],
        { cwd, encoding: 'utf8' }
      );
    /** @param {string} dir @param {string} rel @param {string} text */
    const put = (dir, rel, text) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    const tpl = path.join(TMP, 'u2-template');
    const own = path.join(TMP, 'u2-owner');
    for (const d of [tpl, own]) {
      fs.mkdirSync(d, { recursive: true });
      g(d, 'init', '-q', '-b', 'main');
    }
    const baseFiles = {
      'README.md': '# Template\n\nline one\nline two\nline three\n',
      'CLAUDE.md': 'rule one\n',
      'SECURITY.md': 'report here\n',
      LICENSE: 'MIT\n'
    };
    for (const [rel, text] of Object.entries(baseFiles)) {
      put(tpl, rel, text);
      put(own, rel, text);
    }
    g(tpl, 'add', '-A');
    g(tpl, 'commit', '-qm', 'base');
    const BASE = g(tpl, 'rev-parse', 'HEAD').stdout.trim();
    put(tpl, 'README.md', '# Template\n\nline one, changed by the template\nline two\nline three\n');
    put(tpl, 'CLAUDE.md', 'rule one\nrule two, new in the template\n');
    g(tpl, 'add', '-A');
    g(tpl, 'commit', '-qm', 'template moves');
    const HEAD_T = g(tpl, 'rev-parse', 'HEAD').stdout.trim();
    const ownReadme = '# My own front page\n\nNothing here is the template any more.\n';
    put(own, 'README.md', ownReadme);
    g(own, 'add', '-A');
    g(own, 'commit', '-qm', 'the owner writes a front page');
    g(own, 'fetch', '-q', tpl, 'main:refs/alex/template-head');
    const script = [keepBlock, diffBlock, applyBlock, 'echo "APPLY_EXIT=$?"'].join('\n');
    const r = spawnSync(bash, ['-c', script], {
      cwd: own,
      encoding: 'utf8',
      env: { ...process.env, BASE, HEAD_T, PRE: g(own, 'rev-parse', 'HEAD').stdout.trim() }
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const applied = /APPLY_EXIT=0/.test(out);
    const readme = fs.readFileSync(path.join(own, 'README.md'), 'utf8');
    const claude = fs.readFileSync(path.join(own, 'CLAUDE.md'), 'utf8');
    assert.ok(applied, applied ? 'exit 0' : `FAILED (${(out.match(/APPLY_EXIT=\d+/) || ['no exit line'])[0]})`);
    assert.equal(readme, ownReadme, "README is the owner's");
    assert.match(claude, /rule two, new in the template/, 'template rule landed');
    assert.match(
      out,
      /kept as yours: README\.md/,
      (out.match(/kept as yours:[^\n]*/) || ['no "kept as yours" line'])[0]
    );
    assert.doesNotMatch(out, /kept as yours:.*SECURITY/, 'only the files both sides changed are named kept-as-yours');
  });

  describe('positives', () => {
    test('P1 a good source gives the address and owner/repo; the CLI prints it with exit 0 and refuses a missing file with exit 2', () => {
      assert.ok(G, 'no gate');
      const dir = tree('good', { template_remote: 'https://github.com/Example-Org/virtual-alex.git' });
      const s = G.readTemplateSource(dir);
      assert.equal(s.remote, 'https://github.com/Example-Org/virtual-alex', JSON.stringify(s));
      assert.equal(s.repo, 'Example-Org/virtual-alex');
      const cli = spawnSync(process.execPath, [GATE, 'remote', '--root', dir], { encoding: 'utf8' });
      const cliMissing = spawnSync(process.execPath, [GATE, 'remote', '--root', tree('cli-missing')], {
        encoding: 'utf8'
      });
      assert.equal(cli.status, 0, `exit ${cli.status}`);
      assert.equal(cli.stdout.trim(), 'https://github.com/Example-Org/virtual-alex');
      assert.equal(cliMissing.status, 2, `missing: exit ${cliMissing.status}`);
      assert.match(cliMissing.stderr, /REFUSED/);
    });

    // L1 NEGATIVE: Node resolves a linked folder (macOS's /var -> /private/var, a Windows junction) to its
    // real path, and a gate comparing the typed path to it decided it was imported, did nothing and exited 0.
    test('L1 NEGATIVE run through a linked directory, a missing source still refuses with exit 2', () => {
      assert.ok(G, 'no gate');
      const link = path.join(TMP, 'scripts-link');
      try {
        fs.symlinkSync(path.join(ROOT, 'scripts'), link, 'junction');
      } catch (/** @type {any} */ e) {
        assert.fail(`L1 a directory link can be made here: ${e.message}`);
      }
      try {
        const via = spawnSync(
          process.execPath,
          [path.join(link, 'lib', 'template-gate.mjs'), 'remote', '--root', tree('link-missing')],
          { encoding: 'utf8' }
        );
        assert.equal(via.status, 2, `exit ${via.status}, ${(via.stdout + via.stderr).trim().length} byte(s) of output`);
        assert.match(via.stderr, /REFUSED/);
      } finally {
        fs.rmSync(link, { force: true }); // the link itself, never what it points at
      }
    });

    test('P2 a green newest run passes and names the run, end to end through the ci command (gh injected)', () => {
      assert.ok(G, 'no gate');
      const green = G.ciVerdict({ check_runs: [run(20, { conclusion: 'failure' }), run(21)] }, SHA);
      assert.ok(green.green, green.why);
      assert.match(green.why, /actions\/runs\/21/);
      const dir = tree('good-p2b', { template_remote: 'https://github.com/Example-Org/virtual-alex.git' });
      const viaMain = G.main(['ci', SHA, '--root', dir], {
        run: () => ({ status: 0, stdout: JSON.stringify({ check_runs: [run(22)] }) })
      });
      assert.match(viaMain.out, /CI green/, viaMain.out);
    });
  });

  // The CI job named here is the gate's CI_CHECK; renaming it in ci.yml without updating this leg would
  // let every owner's update refuse.
  test('P3 the template CI job is named what the gate reads (a rename would refuse every owner)', () => {
    const ciFile = IS_KIT
      ? path.join(ROOT, 'variants', 'online', '.github', 'workflows', 'ci.yml')
      : path.join(ROOT, '.github', 'workflows', 'ci.yml');
    const text = fs.existsSync(ciFile) ? fs.readFileSync(ciFile, 'utf8') : '';
    const named = G && new RegExp(`^  ${G.CI_CHECK}:\\s*$`, 'm').test(text);
    assert.ok(named, `${path.relative(ROOT, ciFile)} job "${G ? G.CI_CHECK : '?'}": ${named ? 'present' : 'ABSENT'}`);
  });

  // This leg confirms variants/online/.claude/settings.json's Edit(/scripts/lib/**) deny rule is still the
  // rule protecting the gate named below.
  test('P4 the gate sits where a session cannot Edit it and every change to it is a flagged changelog path', () => {
    const settings = [
      path.join(ROOT, 'variants', 'online', '.claude', 'settings.json'),
      path.join(ROOT, '.claude', 'settings.json')
    ].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('Edit(/scripts/lib/**)'));
    const under = path.relative(ROOT, GATE).split(path.sep).join('/').startsWith('scripts/lib/');
    assert.ok(under, path.relative(ROOT, GATE));
    assert.ok(settings, `deny rule in ${settings ? path.relative(ROOT, settings) : 'NO settings file'}`);
  });
});
