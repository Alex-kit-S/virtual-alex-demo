// @ts-check
// scripts/lib/read-sources.js - reads every source of truth the generator renders from into one model.
//
// WHAT. The generator builds CLAUDE.md's routing table, the docs, the brand tokens and the schedule from
// a few hand-written files. This module is the one place those files are read and parsed, and the parse
// functions it exports are the same ones scripts/validate-alex.js checks the rendered surfaces with (V1
// the counts, V2 the jobs, V4 the MCP names, V5 the colour tokens), so the generator and the validator
// can never read a source two ways.
//
// HOW. loadModel reads soul.md when it exists, then CLAUDE.md, brand/config/color-system.md,
// brand/config/brand-config.md, system/manifest.json and scheduler/schedule.md, all from the repository
// root. It checks the registry's shape and its cadence schema, checks soul.md for its two required
// sections, parses the schedule, the MCP Reference section and the palette, and counts the projects. It
// refuses at the first problem, naming the file and what is wrong, and the generator stages nothing. The
// job-name rule lives here too: JOB_PREFIX, the JOB_NAME token and isRetryJob are what the schedule parse
// uses, and scripts/lib/gen-scheduler.js and scripts/lib/gen-launchd.js read the live schedulers with the
// same three, so a job is named one way in the documentation and on the machine.
//
// NEVER. Treats a missing source as empty. soul.md is the one optional file: a new install has none until
// /setup writes it from the owner's answers, and the generator must run before that. A registry row still
// carrying the retired cadence_days field fails the whole load, so no surface is ever rendered from a
// half-migrated registry. Writes anything.
//
// Usage: module only - const { loadModel, parseScheduleJobs } = require('./read-sources');
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./repo-root');

/**
 * @typedef {{ name: string, command: string | null, frequency: string | null, script: string | null,
 *   jobNames: string[], text: string }} ScheduleEntry
 * @typedef {{ entries: ScheduleEntry[], allJobNames: string[], transientJobNames: string[] }} Schedule
 * @typedef {{ tokens: Map<string, string>, allHexes: Set<string> }} ColorTokens
 * @typedef {{ automationCount: number, liveCount: number, retiredCount: number, unnumberedCount: number }} Counts
 * @typedef {object} Model
 * @property {string} repo the repository root the sources were read from
 * @property {string | null} soul soul.md, or null on an install that has none yet
 * @property {string} claudeMd
 * @property {string} colorSystem
 * @property {string} brandConfig
 * @property {any} manifest the parsed system/manifest.json
 * @property {string} scheduleMd
 * @property {Schedule} schedule
 * @property {string[]} mcpList
 * @property {ColorTokens} colorTokens
 * @property {Counts} counts
 */

/** The prefix every scheduled job's name starts with, on Windows and on macOS alike. */
const JOB_PREFIX = 'Alex-';

/**
 * A job name as a token: the prefix, then letters, digits and hyphens. A reader that finds names inside
 * other text, such as a scheduler's listing, builds its expression from this one's source, so the token
 * is spelled once.
 */
const JOB_NAME = new RegExp(`${JOB_PREFIX}[A-Za-z0-9-]+`);

/** Every job name in a text, in the order they appear, repeats included. */
const JOB_NAMES = new RegExp(JOB_NAME.source, 'g');

/**
 * True for a retry one-shot, Alex-retry-*. Its task removes itself after it runs, so no reader of a
 * schedule counts it; recovery check C7 leaves it out the same way.
 * @param {string} name
 */
const isRetryJob = (name) => name.startsWith(`${JOB_PREFIX}retry-`);

/**
 * @param {string} text
 * @returns {string[]}
 */
const jobNamesIn = (text) => text.match(JOB_NAMES) || [];

/**
 * A required source, refused by name when it is missing.
 * @param {string} rel
 * @returns {string}
 */
function read(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) throw new Error(`read-sources: missing required source ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

/**
 * A source that may not exist yet on a new install, or null. Everything else goes through read().
 * @param {string} rel
 * @returns {string | null}
 */
function readOptional(rel) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

/**
 * scheduler/schedule.md as job entries and job names.
 *
 * An entry is a "### Heading" section with "- Command:", "- Frequency:" and "- Script:" lines; Script
 * names the repo-relative file a job runs, because the scheduler would otherwise assume
 * scripts/run-<name>.ps1, which is wrong for the jobs that are not claude -p wrappers (the drift sweep
 * in work/18-recovery-layer/check.ps1, scripts/git-backup.ps1, scripts/vault-backup.ps1). Each entry
 * keeps its raw section text, so a platform generator reads its own lines ("- Frequency (macOS):")
 * without parsing the file a second time. A job name is any Alex-<x> token anywhere in the file, prose
 * included; Alex-retry-* one-shots are left out, as recovery check C7 leaves them out. The
 * "## Transient tasks" section lists self-removing and on-demand tasks: its names are returned apart,
 * so V2 does not demand them live but counts one it finds as documented, and the section is cut out
 * before anything else is parsed.
 * @param {string} scheduleMd
 * @returns {Schedule}
 */
function parseScheduleJobs(scheduleMd) {
  let text = scheduleMd;
  /** @type {string[]} */
  let transientJobNames = [];
  const tm = text.match(/^## Transient tasks[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  if (tm) {
    transientJobNames = [...new Set(jobNamesIn(tm[1]))].sort();
    text = text.replace(tm[0], '');
  }
  /** @type {ScheduleEntry[]} */
  const entries = [];
  const parts = text.split(/^### /m).slice(1);
  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    const name = lines[0].trim();
    const cmd = part.match(/^- Command:\s*(.+)$/m);
    const freq = part.match(/^- Frequency:\s*(.+)$/m);
    const script = part.match(/^- Script:\s*(.+)$/m);
    entries.push({
      name,
      command: cmd ? cmd[1].trim() : null,
      frequency: freq ? freq[1].trim() : null,
      script: script ? script[1].trim().replace(/^`|`$/g, '') : null,
      jobNames: [...new Set(jobNamesIn(part))].filter((j) => !isRetryJob(j)),
      text: part
    });
  }
  const allJobNames = [...new Set(jobNamesIn(text))].filter((j) => !isRetryJob(j)).sort();
  if (entries.length === 0) throw new Error('read-sources: scheduler/schedule.md has no "### " entries');
  return { entries, allJobNames, transientJobNames };
}

/**
 * CLAUDE.md's "## MCP Reference" section as the MCP surface names, the contract V4 shares.
 *
 * A name is the bold lead of a line, cut at the first " - " or ":"; a lead that starts with "MCP" is
 * guidance, not a surface; names sharing a first word collapse to that word, so three "Notion ..."
 * entries read as "Notion". The section must be followed by another "## " heading.
 * @param {string} claudeMd
 * @returns {string[]}
 */
function parseMcpList(claudeMd) {
  const m = claudeMd.match(/^## MCP Reference$([\s\S]*?)(?=^## )/m);
  if (!m) throw new Error('read-sources: CLAUDE.md has no "## MCP Reference" section');
  const names = [];
  for (const line of m[1].split(/\r?\n/)) {
    const b = line.match(/^\*\*(.+?)\*\*/);
    if (!b) continue;
    const name = b[1].split(' - ')[0].split(':')[0].trim().replace(/\.$/, '');
    if (/^MCP\b/.test(name)) continue;
    names.push(name);
  }
  /** @type {Map<string, string[]>} */
  const byFirst = new Map();
  for (const n of names) {
    const first = n.split(/\s+/)[0];
    const group = byFirst.get(first);
    if (group) group.push(n);
    else byFirst.set(first, [n]);
  }
  const out = [];
  for (const [first, group] of byFirst) out.push(group.length > 1 ? first : group[0]);
  if (out.length === 0) throw new Error('read-sources: MCP Reference parse produced zero entries');
  return out;
}

/**
 * brand/config/color-system.md as the named colour tokens, the law V5 checks every hex against.
 *
 * The tokens are the rows of the numbered palette table, then the rows of the extended table whose name
 * is not taken. allHexes adds every other hex the law file writes (the semantic values in its prose,
 * such as an elevated surface or white), since those are in the law too.
 * @param {string} colorSystemMd
 * @returns {ColorTokens}
 */
function parseColorTokens(colorSystemMd) {
  /** @type {Map<string, string>} */
  const tokens = new Map();
  for (const m of colorSystemMd.matchAll(/^\|\s*\d+\s*\|\s*([^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm))
    tokens.set(m[1].trim(), m[2].toLowerCase());
  for (const m of colorSystemMd.matchAll(/^\|\s*([A-Z][^|]+?)\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm))
    if (!tokens.has(m[1].trim())) tokens.set(m[1].trim(), m[2].toLowerCase());
  const all = new Set([...tokens.values()]);
  for (const hx of colorSystemMd.match(/#[0-9a-fA-F]{6}\b/g) || []) all.add(hx.toLowerCase());
  if (tokens.size === 0) throw new Error('read-sources: color-system.md palette table parse produced zero tokens');
  return { tokens, allHexes: all };
}

/**
 * Refuses a registry whose rows do not all carry the cadence schema, listing every problem at once.
 *
 * Each row of projects[] and meta.unnumbered carries cadence { expected_hours: number | null, label:
 * string, note?: string }, first_fire (null or YYYY-MM-DD) and first_fire_kind (null, 'live' or
 * 'drill'), and never the retired cadence_days integer.
 * @param {any} manifest the parsed system/manifest.json
 */
function validateCadenceSchema(manifest) {
  const rows = [
    ...manifest.projects.map((/** @type {any} */ p) => ({ row: p, where: `projects[] #${p.num} ${p.name}` })),
    ...(manifest.meta.unnumbered || []).map((/** @type {any} */ u) => ({ row: u, where: `meta.unnumbered ${u.name}` }))
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
        errs.push(
          `${where}: cadence.expected_hours must be a positive number or null (got ${JSON.stringify(c.expected_hours)})`
        );
      if (typeof c.label !== 'string' || c.label.trim() === '')
        errs.push(`${where}: cadence.label must be a non-empty string`);
      if ('note' in c && typeof c.note !== 'string') errs.push(`${where}: cadence.note must be a string when present`);
    }
    if (!('first_fire' in row) || !(row.first_fire === null || /^\d{4}-\d{2}-\d{2}$/.test(row.first_fire)))
      errs.push(`${where}: first_fire must be null or YYYY-MM-DD (got ${JSON.stringify(row.first_fire)})`);
    if (!('first_fire_kind' in row) || ![null, 'live', 'drill'].includes(row.first_fire_kind))
      errs.push(
        `${where}: first_fire_kind must be null, 'live' or 'drill' (got ${JSON.stringify(row.first_fire_kind)})`
      );
    if (row.first_fire === null && row.first_fire_kind !== null)
      errs.push(`${where}: first_fire_kind set while first_fire is null (a kind without a date is a lie)`);
    if (row.first_fire !== null && row.first_fire_kind === null)
      errs.push(`${where}: first_fire dated but first_fire_kind is null (say whether it was live or a drill)`);
  }
  if (errs.length)
    throw new Error(`read-sources: system/manifest.json cadence schema invalid:\n  - ${errs.join('\n  - ')}`);
}

/**
 * The counts the docs print and V1 checks: automations are the numbered projects that are not retired,
 * and the live count is those in state LIVE. Unnumbered systems are listed, not counted.
 * @param {any} manifest the parsed system/manifest.json
 * @returns {Counts}
 */
function computeCounts(manifest) {
  const nonRetired = manifest.projects.filter((/** @type {any} */ p) => p.state !== 'RETIRED');
  return {
    automationCount: nonRetired.length,
    liveCount: nonRetired.filter((/** @type {any} */ p) => p.state === 'LIVE').length,
    retiredCount: manifest.projects.length - nonRetired.length,
    unnumberedCount: (manifest.meta.unnumbered || []).length
  };
}

/**
 * Every source, read and parsed, or a refusal naming the first one that is wrong.
 * @returns {Model}
 */
function loadModel() {
  const soul = readOptional('soul.md');
  const claudeMd = read('CLAUDE.md');
  const colorSystem = read('brand/config/color-system.md');
  const brandConfig = read('brand/config/brand-config.md');
  const manifestRaw = read('system/manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    throw new Error(`read-sources: system/manifest.json is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
  if (!Array.isArray(manifest.projects) || manifest.projects.length === 0)
    throw new Error('read-sources: system/manifest.json has no projects[]');
  if (!manifest.meta || !Array.isArray(manifest.meta.unnumbered))
    throw new Error('read-sources: system/manifest.json meta.unnumbered missing');
  validateCadenceSchema(manifest);
  if (soul !== null) {
    if (!soul.includes('## My Words'))
      throw new Error(
        'read-sources: soul.md exists but has no "## My Words" section - the voice corpus lives there and every draft reads it'
      );
    if (!soul.includes('## Voice Rules'))
      throw new Error(
        'read-sources: soul.md exists but has no "## Voice Rules" section - without it there is nothing to hold prose to'
      );
  }
  const scheduleMd = read('scheduler/schedule.md');
  const schedule = parseScheduleJobs(scheduleMd);
  const mcpList = parseMcpList(claudeMd);
  const colorTokens = parseColorTokens(colorSystem);
  const counts = computeCounts(manifest);
  return {
    repo: REPO,
    soul,
    claudeMd,
    colorSystem,
    brandConfig,
    manifest,
    scheduleMd,
    schedule,
    mcpList,
    colorTokens,
    counts
  };
}

module.exports = {
  loadModel,
  parseScheduleJobs,
  parseMcpList,
  parseColorTokens,
  computeCounts,
  validateCadenceSchema,
  JOB_PREFIX,
  JOB_NAME,
  isRetryJob
};
