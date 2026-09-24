// gen-routing-table.js - system/manifest.json -> routing rows (refactor P1-S3).
// Absorbs the row logic of scripts/generate-surfaces.ps1 verbatim: same columns, same padding,
// same RETIRED strikethrough, same revisit suffix, same unnumbered handling. The recovery
// checker's C5 check pattern-matches these rows ("| NN |" + work_dir), so the shape is a contract.
'use strict';
const { loadTemplate, block, fill } = require('./render-templates');

const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/\|/g, '\\|');

// CLAUDE.md routing region rows: | # | Command | State | Trigger | One line | Spec + status |
function routingRows(manifest) {
  const rows = [];
  for (const p of manifest.projects) {
    let cmd = (p.commands && p.commands.length > 0) ? p.commands.map(c => `/${c}`).join(' + ') : '(no command)';
    if (p.state === 'RETIRED') cmd = `~~${cmd}~~`;
    let state = p.state;
    if (p.revisit) state += ` (revisit ${p.revisit})`;
    rows.push(`| ${pad(p.num)} | ${cmd} | ${state} | ${esc(p.trigger)} | ${esc(p.one_liner)} | ${p.work_dir} - ${p.status_md} |`);
  }
  for (const u of manifest.meta.unnumbered) {
    let state = u.state;
    if (u.revisit) state += ` (revisit ${u.revisit})`;
    const specStatus = [u.spec, u.status_md].filter(Boolean)[0] || '-';
    rows.push(`| - | ${u.title} | ${state} | ${esc(u.trigger)} | ${esc(u.one_liner)} | ${specStatus} |`);
  }
  return rows.join('\n');
}

// docs/projects/README.md rows: | # | Project | State | One line |
function projectRows(manifest) {
  const rows = [];
  for (const p of manifest.projects)
    rows.push(`| ${pad(p.num)} | [${p.title}](${p.docs}) | ${p.state} | ${esc(p.one_liner)} |`);
  for (const u of manifest.meta.unnumbered)
    rows.push(`| - | [${u.title}](${u.docs}) | ${u.state} | ${esc(u.one_liner)} |`);
  return rows.join('\n');
}

// The two complete marked blocks (markers + header + rows), from routing-table.template.md.
function claudeRegionBlock(manifest) {
  const tpl = loadTemplate('routing-table');
  return fill(block(tpl, 'CLAUDE_REGION'), { ROUTING_ROWS: routingRows(manifest) }, 'routing-table CLAUDE_REGION');
}

function projectTableBlock(manifest) {
  const tpl = loadTemplate('routing-table');
  return fill(block(tpl, 'PROJECT_TABLE'), { PROJECT_ROWS: projectRows(manifest) }, 'routing-table PROJECT_TABLE');
}

module.exports = { routingRows, projectRows, claudeRegionBlock, projectTableBlock };
