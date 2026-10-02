// @ts-check
// scripts/lib/gen-docs.js - renders the four generated documents under docs/.
//
// WHAT. Builds the pages a person reads to learn the system: docs/GETTING-STARTED.md (the automations,
// the utility commands, the MCP surfaces and the scheduled jobs), docs/ARCHITECTURE.md (the constitution
// being shipped), docs/README.md (the landing page) and the project table in docs/projects/README.md.
// The prose is in the templates; this module computes only the values that fill them.
//
// HOW. Each gen* function takes the model read-sources.js loaded and returns { rel, content } for the
// caller to stage. GETTING-STARTED fills its template with the counts and the lists: every project and
// unnumbered system that is not retired, and one table row per scheduled job. ARCHITECTURE embeds the
// STAGED CLAUDE.md the caller hands it, so the constitution shown is the one about to ship. README
// reads the current docs/README.md, keeps its one hand-written welcome block between CUSTOM_START and
// CUSTOM_END word for word, and renders the rest. The projects README keeps its hand-written prose and
// replaces only the region between its PROJECT-TABLE markers. The date in each stamp is today's, in UTC.
// needsStaging(rel, content) tells a caller that only re-stages one document (--only=scheduler re-stages
// GETTING-STARTED alone) whether the rendered text needs writing at all: false only when the body matches
// the tracked copy and the sole would-be change is the "Generated" date rolling over.
//
// NEVER. Lists a retired project as if it ran. Writes a welcome block of its own: with docs/README.md or
// its block missing, it refuses and a person writes the block once. Writes into a document whose markers
// are missing, doubled or reversed: it refuses, and a person fixes them first. Writes a file itself.
//
// Usage: module only - const genDocs = require('./gen-docs'); genDocs.genReadme(model)
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./repo-root');
const { PAIRS, assertOnePair, readRegion, replaceRegion } = require('./markers');
const { loadTemplate, block, fill, pad, esc } = require('./render-templates');
const { projectTableBlock } = require('./gen-routing-table');

/** @typedef {import('./read-sources').Model} Model */

/**
 * The refusals for docs/README.md's welcome block, in the words scripts/tests/test-generator-libs-contract.mjs pins.
 * @type {import('./markers').Messages}
 */
const CUSTOM_ZONE_MESSAGES = {
  count: (found) =>
    `gen-docs: docs/README.md must contain exactly one custom zone (found START=${found.begin}, END=${found.end})`,
  order: 'gen-docs: docs/README.md custom-zone markers are out of order'
};

/**
 * The refusals for the project table in docs/projects/README.md, in the words the same test pins.
 * @type {import('./markers').Messages}
 */
const PROJECT_TABLE_MESSAGES = {
  count: (found) =>
    `gen-docs: docs/projects/README.md must contain exactly one PROJECT-TABLE BEGIN and END marker (found BEGIN=${found.begin}, END=${found.end})`,
  order: 'gen-docs: docs/projects/README.md markers are out of order'
};

/** Today's date, YYYY-MM-DD in UTC, for the "Generated" stamp. */
function stamp() {
  return new Date().toISOString().slice(0, 10);
}

/** Matches the stamp() text this module writes, wherever it falls in a rendered document. */
const STAMP_RE = /Generated \d{4}-\d{2}-\d{2}\./;

/**
 * Whether a freshly rendered document needs (re)staging over its working-tree copy at `rel`. False only
 * when the body matches and the sole difference staging would introduce is the "Generated" date rolling
 * over. A render already byte-identical to the tracked copy, stamp included, still stages - a harmless
 * no-op write, not "only the stamp differs" - and so does one whose body genuinely changed, or a `rel`
 * with no working-tree copy yet. Compares with the stamp text substituted out of both sides, never by
 * slicing off a line by number, which breaks the moment that line moves or wraps.
 * @param {string} rel repository-relative path, forward slashes
 * @param {string} content the freshly rendered text
 * @returns {boolean}
 */
function needsStaging(rel, content) {
  const target = path.join(REPO, rel);
  if (!fs.existsSync(target)) return true;
  const onDisk = fs.readFileSync(target, 'utf8');
  if (content === onDisk) return true; // nothing would change either way; stage exactly as it always has
  // false only when the stamp text is the sole diff
  return content.replace(STAMP_RE, 'Generated STAMP.') !== onDisk.replace(STAMP_RE, 'Generated STAMP.');
}

/**
 * The automation list for GETTING-STARTED: numbered projects first, then unnumbered systems, retired
 * ones left out.
 * @param {any} manifest the parsed system/manifest.json
 * @returns {string}
 */
function automationList(manifest) {
  const rows = [];
  for (const p of manifest.projects) {
    if (p.state === 'RETIRED') continue;
    const state = p.revisit ? `${p.state}, revisit ${p.revisit}` : p.state;
    rows.push(`- **${pad(p.num)} ${p.title}** (${state}; trigger: ${p.trigger}) - ${p.one_liner}`);
  }
  for (const u of manifest.meta.unnumbered) {
    if (u.state === 'RETIRED') continue;
    const state = u.revisit ? `${u.state}, revisit ${u.revisit}` : u.state;
    rows.push(`- **${u.title}** (${state}; trigger: ${u.trigger}) - ${u.one_liner}`);
  }
  return rows.join('\n');
}

/**
 * The rows of the scheduled-jobs table, whose header lives in the template; V2 compares these rows.
 * @param {{ entries: Array<{ name: string, command: string | null, frequency: string | null }> }} schedule
 * @returns {string}
 */
function scheduledJobsRows(schedule) {
  return schedule.entries
    .map((e) => `| ${esc(e.name)} | ${esc(e.command || '-')} | ${esc(e.frequency || '-')} |`)
    .join('\n');
}

/**
 * docs/GETTING-STARTED.md.
 * @param {Model} model
 */
function genGettingStarted(model) {
  const tpl = loadTemplate('getting-started');
  const content = fill(
    tpl,
    {
      GENERATED_STAMP: stamp(),
      AUTOMATION_COUNT: model.counts.automationCount,
      AUTOMATION_LIST: automationList(model.manifest),
      UTILITY_COMMANDS: model.manifest.meta.utility_commands.map((/** @type {string} */ c) => `/${c}`).join(', '),
      MCP_LIST: model.mcpList.map((/** @type {string} */ n) => `- ${n}`).join('\n'),
      SCHEDULED_JOBS: scheduledJobsRows(model.schedule)
    },
    'getting-started'
  );
  return { rel: 'docs/GETTING-STARTED.md', content };
}

/**
 * docs/ARCHITECTURE.md, embedding the staged CLAUDE.md. Takes the model, as every gen* function does,
 * and reads nothing from it.
 * @param {Model} _model
 * @param {string} stagedClaudeMd
 */
function genArchitecture(_model, stagedClaudeMd) {
  const tpl = loadTemplate('architecture');
  const content = fill(
    tpl,
    {
      GENERATED_STAMP: stamp(),
      CLAUDE_MD_BODY: `${stagedClaudeMd.replace(/\s+$/, '')}\n`
    },
    'architecture'
  );
  return { rel: 'docs/ARCHITECTURE.md', content };
}

/**
 * docs/README.md, its welcome block carried over from the current file with both markers.
 * @param {Model} model
 */
function genReadme(model) {
  const target = path.join(REPO, 'docs', 'README.md');
  if (!fs.existsSync(target))
    throw new Error(
      'gen-docs: docs/README.md does not exist yet - hand-write it once with the CUSTOM_START/CUSTOM_END welcome block (D8), then regenerate'
    );
  const customZone = readRegion(fs.readFileSync(target, 'utf8'), PAIRS.CUSTOM_ZONE, CUSTOM_ZONE_MESSAGES);

  const tpl = loadTemplate('readme');
  const quickStart = fill(
    block(tpl, 'QUICK_START'),
    {
      AUTOMATION_COUNT: model.counts.automationCount,
      LIVE_COUNT: model.counts.liveCount
    },
    'readme QUICK_START'
  );
  const content = fill(
    block(tpl, 'PAGE'),
    {
      CUSTOM_ZONE: customZone,
      GENERATED_STAMP: stamp(),
      QUICK_START: quickStart.replace(/\s+$/, '')
    },
    'readme PAGE'
  );
  return { rel: 'docs/README.md', content };
}

/**
 * docs/projects/README.md with only its project-table region regenerated.
 * @param {Model} model
 */
function genProjectsReadme(model) {
  const target = path.join(REPO, 'docs', 'projects', 'README.md');
  if (!fs.existsSync(target)) throw new Error('gen-docs: docs/projects/README.md is missing');
  const current = fs.readFileSync(target, 'utf8');
  // The markers are judged before the table renders, so a broken document is named before any render error.
  assertOnePair(current, PAIRS.PROJECT_TABLE, PROJECT_TABLE_MESSAGES);
  const content = replaceRegion(
    current,
    PAIRS.PROJECT_TABLE,
    projectTableBlock(model.manifest),
    PROJECT_TABLE_MESSAGES
  );
  return { rel: 'docs/projects/README.md', content };
}

module.exports = { genGettingStarted, genArchitecture, genReadme, genProjectsReadme, scheduledJobsRows, needsStaging };
