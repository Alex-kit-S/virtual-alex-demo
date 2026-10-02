// scripts/tests/fixtures/validate-v13-pre-drop.cjs - stands in for scripts/validate-alex.js as it was
// before V13 learned the kit-manifest drop rule, cut down to the one leg the drop test needs.
//
// WHAT. The negative control of scripts/tests/test-validate-v13-drop.mjs (its N0). On an online-shaped
// tree the scheduled wrappers are absent by design, and the validator before the drop rule failed V13
// once for every pinned wrapper there. This file gives that same failure from the same inputs, so the
// test can prove its copy really is online-shaped without reading this repository's git history, which
// a shallow CI checkout does not have.
//
// HOW. The test copies this file over scripts/validate-alex.js in a throwaway tree and runs it there, so
// the tree is the parent of this file's folder, as it is for the validator. It reads
// system/manifest.json (meta.model_routing.local_wrappers) and the wrapper names in scripts/
// (run-*.ps1 and auth-check.ps1), then applies the rules V13 used before it learned the kit-manifest
// drop rule: a pin naming a wrapper that is not on disk FAILS, and a deterministic_no_pin entry naming
// one that is not on disk WARNS. There is no kit-manifest lookup; that absence is the point of the file.
// Warnings go to stderr first, then failures, one per line, as the validator prints them.
//
// NEVER. It is not a validator and checks nothing else, so it is never run as one. It never reads git,
// the network, or any file outside the tree it sits in.
//
// Usage: node <tree>/scripts/validate-alex.js [any arguments, ignored]   (after the test copies it there)
// Exit: 0 every pinned wrapper is on disk - 1 at least one FAILED V13 line

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const isWrapper = (name) => /^run-.*\.ps1$/.test(name) || name === 'auth-check.ps1';

function v13AbsentFiles() {
  const failures = [];
  const warnings = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const lw = manifest.meta?.model_routing?.local_wrappers;
  if (!lw?.pins) {
    warnings.push('WARNING V13: system/manifest.json meta.model_routing.local_wrappers.pins is not set');
    return { failures, warnings };
  }
  const files = fs.readdirSync(path.join(REPO, 'scripts')).filter(isWrapper);
  for (const name of Object.keys(lw.pins)) {
    if (!files.includes(name))
      failures.push(`FAILED V13: local_wrappers.pins names scripts/${name} which does not exist`);
  }
  for (const name of lw.deterministic_no_pin || []) {
    if (!files.includes(name))
      warnings.push(`WARNING V13: local_wrappers.deterministic_no_pin names scripts/${name} which does not exist`);
  }
  return { failures, warnings };
}

const { failures, warnings } = v13AbsentFiles();
for (const line of [...warnings, ...failures]) console.error(line);
process.exitCode = failures.length ? 1 : 0;
