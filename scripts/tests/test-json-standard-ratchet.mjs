#!/usr/bin/env node
// @ts-check
// scripts/tests/test-json-standard-ratchet.mjs - the JSON standard's ratchet, pinned as it behaves today.
//
// WHAT. Pins scripts/json-standard-audit.js: the --enforced ratchet CI runs, and auditText, the file half
// V21 reuses. KNOWN-BAD is one test per family, the smallest planted violation of an enforced file or its
// writer, with its exit code and exact REGRESSION line. Then the contract refusals word for word, the CLI
// modes, the --json shape, the writer shapes the scan catches, the finding caps and the whole table, the
// inputs it must neither crash on nor pass, and its known limits as they are. Deleted, it would let a
// rewrite reword a finding V21 carries into its FAILED line, stop failing on one byte of an enforced file
// or a raw writer of one, pass a missing contract, or quietly move a limit the defect ledger has not scheduled.
//
// HOW. Every fixture is a small tree under the OS temp folder: an enforced file written by the real writer
// with a fixed clock, a contract naming it, and one planted script at a time; the real audit runs over it
// with --root. The planted code is built from quoted lines, so the Kit's own writer scan, which reads
// scripts/tests too, resolves none of it to an in-scope target. A missing root, an empty tree, one
// hand-edited byte, the plain raw writer and its ES module form, fs.promises and the bare writeFile, the
// declared identifier maps, the PowerShell listing, V21 and the eol pins are held by
// scripts/tests/test-json-standard.mjs and not repeated here.
//
// NEVER. Touches the checkout: every tree is under the temp folder, removed when the run ends. Fixes a
// pinned defect in passing: each PINNED DEFECT test holds today's behaviour, the limit included, until the
// defect ledger schedules its fix and inverts that one test.
//
// Usage: node scripts/tests/test-json-standard-ratchet.mjs
// Exit: 0 every test passed - 1 a test failed

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-c5-json-')));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
const require = createRequire(import.meta.url);
const W = require(path.join(KIT, 'scripts', 'lib', 'json-writer.js'));
const A = require(path.join(KIT, 'scripts', 'json-standard-audit.js'));
const AUDIT = path.join(KIT, 'scripts', 'json-standard-audit.js');

const ENF = 'system/zz-enforced.json';
const META = {
  purpose: 'a fixture',
  writer: 'scripts/zz-writer.js',
  schema: 'zz-enforced@1',
  generatedAt: '2000-01-01T00:00:00Z'
};
const CLEAN_VERDICT = 'Enforced (1 path(s), 1 on this disk): clean. The backlog above is reported, never blocking.';
/**
 * The REGRESSION line for a raw JSON.stringify writer of the enforced file.
 * @param {string} site file:line
 * @param {string} [call] the write call it names
 */
const RAW = (site, call = 'writeFileSync') =>
  `  ${site} writes ${ENF} with a raw JSON.stringify (${call}), not through scripts/lib/json-writer.js`;

let n = 0;
/** A fresh fixture tree: the enforced file, the contract naming it, and the script its _writer names. */
function tree() {
  const root = path.join(TMP, `t${++n}`);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  W.writeJson(path.join(root, ENF), { alpha: 1, rows: [] }, META);
  W.writeJson(
    path.join(root, 'system', 'kit-manifest.json'),
    { json_standard: { enforced: [ENF] } },
    {
      purpose: 'the contract',
      writer: 'scripts/zz-writer.js',
      schema: 'zz-kit-manifest@1',
      generatedAt: '2000-01-01T00:00:00Z'
    }
  );
  fs.writeFileSync(path.join(root, 'scripts', 'zz-writer.js'), '// writes the enforced file through the helper\n');
  return root;
}
/**
 * A planted source file: the lines joined, with a final newline.
 * @param {...string} lines
 */
const code = (...lines) => lines.join('\n') + '\n';
const HEAD = ["const fs = require('fs');", "const path = require('path');"];
const TARGET = "const F = path.join(__dirname, '..', 'system', 'zz-enforced.json');";
/**
 * The real audit over a fixture tree, --enforced unless other flags are given.
 * @param {string} root
 * @param {string[]} [args]
 */
function audit(root, args = ['--enforced']) {
  const r = spawnSync(process.execPath, [AUDIT, '--root', root, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines: r.stdout.split('\n') };
}
/**
 * The Enforced verdict line and the regression lines after it (none when clean).
 * @param {{ stdout: string, lines: string[] }} r
 */
function verdict(r) {
  const i = r.lines.findIndex((l) => l.startsWith('Enforced'));
  assert.ok(i >= 0, `no Enforced line in:\n${r.stdout}`);
  const out = [r.lines[i]];
  for (let k = i + 1; k < r.lines.length && r.lines[k].startsWith('  '); k++) out.push(r.lines[k]);
  return out;
}
/**
 * Write one planted file into a fixture tree.
 * @param {string} root
 * @param {string} rel
 * @param {string} text
 */
function plant(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

// ---------------------------------------------------------------- the baseline fixture is clean
test('the fixture tree is clean under --enforced (exit 0) and in the whole-picture mode (exit 0, "Result: clean.")', () => {
  const root = tree();
  const e = audit(root);
  assert.equal(e.status, 0);
  assert.deepEqual(verdict(e), [CLEAN_VERDICT]);
  const d = audit(root, []);
  assert.equal(d.status, 0);
  assert.ok(d.lines.includes('Result: clean.'));
  assert.match(d.lines[1], /^JSON STANDARD COMPLIANCE, \d{4}-\d{2}-\d{2} \(docs\/json-standard\.md\)$/);
  assert.equal(
    d.lines[3],
    '2 of 2 in-scope files conform. 0 do not. 0 node writer site(s) serialize an in-scope file without the helper; 0 PowerShell writer site(s) cannot reach it at all.'
  );
});

// ---------------------------------------------------------------- KNOWN-BAD: the enforced file's bytes
/** @type {[string, (text: string) => string, string[]][]} */
const DAMAGE = [
  [
    'rules-7-8 indentation',
    (t) => t.replace('"alpha": 1', '"alpha":  1'),
    ['rules 7 and 8: not byte-identical to the helper output (indent or formatting)']
  ],
  ['rule-1 BOM', (t) => String.fromCharCode(0xfeff) + t, ['rule 1: BOM']],
  ['rule-1 CRLF', (t) => t.replace(/\n/g, '\r\n'), ['rule 1: CRLF line endings']],
  ['rule-1 no trailing newline', (t) => t.replace(/\n$/, ''), ['rule 1: no trailing newline']],
  ['rule-1 two trailing newlines', (t) => t + '\n', ['rule 1: more than one trailing newline']],
  [
    'rule-2 header missing',
    (t) => t.replace(/ {2}"_purpose": "a fixture",\n/, ''),
    ['rule 2: header missing _purpose']
  ],
  [
    'rule-2 underscore payload key',
    (t) => t.replace('"rows"', '"_rows"'),
    ['rule 2: underscore-prefixed payload key: _rows', 'rule 6: keys not sorted at (root)']
  ],
  [
    'rule-2 _writer names a missing script',
    (t) => t.replace('scripts/zz-writer.js', 'scripts/zz-gone.js'),
    ['rule 2: _writer names scripts/zz-gone.js, which does not exist']
  ],
  [
    'rule-3 schema',
    (t) => t.replace('zz-enforced@1', 'zz-enforced'),
    ['rule 3: _schema "zz-enforced" is not name@revision']
  ],
  ['rule-5 not snake_case', (t) => t.replace('"rows"', '"rowList"'), ['rule 5: not snake_case: rowList']],
  [
    'rule-5 date in a key',
    (t) => t.replace('"rows"', '"rows_2026_09_24"'),
    ['rule 5: date inside a key: rows_2026_09_24 (an embedded date)']
  ],
  [
    'rule-6 unsorted',
    (t) => t.replace('  "alpha": 1,\n  "rows": []', '  "rows": [],\n  "alpha": 1'),
    ['rule 6: keys not sorted at (root)']
  ],
  [
    'rule-9 root not an object',
    () => '[]\n',
    ['rule 9: the root is not an object, so there is nowhere for the header to live']
  ]
];
for (const [family, damage, findings] of DAMAGE) {
  test(`KNOWN-BAD json-standard-audit ${family}: the enforced file refuses with exit 2 and one REGRESSION line naming it and its finding(s)`, () => {
    const root = tree();
    const f = path.join(root, ENF);
    fs.writeFileSync(f, damage(fs.readFileSync(f, 'utf8')));
    const r = audit(root);
    assert.equal(r.status, 2);
    assert.deepEqual(verdict(r), [
      'Enforced: 1 REGRESSION(S), a migrated file broken or written around the helper:',
      `  ${ENF}: ${findings.join('; ')}`
    ]);
    assert.deepEqual(
      A.auditText(ENF, fs.readFileSync(f, 'utf8'), { root }).findings,
      findings,
      'auditText, the seam V21 reuses, says the same'
    );
  });
}

test("KNOWN-BAD json-standard-audit unparseable: an enforced file that is not JSON refuses with the parser's own message", () => {
  const root = tree();
  fs.writeFileSync(path.join(root, ENF), '{\n');
  let msg = '';
  try {
    JSON.parse('{\n');
  } catch (/** @type {any} */ e) {
    msg = e.message;
  }
  const r = audit(root);
  assert.equal(r.status, 2);
  assert.deepEqual(verdict(r).slice(1), [`  ${ENF}: unparseable: ${msg}`]);
});

// ---------------------------------------------------------------- KNOWN-BAD: a raw writer of the enforced file
const CAUGHT = [
  [
    'raw-writer inline',
    code(...HEAD, TARGET, 'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }, null, 2));'),
    RAW('scripts/zz-raw.js:4')
  ],
  [
    'raw-writer through a variable',
    code(...HEAD, TARGET, 'const text = JSON.stringify({ alpha: 1 }, null, 2);', 'fs.writeFileSync(F, text);'),
    RAW('scripts/zz-raw.js:5')
  ],
  [
    'raw-writer through a reassigned let',
    code(
      ...HEAD,
      TARGET,
      'let body;',
      'body = JSON.stringify({ alpha: 1 });',
      'const out = body + String.fromCharCode(10);',
      'fs.writeFileSync(F, out);'
    ),
    RAW('scripts/zz-raw.js:7')
  ],
  [
    'raw-writer through an arrow const',
    code(...HEAD, TARGET, 'const ser = (x) => JSON.stringify(x);', 'fs.writeFileSync(F, ser({ alpha: 1 }));'),
    RAW('scripts/zz-raw.js:5')
  ],
  [
    'raw-writer in a file that names the helper',
    code(
      '// scripts/lib/json-writer.js is the helper; this file ignores it',
      ...HEAD,
      TARGET,
      'fs.writeFileSync(F, JSON.stringify({ alpha: 1 }));'
    ),
    RAW('scripts/zz-raw.js:5')
  ],
  [
    'raw-append',
    code(...HEAD, TARGET, 'fs.appendFileSync(F, JSON.stringify({ alpha: 1 }));'),
    RAW('scripts/zz-raw.js:4', 'appendFileSync')
  ],
  [
    'raw-stream',
    code(
      '// JSON.stringify is mentioned here, so the file passes the prefilter',
      ...HEAD,
      TARGET,
      'const s = fs.createWriteStream(F);',
      "s.end('{}');"
    ),
    `  scripts/zz-raw.js:5 writes ${ENF} through a raw write stream, not through scripts/lib/json-writer.js`
  ]
];
for (const [family, text, line] of CAUGHT) {
  test(`KNOWN-BAD json-standard-audit ${family}: exit 2 and the REGRESSION line naming the site, the target and the call`, () => {
    const root = tree();
    plant(root, 'scripts/zz-raw.js', text);
    const r = audit(root);
    assert.equal(r.status, 2);
    assert.deepEqual(verdict(r), [
      'Enforced: 1 REGRESSION(S), a migrated file broken or written around the helper:',
      line
    ]);
  });
}

test('a raw writer is listed in the table under NODE WRITER SITES, ENFORCED, with the helper note when the file names the helper', () => {
  const root = tree();
  plant(root, 'scripts/zz-raw.js', CAUGHT[4][1]);
  const r = audit(root);
  assert.ok(r.lines.includes('NODE WRITER SITES that serialize an IN-SCOPE file without scripts/lib/json-writer.js:'));
  assert.ok(
    r.lines.includes(
      `  scripts/zz-raw.js:5   production  -> ${ENF}   ENFORCED   (file imports the helper, this line does not use it)`
    ),
    r.stdout
  );
});

// ---------------------------------------------------------------- the contract refusals
test('the contract refusals under --enforced: every broken or missing contract is exit 1 with its exact FAILED sentence, while the whole-picture mode still runs', () => {
  const tail =
    '. That list IS the ratchet; without it --enforced has no scope and would pass everything, which is worse than no check. Restore it (doc: docs/json-standard.md).\n';
  let msg = '';
  try {
    JSON.parse('{');
  } catch (/** @type {any} */ e) {
    msg = e.message;
  }
  /** @type {[string, ((manifest: any) => string) | null, string][]} */
  const cases = [
    [
      'no json_standard',
      (m) => {
        delete m.json_standard;
        return JSON.stringify(m);
      },
      'system/kit-manifest.json has no json_standard.enforced[] array'
    ],
    [
      'enforced not an array',
      (m) => {
        m.json_standard.enforced = ENF;
        return JSON.stringify(m);
      },
      'system/kit-manifest.json has no json_standard.enforced[] array'
    ],
    [
      'an empty entry',
      (m) => {
        m.json_standard.enforced.push(' ');
        return JSON.stringify(m);
      },
      'system/kit-manifest.json json_standard.enforced[] holds a non-path value " "'
    ],
    ['not JSON', () => '{', `system/kit-manifest.json is not valid JSON: ${msg}`],
    ['absent', null, 'system/kit-manifest.json is not on disk']
  ];
  for (const [name, edit, reason] of cases) {
    const root = tree();
    const f = path.join(root, 'system', 'kit-manifest.json');
    if (edit) fs.writeFileSync(f, edit(JSON.parse(fs.readFileSync(f, 'utf8'))));
    else fs.rmSync(f);
    const r = audit(root);
    assert.deepEqual([r.status, r.stdout, r.stderr], [1, '', `json-standard-audit: FAILED: ${reason}${tail}`], name);
    const d = audit(root, []);
    assert.notEqual(d.status, 1, `${name}: the whole-picture mode does not need the list`);
    assert.ok(!d.lines.some((l) => l.startsWith('Enforced')), `${name}: and prints no Enforced verdict`);
  }
});

test('an enforced path that is not on disk is reported and asserts nothing (exit 0); V21, not the audit, owns a tracked absence', () => {
  const root = tree();
  fs.rmSync(path.join(root, ENF));
  const r = audit(root);
  assert.equal(r.status, 0);
  assert.ok(r.lines.includes(`ENFORCED but not on this disk (1), nothing asserted about them here: ${ENF}`));
  assert.deepEqual(verdict(r), [
    'Enforced (1 path(s), 0 on this disk): clean. The backlog above is reported, never blocking.'
  ]);
});

// ---------------------------------------------------------------- the CLI modes and the JSON shape
test('the modes: --files skips the writer scan (a raw writer then passes --enforced), --json carries the documented keys, --verbose lists the unresolved sites', () => {
  const root = tree();
  plant(root, 'scripts/zz-raw.js', CAUGHT[0][1]);
  assert.equal(audit(root, ['--enforced', '--files']).status, 0);
  const j = JSON.parse(audit(root, ['--enforced', '--json']).stdout);
  assert.deepEqual(Object.keys(j), [
    'root',
    'files',
    'excluded',
    'writer_sites',
    'findings',
    'file_findings',
    'writer_bypasses',
    'powershell_sites',
    'enforced',
    'enforced_present',
    'regressions'
  ]);
  assert.deepEqual(j.writer_sites, [
    {
      site: 'scripts/zz-raw.js:4',
      target: ENF,
      in_scope: true,
      kind: 'production',
      lang: 'node',
      call: 'writeFileSync',
      imports_helper: false
    }
  ]);
  assert.deepEqual(
    j.files.map((/** @type {object} */ f) => Object.keys(f)),
    [
      ['path', 'dialect', 'canonical', 'findings'],
      ['path', 'dialect', 'canonical', 'findings']
    ]
  );
  assert.deepEqual([j.findings, j.file_findings, j.writer_bypasses, j.powershell_sites], [1, 0, 1, 0]);
  plant(
    root,
    'scripts/zz-raw.js',
    code(...HEAD, 'function save(p) { fs.writeFileSync(p, JSON.stringify({ a: 1 })); }', 'module.exports = { save };')
  );
  const quiet = audit(root, []);
  assert.ok(
    quiet.lines.includes(
      '1 further JSON.stringify write site(s) have a destination this scan could not resolve statically (a runtime variable or a computed path). Not counted as findings. --verbose lists them.'
    )
  );
  assert.ok(!quiet.lines.includes('  scripts/zz-raw.js:3  [production]'));
  assert.ok(audit(root, ['--verbose']).lines.includes('  scripts/zz-raw.js:3  [production]'));
});

test('a PowerShell writer of the enforced file is listed, never blocks --enforced, and counts as a finding in the whole-picture mode', () => {
  const root = tree();
  plant(
    root,
    'scripts/zz-w.ps1',
    "$state | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 'system/zz-enforced.json'\n"
  );
  const e = audit(root);
  assert.equal(e.status, 0);
  assert.ok(
    e.lines.includes('POWERSHELL WRITER SITES (ConvertTo-Json written to a file; the node helper cannot reach these):')
  );
  assert.ok(e.lines.includes('  scripts/zz-w.ps1:1  [production]'));
  assert.equal(audit(root, []).status, 2);
});

test('the module surface: its exports in order, the scope globs and the scope test', () => {
  assert.deepEqual(Object.keys(A), [
    'auditText',
    'auditTree',
    'parseContract',
    'readContract',
    'matchesScope',
    'CONTRACT_REL',
    'IN_SCOPE_GLOBS',
    'OUT_OF_SCOPE_PATHS',
    'OUT_OF_SCOPE_PREFIXES'
  ]);
  assert.equal(A.CONTRACT_REL, 'system/kit-manifest.json');
  assert.deepEqual(A.IN_SCOPE_GLOBS, [
    'system/*.json',
    'work/*/state/*.json',
    'work/*/config/*.json',
    'skills-lock.json'
  ]);
  const scope = [
    'system/x.json',
    'system/sub/x.json',
    'work/a/state/x.json',
    'work/a/b/state/x.json',
    'skills-lock.json',
    '.claude/settings.json',
    'docs/x.json'
  ].map((p) => [p, A.matchesScope(p)]);
  assert.deepEqual(scope, [
    ['system/x.json', true],
    ['system/sub/x.json', false],
    ['work/a/state/x.json', true],
    ['work/a/b/state/x.json', false],
    ['skills-lock.json', true],
    ['.claude/settings.json', false],
    ['docs/x.json', false]
  ]);
  assert.deepEqual(A.parseContract(`{"json_standard":{"enforced":["${ENF}"]}}`), [ENF]);
});

// ---------------------------------------------------------------- the audit's known limits, pinned as they are today
const WALK_PAST = [
  [
    'a stream fed a literal (no JSON.stringify anywhere in the file)',
    code(...HEAD, TARGET, 'const s = fs.createWriteStream(F);', "s.end('{}');")
  ],
  [
    'a function declaration that returns JSON.stringify',
    code(
      ...HEAD,
      TARGET,
      'function ser(x) { return JSON.stringify(x, null, 2); }',
      'fs.writeFileSync(F, ser({ alpha: 1 }));'
    )
  ],
  [
    'a shadowed const (resolved to the FIRST declaration, another file)',
    code(
      ...HEAD,
      'function a() {',
      "  const file = path.join(__dirname, '..', 'system', 'zz-other.json');",
      '  return file;',
      '}',
      'function b() {',
      "  const file = path.join(__dirname, '..', 'system', 'zz-enforced.json');",
      '  fs.writeFileSync(file, JSON.stringify({ alpha: 1 }));',
      '}'
    )
  ],
  [
    'a temp file renamed onto the enforced file',
    code(
      ...HEAD,
      TARGET,
      "const tmp = F + '.tmp';",
      'fs.writeFileSync(tmp, JSON.stringify({ alpha: 1 }));',
      'fs.renameSync(tmp, F);'
    )
  ],
  [
    "a bracket call fs['writeFileSync']",
    code(...HEAD, TARGET, "fs['write' + 'FileSync'](F, JSON.stringify({ alpha: 1 }));")
  ],
  [
    'openSync plus writeSync',
    code(...HEAD, TARGET, "const fd = fs.openSync(F, 'w');", 'fs.writeSync(fd, JSON.stringify({ alpha: 1 }));')
  ],
  [
    'a destructured stringify',
    code(...HEAD, 'const { stringify } = JSON;', TARGET, 'fs.writeFileSync(F, stringify({ alpha: 1 }));')
  ],
  [
    'an aliased writeFileSync',
    code(...HEAD, TARGET, 'const put = fs.writeFileSync;', 'put(F, JSON.stringify({ alpha: 1 }));')
  ],
  [
    'the root passed as a parameter',
    code(
      ...HEAD,
      "function save(root) { fs.writeFileSync(path.join(root, 'system', 'zz-enforced.json'), JSON.stringify({ alpha: 1 })); }",
      'module.exports = { save };'
    )
  ],
  [
    'a helper module that serializes',
    code(...HEAD, "const { ser } = require('./zz-ser.js');", TARGET, 'fs.writeFileSync(F, ser({ alpha: 1 }));')
  ]
];
for (const [shape, text] of WALK_PAST) {
  test(`PINNED DEFECT R7-6: the ratchet cannot see ${shape}: --enforced stays exit 0 and clean`, () => {
    const root = tree();
    plant(root, 'scripts/zz-raw.js', text);
    if (shape.startsWith('a helper module'))
      plant(root, 'scripts/zz-ser.js', code('module.exports = { ser: (x) => JSON.stringify(x, null, 2) };'));
    const r = audit(root);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(verdict(r), [CLEAN_VERDICT]);
  });
}

test('PINNED DEFECT R7-6: a Python writer of the enforced file is invisible to every mode (not even listed)', () => {
  const root = tree();
  plant(root, 'scripts/zz-w.py', code('import json', "json.dump({'alpha': 1}, open('system/zz-enforced.json', 'w'))"));
  const e = audit(root);
  assert.equal(e.status, 0);
  assert.ok(!e.stdout.includes('zz-w.py'));
  const d = audit(root, []);
  assert.equal(d.status, 0);
  assert.ok(!d.stdout.includes('zz-w.py'));
});

test('PINNED DEFECT R7-7: a comment or a string that only SHOWS the forbidden call is read as a raw write and fails the ratchet with no write at all', () => {
  const root = tree();
  plant(
    root,
    'scripts/zz-raw.js',
    code(
      "const path = require('path');",
      "// never: fs.writeFileSync(path.join(__dirname, '..', 'system', 'zz-enforced.json'), JSON.stringify(x));"
    )
  );
  const c = audit(root);
  assert.equal(c.status, 2);
  assert.deepEqual(verdict(c).slice(1), [RAW('scripts/zz-raw.js:2')]);
  plant(
    root,
    'scripts/zz-raw.js',
    code(...HEAD, TARGET, "const doc = 'never call writeFileSync(F, JSON.stringify(x)) here';")
  );
  const s = audit(root);
  assert.equal(s.status, 2);
  assert.deepEqual(verdict(s).slice(1), [RAW('scripts/zz-raw.js:4')]);
});

test('PINNED DEFECT R7-18: a hand edit that stays canonical (a row typed by hand, an edited _purpose) is indistinguishable from the writer and passes', () => {
  const root = tree();
  const f = path.join(root, ENF);
  const clean = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, clean.replace('"rows": []', '"rows": [\n    {\n      "note": "typed by hand"\n    }\n  ]'));
  assert.deepEqual([audit(root).status, verdict(audit(root))], [0, [CLEAN_VERDICT]]);
  fs.writeFileSync(f, clean.replace('"_purpose": "a fixture"', '"_purpose": "edited by hand"'));
  assert.deepEqual([audit(root).status, verdict(audit(root))], [0, [CLEAN_VERDICT]]);
});

test('a --root given no value refuses by name, exit 1, no stack and nothing audited', () => {
  const r = spawnSync(process.execPath, [AUDIT, '--root'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.startsWith('json-standard-audit: REFUSED -'));
  assert.ok(!r.stderr.includes('TypeError'));
});

test('PINNED DEFECT R7-24: a BOM file whose body is canonical is reported canonical=yes beside its rule 1 finding; the secret-bearing file withholds names but prints its _schema value', () => {
  const body = W.canonicalText({ _generated_at: 'x', _purpose: 'p', _schema: 'zz@1', _writer: 'w', a: 1 }) + '\n';
  const bom = A.auditText('system/zz.json', String.fromCharCode(0xfeff) + body);
  assert.deepEqual([bom.canonical, bom.findings], [true, ['rule 1: BOM']]);
  const secret = A.auditText('system/credentials-ledger.json', '{\n  "BadKey": 1,\n  "_schema": "leaky value"\n}\n');
  assert.deepEqual(secret.findings, [
    'rule 2: header missing _generated_at, _purpose, _writer',
    'rule 3: _schema "leaky value" is not name@revision',
    'rule 5: not snake_case: (name withheld: secret-bearing file)'
  ]);
  assert.deepEqual(A.auditText('system/credentials-ledger.json', '{').findings, [
    'rule 1: no trailing newline',
    'unparseable: JSON.parse failed'
  ]);
});

// ---------------------------------------------------------------- inputs the audit must read, not crash on
test('a backlog file whose _schema names an Object prototype member (toString, constructor, __proto__) is audited and reported, and --enforced runs clean', () => {
  for (const schema of ['toString', 'constructor', '__proto__']) {
    const root = tree();
    const backlog = `{"_schema":"${schema}","nested":{"a":1}}\n`;
    plant(root, 'system/zz-backlog.json', backlog);
    const r = audit(root);
    assert.deepEqual([r.status, r.stderr], [0, ''], schema);
    assert.deepEqual(verdict(r), [CLEAN_VERDICT], schema);
    assert.deepEqual(
      A.auditText('system/zz-backlog.json', backlog).findings,
      [
        'rule 2: header missing _generated_at, _purpose, _writer',
        `rule 3: _schema "${schema}" is not name@revision`,
        'rules 7 and 8: not byte-identical to the helper output (indent or formatting)'
      ],
      schema
    );
  }
});

// ---------------------------------------------------------------- a value the helper cannot render is never passed
const UNVERIFIABLE = 'rules 7 and 8: UNVERIFIABLE (the helper could not render this value:';
const REGRESSION_HEAD = 'Enforced: 1 REGRESSION(S), a migrated file broken or written around the helper:';

test('KNOWN-BAD json-standard-audit a number JSON.parse makes infinite: the helper cannot render it, so the file is UNVERIFIABLE and refuses with exit 2', () => {
  const root = tree();
  const f = path.join(root, ENF);
  const infinite = fs.readFileSync(f, 'utf8').replace('"alpha": 1', '"alpha": 1e400');
  plant(root, ENF, infinite);
  const r = audit(root);
  assert.equal(r.status, 2, r.stdout);
  assert.deepEqual(verdict(r), [
    REGRESSION_HEAD,
    `  ${ENF}: ${UNVERIFIABLE} non-finite number at alpha: Infinity is not representable in JSON)`
  ]);
  assert.deepEqual(
    A.auditText('system/credentials-ledger.json', infinite).findings,
    [`${UNVERIFIABLE} canonicalText failed)`],
    'the secret-bearing file withholds the message, which names a key'
  );
});

test("KNOWN-BAD json-standard-audit an object nested past the helper's stack but not the key walk's is UNVERIFIABLE, exit 2; nested past the key walk's too, the run fails, exit 1", () => {
  const root = tree();
  const clean = fs.readFileSync(path.join(root, ENF), 'utf8');
  /** @param {number} depth levels of objects under alpha */
  const at = (depth) => {
    plant(root, ENF, clean.replace('"alpha": 1', `"alpha": ${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`));
    return audit(root, ['--enforced', '--files']);
  };
  // Where the key walk runs out of stack depends on the platform, so it is found here, never assumed. The
  // helper spends more stack per level of objects than the key walk does, so just below that edge lies a
  // file the key walk reads and the helper cannot render.
  let lo = 1;
  let hi = 1 << 16;
  assert.equal(at(hi).status, 1, 'fixture: the deepest probe fails to run');
  while (hi - lo > 16) {
    const mid = (lo + hi) >> 1;
    if (at(mid).status === 1) hi = mid;
    else lo = mid;
  }
  const inside = at(lo - 64);
  assert.equal(inside.status, 2, inside.stdout);
  assert.deepEqual(verdict(inside), [REGRESSION_HEAD, `  ${ENF}: ${UNVERIFIABLE} Maximum call stack size exceeded)`]);
  const past = at(hi + 64);
  assert.deepEqual(
    [past.status, past.stdout, past.stderr],
    [1, '', 'json-standard-audit: FAILED to run: Maximum call stack size exceeded\n']
  );
});

// ---------------------------------------------------------------- what the audit prints, as V21 and a person read it
test('the five finding caps, each broken by one: the exact words V21 carries into its FAILED line', () => {
  const header = { _generated_at: 'x', _purpose: 'p', _schema: 'zz@1', _writer: 'w' };
  /**
   * @param {number} count
   * @param {(i: number) => string} key
   */
  const keys = (count, key) => Object.fromEntries(Array.from({ length: count }, (_, i) => [key(i), 1]));
  /** @param {object} payload the keys beside the header, written canonically */
  const flat = (payload) =>
    A.auditText('system/zz.json', `${W.canonicalText({ ...header, ...payload }, { validate: false })}\n`).findings;
  /**
   * @param {string} value the object each nested key holds
   * @param {number} count
   */
  const nested = (value, count) => {
    const members = Array.from({ length: count }, (_, i) => `"n${i}":${value}`).join(',');
    return A.auditText(
      'system/zz.json',
      `{"_generated_at":"x","_purpose":"p","_schema":"zz@1","_writer":"w",${members}}\n`
    ).findings;
  };
  assert.deepEqual(flat(keys(7, (i) => `Bad${i}`)), [
    'rule 5: not snake_case: Bad0, Bad1, Bad2, Bad3, Bad4, Bad5 (+1 more)'
  ]);
  assert.deepEqual(flat(keys(5, (i) => `k_${2010 + i}_01_02`)), [
    'rule 5: date inside a key: k_2010_01_02 (an embedded date), k_2011_01_02 (an embedded date), k_2012_01_02 (an embedded date), k_2013_01_02 (an embedded date) (+1 more)'
  ]);
  assert.deepEqual(flat(keys(7, (i) => `_u${i}`)), [
    'rule 2: underscore-prefixed payload key: _u0, _u1, _u2, _u3, _u4, _u5 (+1 more)'
  ]);
  assert.deepEqual(nested('{"z":1,"a":2}', 5), ['rule 6: keys not sorted at n0, n1, n2, n3 (+1 more)']);
  assert.deepEqual(nested('{"10":1,"2":2}', 4), [
    'rule 5: not snake_case: 2, 10, 2, 10, 2, 10 (+2 more)',
    'rule 6: key order UNVERIFIABLE at n0, n1, n2 (integer-like keys; JSON.parse reorders them)'
  ]);
});

test('the whole-picture table as a person reads it: its column widths, the dialect order, finding order, a _writer claim cut at a parenthesis, a verify- writer counted as a test, a folder named like .git walked, and a PowerShell test site listed but not counted', () => {
  const root = tree();
  const clean = fs.readFileSync(path.join(root, ENF), 'utf8');
  plant(root, 'system/zz-bom.json', String.fromCharCode(0xfeff) + clean.replace(/\n/g, '\r\n'));
  plant(root, 'system/zz-claim.json', clean.replace('"scripts/zz-writer.js"', '"scripts/zz-writer.js(the helper)"'));
  plant(root, 'system/zz-doc.json', '{"_what":"x","version":1}\n');
  plant(root, 'system/zz-key.json', '{"01":1,"a":2}\n');
  plant(root, 'scripts/verify-zz.js', CAUGHT[0][1]);
  plant(root, 'scripts/zz.git/w.js', WALK_PAST[8][1]);
  plant(root, 'scripts/tests/zz-t.ps1', "$state | ConvertTo-Json | Set-Content 'zz.json'\n");
  const r = audit(root, ['--verbose']);
  assert.equal(r.status, 2);
  const indent = ' '.repeat(57);
  const noHeader = 'rule 2: header missing _generated_at, _purpose, _schema, _writer';
  const notIdentical = 'rules 7 and 8: not byte-identical to the helper output (indent or formatting)';
  assert.deepEqual(
    r.lines.map((l) => l.replace(/^(JSON STANDARD COMPLIANCE, )\d{4}-\d{2}-\d{2}/, '$1<date>')),
    [
      '',
      'JSON STANDARD COMPLIANCE, <date> (docs/json-standard.md)',
      '',
      '3 of 6 in-scope files conform. 3 do not. 1 node writer site(s) serialize an in-scope file without the helper; 0 PowerShell writer site(s) cannot reach it at all.',
      '',
      'FILE                        ENF  DIALECT          CANON  FINDINGS',
      '--------------------------  -------------------------------------',
      'system/kit-manifest.json         standard         yes    none',
      'system/zz-bom.json               standard         no     rule 1: BOM',
      `${indent}rule 1: CRLF line endings`,
      'system/zz-claim.json             standard         yes    none',
      `system/zz-doc.json               underscore-doc   no     ${noHeader}`,
      `${indent}rule 2: underscore-prefixed payload key: _what`,
      `${indent}${notIdentical}`,
      'system/zz-enforced.json     yes  standard         yes    none',
      `system/zz-key.json               bare             no     ${noHeader}`,
      `${indent}rule 5: not snake_case: 01`,
      `${indent}${notIdentical}`,
      '',
      'NODE WRITER SITES that serialize an IN-SCOPE file without scripts/lib/json-writer.js:',
      `  scripts/verify-zz.js:4  test        -> ${ENF}   ENFORCED`,
      '',
      'POWERSHELL WRITER SITES (ConvertTo-Json written to a file; the node helper cannot reach these):',
      '  scripts/tests/zz-t.ps1:1  [test]',
      '',
      '1 further JSON.stringify write site(s) have a destination this scan could not resolve statically (a runtime variable or a computed path). Not counted as findings. --verbose lists them.',
      '  scripts/zz.git/w.js:3  [production]',
      '',
      'Result: 8 file finding(s) across 3 file(s), plus 1 node writer bypass(es) and 0 PowerShell writer site(s).',
      'Enforced: 1 REGRESSION(S), a migrated file broken or written around the helper:',
      RAW('scripts/verify-zz.js:4'),
      '',
      ''
    ]
  );
  const report = audit(root, ['--json']).stdout;
  assert.equal(report, `${JSON.stringify(JSON.parse(report), null, 2)}\n`, '--json prints the report indented by two');
});
