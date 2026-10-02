// @ts-check
// scripts/lib/gen-command-headers.js - the generated state-and-trigger header in scheduled command files.
//
// WHAT. A command file under .claude/commands/ tells the agent how to run one project. Its state and its
// trigger are registry facts, and a hand-written copy of them drifts from system/manifest.json with
// nothing to notice. So for every command of a LIVE or EVENT project, the header block between the
// ALEX:CMD-HEADER markers is generated from the registry, and V15 (lib/validate/shipped.js) warns, at
// generate and commit time, when the block drifts. ON-DEMAND, DORMANT, PARKED and RETIRED commands carry
// no schedule worth asserting and get no header.
//
// HOW. targets lists every command file that must carry a header, from projects[] and meta.unnumbered.
// block renders one header: the markers around three quoted lines, which name the project number (two
// digits, by render-templates' pad), the command, the state and the trigger, point at the registry, the
// work spec and the status page, and tell the reader not to restate a schedule. apply puts the block into
// a file's text: with both markers found, it replaces the first pair; with neither, it inserts the block
// after the first H1 line, or at the top when there is none. An unchanged registry renders the same
// bytes, so a second run changes nothing.
//
// NEVER. Parses the prose of a command file to compare it with the registry: the prose is replaced, never
// read. Writes into a file with one marker but not the other, or with its end marker first: it refuses,
// and a person looks first. Uses scripts/lib/markers.js: that module refuses a doubled pair and never
// inserts, while this one replaces the first pair and inserts a missing one, and the generator tests pin
// both. Writes a file: the caller stages the text it returns.
//
// Usage: module only - const { targets, block, apply } = require('./gen-command-headers');
'use strict';

const { pad } = require('./render-templates');

const BEGIN =
  '<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->';
const END = '<!-- ALEX:CMD-HEADER:END -->';
const HEADER_STATES = ['LIVE', 'EVENT'];

/**
 * @typedef {{ num?: number | null, state: string, trigger: string, commands?: string[], work_dir?: string,
 *   status_md?: string }} Project
 * @typedef {{ rel: string, command: string, project: Project }} Target
 */

/**
 * Every command file that must carry a header.
 * @param {{ projects: Project[], meta?: { unnumbered?: Project[] } }} manifest
 * @returns {Target[]}
 */
function targets(manifest) {
  const rows = [...manifest.projects, ...(manifest.meta?.unnumbered || [])];
  const out = [];
  for (const p of rows) {
    if (!HEADER_STATES.includes(p.state)) continue;
    for (const c of p.commands || []) out.push({ rel: `.claude/commands/${c}.md`, command: c, project: p });
  }
  return out;
}

/**
 * The header block for one command: the two markers around three quoted lines.
 * @param {{ command: string, project: Project }} target
 * @returns {string}
 */
function block({ command, project: p }) {
  const num = p.num != null ? `#${pad(p.num)} ` : '';
  const pointers = [
    'Registry: `system/manifest.json`',
    p.work_dir ? `Spec: \`${p.work_dir}/CLAUDE.md\`` : null,
    p.status_md ? `Status: \`${p.status_md}\`` : null
  ]
    .filter(Boolean)
    .join(' · ');
  return [
    BEGIN,
    `> **${num}/${command} · ${p.state} · Trigger: ${p.trigger}**`,
    `> ${pointers}`,
    '> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*',
    END
  ].join('\n');
}

/**
 * The file's text with its header block replaced, or inserted when the file has none.
 * @param {string} text
 * @param {Target} target
 * @returns {string}
 */
function apply(text, target) {
  const b = block(target);
  const bi = text.indexOf(BEGIN);
  const ei = text.indexOf(END);
  if (bi !== -1 && ei !== -1) {
    if (ei < bi) throw new Error(`gen-command-headers: ${target.rel} markers out of order (END before BEGIN)`);
    return text.slice(0, bi) + b + text.slice(ei + END.length);
  }
  if (bi !== -1 || ei !== -1)
    throw new Error(
      `gen-command-headers: ${target.rel} has one CMD-HEADER marker but not the other - a human must look before any tool writes`
    );
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1 === -1) return `${b}\n\n${text}`;
  lines.splice(h1 + 1, 0, '', b);
  return lines.join('\n');
}

module.exports = { targets, block, apply, BEGIN, END, HEADER_STATES };
