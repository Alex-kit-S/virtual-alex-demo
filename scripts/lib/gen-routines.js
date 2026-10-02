// @ts-check
// scripts/lib/gen-routines.js - renders the Virtual Alex scheduling pages from the registry's routines[].
//
// WHAT. Online there is no scheduler on a machine: a Routine is a saved form on the owner's claude.ai
// account, filled in by a person reading a page. This module renders the two pages that person reads from
// the routines[] rows of system/manifest.json: the marked ROUTINES region of the online schedule
// (variants/online/scheduler/schedule.md: one table, the stagger rule, the note that every time is the
// owner's local zone), and docs/ROUTINES-FORMS.md, which gives each Routine the exact field values to type
// into the form, on a phone if that is what the owner has. The rows are also the contract the weekly
// sweep (work/18-recovery-layer/check.mjs) reads back against the run log, so a form typed from this page
// is a schedule with a source that is checked.
//
// HOW. routineRows validates every row and is the parse contract scripts/validate-alex.js V19 shares, so
// the generator and the validator cannot disagree about what a row must carry; it refuses at the first
// problem, naming the row and the field. scheduleSection builds the region, markers included, from the
// ROUTINES pair in markers.js, and genOnlineSchedule reads the hand-written online schedule from the
// repository root and replaces its one region, refusing a missing, doubled or reversed pair in this
// module's own words. regenerateRegion is that replacement for a schedule text the caller holds: the
// generator calls it directly in an online tree, where the schedule sits at scheduler/schedule.md.
// genRoutinesForms builds the forms page. A table cell has its pipes escaped with render-templates' esc.
// The stagger rule, the sweep note and the closing "After the five exist" section are fixed prose,
// printed whatever the rows hold, and the online schedule is read at its fixed path, so a tree without
// that file refuses; the generator tests pin both as they are.
//
// NEVER. Writes a file: each renderer returns { rel, content } and the generator stages it. Fills in a
// field a row lacks, or keeps a field the row shape does not name: either refuses. Rewrites the online
// schedule when its region markers are missing, doubled or reversed, because a person has to look first.
//
// Usage: module only - const { routineRows, regenerateRegion, genOnlineSchedule, genRoutinesForms } = require('./gen-routines');
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REPO } = require('./repo-root');
const { PAIRS, replaceRegion } = require('./markers');
const { esc } = require('./render-templates');

/**
 * One routines[] row, as routineRows returns it.
 * @typedef {object} Routine
 * @property {string} name
 * @property {string} prompt_file
 * @property {string} preset daily, weekdays or weekly
 * @property {string} time_local
 * @property {number} cadence_hours
 * @property {string} environment Routine or Armed
 * @property {string[]} connectors
 * @property {string} repositories owner or owner+mirror
 * @property {string} model
 * @property {string} first_run_check
 */

const ROUTINES_DIR = 'scheduler/routines';
const ONLINE_SCHEDULE_REL = 'variants/online/scheduler/schedule.md';
const FORMS_REL = 'docs/ROUTINES-FORMS.md';
const ROUTINES = PAIRS.ROUTINES;
const PRESETS = ['daily', 'weekdays', 'weekly'];
const ENVIRONMENTS = ['Routine', 'Armed'];
const REPOSITORIES = ['owner', 'owner+mirror'];
const FIELDS = [
  'cadence_hours',
  'connectors',
  'environment',
  'first_run_check',
  'model',
  'name',
  'preset',
  'prompt_file',
  'repositories',
  'time_local'
];

/**
 * The region refusals for a schedule file, in the words scripts/tests/test-generator-libs-contract.mjs pins.
 * @param {string} label the schedule's path as the refusal names it
 * @returns {import('./markers').Messages}
 */
function regionMessages(label) {
  return {
    count: (found) =>
      `gen-routines: ${label} must contain exactly one ROUTINES BEGIN and END marker (found BEGIN=${found.begin}, END=${found.end})`,
    order: `gen-routines: ${label} markers are out of order (END before BEGIN)`
  };
}

/**
 * A schedule's text with its ROUTINES region replaced by block. The generator entry calls it for the
 * schedule an online tree carries at its own path.
 * @param {string} text the whole schedule file
 * @param {string} block the rendered region, both markers included
 * @param {string} label the schedule's path, for the refusals
 * @returns {string}
 */
function regenerateRegion(text, block, label) {
  return replaceRegion(text, ROUTINES, block, regionMessages(label));
}

/**
 * Every routines[] row, validated, or a refusal naming the row and the field. Never a guess.
 * @param {any} manifest the parsed system/manifest.json
 * @returns {Routine[]}
 */
function routineRows(manifest) {
  // A manifest with no routines[] has no Routines. The ternary keeps a null or other falsy manifest on
  // the array refusal below, which an optional chain would turn into none.
  const rows = manifest ? manifest.routines : manifest;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw new Error('system/manifest.json routines must be an array');
  const seen = new Set();
  /** @type {Routine[]} */
  const out = [];
  rows.forEach((r, i) => {
    const where = `routines[${i}]${r?.name ? ` (${r.name})` : ''}`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`${where}: not an object`);
    for (const k of FIELDS) if (!(k in r)) throw new Error(`${where}: missing field ${k}`);
    for (const k of Object.keys(r))
      if (!FIELDS.includes(k)) throw new Error(`${where}: unknown field ${k} (the row shape is ${FIELDS.join(', ')})`);
    if (typeof r.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(r.name))
      throw new Error(`${where}: name must be a lowercase job name (got ${JSON.stringify(r.name)})`);
    if (seen.has(r.name)) throw new Error(`${where}: duplicate name ${r.name}`);
    seen.add(r.name);
    if (
      typeof r.prompt_file !== 'string' ||
      !r.prompt_file.startsWith(`${ROUTINES_DIR}/`) ||
      !r.prompt_file.endsWith('.md')
    )
      throw new Error(
        `${where}: prompt_file must be a .md file under ${ROUTINES_DIR}/ (got ${JSON.stringify(r.prompt_file)})`
      );
    if (!PRESETS.includes(r.preset))
      throw new Error(`${where}: preset must be one of ${PRESETS.join(' | ')} (got ${JSON.stringify(r.preset)})`);
    if (
      typeof r.time_local !== 'string' ||
      !/^(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) )?[0-2]\d:[0-5]\d$/.test(r.time_local)
    )
      throw new Error(
        `${where}: time_local must be HH:MM, with a weekday in front for a weekly preset (got ${JSON.stringify(r.time_local)})`
      );
    if ((r.preset === 'weekly') !== /^[A-Z]/.test(r.time_local))
      throw new Error(
        `${where}: a weekly preset names its weekday in time_local, a daily or weekdays preset does not (got ${JSON.stringify(r.time_local)})`
      );
    if (!(Number.isInteger(r.cadence_hours) && r.cadence_hours > 0))
      throw new Error(`${where}: cadence_hours must be a positive integer (got ${JSON.stringify(r.cadence_hours)})`);
    if (!ENVIRONMENTS.includes(r.environment))
      throw new Error(
        `${where}: environment must be one of ${ENVIRONMENTS.join(' | ')} (got ${JSON.stringify(r.environment)})`
      );
    if (!Array.isArray(r.connectors) || r.connectors.some((/** @type {unknown} */ c) => typeof c !== 'string' || !c))
      throw new Error(`${where}: connectors must be an array of connector names (the list to KEEP; [] = none)`);
    if (!REPOSITORIES.includes(r.repositories))
      throw new Error(
        `${where}: repositories must be one of ${REPOSITORIES.join(' | ')} (got ${JSON.stringify(r.repositories)})`
      );
    if (typeof r.model !== 'string' || !r.model) throw new Error(`${where}: model must be a model id`);
    if (typeof r.first_run_check !== 'string' || !r.first_run_check.trim())
      throw new Error(`${where}: first_run_check must be one line`);
    if (/\r|\n/.test(r.first_run_check)) throw new Error(`${where}: first_run_check must be ONE line`);
    out.push(r);
  });
  return out;
}

/** @param {Routine} r */
const formName = (r) => `alex-${r.name}`;
/** @param {Routine} r */
const promptLine = (r) => `Read \`${r.prompt_file}\` and carry it out exactly.`;
/** @param {Routine} r */
const whenText = (r) => (r.preset === 'weekly' ? `weekly, ${r.time_local}` : `${r.preset}, ${r.time_local}`);
/** @param {Routine} r */
const reposText = (r) =>
  r.repositories === 'owner+mirror'
    ? 'your Alex repository AND your backup repository (both attached)'
    : 'your Alex repository only';
/** @param {Routine} r */
const connectorsText = (r) => (r.connectors.length ? r.connectors.join(', ') : 'none');
/** @param {Routine} r */
const runsPerWeek = (r) => (r.preset === 'daily' ? 7 : r.preset === 'weekdays' ? 5 : 1);

/**
 * The online schedule's ROUTINES region, both markers included.
 * @param {Routine[]} rows
 * @returns {string}
 */
function scheduleSection(rows) {
  const lines = [];
  lines.push(
    `${ROUTINES.begin} (generated from system/manifest.json routines[] by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->`
  );
  lines.push(
    '| Routine (form name) | Job (run-log row) | When (your local time) | Repositories | Environment | Connectors kept | Prompt file | Runs a week |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  let total = 0;
  for (const r of rows) {
    total += runsPerWeek(r);
    lines.push(
      `| \`${formName(r)}\` | \`${r.name}\` | ${esc(whenText(r))} | ${esc(reposText(r))} | ${r.environment} | ${esc(connectorsText(r))} | \`${r.prompt_file}\` | ${runsPerWeek(r)} |`
    );
  }
  lines.push('');
  lines.push(
    `${total} runs a week, every one of them token-bearing on the owner's subscription. Create them in the order of the table (the snapshot first, so the backup exists before anything else runs).`
  );
  lines.push('');
  lines.push(
    "**The stagger rule.** Never two Routines in the same hour, and every one of them outside the owner's waking hours. The platform adds its own start offset of a few minutes, consistent per Routine; the hour spacing above absorbs it. Two writers are not a lock problem online but a merge problem: the first push wins, the loser rebases in its Stop hook, and the append-only files union-merge. Hour spacing is defence in depth, not the mechanism."
  );
  lines.push('');
  lines.push(
    "**Times are the owner's local zone.** The form takes the time in the zone the owner is in when they create the Routine, and stores it; travelling afterwards changes nothing. The date every run writes into its row is UTC."
  );
  lines.push('');
  lines.push(
    '**Every row is the contract the weekly sweep reads back.** `work/18-recovery-layer/check.mjs` ambers a Routine with no run-log row inside its `cadence_hours` plus six hours of grace, and a row whose `model` is not the registry default. `brief` carries 72 hours rather than 24 because the weekday preset skips the weekend and the Sunday sweep would otherwise amber it every week.'
  );
  lines.push(ROUTINES.end);
  return lines.join('\n');
}

/**
 * The online schedule with its ROUTINES region rendered from the rows.
 * @param {{ manifest: any }} model
 * @returns {{ rel: string, content: string }}
 */
function genOnlineSchedule(model) {
  const rows = routineRows(model.manifest);
  const abs = path.join(REPO, ONLINE_SCHEDULE_REL);
  if (!fs.existsSync(abs))
    throw new Error(
      `gen-routines: ${ONLINE_SCHEDULE_REL} is missing; the hand-written variant carries the markers this renderer fills`
    );
  const current = fs.readFileSync(abs, 'utf8');
  return {
    rel: ONLINE_SCHEDULE_REL,
    content: regenerateRegion(current, scheduleSection(rows), ONLINE_SCHEDULE_REL)
  };
}

/**
 * docs/ROUTINES-FORMS.md: per Routine, the field values to type into the claude.ai form.
 * @param {{ manifest: any }} model
 * @returns {{ rel: string, content: string }}
 */
function genRoutinesForms(model) {
  const rows = routineRows(model.manifest);
  const def = model.manifest.meta?.model_routing?.default;
  const out = [];
  out.push('# The Routine forms (Virtual Alex)');
  out.push('');
  out.push(
    '<!-- GENERATED from system/manifest.json routines[] by scripts/generate-alex.js (scripts/lib/gen-routines.js). Edit the registry, then regenerate; do NOT hand-edit. -->'
  );
  out.push('');
  out.push(
    'This page is what you type into the claude.ai routine form, one Routine at a time, on a phone if that is what you have. Open `claude.ai/code/routines`, tap New routine, and copy each field from the table below. Do them in this order: the snapshot first, so a backup exists before anything else runs.'
  );
  out.push('');
  out.push('Three things the form defaults to that you change every time:');
  out.push('');
  out.push(
    '- **Connectors.** The form includes every connector on your account by default, with write access and no approval during a run. Each table names the connectors to KEEP; remove every other connector.'
  );
  out.push(
    '- **Environment.** Pick the one named. `Routine` and `Armed` are the two cloud environments you created on day one; `Default` is for you, never for a Routine.'
  );
  out.push(
    '- **Repositories.** Attach exactly what the table says. Every Routine but the snapshot runs on your Alex repository alone; a second repository in the session switches every hook off.'
  );
  out.push('');
  out.push(
    `The model is the registry default (\`${def || rows[0]?.model}\`); pick it in the form's model selector. The weekly sweep ambers a run that reports a different model.`
  );
  out.push('');
  out.push(
    'The prompt is always one line pointing at a committed file. The file is the order; changing a job later is a commit, never a form edit.'
  );
  out.push('');
  rows.forEach((r, i) => {
    out.push(`## ${i + 1}. ${formName(r)}`);
    out.push('');
    out.push('| Field | Type this |');
    out.push('|---|---|');
    out.push(`| Name | \`${formName(r)}\` |`);
    out.push(`| Prompt | ${esc(promptLine(r))} |`);
    out.push(`| Model | \`${r.model}\` |`);
    out.push(`| Schedule | ${esc(whenText(r))}, your local time (preset: ${r.preset}) |`);
    out.push(`| Repositories | ${esc(reposText(r))} |`);
    out.push(`| Environment | ${r.environment} |`);
    out.push(`| Connectors to KEEP | ${esc(connectorsText(r))}; remove every other connector |`);
    out.push(`| First-run check | ${esc(r.first_run_check)} |`);
    out.push('');
  });
  out.push('## After the five exist');
  out.push('');
  out.push(
    "Tap Run now on the snapshot and do its first-run check before creating the rest. Then read the next morning's brief in the app: it opens with every Routine that did not finish COMPLETE, and `/alex-status` in any session prints the newest row per job from `system/run-log.jsonl`. A green tick in the routine list means only that a session started and ended without an infrastructure error; the row is the verdict."
  );
  out.push('');
  out.push(
    'Switching a Routine off is the on/off toggle on the routines page; nothing is lost while it is off, and the next run opens with how many it missed.'
  );
  out.push('');
  return { rel: FORMS_REL, content: out.join('\n') };
}

module.exports = {
  routineRows,
  scheduleSection,
  regenerateRegion,
  genOnlineSchedule,
  genRoutinesForms,
  ROUTINES_DIR,
  ONLINE_SCHEDULE_REL
};
