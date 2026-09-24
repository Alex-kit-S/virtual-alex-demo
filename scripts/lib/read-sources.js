// read-sources.js - loads every source of truth into ONE in-memory model (refactor P1-S3).
// Sources: soul.md, CLAUDE.md, brand/config/*, system/manifest.json, scheduler/schedule.md.
// Fails loudly on any missing file or parse error; the generator aborts before staging anything.
// The parse helpers here are THE contracts Phase 3 validation reuses (V1 counts, V2 jobs, V4 MCPs,
// V5 tokens), so generator and validator can never disagree about how a source is read.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

function read(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) throw new Error(`read-sources: missing required source ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

// --- scheduler/schedule.md -> job entries + the full Alex-* job-name set -------------------
// Entries are "### Heading" sections carrying "- Command:" and "- Frequency:" lines.
// Job names are every Alex-<x> token anywhere in the file (the prose carries them), minus the
// ephemeral Alex-retry-* one-shots (excluded by design, same as recovery check C7).
function parseScheduleJobs(scheduleMd) {
  // "## Transient tasks (not standing jobs)" documents self-removing/on-demand tasks (e.g. the
  // QRA poller, 2026-07-13) so they are not mistaken for rogue jobs. They are NOT standing jobs:
  // V2's must-exist-live check skips them, but an armed one showing up live still counts as
  // documented. Section stripped before parsing so its names never pollute entries/allJobNames.
  let transientJobNames = [];
  const tm = scheduleMd.match(/^## Transient tasks[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (tm) {
    transientJobNames = [...new Set((tm[1].match(/Alex-[A-Za-z0-9-]+/g) || []))].sort();
    scheduleMd = scheduleMd.replace(tm[0], '');
  }
  const entries = [];
  const parts = scheduleMd.split(/^### /m).slice(1);
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const name = lines[0].trim();
    const cmd = part.match(/^- Command:\s*(.+)$/m);
    const freq = part.match(/^- Frequency:\s*(.+)$/m);
    // `- Script:` (added for the kit) names the exact repo-relative script a job runs. Without it
    // the scheduler assumes scripts/run-{name}.ps1, which is right for the claude -p wrappers and
    // wrong for the zero-token jobs (the drift sweep lives in work/18-recovery-layer/check.ps1,
    // the backups are scripts/git-backup.ps1 and scripts/vault-backup.ps1). Guessing the path and
    // then throwing is what forced those four jobs to be registered by hand on the donor machine.
    const script = part.match(/^- Script:\s*(.+)$/m);
    entries.push({
      name,
      command: cmd ? cmd[1].trim() : null,
      frequency: freq ? freq[1].trim() : null,
      script: script ? script[1].trim().replace(/^`|`$/g, '') : null,
      jobNames: [...new Set((part.match(/Alex-[A-Za-z0-9-]+/g) || []))].filter(j => !j.startsWith('Alex-retry-')),
      // Raw section text, so platform generators can read their own lines (gen-launchd reads
      // "- Frequency (macOS):") without a second parser over the same file (2026-08-31).
      text: part,
    });
  }
  const allJobNames = [...new Set((scheduleMd.match(/Alex-[A-Za-z0-9-]+/g) || []))]
    .filter(j => !j.startsWith('Alex-retry-')).sort();
  if (entries.length === 0) throw new Error('read-sources: scheduler/schedule.md has no "### " entries');
  return { entries, allJobNames, transientJobNames };
}

// --- CLAUDE.md "## MCP Reference" -> the MCP surface names ---------------------------------------
// Contract (shared with Phase 3 V4): bold lead entries of the section, descriptor stripped at the
// first " - " or ":", guidance lines starting with "MCP " excluded, entries sharing a first word
// collapsed to that word (the three "Notion ..." entries -> "Notion").
function parseMcpList(claudeMd) {
  const m = claudeMd.match(/^## MCP Reference$([\s\S]*?)(?=^## )/m);
  if (!m) throw new Error('read-sources: CLAUDE.md has no "## MCP Reference" section');
  const names = [];
  for (const line of m[1].split(/\r?\n/)) {
    const b = line.match(/^\*\*(.+?)\*\*/);
    if (!b) continue;
    let name = b[1].split(' - ')[0].split(':')[0].trim().replace(/\.$/, '');
    if (/^MCP\b/.test(name)) continue; // guidance lines, not tool surfaces
    names.push(name);
  }
  const byFirst = new Map();
  for (const n of names) {
    const first = n.split(/\s+/)[0];
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first).push(n);
  }
  const out = [];
  for (const [first, group] of byFirst) out.push(group.length > 1 ? first : group[0]);
  if (out.length === 0) throw new Error('read-sources: MCP Reference parse produced zero entries');
  return out;
}

// --- brand/config/color-system.md -> token table (name -> hex) -----------------------------------
// Source of the token law for Phase 3 V5 ("no hex outside the law file that matches no token").
// Reads the "## 2. The Palette" table plus the extended-palette table and the semantic extras
// that appear as inline hexes in the law file's own prose/tokens (e.g. #00232e, #fff5e1, #ffffff).
function parseColorTokens(colorSystemMd) {
  const tokens = new Map();
  const rowRe = /^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm;
  let m;
  while ((m = rowRe.exec(colorSystemMd)) !== null) tokens.set(m[1].trim(), m[2].toLowerCase());
  const extRe = /^\|\s*([A-Z][^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm;
  while ((m = extRe.exec(colorSystemMd)) !== null) if (!tokens.has(m[1].trim())) tokens.set(m[1].trim(), m[2].toLowerCase());
  // every other hex the law file itself defines (semantic values like elevated surfaces, white)
  const all = new Set([...tokens.values()]);
  for (const hx of colorSystemMd.match(/#[0-9a-fA-F]{6}\b/g) || []) all.add(hx.toLowerCase());
  if (tokens.size === 0) throw new Error('read-sources: color-system.md palette table parse produced zero tokens');
  return { tokens, allHexes: all };
}

// --- registry cadence schema (upgrade P4, 2026-07-12, design 1.3/MR2-3) --------------------------
// Every registry row (projects[] + meta.unnumbered) must carry the cadence OBJECT
// { expected_hours: number|null, label: string, note?: string } plus first_fire (null or
// YYYY-MM-DD) and first_fire_kind (null | 'live' | 'drill'). The old cadence_days integer is
// DEAD: a row still carrying it fails loudly here so the generator can never ship surfaces
// from a half-migrated registry (the MR2-3 atomicity rule).
function validateCadenceSchema(manifest) {
  const rows = [
    ...manifest.projects.map(p => ({ row: p, where: `projects[] #${p.num} ${p.name}` })),
    ...(manifest.meta.unnumbered || []).map(u => ({ row: u, where: `meta.unnumbered ${u.name}` })),
  ];
  const errs = [];
  for (const { row, where } of rows) {
    if ('cadence_days' in row)
      errs.push(`${where}: still carries the retired cadence_days field (replace with the cadence object)`);
    const c = row.cadence;
    if (!c || typeof c !== 'object' || Array.isArray(c))
      errs.push(`${where}: missing the cadence object {expected_hours, label, note?}`);
    else {
      if (!(c.expected_hours === null || (typeof c.expected_hours === 'number' && c.expected_hours > 0)))
        errs.push(`${where}: cadence.expected_hours must be a positive number or null (got ${JSON.stringify(c.expected_hours)})`);
      if (typeof c.label !== 'string' || c.label.trim() === '')
        errs.push(`${where}: cadence.label must be a non-empty string`);
      if ('note' in c && typeof c.note !== 'string')
        errs.push(`${where}: cadence.note must be a string when present`);
    }
    if (!('first_fire' in row) || !(row.first_fire === null || /^\d{4}-\d{2}-\d{2}$/.test(row.first_fire)))
      errs.push(`${where}: first_fire must be null or YYYY-MM-DD (got ${JSON.stringify(row.first_fire)})`);
    if (!('first_fire_kind' in row) || ![null, 'live', 'drill'].includes(row.first_fire_kind))
      errs.push(`${where}: first_fire_kind must be null, 'live' or 'drill' (got ${JSON.stringify(row.first_fire_kind)})`);
    if (row.first_fire === null && row.first_fire_kind !== null)
      errs.push(`${where}: first_fire_kind set while first_fire is null (a kind without a date is a lie)`);
    if (row.first_fire !== null && row.first_fire_kind === null)
      errs.push(`${where}: first_fire dated but first_fire_kind is null (say whether it was live or a drill)`);
  }
  if (errs.length)
    throw new Error(`read-sources: system/manifest.json cadence schema invalid:\n  - ${errs.join('\n  - ')}`);
}

// --- counts (Phase 3 V1 contract) ----------------------------------------------------------------
// AUTOMATION_COUNT = non-retired NUMBERED projects; LIVE_COUNT = those in state LIVE.
// Unnumbered systems (meta.unnumbered) are listed but not counted here.
function computeCounts(manifest) {
  const nonRetired = manifest.projects.filter(p => p.state !== 'RETIRED');
  return {
    automationCount: nonRetired.length,
    liveCount: nonRetired.filter(p => p.state === 'LIVE').length,
    retiredCount: manifest.projects.length - nonRetired.length,
    unnumberedCount: (manifest.meta.unnumbered || []).length,
  };
}

// Returns null instead of throwing. Use ONLY for sources that legitimately do not exist yet on a
// fresh install; everything else must keep failing loudly.
function readOptional(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function loadModel() {
  const model = { repo: REPO };
  // soul.md is OPTIONAL here, and that is a day-zero requirement rather than a relaxation of
  // standards. A brand new install has no soul.md at all: it is written by /setup, from the owner's
  // own answers and their own writing samples. Requiring it would mean the generator, and therefore
  // the whole build, could not run until identity setup was finished - and the generator is one of
  // the things a fresh install needs in order to make sense of itself. When it IS present, the two
  // structural checks below still apply, because a soul.md missing its Voice Rules is a real fault.
  model.soul = readOptional('soul.md');
  model.claudeMd = read('CLAUDE.md');
  model.colorSystem = read('brand/config/color-system.md');
  model.brandConfig = read('brand/config/brand-config.md');
  const manifestRaw = read('system/manifest.json');
  try {
    model.manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new Error(`read-sources: system/manifest.json is not valid JSON: ${e.message}`);
  }
  if (!Array.isArray(model.manifest.projects) || model.manifest.projects.length === 0)
    throw new Error('read-sources: system/manifest.json has no projects[]');
  if (!model.manifest.meta || !Array.isArray(model.manifest.meta.unnumbered))
    throw new Error('read-sources: system/manifest.json meta.unnumbered missing');
  validateCadenceSchema(model.manifest);
  if (model.soul !== null) {
    if (!model.soul.includes('## My Words'))
      throw new Error('read-sources: soul.md exists but has no "## My Words" section - the voice corpus lives there and every draft reads it');
    if (!model.soul.includes('## Voice Rules'))
      throw new Error('read-sources: soul.md exists but has no "## Voice Rules" section - without it there is nothing to hold prose to');
  }
  model.scheduleMd = read('scheduler/schedule.md');
  model.schedule = parseScheduleJobs(model.scheduleMd);
  model.mcpList = parseMcpList(model.claudeMd);
  model.colorTokens = parseColorTokens(model.colorSystem);
  model.counts = computeCounts(model.manifest);
  return model;
}

module.exports = { REPO, loadModel, parseScheduleJobs, parseMcpList, parseColorTokens, computeCounts, validateCadenceSchema };
