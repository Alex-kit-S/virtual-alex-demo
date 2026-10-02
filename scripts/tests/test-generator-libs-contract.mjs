#!/usr/bin/env node
// @ts-check
// scripts/tests/test-generator-libs-contract.mjs - the generator's library modules, pinned function by function.
//
// WHAT. Holds the generator's libraries to what they do today: every refusal read-sources and the
// renderers print, the parse contracts scripts/validate-alex.js shares with them, the text contracts
// other files read from gen-launchd.js and skill-state.js, and a set of known defects, each asserted as it
// is and named PINNED DEFECT in its title. Deleted, a changed refusal, a parse the
// validator would then read another way, a moved line that two documents cite by number, a lost
// portability pragma, or a quiet change to a pinned defect would all pass with every other test green.
//
// HOW. Before the suites run, scripts/lib/, templates/ and the sources the libraries read are copied into
// a temp folder, so each module's root is that copy. One suite per module: read-sources (loadModel's
// refusals in order, the MCP and schedule parses), render-templates, gen-routing-table,
// gen-claude-region, gen-routines, gen-command-headers, gen-tokens, gen-scheduler's parseFrequency,
// gen-launchd's grammar and plist, and log; the last suite pins the region refusals of gen-routines and
// gen-docs word for word. A source is replaced or removed for one assertion and restored after it. Two
// modules are also loaded from a lone copy: log.js, with repo-root.js beside it, to read the file it
// flushes, and gen-launchd.js, under a folder with & in its name, to read the plist it renders.
//
// NEVER. Writes into this checkout, reaches a network, or registers or queries a scheduled task: every
// module here is called as a function, and nothing spawns a scheduler.
//
// Usage: node scripts/tests/test-generator-libs-contract.mjs
// Exit: 0 every assertion held - 1 one failed

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alex-gen-libs-')));
const REPO = path.join(ROOT, 'repo');
const SOURCES = [
  'CLAUDE.md',
  'brand/config/color-system.md',
  'brand/config/brand-config.md',
  'system/manifest.json',
  'scheduler/schedule.md',
  'docs/README.md',
  'docs/projects/README.md',
  'variants/online/scheduler/schedule.md'
];
/** @param {string} name */
const lib = (name) => require(path.join(REPO, 'scripts', 'lib', name));
/** @param {string} rel */
const src = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
/**
 * @param {string} rel
 * @param {string} text
 */
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(REPO, rel)), { recursive: true });
  fs.writeFileSync(path.join(REPO, rel), text);
};
/**
 * The message a call throws, or null when it returns.
 * @param {() => unknown} fn
 */
const thrown = (fn) => {
  try {
    fn();
  } catch (/** @type {any} */ e) {
    return e.message;
  }
  return null;
};
/**
 * Run fn with one source replaced (or removed), restoring it after.
 * @template T
 * @param {string} rel
 * @param {string | null} text
 * @param {() => T} fn
 * @returns {T}
 */
function withSource(rel, text, fn) {
  const abs = path.join(REPO, rel);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  if (text === null) fs.rmSync(abs, { force: true });
  else put(rel, text);
  try {
    return fn();
  } finally {
    if (before === null) fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, before);
  }
}

before(() => {
  for (const f of fs.readdirSync(path.join(KIT, 'scripts', 'lib'))) {
    const p = path.join(KIT, 'scripts', 'lib', f);
    if (fs.statSync(p).isFile()) {
      fs.mkdirSync(path.join(REPO, 'scripts', 'lib'), { recursive: true });
      fs.copyFileSync(p, path.join(REPO, 'scripts', 'lib', f));
    }
  }
  for (const f of fs.readdirSync(path.join(KIT, 'templates'))) {
    fs.mkdirSync(path.join(REPO, 'templates'), { recursive: true });
    fs.copyFileSync(path.join(KIT, 'templates', f), path.join(REPO, 'templates', f));
  }
  for (const rel of SOURCES)
    if (fs.existsSync(path.join(KIT, rel))) put(rel, fs.readFileSync(path.join(KIT, rel), 'utf8'));
});
after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('read-sources: loadModel and the parse contracts', () => {
  test('the unedited sources load: counts, jobs, MCP names and colour tokens', () => {
    const m = lib('read-sources.js').loadModel();
    assert.equal(m.repo, REPO);
    assert.equal(m.soul, null, 'soul.md is optional');
    assert.ok(
      m.manifest.projects.length > 0 &&
        m.schedule.allJobNames.length > 0 &&
        m.mcpList.length > 0 &&
        m.colorTokens.tokens.size > 0
    );
    assert.deepEqual(Object.keys(m.counts), ['automationCount', 'liveCount', 'retiredCount', 'unnumberedCount']);
  });

  test('every refusal, in the order loadModel reaches it', () => {
    const { loadModel } = lib('read-sources.js');
    const manifest = src('system/manifest.json');
    const m = JSON.parse(manifest);
    /** @type {[string, string | null, string][]} */
    const cases = [
      ['CLAUDE.md', null, 'read-sources: missing required source CLAUDE.md'],
      ['brand/config/color-system.md', null, 'read-sources: missing required source brand/config/color-system.md'],
      ['brand/config/brand-config.md', null, 'read-sources: missing required source brand/config/brand-config.md'],
      ['system/manifest.json', null, 'read-sources: missing required source system/manifest.json'],
      [
        'system/manifest.json',
        JSON.stringify({ ...m, projects: [] }),
        'read-sources: system/manifest.json has no projects[]'
      ],
      [
        'system/manifest.json',
        JSON.stringify({ ...m, meta: { ...m.meta, unnumbered: undefined } }),
        'read-sources: system/manifest.json meta.unnumbered missing'
      ],
      ['scheduler/schedule.md', null, 'read-sources: missing required source scheduler/schedule.md'],
      ['scheduler/schedule.md', '# no entries here\n', 'read-sources: scheduler/schedule.md has no "### " entries'],
      [
        'CLAUDE.md',
        '# a constitution\n\n## Something\n\ntext\n',
        'read-sources: CLAUDE.md has no "## MCP Reference" section'
      ],
      [
        'CLAUDE.md',
        '# a constitution\n\n## MCP Reference\nno bold entries\n\n## Next\n',
        'read-sources: MCP Reference parse produced zero entries'
      ],
      [
        'brand/config/color-system.md',
        '# no palette table\n',
        'read-sources: color-system.md palette table parse produced zero tokens'
      ],
      [
        'soul.md',
        '# Soul\n\n## Voice Rules\n- x\n',
        'read-sources: soul.md exists but has no "## My Words" section - the voice corpus lives there and every draft reads it'
      ],
      [
        'soul.md',
        '# Soul\n\n## My Words\n- x\n',
        'read-sources: soul.md exists but has no "## Voice Rules" section - without it there is nothing to hold prose to'
      ]
    ];
    for (const [rel, text, message] of cases)
      assert.equal(
        withSource(rel, text, () => thrown(loadModel)),
        message,
        `${rel}: ${message}`
      );
    let parseMessage;
    try {
      JSON.parse('{ not json');
    } catch (/** @type {any} */ e) {
      parseMessage = e.message;
    }
    assert.equal(
      withSource('system/manifest.json', '{ not json', () => thrown(loadModel)),
      `read-sources: system/manifest.json is not valid JSON: ${parseMessage}`
    );
    const soul = '# Soul\n\n## Voice Rules\n- x\n\n## My Words\n- y\n';
    assert.equal(
      withSource('soul.md', soul, () => thrown(loadModel)),
      null,
      'a soul.md with both sections loads'
    );
    assert.equal(
      withSource('soul.md', soul, () => loadModel().soul),
      soul
    );
  });

  test('PINNED DEFECT R6-22: brand/config/brand-config.md is required, and nothing the generator renders reads it', () => {
    const libs = fs
      .readdirSync(path.join(REPO, 'scripts', 'lib'))
      .filter((f) => f !== 'read-sources.js' && f.endsWith('.js'));
    const readers = libs.filter((f) => /brandConfig|brand-config\.md/.test(src(`scripts/lib/${f}`)));
    assert.deepEqual(readers, [], 'no library but read-sources names it');
    assert.equal(
      withSource('brand/config/brand-config.md', null, () => thrown(lib('read-sources.js').loadModel)),
      'read-sources: missing required source brand/config/brand-config.md'
    );
  });

  test('PINNED DEFECT R6-22: an MCP Reference that is the LAST section of CLAUDE.md is reported as missing', () => {
    const { parseMcpList } = lib('read-sources.js');
    assert.equal(
      thrown(() => parseMcpList('# c\n\n## MCP Reference\n**Exa:** search\n')),
      'read-sources: CLAUDE.md has no "## MCP Reference" section'
    );
    assert.deepEqual(parseMcpList('# c\n\n## MCP Reference\n**Exa:** search\n\n## After\n'), ['Exa']);
  });

  test('the MCP parse contract V4 shares: bold leads, descriptor cut at " - " or ":", MCP guidance skipped, shared first words collapsed', () => {
    const { parseMcpList } = lib('read-sources.js');
    const text =
      '## MCP Reference\n**MCP tools are deferred.** x\n**Notion pages:** a\n**Notion databases - rows** b\n**Gmail.** c\n**Google Calendar:** d\nplain line\n\n## Next\n';
    assert.deepEqual(parseMcpList(text), ['Notion', 'Gmail', 'Google Calendar']);
  });

  test('PINNED DEFECT R6-22: validateCadenceSchema checks first_fire by shape only, and calls a missing first_fire "dated"', () => {
    const { validateCadenceSchema } = lib('read-sources.js');
    const m = JSON.parse(src('system/manifest.json'));
    const row = { ...m.projects[0], first_fire: '2026-02-31', first_fire_kind: 'live' };
    assert.equal(
      thrown(() => validateCadenceSchema({ projects: [row], meta: { unnumbered: [] } })),
      null,
      'February the 31st is accepted'
    );
    const bare = { ...m.projects[0] };
    delete bare.first_fire;
    bare.first_fire_kind = null;
    const where = `projects[] #${bare.num} ${bare.name}`;
    assert.equal(
      thrown(() => validateCadenceSchema({ projects: [bare], meta: { unnumbered: [] } })),
      `read-sources: system/manifest.json cadence schema invalid:\n  - ${where}: first_fire must be null or YYYY-MM-DD (got undefined)\n  - ${where}: first_fire dated but first_fire_kind is null (say whether it was live or a drill)`
    );
  });

  test('parseScheduleJobs: any Alex- token anywhere is a documented job, retries excluded', () => {
    const { parseScheduleJobs } = lib('read-sources.js');
    const md =
      '### One\n- Command: /one\n- Frequency: daily 09:00 (Task Scheduler job Alex-one)\n- Script: `scripts/run-one.ps1`\n\n## Notes\nSee Alex-prose-only and Alex-retry-one-2.\n\n## Transient tasks (not standing jobs)\n- Alex-catchup and Alex-retry-one-3\n';
    const s = parseScheduleJobs(md);
    assert.deepEqual(s.allJobNames, ['Alex-one', 'Alex-prose-only']);
    assert.equal(s.entries.length, 1);
    assert.deepEqual(
      { ...s.entries[0], text: undefined },
      {
        name: 'One',
        command: '/one',
        frequency: 'daily 09:00 (Task Scheduler job Alex-one)',
        script: 'scripts/run-one.ps1',
        jobNames: ['Alex-one', 'Alex-prose-only'],
        text: undefined
      }
    );
  });

  test('PINNED DEFECT R6-22: retry names kept as transient', () => {
    const { parseScheduleJobs } = lib('read-sources.js');
    const md =
      '### One\n- Command: /one\n- Frequency: daily 09:00 (Task Scheduler job Alex-one)\n- Script: `scripts/run-one.ps1`\n\n## Notes\nSee Alex-prose-only and Alex-retry-one-2.\n\n## Transient tasks (not standing jobs)\n- Alex-catchup and Alex-retry-one-3\n';
    const s = parseScheduleJobs(md);
    assert.deepEqual(s.transientJobNames, ['Alex-catchup', 'Alex-retry-one-3']);
  });

  test('PINNED DEFECT R6-22: a registry without utility_commands is not refused by loadModel; the docs renderer dies on it as a raw TypeError', () => {
    const { loadModel } = lib('read-sources.js');
    const m = JSON.parse(src('system/manifest.json'));
    delete m.meta.utility_commands;
    const message = withSource('system/manifest.json', JSON.stringify(m), () => {
      const model = loadModel();
      return thrown(() => lib('gen-docs.js').genGettingStarted(model));
    });
    assert.equal(message, "Cannot read properties of undefined (reading 'map')");
  });
});

describe('render-templates', () => {
  test('the refusals: a missing template, a missing block, a null value, an unresolved slot', () => {
    const rt = lib('render-templates.js');
    assert.equal(
      thrown(() => rt.loadTemplate('zz-none')),
      `render-templates: missing template ${path.join('templates', 'zz-none.template.md')}`
    );
    assert.equal(
      thrown(() => rt.block('<!-- BLOCK:A -->\nx\n', 'B')),
      'render-templates: block B not found'
    );
    assert.equal(
      thrown(() => rt.fill('{{A}}', { A: null }, 'ctx')),
      'render-templates: ctx: value for {{A}} is null'
    );
    assert.equal(
      thrown(() => rt.fill('{{A}} {{B}}', { A: 'x' }, 'ctx')),
      'render-templates: unresolved placeholder(s) in ctx: {{B}}'
    );
    assert.equal(rt.block('<!-- BLOCK:A -->\none\n\n<!-- BLOCK:B -->\ntwo\n', 'A'), 'one\n');
  });

  test('PINNED DEFECT R6-20: a {{SLOT}} inside a value aborts the render, and a value can fill a later slot', () => {
    const rt = lib('render-templates.js');
    assert.equal(
      thrown(() => rt.fill('{{A}}', { A: 'the owner typed {{NAME}}' }, 'ctx')),
      'render-templates: unresolved placeholder(s) in ctx: {{NAME}}'
    );
    assert.equal(rt.fill('{{A}} and {{B}}', { A: '{{B}}', B: 'b' }, 'ctx'), 'b and b');
  });
});

describe('gen-routing-table and gen-claude-region', () => {
  const man = {
    projects: [
      {
        num: 7,
        title: 'A|B',
        commands: ['a'],
        state: 'LIVE',
        revisit: null,
        trigger: 'x|y',
        one_liner: 'one|liner',
        work_dir: 'work/07-a',
        status_md: 'vault/projects/a/status.md',
        docs: '07-a.md'
      }
    ],
    meta: { unnumbered: [] }
  };
  test('PINNED DEFECT R6-21: a | in a title is not escaped, so its row has one cell too many; trigger and one-liner are escaped', () => {
    const t = lib('gen-routing-table.js');
    assert.equal(t.projectRows(man), '| 07 | [A|B](07-a.md) | LIVE | one\\|liner |');
    assert.equal(
      t.routingRows(man),
      '| 07 | /a | LIVE | x\\|y | one\\|liner | work/07-a - vault/projects/a/status.md |'
    );
  });
  test('regenerate replaces exactly the marked region and refuses a missing, doubled or reversed pair', () => {
    const r = lib('gen-claude-region.js');
    const B = '<!-- ROUTING-TABLE:BEGIN x -->',
      E = '<!-- ROUTING-TABLE:END -->';
    assert.equal(r.regenerate(`top\n${B}\nold\n${E}\nbottom\n`, 'NEW\n\n'), 'top\nNEW\nbottom\n');
    assert.equal(
      thrown(() => r.regenerate(`${B}\n${B}\n${E}`, 'x')),
      'gen-claude-region: CLAUDE.md must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=2, END=1)'
    );
    assert.equal(
      thrown(() => r.regenerate(`${B}\n`, 'x')),
      'gen-claude-region: CLAUDE.md must contain exactly one ROUTING-TABLE BEGIN and END marker (found BEGIN=1, END=0)'
    );
    assert.equal(
      thrown(() => r.regenerate(`${E}\n${B}\n`, 'x')),
      'gen-claude-region: CLAUDE.md markers are out of order (END before BEGIN)'
    );
  });
});

describe('gen-routines', () => {
  const good = {
    name: 'zz',
    prompt_file: 'scheduler/routines/zz.md',
    preset: 'daily',
    time_local: '03:00',
    cadence_hours: 24,
    environment: 'Routine',
    connectors: [],
    repositories: 'owner',
    model: 'm',
    first_run_check: 'look'
  };
  test('every routines[] refusal names the row and the field', () => {
    const { routineRows } = lib('gen-routines.js');
    const rows = (/** @type {unknown} */ r) => thrown(() => routineRows({ routines: r }));
    assert.deepEqual(routineRows({}), []);
    assert.equal(rows({}), 'system/manifest.json routines must be an array');
    assert.equal(rows([null]), 'routines[0]: not an object');
    const { model, ...noModel } = good;
    assert.equal(rows([noModel]), 'routines[0] (zz): missing field model');
    assert.equal(
      rows([{ ...good, extra: 1 }]),
      'routines[0] (zz): unknown field extra (the row shape is cadence_hours, connectors, environment, first_run_check, model, name, preset, prompt_file, repositories, time_local)'
    );
    assert.equal(rows([{ ...good, name: 'ZZ' }]), 'routines[0] (ZZ): name must be a lowercase job name (got "ZZ")');
    assert.equal(rows([good, good]), 'routines[1] (zz): duplicate name zz');
    assert.equal(
      rows([{ ...good, prompt_file: 'docs/zz.md' }]),
      'routines[0] (zz): prompt_file must be a .md file under scheduler/routines/ (got "docs/zz.md")'
    );
    assert.equal(
      rows([{ ...good, preset: 'hourly' }]),
      'routines[0] (zz): preset must be one of daily | weekdays | weekly (got "hourly")'
    );
    assert.equal(
      rows([{ ...good, time_local: '3pm' }]),
      'routines[0] (zz): time_local must be HH:MM, with a weekday in front for a weekly preset (got "3pm")'
    );
    assert.equal(
      rows([{ ...good, preset: 'weekly' }]),
      'routines[0] (zz): a weekly preset names its weekday in time_local, a daily or weekdays preset does not (got "03:00")'
    );
    assert.equal(
      rows([{ ...good, cadence_hours: 0 }]),
      'routines[0] (zz): cadence_hours must be a positive integer (got 0)'
    );
    assert.equal(
      rows([{ ...good, environment: 'Default' }]),
      'routines[0] (zz): environment must be one of Routine | Armed (got "Default")'
    );
    assert.equal(
      rows([{ ...good, connectors: [''] }]),
      'routines[0] (zz): connectors must be an array of connector names (the list to KEEP; [] = none)'
    );
    assert.equal(
      rows([{ ...good, repositories: 'all' }]),
      'routines[0] (zz): repositories must be one of owner | owner+mirror (got "all")'
    );
    assert.equal(rows([{ ...good, model: '' }]), 'routines[0] (zz): model must be a model id');
    assert.equal(rows([{ ...good, first_run_check: 'a\nb' }]), 'routines[0] (zz): first_run_check must be ONE line');
  });

  test('the online schedule renderer refuses when the hand-written variant is missing', () => {
    const g = lib('gen-routines.js');
    const model = { manifest: { routines: [good] } };
    assert.equal(
      withSource(g.ONLINE_SCHEDULE_REL, null, () => thrown(() => g.genOnlineSchedule(model))),
      'gen-routines: variants/online/scheduler/schedule.md is missing; the hand-written variant carries the markers this renderer fills'
    );
  });

  test('PINNED DEFECT R6-12: the rendered prose says "never two Routines in the same hour" and "after the five exist" whatever the rows say', () => {
    const g = lib('gen-routines.js');
    const clash = [
      { ...good, name: 'a', preset: 'weekly', time_local: 'Sunday 04:15' },
      { ...good, name: 'b', preset: 'weekly', time_local: 'Sunday 04:45', prompt_file: 'scheduler/routines/b.md' }
    ];
    const section = g.scheduleSection(clash);
    assert.ok(
      section.includes('**The stagger rule.** Never two Routines in the same hour'),
      'the rule is printed above two rows in the same hour'
    );
    assert.ok(
      section.includes('`brief` carries 72 hours rather than 24'),
      'a row that is not in this table is described'
    );
    assert.ok(
      section.startsWith(
        '<!-- ROUTINES:BEGIN (generated from system/manifest.json routines[] by scripts/generate-alex.js - edit the registry, then regenerate; do NOT hand-edit) -->\n'
      )
    );
    assert.ok(section.endsWith('\n<!-- ROUTINES:END -->'));
    assert.ok(section.includes('\n2 runs a week, every one of them token-bearing'));
    const forms = g.genRoutinesForms({
      manifest: { routines: clash, meta: { model_routing: { default: 'm' } } }
    }).content;
    assert.ok(forms.includes('\n## After the five exist\n'), 'two rows, and the page says five');
  });
});

describe('gen-command-headers', () => {
  const target = {
    rel: '.claude/commands/x.md',
    command: 'x',
    project: {
      num: 7,
      state: 'LIVE',
      trigger: 'daily 05:00',
      work_dir: 'work/07-x',
      status_md: 'vault/projects/x/status.md'
    }
  };
  const BEGIN =
    '<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->';
  const END = '<!-- ALEX:CMD-HEADER:END -->';
  const BLOCK = [
    BEGIN,
    '> **#07 /x · LIVE · Trigger: daily 05:00**',
    '> Registry: `system/manifest.json` · Spec: `work/07-x/CLAUDE.md` · Status: `vault/projects/x/status.md`',
    '> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*',
    END
  ].join('\n');
  test('the block, byte for byte, which V15 compares against', () => {
    const h = lib('gen-command-headers.js');
    assert.equal(h.block(target), BLOCK);
    assert.deepEqual(h.HEADER_STATES, ['LIVE', 'EVENT']);
  });
  test('apply inserts under the H1, replaces an existing block, and refuses a reversed or lone marker', () => {
    const h = lib('gen-command-headers.js');
    assert.equal(h.apply('# X\nbody\n', target), `# X\n\n${BLOCK}\nbody\n`);
    assert.equal(h.apply(`# X\n\n${BEGIN}\nold\n${END}\nbody\n`, target), `# X\n\n${BLOCK}\nbody\n`);
    assert.equal(
      thrown(() => h.apply(`${END}\n${BEGIN}\n`, target)),
      'gen-command-headers: .claude/commands/x.md markers out of order (END before BEGIN)'
    );
    assert.equal(
      thrown(() => h.apply(`# X\n${BEGIN}\n`, target)),
      'gen-command-headers: .claude/commands/x.md has one CMD-HEADER marker but not the other - a human must look before any tool writes'
    );
  });
  test('PINNED DEFECT R6-29: a second marker pair survives untouched, and a file with no H1 gets the block above its frontmatter', () => {
    const h = lib('gen-command-headers.js');
    const twice = `# X\n\n${BEGIN}\nold\n${END}\n\n${BEGIN}\nsecond\n${END}\n`;
    assert.equal(h.apply(twice, target), `# X\n\n${BLOCK}\n\n${BEGIN}\nsecond\n${END}\n`);
    assert.equal(h.apply('---\ndescription: x\n---\nbody\n', target), `${BLOCK}\n\n---\ndescription: x\n---\nbody\n`);
  });
});

describe('gen-tokens', () => {
  test('the CSS and JSON outputs for a token table', () => {
    const t = lib('gen-tokens.js');
    const tokens = {
      tokens: new Map([
        ['Ink Black', '#000000'],
        ['Dark Teal', '#00aabb']
      ])
    };
    assert.equal(
      t.tokensCss(tokens),
      `/* ${t.HEADER}.\n   One custom property per named token in the color law (core palette + extended palette).\n   Regenerate with: node scripts/generate-alex.js --only=tokens */\n:root {\n  --color-ink-black: #000000;\n  --color-dark-teal: #00aabb;\n}\n`
    );
    assert.equal(
      t.tokensJson(tokens),
      `${JSON.stringify({ _generated: t.HEADER, _source: 'brand/config/color-system.md', tokens: { 'Ink Black': '#000000', 'Dark Teal': '#00aabb' } }, null, 2)}\n`
    );
    assert.equal(t.CSS_REL, 'brand/tokens/tokens.css');
    assert.equal(t.JSON_REL, 'brand/tokens/tokens.json');
  });
  test('PINNED DEFECT R6-23: two token names that kebab to one name emit the same custom property twice', () => {
    const t = lib('gen-tokens.js');
    const css = t.tokensCss({
      tokens: new Map([
        ['Dark Teal', '#00aabb'],
        ['dark-teal', '#112233']
      ])
    });
    assert.equal(css.split('--color-dark-teal:').length - 1, 2);
  });
});

describe('gen-scheduler.parseFrequency (Windows triggers)', () => {
  test("the phrases the Kit's schedule uses", () => {
    const { parseFrequency } = lib('gen-scheduler.js');
    assert.deepEqual(parseFrequency('logon'), ['/sc', 'ONLOGON']);
    assert.deepEqual(parseFrequency('logon + 10 min (Task Scheduler job Alex-x)'), [
      '/sc',
      'ONLOGON',
      '/delay',
      '0010:00'
    ]);
    assert.deepEqual(parseFrequency('weekly Monday 07:30 (Task Scheduler job Alex-x)'), [
      '/sc',
      'WEEKLY',
      '/d',
      'MON',
      '/st',
      '07:30'
    ]);
    assert.deepEqual(parseFrequency('monthly on the 1 at 10:00'), ['/sc', 'MONTHLY', '/d', '1', '/st', '10:00']);
    assert.deepEqual(parseFrequency('weekdays 08:00'), ['/sc', 'WEEKLY', '/d', 'MON,TUE,WED,THU,FRI', '/st', '08:00']);
    assert.deepEqual(parseFrequency('monthly, last day 20:00'), [
      '/sc',
      'MONTHLY',
      '/mo',
      'LASTDAY',
      '/m',
      '*',
      '/st',
      '20:00'
    ]);
    assert.deepEqual(parseFrequency('daily 9:05 pm'), ['/sc', 'DAILY', '/st', '21:05']);
    assert.equal(parseFrequency('whenever it suits'), null);
    assert.equal(parseFrequency(''), null);
  });
  test('PINNED DEFECT R6-9 and R6-19: misreads that go through silently, and an hour that does not exist', () => {
    const { parseFrequency } = lib('gen-scheduler.js');
    assert.deepEqual(
      parseFrequency('monthly, first Monday 10:00'),
      ['/sc', 'WEEKLY', '/d', 'MON', '/st', '10:00'],
      'a monthly job becomes weekly'
    );
    assert.deepEqual(
      parseFrequency('3x daily 09:00'),
      ['/sc', 'DAILY', '/st', '09:00'],
      'three times a day becomes once'
    );
    assert.deepEqual(
      parseFrequency('every 2 days 08:00'),
      ['/sc', 'DAILY', '/st', '08:00'],
      'every other day becomes daily'
    );
    assert.deepEqual(parseFrequency('daily 25:00'), ['/sc', 'DAILY', '/st', '25:00'], 'hour 25 is passed through');
  });
});

describe('gen-launchd (macOS)', () => {
  test("the frequency grammar, refuse-don't-guess included", () => {
    const { parseMacFrequency } = lib('gen-launchd.js');
    assert.deepEqual(parseMacFrequency('daily 07:30'), { calendar: { Hour: 7, Minute: 30 } });
    assert.deepEqual(parseMacFrequency('weekly on Monday at 07:30'), { calendar: { Weekday: 1, Hour: 7, Minute: 30 } });
    assert.deepEqual(parseMacFrequency('monthly on the 1 at 10:00'), { calendar: { Day: 1, Hour: 10, Minute: 0 } });
    assert.deepEqual(parseMacFrequency('login'), { runAtLoad: true });
    assert.equal(parseMacFrequency('monthly, first Monday 10:00'), null);
    assert.equal(parseMacFrequency('logon + 10 min'), null);
  });
  test('PINNED DEFECT R6-19: hours and minutes are not range-checked', () => {
    assert.deepEqual(lib('gen-launchd.js').parseMacFrequency('daily 25:99'), { calendar: { Hour: 25, Minute: 99 } });
  });
  test('PINNED DEFECT R6-19: a checkout under a folder with & in its name renders a plist with a raw &, which is not XML', () => {
    const odd = path.join(ROOT, 'R&D', 'kit');
    fs.mkdirSync(path.join(odd, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'scripts', 'lib', 'gen-launchd.js'),
      path.join(odd, 'scripts', 'lib', 'gen-launchd.js')
    );
    const plist = require(path.join(odd, 'scripts', 'lib', 'gen-launchd.js')).renderPlist('Alex-zz', {
      calendar: { Hour: 1, Minute: 2 }
    });
    assert.ok(plist.includes(`<key>WorkingDirectory</key><string>${odd}</string>`), 'the folder is written as it is');
    assert.ok(odd.includes('&') && !plist.includes('&amp;'));
  });
});

describe('text contracts other files read from these modules', () => {
  test('gen-launchd.js line 17 is the launchd sleep-replay note that two docs cite by line number', () => {
    const line17 = src('scripts/lib/gen-launchd.js').split(/\r?\n/)[16];
    assert.match(line17, /launchd replays a StartCalendarInterval missed during sleep/);
    const citing = ['scheduler/schedule.md', 'work/15-radar/CLAUDE.md']
      .filter((rel) => fs.existsSync(path.join(KIT, rel)))
      .map((rel) => fs.readFileSync(path.join(KIT, rel), 'utf8'))
      .filter((t) => t.includes('gen-launchd.js:'));
    for (const t of citing)
      assert.deepEqual(
        [...t.matchAll(/gen-launchd\.js:(\d+)/g)].map((m) => m[1]),
        ['17']
      );
  });
  test('the portability pragma P6 reads stays on the line that names run-job.mjs', () => {
    const line = src('scripts/lib/gen-launchd.js')
      .split(/\r?\n/)
      .find((l) => l.includes('node scripts/run-job.mjs'));
    assert.ok(line?.includes('(portability-ok: '), line);
  });
  test('skill-state.js stays CommonJS: bootstrap.mjs reads it as (await import(...)).default', async () => {
    const m = (await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'skill-state.js')).href)).default;
    assert.deepEqual(Object.keys(m), [
      'resolve',
      'readProfile',
      'parseMandatory',
      'skillLinkTarget',
      'linkSkill',
      'PROFILE_REL'
    ]);
  });
});

describe('log', () => {
  test('step prints the message and keeps a stamped line; flush writes refactor/last-run.log; a failed flush says so on stderr', () => {
    const log = lib('log.js');
    assert.equal(log.LOG_PATH, path.join(REPO, 'refactor', 'last-run.log'));
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    const realLog = console.log,
      realErr = console.error;
    console.log = (m) => out.push(m);
    console.error = (m) => err.push(m);
    try {
      log.step('first step');
      log.step('second step');
      log.flush();
      fs.rmSync(path.join(REPO, 'refactor'), { recursive: true, force: true });
      fs.writeFileSync(path.join(REPO, 'refactor'), 'a file where the folder goes\n');
      log.flush();
    } finally {
      console.log = realLog;
      console.error = realErr;
      fs.rmSync(path.join(REPO, 'refactor'), { force: true });
    }
    assert.deepEqual(out, ['first step', 'second step']);
    assert.equal(err.length, 1);
    assert.ok(err[0].startsWith(`log: could not write ${log.LOG_PATH}: `), err[0]);
  });
  test('the flushed file: one ISO-stamped line per step, LF-terminated', () => {
    const logPath = path.join(ROOT, 'fresh-log');
    fs.mkdirSync(path.join(logPath, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'scripts', 'lib', 'log.js'), path.join(logPath, 'scripts', 'lib', 'log.js'));
    fs.copyFileSync(
      path.join(REPO, 'scripts', 'lib', 'repo-root.js'),
      path.join(logPath, 'scripts', 'lib', 'repo-root.js')
    );
    const log = require(path.join(logPath, 'scripts', 'lib', 'log.js'));
    const realLog = console.log;
    console.log = () => {};
    try {
      log.step('a');
      log.step('b');
      log.flush();
    } finally {
      console.log = realLog;
    }
    const text = fs.readFileSync(path.join(logPath, 'refactor', 'last-run.log'), 'utf8');
    assert.match(
      text,
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] a\n\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] b\n$/
    );
  });
});

describe('the region refusals gen-routines and gen-docs print, word for word', () => {
  const ROUTINES_BEGIN = '<!-- ROUTINES:BEGIN (a note) -->';
  const ROUTINES_END = '<!-- ROUTINES:END -->';
  const TABLE_BEGIN = '<!-- PROJECT-TABLE:BEGIN (a note) -->';
  const TABLE_END = '<!-- PROJECT-TABLE:END -->';
  test("gen-routines' regenerateRegion replaces the region, and refuses a doubled, missing or reversed pair under the label it is given", () => {
    const { regenerateRegion } = lib('gen-routines.js');
    const [B, E, label] = [ROUTINES_BEGIN, ROUTINES_END, 'elsewhere/schedule.md'];
    assert.equal(regenerateRegion(`top\n${B}\nold\n${E}\nbottom\n`, 'NEW\n\n', label), 'top\nNEW\nbottom\n');
    assert.equal(
      thrown(() => regenerateRegion(`${B}\n${B}\n${E}\n`, 'x', label)),
      'gen-routines: elsewhere/schedule.md must contain exactly one ROUTINES BEGIN and END marker (found BEGIN=2, END=1)'
    );
    assert.equal(
      thrown(() => regenerateRegion(`${B}\n`, 'x', label)),
      'gen-routines: elsewhere/schedule.md must contain exactly one ROUTINES BEGIN and END marker (found BEGIN=1, END=0)'
    );
    assert.equal(
      thrown(() => regenerateRegion(`${E}\n${B}\n`, 'x', label)),
      'gen-routines: elsewhere/schedule.md markers are out of order (END before BEGIN)'
    );
  });
  test('genOnlineSchedule fills the region of the online schedule, and refuses its broken markers naming that file', () => {
    const g = lib('gen-routines.js');
    const model = { manifest: { routines: [] } };
    const [B, E] = [ROUTINES_BEGIN, ROUTINES_END];
    const refusal = (/** @type {string} */ text) =>
      withSource(g.ONLINE_SCHEDULE_REL, text, () => thrown(() => g.genOnlineSchedule(model)));
    assert.deepEqual(
      withSource(g.ONLINE_SCHEDULE_REL, `top\n${B}\nold\n${E}\ntail\n`, () => g.genOnlineSchedule(model)),
      { rel: 'variants/online/scheduler/schedule.md', content: `top\n${g.scheduleSection([])}\ntail\n` }
    );
    assert.equal(
      refusal(`${B}\n${B}\n${E}\n`),
      'gen-routines: variants/online/scheduler/schedule.md must contain exactly one ROUTINES BEGIN and END marker (found BEGIN=2, END=1)'
    );
    assert.equal(
      refusal(`${B}\n`),
      'gen-routines: variants/online/scheduler/schedule.md must contain exactly one ROUTINES BEGIN and END marker (found BEGIN=1, END=0)'
    );
    assert.equal(
      refusal(`${E}\n${B}\n`),
      'gen-routines: variants/online/scheduler/schedule.md markers are out of order (END before BEGIN)'
    );
  });
  test("genReadme refuses docs/README.md when its welcome block's markers are doubled, missing or reversed", () => {
    const { genReadme } = lib('gen-docs.js');
    const model = lib('read-sources.js').loadModel();
    const [S, E] = ['<!-- CUSTOM_START -->', '<!-- CUSTOM_END -->'];
    const refusal = (/** @type {string} */ text) =>
      withSource('docs/README.md', text, () => thrown(() => genReadme(model)));
    assert.equal(
      refusal(`${S}\n${S}\nwelcome\n${E}\n`),
      'gen-docs: docs/README.md must contain exactly one custom zone (found START=2, END=1)'
    );
    assert.equal(
      refusal(`${S}\nwelcome\n`),
      'gen-docs: docs/README.md must contain exactly one custom zone (found START=1, END=0)'
    );
    assert.equal(refusal(`${E}\nwelcome\n${S}\n`), 'gen-docs: docs/README.md custom-zone markers are out of order');
  });
  test('genProjectsReadme refuses docs/projects/README.md when its PROJECT-TABLE markers are doubled, missing or reversed', () => {
    const { genProjectsReadme } = lib('gen-docs.js');
    const model = lib('read-sources.js').loadModel();
    const [B, E] = [TABLE_BEGIN, TABLE_END];
    const refusal = (/** @type {string} */ text) =>
      withSource('docs/projects/README.md', text, () => thrown(() => genProjectsReadme(model)));
    assert.equal(
      refusal(`${B}\n${B}\n${E}\n`),
      'gen-docs: docs/projects/README.md must contain exactly one PROJECT-TABLE BEGIN and END marker (found BEGIN=2, END=1)'
    );
    assert.equal(
      refusal(`${B}\n`),
      'gen-docs: docs/projects/README.md must contain exactly one PROJECT-TABLE BEGIN and END marker (found BEGIN=1, END=0)'
    );
    assert.equal(refusal(`${E}\n${B}\n`), 'gen-docs: docs/projects/README.md markers are out of order');
  });
  test('genProjectsReadme judges its markers before it renders: broken markers and a missing template refuse for the markers', () => {
    const { genProjectsReadme } = lib('gen-docs.js');
    const model = lib('read-sources.js').loadModel();
    const [B, E] = [TABLE_BEGIN, TABLE_END];
    const withoutTemplate = (/** @type {string} */ text) =>
      withSource('docs/projects/README.md', text, () =>
        withSource('templates/routing-table.template.md', null, () => thrown(() => genProjectsReadme(model)))
      );
    assert.equal(
      withoutTemplate(`${B}\n${B}\n${E}\n`),
      'gen-docs: docs/projects/README.md must contain exactly one PROJECT-TABLE BEGIN and END marker (found BEGIN=2, END=1)'
    );
    assert.match(
      withoutTemplate(`${B}\nold\n${E}\n`) ?? '',
      /^render-templates: missing template templates[\\/]routing-table\.template\.md$/,
      'with good markers the missing template is what refuses, so the template really is gone above'
    );
  });
});
