#!/usr/bin/env node
// @ts-check
// scripts/tests/test-bootstrap-doctor.mjs - scripts/bootstrap.mjs, the environment doctor every install and update
// runs, held on every section's row, both modes and every exit code.
//
// WHAT. Its readers: the launchers and /setup run `--repair-links` (test-setup-command-contract.mjs runs those
// texts); kit-doctor maps its exit code; test-doctor-honesty.mjs and the Kit's macOS CI step read its row format
// `[STATE] <section padded 14> <name padded 28> <detail>` and its exits 0 / 2 / 1. Deleted, this file would let a
// change reorder or reword a row, link a parked skill or leave an awake one unlinked, stop setting or reading back
// core.hooksPath, lose the node floor, a fallback path, or a secret-file, ssh, Claude-settings or git row, or move an
// exit code, with every other test green. Each section runs against a synthetic schema, so no row depends on what
// this machine has installed: tools (PASS, MISS, OPT, the node floor, fallback paths with %VAR% and ~), secret
// files, the skill store (the plain doctor never touches it; repair links the awake, unlinks the parked, reports
// profile warnings), ssh, Claude settings, git (remote, core.hooksPath, core.longpaths on Windows), the verdict.
//
// HOW. The doctor and the skill resolver are COPIED from this checkout into a fixture repository in the OS temp
// folder, with a home folder, a PATH and a schema of the test's own. No scheduler section is ever declared, so no
// scheduler is asked and nothing is registered. A test named "PINNED DEFECT <id>" asserts behaviour known to be
// wrong; its fix flips exactly that assertion when the defect ledger schedules it.
//
// NEVER. Runs the doctor in this checkout. Fixes a defect it pins: R4-3, a required tool that resolves but whose
// probe fails is PASS; R4-11, a profile that parks a MANDATORY skill is a crash (exit 1), not a finding; R4-6,
// test-doctor-honesty.mjs fails under CLAUDE_CODE_REMOTE=true, the environment the online tree is built for (the
// online schema declares three tools, H2a wants five); R4-L24, even the plain doctor writes
// outputs/logs/bootstrap-check.log into the tree. The Windows-only core.longpaths PASS and the R4-L25 shell-retry
// pin live in the Kit-only sibling test-bootstrap-doctor-kit.mjs: a generated online tree has no Windows host to
// run either on.
//
// Usage: node scripts/tests/test-bootstrap-doctor.mjs
// Exit: 0 every test passed - 1 a test failed

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const NODE_ROW = /^\[PASS\] tool {11}node {25}v\d+\.\d+\.\d+$/;

/**
 * @typedef {object} Doctor a fixture repository holding copies of the doctor and the skill resolver
 * @property {string} T the fixture's temp folder
 * @property {string} repo the repository the doctor runs in
 * @property {string} home the home folder the doctor sees
 * @property {string} bin a folder first on PATH, for fake tools
 * @property {(rel: string, text: string | Buffer) => void} put writes a file into the repository
 * @property {NodeJS.ProcessEnv} env the doctor's environment
 * @property {(...args: string[]) => import('node:child_process').SpawnSyncReturns<string>} g git in the repository
 * @property {(args?: string[], extra?: Record<string, string>) => { status: number | null, stdout: string, stderr: string, lines: string[] }} run
 *   runs the doctor with these arguments and extra environment
 * @property {() => string[] | null} links the .claude/skills entries, sorted, or null when the folder is absent
 */

/**
 * A fresh fixture repository with the doctor's world in it: one required tool (node), a three-skill lock with
 * gamma parked, the hook file and an origin remote, each unless the options say otherwise.
 * @param {import('node:test').TestContext} t
 * @param {{ schema?: object, skills?: Record<string, object>, claude?: string, remote?: boolean, hook?: boolean }} [options]
 * @returns {Doctor}
 */
function doctor(
  t,
  {
    schema = {},
    skills = { alpha: {}, beta: {}, gamma: { parked: true } },
    claude = '# no Skill Bindings table\n',
    remote = true,
    hook = true
  } = {}
) {
  const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c3-boot-')));
  t.after(() => fs.rmSync(T, { recursive: true, force: true }));
  const repo = path.join(T, 'repo');
  const home = path.join(T, 'home');
  const bin = path.join(T, 'bin');
  const put = (/** @type {string} */ rel, /** @type {string | Buffer} */ text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  for (const rel of [
    'scripts/bootstrap.mjs',
    'scripts/lib/skill-state.js',
    'scripts/lib/json-writer.js',
    'scripts/lib/repo-root.js'
  ])
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  const full = {
    tools: [{ id: 'node', version_args: '--version', required: true, restore: 'install node' }],
    git_expectations: { remote: 'origin' },
    junction_rule: { target_dir: '.agents/skills', link_dir: '.claude/skills' },
    ...schema
  };
  put('system/environment-schema.json', JSON.stringify(full));
  put('system/environment-schema.online.json', JSON.stringify(full));
  put('system/manifest.json', JSON.stringify({ projects: [] }));
  put('skills-lock.json', JSON.stringify({ version: 1, skills }));
  for (const s of Object.keys(skills)) put(`.agents/skills/${s}/SKILL.md`, `# ${s}\n`);
  put('CLAUDE.md', claude);
  if (hook) put('scripts/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(T, 'gitconfig'), '[core]\n\tautocrlf = false\n');
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_/.test(k) || k === 'CLAUDE_CODE_REMOTE') delete env[k];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(T, 'gitconfig'),
    HOME: home,
    USERPROFILE: home,
    [pathKey]: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] || ''}`
  });
  const g = (/** @type {string[]} */ ...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
  g('init', '-q');
  if (remote) g('remote', 'add', 'origin', 'https://example.invalid/owner/alex');
  const run = (/** @type {string[]} */ args = [], /** @type {Record<string, string>} */ extra = {}) => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'bootstrap.mjs'), ...args], {
      cwd: T,
      encoding: 'utf8',
      env: { ...env, ...extra }
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines: r.stdout.split('\n') };
  };
  const links = () =>
    fs.existsSync(path.join(repo, '.claude', 'skills'))
      ? fs.readdirSync(path.join(repo, '.claude', 'skills')).sort()
      : null;
  return { T, repo, home, bin, put, env, g, run, links };
}
/**
 * A tool that resolves on PATH and answers with `text`, exiting `code`: node itself under another name.
 * @param {Doctor} d
 * @param {string} id
 * @param {string} text
 * @param {number} code
 */
function fakeTool(d, id, text, code) {
  d.put(`c3-${id}.cjs`, `process.stdout.write(${JSON.stringify(`${text}\n`)}); process.exit(${code});\n`);
  if (WIN) {
    try {
      fs.linkSync(process.execPath, path.join(d.bin, `${id}.exe`));
    } catch {
      fs.copyFileSync(process.execPath, path.join(d.bin, `${id}.exe`));
    }
  } else {
    fs.writeFileSync(path.join(d.bin, id), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
    fs.chmodSync(path.join(d.bin, id), 0o755);
  }
  return { id, version_args: `c3-${id}.cjs`, required: true, restore: `install ${id}` };
}

test('plain doctor on a fresh clone: the rows in order, links and hook path MISS, exit 2; nothing linked, nothing set', (t) => {
  const d = doctor(t);
  const r = d.run();
  assert.equal(r.status, 2);
  assert.equal(r.stderr, '');
  assert.match(r.lines[1], NODE_ROW);
  assert.deepEqual(
    [r.lines[0], ...r.lines.slice(2)],
    [
      '[INFO] schema         environment-schema.json      the laptop schema',
      '[MISS] links          skill store                  2 missing, 0 parked-but-linked - run: node scripts/bootstrap.mjs --repair-links',
      "[PASS] git            remote 'origin'              configured",
      '[MISS] git            core.hooksPath               unset - the pre-commit gate is not running; fix: node scripts/bootstrap.mjs --repair-links',
      '',
      'bootstrap: 2 required item(s) MISSING - see MISS lines above',
      ''
    ]
  );
  assert.equal(d.links(), null, 'the doctor made no link');
  assert.equal(d.g('config', '--get', 'core.hooksPath').status, 1, 'and set no hook path');
});

test('--repair-links links exactly the awake skills, sets the hook path and reads it back, exit 0; a second run says links match', (t) => {
  const d = doctor(t);
  const r = d.run(['--repair-links']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(
    r.stdout.includes(
      '[PASS] links          skill store                  repaired 2 missing + removed 0 parked link(s); 2 awake, 1 parked\n'
    )
  );
  assert.ok(
    r.stdout.includes('[PASS] git            core.hooksPath               scripts/hooks (set and read back)\n')
  );
  assert.ok(r.stdout.endsWith('\nbootstrap: environment COMPLETE (0 required items missing)\n'));
  assert.deepEqual(d.links(), ['alpha', 'beta']);
  const again = d.run();
  assert.ok(
    again.stdout.includes('[PASS] links          skill store                  2 awake + 1 parked, links match\n')
  );
  assert.ok(again.stdout.includes('[PASS] git            core.hooksPath               scripts/hooks\n'));
});

test('--repair-links removes a link the profile now parks, and reports a profile naming an unknown skill as INFO', (t) => {
  const d = doctor(t);
  d.put('system/install-profile.json', JSON.stringify({ wake: ['gamma'] }));
  d.run(['--repair-links']);
  assert.deepEqual(d.links(), ['alpha', 'beta', 'gamma']);
  d.put('system/install-profile.json', JSON.stringify({ park: ['beta'], wake: ['zeta'] }));
  const r = d.run(['--repair-links']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(
    r.stdout.includes(
      "[INFO] links          profile                      profile wakes unknown skill 'zeta' (not in skills-lock.json) - ignored\n"
    )
  );
  assert.ok(
    r.stdout.includes(
      '[PASS] links          skill store                  repaired 0 missing + removed 2 parked link(s); 1 awake, 2 parked\n'
    ),
    r.stdout
  );
  assert.deepEqual(d.links(), ['alpha']);
});

test('no hook file: no core.hooksPath row at all; no origin: the remote row MISSes', (t) => {
  const d = doctor(t, { hook: false, remote: false });
  const r = d.run(['--repair-links']);
  assert.ok(!r.stdout.includes('core.hooksPath'));
  assert.ok(
    r.stdout.includes("[MISS] git            remote 'origin'              absent (clone from GitHub or re-add)\n")
  );
  assert.equal(r.status, 2);
});

test('tools: an absent required tool MISSes and an absent optional one is OPT, each with its restore text; the node floor MISSes below it', (t) => {
  const d = doctor(t, {
    schema: {
      tools: [
        { id: 'node', version_args: '--version', required: true, min_major: 999, restore: 'x' },
        { id: 'c3-absent-required-tool', version_args: '--version', required: true, restore: 'get it from the shop' },
        { id: 'c3-absent-optional-tool', required: false, restore: 'optional, really' }
      ]
    }
  });
  const r = d.run();
  assert.match(r.lines[1], /^\[MISS\] tool {11}node {25}v\d+\.\d+\.\d+ but need >= v999 \(node:sqlite\)$/);
  assert.equal(r.lines[2], '[MISS] tool           c3-absent-required-tool      absent - restore: get it from the shop');
  assert.equal(r.lines[3], '[OPT ] tool           c3-absent-optional-tool      absent - restore: optional, really');
  assert.match(
    r.stdout,
    /\nbootstrap: 4 required item\(s\) MISSING - see MISS lines above\n$/,
    'node floor, the absent tool, links, hook path; OPT is not counted'
  );
});

test('tools: an off-PATH tool is found by a fallback path, %VAR% and ~ expanded, and its path is the evidence', (t) => {
  const d = doctor(t);
  fs.mkdirSync(path.join(d.home, 'tools'));
  fs.writeFileSync(path.join(d.home, 'tools', 'gpg.bin'), '');
  fs.writeFileSync(path.join(d.T, 'rclone.bin'), '');
  d.put(
    'system/environment-schema.json',
    JSON.stringify({
      tools: [
        {
          id: 'c3-offpath-a',
          version_args: '--version',
          required: true,
          restore: 'x',
          fallback_paths: ['/no/such/path', '~/tools/gpg.bin']
        },
        { id: 'c3-offpath-b', required: true, restore: 'x', fallback_paths: ['%C3_TOOLS%/rclone.bin'] }
      ]
    })
  );
  const r = d.run([], { C3_TOOLS: d.T });
  assert.equal(
    r.lines[1],
    '[PASS] tool           c3-offpath-a                 ~/tools/gpg.bin',
    'the evidence is the schema entry as written, not its expansion'
  );
  assert.equal(r.lines[2], '[PASS] tool           c3-offpath-b                 %C3_TOOLS%/rclone.bin');
  assert.equal(
    d.run([], { C3_TOOLS: path.join(d.T, 'elsewhere') }).lines[2],
    '[MISS] tool           c3-offpath-b                 absent - restore: x'
  );
});

test('secret files: from the ledger, existence only; a missing ledger, a missing file, a password-manager entry', (t) => {
  const d = doctor(t, { schema: { secret_files_rule: 'check' } });
  const none = d.run();
  assert.ok(
    none.stdout.includes(
      '[MISS] secrets        credentials-ledger           system/credentials-ledger.json ABSENT - restore the encrypted vault backup FIRST (see docs/GETTING-STARTED)\n'
    )
  );
  d.put('secret.txt', 'the value is never read');
  d.put(
    'system/credentials-ledger.json',
    JSON.stringify({
      credentials: [
        { id: 'present', local_path: 'secret.txt' },
        { id: 'gone', where: 'config/nope.json in the repo' },
        { id: 'keyring', where: 'the password manager' }
      ]
    })
  );
  const r = d.run();
  assert.ok(r.stdout.includes('[PASS] secrets        present                      file present (value not read)\n'));
  assert.ok(
    r.stdout.includes('[MISS] secrets        gone                         expected file absent: config/nope.json\n')
  );
  assert.ok(
    r.stdout.includes(
      '[INFO] secrets        keyring                      not file-backed (password manager / OS keyring) - nothing to check here\n'
    )
  );
});

test('ssh aliases and claude settings are read from the home folder only when the schema declares them', (t) => {
  const d = doctor(t, {
    schema: {
      ssh: [{ alias: 'box.one', note: 'add it' }],
      claude_settings: { expect_keys: ['env'], expect_env: { X_ON: '1' } }
    }
  });
  const r1 = d.run();
  assert.ok(
    r1.stdout.includes("[MISS] ssh            alias 'box.one'              absent from ~/.ssh/config - add it\n")
  );
  assert.ok(r1.stdout.includes('[MISS] claude-cfg     settings.json                ~/.claude/settings.json absent\n'));
  fs.mkdirSync(path.join(d.home, '.ssh'));
  fs.writeFileSync(path.join(d.home, '.ssh', 'config'), 'Host box.one\n  HostName example.invalid\n');
  fs.mkdirSync(path.join(d.home, '.claude'));
  fs.writeFileSync(path.join(d.home, '.claude', 'settings.json'), JSON.stringify({ env: { X_ON: '0' } }));
  const r2 = d.run();
  assert.ok(r2.stdout.includes("[PASS] ssh            alias 'box.one'              in ~/.ssh/config\n"));
  assert.ok(r2.stdout.includes('[PASS] claude-cfg     env                          set\n'));
  assert.ok(r2.stdout.includes('[MISS] claude-cfg     X_ON                         expected 1\n'));
  const online = d.run([], { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(
    online.lines[0],
    '[INFO] schema         environment-schema.online.json CLAUDE_CODE_REMOTE=true, the cloud schema'
  );
});

test('off Windows, no core.longpaths row appears, even when the schema asks for one', {
  skip: WIN && 'the Windows-only half of this check is the Kit-only sibling'
}, (t) => {
  const d = doctor(t, { schema: { git_expectations: { remote: 'origin', core_longpaths: true } } });
  assert.ok(!d.run().stdout.includes('core.longpaths'));
});

test('an unknown argument is ignored: it is the plain doctor', (t) => {
  const d = doctor(t);
  const r = d.run(['--repair']);
  assert.equal(r.status, 2);
  assert.equal(d.links(), null);
});

test('PINNED DEFECT R4-L24: even the plain doctor writes its log into the tree', (t) => {
  const d = doctor(t);
  d.run();
  const log = fs.readFileSync(path.join(d.repo, 'outputs', 'logs', 'bootstrap-check.log'), 'utf8');
  assert.match(log, /^=== bootstrap check \d{4}-\d{2}-\d{2}T[\d:.]+Z ===\n\[INFO\] schema /);
  assert.match(log, /\nbootstrap: 2 required item\(s\) MISSING - see MISS lines above\n$/);
});

test("PINNED DEFECT R4-3: a required tool that resolves but whose probe FAILS (the Windows Store python stub's shape) is PASS", (t) => {
  const d = doctor(t);
  const stub = fakeTool(
    d,
    'fakepy',
    'Python was not found; run without arguments to install from the Microsoft Store',
    9
  );
  d.put('system/environment-schema.json', JSON.stringify({ tools: [stub] }));
  const r = d.run();
  assert.equal(
    r.lines[1],
    '[PASS] tool           fakepy                       Python was not found; run without arguments to install from the Microsoft Store'
  );
});

test('PINNED DEFECT R4-11: a profile that parks a MANDATORY skill is a crash: BOOTSTRAP SCRIPT ERROR and exit 1', (t) => {
  const d = doctor(t, { claude: '| Task | Skill(s) | Strength |\n|---|---|---|\n| anything | alpha | MANDATORY |\n' });
  d.put('system/install-profile.json', JSON.stringify({ park: ['alpha'] }));
  const r = d.run(['--repair-links']);
  assert.equal(r.status, 1);
  assert.match(
    r.stdout,
    /\nBOOTSTRAP SCRIPT ERROR: Error: install-profile\.json tries to park MANDATORY skill 'alpha'\. /
  );
});

test("PINNED DEFECT R4-6: test-doctor-honesty.mjs fails H2a under CLAUDE_CODE_REMOTE=true with the online schema's three tools", {
  skip:
    !fs.existsSync(path.join(ROOT, 'scripts', 'tests', 'test-doctor-honesty.mjs')) &&
    'no test-doctor-honesty.mjs in this tree'
}, (t) => {
  const d = doctor(t);
  d.put(
    'system/environment-schema.online.json',
    fs.readFileSync(path.join(ROOT, 'system', 'environment-schema.online.json'))
  );
  d.put(
    'scripts/tests/test-doctor-honesty.mjs',
    fs.readFileSync(path.join(ROOT, 'scripts', 'tests', 'test-doctor-honesty.mjs'))
  );
  const r = spawnSync(process.execPath, [path.join(d.repo, 'scripts', 'tests', 'test-doctor-honesty.mjs')], {
    encoding: 'utf8',
    env: { ...d.env, CLAUDE_CODE_REMOTE: 'true' }
  });
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('FAIL  H2a doctor probed a real tool set - 3 rows\n'), r.stdout);
});

test('off Windows, a tool id is never retried through a shell, so shell metacharacters in it change nothing', {
  skip: WIN && 'the shell retry, and its pinned defect, are the Kit-only sibling'
}, (t) => {
  const d = doctor(t);
  d.put(
    'system/environment-schema.json',
    JSON.stringify({ tools: [{ id: 'c3-no-such-tool&echo', version_args: 'injected', required: true, restore: 'x' }] })
  );
  const r = d.run();
  assert.equal(r.lines[1], '[MISS] tool           c3-no-such-tool&echo         absent - restore: x');
});
