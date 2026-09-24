// gen-docs.js - renders the four human-facing documents (refactor P1-S3).
//   docs/GETTING-STARTED.md   from templates/getting-started.template.md (counts + lists from sources)
//   docs/ARCHITECTURE.md      from templates/architecture.template.md (embeds the STAGED CLAUDE.md)
//   docs/README.md            from templates/readme.template.md (preserving the ONE custom zone)
//   docs/projects/README.md   marked table region regenerated, prose around it preserved
// All prose lives in the templates (A4); this module only computes the data that fills the slots.
'use strict';
const fs = require('fs');
const path = require('path');
const { loadTemplate, block, fill } = require('./render-templates');
const { projectTableBlock } = require('./gen-routing-table');

const REPO = path.join(__dirname, '..', '..');
const CUSTOM_START = '<!-- CUSTOM_START -->';
const CUSTOM_END = '<!-- CUSTOM_END -->';
const PT_BEGIN_PREFIX = '<!-- PROJECT-TABLE:BEGIN';
const PT_END = '<!-- PROJECT-TABLE:END -->';

const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/\|/g, '\\|');

function stamp() { return new Date().toISOString().slice(0, 10); }

// Automation list for GETTING-STARTED: non-retired numbered projects, then unnumbered systems.
// RETIRED projects are excluded entirely (Phase 3 V3: nothing retired may appear as live).
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

// Scheduled-jobs rows for the table whose header lives in the template.
function scheduledJobsRows(schedule) {
  return schedule.entries
    .map(e => `| ${esc(e.name)} | ${esc(e.command || '-')} | ${esc(e.frequency || '-')} |`)
    .join('\n');
}

function genGettingStarted(model) {
  const tpl = loadTemplate('getting-started');
  const content = fill(tpl, {
    GENERATED_STAMP: stamp(),
    AUTOMATION_COUNT: model.counts.automationCount,
    AUTOMATION_LIST: automationList(model.manifest),
    UTILITY_COMMANDS: model.manifest.meta.utility_commands.map(c => `/${c}`).join(', '),
    MCP_LIST: model.mcpList.map(n => `- ${n}`).join('\n'),
    SCHEDULED_JOBS: scheduledJobsRows(model.schedule),
  }, 'getting-started');
  return { rel: 'docs/GETTING-STARTED.md', content };
}

// ARCHITECTURE embeds the STAGED CLAUDE.md body so the constitution shown is the one being shipped.
function genArchitecture(model, stagedClaudeMd) {
  const tpl = loadTemplate('architecture');
  const content = fill(tpl, {
    GENERATED_STAMP: stamp(),
    CLAUDE_MD_BODY: stagedClaudeMd.replace(/\s+$/, '') + '\n',
  }, 'architecture');
  return { rel: 'docs/ARCHITECTURE.md', content };
}

// docs/README.md: the ONE custom zone is read from the existing file and re-embedded verbatim
// (markers included). If the file or its zone is missing/duplicated, fail - a human writes the
// welcome block once; the generator never invents it.
function genReadme(model) {
  const target = path.join(REPO, 'docs', 'README.md');
  if (!fs.existsSync(target))
    throw new Error('gen-docs: docs/README.md does not exist yet - hand-write it once with the CUSTOM_START/CUSTOM_END welcome block (D8), then regenerate');
  const current = fs.readFileSync(target, 'utf8');
  const s = current.split(CUSTOM_START).length - 1;
  const e = current.split(CUSTOM_END).length - 1;
  if (s !== 1 || e !== 1)
    throw new Error(`gen-docs: docs/README.md must contain exactly one custom zone (found START=${s}, END=${e})`);
  const si = current.indexOf(CUSTOM_START);
  const ei = current.indexOf(CUSTOM_END);
  if (ei < si) throw new Error('gen-docs: docs/README.md custom-zone markers are out of order');
  const customZone = current.slice(si, ei + CUSTOM_END.length);

  const tpl = loadTemplate('readme');
  const quickStart = fill(block(tpl, 'QUICK_START'), {
    AUTOMATION_COUNT: model.counts.automationCount,
    LIVE_COUNT: model.counts.liveCount,
  }, 'readme QUICK_START');
  const content = fill(block(tpl, 'PAGE'), {
    CUSTOM_ZONE: customZone,
    GENERATED_STAMP: stamp(),
    QUICK_START: quickStart.replace(/\s+$/, ''),
  }, 'readme PAGE');
  return { rel: 'docs/README.md', content };
}

// docs/projects/README.md: regenerate ONLY the marked table region; hand prose around it stays.
function genProjectsReadme(model) {
  const target = path.join(REPO, 'docs', 'projects', 'README.md');
  if (!fs.existsSync(target)) throw new Error('gen-docs: docs/projects/README.md is missing');
  const current = fs.readFileSync(target, 'utf8');
  const b = current.split(PT_BEGIN_PREFIX).length - 1;
  const e = current.split(PT_END).length - 1;
  if (b !== 1 || e !== 1)
    throw new Error(`gen-docs: docs/projects/README.md must contain exactly one PROJECT-TABLE BEGIN and END marker (found BEGIN=${b}, END=${e})`);
  const bi = current.indexOf(PT_BEGIN_PREFIX);
  const ei = current.indexOf(PT_END);
  if (ei < bi) throw new Error('gen-docs: docs/projects/README.md markers are out of order');
  const content = current.slice(0, bi) + projectTableBlock(model.manifest).replace(/\s+$/, '') + current.slice(ei + PT_END.length);
  return { rel: 'docs/projects/README.md', content };
}

module.exports = { genGettingStarted, genArchitecture, genReadme, genProjectsReadme, automationList, scheduledJobsRows };
