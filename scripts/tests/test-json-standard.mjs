#!/usr/bin/env node
// @ts-check
// scripts/tests/test-json-standard.mjs - the JSON standard's two guards, the audit and V21.
//
// WHAT. Tests scripts/json-standard-audit.js (the per-file table, and the --enforced ratchet CI runs) and
// validate-alex V21 (the same ratchet as a commit-gate leg), every refusal shown before the pass, because a
// guard that has never failed is indistinguishable from one that cannot. It also holds that every enforced
// path is pinned text eol=lf in .gitattributes, since a CRLF checkout of one fails V21 on a commit that did
// nothing wrong. Deleted, it would let the audit call a missing or empty root clean, let --enforced pass
// with no contract or block on the unmigrated backlog, let a raw writer of an enforced file pass (written
// on two lines, through fs.promises, through a stream, or from an ES module), let V21 stop failing an
// enforced file that is broken, vanished or off a removed list, and let an enforced path lose its pin.
//
// HOW. The audit runs against throwaway fixture trees under the OS temp folder, so it never reads this
// checkout's backlog. V21 runs as the REAL validator against this checkout with a --staged preview folder
// carrying one mutated file at a time, so nothing tracked is edited. V3, the one leg that needs a tracked
// file GONE, deletes it in a throwaway clone carrying this checkout's current validator, audit and helper.
// Every real-validator spawn loads the shared scheduler stub (scripts/tests/fixtures/scheduler-stub.cjs, -r,
// before any Kit code) with C4_LIVE empty, so V2's live half answers zero registered jobs and can only ever
// print a WARNING; no assertion below reads a V2 line (only V21's).
//
// NEVER. Writes into the checkout. V3 once set the tracked file aside in place and relied on a finally to
// put it back, so a run killed between the two left the checkout without it; the clone is why. Reaches the
// real Task Scheduler: every real-validator run here loads the shared scheduler stub before any Kit code,
// which answers schtasks itself, so the call never falls through to the machine's.
//
// Usage: node scripts/tests/test-json-standard.mjs
// Exit: 0 every check passed - 1 a check failed

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIT = path.join(KIT, 'scripts', 'json-standard-audit.js');
const VALIDATOR = path.join(KIT, 'scripts', 'validate-alex.js');
const SCHED_STUB = path.join(KIT, 'scripts', 'tests', 'fixtures', 'scheduler-stub.cjs');
const require = createRequire(import.meta.url);
const { writeJson, canonicalText } = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const audit = require(AUDIT);
const { isRemoteDrift } = require(VALIDATOR);

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-json-standard-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const META = {
  purpose: 'A fixture file for the JSON standard test.',
  writer: 'scripts/tests/test-json-standard.mjs',
  schema: 'json-standard-test@1'
};
/** @typedef {{ files: { path: string, findings: string[], canonical: boolean }[] }} AuditJson the parts of --json read here */

/**
 * The real audit, run as a child process.
 * @param {string[]} args
 */
function runAudit(args) {
  return spawnSync(process.execPath, [AUDIT, ...args], { encoding: 'utf8' });
}
/**
 * A fixture tree: one conforming file written by the helper, one hand-written file breaking rules 1, 2
 * and 6, and (optionally) a contract listing the enforced paths.
 * @param {string} name
 * @param {{ contract?: string[] }} [options]
 */
function fixture(name, { contract } = {}) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'tests'), { recursive: true });
  // the _writer claim is checked against the fixture root, so the named script must exist there
  fs.writeFileSync(path.join(root, 'scripts', 'tests', 'test-json-standard.mjs'), '// fixture\n');
  writeJson(path.join(root, 'system', 'good.json'), { alpha: 1, beta: 'two' }, META);
  fs.writeFileSync(path.join(root, 'system', 'bad.json'), '\uFEFF{\r\n  "zeta": 1,\r\n  "alpha": 2\r\n}');
  if (contract) {
    fs.writeFileSync(
      path.join(root, 'system', 'kit-manifest.json'),
      JSON.stringify({ components: [], json_standard: { doc: 'docs/json-standard.md', enforced: contract } }, null, 2) +
        '\n'
    );
  }
  return root;
}

describe('A. the audit, whole picture', () => {
  test('A1-A2 a fixture tree, one conforming file and one broken one', () => {
    const root = fixture('a-whole');
    const r = runAudit(['--root', root, '--json']);
    /** @type {AuditJson | null} */
    let j = null;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      /* reported below */
    }
    const good = j?.files.find((f) => f.path === 'system/good.json');
    const bad = j?.files.find((f) => f.path === 'system/bad.json');
    assert.equal(r.status, 2, `A1 NEGATIVE a tree with a broken file exits 2 in whole-picture mode - exit ${r.status}`);
    assert.ok(
      bad?.findings.some((f) => f === 'rule 1: BOM') &&
        bad.findings.some((f) => /CRLF/.test(f)) &&
        bad.findings.some((f) => /header missing/.test(f)) &&
        bad.findings.some((f) => /rule 6/.test(f)),
      `A1 NEGATIVE the broken file is named with rules 1, 2 and 6 - ${bad ? bad.findings.join(' | ') : 'no row'}`
    );
    assert.ok(
      good && good.findings.length === 0 && good.canonical === true,
      'A2 a file the helper wrote is canonical with no findings'
    );
  });

  test('A3 a root that does not exist, and an empty tree', () => {
    const r = runAudit(['--root', path.join(TMP, 'does-not-exist')]);
    assert.ok(
      r.status === 1 && /no in-scope JSON/.test(r.stderr),
      `A3 NEGATIVE a root that does not exist is exit 1, never a clean 0 - exit ${r.status}`
    );
    const empty = path.join(TMP, 'empty');
    fs.mkdirSync(empty);
    const r2 = runAudit(['--root', empty]);
    assert.equal(r2.status, 1, `A3 NEGATIVE an empty tree is exit 1, never a clean 0 - exit ${r2.status}`);
  });

  test('A4 a dangling value flag and an unknown flag each refuse with one line, never a stack', () => {
    const r = runAudit(['--root']);
    assert.equal(r.stdout, '', 'A4 NEGATIVE a dangling --root printed a report');
    assert.ok(
      r.stderr.startsWith('json-standard-audit: REFUSED -') && !r.stderr.includes('TypeError'),
      `A4 NEGATIVE a dangling --root raised a stack instead of a refusal - ${r.stderr}`
    );
    assert.equal(r.status, 1, `A4 NEGATIVE a dangling --root is anything but exit 1 - exit ${r.status}`);
    const r2 = runAudit(['--bogus']);
    assert.ok(
      r2.stderr.startsWith('json-standard-audit: REFUSED -') && r2.stderr.includes('--bogus'),
      `A4 NEGATIVE an unknown flag did not refuse by name - ${r2.stderr}`
    );
    assert.equal(r2.status, 1, `A4 NEGATIVE an unknown flag is anything but exit 1 - exit ${r2.status}`);
  });

  test('A5 an empty --root value refuses the same way a dangling one does', () => {
    const r = runAudit(['--root', '']);
    assert.equal(r.stdout, '', 'A5 NEGATIVE an empty --root printed a report');
    assert.ok(
      r.stderr.startsWith('json-standard-audit: REFUSED -') && r.stderr.includes('--root'),
      `A5 NEGATIVE an empty --root did not refuse by name - ${r.stderr}`
    );
    assert.equal(r.status, 1, `A5 NEGATIVE an empty --root is anything but exit 1 - exit ${r.status}`);
  });
});

describe('B. the --enforced ratchet', () => {
  test('B1 --enforced with no contract, then a contract with no list', () => {
    const root = fixture('b-no-contract');
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 1 && /kit-manifest\.json is not on disk/.test(r.stderr),
      `B1 NEGATIVE --enforced with no contract file is exit 1 - exit ${r.status}: ${r.stderr.trim().split('\n')[0]}`
    );
    fs.writeFileSync(
      path.join(root, 'system', 'kit-manifest.json'),
      JSON.stringify({ components: [] }, null, 2) + '\n'
    );
    const r2 = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r2.status === 1 && /no json_standard\.enforced\[\] array/.test(r2.stderr),
      `B1 NEGATIVE --enforced with a contract file that lacks the list is exit 1 - exit ${r2.status}`
    );
  });

  test('B2 the unmigrated backlog is reported and never blocks', () => {
    const root = fixture('b-backlog', { contract: ['system/good.json'] });
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 0 && /Enforced \(1 path/.test(r.stdout),
      `B2 the unmigrated backlog (bad.json, not enforced) is reported and never blocks - exit ${r.status}`
    );
    assert.ok(/system\/bad\.json/.test(r.stdout), 'B2 the backlog file is still in the table');
  });

  test('B3 one hand-edited byte in an enforced file', () => {
    const root = fixture('b-hand-edit', { contract: ['system/good.json'] });
    const f = path.join(root, 'system', 'good.json');
    const before = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, before.replace('"alpha": 1', '"alpha":  1')); // ONE byte: a second space
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 && /REGRESSION/.test(r.stdout) && /system\/good\.json: /.test(r.stdout),
      `B3 NEGATIVE one hand-edited byte in an enforced file is exit 2, naming it - exit ${r.status}`
    );
  });

  test('B4-B5 a raw JSON.stringify writer of an enforced file, on disk and not', () => {
    const root = fixture('b-raw-writer', { contract: ['system/good.json', 'system/fresh.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
        'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }, null, 2));\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 && /scripts\/raw\.js:4 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B4 NEGATIVE a raw JSON.stringify writer of an enforced file is exit 2, naming the site - exit ${r.status}`
    );
    // The same, for an enforced file that is NOT on disk yet (a gitignored state file on a fresh clone)
    fs.unlinkSync(path.join(root, 'scripts', 'raw.js'));
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw2.mjs'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
        "const HERE = path.dirname(fileURLToPath(import.meta.url));\nconst REPO = path.resolve(HERE, '..');\n" +
        "fs.writeFileSync(path.join(REPO, 'system', 'fresh.json'), JSON.stringify({ a: 1 }));\n"
    );
    const r2 = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r2.status === 2 && /raw2\.mjs:6 writes system\/fresh\.json/.test(r2.stdout),
      `B5 NEGATIVE a raw writer of an enforced file that is not on disk yet is still caught (ESM path idiom) - exit ${r2.status}`
    );
  });

  // A raw writer that serializes on one line and writes on the next, or writes through fs.promises or a
  // stream, is caught as well: the scan looks beyond the write call's own arguments to catch both shapes.
  test('B6 a two-line raw writer, inline then through a reassigned let', () => {
    const root = fixture('b-two-line', { contract: ['system/good.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'two.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
        'const text = JSON.stringify({ alpha: 1 }, null, 2);\nfs.writeFileSync(F, text);\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 && /scripts\/two\.js:5 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B6 NEGATIVE a two-line raw writer (serialize into a const, write the const) of an enforced file is exit 2, naming the site - exit ${r.status}`
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'two.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'good.json');\n" +
        'let body;\nbody = JSON.stringify({ alpha: 1 });\nconst out = body + "\\n";\nfs.writeFileSync(F, out);\n'
    );
    const r2 = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r2.status === 2 && /scripts\/two\.js:7 writes system\/good\.json/.test(r2.stdout),
      `B6 NEGATIVE the same through a reassigned let and a second const is still caught - exit ${r2.status}`
    );
  });

  test('B7 fs.promises, a write stream and a bare writeFile import', () => {
    const root = fixture('b-async', { contract: ['system/good.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'async.mjs'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
        "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
        'await fs.promises.writeFile(F, JSON.stringify({ alpha: 1 }));\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r.stdout),
      `B7 NEGATIVE fs.promises.writeFile of an enforced file is exit 2, naming the site - exit ${r.status}`
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'async.mjs'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
        "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
        'const s = fs.createWriteStream(F);\ns.end(JSON.stringify({ alpha: 1 }));\n'
    );
    const r2 = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r2.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r2.stdout),
      `B7 NEGATIVE a createWriteStream onto an enforced file is exit 2, naming the site - exit ${r2.status}`
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'async.mjs'),
      "import { writeFile } from 'node:fs/promises';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
        "const F = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'system', 'good.json');\n" +
        'await writeFile(F, JSON.stringify({ alpha: 1 }));\n'
    );
    const r3 = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r3.status === 2 && /scripts\/async\.mjs:5 writes system\/good\.json/.test(r3.stdout),
      `B7 NEGATIVE a bare writeFile imported from fs/promises is exit 2, naming the site - exit ${r3.status}`
    );
  });

  test('B6/B7 control: an unenforced target is a backlog row, never a regression', () => {
    // The positive control for B6 and B7: a two-line writer of a file that is NOT enforced stays a
    // backlog row, never a regression, so the wider scan cannot turn the backlog into a CI failure.
    const root = fixture('b-two-line-backlog', { contract: ['system/good.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'two.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst F = path.join(__dirname, '..', 'system', 'bad.json');\n" +
        'const text = JSON.stringify({ alpha: 1 }, null, 2);\nfs.writeFileSync(F, text);\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 0 && /scripts\/two\.js:5\s+production\s+-> system\/bad\.json/.test(r.stdout),
      `B6/B7 control: a two-line writer of an unenforced file is listed and does not block - exit ${r.status}`
    );
  });

  // B9-B10: a writer whose destination comes from REPO, imported from scripts/lib/repo-root.js rather than
  // built from __dirname or fileURLToPath. The evaluator must resolve REPO to the fixture root itself, in
  // both the CommonJS and the ES module spelling the Kit writes.
  test('B9 a raw JSON.stringify writer whose path comes from REPO imported from repo-root.js (CommonJS)', () => {
    const root = fixture('b-repo-root-cjs', { contract: ['system/good.json'] });
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'repo-root.js'),
      "const path = require('node:path');\nconst REPO = path.resolve(__dirname, '..', '..');\nmodule.exports = { REPO };\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw-repo-root.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst { REPO } = require('./lib/repo-root.js');\n" +
        "const F = path.join(REPO, 'system', 'good.json');\nfs.writeFileSync(F, JSON.stringify({ alpha: 1 }, null, 2));\n"
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 &&
        /scripts\/raw-repo-root\.js:5 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B9 NEGATIVE a raw writer built from REPO imported (CommonJS) from repo-root.js is exit 2, naming the site - exit ${r.status}: ${r.stdout}`
    );
  });

  test('B10 a raw JSON.stringify writer whose path comes from REPO imported from repo-root.js (ES module)', () => {
    const root = fixture('b-repo-root-esm', { contract: ['system/good.json'] });
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'repo-root.js'),
      "const path = require('node:path');\nconst REPO = path.resolve(__dirname, '..', '..');\nmodule.exports = { REPO };\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw-repo-root.mjs'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nimport { REPO } from './lib/repo-root.js';\n" +
        "const F = path.join(REPO, 'system', 'good.json');\nfs.writeFileSync(F, JSON.stringify({ alpha: 1 }));\n"
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 &&
        /scripts\/raw-repo-root\.mjs:5 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B10 NEGATIVE a raw writer built from REPO imported (ES module) from repo-root.js is exit 2, naming the site - exit ${r.status}: ${r.stdout}`
    );
  });

  // B11-B12: a writer whose destination comes from a relative-path CONSTANT destructured from a sibling
  // module (not scripts/lib/repo-root.js) that derives it with path.join(...LITERAL.split('/')), the exact
  // shape scripts/lib/migration-ledger.js exports as LEDGER_REL for scripts/run-migrations.js to join onto
  // REPO. The evaluator must follow that import to the sibling module's own declaration, not just REPO's.
  test('B11 a raw JSON.stringify writer whose path comes from a relative-path constant imported from a sibling module (CommonJS)', () => {
    const root = fixture('b-rel-import-cjs', { contract: ['system/good.json'] });
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'repo-root.js'),
      "const path = require('node:path');\nconst REPO = path.resolve(__dirname, '..', '..');\nmodule.exports = { REPO };\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'ledger-path.js'),
      "const path = require('node:path');\nconst LEDGER_PATH = 'system/good.json';\n" +
        "const LEDGER_REL = path.join(...LEDGER_PATH.split('/'));\nmodule.exports = { LEDGER_PATH, LEDGER_REL };\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw-ledger.js'),
      "const fs = require('fs');\nconst path = require('path');\nconst { REPO } = require('./lib/repo-root.js');\n" +
        "const { LEDGER_REL } = require('./lib/ledger-path.js');\nconst F = path.join(REPO, LEDGER_REL);\n" +
        'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }, null, 2));\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 && /scripts\/raw-ledger\.js:6 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B11 NEGATIVE a raw writer built from a destructured import of a sibling module's relative-path export (CommonJS) is exit 2, naming the site - exit ${r.status}: ${r.stdout}`
    );
  });

  test('B12 a raw JSON.stringify writer whose path comes from a relative-path constant imported from a sibling module (ES module)', () => {
    const root = fixture('b-rel-import-esm', { contract: ['system/good.json'] });
    fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'repo-root.js'),
      "const path = require('node:path');\nconst REPO = path.resolve(__dirname, '..', '..');\nmodule.exports = { REPO };\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'lib', 'ledger-path.mjs'),
      "import path from 'node:path';\nexport const LEDGER_PATH = 'system/good.json';\n" +
        "export const LEDGER_REL = path.join(...LEDGER_PATH.split('/'));\n"
    );
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw-ledger.mjs'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nimport { REPO } from './lib/repo-root.js';\n" +
        "import { LEDGER_REL } from './lib/ledger-path.mjs';\nconst F = path.join(REPO, LEDGER_REL);\n" +
        'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }));\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 &&
        /scripts\/raw-ledger\.mjs:6 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B12 NEGATIVE a raw writer built from a destructured import of a sibling module's relative-path export (ES module) is exit 2, naming the site - exit ${r.status}: ${r.stdout}`
    );
  });

  // B13: the value a raw write serializes is a Biome-wrapped multi-line chain, the shape
  // test-check-mjs-legs.mjs's own `const text = routines.map(...JSON.stringify...).join('\n')` takes once
  // formatted, with no semicolon until the chain's last line. The evaluator must read the whole statement,
  // not just the first line past the `=`.
  test('B13 a raw JSON.stringify writer whose value is a Biome-wrapped multi-line chain, not one line', () => {
    const root = fixture('b-wrapped-value', { contract: ['system/good.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'raw-wrapped.js'),
      "const fs = require('fs');\nconst path = require('path');\n" +
        "const F = path.join(__dirname, '..', 'system', 'good.json');\n" +
        'const rows = [{ alpha: 1 }];\n' +
        'const raw = rows\n' +
        '  .map((row) => JSON.stringify(row))\n' +
        "  .join(',');\n" +
        'fs.writeFileSync(F, raw);\n'
    );
    const r = runAudit(['--root', root, '--enforced']);
    assert.ok(
      r.status === 2 &&
        /scripts\/raw-wrapped\.js:8 writes system\/good\.json with a raw JSON\.stringify/.test(r.stdout),
      `B13 NEGATIVE a raw writer whose serialized value is a wrapped multi-line chain is exit 2, naming the site - exit ${r.status}: ${r.stdout}`
    );
  });
});

// K. the declared identifier map. The audit must read the SAME declaration the writer does (json-writer.js
// ID_MAPS, by `_schema`), or a file the helper wrote would be reported as broken, and a hand-typed exception
// could pass.
describe('K. the declared identifier map', () => {
  test('K1-K3 a declared map accepts its kebab id, and nothing else does', () => {
    const root = fixture('k-idmap');
    const PMETA = {
      purpose: 'A fixture profile.',
      writer: 'scripts/tests/test-json-standard.mjs',
      schema: 'install-profile@1'
    };
    const lanes = { 'business-validation': false, website: true };
    let wrote = true;
    try {
      writeJson(path.join(root, 'system', 'profile.json'), { lanes, locale: 'en' }, PMETA);
    } catch {
      wrote = false;
    }
    /** @type {(payload: object, schema: string) => string} */
    const handTyped = (payload, schema) =>
      canonicalText(
        {
          ...payload,
          _generated_at: '2026-09-24T00:00:00Z',
          _purpose: 'A fixture profile.',
          _schema: schema,
          _writer: 'scripts/tests/test-json-standard.mjs'
        },
        { validate: false }
      ) + '\n';
    fs.writeFileSync(
      path.join(root, 'system', 'undeclared.json'),
      handTyped({ lanes, locale: 'en' }, 'json-standard-test@1')
    );
    fs.writeFileSync(
      path.join(root, 'system', 'outside.json'),
      handTyped({ lanes, 'radar-feeds': [] }, 'install-profile@1')
    );
    const r = runAudit(['--root', root, '--json']);
    /** @type {AuditJson | null} */
    let j = null;
    try {
      j = JSON.parse(r.stdout);
    } catch {
      /* reported below */
    }
    /** @type {(n: string) => any} */
    const row = (n) => j?.files.find((f) => f.path === `system/${n}.json`);
    assert.ok(
      wrote && row('profile') && row('profile').findings.length === 0 && row('profile').canonical,
      `K1 a profile the helper wrote with a kebab lane id (declared map) has no findings - ${
        wrote ? (row('profile') || { findings: ['no row'] }).findings.join(' | ') || 'none' : 'writeJson refused it'
      }`
    );
    assert.ok(
      row('undeclared')?.findings.some((/** @type {string} */ f) =>
        /rule 5: not snake_case: business-validation/.test(f)
      ),
      `K2 NEGATIVE the same kebab key in a file whose schema declares no map is reported under rule 5 - ${
        row('undeclared') ? row('undeclared').findings.join(' | ') : 'no row'
      }`
    );
    assert.ok(
      row('outside')?.findings.some((/** @type {string} */ f) => /rule 5: not snake_case: radar-feeds/.test(f)) &&
        !row('outside').findings.some((/** @type {string} */ f) => /business-validation/.test(f)),
      `K3 NEGATIVE in a declaring file, a kebab key OUTSIDE the declared map is reported and the declared one is not - ${
        row('outside') ? row('outside').findings.join(' | ') : 'no row'
      }`
    );
  });

  test('B8 a PowerShell JSON writer is listed by file and line', () => {
    const root = fixture('b-powershell', { contract: ['system/good.json'] });
    fs.writeFileSync(
      path.join(root, 'scripts', 'w.ps1'),
      '$state | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $file\n'
    );
    const r = runAudit(['--root', root]);
    assert.ok(
      /POWERSHELL WRITER SITES/.test(r.stdout) && /scripts\/w\.ps1:1/.test(r.stdout),
      'B8 a PowerShell JSON writer is listed by file and line'
    );
  });
});

// V. validate-alex V21, the real validator.
/**
 * The V21 lines of a validator run, FAILED and WARNING alike.
 * @param {{ stderr: string | null }} res
 */
function v21Lines(res) {
  return String(res.stderr || '')
    .split(/\r?\n/)
    .filter((l) => /^(FAILED|WARNING) V21:/.test(l));
}
/**
 * The real validator in pre-commit context against this checkout, with an optional --staged preview. Loads
 * the shared scheduler stub (-r, before any Kit code) with C4_LIVE empty: the shared stub keeps V2's live
 * half off the real Task Scheduler on every call below - no case here reads a V2 line (V1-V7 filter for
 * V21 only), so an empty live-job list cannot change anything asserted.
 * @param {string | null} stagedDir
 */
function runValidator(stagedDir) {
  const args = ['-r', SCHED_STUB, VALIDATOR, '--context=pre-commit'];
  if (stagedDir) args.push(`--staged=${stagedDir}`);
  return spawnSync(process.execPath, args, {
    cwd: KIT,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '' }
  });
}
const kitManifest = JSON.parse(fs.readFileSync(path.join(KIT, 'system', 'kit-manifest.json'), 'utf8'));
/**
 * A --staged preview folder holding the given files.
 * @param {Record<string, string>} files repo-relative path to content
 */
function staged(files) {
  const dir = fs.mkdtempSync(path.join(TMP, 'staged-'));
  for (const [rel, text] of Object.entries(files)) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, text);
  }
  return dir;
}
/**
 * This checkout's Kit manifest with one change, as the text a writer would stage.
 * @param {(manifest: any) => void} mutate
 */
function manifestWith(mutate) {
  const m = JSON.parse(JSON.stringify(kitManifest));
  mutate(m);
  return JSON.stringify(m, null, 2) + '\n';
}
const TRACKED_ENFORCED = 'system/employer-data-allowlist.json'; // tracked, shipped, written only through the helper

describe('V. validate-alex V21, the real validator', () => {
  test('V1 a contract with the list removed FAILS V21', () => {
    const dir = staged({
      'system/kit-manifest.json': manifestWith((m) => {
        delete m.json_standard;
      })
    });
    const res = runValidator(dir);
    const lines = v21Lines(res);
    assert.ok(
      res.status !== 0 && lines.some((l) => /^FAILED V21: .*no json_standard\.enforced\[\] array/.test(l)),
      `V1 NEGATIVE a contract with the list removed FAILS V21 (a check with no scope asserts nothing) - exit ${res.status}`
    );
  });

  test('V2 one hand-edited byte in an enforced file FAILS V21', () => {
    const real = fs.readFileSync(path.join(KIT, TRACKED_ENFORCED), 'utf8');
    const oneByte = real.replace('"_purpose": ', '"_purpose":  '); // one extra space, content unchanged
    assert.notEqual(oneByte, real, 'V2 the fixture really does change one byte');
    const dir = staged({
      'system/kit-manifest.json': manifestWith((m) => {
        m.json_standard.enforced = [TRACKED_ENFORCED];
      }),
      [TRACKED_ENFORCED]: oneByte
    });
    const res = runValidator(dir);
    const lines = v21Lines(res);
    assert.ok(
      res.status !== 0 &&
        lines.some((l) => l.startsWith(`FAILED V21: ${TRACKED_ENFORCED} (staged) breaks the JSON standard`)),
      `V2 NEGATIVE one hand-edited byte in an enforced file FAILS V21, naming the file - exit ${res.status}` +
        (lines.length ? `\n      ${lines.find((l) => l.startsWith('FAILED')) || ''}` : '')
    );
  });

  test('V3 a TRACKED enforced file that vanished FAILS V21, and this checkout is untouched', () => {
    // A TRACKED enforced file that went missing, deleted in a throwaway CLONE and never in this checkout
    // (the header's NEVER says why). The validator judges the tree it sits in, so the clone gets this
    // checkout's CURRENT validator, audit, helper and the audit's two libraries copied over it: this leg
    // still tests the code under test.
    const real = path.join(KIT, TRACKED_ENFORCED);
    const bytes = fs.readFileSync(real);
    const clone = path.join(TMP, 'v3-clone');
    const c = spawnSync(
      'git',
      ['clone', '-q', '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-c', 'core.symlinks=false', KIT, clone],
      { encoding: 'utf8' }
    );
    /** @type {{ status: number | null, stderr: string }} */
    let res = { status: null, stderr: `git clone failed: ${c.stderr}` };
    if (c.status === 0) {
      for (const rel of [
        'scripts/validate-alex.js',
        'scripts/json-standard-audit.js',
        'scripts/lib/json-writer.js',
        'scripts/lib/exit-codes.js',
        'scripts/lib/repo-root.js'
      ]) {
        fs.copyFileSync(path.join(KIT, rel), path.join(clone, rel));
      }
      fs.rmSync(path.join(clone, TRACKED_ENFORCED));
      const dir = staged({
        'system/kit-manifest.json': manifestWith((m) => {
          m.json_standard.enforced = [TRACKED_ENFORCED];
        })
      });
      res = spawnSync(
        process.execPath,
        ['-r', SCHED_STUB, path.join(clone, 'scripts', 'validate-alex.js'), '--context=pre-commit', `--staged=${dir}`],
        { cwd: clone, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: '', C4_LIVE: '' } }
      );
    }
    assert.ok(
      Buffer.compare(bytes, fs.readFileSync(real)) === 0 &&
        !fs.readdirSync(path.dirname(real)).some((f) => f.includes('v21-test-aside')),
      'V3 this checkout was never touched: the tracked file is byte-identical and nothing was set aside beside it'
    );
    const lines = v21Lines(res);
    assert.ok(
      res.status !== 0 &&
        lines.some((l) =>
          l.startsWith(
            `FAILED V21: ${TRACKED_ENFORCED} is listed in json_standard.enforced[] but is not on disk, and git tracks it`
          )
        ),
      `V3 NEGATIVE a TRACKED enforced file that vanished FAILS V21 - exit ${res.status}${res.status === null ? `: ${res.stderr}` : ''}`
    );
  });

  test('V4 an enforced GITIGNORED file that is absent WARNS and never fails', () => {
    const dir = staged({
      'system/kit-manifest.json': manifestWith((m) => {
        m.json_standard.enforced = ['system/never-written-state.json'];
      })
    });
    const res = runValidator(dir);
    const lines = v21Lines(res);
    assert.ok(
      !lines.some((l) => l.startsWith('FAILED V21')) &&
        lines.some((l) =>
          /^WARNING V21: enforced but absent, and not tracked.*system\/never-written-state\.json/.test(l)
        ),
      'V4 an enforced GITIGNORED file that is absent (writer not run yet) WARNS and never fails'
    );
  });

  test('V5 the committed contract against this checkout: no V21 failure', () => {
    const res = runValidator(null);
    const lines = v21Lines(res);
    assert.ok(
      !lines.some((l) => l.startsWith('FAILED V21')),
      `V5 the committed contract against this checkout: no V21 failure - ${
        lines.filter((l) => l.startsWith('FAILED')).join(' | ') ||
        `${kitManifest.json_standard.enforced.length} path(s) enforced`
      }`
    );
  });

  test('V6 V21 is a CONTENT leg: it still blocks under CLAUDE_CODE_REMOTE=true', () => {
    assert.equal(isRemoteDrift('FAILED V21: system/x.json (repo) breaks the JSON standard: rule 1: BOM'), false);
  });

  test('V7 the audit and the validator read the same enforced list', () => {
    // The two readers share one parser; prove the audit and V21 read the same list from the same file.
    const list = audit.readContract(KIT);
    assert.equal(JSON.stringify(list), JSON.stringify(kitManifest.json_standard.enforced), `${list.length} path(s)`);
  });
});

// E. every enforced path is pinned LF. A clone made with core.autocrlf=true (the Git for Windows default,
// and GitHub's Windows runner) writes CRLF into the working copy of any text file .gitattributes does not
// pin, and V21 then refuses a commit that did nothing wrong. The repository-wide `* text=auto eol=lf`
// already gives EVERY path eol=lf, so reading eol alone would make E1 unfalsifiable. A per-path pin is
// `text eol=lf`, which check-attr reports as text: set where the class rule reports text: auto; both must
// hold.
/**
 * The paths among these that are not pinned text eol=lf.
 * @param {string[]} paths
 */
function unpinned(paths) {
  const r = spawnSync('git', ['check-attr', 'text', 'eol', '--', ...paths], { cwd: KIT, encoding: 'utf8' });
  if (r.status !== 0) return paths.map((p) => `${p} (git check-attr failed: ${r.stderr.trim()})`);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  return paths.filter((p) => !(lines.includes(`${p}: text: set`) && lines.includes(`${p}: eol: lf`)));
}

describe('E. every enforced path is pinned LF', () => {
  test('E1-E2 a synthetic unpinned path is caught, and every real enforced path is pinned', () => {
    const synthetic = unpinned(['system/not-pinned-anywhere.json']);
    assert.equal(
      synthetic.length,
      1,
      `E1 NEGATIVE a path with no eol=lf line in .gitattributes is caught - ${synthetic.join(', ')}`
    );
    const real = unpinned(kitManifest.json_standard.enforced);
    assert.equal(
      real.length,
      0,
      `E2 every path in json_standard.enforced[] is pinned text eol=lf in .gitattributes - ${
        real.length ? `unpinned: ${real.join(', ')}` : `${kitManifest.json_standard.enforced.length} pinned`
      }`
    );
  });
});
