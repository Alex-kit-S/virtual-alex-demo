// @ts-check
// scripts/lib/gen-routing-table.js - the rows of the two project tables, rendered from the registry.
//
// WHAT. Turns system/manifest.json into the routing table in CLAUDE.md (# | Command | State | Trigger |
// One line | Spec + status) and the project table in docs/projects/README.md (# | Project | State | One
// line), each as a complete block with its markers and header row, ready for a marked region.
//
// HOW. routingRows and projectRows write one line per numbered project in registry order, then one per
// entry of meta.unnumbered. A number is padded to two digits; a trigger and a one-liner have their pipes
// escaped. A retired project's commands are struck through, a revisit date follows its state, and a
// project with no command reads "(no command)". claudeRegionBlock and projectTableBlock fill the
// CLAUDE_REGION and PROJECT_TABLE blocks of templates/routing-table.template.md, which carry the markers
// and the header row.
//
// NEVER. Changes the shape of a routing row: the recovery sweep's C5 (work/18-recovery-layer/check.ps1)
// finds a project by "| NN |" and its work folder on one row, so the columns, the padding and the
// spacing are a contract. Escapes a title, which the generator tests pin as it is. Writes a file: the
// caller places the block.
//
// Usage: module only - const { claudeRegionBlock, projectTableBlock } = require('./gen-routing-table');
'use strict';

const { loadTemplate, block, fill, pad, esc } = require('./render-templates');

/**
 * @typedef {{ num: number, title: string, commands?: string[], state: string, revisit?: string | null,
 *   trigger: string, one_liner: string, work_dir: string, status_md: string, docs: string }} Project
 * @typedef {{ title: string, state: string, revisit?: string | null, trigger: string, one_liner: string,
 *   spec?: string, status_md?: string, docs: string }} Unnumbered
 * @typedef {{ projects: Project[], meta: { unnumbered: Unnumbered[] } }} Registry
 */

/**
 * The CLAUDE.md routing rows: | # | Command | State | Trigger | One line | Spec + status |
 * @param {Registry} manifest
 * @returns {string}
 */
function routingRows(manifest) {
  const rows = [];
  for (const p of manifest.projects) {
    let cmd = p.commands && p.commands.length > 0 ? p.commands.map((c) => `/${c}`).join(' + ') : '(no command)';
    if (p.state === 'RETIRED') cmd = `~~${cmd}~~`;
    let state = p.state;
    if (p.revisit) state += ` (revisit ${p.revisit})`;
    rows.push(
      `| ${pad(p.num)} | ${cmd} | ${state} | ${esc(p.trigger)} | ${esc(p.one_liner)} | ${p.work_dir} - ${p.status_md} |`
    );
  }
  for (const u of manifest.meta.unnumbered) {
    let state = u.state;
    if (u.revisit) state += ` (revisit ${u.revisit})`;
    const specStatus = [u.spec, u.status_md].filter(Boolean)[0] || '-';
    rows.push(`| - | ${u.title} | ${state} | ${esc(u.trigger)} | ${esc(u.one_liner)} | ${specStatus} |`);
  }
  return rows.join('\n');
}

/**
 * The docs/projects/README.md rows: | # | Project | State | One line |
 * @param {Registry} manifest
 * @returns {string}
 */
function projectRows(manifest) {
  const rows = [];
  for (const p of manifest.projects)
    rows.push(`| ${pad(p.num)} | [${p.title}](${p.docs}) | ${p.state} | ${esc(p.one_liner)} |`);
  for (const u of manifest.meta.unnumbered)
    rows.push(`| - | [${u.title}](${u.docs}) | ${u.state} | ${esc(u.one_liner)} |`);
  return rows.join('\n');
}

/**
 * The routing region for CLAUDE.md, both markers and the header row included.
 * @param {Registry} manifest
 */
function claudeRegionBlock(manifest) {
  const tpl = loadTemplate('routing-table');
  return fill(block(tpl, 'CLAUDE_REGION'), { ROUTING_ROWS: routingRows(manifest) }, 'routing-table CLAUDE_REGION');
}

/**
 * The project table for docs/projects/README.md, both markers and the header row included.
 * @param {Registry} manifest
 */
function projectTableBlock(manifest) {
  const tpl = loadTemplate('routing-table');
  return fill(block(tpl, 'PROJECT_TABLE'), { PROJECT_ROWS: projectRows(manifest) }, 'routing-table PROJECT_TABLE');
}

module.exports = { routingRows, projectRows, claudeRegionBlock, projectTableBlock };
