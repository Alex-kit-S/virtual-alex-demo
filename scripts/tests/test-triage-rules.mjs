#!/usr/bin/env node
// scripts/tests/test-triage-rules.mjs - the email triage's machine block must stay a rule set.
//
// WHAT. work/07-email-triage/rules.md carries a fenced YAML "machine block" that the triage's
// deterministic pre-pass runs FIRST (work/07-email-triage/CLAUDE.md, "Plain-English rules"). The
// model is the only parser. So a block an owner, a session or a seat breaks (a misspelt `lable:`, a
// tab, a `priority: yes`) fails in the quietest way there is: the rule is simply not applied, every
// run, and nothing says so. Fleet Fix B found nothing tested it and routed it here (Fix D, 2026-09-24).
// This is that test. It runs in the Kit and in every online owner repository, where the triage now
// writes approved sender rules into this block (a cloud session cannot keep config/).
//
// THE SHAPE, read from the spec, not invented here:
//   rules:                      a list (or `rules: []`)
//     - match: {...}            FIRST key of every item; flow `{ k: "v" }` or block form below it;
//                               keys from, fromDomain, subjectContains; at least one; string values
//       label / file_drive      a non-empty string
//       priority / skip_brief   true or false
//       draft_gate              off
//   at least one action per rule, two-space list indent, spaces only, `#` comments anywhere.
// It is deliberately TOLERANT of what YAML allows here (quoted or plain scalars, trailing comments,
// either form of `match`), because a check that fails an owner's valid rule on every push is a check
// they learn to ignore. It is strict about keys, because an unknown key is a rule that does nothing.
//
// LEGS
//   R0  the rules.md in THIS tree parses, and its commented examples parse once uncommented (they
//       are what the page tells the owner to switch on)
//   R1-R8 NEGATIVE one broken block each, each refused naming the line: a tab, an unknown action
//       key, an unknown match key, an item with no match, a non-boolean flag, a stray indent, a
//       rule with no action, a draft_gate other than off
//   R9  NEGATIVE no machine block at all, and two of them, are both refused
//   R10 the block form of `match` and a plain unquoted value are accepted
//
// HOW. Pure text; never writes. Run: node scripts/tests/test-triage-rules.mjs   (exit 0 = all pass)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = path.join(KIT, 'work', '07-email-triage', 'rules.md');

let pass = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  else { fails.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`); }
}

const MATCH_KEYS = new Set(['from', 'fromDomain', 'subjectContains']);
const ACTIONS = { label: 'string', file_drive: 'string', priority: 'bool', skip_brief: 'bool', draft_gate: 'off' };

// Strip a trailing `# comment` that is not inside quotes.
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}
function scalar(raw) {
  const v = raw.trim();
  const q = v.match(/^"([^"]*)"$/) || v.match(/^'([^']*)'$/);
  if (q) return { str: q[1], quoted: true };
  return { str: v, quoted: false };
}
function splitFlow(inner) {
  const out = []; let cur = ''; let q = null;
  for (const ch of inner) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * Parse the machine block of a rules.md text. Returns { rules, problems }, problems as
 * "rules.md:<line> <what>" strings. Line numbers are the file's own.
 */
export function checkRulesText(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  const at = (i, what) => problems.push(`rules.md:${i + 1} ${what}`);
  const head = lines.findIndex((l) => /^## The machine block/.test(l));
  if (head < 0) return { rules: [], problems: ['rules.md has no "## The machine block" heading, so the pre-pass has nothing to run'] };
  const fences = [];
  for (let i = head + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (/^```/.test(lines[i])) fences.push(i);
  const opens = fences.filter((i, k) => k % 2 === 0);
  if (fences.length === 0 || !/^```ya?ml\s*$/.test(lines[fences[0]]) || fences.length < 2) {
    return { rules: [], problems: ['rules.md has no fenced ```yaml machine block under its heading'] };
  }
  if (opens.length > 1) return { rules: [], problems: [`rules.md has ${opens.length} fenced blocks under the machine-block heading; the pre-pass reads one`] };

  const rules = [];
  let sawRules = false, item = null, inBlockMatch = false;
  // The list indent is set by the FIRST item (YAML allows "- match:" at column 0 under rules: as well
  // as indented), and every later line is judged relative to it: an action sits two columns in from
  // the dash, a block-form match key deeper than that.
  let dash = null;
  const close = () => {
    if (!item) return;
    if (!item.match) at(item.line, 'a rule with no match: the FIRST key of every item is match');
    else if (Object.keys(item.match).length === 0) at(item.line, 'a match with no key: name from, fromDomain or subjectContains');
    if (Object.keys(item.actions).length === 0) at(item.line, 'a rule with no action: it would match and do nothing');
    rules.push(item); item = null;
  };
  const addMatch = (i, k, v) => {
    if (!MATCH_KEYS.has(k)) { at(i, `unknown match key "${k}" (known: ${[...MATCH_KEYS].join(', ')}); a typo here is a rule that never matches`); return; }
    const s = scalar(v);
    if (!s.str) at(i, `match key "${k}" has no value`);
    item.match[k] = s.str;
  };
  for (let i = fences[0] + 1; i < fences[1]; i++) {
    const raw = lines[i];
    if (/\t/.test(raw)) { at(i, 'a tab; YAML indentation is spaces only'); continue; }
    const l = stripComment(raw);
    if (l.trim() === '') continue;
    if (!sawRules) {
      if (/^rules:\s*\[\s*\]$/.test(l)) { sawRules = true; continue; }
      if (/^rules:$/.test(l)) { sawRules = true; continue; }
      at(i, `expected "rules:" first, found "${l.trim()}"`); continue;
    }
    let m;
    const indent = l.match(/^ */)[0].length;
    if ((m = l.match(/^( *)- (\w+):\s*(.*)$/)) && (dash === null || m[1].length === dash)) {
      close();
      dash = m[1].length;
      item = { line: i, match: null, actions: {} };
      inBlockMatch = false;
      if (m[2] !== 'match') { at(i, `a rule must open with match:, not ${m[2]}:`); continue; }
      item.match = {};
      const rest = m[3].trim();
      if (rest === '') { inBlockMatch = true; continue; }
      const flow = rest.match(/^\{(.*)\}$/);
      if (!flow) { at(i, `match: must be a { key: "value" } mapping or a block below it, found "${rest}"`); continue; }
      for (const part of splitFlow(flow[1])) {
        const kv = part.match(/^\s*(\w+)\s*:\s*(.*)$/);
        if (!kv) { at(i, `cannot read "${part.trim()}" as key: value inside match`); continue; }
        addMatch(i, kv[1], kv[2]);
      }
      continue;
    }
    if (item && inBlockMatch && indent > dash + 2 && (m = l.match(/^ *(\w+):\s*(.*)$/))) { addMatch(i, m[1], m[2]); continue; }
    if (item && indent === dash + 2 && (m = l.match(/^ *(\w+):\s*(.*)$/))) {
      inBlockMatch = false;
      const [, k, v] = m;
      const kind = ACTIONS[k];
      if (!kind) { at(i, `unknown action "${k}" (known: ${Object.keys(ACTIONS).join(', ')}); a typo here is a rule that does nothing`); continue; }
      const s = scalar(v);
      if (kind === 'string' && !s.str) at(i, `${k} has no value`);
      if (kind === 'bool' && !/^(true|false)$/.test(s.str)) at(i, `${k} must be true or false, found "${s.str}"`);
      if (kind === 'off' && s.str !== 'off') at(i, `${k} takes one value, off; found "${s.str}"`);
      item.actions[k] = s.str;
      continue;
    }
    at(i, `a line the rule shape does not allow (check its indent: an action sits two columns in from its "- match:"): "${l.trim()}"`);
  }
  close();
  if (!sawRules) problems.push('rules.md machine block has no "rules:" list');
  return { rules, problems };
}

// ------------------------------------------------------------------ R0. this tree's own rules.md
const real = fs.readFileSync(RULES, 'utf8');
{
  const r = checkRulesText(real);
  ok(r.problems.length === 0, 'R0 the rules.md in this tree has a machine block of the right shape', r.problems.join(' | ') || `${r.rules.length} rule(s)`);
  // The commented examples, switched on the way the page says to: drop the leading "#" of each
  // example line. They are what an owner is told to uncomment, so they must parse.
  const lines = real.split(/\r?\n/);
  const uncommented = lines.map((l) => (/^#( {2}- match:| {4}\w+:)/.test(l) ? l.replace(/^#/, '') : l)).join('\n');
  const switched = uncommented !== real;
  const r2 = checkRulesText(uncommented);
  ok(!switched || r2.problems.length === 0, 'R0 the commented examples parse once uncommented, as the page tells the owner to do',
    switched ? (r2.problems.join(' | ') || `${r2.rules.length} rule(s) with the examples on`) : 'no commented examples in this tree');
}

// ------------------------------------------------------------------ R1-R10, one fixture each
const page = (block) => `# Email rules\n\n## The machine block (deterministic pre-pass)\nText.\n\n\`\`\`yaml\n${block}\`\`\`\n\n## Plain-English rules\n- one\n`;
const BASE = 'rules:\n  - match: { subjectContains: "receipt" }   # a comment\n    label: "Finance"\n    skip_brief: true\n';
{
  const r = checkRulesText(page(BASE));
  ok(r.problems.length === 0 && r.rules.length === 1, 'R-base the fixture baseline passes', r.problems.join(' | ') || 'ok');
}
const CASES = [
  ['R1', BASE.replace('    label', '\tlabel'), /:9 a tab/, 'a tab'],
  ['R2', BASE.replace('label:', 'lable:'), /:9 unknown action "lable"/, 'a misspelt action key'],
  ['R3', BASE.replace('subjectContains', 'subjectContain'), /:8 unknown match key "subjectContain"/, 'a misspelt match key'],
  ['R4', BASE.replace('  - match: { subjectContains: "receipt" }   # a comment\n', '  - label: "Finance"\n'), /:8 a rule must open with match:/, 'an item with no match'],
  ['R5', BASE.replace('skip_brief: true', 'skip_brief: yes'), /:10 skip_brief must be true or false/, 'a flag that is not true or false'],
  ['R6', BASE.replace('    skip_brief', '   skip_brief'), /:10 a line the rule shape does not allow/, 'a stray indent'],
  ['R7', 'rules:\n  - match: { from: "x@y.example" }\n', /:8 a rule with no action/, 'a rule with no action'],
  ['R8', `${BASE}    draft_gate: on\n`, /:11 draft_gate takes one value, off/, 'a draft_gate other than off'],
];
for (const [id, block, want, what] of CASES) {
  const r = checkRulesText(page(block));
  ok(r.problems.some((p) => want.test(p)), `${id} NEGATIVE ${what} is refused, naming the line`, r.problems.join(' | ') || 'accepted');
}
{
  const none = checkRulesText('# Email rules\n\n## The machine block\nNo block here.\n');
  const twoIn = checkRulesText(`# E\n\n## The machine block\n\n\`\`\`yaml\n${BASE}\`\`\`\n\n\`\`\`yaml\nrules: []\n\`\`\`\n`);
  ok(none.problems.some((p) => /no fenced/.test(p)), 'R9 NEGATIVE a page with no fenced machine block is refused', none.problems.join(' | '));
  ok(twoIn.problems.some((p) => /2 fenced blocks/.test(p)), 'R9 NEGATIVE two fenced blocks under the heading are refused (the pre-pass reads one)', twoIn.problems.join(' | '));
}
{
  const block = 'rules:\n  - match:\n      fromDomain: example.org    # plain value\n      from: "billing@"\n    priority: true\n  - match: { subjectContains: "invoice" }\n    file_drive: Receipts\n';
  const r = checkRulesText(page(block));
  ok(r.problems.length === 0 && r.rules.length === 2 && r.rules[0].match.fromDomain === 'example.org' && r.rules[1].actions.file_drive === 'Receipts',
    'R10 the block form of match and plain unquoted values are accepted', r.problems.join(' | ') || `${r.rules.length} rule(s)`);
}
{
  const r = checkRulesText(page('rules: []\n'));
  ok(r.problems.length === 0 && r.rules.length === 0, 'R10 an empty rule list, rules: [], is accepted', r.problems.join(' | ') || 'ok');
}
{
  const r = checkRulesText(page('rules:\n- match: {fromDomain: "example.org"}\n  label: "Finance"\n- match:\n    from: "x@"\n  priority: false\n'));
  ok(r.problems.length === 0 && r.rules.length === 2, 'R10 a list written at column 0 under rules: (valid YAML) is accepted', r.problems.join(' | ') || `${r.rules.length} rule(s)`);
}

console.log('');
if (fails.length) { console.log(`${fails.length} FAILURE(S)`); for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
console.log(`ALL PASS (${pass})`);
