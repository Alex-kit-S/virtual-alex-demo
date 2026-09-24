'use strict';
/* h-manifest - facts from system/manifest.json: the desired-state registry.
 * Emits project states, the model-routing contract, repo visibility, and registry counts.
 * Source of truth for FR-04/FR-07 doc-drift detection: a doc claiming a state/model/count the
 * manifest disproves is caught by C21 against these rows. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const src = path.join(REPO, 'system', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(src, 'utf8'));
  const facts = [];
  const push = (subject, predicate, object, aliases = []) =>
    facts.push({ subject, predicate, object, source: 'system/manifest.json', harvester: 'h-manifest', aliases });

  const projects = m.projects || [];
  for (const p of projects) {
    const subj = `project:${p.name}`;
    const aliases = [p.name, ...(p.commands || [])];
    push(subj, 'state', p.state, aliases);
    if (p.n8n) push(subj, 'n8n_id', p.n8n, aliases);
    if (p.cadence && p.cadence.label) push(subj, 'cadence_label', p.cadence.label, aliases);
  }

  // Registry-level counts - the FR-07 "count histories that cannot reconcile" class. Now a timestamped row.
  const nonRetired = projects.filter((p) => String(p.state).toUpperCase() !== 'RETIRED').length;
  push('registry', 'project_count_non_retired', String(nonRetired));
  push('registry', 'project_count_total', String(projects.length));
  const jobs = new Set();
  for (const p of projects) for (const j of p.schedule_jobs || []) jobs.add(j);
  push('registry', 'schedule_jobs_count', String(jobs.size));

  // Repo visibility (the .gitignore-is-the-only-barrier fact).
  if (m.meta && m.meta.repo_visibility) push('repo', 'visibility', m.meta.repo_visibility);

  // Model-routing contract (V6 reads live n8n against this; C21 reads PROSE against this).
  const mr = m.meta && m.meta.model_routing;
  if (mr) {
    if (mr.default) push('model-routing', 'default', mr.default, ['model', 'routing', 'sonnet', 'opus']);
    for (const o of mr.overrides || []) {
      push(`model-routing`, `override:${o.workflow}`, o.model, ['model', o.name || '']);
      push(`engine:${o.workflow}`, 'model', o.model, [o.name || '']);
    }
  }
  return facts;
}

module.exports = { harvest };
