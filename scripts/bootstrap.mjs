#!/usr/bin/env node
// @ts-check
// scripts/bootstrap.mjs - the environment doctor every install, update and /setup runs.
//
// WHAT. Proves that everything this Alex needs from outside its repository is here, on Windows, macOS
// and Linux alike, and repairs the two things it safely can. system/environment-schema.json declares
// those needs (tracked, with no secret path in it); a Claude Code cloud session, which exports
// CLAUDE_CODE_REMOTE=true, loads environment-schema.online.json instead. Sections: tools, npm globals
// and Python packages, secret files, scheduler jobs, skill links, ssh aliases, Claude Code's user
// settings, git.
//
// HOW. It changes into the repository first, so every git call reads this checkout. A section whose rule
// block the loaded schema lacks is skipped, never asserted against. Each finding is one row,
// `[STATE] <section padded to 14> <name padded to 28> <detail>`, printed and appended to
// outputs/logs/bootstrap-check.log; STATE is PASS, MISS (required and missing, which counts), OPT
// (optional and missing) or INFO. A tool with version_args counts as found when its probe starts, and
// its first output line is the evidence; one without is looked up on PATH; one still missing is sought
// in its fallback_paths (%VAR% and a leading ~ expanded). Skill links follow scripts/lib/skill-state.js,
// the one resolver (the template lock, this machine's profile, the MANDATORY floor). --repair-links
// removes the links the resolver parks, makes each missing awake link through skillState.linkSkill (the
// link folder first: a fresh clone has none), and sets core.hooksPath to scripts/hooks when
// scripts/hooks/pre-commit exists. The hook path is read back either way, so its MISS means commits are
// not being scanned. Any other argument is ignored.
//
// NEVER. Installs a tool, registers a scheduled job (/cron-setup owns them; the scheduler is only
// listed), or reads a secret's value (only whether a file-backed one exists). Repairs anything but the
// skill links and core.hooksPath. Makes a link of its own. Starts a command through a shell, except two
// on Windows: npm, a .cmd shim there, and a tool probe that could not start at all (an npm .cmd shim),
// retried through one and counted only on exit 0, because through a shell a missing tool still answers
// ("'x' is not recognized", exit 1). Asserts core.longpaths off Windows, or when the schema does not
// ask. Knowingly keeps the defects scripts/tests/test-bootstrap-doctor.mjs pins (R4-3, R4-11, R4-L24,
// R4-L25): a tool that starts but fails its probe is PASS, a profile parking a MANDATORY skill crashes
// (exit 1), the plain doctor writes its log into the tree, and a Windows tool id reaches cmd.exe on the
// retry.
//
// Usage: node scripts/bootstrap.mjs [--repair-links]
// Exit: 0 every required item is present - 1 a script error, printed as BOOTSTRAP SCRIPT ERROR - 2 a
// required item is missing

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO } from './lib/repo-root.js';
import { readJsonHeaderless } from './lib/json-writer.js';

process.chdir(REPO);

const REPAIR = process.argv.includes('--repair-links');
const ONLINE = process.env.CLAUDE_CODE_REMOTE === 'true';
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const LAPTOP_SCHEMA = 'environment-schema.json';
const ONLINE_SCHEMA = 'environment-schema.online.json';
// The Kit's scheduled-job namespace: every job Install-Alex registers starts with it.
const JOB_PREFIX = 'Alex-';
const SECTION_WIDTH = 14;
const NAME_WIDTH = 28;
const LOG_DIR = path.join(REPO, 'outputs', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'bootstrap-check.log');
const HOOKS_PATH = 'scripts/hooks';
const DEFAULT_LINK_RULE = { target_dir: '.agents/skills', link_dir: '.claude/skills' };
// A ledger row with no local_path names its file at the start of `where`, relative to the repository.
const SECRET_FILE_IN_WHERE = /^([\w./\\-]+\.(txt|json|pass))\b/;
const EXIT_COMPLETE = 0;
const EXIT_ERROR = 1;
const EXIT_MISSING = 2;

/**
 * @typedef {object} Tool
 * @property {string} id the command name probed
 * @property {string} [version_args] its version arguments, split on single spaces
 * @property {string[]} [fallback_paths] where it lives when it is off PATH
 * @property {number} [min_major] node only: the lowest major version accepted
 * @property {boolean} [required] MISS when absent; OPT otherwise
 * @property {string} restore how to get it back
 */

/**
 * The environment schema. Every block is optional, and a section whose rule block is absent is skipped.
 * @typedef {object} Schema
 * @property {Tool[]} [tools]
 * @property {{ id: string, required?: boolean }[]} [npm_globals]
 * @property {{ id: string, pip_name: string, required?: boolean }[]} [python_packages]
 * @property {unknown} [secret_files_rule]
 * @property {unknown} [scheduler_rule]
 * @property {{ target_dir: string, link_dir: string }} [junction_rule]
 * @property {{ alias: string, note: string }[]} [ssh]
 * @property {{ expect_keys?: string[], expect_env?: Record<string, unknown> }} [claude_settings]
 * @property {{ remote?: string, core_longpaths?: boolean }} [git_expectations]
 */

/** @typedef {'PASS' | 'MISS' | 'OPT ' | 'INFO'} RowState */
/** @typedef {{ targetDir: string, linkDir: string }} LinkFolders */
/** @typedef {import('./lib/skill-state.js').SkillState} SkillState */
/** @typedef {{ linkSkill: (linkDir: string, storeDir: string, name: string) => string }} SkillStateModule */

fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Appends one line to the log. An unwritable log never stops the doctor: the printed rows are the report.
 * @param {string} line
 */
function logAppend(line) {
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // the log is a copy of what was printed
  }
}
logAppend(`=== bootstrap check ${new Date().toISOString()} ===`);

let missRequired = 0;

/**
 * Prints one row and logs it; a MISS counts against the verdict.
 * @param {RowState} state
 * @param {string} section
 * @param {string} name
 * @param {string} detail
 */
function report(state, section, name, detail) {
  const line = `[${state}] ${section.padEnd(SECTION_WIDTH)} ${name.padEnd(NAME_WIDTH)} ${detail}`;
  console.log(line);
  logAppend(line);
  if (state === 'MISS') missRequired++;
}

/**
 * The row state for a missing item: MISS when it is required, OPT when it is not.
 * @param {{ required?: boolean }} item
 * @returns {RowState}
 */
const absentState = (item) => (item.required ? 'MISS' : 'OPT ');

/** @param {string} file */
const parseJsonFile = (file) => readJsonHeaderless(file);

/** @param {string} p */
const exists = (p) => fs.existsSync(p);

/**
 * A schema path with each %VAR% replaced by its value (empty when unset) and a leading ~ by the home folder.
 * @param {unknown} s
 */
const expandVars = (s) =>
  String(s)
    .replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')
    .replace(/^~(?=$|[\\/])/, os.homedir());

/**
 * Runs a command with no shell and text output.
 * @param {string} cmd
 * @param {string[]} args
 */
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell: false });

/**
 * Runs a tool probe. On Windows a probe that cannot start (an npm .cmd shim, which Node refuses to start
 * without a shell) is retried through one, and the retry is taken only when it exits 0.
 * @param {string} cmd
 * @param {string[]} args
 */
function runProbe(cmd, args) {
  const r = run(cmd, args);
  if (!WIN || !r.error) return r;
  const retry = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
  return retry.status === 0 ? retry : r;
}

/**
 * One row per schema tool: found by its probe, on PATH, or at a fallback path, and a node below its floor
 * is a MISS.
 * @param {Schema} schema
 */
function checkTools(schema) {
  for (const t of schema.tools || []) {
    let ver = '';
    let found = false;
    if (t.version_args) {
      const r = runProbe(t.id, t.version_args.split(' '));
      if (!r.error && r.status !== null) {
        found = true;
        ver = (r.stdout || r.stderr || '').split(/\r?\n/)[0].trim();
      }
    } else {
      found = run(WIN ? 'where' : 'which', [t.id]).status === 0;
    }
    let exe = '';
    if (!found && Array.isArray(t.fallback_paths)) {
      exe = t.fallback_paths.find((p) => exists(expandVars(p))) || '';
      found = Boolean(exe);
    }
    if (!found) {
      report(absentState(t), 'tool', t.id, `absent - restore: ${t.restore}`);
      continue;
    }
    if (t.id === 'node' && t.min_major) {
      const m = /v(\d+)/.exec(ver);
      if (m && Number(m[1]) < t.min_major) {
        report('MISS', 'tool', t.id, `${ver} but need >= v${t.min_major} (node:sqlite)`);
        continue;
      }
    }
    report('PASS', 'tool', t.id, ver || exe || 'present');
  }
}

/**
 * One row per npm global (`npm ls -g`) and per Python package (an import, by python3 and then python).
 * @param {Schema} schema
 */
function checkPackages(schema) {
  for (const g of schema.npm_globals || []) {
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['ls', '-g', '--depth=0', g.id], { encoding: 'utf8', shell: WIN });
    const ok = r.status === 0;
    report(ok ? 'PASS' : absentState(g), 'npm-global', g.id, ok ? 'installed' : `absent - npm install -g ${g.id}`);
  }
  for (const p of schema.python_packages || []) {
    const ok = ['python3', 'python'].some((py) => {
      const r = run(py, ['-c', `import ${p.id}`]);
      return !r.error && r.status === 0;
    });
    report(
      ok ? 'PASS' : absentState(p),
      'py-package',
      p.pip_name,
      ok ? 'imports' : `absent - pip install ${p.pip_name}`
    );
  }
}

/**
 * The file a credentials-ledger row names, or null for a secret that is not file-backed.
 * @param {{ local_path?: string, where?: string }} c
 * @returns {string | null}
 */
function secretFileOf(c) {
  if (c.local_path) return expandVars(c.local_path);
  const m = SECRET_FILE_IN_WHERE.exec(c.where || '');
  return m ? m[1] : null;
}

/**
 * Whether each file-backed secret the gitignored ledger names exists. Only with the schema's rule: online
 * there is no ledger and no file-backed secret, and a MISS the platform cannot fix teaches the owner to
 * ignore the report.
 * @param {Schema} schema
 */
function checkSecretFiles(schema) {
  if (!schema.secret_files_rule) return;
  const ledgerPath = path.join(REPO, 'system', 'credentials-ledger.json');
  if (!exists(ledgerPath)) {
    report(
      'MISS',
      'secrets',
      'credentials-ledger',
      'system/credentials-ledger.json ABSENT - restore the encrypted vault backup FIRST (see docs/GETTING-STARTED)'
    );
    return;
  }
  const ledger = parseJsonFile(ledgerPath);
  for (const c of ledger.credentials || []) {
    const p = secretFileOf(c);
    if (p === null) {
      report('INFO', 'secrets', c.id, 'not file-backed (password manager / OS keyring) - nothing to check here');
    } else if (exists(path.isAbsolute(p) ? p : path.join(REPO, p))) {
      report('PASS', 'secrets', c.id, 'file present (value not read)');
    } else {
      report('MISS', 'secrets', c.id, `expected file absent: ${p}`);
    }
  }
}

/**
 * The names of this machine's registered Alex jobs, or null when no scheduler answers. Read-only: the
 * Windows Task Scheduler, launchctl in the owner's own session on macOS, systemd user timers elsewhere.
 * @returns {string[] | null}
 */
function liveJobs() {
  if (WIN) {
    const ps = run('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-ScheduledTask -TaskName '${JOB_PREFIX}*' -ErrorAction SilentlyContinue).TaskName`
    ]);
    if (ps.error || ps.status !== 0) return null;
    return (ps.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (MAC) {
    const lc = run('launchctl', ['list']);
    if (lc.error || lc.status !== 0) return null;
    // The label is the third column.
    return (lc.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)[2])
      .filter((s) => s?.startsWith(JOB_PREFIX));
  }
  const sysd = run('systemctl', ['--user', 'list-timers', '--all', '--no-legend', '--no-pager']);
  if (sysd.error || sysd.status !== 0) return null;
  return (sysd.stdout || '')
    .split(/\r?\n/)
    .map((l) => (new RegExp(`(${JOB_PREFIX}[\\w-]+)\\.timer`).exec(l) || [])[1])
    .filter(Boolean);
}

/**
 * Whether every job system/manifest.json declares is registered. Only with the schema's rule: online the
 * Routines on claude.ai are the schedule, and a Windows checkout under the online schema would otherwise
 * MISS every job of a scheduler the variant does not use. The manifest is read either way, so a missing
 * one fails the doctor on every schema.
 * @param {Schema} schema
 */
function checkScheduler(schema) {
  /** @type {{ projects?: { schedule_jobs?: string[] }[] }} */
  const manifest = parseJsonFile(path.join(REPO, 'system', 'manifest.json'));
  if (!schema.scheduler_rule) return;
  const declared = (manifest.projects || []).flatMap((proj) => proj.schedule_jobs || []).filter(Boolean);
  const live = liveJobs();
  const jobs = `${JOB_PREFIX}* jobs`;
  if (live === null) {
    report(
      'OPT ',
      'scheduler',
      jobs,
      `no scheduler backend reachable - ${declared.length} declared jobs not asserted here; /cron-setup recreates them`
    );
    return;
  }
  const missingJobs = declared.filter((j) => !live.includes(j));
  if (missingJobs.length === 0) {
    report('PASS', 'scheduler', jobs, `${declared.length} declared, all registered`);
  } else {
    report(
      'MISS',
      'scheduler',
      jobs,
      `${missingJobs.length} of ${declared.length} missing (recreate via /cron-setup): ${missingJobs.join(', ')}`
    );
  }
}

/**
 * Removes each named link, never its content: a symlink by unlink, a junction by rmdir, which refuses a
 * real folder that holds anything. What stays is reported by the caller's re-check.
 * @param {string} linkDir
 * @param {string[]} names
 */
function removeLinks(linkDir, names) {
  for (const n of names) {
    const link = path.join(linkDir, n);
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
      else fs.rmdirSync(link);
    } catch {
      // left in place
    }
  }
}

/**
 * Makes each named link through the Kit's one link writer, and counts the links that exist afterwards.
 * @param {SkillStateModule} skillState
 * @param {string} linkDir
 * @param {string} targetDir
 * @param {string[]} names
 */
function makeLinks(skillState, linkDir, targetDir, names) {
  let made = 0;
  for (const n of names) {
    try {
      // contract: read as text by scripts/tests/test-skill-links.mjs:159. No code line in this file calls fs.symlinkSync; every link goes through skillState.linkSkill here.
      const link = skillState.linkSkill(linkDir, targetDir, n);
      if (exists(link)) made++;
    } catch {
      // not counted
    }
  }
  return made;
}

/**
 * The skill store and the link folder the schema's junction_rule names.
 * @param {Schema} schema
 * @returns {LinkFolders}
 */
function linkFolders(schema) {
  const rule = schema.junction_rule || DEFAULT_LINK_RULE;
  return { targetDir: path.join(REPO, rule.target_dir), linkDir: path.join(REPO, rule.link_dir) };
}

/**
 * Whether the .claude/skills links match what skill-state resolved: every awake skill linked, no parked
 * one. PARKED skills are link-less on purpose, so they are neither counted broken nor brought back
 * (waking one is `node scripts/skills-park.js --wake <name>`). Applying a new profile is: edit it, then
 * run --repair-links.
 * @param {SkillStateModule} skillState
 * @param {SkillState} state what skillState.resolve answered for this repository
 * @param {LinkFolders} folders
 */
function checkSkillLinks(skillState, state, { targetDir, linkDir }) {
  for (const w of state.warnings) report('INFO', 'links', 'profile', w);
  const storeDirs = exists(targetDir)
    ? fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const targets = storeDirs.filter((n) => state.awake.has(n) || !state.parked.has(n));
  const broken = targets.filter((n) => !exists(path.join(linkDir, n)));
  const parkedButLinked = () => storeDirs.filter((n) => state.parked.has(n) && exists(path.join(linkDir, n)));
  const surplus = parkedButLinked();
  if (broken.length === 0 && surplus.length === 0) {
    report('PASS', 'links', 'skill store', `${targets.length} awake + ${state.parked.size} parked, links match`);
  } else if (REPAIR) {
    removeLinks(linkDir, surplus);
    fs.mkdirSync(linkDir, { recursive: true });
    const fixed = makeLinks(skillState, linkDir, targetDir, broken);
    const still = broken.length - fixed;
    const surplusLeft = parkedButLinked().length;
    if (still === 0 && surplusLeft === 0) {
      report(
        'PASS',
        'links',
        'skill store',
        `repaired ${fixed} missing + removed ${surplus.length} parked link(s); ${targets.length} awake, ${state.parked.size} parked`
      );
    } else {
      report('MISS', 'links', 'skill store', `repair left ${still} missing and ${surplusLeft} parked-but-linked`);
    }
  } else {
    report(
      'MISS',
      'links',
      'skill store',
      `${broken.length} missing, ${surplus.length} parked-but-linked - run: node scripts/bootstrap.mjs --repair-links`
    );
  }
}

/**
 * A pattern for a `Host` line in ~/.ssh/config naming the entry's alias as a whole word.
 * @param {{ alias: string }} s a schema ssh entry (named s, so a non-string alias fails with the same words)
 */
const hostLine = (s) => new RegExp(`^\\s*Host\\s+.*\\b${s.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');

/**
 * One row per schema ssh alias: a Host line naming it in ~/.ssh/config.
 * @param {Schema} schema
 */
function checkSsh(schema) {
  const sshCfg = path.join(os.homedir(), '.ssh', 'config');
  for (const s of schema.ssh || []) {
    const ok = exists(sshCfg) && hostLine(s).test(fs.readFileSync(sshCfg, 'utf8'));
    report(
      ok ? 'PASS' : 'MISS',
      'ssh',
      `alias '${s.alias}'`,
      ok ? 'in ~/.ssh/config' : `absent from ~/.ssh/config - ${s.note}`
    );
  }
}

/**
 * Claude Code's user settings: the keys and env values the schema expects. Only with the schema's block:
 * the user-level file never reaches a cloud VM, where the repository's .claude/settings.json carries the
 * env block instead.
 * @param {Schema} schema
 */
function checkClaudeSettings(schema) {
  const cs = schema.claude_settings || {};
  const csPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!schema.claude_settings) return;
  if (!exists(csPath)) {
    report('MISS', 'claude-cfg', 'settings.json', '~/.claude/settings.json absent');
    return;
  }
  const cfg = parseJsonFile(csPath);
  for (const k of cs.expect_keys || []) {
    const has = Object.hasOwn(cfg, k);
    report(has ? 'PASS' : 'MISS', 'claude-cfg', k, has ? 'set' : 'missing');
  }
  for (const [name, wantVal] of Object.entries(cs.expect_env || {})) {
    const env = cfg.env || {};
    const ok = env[name] === wantVal;
    report(ok ? 'PASS' : 'MISS', 'claude-cfg', name, ok ? `= ${wantVal}` : `expected ${wantVal}`);
  }
}

/**
 * core.hooksPath: git runs the versioned pre-commit gate only when this local setting points at
 * scripts/hooks, and a clone does not carry it. Repair sets it; the value is read back either way.
 */
function checkHooksPath() {
  if (REPAIR) run('git', ['config', 'core.hooksPath', HOOKS_PATH]);
  const value = (run('git', ['config', '--get', 'core.hooksPath']).stdout || '').trim();
  const ok = value === HOOKS_PATH;
  const unset = value ? `'${value}'` : 'unset';
  report(
    ok ? 'PASS' : 'MISS',
    'git',
    'core.hooksPath',
    ok
      ? `${HOOKS_PATH}${REPAIR ? ' (set and read back)' : ''}`
      : `${unset} - the pre-commit gate is not running; fix: node scripts/bootstrap.mjs --repair-links`
  );
}

/**
 * The remote, the hook path when the hook file ships, and core.longpaths where paths can pass MAX_PATH.
 * @param {Schema} schema
 */
function checkGit(schema) {
  const ge = schema.git_expectations || {};
  const remoteName = ge.remote || 'origin';
  const remote = run('git', ['remote', 'get-url', remoteName]);
  const remoteOk = !remote.error && remote.status === 0;
  report(
    remoteOk ? 'PASS' : 'MISS',
    'git',
    `remote '${remoteName}'`,
    remoteOk ? 'configured' : 'absent (clone from GitHub or re-add)'
  );
  if (exists(path.join(REPO, 'scripts', 'hooks', 'pre-commit'))) checkHooksPath();
  if (WIN && ge.core_longpaths) {
    const lpOk = (run('git', ['config', '--get', 'core.longpaths']).stdout || '').trim() === 'true';
    report(lpOk ? 'PASS' : 'MISS', 'git', 'core.longpaths', lpOk ? 'true' : "not 'true' - required on Windows");
  }
}

/** Prints and logs the verdict line, then exits 0 or 2. */
function finish() {
  console.log('');
  const complete = missRequired === 0;
  const verdict = complete
    ? 'bootstrap: environment COMPLETE (0 required items missing)'
    : `bootstrap: ${missRequired} required item(s) MISSING - see MISS lines above`;
  console.log(verdict);
  logAppend(verdict);
  process.exit(complete ? EXIT_COMPLETE : EXIT_MISSING);
}

try {
  const schemaFile = ONLINE ? ONLINE_SCHEMA : LAPTOP_SCHEMA;
  /** @type {Schema} */
  const schema = parseJsonFile(path.join(REPO, 'system', schemaFile));
  report('INFO', 'schema', schemaFile, ONLINE ? 'CLAUDE_CODE_REMOTE=true, the cloud schema' : 'the laptop schema');
  checkTools(schema);
  checkPackages(schema);
  checkSecretFiles(schema);
  checkScheduler(schema);
  const folders = linkFolders(schema);
  // skill-state.js is CommonJS, so an ES import hands its exports over as the default. It resolves here,
  // at the top level, so a profile it refuses crashes with the same two-frame stack the log has always held.
  const skillState = (await import('./lib/skill-state.js')).default;
  const skillsNow = skillState.resolve({ root: REPO });
  checkSkillLinks(skillState, skillsNow, folders);
  checkSsh(schema);
  checkClaudeSettings(schema);
  checkGit(schema);
  finish();
} catch (e) {
  const err = /** @type {Error} */ (e);
  const msg = `BOOTSTRAP SCRIPT ERROR: ${err.stack || err.message}`;
  console.log(msg);
  logAppend(msg);
  process.exit(EXIT_ERROR);
}
