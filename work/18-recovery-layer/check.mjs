#!/usr/bin/env node
// work/18-recovery-layer/check.mjs - the Virtual Alex sweep: the deterministic, zero-token checker
// for the Kit running inside a Claude Code cloud session (plan Phase 4, seat 5, 2026-09-23).
//
// The port of check.ps1 for a tree that has no PowerShell, no Task Scheduler, no passphrase and no
// encrypted tar. It is level-triggered like its parent: every run re-checks the WHOLE repository
// against the desired state in system/manifest.json and the run log, forgiving of a session that
// died mid-propagation. It DETECTS and never repairs. Runs as leg 1 of the weekly housekeeping
// Routine (scheduler/routines/housekeeping.md) and by hand in any session.
//
// Thirteen legs. Six ported from check.ps1 (the numbers are stable and never reused):
//   C6  wiki-link resolution over vault/           C9  vault/log.md monotonicity (RED on a shrink)
//   C11 vault/index.md entries versus disk          C12 outputs/ naming (Output Hygiene)
//   C22 soul.md corpus monotonicity (RED on a shrink)   C23 soul-core.md freshness against soul.md
// Seven for the online shape:
//   R1  run-log freshness: every routines[] row has a run-log row inside cadence_hours + 6 h grace
//   R2  snapshot freshness: the snapshot Routine's newest run-log row is COMPLETE inside 8 days
//   R3  model drift: a Routine's newest row reports the registry default model
//   N   the never-list is absent from git ls-files (RED on a hit)
//   H   core.hooksPath is scripts/hooks (RED when unset: the commit gate is not running)
//   M   no auto-memory directory inside the clone (RED if one appears)
//   S   the housekeeping skills snapshot could read /skills (AMBER when its row says unreadable)
//
// Exit 0 = every leg GREEN · 2 = at least one AMBER, no RED · 1 = at least one RED, or the checker
// itself broke (the same semantics as check.ps1: drift is a normal result, RED is data loss or a
// wall that is down). Findings go to vault/projects/recovery/last-sweep.md, whose frontmatter also
// carries the high-water marks the next run needs (C9, C22), and one `sweep` row is appended to
// system/run-log.jsonl through scripts/run-log.mjs. --dry-run prints and writes nothing.
//
// Node builtins only. Never repairs. NEVER TOUCHES THE NETWORK: as of 2026-09-23 the last leg that
// did (R2's ls-remote against the backup repository) reads the snapshot Routine's own run-log row
// instead, because a one-repository cloud session has no credentials for any other repository and
// the probe failed every week on a healthy system.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DRY = process.argv.includes('--dry-run');
const NOW = new Date();
const GRACE_HOURS = 6;
const SNAPSHOT_MAX_DAYS = 8;
const REPORT_REL = 'vault/projects/recovery/last-sweep.md';
const RUNLOG_REL = 'system/run-log.jsonl';
const NEVER_EXACT = ['.claude/settings.local.json', 'system/credentials-ledger.json', 'work/07-email-triage/state/staged-drafts.json'];
const MEMORY_DIRS = ['.claude/memory', '.claude/projects'];

const abs = (rel) => path.join(REPO, ...rel.split('/'));
const exists = (rel) => fs.existsSync(abs(rel));
const readText = (rel) => fs.readFileSync(abs(rel), 'utf8');
const lineCount = (text) => text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
const hoursSince = (iso) => (NOW.getTime() - new Date(iso).getTime()) / 3600000;
const fmtH = (h) => Number.isFinite(h) ? `${Math.round(h)}h` : 'unknown';
const git = (...args) => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', timeout: 60000 });

const legs = [];
const add = (id, level, line) => legs.push({ id, level, line });
const GREEN = 'GREEN', AMBER = 'AMBER', RED = 'RED';

// ------------------------------------------------------------------ frontmatter (the previous sweep)
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}
const previous = exists(REPORT_REL) ? parseFrontmatter(readText(REPORT_REL)) : {};
const prevNum = (k) => (previous[k] !== undefined && /^\d+$/.test(previous[k]) ? Number(previous[k]) : null);

// ------------------------------------------------------------------ the registry and the run log
let manifest;
try {
  manifest = JSON.parse(readText('system/manifest.json'));
} catch (e) {
  console.error(`check.mjs: checker ERROR (exit 1): system/manifest.json could not be read - ${e.message}`);
  process.exit(1);
}
const routines = Array.isArray(manifest.routines) ? manifest.routines.filter((r) => r && typeof r.name === 'string') : [];
const defaultModel = manifest.meta && manifest.meta.model_routing && manifest.meta.model_routing.default;

function readRunLog() {
  if (!exists(RUNLOG_REL)) return null;
  const rows = [];
  for (const line of readText(RUNLOG_REL).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is not a row */ }
  }
  return rows;
}
const runLog = readRunLog();
function newestRow(job) {
  let best = null;
  for (const r of runLog || []) {
    if (!r || r.job !== job) continue;
    if (!best || String(r.at || '') >= String(best.at || '')) best = r;
  }
  return best;
}

const vaultReady = exists('vault/index.md');
const highWater = { log_lines: prevNum('log_lines'), soul_entries: prevNum('soul_entries'), soul_lines: prevNum('soul_lines') };

// ------------------------------------------------------------------ C6 wiki-link resolution
function walkMd(dir, skipDirs, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skipDirs.includes(e.name)) walkMd(p, skipDirs, out); continue; }
    if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
(function c6() {
  if (!vaultReady) { add('C6', AMBER, 'vault/ not created yet (run /setup); no links to check'); return; }
  const vaultAbs = abs('vault');
  const targets = walkMd(vaultAbs, ['.obsidian']);
  const relpaths = new Set();
  const basenameCounts = new Map();
  for (const t of targets) {
    const rel = path.relative(vaultAbs, t).split(path.sep).join('/').toLowerCase().replace(/\.md$/, '');
    relpaths.add(rel);
    const bn = path.basename(rel);
    basenameCounts.set(bn, (basenameCounts.get(bn) || 0) + 1);
  }
  basenameCounts.set('soul', 1); // soul.md lives at the repo root and is a real, unique target
  const ignore = new Set(['wiki links', 'wiki link', 'link', 'links', 'name', 'people/name', 'projects/name', 'business/company', 'wiki-links']);
  const sources = targets.filter((t) => {
    const rel = path.relative(vaultAbs, t).split(path.sep).join('/');
    if (/(^|\/)(archive|sources|history|standups)\//.test(rel)) return false;
    return !['index.md', 'log.md', 'last-sweep.md'].includes(path.basename(rel));
  });
  const unresolved = [];
  for (const s of sources) {
    let content = fs.readFileSync(s, 'utf8');
    if (!content) continue;
    content = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
    for (const m of content.matchAll(/\[\[([^\]|#]+)/g)) {
      const t = m[1].trim().replace(/\\$/, '').toLowerCase();
      if (!t || ignore.has(t)) continue;
      let ok;
      if (t.includes('/')) {
        ok = relpaths.has(t) || [...relpaths].some((r) => r.endsWith('/' + t));
        const seg = t.split('/').pop();
        if (!ok && basenameCounts.get(seg) === 1) ok = true;
      } else {
        ok = relpaths.has(t) || basenameCounts.has(t);
      }
      if (!ok) { try { ok = fs.existsSync(abs(t + '.md')) || fs.existsSync(abs(t)); } catch { ok = false; } }
      if (!ok) unresolved.push(t);
    }
  }
  if (!unresolved.length) { add('C6', GREEN, `every [[wiki link]] resolves (${sources.length} source page(s))`); return; }
  const counts = new Map();
  for (const t of unresolved) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `[[${t}]] x${n}`).join(', ');
  add('C6', AMBER, `${unresolved.length} unresolved [[wiki link]](s) across ${counts.size} distinct target(s): ${top}`);
})();

// ------------------------------------------------------------------ C9 log monotonicity
(function c9() {
  if (!exists('vault/log.md')) { add('C9', AMBER, 'vault/log.md does not exist yet (run /setup); nothing to compare'); return; }
  const lines = lineCount(readText('vault/log.md'));
  const prev = highWater.log_lines;
  if (prev !== null && lines < prev) {
    add('C9', RED, `vault/log.md SHRANK from ${prev} to ${lines} lines - it is append-only, so a smaller file is data loss; the previous version is one commit back`);
  } else {
    add('C9', GREEN, prev === null ? `vault/log.md baseline recorded: ${lines} lines` : `vault/log.md ${lines} lines (high-water ${prev})`);
  }
  highWater.log_lines = Math.max(lines, prev || 0);
})();

// ------------------------------------------------------------------ C11 index versus disk
(function c11() {
  if (!vaultReady) { add('C11', AMBER, 'vault/index.md does not exist yet (run /setup); nothing to compare'); return; }
  const index = readText('vault/index.md');
  const missing = [];
  for (const p of manifest.projects || []) {
    if (!p.status_md) continue;
    const ref = p.status_md.replace(/^vault\//, '').replace(/\.md$/, '');
    if (exists(p.status_md) && !index.includes(ref)) missing.push(`#${p.num} ${p.name} (${ref})`);
  }
  const dead = [];
  for (const m of index.matchAll(/\[\[([^\]|#]+)/g)) {
    const t = m[1].trim();
    if (!t.includes('/')) continue;
    if (!exists(`vault/${t}.md`) && !exists(`vault/${t}`)) dead.push(t);
  }
  if (!missing.length && !dead.length) { add('C11', GREEN, 'vault/index.md and the disk agree'); return; }
  const parts = [];
  if (missing.length) parts.push(`status page(s) on disk but not catalogued: ${missing.join('; ')}`);
  if (dead.length) parts.push(`index entries with no page on disk: ${[...new Set(dead)].slice(0, 12).join(', ')}`);
  add('C11', AMBER, parts.join(' | '));
})();

// ------------------------------------------------------------------ C12 outputs naming
(function c12() {
  if (!exists('outputs')) { add('C12', GREEN, 'no outputs/ directory yet; nothing to name'); return; }
  if (!exists('scripts/outputs-ledger.js')) { add('C12', AMBER, 'scripts/outputs-ledger.js is missing, so outputs/ naming could not be validated'); return; }
  const r = spawnSync(process.execPath, [abs('scripts/outputs-ledger.js'), 'validate'], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
  const first = String(r.stdout || r.stderr || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (r.status === 0) add('C12', GREEN, first || 'outputs/ top-level naming clean');
  else if (r.status === 2) add('C12', AMBER, first);
  else add('C12', AMBER, `outputs-ledger validate errored (exit ${r.status}): ${first}`);
})();

// ------------------------------------------------------------------ C22 soul-corpus monotonicity
const soulPresent = exists('soul.md');
(function c22() {
  if (!soulPresent) { add('C22', AMBER, 'soul.md does not exist, so Alex has no voice loaded; on a new repository the fix is /setup, on an established one it is serious: the previous version is one commit back'); return; }
  const text = readText('soul.md');
  const entries = (text.match(/^###\s+(?:Harvested\s+)?\d{4}-\d{2}-\d{2}/gm) || []).length;
  const lines = lineCount(text);
  const pe = highWater.soul_entries, pl = highWater.soul_lines;
  const shrank = [];
  if (pe !== null && entries < pe) shrank.push(`My Words entries ${pe} -> ${entries}`);
  if (pl !== null && lines < pl) shrank.push(`lines ${pl} -> ${lines}`);
  if (shrank.length) add('C22', RED, `soul.md SHRANK (${shrank.join(', ')}) - the voice corpus is the input to every prose surface and the most irreplaceable file here; the previous version is one commit back`);
  else add('C22', GREEN, pe === null ? `soul.md baseline recorded: ${entries} dated entries, ${lines} lines` : `soul.md ${entries} dated entries, ${lines} lines (high-water ${pe} / ${pl})`);
  highWater.soul_entries = Math.max(entries, pe || 0);
  highWater.soul_lines = Math.max(lines, pl || 0);
})();

// ------------------------------------------------------------------ C23 soul-core freshness
(function c23() {
  if (!soulPresent) { add('C23', AMBER, 'no soul.md, so there is no card to be fresh against'); return; }
  if (!exists('soul-core.md')) { add('C23', AMBER, 'soul-core.md MISSING: sessions run on the full-soul fallback; rebuild with node scripts/lib/build-soul-core.js --force'); return; }
  const core = readText('soul-core.md');
  const stamp = /source-sha256=([0-9a-f]{64})/.exec(core.slice(Math.max(0, core.length - 400)));
  if (!stamp) { add('C23', AMBER, 'soul-core.md has no parseable SOUL-CORE-STAMP source-sha256 (hand-edited or truncated); rebuild with node scripts/lib/build-soul-core.js --force'); return; }
  const live = crypto.createHash('sha256').update(fs.readFileSync(abs('soul.md'))).digest('hex');
  if (live !== stamp[1]) add('C23', AMBER, `soul-core.md STALE: card built from sha ${stamp[1].slice(0, 12)}.. but soul.md is now ${live.slice(0, 12)}..; the SessionStart rebuild missed or the rebuilt card was not committed`);
  else add('C23', GREEN, `soul-core.md matches soul.md (sha ${live.slice(0, 12)}..)`);
})();

// ------------------------------------------------------------------ R1 run-log freshness
(function r1() {
  if (!routines.length) { add('R1', AMBER, 'system/manifest.json has no routines[] rows, so there is no cadence to check against'); return; }
  if (runLog === null) {
    if (process.env.ALEX_ROUTINE) add('R1', RED, `${RUNLOG_REL} is absent inside a Routine session: at least one Routine has run (this one) and no row was ever written, so the snapshot before it did not record itself`);
    else add('R1', AMBER, `${RUNLOG_REL} does not exist yet: no Routine has written a row (expected before the first Run now)`);
    return;
  }
  const stale = [];
  for (const r of routines) {
    const row = newestRow(r.name);
    const window = (Number(r.cadence_hours) || 0) + GRACE_HOURS;
    if (!row) { stale.push(`${r.name} never ran`); continue; }
    const age = hoursSince(row.at);
    if (!Number.isFinite(age) || age > window) stale.push(`${r.name} last row ${row.at} (${fmtH(age)} old, window ${window}h)`);
  }
  if (stale.length) add('R1', AMBER, `${stale.length} Routine(s) past cadence: ${stale.join('; ')}`);
  else add('R1', GREEN, `every Routine (${routines.map((r) => r.name).join(', ')}) has a row inside its cadence + ${GRACE_HOURS}h grace`);
})();

// ------------------------------------------------------------------ R2 snapshot freshness
// THE EVIDENCE IS THE SNAPSHOT'S OWN ROW, NOT A PROBE FROM HERE (2026-09-23, fleet seat 1).
// This leg used to run `git ls-remote` against the backup repository. It cannot work where this
// sweep actually runs. A cloud session's git credentials cover the repositories ATTACHED to that
// session and nothing else, and the housekeeping Routine has one repository attached, so the probe
// died with "could not read Username" and R2 went AMBER every single week. A check that is amber
// on a healthy system is worse than no check: it teaches its owner that amber means nothing.
//
// The snapshot Routine is a two-repository session. It pushes the copy, reads the pushed ref back
// with ls-remote itself, and writes the result as its run-log row. That row IS the verification,
// made by the only session that could make it. R1 asks whether the Routine ran at all; R2 asks
// whether a backup actually landed, which is a different question and the one that matters here.
(function r2() {
  const statusRel = 'vault/projects/recovery/status.md';
  const fm = exists(statusRel) ? parseFrontmatter(readText(statusRel)) : {};
  const repo = (fm.backup_repo || '').replace(/^["']|["']$/g, '');
  if (!repo) { add('R2', AMBER, `no backup_repo in the frontmatter of ${statusRel} yet (the online /setup records it); the weekly snapshot has nowhere to go`); return; }

  const row = newestRow('snapshot');
  if (!row) { add('R2', AMBER, `the snapshot Routine has no run-log row yet, so no copy is known to have landed on ${repo}`); return; }
  const ageDays = (NOW.getTime() - new Date(row.at).getTime()) / 86400000;
  if (!Number.isFinite(ageDays)) { add('R2', AMBER, `the newest snapshot row has an unreadable timestamp (${row.at})`); return; }
  if (row.status !== 'COMPLETE') {
    add('R2', AMBER, `the newest snapshot row is ${row.status} at ${row.at}: ${row.reason || 'no reason given'}`);
    return;
  }
  if (ageDays > SNAPSHOT_MAX_DAYS) {
    add('R2', AMBER, `the newest COMPLETE snapshot row is ${row.at}, ${Math.floor(ageDays)} days old (window ${SNAPSHOT_MAX_DAYS} days); the snapshot Routine missed`);
    return;
  }
  // The row is a model's own report, so check what can be checked from here (fleet Fix C, review
  // finding F27): the repository it says the copy landed on must be the backup_repo (GitHub names
  // are case-insensitive), and a sha, when given, must be one. A row from before the field existed
  // names no repository; it stays GREEN and says so rather than turning a healthy week amber.
  const same = (a, b) => String(a || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase()
    === String(b || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
  if (row.repo && !same(row.repo, repo)) {
    add('R2', AMBER, `the newest COMPLETE snapshot row says the copy landed on ${row.repo}, which is not the backup_repo ${repo}; the backup this install relies on did not get it`);
    return;
  }
  if (row.sha && !/^[0-9a-f]{40}$/i.test(row.sha)) {
    add('R2', AMBER, `the newest COMPLETE snapshot row carries "${row.sha}" as its read-back sha, which is not a commit sha`);
    return;
  }
  const readBack = row.sha ? ` at ${row.sha.slice(0, 12)}` : '';
  const legacy = row.repo ? '' : ' (the row does not name its repository; a current snapshot Routine records it)';
  add('R2', GREEN, `the snapshot Routine landed a copy on ${repo} ${Math.floor(ageDays)} day(s) ago and read it back${readBack}: ${row.reason || 'COMPLETE'}${legacy}`);
})();

// ------------------------------------------------------------------ R3 model drift
(function r3() {
  if (!defaultModel) { add('R3', AMBER, 'system/manifest.json meta.model_routing.default is not set; no model to hold the rows to'); return; }
  if (runLog === null || !routines.length) { add('R3', GREEN, 'no run-log rows yet to compare with the default model'); return; }
  const norm = (m) => String(m || '').replace(/-\d{8}$/, '');
  const drift = [];
  for (const r of routines) {
    const row = newestRow(r.name);
    if (!row) continue;
    if (row.model === null || row.model === undefined || row.model === '') drift.push(`${r.name} did not record its model`);
    else if (norm(row.model) !== norm(defaultModel)) drift.push(`${r.name} ran on ${row.model}`);
  }
  if (drift.length) add('R3', AMBER, `${drift.length} row(s) off the default model ${defaultModel}: ${drift.join('; ')} (the form's model selector is the pin; a row that says another model is the cost-leak class V13 exists for)`);
  else add('R3', GREEN, `every Routine's newest row reports the default model ${defaultModel}`);
})();

// ------------------------------------------------------------------ N the never-list
(function never() {
  const r = git('ls-files', '-z');
  if (r.status !== 0) { add('N', AMBER, `git ls-files failed: ${String(r.stderr || '').trim().split(/\r?\n/)[0]}`); return; }
  const tracked = String(r.stdout || '').split('\0').filter(Boolean);
  const hits = tracked.filter((p) => {
    const bn = path.basename(p);
    return bn === '.env' || bn.startsWith('.env.') || bn.endsWith('.key') || NEVER_EXACT.includes(p);
  });
  if (hits.length) add('N', RED, `${hits.length} never-list path(s) are TRACKED: ${hits.join(', ')} (.env*, *.key, ${NEVER_EXACT.join(', ')}) - a secret in history is forever; remove it from the index and rotate it`);
  else add('N', GREEN, `none of the never-list paths is tracked (${tracked.length} tracked paths checked)`);
})();

// ------------------------------------------------------------------ H core.hooksPath
(function hooks() {
  const r = git('config', '--get', 'core.hooksPath');
  const v = String(r.stdout || '').trim();
  if (!v) add('H', RED, 'core.hooksPath is unset: the commit gate (scripts/hooks/pre-commit) is not running on this clone; the SessionStart hook sets it, so a session without hooks is the usual cause');
  else if (v !== 'scripts/hooks') add('H', RED, `core.hooksPath is ${v}, expected scripts/hooks; the commit gate is not the one this repository ships`);
  else add('H', GREEN, 'core.hooksPath is scripts/hooks');
})();

// ------------------------------------------------------------------ M auto-memory in the clone
(function memory() {
  // CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 sits in the online settings. Today the harness keeps its auto
  // memory under the user's home, outside the repository. This leg watches the two places a future
  // harness would put project-scoped memory INSIDE the clone (.claude/memory/, .claude/projects/)
  // and any MEMORY.md under .claude/, on disk or tracked, because a memory file inside a repository
  // that autosaves every write becomes a second identity that commits without ever being reviewed.
  const found = [];
  for (const d of MEMORY_DIRS) if (fs.existsSync(abs(d))) found.push(d + '/');
  const claudeDir = abs('.claude');
  if (fs.existsSync(claudeDir)) {
    for (const f of walkMd(claudeDir, ['skills'])) if (path.basename(f) === 'MEMORY.md') found.push(path.relative(REPO, f).split(path.sep).join('/'));
  }
  const r = git('ls-files', '-z', '--', '.claude/memory', '.claude/projects');
  for (const p of String(r.stdout || '').split('\0').filter(Boolean)) if (!found.some((f) => p.startsWith(f))) found.push(p);
  if (found.length) add('M', RED, `auto-memory surface inside the clone: ${[...new Set(found)].join(', ')} (${MEMORY_DIRS.join('/, ')}/ or a MEMORY.md under .claude/); the env block disables auto memory and nothing should write these; an unreviewed memory that autosaves is a second identity`);
  else add('M', GREEN, `no auto-memory directory in the clone (${MEMORY_DIRS.join('/, ')}/, MEMORY.md under .claude/)`);
})();

// ------------------------------------------------------------------ S skills readability
(function skills() {
  const row = runLog === null ? null : newestRow('skills');
  if (!row) { add('S', GREEN, 'no skills snapshot row yet (the housekeeping skills leg runs after this sweep)'); return; }
  if (row.status === 'BLOCKED' || /unreadable/i.test(String(row.reason || ''))) add('S', AMBER, `the housekeeping skills snapshot could not read /skills at ${row.at}: ${row.reason || 'no reason recorded'} (mechanism-dependent; the claude.ai sync list is unverified this week)`);
  else add('S', GREEN, `/skills readable at ${row.at}${row.status === 'PARTIAL' ? ' (the list changed; see the row)' : ''}`);
})();

// ------------------------------------------------------------------ report
const count = (lvl) => legs.filter((l) => l.level === lvl).length;
const nRed = count(RED), nAmber = count(AMBER), nGreen = count(GREEN);
const verdict = nRed ? 'RED' : nAmber ? 'AMBER' : 'CLEAN';
const at = NOW.toISOString().replace(/\.\d{3}Z$/, 'Z');
for (const l of legs) console.log(`${l.id.padEnd(4)} ${l.level.padEnd(5)} ${l.line}`);
console.log(`check.mjs: ${verdict} - ${nGreen} green, ${nAmber} amber, ${nRed} red (${legs.length} legs)${DRY ? ' [dry-run: nothing written]' : ''}`);

if (!DRY) {
  const report = [
    '---',
    `at: ${at}`,
    `verdict: ${verdict}`,
    `green: ${nGreen}`,
    `amber: ${nAmber}`,
    `red: ${nRed}`,
    `log_lines: ${highWater.log_lines === null ? 0 : highWater.log_lines}`,
    `soul_entries: ${highWater.soul_entries === null ? 0 : highWater.soul_entries}`,
    `soul_lines: ${highWater.soul_lines === null ? 0 : highWater.soul_lines}`,
    '---',
    '# Recovery Sweep - last-sweep (Virtual Alex)',
    '',
    `**${at}** | result: ${verdict === 'CLEAN' ? 'CLEAN' : `${nAmber + nRed} finding(s): ${nRed} red, ${nAmber} amber`}`,
    '',
    '| Leg | Level | Finding |',
    '|---|---|---|',
    ...legs.map((l) => `| ${l.id} | ${l.level} | ${l.line.replace(/\|/g, '\\|')} |`),
    '',
    'Detect-only. Nothing was changed. The frontmatter carries the high-water marks the next sweep compares against (C9, C22). RED is data loss or a wall that is down; AMBER is worth an hour this week. Read out by /status and the brief.',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(abs(REPORT_REL)), { recursive: true });
  fs.writeFileSync(abs(REPORT_REL), report, 'utf8');
  console.log(`report: ${REPORT_REL}`);
  if (exists('scripts/run-log.mjs')) {
    const status = nRed ? 'RED' : nAmber ? 'PARTIAL' : 'COMPLETE';
    const first = legs.find((l) => l.level === RED) || legs.find((l) => l.level === AMBER);
    const reason = `${nGreen} green, ${nAmber} amber, ${nRed} red${first ? `; ${first.id}: ${first.line.slice(0, 160)}` : ''}`;
    const r = spawnSync(process.execPath, [abs('scripts/run-log.mjs'), 'append', '--job', 'sweep', '--status', status, '--reason', reason], { cwd: REPO, encoding: 'utf8', timeout: 60000 });
    const line = String(r.stdout || r.stderr || '').trim().split(/\r?\n/).pop();
    console.log(r.status === 0 ? line : `check.mjs: WARN the sweep row was not written (run-log exit ${r.status}): ${line}`);
  } else {
    console.log('check.mjs: WARN scripts/run-log.mjs is missing; no sweep row written');
  }
}

process.exitCode = nRed ? 1 : nAmber ? 2 : 0;
