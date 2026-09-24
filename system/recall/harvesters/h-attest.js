'use strict';
/* h-attest - facts from the escrow attestation + credential-age ledger. DATES AND STATES ONLY,
 * never a secret value (the ledger itself records pointers + dates, not secrets; facts.db is
 * gitignored + encrypted-backed-up regardless). This is the ST-20 escrow class: an "attested" claim
 * that flips to a stale/PENDING date same-night, so C21 can flag any doc still asserting the old one. */
const fs = require('fs');
const path = require('path');

function harvest({ REPO }) {
  const facts = [];

  // Escrow attestation (work/18-recovery-layer/state/passphrase-attested.txt, first line = yyyy-MM-dd or PENDING).
  const attf = path.join(REPO, 'work', '18-recovery-layer', 'state', 'passphrase-attested.txt');
  try {
    if (fs.existsSync(attf)) {
      const first = (fs.readFileSync(attf, 'utf8').split(/\r?\n/)[0] || '').trim();
      const dm = first.match(/\d{4}-\d{2}-\d{2}/);
      facts.push({ subject: 'escrow', predicate: 'attested', object: dm ? dm[0] : (first || 'unknown'),
        source: 'work/18-recovery-layer/state/passphrase-attested.txt', harvester: 'h-attest',
        aliases: ['escrow', 'passphrase', 'backup', 'attest', 'attestation'] });
    }
  } catch (_) { /* skip */ }

  // Credential rotation dates (system/credentials-ledger.json) - dates only, no values.
  const ledf = path.join(REPO, 'system', 'credentials-ledger.json');
  try {
    if (fs.existsSync(ledf)) {
      const led = JSON.parse(fs.readFileSync(ledf, 'utf8'));
      for (const c of led.credentials || []) {
        const rot = c.last_rotated;
        if (rot && /^\d{4}-\d{2}-\d{2}$/.test(String(rot))) {
          facts.push({ subject: `credential:${c.id}`, predicate: 'last_rotated', object: String(rot),
            source: 'system/credentials-ledger.json', harvester: 'h-attest', aliases: [c.id] });
        }
      }
    }
  } catch (_) { /* skip */ }

  return facts;
}

module.exports = { harvest };
