#!/usr/bin/env node
// scripts/tests/test-autosave-paths.mjs - characterization of scripts/autosave.sh beyond
// test-autosave.mjs: every result line no case there reaches (not a repository, a detached HEAD, an
// unreadable identity list, a failed `git add`, a leg that errors, a --stop on a branch GitHub does
// not have yet, a read-back that differs, OFF-MAIN on a clean --json save, the silent skip), the log
// format, and the size-guard twin.
//
// WHAT. Pins every defect still open after the hotfixes, as it behaves today. A test named "PINNED
// DEFECT <id>" asserts current behaviour known to be wrong; the fix flips exactly that assertion. The
// hotfixes' own regression cases (AS-D1 T2b, AS-D2 T6b) stay in test-autosave.mjs and are not repeated
// here.
//
// HOW. Every repository and its bare origin sit in a temp folder this file deletes; content legs are
// stubs written into the fixture (the contract: --file <path>, exit 0 clean, 2 hit, else an error).
// Git runs with no system or global config.
//
// NEVER. Reaches a network. Flips a PINNED DEFECT assertion on its own: each pins today's behaviour,
// and only a FIX row in the ratchet flips one. AS-D4: a refused name with glob characters silently
// holds back a clean file it matches. AS-D5: the rescue name carries only the second, and the reason
// quoted is git's trailing hint. AS-D6: in --stop mode a refused push says "the Stop hook rebases and
// retries". AS-D7: per-file refusals are logged in lowercase, so /alex-status's search for REFUSED
// misses them. AS-D9: a missing content leg is skipped (fail-open per file). AS-D12: the routine
// reset's reverted list ends in a trailing space.
//
// Usage: node scripts/tests/test-autosave-paths.mjs
// Exit: 0 all pass - 1 a failure

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBash } from './fixtures/find-bash.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-autosave-paths-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }));

const BASH = findBash();
const GITCONFIG = path.join(TMP, 'empty-gitconfig');
fs.writeFileSync(GITCONFIG, '');
const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Owner',
  GIT_AUTHOR_EMAIL: 'owner@example.invalid',
  GIT_COMMITTER_NAME: 'Owner',
  GIT_COMMITTER_EMAIL: 'owner@example.invalid',
  CLAUDE_CODE_REMOTE: 'true',
  ALEX_ROUTINE: undefined,
  ALEX_UNTRUSTED_LANE: undefined
}; // unset (Node drops an undefined env entry), not '': the shape set -u depends on for ALEX_ROUTINE, the shape test-autosave.mjs's own tests pin too
function git(cwd, args, allowFail = false) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return allowFail ? r : (r.stdout || '').trim();
}
const W = (dir, rel, text) => {
  const p = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const ONLINE_GITIGNORE = [path.join(KIT, 'variants', 'online', '.gitignore'), path.join(KIT, '.gitignore')].find((p) =>
  fs.existsSync(p)
);
const ONLINE_PRECOMMIT = [
  path.join(KIT, 'variants', 'online', 'scripts', 'hooks', 'pre-commit'),
  path.join(KIT, 'scripts', 'hooks', 'pre-commit')
].find((p) => fs.existsSync(p));

// A stub content leg: a file whose text holds SECRET-MARK is a hit (exit 2), ERROR-MARK an error
// (exit 3); every call is recorded, so a test can see which files a leg was asked about.
const stubLeg = (name) =>
  `import fs from 'node:fs';\nconst f = process.argv[process.argv.indexOf('--file') + 1];\n` +
  `fs.appendFileSync(${JSON.stringify(`.calls-${name}`)}, f + '\\n');\nconst t = fs.readFileSync(f, 'utf8');\n` +
  `if (t.includes('SECRET-MARK')) { console.log('${name}: ' + f + ':1 fake-hit'); process.exit(2); }\n` +
  `if (t.includes('ERROR-MARK')) { console.log('${name}: something broke'); console.log(''); process.exit(3); }\n`;

let n = 0;
function repo({ legs = true, guard = true } = {}) {
  const base = path.join(TMP, `r${++n}`);
  const bare = path.join(base, 'origin.git');
  const dir = path.join(base, 'work');
  fs.mkdirSync(base);
  git(base, ['init', '-q', '--bare', '-b', 'main', bare]);
  git(base, ['init', '-q', '-b', 'main', dir]);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(KIT, 'scripts', 'autosave.sh'), path.join(dir, 'scripts', 'autosave.sh'));
  if (guard)
    fs.copyFileSync(
      path.join(KIT, 'scripts', 'untrusted-lane-guard.js'),
      path.join(dir, 'scripts', 'untrusted-lane-guard.js')
    );
  if (legs) {
    W(dir, 'scripts/secret-scan.mjs', stubLeg('secret-scan'));
    W(dir, 'scripts/employer-data-guard.mjs', stubLeg('employer-data-guard'));
  }
  fs.copyFileSync(ONLINE_GITIGNORE, path.join(dir, '.gitignore'));
  fs.appendFileSync(path.join(dir, '.gitignore'), '\n.calls-*\n');
  fs.copyFileSync(path.join(KIT, '.gitattributes'), path.join(dir, '.gitattributes'));
  W(dir, 'CLAUDE.md', '# rules\n');
  W(dir, 'vault/index.md', 'line one\nline two\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'seed']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', 'origin', 'main']);
  const clone = () => {
    const d = path.join(base, `c${Math.random().toString(36).slice(2, 8)}`);
    git(base, ['clone', '-q', bare, d]);
    return d;
  };
  return {
    base,
    bare,
    dir,
    clone,
    remote: (ref = 'refs/heads/main') => git(base, ['ls-remote', bare, ref]).split(/\s+/)[0] || ''
  };
}
function autosave(cwd, args = [], env = {}, input = undefined, script = path.join(cwd, 'scripts', 'autosave.sh')) {
  const r = spawnSync(BASH, [script, ...args], { cwd, input, encoding: 'utf8', env: { ...ENV, ...env } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const SHA = /\b[0-9a-f]{7,40}\b/g;
const mask = (s) => s.replace(SHA, '<sha>');
const log = (dir) => fs.readFileSync(path.join(dir, 'outputs', 'logs', 'autosave.log'), 'utf8');

test('the gate: without CLAUDE_CODE_REMOTE exactly "true" (TRUE included, or truly unset, a laptop) the save skips; with --json it says nothing', () => {
  const r = repo();
  W(r.dir, 'vault/a.md', 'x\n');
  for (const value of [undefined, '', 'TRUE', '1']) {
    assert.deepEqual(
      autosave(r.dir, [], { CLAUDE_CODE_REMOTE: value }),
      {
        code: 0,
        stderr: '',
        stdout: 'autosave: skipped (CLAUDE_CODE_REMOTE is not true; this save runs only in a cloud session)\n'
      },
      String(value)
    );
    assert.deepEqual(
      autosave(r.dir, ['--json'], { CLAUDE_CODE_REMOTE: value }),
      { code: 0, stdout: '', stderr: '' },
      String(value)
    );
  }
  assert.equal(fs.existsSync(path.join(r.dir, 'outputs')), false, 'a skip writes no log');
});

test('not inside a repository: a REFUSED line reaches both the owner and the model with --json, exit 0, no log', () => {
  const r = repo();
  const plain = fs.mkdtempSync(path.join(TMP, 'plain-'));
  const line = 'autosave: REFUSED - not inside a git repository, nothing saved';
  assert.deepEqual(autosave(plain, [], {}, undefined, path.join(r.dir, 'scripts', 'autosave.sh')), {
    code: 0,
    stdout: `${line}\n`,
    stderr: ''
  });
  assert.deepEqual(autosave(plain, ['--json'], {}, undefined, path.join(r.dir, 'scripts', 'autosave.sh')), {
    code: 0,
    stdout: JSON.stringify({
      systemMessage: line,
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line }
    }),
    stderr: ''
  });
  assert.equal(fs.existsSync(path.join(plain, 'outputs')), false);
});

test('a toplevel git names but the shell cannot enter: REFUSED "cannot enter", exit 0 (a git shim injects the fault)', () => {
  // Git's bin/bash.exe puts its own /usr/bin and /mingw64/bin ahead of the inherited PATH, so a shim
  // there never wins; the POSIX shell underneath it is run directly, with only the shim on the PATH.
  // Nothing before the refusal needs any other tool: it uses builtins only.
  const r = repo();
  const shim = fs.mkdtempSync(path.join(TMP, 'shim-'));
  fs.writeFileSync(path.join(shim, 'git'), '#!/bin/sh\necho /nonexistent/alex-toplevel\n');
  fs.chmodSync(path.join(shim, 'git'), 0o755);
  let sh = '/bin/bash';
  if (process.platform === 'win32') {
    const where = spawnSync('where.exe', ['git'], { encoding: 'utf8' })
      .stdout.split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    sh = where
      .map((g) => path.join(path.dirname(path.dirname(g)), 'usr', 'bin', 'bash.exe'))
      .find((p) => fs.existsSync(p));
  }
  const env = { ...ENV };
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = shim;
  const res = spawnSync(sh, [path.join(r.dir, 'scripts', 'autosave.sh')], { cwd: r.dir, encoding: 'utf8', env });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, 'autosave: REFUSED - cannot enter /nonexistent/alex-toplevel, nothing saved\n');
  assert.match(res.stderr, /\/nonexistent\/alex-toplevel: No such file or directory/);
});

test('a detached HEAD: REFUSED, nothing committed or pushed, the line appended to the log with a UTC stamp', () => {
  const r = repo();
  git(r.dir, ['checkout', '-q', '--detach']);
  W(r.dir, 'vault/a.md', 'x\n');
  const head = git(r.dir, ['rev-parse', 'HEAD']);
  const line = 'autosave: REFUSED - detached HEAD, nothing committed or pushed (check out a branch first)';
  assert.deepEqual(autosave(r.dir), { code: 0, stdout: `${line}\n`, stderr: '' });
  assert.equal(git(r.dir, ['rev-parse', 'HEAD']), head);
  assert.match(
    log(r.dir),
    new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z ${line.replace(/[()]/g, '\\$&')}\\n$`)
  );
  assert.deepEqual(autosave(r.dir, ['--stop', '--json'], {}, '{"stop_hook_active":false}'), {
    code: 0,
    stdout: JSON.stringify({ decision: 'block', reason: line }),
    stderr: ''
  });
});

test('a Routine whose identity list cannot be read refuses the whole save', () => {
  const r = repo({ guard: false });
  W(r.dir, 'vault/a.md', 'x\n');
  const r1 = autosave(r.dir, [], { ALEX_ROUTINE: '1' });
  assert.equal(
    r1.stdout,
    'autosave: REFUSED - could not read the identity list (node scripts/untrusted-lane-guard.js --identity-paths printed nothing); a routine session does not save without it\n'
  );
  assert.equal(git(r.dir, ['status', '--porcelain', '--', 'vault/a.md']), '?? vault/a.md');
});

test("a failed git add: REFUSED with git's last line, nothing committed", () => {
  const r = repo();
  W(r.dir, 'vault/a.md', 'x\n');
  fs.writeFileSync(path.join(r.dir, '.git', 'index.lock'), '');
  const head = git(r.dir, ['rev-parse', 'HEAD']);
  const res = autosave(r.dir);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /^autosave: REFUSED - git add failed: \S.*\n$/);
  assert.equal(git(r.dir, ['rev-parse', 'HEAD']), head);
});

test("a content leg that errors refuses that file with the leg's exit code and last line; the next leg is not asked; clean files save", () => {
  const r = repo();
  W(r.dir, 'vault/broken.md', 'ERROR-MARK\n');
  W(r.dir, 'vault/clean.md', 'fine\n');
  const res = autosave(r.dir);
  assert.equal(
    res.stderr,
    'autosave: refused vault/broken.md: scripts/secret-scan.mjs exit 3: secret-scan: something broke (left unstaged)\n'
  );
  assert.equal(
    mask(res.stdout),
    'autosave: committed <sha>; main at <sha> pushed to origin/main; refused 1: vault/broken.md\n'
  );
  const asked = fs.readFileSync(path.join(r.dir, '.calls-employer-data-guard'), 'utf8').split('\n').filter(Boolean);
  assert.ok(asked.includes('vault/clean.md') && !asked.includes('vault/broken.md'), asked.join(','));
  assert.equal(git(r.dir, ['status', '--porcelain', '--', 'vault/broken.md']), '?? vault/broken.md');
});

test('the log: every result line with a UTC stamp, and each per-file refusal on a line of its own', () => {
  const r = repo();
  W(r.dir, 'vault/leak.md', 'SECRET-MARK\n');
  autosave(r.dir);
  const lines = log(r.dir).split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z refused vault\/leak\.md: scripts\/secret-scan\.mjs exit 2: secret-scan: vault\/leak\.md:1 fake-hit$/
  );
  assert.match(
    mask(lines[1]),
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z autosave: no new commit; main at <sha> pushed to origin\/main; refused 1: vault\/leak\.md$/
  );
});

test('PINNED DEFECT AS-D7: a per-file refusal is logged in lowercase, so the /alex-status search for REFUSED finds nothing', () => {
  const r = repo();
  W(r.dir, 'vault/leak.md', 'SECRET-MARK\n');
  autosave(r.dir);
  const text = log(r.dir);
  assert.equal((text.match(/REFUSED/g) || []).length, 0);
  assert.equal((text.match(/refused/g) || []).length, 2);
  const status = [
    path.join(KIT, 'variants', 'online', '.claude', 'commands', 'alex-status.md'),
    path.join(KIT, '.claude', 'commands', 'alex-status.md')
  ].find((p) => fs.existsSync(p));
  assert.ok(status, 'alex-status.md is in this tree');
  assert.match(fs.readFileSync(status, 'utf8'), /`outputs\/logs\/autosave\.log` that contains `REFUSED`/);
});

test('PINNED DEFECT AS-D9: with no content leg present the file is not scanned at all and is committed', () => {
  const r = repo({ legs: false });
  W(r.dir, 'vault/leak.md', 'SECRET-MARK\n');
  const res = autosave(r.dir);
  assert.equal(res.stderr, '');
  assert.equal(mask(res.stdout), 'autosave: committed <sha>; main at <sha> pushed to origin/main\n');
  assert.equal(git(r.dir, ['cat-file', '-e', 'origin/main:vault/leak.md'], true).status, 0);
});

test('PINNED DEFECT AS-D4: a refused name with glob characters holds back a clean file it matches, which is named nowhere', () => {
  const r = repo();
  W(r.dir, 'vault/a[1].md', 'SECRET-MARK\n');
  W(r.dir, 'vault/a1.md', 'clean, but a[1] matches this name as a glob\n');
  W(r.dir, 'vault/b.md', 'clean\n');
  const res = autosave(r.dir);
  assert.equal(
    mask(res.stdout),
    'autosave: committed <sha>; main at <sha> pushed to origin/main; refused 1: vault/a[1].md\n'
  );
  assert.doesNotMatch(res.stdout + res.stderr, /a1\.md/);
  const committed = git(r.dir, ['show', '--name-only', '--format=', 'HEAD']).split('\n');
  assert.deepEqual(committed, ['vault/b.md']);
  assert.equal(git(r.dir, ['status', '--porcelain', '--', 'vault/a1.md']), '?? vault/a1.md');
});

test('no change: "no new commit", still pushed; unknown arguments are ignored; a clean --json save prints nothing', () => {
  const r = repo();
  assert.equal(
    mask(autosave(r.dir, ['--verbose', 'x']).stdout),
    'autosave: no new commit; main at <sha> pushed to origin/main\n'
  );
  assert.deepEqual(autosave(r.dir, ['--json']), { code: 0, stdout: '', stderr: '' });
});

test('OFF-MAIN: a clean --json save on another branch still speaks (owner AND, pinned, model), and --stop on a branch GitHub lacks notes the skipped pull', () => {
  const r = repo();
  git(r.dir, ['checkout', '-q', '-b', 'claude/new-1']);
  W(r.dir, 'vault/a.md', 'x\n');
  const o = JSON.parse(autosave(r.dir, ['--json']).stdout);
  assert.equal(
    mask(o.systemMessage),
    'autosave: OFF-MAIN on claude/new-1, not main (the next session starts from main and will not see this save until claude/new-1 is merged); committed <sha>; claude/new-1 at <sha> pushed to origin/claude/new-1'
  );
  assert.equal(o.hookSpecificOutput.additionalContext, o.systemMessage);
  git(r.dir, ['checkout', '-q', '-b', 'claude/new-2']);
  W(r.dir, 'vault/b.md', 'y\n');
  assert.equal(
    mask(autosave(r.dir, ['--stop']).stdout),
    "autosave: OFF-MAIN on claude/new-2, not main (the next session starts from main and will not see this save until claude/new-2 is merged); committed <sha>; claude/new-2 at <sha> pushed to origin/claude/new-2 and read back (pull --rebase did not run: fatal: couldn't find remote ref claude/new-2)\n"
  );
});

test('PINNED DEFECT AS-D6: in --stop mode a refused push still says "the Stop hook rebases and retries"', () => {
  const r = repo();
  W(r.bare, 'hooks/pre-receive', '#!/bin/sh\necho "the fixture refuses every push" >&2\nexit 1\n');
  fs.chmodSync(path.join(r.bare, 'hooks', 'pre-receive'), 0o755);
  W(r.dir, 'vault/a.md', 'x\n');
  const plain = autosave(r.dir, ['--stop']);
  assert.match(
    mask(plain.stdout),
    /^autosave: committed <sha>; push of main FAILED \(exit 1: .*\); the Stop hook rebases and retries\n$/
  );
  const json = autosave(r.dir, ['--stop', '--json'], {}, '{"stop_hook_active":false}');
  const o = JSON.parse(json.stdout);
  assert.equal(o.decision, 'block');
  assert.match(o.reason, /push of main FAILED .*; the Stop hook rebases and retries$/);
});

test('a read-back that differs is an alert naming both shas', () => {
  const r = repo();
  const other = r.remote();
  // after every push the origin moves main back: the push succeeds and the read-back sees another commit
  W(r.bare, 'hooks/post-receive', `#!/bin/sh\ngit update-ref refs/heads/main ${other}\n`);
  fs.chmodSync(path.join(r.bare, 'hooks', 'post-receive'), 0o755);
  W(r.dir, 'vault/a.md', 'x\n');
  const res = autosave(r.dir, ['--stop']);
  const head = git(r.dir, ['rev-parse', 'HEAD']);
  assert.equal(
    res.stdout.replace(/committed [0-9a-f]+/, 'committed <sha>'),
    `autosave: committed <sha>; main pushed but the read-back DIFFERS (origin/main is ${other}, HEAD is ${head})\n`
  );
});

test('PINNED DEFECT AS-D5: a rescue whose second-resolution name is taken fails, the work "exists only in this VM", and git\'s hint is the quoted reason', () => {
  const r = repo();
  const a = r.clone();
  const b = r.clone();
  W(a, 'vault/index.md', 'line one changed by A\nline two\n');
  autosave(a);
  // every name the rescue can take in the next 30 seconds is already a divergent branch on origin
  const blocker = r.clone();
  W(blocker, 'vault/blocker.md', 'x\n');
  git(blocker, ['add', '-A']);
  git(blocker, ['commit', '-qm', 'blocker']);
  const blockSha = git(blocker, ['rev-parse', 'HEAD']);
  git(blocker, ['push', '-q', 'origin', `${blockSha}:refs/heads/claude/blocker`]);
  const t0 = Date.now();
  for (let i = 0; i < 30; i++)
    git(r.bare, [
      'update-ref',
      `refs/heads/claude/rescue-${new Date(t0 + i * 1000)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z')}`,
      blockSha
    ]);
  W(b, 'vault/index.md', 'line one changed by B\nline two\n');
  const res = autosave(b, ['--stop']);
  assert.match(
    res.stdout,
    /^autosave: CONFLICT on main, rebase aborted, AND the rescue push to claude\/rescue-\d{8}T\d{6}Z FAILED \(exit 1: hint: [^\n]*\); committed [0-9a-f]+, and it exists only in this VM\n$/
  );
});

test('PINNED DEFECT AS-D12: the routine reset line ends in a trailing space after the last reverted path', () => {
  const r = repo();
  W(r.dir, 'CLAUDE.md', '# rules, rewritten by a routine\n');
  const res = autosave(r.dir, [], { ALEX_ROUTINE: '1' });
  assert.equal(res.stdout.split('\n')[0], 'autosave: routine identity reset reverted: CLAUDE.md ');
});

test("dup-max-blob-bytes: the size guard is the same number in autosave.sh, both commit hooks and import-memory.mjs's LIMITS.file", async () => {
  // Standard 3.4: "a value duplicated across two languages or two shells is a documented contract, not a
  // shared constant... a test that compares the three." Widened to four: import-memory.mjs's LIMITS.file
  // is the commit gate's own guard and a copy the detector's pattern cannot see (an object property, not a
  // shell assignment), read here through its export, never as text.
  const autosave = /^MAX_BLOB_BYTES=(\d+)/m.exec(fs.readFileSync(path.join(KIT, 'scripts', 'autosave.sh'), 'utf8'));
  const onlineGate = /MAX_BLOB_BYTES=(\d+)/.exec(fs.readFileSync(ONLINE_PRECOMMIT, 'utf8'));
  const kitGate = /^MAX_BLOB_BYTES=(\d+)/m.exec(
    fs.readFileSync(path.join(KIT, 'scripts', 'hooks', 'pre-commit'), 'utf8')
  );
  assert.ok(autosave && onlineGate && kitGate, 'fixture: all three shell copies parse');
  const { LIMITS } = await import(new URL('../import-memory.mjs', import.meta.url));
  assert.equal(autosave[1], '10485760');
  assert.equal(onlineGate[1], autosave[1]);
  assert.equal(kitGate[1], autosave[1]);
  assert.equal(String(LIMITS.file), autosave[1]);
});

/**
 * The verbatim source of a one-line or multi-line shell function named `name` in `file`: from the line
 * starting `name() {` (or `name()  {`, any run of spaces) through its matching closing brace, walked by
 * counting braces (not sed) so a one-line body and a multi-line body both lift whole. The two call sites
 * below are the contract: autosave.sh and close-out-online.sh each carry the tag naming this read.
 */
function liftShellFunction(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  const start = text.search(new RegExp(`^${name}\\s*\\(\\)\\s*\\{`, 'm'));
  assert.ok(start >= 0, `${name}() not found in ${file}`);
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return text.slice(start, i);
}

test("PARITY dup-lastline: autosave.sh and close-out-online.sh's lastline() give the same answer over a single line, trailing blank lines, whitespace-only lines and empty input", () => {
  // dup-lastline is SANCTIONED for both, with no home: they are a hook and a Routine close-out in shell
  // that source nothing (standard 3.6), so neither may share a JavaScript home; this holds their bodies to
  // one answer instead, so a divergence is caught even though the concern has none.
  const autosaveBody = liftShellFunction(path.join(KIT, 'scripts', 'autosave.sh'), 'lastline');
  const closeOutBody = liftShellFunction(path.join(KIT, 'scripts', 'close-out-online.sh'), 'lastline');
  const CASES = ['line one', 'line one\n\n\n', '   \n\t \n', '', 'a\nb\n   \nc\n', '\n\n\n'];
  for (const input of CASES) {
    const out = [autosaveBody, closeOutBody].map((body) => {
      const r = spawnSync(BASH, ['-c', `${body}\nlastline "$1"`, '_', input], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    });
    assert.equal(out[0], out[1], `input ${JSON.stringify(input)}`);
  }
});

test("ALEX_ROUTINE='' behaves exactly like unset: no identity reset, an identity edit commits like any other file", () => {
  const r = repo();
  W(r.dir, 'CLAUDE.md', '# rules, edited\n');
  const res = autosave(r.dir, [], { ALEX_ROUTINE: '' });
  assert.doesNotMatch(res.stdout, /identity reset/);
  assert.equal(git(r.dir, ['diff', '--name-only', 'HEAD~1', 'HEAD']), 'CLAUDE.md');
});
