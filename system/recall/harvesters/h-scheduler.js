'use strict';
/* h-scheduler - facts from the LIVE Windows Task Scheduler (the same ground truth C7 diffs against),
 * via the native `schtasks` binary. Zero-token, no new API. Emits the registered Alex-* job
 * count + each job's live state (Ready/Disabled/Running). Ephemeral retry one-shots are excluded
 * (they come and go by design, like C7). If schtasks is unavailable, the harvester emits nothing and
 * harvest-core logs the miss - a partial harvest never poisons the ledger. */
const { execFileSync } = require('child_process');

function harvest() {
  let out;
  try {
    out = execFileSync('schtasks', ['/query', '/fo', 'CSV', '/nh'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  } catch (_) {
    return []; // schtasks absent/failed (non-Windows restore, permissions) - skip cleanly.
  }
  const facts = [];
  const jobs = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // CSV rows: "TaskName","Next Run Time","Status"
    const cells = line.match(/"([^"]*)"/g);
    if (!cells || cells.length < 3) continue;
    const name = cells[0].replace(/"/g, '').replace(/^\\/, '');
    const status = cells[2].replace(/"/g, '');
    if (!name.startsWith('Alex-') || name.startsWith('Alex-retry-')) continue;
    jobs.push(name);
    facts.push({ subject: `job:${name}`, predicate: 'state', object: status, source: 'schtasks /query', harvester: 'h-scheduler', aliases: [name.toLowerCase()] });
  }
  facts.push({ subject: 'scheduler', predicate: 'registered_job_count', object: String(new Set(jobs).size), source: 'schtasks /query', harvester: 'h-scheduler', aliases: ['scheduler', 'schedule', 'cron', 'jobs'] });
  return facts;
}

module.exports = { harvest };
