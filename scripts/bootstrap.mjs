#!/usr/bin/env node
// scripts/bootstrap.mjs - the machine-rebuild doctor, cross-platform.
// Transplanted 2026-08-31 from personal-os/scripts/bootstrap.mjs (itself ported from this Kit's
// bootstrap.ps1 during the 2026-08-25 powershell-branch reconciliation), adapted for the Kit:
// job prefix Alex-*, a darwin launchctl probe, and core.longpaths asserted on Windows only.
//
// WHY: every outside-repo dependency is declared in system/environment-schema.json (tracked, no
// secret paths) and this script proves each one present. One code path, three platforms.
//
// DOCTOR, NOT INSTALLER. It reports and it repairs exactly TWO things under --repair-links, both
// safe and idempotent: the skill links, and `git config core.hooksPath scripts/hooks` when the
// repo's hook file exists (2026-09-22: no installer set it, so on every install where nobody ran
// that one line by hand the pre-commit gate never ran; Install-Alex and Update-Alex both call
// --repair-links, so the update path now sets it). It never installs tools, never creates
// scheduler jobs (/cron-setup owns those), never reads a secret VALUE (existence of the ledger's
// file-type entries only).
//
// Usage:  node scripts/bootstrap.mjs                  # doctor: report PASS/MISS/OPT
//         node scripts/bootstrap.mjs --repair-links   # + recreate missing skill links + hooksPath
// Exit:   0 = every REQUIRED item present · 2 = something required is missing · 1 = script error
// Log:    outputs/logs/bootstrap-check.log (gitignored)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
process.chdir(REPO);

const REPAIR = process.argv.includes('--repair-links');
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const JOB_PREFIX = 'Alex-'; // the Kit's scheduled-job namespace (Install-Alex step 7)

fs.mkdirSync(path.join(REPO, 'outputs', 'logs'), { recursive: true });
const LOG_FILE = path.join(REPO, 'outputs', 'logs', 'bootstrap-check.log');
const logAppend = (m) => {
  try {
    fs.appendFileSync(LOG_FILE, `${m}\n`, 'utf8');
  } catch {
    /* never die on an unwritable log */
  }
};
logAppend(`=== bootstrap check ${new Date().toISOString()} ===`);

let missRequired = 0;
function report(state, section, name, detail) {
  const line = `[${state}] ${section.padEnd(14)} ${name.padEnd(28)} ${detail}`;
  console.log(line);
  logAppend(line);
  if (state === 'MISS') missRequired++;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const expandVars = (s) =>
  String(s)
    .replace(/%([^%]+)%/g, (_, v) => process.env[v] || '')
    .replace(/^~(?=$|[\\/])/, os.homedir());
// Probes are COMMAND NAMES from the tracked schema, never arbitrary strings, so the schema cannot
// inject shell. shell:false throughout; Windows npm-shim tools (.cmd) need a shell retry - Node 18+
// refuses .cmd via spawnSync without one (EINVAL), and the translators' claude IS an npm shim.
// THE RETRY IS STRICT ON PURPOSE (release-QC finding #1, 2026-08-31): through a shell, a MISSING
// tool still "answers" - cmd exits 1 with "'x' is not recognized" and NO error object - so the
// permissive direct-probe acceptance (any status) would false-PASS every absent tool. The shell
// retry therefore only counts as found on status===0; a shimless absent tool falls through to
// the fallback_paths / where probes and MISSes honestly, which is the doctor's whole job.
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell: false });
const runProbe = (cmd, args) => {
  let r = run(cmd, args);
  if (WIN && r.error) {
    const retry = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
    if (retry.status === 0) return retry;
    return r; // keep the honest ENOENT; the shell's "not recognized" is absence, not an answer
  }
  return r;
};

try {
  // Virtual Alex (2026-09-22): a Claude Code cloud session exports CLAUDE_CODE_REMOTE=true, and its
  // VM has none of the laptop's obligations (no scheduler, no secret files, no ~/.claude). The
  // online schema declares only what the VM must have; a section whose rule block is absent from
  // the loaded schema is skipped below, never asserted against.
  const ONLINE = process.env.CLAUDE_CODE_REMOTE === 'true';
  const schemaFile = ONLINE ? 'environment-schema.online.json' : 'environment-schema.json';
  const schema = readJson(path.join(REPO, 'system', schemaFile));
  report('INFO', 'schema', schemaFile, ONLINE ? 'CLAUDE_CODE_REMOTE=true, the cloud schema' : 'the laptop schema');

  // --- 1. tools -------------------------------------------------------------------------------
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
      // No version probe declared: presence on PATH is the whole check.
      const which = run(WIN ? 'where' : 'which', [t.id]);
      found = which.status === 0;
    }
    let exe = '';
    if (!found && Array.isArray(t.fallback_paths)) {
      // some tools live off-PATH by design (gpg rides Git's bundle on Windows; the vault backup
      // resolves the same list in the same order) - probe exactly what production probes.
      exe = t.fallback_paths.find((p) => exists(expandVars(p))) || '';
      found = Boolean(exe);
    }
    if (!found) {
      report(t.required ? 'MISS' : 'OPT ', 'tool', t.id, `absent - restore: ${t.restore}`);
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

  // --- 2. npm globals + python packages -------------------------------------------------------
  for (const g of schema.npm_globals || []) {
    const r = spawnSync(WIN ? 'npm.cmd' : 'npm', ['ls', '-g', '--depth=0', g.id], { encoding: 'utf8', shell: WIN });
    const ok = r.status === 0;
    report(ok ? 'PASS' : g.required ? 'MISS' : 'OPT ', 'npm-global', g.id, ok ? 'installed' : `absent - npm install -g ${g.id}`);
  }
  for (const p of schema.python_packages || []) {
    let ok = false;
    for (const py of ['python3', 'python']) {
      const r = run(py, ['-c', `import ${p.id}`]);
      if (!r.error && r.status === 0) {
        ok = true;
        break;
      }
    }
    report(ok ? 'PASS' : p.required ? 'MISS' : 'OPT ', 'py-package', p.pip_name, ok ? 'imports' : `absent - pip install ${p.pip_name}`);
  }

  // --- 3. secret files (existence only, from the gitignored ledger) ---------------------------
  // Only when the schema declares the rule: online there is no ledger and no file-backed secret,
  // and a MISS for a file the platform cannot have teaches the owner to ignore the report.
  const ledgerPath = path.join(REPO, 'system', 'credentials-ledger.json');
  if (!schema.secret_files_rule) {
    /* no secret-files rule in this schema: section skipped */
  } else if (!exists(ledgerPath)) {
    report('MISS', 'secrets', 'credentials-ledger', 'system/credentials-ledger.json ABSENT - restore the encrypted vault backup FIRST (see docs/GETTING-STARTED)');
  } else {
    const ledger = readJson(ledgerPath);
    for (const c of ledger.credentials || []) {
      let p = null;
      if (c.local_path) p = expandVars(c.local_path);
      else {
        const m = /^([\w./\\-]+\.(txt|json|pass))\b/.exec(c.where || '');
        if (m) p = m[1];
      }
      if (p === null) {
        report('INFO', 'secrets', c.id, 'not file-backed (password manager / OS keyring) - nothing to check here');
        continue;
      }
      if (exists(path.isAbsolute(p) ? p : path.join(REPO, p))) report('PASS', 'secrets', c.id, 'file present (value not read)');
      else report('MISS', 'secrets', c.id, `expected file absent: ${p}`);
    }
  }

  // --- 4. scheduler jobs (manifest = source of truth; /cron-setup recreates) ------------------
  // Same guard: a schema with no scheduler rule has no scheduler to ask (online the Routines on
  // claude.ai are the schedule). Without it, a Windows checkout under the online schema would
  // MISS every declared job, which is a false verdict about a scheduler the variant does not use.
  const manifest = readJson(path.join(REPO, 'system', 'manifest.json'));
  const declared = schema.scheduler_rule ? (manifest.projects || []).flatMap((proj) => proj.schedule_jobs || []).filter(Boolean) : [];
  let live = null; // null = no scheduler backend reachable on this machine
  if (!schema.scheduler_rule) {
    /* no scheduler rule in this schema: section skipped */
  } else if (WIN) {
    const ps = run('powershell', ['-NoProfile', '-Command', `(Get-ScheduledTask -TaskName '${JOB_PREFIX}*' -ErrorAction SilentlyContinue).TaskName`]);
    if (!ps.error && ps.status === 0) live = (ps.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else if (MAC) {
    // launchctl list: third column is the label. Agents are only visible inside the user's own
    // gui session, which is where this doctor runs.
    const lc = run('launchctl', ['list']);
    if (!lc.error && lc.status === 0) {
      live = (lc.stdout || '')
        .split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/)[2])
        .filter((s) => s && s.startsWith(JOB_PREFIX));
    }
  } else {
    const sysd = run('systemctl', ['--user', 'list-timers', '--all', '--no-legend', '--no-pager']);
    if (!sysd.error && sysd.status === 0) {
      live = (sysd.stdout || '')
        .split(/\r?\n/)
        .map((l) => (new RegExp(`(${JOB_PREFIX}[\\w-]+)\\.timer`).exec(l) || [])[1])
        .filter(Boolean);
    }
  }
  if (!schema.scheduler_rule) {
    /* skipped above */
  } else if (live === null) {
    report('OPT ', 'scheduler', `${JOB_PREFIX}* jobs`, `no scheduler backend reachable - ${declared.length} declared jobs not asserted here; /cron-setup recreates them`);
  } else {
    const missingJobs = declared.filter((j) => !live.includes(j));
    if (missingJobs.length === 0) report('PASS', 'scheduler', `${JOB_PREFIX}* jobs`, `${declared.length} declared, all registered`);
    else report('MISS', 'scheduler', `${JOB_PREFIX}* jobs`, `${missingJobs.length} of ${declared.length} missing (recreate via /cron-setup): ${missingJobs.join(', ')}`);
  }

  // --- 5. skill links (.agents/skills -> .claude/skills) --------------------------------------
  // PARKED skills are deliberately link-less; the doctor must not count them broken nor resurrect
  // them on repair (wake = node scripts/skills-park.js --wake <name>). The awake/parked answer
  // comes from the ONE shared resolver (scripts/lib/skill-state.js): template lock + the
  // per-install profile override + the MANDATORY floor. Repair also REMOVES links the resolver
  // says should not exist, so applying a new profile is just: edit profile, run --repair-links.
  const jr = schema.junction_rule || { target_dir: '.agents/skills', link_dir: '.claude/skills' };
  const targetDir = path.join(REPO, jr.target_dir);
  const linkDir = path.join(REPO, jr.link_dir);
  const skillState = (await import('./lib/skill-state.js')).default;
  const state = skillState.resolve({ root: REPO });
  for (const w of state.warnings) report('INFO', 'links', 'profile', w);
  const storeDirs = exists(targetDir)
    ? fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const targets = storeDirs.filter((n) => state.awake.has(n) || !state.parked.has(n));
  const broken = targets.filter((n) => !exists(path.join(linkDir, n)));
  // Links that exist but SHOULD be parked (profile just parked them, or a stale wake).
  const surplus = storeDirs.filter((n) => state.parked.has(n) && exists(path.join(linkDir, n)));
  if (broken.length === 0 && surplus.length === 0) {
    report('PASS', 'links', 'skill store', `${targets.length} awake + ${state.parked.size} parked, links match`);
  } else if (REPAIR) {
    // Remove links the resolver says are parked (link only; content never touched).
    for (const n of surplus) {
      const link = path.join(linkDir, n);
      try {
        const st = fs.lstatSync(link);
        if (st.isSymbolicLink()) fs.unlinkSync(link);
        else fs.rmdirSync(link); // junction; a real non-empty dir refuses, correctly
      } catch {
        /* reported by the re-check below */
      }
    }
    // Create the link directory first: on a fresh clone it does not exist at all (the links are
    // gitignored, so nothing in the repo creates their parent) - the 2026-08-17 56-silent-failures
    // lesson, kept from bootstrap.ps1.
    fs.mkdirSync(linkDir, { recursive: true });
    // One link writer for the whole Kit: scripts/lib/skill-state.js linkSkill(). A junction on
    // Windows (no elevation needed), a RELATIVE symlink everywhere else, so a tree that is cloned
    // or moved keeps working links. Online that is load-bearing: the links are tracked there, so
    // the target text ships inside the owner's repo (2026-09-23; the old mklink /J shell-out is
    // gone with the macOS port, and the absolute target went with this one).
    let fixed = 0;
    for (const n of broken) {
      try {
        const link = skillState.linkSkill(linkDir, targetDir, n);
        if (exists(link)) fixed++;
      } catch {
        /* counted below */
      }
    }
    const still = broken.length - fixed;
    const surplusLeft = storeDirs.filter((n) => state.parked.has(n) && exists(path.join(linkDir, n))).length;
    if (still === 0 && surplusLeft === 0) report('PASS', 'links', 'skill store', `repaired ${fixed} missing + removed ${surplus.length} parked link(s); ${targets.length} awake, ${state.parked.size} parked`);
    else report('MISS', 'links', 'skill store', `repair left ${still} missing and ${surplusLeft} parked-but-linked`);
  } else {
    report('MISS', 'links', 'skill store', `${broken.length} missing, ${surplus.length} parked-but-linked - run: node scripts/bootstrap.mjs --repair-links`);
  }

  // --- 6. ssh alias ---------------------------------------------------------------------------
  const sshCfg = path.join(os.homedir(), '.ssh', 'config');
  for (const s of schema.ssh || []) {
    const ok = exists(sshCfg) && new RegExp(`^\\s*Host\\s+.*\\b${s.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im').test(fs.readFileSync(sshCfg, 'utf8'));
    report(ok ? 'PASS' : 'MISS', 'ssh', `alias '${s.alias}'`, ok ? 'in ~/.ssh/config' : `absent from ~/.ssh/config - ${s.note}`);
  }

  // --- 7. claude settings ---------------------------------------------------------------------
  // Only when the schema declares the block: the user-level settings file never reaches a cloud
  // VM, where the repo's own .claude/settings.json carries the env block instead.
  const cs = schema.claude_settings || {};
  const csPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (!schema.claude_settings) {
    /* no claude-settings block in this schema: section skipped */
  } else if (!exists(csPath)) {
    report('MISS', 'claude-cfg', 'settings.json', '~/.claude/settings.json absent');
  } else {
    const cfg = readJson(csPath);
    for (const k of cs.expect_keys || []) {
      const has = Object.prototype.hasOwnProperty.call(cfg, k);
      report(has ? 'PASS' : 'MISS', 'claude-cfg', k, has ? 'set' : 'missing');
    }
    for (const [name, wantVal] of Object.entries(cs.expect_env || {})) {
      const ok = cfg.env && cfg.env[name] === wantVal;
      report(ok ? 'PASS' : 'MISS', 'claude-cfg', name, ok ? `= ${wantVal}` : `expected ${wantVal}`);
    }
  }

  // --- 8. git expectations --------------------------------------------------------------------
  const ge = schema.git_expectations || {};
  const remote = run('git', ['remote', 'get-url', ge.remote || 'origin']);
  const remoteOk = !remote.error && remote.status === 0;
  report(remoteOk ? 'PASS' : 'MISS', 'git', `remote '${ge.remote || 'origin'}'`, remoteOk ? 'configured' : 'absent (clone from GitHub or re-add)');
  // core.hooksPath: the pre-commit gate is versioned in scripts/hooks/, and git only runs it when
  // this local setting points there. A clone does not carry it. Repair sets it; the doctor reads
  // the value back either way, so a MISS here means "your commits are not being scanned".
  if (exists(path.join(REPO, 'scripts', 'hooks', 'pre-commit'))) {
    if (REPAIR) run('git', ['config', 'core.hooksPath', 'scripts/hooks']);
    const hp = run('git', ['config', '--get', 'core.hooksPath']);
    const hpVal = (hp.stdout || '').trim();
    const hpOk = hpVal === 'scripts/hooks';
    report(hpOk ? 'PASS' : 'MISS', 'git', 'core.hooksPath',
      hpOk ? `scripts/hooks${REPAIR ? ' (set and read back)' : ''}` : `${hpVal ? `'${hpVal}'` : 'unset'} - the pre-commit gate is not running; fix: node scripts/bootstrap.mjs --repair-links`);
  }
  if (WIN && ge.core_longpaths) {
    // core.longpaths matters only where paths can exceed MAX_PATH; asserting it elsewhere would
    // invent a defect the platform does not have. (bootstrap.ps1 asserted it unconditionally,
    // which would false-MISS every macOS install.) And only when the schema asks for it: the
    // online schema does not, so a Windows checkout testing the online variant is not marked.
    const lp = run('git', ['config', '--get', 'core.longpaths']);
    const lpOk = (lp.stdout || '').trim() === 'true';
    report(lpOk ? 'PASS' : 'MISS', 'git', 'core.longpaths', lpOk ? 'true' : "not 'true' - required on Windows");
  }

  // --- verdict --------------------------------------------------------------------------------
  console.log('');
  if (missRequired === 0) {
    const msg = 'bootstrap: environment COMPLETE (0 required items missing)';
    console.log(msg);
    logAppend(msg);
    process.exit(0);
  } else {
    const msg = `bootstrap: ${missRequired} required item(s) MISSING - see MISS lines above`;
    console.log(msg);
    logAppend(msg);
    process.exit(2);
  }
} catch (e) {
  const msg = `BOOTSTRAP SCRIPT ERROR: ${e.stack || e.message}`;
  console.log(msg);
  logAppend(msg);
  process.exit(1);
}
