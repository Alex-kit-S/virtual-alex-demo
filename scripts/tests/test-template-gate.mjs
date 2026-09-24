#!/usr/bin/env node
// scripts/tests/test-template-gate.mjs - /update knows where its template is and applies only a
// green head (review findings F02 and F12, fleet Fix A, 2026-09-24).
//
// WHAT. scripts/lib/template-gate.mjs is the two refusals /update runs before it changes anything: the
// template's address comes from system/template-source.json, never from a constant, and a template
// head whose CI is not green is never applied. Each refusal is shown REFUSING before the pass.
//   S1  NEGATIVE the source file is missing: refused, and the sentence names the file
//   S2  NEGATIVE the file names no repository (empty, not GitHub, a bare word): refused
//   S3  NEGATIVE the file carries another schema: refused
//   C1  NEGATIVE the newest CI run of the head FAILED: refused, even with an older success beside it
//   C2  NEGATIVE the run is still going: not green yet
//   C3  NEGATIVE no run for this head (or only for another sha, or only another check): not green
//   C4  NEGATIVE gh cannot read the answer: refused, and the sentence says to attach the template
//   U1  NEGATIVE-then-pass /update fetches through the gate and checks CI before its yes; no constant
//   U2  NEGATIVE an owner who rewrote README.md, then saw the template change it, is not refused
//       every update: update.md's own step 4 and 5 bash, run on a synthetic template and owner
//       repository, keeps the owner's page and still lands the template's other changes
//   P1  a good file gives the url and owner/repo; the CLI prints it with exit 0 and refuses with exit 2
//   P2  a green newest run passes and names the run
//   P3  the template's CI job is still named what the gate reads (a rename would refuse every owner)
//   L1  NEGATIVE run through a linked directory, the gate still decides (it once exited 0 silently)
//   P4  the gate sits under scripts/lib/, which the online settings deny to Edit and the changelog flags
//
// HOW. Fixtures in a temporary directory; gh is injected, so nothing touches the network.
// Run: node scripts/tests/test-template-gate.mjs      (exit 0 = all pass, 1 = any failure)
//
// NEVER. Never writes inside the repository it runs in. The scratch directory is removed at the end.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GATE = path.join(ROOT, 'scripts', 'lib', 'template-gate.mjs');
const IS_KIT = fs.existsSync(path.join(ROOT, 'variants', 'online'));
const require = createRequire(import.meta.url);
const { writeJson } = require('../lib/json-writer.js');

let failures = 0;
const ok = (cond, name, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!cond) failures++;
};

let G = null;
try { G = await import(pathToFileURL(GATE).href); } catch (e) {
  ok(false, 'the gate loads', `${path.relative(ROOT, GATE)}: ${e.code || e.message}`);
}
const refusedWith = (fn, re) => {
  try { fn(); return { hit: false, msg: 'did NOT refuse' }; } catch (e) {
    const isRefusal = G && e instanceof G.Refusal;
    return { hit: isRefusal && re.test(e.message), msg: `${isRefusal ? 'REFUSED' : 'THREW'}: ${e.message}` };
  }
};

// On Windows `bash` on PATH may be WSL's launcher; /update runs under Git's own bash, so use that.
function findBash() {
  if (process.env.ALEX_BASH) return process.env.ALEX_BASH;
  if (process.platform !== 'win32') return 'bash';
  const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' });
  for (const line of (where.stdout || '').split(/\r?\n/)) {
    const cand = line.trim() && path.join(path.dirname(path.dirname(line.trim())), 'bin', 'bash.exe');
    if (cand && fs.existsSync(cand)) return cand;
  }
  return 'bash';
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-template-gate-'));
const tree = (name, data, schema = 'template-source@1') => {
  const dir = path.join(TMP, name);
  fs.mkdirSync(path.join(dir, 'system'), { recursive: true });
  if (data !== undefined) {
    writeJson(path.join(dir, 'system', 'template-source.json'), data,
      { purpose: 'test fixture', writer: 'scripts/tests/test-template-gate.mjs', schema, generatedAt: '2026-09-24T00:00:00Z' });
  }
  return dir;
};
const SHA = 'a'.repeat(40);
const run = (id, extra) => ({ id, name: 'portable-tests', head_sha: SHA, status: 'completed', conclusion: 'success', details_url: `https://github.com/o/t/actions/runs/${id}/job/1`, ...extra });

try {
  // ---- negatives first --------------------------------------------------------------------------
  {
    const dir = tree('missing');
    const r = G ? refusedWith(() => G.readTemplateSource(dir), /template-source\.json is missing/) : { hit: false, msg: 'no gate' };
    ok(r.hit, 'S1 NEGATIVE a missing system/template-source.json refuses', r.msg);
  }
  for (const [label, value] of [['empty', ''], ['not GitHub', 'https://gitlab.com/o/t'], ['a bare word', 'virtual-alex'], ['absent key', undefined]]) {
    const dir = tree(`bad-${label.replace(/\W+/g, '-')}`, value === undefined ? { other: 'x' } : { template_remote: value });
    const r = G ? refusedWith(() => G.readTemplateSource(dir), /names no GitHub repository/) : { hit: false, msg: 'no gate' };
    ok(r.hit, `S2 NEGATIVE a source that names no repository refuses (${label})`, r.msg);
  }
  {
    const dir = tree('schema', { template_remote: 'https://github.com/o/t' }, 'something-else@1');
    const r = G ? refusedWith(() => G.readTemplateSource(dir), /cannot be read .*schema/) : { hit: false, msg: 'no gate' };
    ok(r.hit, 'S3 NEGATIVE a source under another schema refuses', r.msg);
  }
  if (G) {
    const failed = G.ciVerdict({ check_runs: [run(10), run(11, { conclusion: 'failure' })] }, SHA);
    ok(!failed.green && /FAILED its tests \(failure/.test(failed.why), 'C1 NEGATIVE the newest run failed: not green, although an older run succeeded', failed.why);
    const going = G.ciVerdict({ check_runs: [run(12, { status: 'in_progress', conclusion: null })] }, SHA);
    ok(!going.green && /still being tested/.test(going.why), 'C2 NEGATIVE a run still going is not green yet', going.why);
    const none = G.ciVerdict({ check_runs: [] }, SHA);
    const other = G.ciVerdict({ check_runs: [run(13, { head_sha: 'b'.repeat(40) }), run(14, { name: 'heartbeat' })] }, SHA);
    ok(!none.green && !other.green && /no CI result yet/.test(other.why), 'C3 NEGATIVE no run of the CI job on this exact head is not green', other.why);
    const blind = refusedWith(() => G.main(['ci', SHA, '--root', tree('blind', { template_remote: 'https://github.com/o/t' })],
      { run: () => ({ status: 1, stderr: 'HTTP 403: Resource not accessible\n', stdout: '' }) }), /Attach o\/t to this session/);
    ok(blind.hit, 'C4 NEGATIVE gh cannot read the answer: refused, telling the owner to attach the template', blind.msg);
  } else {
    ['C1', 'C2', 'C3', 'C4'].forEach((c) => ok(false, `${c} the CI verdict`, 'no gate'));
  }

  // ---- U1: /update goes through the gate --------------------------------------------------------
  {
    const update = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'update.md'), 'utf8');
    const constant = /git fetch https?:\/\//.test(update);
    const remote = update.includes('node scripts/lib/template-gate.mjs remote');
    const ci = update.includes('node scripts/lib/template-gate.mjs ci "$HEAD_T"');
    const ciBeforeYes = ci && update.indexOf('node scripts/lib/template-gate.mjs ci "$HEAD_T"') < update.indexOf('**WAIT for yes.**');
    ok(!constant && remote && ci && ciBeforeYes, 'U1 /update fetches from the gate\'s address and checks CI before it asks for a yes',
      `hard-coded fetch: ${constant}, remote through the gate: ${remote}, CI through the gate: ${ci}, before the yes: ${ciBeforeYes}`);
  }

  // ---- U2: an owner who rewrote their front page is not locked out ------------------------------
  // Measured on the demo (fleet Fix B, 2026-09-24): the owner rewrote README.md, the template then
  // changed its own README.md, `git apply -3` could not reconcile a rewritten page, and /update reset
  // and refused EVERY later update. This leg runs the shipped bash of steps 4 and 5, lifted out of
  // update.md, against a synthetic template and owner repository, so it tests the text an owner's
  // session actually follows.
  {
    const bash = findBash();
    const update = fs.readFileSync(path.join(ROOT, '.claude', 'commands', 'update.md'), 'utf8');
    const blocks = [...update.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
    const keepBlock = blocks.find((b) => /for f in README\.md/.test(b)) || '';
    const diffBlock = blocks.find((b) => /git diff --full-index --binary/.test(b)) || '';
    const applyBlock = blocks.find((b) => /git apply -3 --index/.test(b)) || '';
    const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
    const put = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
    const tpl = path.join(TMP, 'u2-template');
    const own = path.join(TMP, 'u2-owner');
    for (const d of [tpl, own]) { fs.mkdirSync(d, { recursive: true }); g(d, 'init', '-q', '-b', 'main'); }
    const baseFiles = { 'README.md': '# Template\n\nline one\nline two\nline three\n', 'CLAUDE.md': 'rule one\n', 'SECURITY.md': 'report here\n', 'LICENSE': 'MIT\n' };
    for (const [rel, text] of Object.entries(baseFiles)) { put(tpl, rel, text); put(own, rel, text); }
    g(tpl, 'add', '-A'); g(tpl, 'commit', '-qm', 'base');
    const BASE = g(tpl, 'rev-parse', 'HEAD').stdout.trim();
    put(tpl, 'README.md', '# Template\n\nline one, changed by the template\nline two\nline three\n');
    put(tpl, 'CLAUDE.md', 'rule one\nrule two, new in the template\n');
    g(tpl, 'add', '-A'); g(tpl, 'commit', '-qm', 'template moves');
    const HEAD_T = g(tpl, 'rev-parse', 'HEAD').stdout.trim();
    const ownReadme = '# My own front page\n\nNothing here is the template any more.\n';
    put(own, 'README.md', ownReadme);
    g(own, 'add', '-A'); g(own, 'commit', '-qm', 'the owner writes a front page');
    g(own, 'fetch', '-q', tpl, 'main:refs/alex/template-head');
    const script = [keepBlock, diffBlock, applyBlock, 'echo "APPLY_EXIT=$?"'].join('\n');
    const r = spawnSync(bash, ['-c', script], { cwd: own, encoding: 'utf8', env: { ...process.env, BASE, HEAD_T, PRE: g(own, 'rev-parse', 'HEAD').stdout.trim() } });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const applied = /APPLY_EXIT=0/.test(out);
    const readme = fs.readFileSync(path.join(own, 'README.md'), 'utf8');
    const claude = fs.readFileSync(path.join(own, 'CLAUDE.md'), 'utf8');
    ok(applied && readme === ownReadme && /rule two, new in the template/.test(claude),
      'U2 NEGATIVE an owner-rewritten README.md does not block the update: theirs stays, the rest of the template lands',
      `apply ${applied ? 'exit 0' : `FAILED (${(out.match(/APPLY_EXIT=\d+/) || ['no exit line'])[0]})`}; README is the owner's: ${readme === ownReadme}; template rule landed: ${/rule two/.test(claude)}`);
    ok(/kept as yours: README\.md/.test(out) && !/kept as yours:.*SECURITY/.test(out),
      'U2 and the step names README.md as kept, and only the files both sides changed',
      (out.match(/kept as yours:[^\n]*/) || ['no "kept as yours" line'])[0]);
  }

  // ---- positives --------------------------------------------------------------------------------
  if (G) {
    const dir = tree('good', { template_remote: 'https://github.com/Example-Org/virtual-alex.git' });
    const s = G.readTemplateSource(dir);
    ok(s.remote === 'https://github.com/Example-Org/virtual-alex' && s.repo === 'Example-Org/virtual-alex',
      'P1 a good source gives the address and owner/repo', JSON.stringify(s));
    const cli = spawnSync(process.execPath, [GATE, 'remote', '--root', dir], { encoding: 'utf8' });
    const cliMissing = spawnSync(process.execPath, [GATE, 'remote', '--root', tree('cli-missing')], { encoding: 'utf8' });
    ok(cli.status === 0 && cli.stdout.trim() === 'https://github.com/Example-Org/virtual-alex' && cliMissing.status === 2 && /REFUSED/.test(cliMissing.stderr),
      'P1b the command line prints the address with exit 0, and refuses a missing file with exit 2',
      `exit ${cli.status} "${cli.stdout.trim()}"; missing: exit ${cliMissing.status}`);
    // L1 NEGATIVE: run through a linked directory (macOS's temp dir is /var -> /private/var; a junction
    // on Windows). Node resolves the main module's real path, and a gate comparing the typed path to it
    // decided it was imported, did nothing and exited 0: a pass for whatever it guards.
    const link = path.join(TMP, 'scripts-link');
    let linked = false;
    try { fs.symlinkSync(path.join(ROOT, 'scripts'), link, 'junction'); linked = true; } catch (e) { ok(false, 'L1 a directory link can be made here', e.message); }
    if (linked) {
      const via = spawnSync(process.execPath, [path.join(link, 'lib', 'template-gate.mjs'), 'remote', '--root', tree('link-missing')], { encoding: 'utf8' });
      ok(via.status === 2 && /REFUSED/.test(via.stderr), 'L1 NEGATIVE run through a linked directory, a missing source still refuses with exit 2',
        `exit ${via.status}, ${(via.stdout + via.stderr).trim().length} byte(s) of output`);
      fs.rmSync(link, { force: true }); // the link itself, never what it points at
    }
    const green = G.ciVerdict({ check_runs: [run(20, { conclusion: 'failure' }), run(21)] }, SHA);
    ok(green.green && /actions\/runs\/21/.test(green.why), 'P2 a green newest run passes and names the run', green.why);
    const viaMain = G.main(['ci', SHA, '--root', dir], { run: () => ({ status: 0, stdout: JSON.stringify({ check_runs: [run(22)] }) }) });
    ok(/CI green/.test(viaMain.out), 'P2b the ci command passes a green head end to end (gh injected)', viaMain.out);
  }
  {
    const ciFile = IS_KIT ? path.join(ROOT, 'variants', 'online', '.github', 'workflows', 'ci.yml') : path.join(ROOT, '.github', 'workflows', 'ci.yml');
    const text = fs.existsSync(ciFile) ? fs.readFileSync(ciFile, 'utf8') : '';
    const named = G && new RegExp(`^  ${G.CI_CHECK}:\\s*$`, 'm').test(text);
    ok(Boolean(named), 'P3 the template CI job is named what the gate reads', `${path.relative(ROOT, ciFile)} job "${G ? G.CI_CHECK : '?'}": ${named ? 'present' : 'ABSENT'}`);
  }
  {
    const settings = [path.join(ROOT, 'variants', 'online', '.claude', 'settings.json'), path.join(ROOT, '.claude', 'settings.json')].find((f) => fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('Edit(/scripts/lib/**)'));
    const under = path.relative(ROOT, GATE).split(path.sep).join('/').startsWith('scripts/lib/');
    ok(under && Boolean(settings), 'P4 the gate sits where a session cannot Edit it and every change to it is a flagged changelog path',
      `${path.relative(ROOT, GATE)}; deny rule in ${settings ? path.relative(ROOT, settings) : 'NO settings file'}`);
  }
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall pass');
process.exit(failures ? 1 : 0);
