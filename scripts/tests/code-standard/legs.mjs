// scripts/tests/code-standard/legs.mjs - every leg the standard's sections 2 to 8 describe.
//
// WHAT. One function per concern the standard names, each returning the common leg shape (shared.mjs's
// leg()): the header and its CLI companion, the diary, dangling-reference, commented-out-code,
// contract-tag, module-split and floor legs, the comment-suppression leg, the pinned-defect leg (with its
// own JS pin-context and fingerprinting machinery), the fourteen duplication concerns, and the sanctioned-
// and-planned-home check that keeps a CONCERNS entry honest. allLegs runs every one of them over a
// context; countedLegs is the subset the ratchet puts a ceiling on.
//
// HOW. Every leg reads only what a context from reads.mjs already holds (comments, code with comments
// blanked, JS tokens, Python docstrings and reads) and the ratchet object a caller passes in; none of
// them opens a file or runs git. The duplication legs' CONCERNS table is the standard's own item 6,
// sanctioned copy by sanctioned copy, each with the real reason in the Kit's own words. isCode re-lexes a
// comment's own text through lex.mjs's lexJs to decide whether a commented-out block still compiles;
// deadParts reuses lex.mjs's HEAD_WORDS and REGEX_AFTER_WORDS to re-derive the same regex-or-division
// rule without re-lexing the whole file.
//
// NEVER. Reads disk or runs git; a leg that needs either is reads.mjs's or direction.mjs's, not this
// file's. Writes the ratchet; ratchet.mjs owns every write, this module only supplies what a write reads.
//
// Usage: module only

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HEAD_WORDS, lexJs, REGEX_AFTER_WORDS } from './lex.mjs';
import {
  DIARY,
  DIARY_EXEMPT_FILES,
  ENCODINGS,
  FIXTURES,
  HEADER_WINDOW,
  isTestFile,
  KIT_ONLY_PREFIX,
  leg,
  licensedIds,
  TAGGABLE
} from './shared.mjs';

// ------------------------------------------------------------------------------------ helpers

function lineAt(text, index) {
  let n = 1;
  for (let k = 0; k < index && k < text.length; k++) if (text[k] === '\n') n++;
  return n;
}

// A duplication pattern that opens with `^\s*` (dup-lastline's is the one today) can anchor at the
// START of an earlier line that a comment's own removal left as blank spaces (blankRanges keeps every
// newline so line numbers still match, but \s in JavaScript matches \n too), then cross that real
// newline to reach the line the copy actually sits on. The match's own m.index is then the EARLIER
// line's start, and lineAt(text, m.index) reports it instead of the line the copied code is on. Report
// the line of the match's first NON-whitespace character instead. For every pattern that does not open
// on `\s*`, that character is m[0][0] itself, so m.index is unchanged and nothing here shifts a line.
function matchLines(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...text.matchAll(g)].map((m) => lineAt(text, m.index + /^\s*/.exec(m[0])[0].length));
}

const significant = (tokens) => tokens.filter((t) => t.t !== 'comment');

/** Index of the punctuator closing the bracket that opens at tokens[open]. */
function closing(tokens, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const want = pairs[tokens[open].v];
  let depth = 0;
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== 'punct') continue;
    if (t.v === tokens[open].v) depth++;
    else if (t.v === want && --depth === 0) return k;
  }
  return tokens.length - 1;
}

// ----------------------------------------------------------------------------------- the legs

/**
 * Every Python file Python reads in an encoding other than UTF-8, through a coding cookie. It is
 * measured all the same, so the legs still count it; this names it, because the standard's files are
 * UTF-8 and ruff refuses any other. Not a counted leg: it has no ceiling, and the checker fails on
 * any finding.
 */
export function encodingFindings(ctx) {
  return [...ctx.files, ...(ctx.extraTests || [])]
    .filter((f) => f.lang === 'python' && f.encoding && f.encoding !== 'utf-8')
    .map((f) => ({ file: f.src, line: 1, message: `Python reads it as ${f.encoding}, not UTF-8` }));
}

/** Section 1: WHAT., HOW. and NEVER. in the first 40 lines, or in a Python module docstring. */
export function headerLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    if (f.lang === 'json') continue;
    const head = f.lang === 'python' ? f.moduleDoc || '' : f.text.split('\n').slice(0, HEADER_WINDOW).join('\n');
    const missing = ['WHAT.', 'HOW.', 'NEVER.'].filter((w) => !new RegExp(`\\b${w.replace('.', '\\.')}`).test(head));
    if (missing.length) {
      const where = f.lang === 'python' ? 'its module docstring' : `its first ${HEADER_WINDOW} lines`;
      findings.push({ file: f.src, line: 1, message: `no ${missing.join(' ')} in ${where}` });
    }
  }
  return leg('header', 'files', findings);
}

/** True for the file that defines isMain: the home the dup-is-main concern names. */
const isMainHome = (src) => CONCERNS.find((c) => c.id === 'dup-is-main').home.includes(src);

/**
 * A file somebody runs: a shebang, a main guard, or a shell script. A Python main guard is what the
 * helper's ast says, in any order and by ==, in or __eq__; the pattern is for a file object built
 * without the helper.
 */
export function isCli(f) {
  if (f.lang === 'shell') return true;
  if (f.lang === 'ci' || f.lang === 'json') return false;
  if (f.text.startsWith('#!')) return true;
  if (f.lang === 'python') return f.mainGuard ?? /__name__\s*==\s*['"]__main__['"]/.test(f.code);
  const toks = significant(f.tokens);
  // The home of isMain names it to define it, not to guard a command line of its own, so there the name
  // is not a sign of a CLI, the way the dup-is-main leg leaves that home out. Any other sign still counts.
  const guards = isMainHome(f.src) ? ['invokedDirectly'] : ['isMain', 'invokedDirectly'];
  return toks.some(
    (t, k) =>
      (t.t === 'ident' && guards.includes(t.v)) ||
      (t.v === 'require' && toks[k + 1]?.v === '.' && toks[k + 2]?.v === 'main') ||
      comparesTheScriptPath(toks, k)
  );
}

const EQUALITY = new Set(['===', '==', '!==', '!=']);
const THIS_FILE = [['import', '.', 'meta', '.', 'url'], ['import', '.', 'meta', '.', 'filename'], ['__filename']];

/**
 * True when the tokens at k are process.argv[1] inside a comparison with this module's own path or URL:
 * `import.meta.url === pathToFileURL(process.argv[1]).href`, `process.argv[1] === __filename`,
 * `fileURLToPath(import.meta.url) === process.argv[1]`. Each is a main guard, whatever it is named.
 */
function comparesTheScriptPath(toks, k) {
  const at = (j, run) => run.every((v, n) => toks[j + n]?.v === v);
  if (!at(k, ['process', '.', 'argv', '[']) || toks[k + 4]?.v !== '1' || toks[k + 5]?.v !== ']') return false;
  const from = Math.max(0, k - 14);
  const window = toks.slice(from, k + 20);
  const stop = (t) => t.t === 'punct' && [';', '{', '}'].includes(t.v);
  let lo = k - from;
  while (lo > 0 && !stop(window[lo - 1])) lo--;
  let hi = k - from;
  while (hi < window.length - 1 && !stop(window[hi + 1])) hi++;
  const statement = window.slice(lo, hi + 1);
  return (
    statement.some((t) => t.t === 'punct' && EQUALITY.has(t.v)) &&
    statement.some((_, j) => THIS_FILE.some((run) => run.every((v, n) => statement[j + n]?.v === v)))
  );
}

/** Section 1: a file with a CLI carries Usage: and Exit: in its header, because its exit codes are a contract. */
export function headerCliLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    if (!isCli(f)) continue;
    const head = f.lang === 'python' ? f.moduleDoc || '' : f.text.split('\n').slice(0, HEADER_WINDOW).join('\n');
    const missing = ['Usage:', 'Exit:'].filter((w) => !head.includes(w));
    if (missing.length)
      findings.push({ file: f.src, line: 1, message: `a CLI with no ${missing.join(' or ')} in its header` });
  }
  return leg('header-cli', 'files', findings);
}

// The tag of section 8.2 opens its comment: `// contract: read as text by <file>:<line>`, where <line>
// may be a range (`:179-181`). The grammar reads every reader a line names, so that each is judged,
// and the contract leg reports a line naming more than one: section 8.2 stacks one tag line per reader.
// A reader the leg cannot see reading (a sed lift, a word-split, a hash) carries its qualifier right
// after it: `<file>:<line> (unseen: <how, three words or more>)`.
const CONTRACT_TAG = /^\s*contract: read as text by (.+)$/;
const UNSEEN = /\(unseen:([^)]*)\)/g;

/**
 * The reader sites a contract: tag names, [{file, from, to}] and `unseen` (the qualifier's how) on a
 * reader that carries one, or null when the comment is not a tag. A <file>:<line> written inside a
 * qualifier is part of its how, never a reader.
 */
export function contractRefs(text) {
  const m = CONTRACT_TAG.exec(text);
  if (!m) return null;
  const body = m[1];
  const blanked = body.replace(UNSEEN, (q) => ' '.repeat(q.length));
  return [...blanked.matchAll(/([\w./-]+?):(\d+)(?:-(\d+))?(?![\w-])/g)].map((x) => {
    const q = /^\s*\(unseen:([^)]*)\)/.exec(body.slice(x.index + x[0].length));
    return { file: x[1], from: Number(x[2]), to: Number(x[3] ?? x[2]), ...(q ? { unseen: q[1].trim() } : {}) };
  });
}

/** A well-formed tag: `contract: read as text by` and at least one <file>:<line>. */
const isContractLine = (text) => (contractRefs(text) ?? []).length > 0;

/**
 * The first token of a JavaScript file's code: the first token that is not a comment and not part of
 * the directive prologue ('use strict';), which many files put above their header.
 */
function firstCodeToken(tokens) {
  const sig = significant(tokens);
  let k = 0;
  while (sig[k]?.t === 'string' && (sig[k + 1]?.v === ';' || sig[k + 1]?.line > sig[k].line))
    k += sig[k + 1]?.v === ';' ? 2 : 1;
  return sig[k] ?? null;
}

/**
 * True when a docstring's text has one line per source line, so text line k is source line
 * `line + k`. A \n escape adds a text line and a backslash continuation removes one; either way no
 * text line can be placed on a source line, so such a docstring places nothing.
 */
const docLinesMatch = (d) => d.text.split('\n').length - 1 === d.endLine - d.line;

/** The source line of text line k of a docstring: `line + k`, or the opening line when the two do not match. */
const docLine = (d, k) => (docLinesMatch(d) ? d.line + k : d.line);

/**
 * The lines of a file's header that belong to its NEVER. paragraph: from the header line that opens
 * with NEVER. to the first blank header line, Usage: or Exit:, inside the header only (the comments
 * before the first line of code, or the Python module docstring, when its text lines are its source
 * lines).
 */
export function neverParagraphLines(f) {
  let header;
  if (f.lang === 'python') {
    const doc = (f.docstrings || []).find((d) => d.text === f.moduleDoc);
    header = doc && docLinesMatch(doc) ? doc.text.split('\n').map((text, k) => ({ line: doc.line + k, text })) : [];
  } else if (f.lang === 'js') {
    const first = firstCodeToken(f.tokens);
    header = f.comments.filter((c) => !first || c.line < first.line);
  } else {
    const codeLines = f.code.split('\n');
    let first = codeLines.findIndex((l, k) => l.trim() && !(k === 0 && l.startsWith('#!')));
    if (first === -1) first = codeLines.length;
    header = f.comments.filter((c) => c.line <= first);
  }
  const lines = new Set();
  let inside = false;
  for (const { line, text } of header) {
    const body = text.trim();
    if (/^NEVER\./.test(body)) inside = true;
    else if (!body || /^(?:Usage|Exit):/.test(body) || /^(?:WHAT|HOW)\./.test(body)) inside = false;
    if (inside) lines.add(line);
  }
  return lines;
}

// A date or a static shape is not the only diary. The ratchet's own ids name a defect or a fix row,
// and a handful of phrases point at a review, a decision or a past commit; both are diary the moment
// section 2 item 4's static DIARY pattern cannot see them. A bare id of one letter run plus digits (D1,
// D5 and the like) collides with the leg labels this standard's own sections and the tests' titles
// already use, so it is left to review rather than matched here.
const BARE_RATCHET_ID = /^[A-Z]+\d+$/;
const escapeForDiary = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every id the ratchet's fix_list and pinned snapshot carry, minus a bare BARE_RATCHET_ID shape. */
export function diaryIds(ratchet) {
  const ids = new Set();
  for (const f of ratchet?.fix_list || []) ids.add(f.id);
  for (const p of ratchet?.pinned || []) for (const id of p.ids || []) ids.add(id);
  return [...ids].filter((id) => !BARE_RATCHET_ID.test(id)).sort((a, b) => b.length - a.length);
}

/** A regular expression matching any of the ratchet's diary ids as a whole token, or null when there are none. */
function diaryIdPattern(ratchet) {
  const ids = diaryIds(ratchet);
  return ids.length ? new RegExp(`(?<![A-Za-z0-9-])(${ids.map(escapeForDiary).join('|')})(?![A-Za-z0-9-])`) : null;
}

// Zero false positives measured over the scope this standard scores. A 7-to-40 hex run after "at" or
// "as of" is a commit; the four phrases ahead of it point at a past review, a decision or a past
// hotfix. The entries added since point at this effort itself, at whoever runs the ratchet's operator
// commands, at a wave by its number, at a one-word term for a background report, at a read-r or
// char-c report, and at four planning-document names from the same effort; none of them names
// anything this standard, its ratchet or its callers define. A bare "seat" or "seats" stays out: this
// leg's own doc comment above, and a test title in test-code-standard.mjs, use "seat number" to name
// what this leg matches, so that match would flag the standard describing itself.
export const DIARY_PHRASES =
  /read seat|review-w\d+|ruling \d+|hotfix \d+|fleet review|\b(?:at|as of) [0-9a-f]{7,40}\b|\brelay\b|the master\b|\bwave \d+\b|\bdossier\b|read-r\d|char-c\d|review-p5|FIX-P5|REWRITE-PLAN|RUN-STATE/;

/** Any of DIARY, the ratchet's own ids, or the phrases above, in one string; null when none matches. */
function anyDiaryMatch(text, idRe) {
  return DIARY.exec(text) || idRe?.exec(text) || DIARY_PHRASES.exec(text);
}

// A title opens a legitimate pin tag only when PINNED DEFECT sits at its very start, the shape the
// pinned leg's own PIN_TITLE pattern reads. The same phrase anywhere else in a title is a finding: a
// mid-title tag is invisible to that pattern, so it reads, to anyone searching titles for a live
// defect, as one more live tag that pattern would also have caught.
const PIN_TITLE_START = /^PINNED DEFECT\s+[^:]+:/;

/**
 * A JS call's first argument as the plain text a title check can read: a string's decoded value, or a
 * template's exact source between its backticks (substitutions included, unevaluated, the same technique
 * jsPinned already uses for a pin's own title). Anything else - an identifier, a concatenation - is null:
 * this leg reads only what is written, never what code would compute.
 */
function literalArgText(f, toks, open) {
  const first = toks[open + 1];
  if (!first) return null;
  if (first.t === 'string') return first.v;
  if (first.t === 'template') {
    const close = closing(toks, open);
    let end = open + 1;
    if (!first.close) while (end < close && !(toks[end].t === 'template' && toks[end].close)) end++;
    return f.text.slice(first.start + 1, toks[end].end - 1);
  }
  return null;
}

/**
 * Local helpers that register a node:test case and hand their own first parameter straight to it, the
 * shape `function denyCase(name, ...) { test(\`DENY ${name}\`, ...); }`. A call site's first argument is
 * then a title too.
 */
function titleHelperNames(toks, decls, nt) {
  const helpers = new Set();
  for (const [name, [start, end]] of decls) {
    let open = -1;
    for (let j = start; j < end && j < start + 12; j++) {
      if (toks[j].v === '(') {
        open = j;
        break;
      }
      if (toks[j].v === '{') break;
    }
    if (open === -1) continue;
    const param = toks[open + 1];
    if (param?.t !== 'ident') continue;
    for (let j = open; j < end && !helpers.has(name); j++) {
      if (toks[j].v !== '(') continue;
      const call = calleeOf(toks, j, nt);
      if (!call || !NODE_TEST_EXPORTS.has(call.name) || HOOKS.has(call.name)) continue;
      const arg = toks[j + 1];
      if (arg?.t === 'ident' && arg.v === param.v) helpers.add(name);
      else if (arg?.t === 'template') {
        const close = closing(toks, j);
        for (let m = j + 1; m < close; m++)
          if (toks[m].t === 'ident' && toks[m].v === param.v && toks[m - 1]?.v !== '.') {
            helpers.add(name);
            break;
          }
      }
    }
  }
  return helpers;
}

/**
 * Every title a JS test file carries: a direct test/it/describe/suite call (any alias node:test names
 * bind to), or a call to a local helper that hands its first argument straight to one of them.
 */
function jsTitles(f) {
  const toks = significant(f.tokens);
  const decls = topLevelDeclarations(toks);
  const nt = nodeTestNames(toks, decls);
  const helpers = titleHelperNames(toks, decls, nt);
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].v !== '(') continue;
    const call = calleeOf(toks, k, nt);
    const direct = call && NODE_TEST_EXPORTS.has(call.name) && !HOOKS.has(call.name);
    const name = toks[k - 1];
    const viaHelper = !direct && name?.t === 'ident' && helpers.has(name.v) && toks[k - 2]?.v !== '.';
    if (!direct && !viaHelper) continue;
    const title = literalArgText(f, toks, k);
    if (title === null) continue;
    out.push({ line: (direct ? toks[call.start] : name).line, title });
  }
  return out;
}

/** Ruling 7(c) over one JS file's titles: a mid-title PINNED DEFECT, or any other diary id or phrase. */
function jsTitleFindings(f, idRe) {
  const findings = [];
  for (const { line, title } of jsTitles(f)) {
    if (PIN_TITLE_START.test(title)) continue;
    if (title.includes('PINNED DEFECT')) {
      findings.push({
        file: f.src,
        line,
        message: `PINNED DEFECT not at the start of a title: ${JSON.stringify(title.slice(0, 90))}`
      });
      continue;
    }
    const m = anyDiaryMatch(title, idRe);
    if (m) findings.push({ file: f.src, line, message: `diary ${JSON.stringify(m[0])} in a title` });
  }
  return findings;
}

/**
 * Section 2 item 4: a date, a run or seat number, a finding id or an incident id, in a comment, a
 * Python docstring, or a JS test title. Exempt, as the standard says: a fixture, a contract: tag line,
 * and the header's NEVER. paragraph, which section 1 names as the one place a date may explain why the
 * code must not be "corrected" back into a defect. A dated line anywhere else in the header still
 * counts. Also exempt by name (DIARY_EXEMPT_FILES): the migrations that already existed when this
 * exemption was written, whose own bytes are frozen history, never a future one. A comment or docstring
 * is also diary when it carries one of the ratchet's own ids or one of DIARY_PHRASES (diaryIdPattern);
 * a JS test title is read for the same thing, except a title's own PINNED DEFECT tag, which is exempt
 * only when it opens the title (jsTitleFindings).
 */
export function diaryLeg(ctx, ratchet) {
  const findings = [];
  const idRe = diaryIdPattern(ratchet);
  for (const f of ctx.files) {
    if (f.src.startsWith(FIXTURES) || DIARY_EXEMPT_FILES.has(f.src)) continue;
    const never = neverParagraphLines(f);
    for (const c of f.comments) {
      const m = anyDiaryMatch(c.text, idRe);
      if (m && !isContractLine(c.text) && !never.has(c.line))
        findings.push({ file: f.src, line: c.line, message: `diary ${JSON.stringify(m[0])} in a comment` });
    }
    for (const d of f.docstrings || []) {
      d.text.split('\n').forEach((t, k) => {
        const m = anyDiaryMatch(t, idRe);
        if (m && !(docLinesMatch(d) && never.has(d.line + k)))
          findings.push({ file: f.src, line: docLine(d, k), message: `diary ${JSON.stringify(m[0])} in a docstring` });
      });
    }
    if (f.lang === 'js') findings.push(...jsTitleFindings(f, idRe));
  }
  return leg('diary', 'lines', findings);
}

// A path with at least one folder and a code extension, its folders split by / or \. It never starts
// inside another path, never starts with an ellipsis, and never stops short of a longer name (x.sh.md
// is not x.sh).
const PATH_TOKEN =
  /(?<![\w.\-/\\])(?!\.{3})((?:\.{1,2}[/\\])?[A-Za-z0-9_.-]+(?:[/\\][A-Za-z0-9_.-]+)+\.(?:js|mjs|cjs|py|sh|ps1))(?![\w/\\]|\.\w)/g;

/** Resolve a path named in a comment of `from` against this tree; true when it names a real file. */
export function resolvesInTree(ctx, from, token) {
  const norm = token.replace(/\\/g, '/').replace(/^\.\//, '');
  const candidates = [norm, path.posix.normalize(path.posix.join(path.posix.dirname(from), norm))];
  for (const c of candidates) {
    if (ctx.tracked.has(c) || ctx.manifestPaths.has(c) || existsExactly(ctx.root, c)) return true;
  }
  if (norm.startsWith('../')) return false;
  // A path written from inside one of this tree's folders resolves. A path that only ENDS with a real
  // one, behind a folder this tree does not have, names a place that does not exist, so it does not.
  for (const p of ctx.tracked) if (p.endsWith(`/${norm}`)) return true;
  for (const p of ctx.manifestPaths) if (p.endsWith(`/${norm}`)) return true;
  return false;
}

/**
 * True when every segment of `rel` exists under `root` in exactly this case. A case-insensitive disk
 * (Windows, macOS) would otherwise accept a path written in the wrong case, which Linux, where the
 * online tree runs its CI, refuses.
 */
function existsExactly(root, rel) {
  let dir = root;
  for (const segment of rel.split('/')) {
    if (segment === '..' || segment === '.' || !segment) return false;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    if (!names.includes(segment)) return false;
    dir = path.join(dir, segment);
  }
  return true;
}

// PATH_TOKEN's lookbehind refuses a token that starts right after a non-path character, so a path
// written after a placeholder segment (<scratchpad>, <tree>, <kit> and the like) is never tried: the
// closing `>` is not a path character either. This reads the part after the placeholder on its own.
const PLACEHOLDER_PATH =
  /<[^<>\s]+>[/\\]((?:[A-Za-z0-9_.-]+[/\\])*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs|py|sh|ps1))(?![\w/\\]|\.\w)/g;

/** Every dangling-path finding a block of text yields, at the given file and line. */
function danglingIn(ctx, src, text, line) {
  const out = [];
  for (const re of [PATH_TOKEN, PLACEHOLDER_PATH]) {
    for (const m of text.matchAll(re)) {
      if (!resolvesInTree(ctx, src, m[1]))
        out.push({ file: src, line, message: `names ${m[1]}, which this tree does not hold` });
    }
  }
  return out;
}

/**
 * Section 2 item 5: a comment, or a Python docstring, naming a script path that resolves to nothing in
 * this tree - plain, or rooted at a placeholder segment a path character never follows.
 */
export function danglingLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    for (const c of f.comments) findings.push(...danglingIn(ctx, f.src, c.text, c.line));
    for (const d of f.docstrings || []) {
      d.text.split('\n').forEach((t, k) => {
        findings.push(...danglingIn(ctx, f.src, t, docLine(d, k)));
      });
    }
  }
  return leg('dangling', 'references', findings);
}

// A comment a tool reads. `global` is exempt only in the linter's own form, a bare list of names
// (`global a, b: true`), so `global.x = y` commented out is still code.
const DIRECTIVE =
  /^\s*(?:biome-ignore|eslint-|@ts-|portability-ok|secret-scan:|contract:|jshint|istanbul|c8\b|node:coverage|global\s+[\w$]+(?:\s*:\s*\w+)?(?:\s*,\s*[\w$]+(?:\s*:\s*\w+)?)*\s*$)/;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
// Prose parses more often than it looks: "verify-after-write" is a subtraction and
// "schedule.md (uppercase-only)" is a call. So a body must also carry one mark only code carries.
const CODE_MARKS = new Set(['=', '=>', ';', '{', '[', '===', '!==', '+=', '-=', '&&', '||', '??', '?.']);
const CODE_WORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'for',
  'while',
  'throw',
  'await',
  'new',
  'class',
  'require',
  'typeof',
  'delete'
]);

/** True when a body compiles as a function body, an async function body, or a module declaration. */
function compiles(body, tokens) {
  for (const Compile of [Function, AsyncFunction]) {
    try {
      new Compile(body);
      return true;
    } catch {
      // not this form; try the next
    }
  }
  const [first, second] = tokens;
  if (first.v === 'import') {
    return second.t === 'string' || tokens.some((t, k) => t.v === 'from' && tokens[k + 1]?.t === 'string');
  }
  if (first.v !== 'export') return false;
  if (['{', '*'].includes(second.v)) return true;
  const rest = body.slice(second.v === 'default' ? (tokens[2]?.start ?? body.length) : second.start);
  return rest.trim() !== '' && isCode(rest, true);
}

/**
 * True when a body is one call written as code writes it, the callee against its '(' and nothing
 * after the closing ')' but a semicolon: `console.log(lines)`. Prose that parses as a call keeps a
 * space before the parenthesis ("schedule.md (uppercase-only)").
 */
function isLoneCall(tokens) {
  let k = tokens[0]?.v === 'await' ? 1 : 0;
  if (tokens[k]?.t !== 'ident') return false;
  while (tokens[k + 1]?.v === '.' && tokens[k + 2]?.t === 'ident') k += 2;
  const open = tokens[k + 1];
  if (open?.v !== '(' || open.start !== tokens[k].end) return false;
  const end = closing(tokens, k + 1);
  const after = tokens.slice(end + 1);
  return after.length === 0 || (after.length === 1 && after[0].v === ';');
}

/**
 * True when a comment body is code: it compiles as a function body (plain or async) or is an import or
 * export declaration, it is longer than three tokens (the standard's definition), and it carries an
 * assignment, a semicolon, a bracket, an arrow, a logical operator or a statement keyword, or is one
 * call written as code writes it. A sentence that happens to parse carries none of those.
 */
export function isCode(body, declaration = false) {
  if (!body.trim() || DIRECTIVE.test(body)) return false;
  let tokens;
  try {
    tokens = significant(lexJs(body));
  } catch {
    return false;
  }
  if (tokens.length <= 3 && !declaration) return false;
  const marked = tokens.some(
    (t) => (t.t === 'punct' && CODE_MARKS.has(t.v)) || (t.t === 'ident' && CODE_WORDS.has(t.v))
  );
  if (!marked && !isLoneCall(tokens) && !['import', 'export'].includes(tokens[0]?.v)) return false;
  return compiles(body, tokens);
}

/**
 * The comment tokens that document rather than hold code: the file's header (every comment before
 * its first line of code) and every JSDoc block, whose examples and shapes are what section 1 asks a
 * header and a doc comment to carry.
 */
function documentation(f) {
  const first = firstCodeToken(f.tokens);
  return new Set(
    f.tokens.filter((t) => t.t === 'comment' && (!first || t.end <= first.start || t.raw.startsWith('/**')))
  );
}

/**
 * Section 2 item 2: JavaScript comments that parse as statements under new Function() and hold more than
 * three tokens. A run of line comments is judged whole first, so a commented-out block counts every line
 * that holds something. The header and JSDoc blocks are documentation and are not read.
 */
export function commentedOutLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue;
    const docs = documentation(f);
    const groups = [];
    let run = null;
    for (const t of f.tokens) {
      if (t.t !== 'comment' || docs.has(t)) {
        run = null;
        continue;
      }
      if (t.kind === 'block') {
        run = null;
        groups.push(
          t.v.split('\n').map((l, k) => ({ line: t.line + k, text: l.replace(/\r$/, '').replace(/^\s*\*(?!\/)/, '') }))
        );
        continue;
      }
      if (t.own && run && run[run.length - 1].line === t.line - 1) run.push({ line: t.line, text: t.v });
      else {
        run = [{ line: t.line, text: t.v }];
        groups.push(run);
      }
      if (!t.own) run = null;
    }
    for (const g of groups) {
      const flagged = isCode(g.map((l) => l.text).join('\n'))
        ? g.filter((l) => l.text.trim())
        : g.filter((l) => isCode(l.text));
      for (const l of flagged)
        findings.push({ file: f.src, line: l.line, message: `commented-out code: ${l.text.trim().slice(0, 60)}` });
    }
  }
  return leg('commented-out', 'lines', findings);
}

/** The string literals written in tokens[from..to], no name read through: what a require() names. */
function literalsIn(tokens, from, to) {
  return tokens
    .slice(from, to + 1)
    .filter((t) => t.t === 'string' || (t.t === 'template' && t.open && t.close))
    .map((t) => t.v);
}

const ASSIGN_OPS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '<<=',
  '>>=',
  '>>>=',
  '&=',
  '|=',
  '^=',
  '&&=',
  '||=',
  '??='
]);
const NOT_A_METHOD = new Set(['if', 'while', 'for', 'switch', 'catch', 'with', 'function']);
const PATH_MODULES = new Set(['path', 'node:path']);
const PATH_JOINS = new Set(['join', 'resolve']);
// The calls that turn a file URL into its path or back, and name the same file.
const FILE_URLS = new Set(['fileURLToPath', 'pathToFileURL']);
const CONDITIONS = new Set(['||', '??', '&&']);
const NOT_PATHS = new Set(['new', 'typeof', 'void', 'await', 'true', 'false', 'null', 'undefined', 'this', 'of', 'in']);

/**
 * The last token of the expression that starts at toks[a]: the one before a comma, a semicolon or a
 * closing bracket at its own depth, or the one before a line break that ends the statement.
 */
function expressionEnd(toks, a) {
  let depth = 0;
  for (let k = a; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'punct' && ['(', '[', '{'].includes(t.v)) depth++;
    else if (t.t === 'punct' && [')', ']', '}'].includes(t.v)) {
      if (--depth < 0) return k - 1;
    } else if (depth === 0 && t.t === 'punct' && (t.v === ',' || t.v === ';')) return k - 1;
    if (depth === 0 && breaksStatement(t, toks[k + 1])) return k;
  }
  return toks.length - 1;
}

/**
 * The names a destructuring pattern or a parameter list that opens at toks[open] binds, by token
 * index: every name that is not a key (`key:`) and not inside a default value (`= ...`).
 */
function patternNames(toks, open) {
  const close = closing(toks, open);
  const out = [];
  for (let k = open + 1; k < close; k++) {
    const t = toks[k];
    if (t.v === '=') {
      // A default value runs to the next comma at its own depth, or to the bracket that closes it.
      for (let d = 0; k + 1 < close; k++) {
        const u = toks[k + 1];
        if (u.t === 'punct' && ['(', '[', '{'].includes(u.v)) d++;
        else if (u.t === 'punct' && [')', ']', '}'].includes(u.v)) {
          if (d-- === 0) break;
        } else if (d === 0 && u.v === ',') break;
      }
    } else if (t.t === 'ident' && toks[k + 1]?.v !== ':' && toks[k - 1]?.v !== '.') out.push(k);
  }
  return out;
}

/** The last token of the statement that forms a for loop's body, after its head closes at toks[close]. */
const loopBodyEnd = (toks, close) =>
  toks[close + 1]?.v === '{' ? closing(toks, close + 1) : statementEnd(toks, close + 1, toks.length);

/**
 * Every binding a JS file makes and where it is visible, for resolving a name at the place it is
 * used: a const, let or var (its initializer, or the iterable of the for...of or for...in loop it
 * heads), a function or class, an import (its module), a parameter, a catch binding, and a name a
 * destructuring pattern binds. Each binding counts the assignments made to it after it is bound.
 * lookup(name, k) gives the nearest binding visible at toks[k], { multi } when that scope binds the
 * name more than once, or null when no binding in the file reaches it.
 */
function scopeModel(toks) {
  const bindings = new Map();
  const declared = new Set();
  const last = toks.length - 1;
  const blockAt = (k) => {
    const e = enclosers(toks, k).find((j) => toks[j].v === '{');
    return e === undefined ? [0, last] : [e, closing(toks, e)];
  };
  const functionAt = (k) => {
    const e = enclosers(toks, k).find((j) => toks[j].v === '{' && opensBody(toks, j));
    return e === undefined ? [0, last] : [e, closing(toks, e)];
  };
  const add = (k, [from, to], kind, extra = {}) => {
    declared.add(k);
    const name = toks[k].v;
    if (!bindings.has(name)) bindings.set(name, []);
    bindings.get(name).push({ name, at: k, from, to, kind, assigned: 0, ...extra });
  };
  const params = (open, range) => {
    for (const k of patternNames(toks, open)) add(k, range, 'param');
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'ident' && t.v !== '=>' && t.v !== ')') continue;
    if (t.v === 'import' && toks[k - 1]?.v !== '.' && !['(', '.'].includes(toks[k + 1]?.v)) {
      let from = k + 1;
      while (from < toks.length && toks[from].v !== 'from' && toks[from].t !== 'string') from++;
      const module = toks[from]?.v === 'from' ? toks[from + 1]?.v : null;
      for (let c = k + 1; c < from; c++) {
        const u = toks[c];
        if (u.v === '{') {
          for (let j = c + 1; j < closing(toks, c); j++) {
            if (toks[j].t !== 'ident') continue;
            const alias = toks[j + 1]?.v === 'as' && toks[j + 2]?.t === 'ident';
            add(alias ? j + 2 : j, [0, last], 'import', { module, imported: toks[j].v });
            if (alias) j += 2;
          }
          c = closing(toks, c);
        } else if (u.v === '*' && toks[c + 1]?.v === 'as') {
          add(c + 2, [0, last], 'import', { module, imported: '*' });
          c += 2;
        } else if (u.t === 'ident') add(c, [0, last], 'import', { module, imported: 'default' });
      }
      k = from;
      continue;
    }
    if (['const', 'let', 'var'].includes(t.v) && toks[k - 1]?.v !== '.') {
      const head = toks[k - 1]?.v === '(' && toks[k - 2]?.v === 'for' ? k - 1 : -1;
      const range =
        head !== -1 ? [k - 2, loopBodyEnd(toks, closing(toks, head))] : t.v === 'var' ? functionAt(k) : blockAt(k);
      for (let j = k + 1; j < toks.length; ) {
        const u = toks[j];
        let next;
        if (u.t === 'ident') {
          const after = toks[j + 1]?.v;
          if (after === '=') {
            const end = expressionEnd(toks, j + 2);
            add(j, range, 'value', { init: [j + 2, end] });
            next = end + 1;
          } else if (head !== -1 && (after === 'of' || after === 'in')) {
            add(j, range, 'loop', { iter: [j + 2, closing(toks, head) - 1] });
            break;
          } else {
            add(j, range, 'unset');
            next = j + 1;
          }
        } else if (u.v === '{' || u.v === '[') {
          for (const n of patternNames(toks, j)) add(n, range, 'destructured');
          next = closing(toks, j) + 1;
          if (toks[next]?.v === '=') next = expressionEnd(toks, next + 1) + 1;
        } else break;
        if (toks[next]?.v !== ',') break;
        j = next + 1;
      }
      continue;
    }
    if (t.v === 'function') {
      let n = k + 1;
      if (toks[n]?.v === '*') n++;
      const named = toks[n]?.t === 'ident' && toks[n + 1]?.v === '(';
      const open = named ? n + 1 : n;
      if (toks[open]?.v !== '(') continue;
      const body = closing(toks, open) + 1;
      if (toks[body]?.v !== '{') continue;
      const range = [open, closing(toks, body)];
      if (named) {
        const prev = toks[k - 1];
        const statement = !prev || [';', '{', '}'].includes(prev.v) || ['export', 'default', 'async'].includes(prev.v);
        add(n, statement ? blockAt(k) : range, 'function', { body: [body, range[1]] });
      }
      params(open, range);
      continue;
    }
    if (t.v === 'class' && toks[k + 1]?.t === 'ident' && toks[k - 1]?.v !== '.') {
      add(k + 1, blockAt(k), 'class');
      continue;
    }
    if (t.v === 'catch' && toks[k + 1]?.v === '(') {
      const close = closing(toks, k + 1);
      if (toks[close + 1]?.v === '{') params(k + 1, [k + 1, closing(toks, close + 1)]);
      continue;
    }
    if (t.v === '=>') {
      const end = toks[k + 1]?.v === '{' ? closing(toks, k + 1) : expressionEnd(toks, k + 1);
      if (toks[k - 1]?.v === ')') {
        const open = opening(toks, k - 1);
        params(open, [open, end]);
      } else if (toks[k - 1]?.t === 'ident') add(k - 1, [k - 1, end], 'param');
      continue;
    }
    // A method: name(params) { body }, in a class or an object literal.
    if (t.v === ')' && !t.closesHead && toks[k + 1]?.v === '{') {
      const open = opening(toks, k);
      const name = toks[open - 1];
      if (name?.t === 'ident' && !NOT_A_METHOD.has(name.v) && toks[open - 2]?.v !== 'function')
        params(open, [open, closing(toks, k + 1)]);
    }
  }
  const nearest = (name, k) => {
    const visible = (bindings.get(name) ?? []).filter((b) => b.from <= k && k <= b.to);
    if (!visible.length) return null;
    const from = Math.max(...visible.map((b) => b.from));
    const inner = visible.filter((b) => b.from === from);
    const to = Math.min(...inner.map((b) => b.to));
    const here = inner.filter((b) => b.to === to);
    return here.length === 1 ? here[0] : { name, multi: true };
  };
  // An assignment after the binding: NAME = ..., NAME += ..., NAME++, ++NAME, and a bare for (NAME of ...).
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'ident' || declared.has(k) || ['.', '?.'].includes(toks[k - 1]?.v)) continue;
    const next = toks[k + 1]?.v;
    const assigns =
      ASSIGN_OPS.has(next) ||
      ['++', '--'].includes(next) ||
      ['++', '--'].includes(toks[k - 1]?.v) ||
      (toks[k - 1]?.v === '(' && toks[k - 2]?.v === 'for' && (next === 'of' || next === 'in'));
    if (!assigns) continue;
    const b = nearest(t.v, k);
    if (b && !b.multi) b.assigned++;
  }
  return { lookup: nearest, all: [...bindings.values()].flat() };
}

/**
 * The paths a JS expression can name, found exactly or not at all: { alts, refused }. `alts` holds
 * the string segments of each path it names (one, or one per element of a literal array a for...of
 * loop walks); `refused` says why a part was left out, and a part left out is never guessed at. A
 * part resolves through a string literal, path.join or path.resolve of parts, and a name whose
 * nearest binding visible here is bound once, to a value or to a loop over a literal array (or over
 * a const bound once to one). A parameter, a destructured or imported name, a name bound more than
 * once or assigned again, a member access (audit.CONTRACT_REL, f.repo), any other call, and a
 * condition resolve to nothing. A same-file name is read through at most three deep.
 */
function pathResolver(toks, scope) {
  const cross = (xs, ys) => xs.flatMap((x) => ys.map((y) => [...x, ...y]));
  const isPathModule = (name, k) => {
    const b = scope.lookup(name, k);
    if (!b) return PATH_MODULES.has(name);
    if (b.multi) return false;
    if (b.kind === 'import') return PATH_MODULES.has(b.module) && ['default', '*'].includes(b.imported);
    if (b.kind !== 'value' || b.assigned) return false;
    const [a, z] = b.init;
    return z === a + 3 && toks[a].v === 'require' && PATH_MODULES.has(toks[a + 2].v);
  };
  const isPathJoin = (k, e) => {
    const names = [];
    for (let j = k; j <= e; j += 2) names.push(toks[j].v);
    const last = names[names.length - 1];
    if (!PATH_JOINS.has(last)) return false;
    if (names.length === 1) {
      const b = scope.lookup(last, k);
      return Boolean(b && !b.multi && b.kind === 'import' && PATH_MODULES.has(b.module) && b.imported === last);
    }
    const middle = names.slice(1, -1);
    return isPathModule(names[0], k) && middle.every((m) => m === 'posix' || m === 'win32') && middle.length <= 1;
  };
  // A value that is a function: `function (...) {...}`, or an arrow at the value's own depth.
  const isFunctionValue = (a, z) => {
    if (toks[a]?.v === 'function' || (toks[a]?.v === 'async' && toks[a + 1]?.v === 'function')) return true;
    for (let j = a, d = 0; j <= z; j++) {
      if (['(', '[', '{'].includes(toks[j].v)) d++;
      else if ([')', ']', '}'].includes(toks[j].v)) d--;
      else if (d === 0 && toks[j].v === '=>') return true;
    }
    return false;
  };
  // The element ranges of the array literal toks[a..z], or of `[...].filter(...)` over one (a filter
  // keeps some of the elements, each still exactly one of them), or null.
  const elementsOf = (a, z) => {
    if (toks[a]?.v !== '[') return null;
    const close = closing(toks, a);
    const filtered =
      toks[close + 1]?.v === '.' &&
      toks[close + 2]?.v === 'filter' &&
      toks[close + 3]?.v === '(' &&
      closing(toks, close + 3) === z;
    if (close !== z && !filtered) return null;
    return close === a + 1
      ? []
      : pieces(
          a + 1,
          close - 1,
          atTop(a + 1, close - 1, (t) => t.v === ',')
        );
  };
  const byName = (name, k, depth) => {
    const b = scope.lookup(name, k);
    if (!b) return { refused: `${name}, which this file does not bind` };
    if (b.multi) return { refused: `${name}, bound more than once where it is read` };
    if (b.assigned) return { refused: `${name}, assigned again after it is bound` };
    if (b.kind === 'value') {
      const [a, z] = b.init;
      if (isFunctionValue(a, z)) return { refused: `${name}, a function` };
      if (depth >= 3) return { refused: `${name}, three names deep` };
      return walk(a, z, depth + 1);
    }
    if (b.kind === 'loop') {
      const [a, z] = b.iter;
      let elements = elementsOf(a, z);
      if (!elements && a === z && toks[a].t === 'ident') {
        const list = scope.lookup(toks[a].v, a);
        if (list && !list.multi && !list.assigned && list.kind === 'value') elements = elementsOf(...list.init);
      }
      if (!elements) return { refused: `${name}, a loop over something that is not a literal array` };
      if (depth >= 3) return { refused: `${name}, three names deep` };
      return either(elements.map(([x, y]) => walk(x, y, depth + 1)));
    }
    const kinds = {
      param: 'a parameter',
      destructured: 'destructured',
      import: 'an import',
      unset: 'bound without a value'
    };
    return { refused: `${name}, ${kinds[b.kind] ?? `a ${b.kind}`}` };
  };
  // The indices in toks[a..z] of the tokens `is` accepts at the range's own depth.
  const atTop = (a, z, is) => {
    const out = [];
    for (let k = a, d = 0; k <= z; k++) {
      const v = toks[k].v;
      if (toks[k].t === 'punct' && ['(', '[', '{'].includes(v)) d++;
      else if (toks[k].t === 'punct' && [')', ']', '}'].includes(v)) d--;
      else if (d === 0 && is(toks[k])) out.push(k);
    }
    return out;
  };
  // The ranges between the separators at `cuts`.
  const pieces = (a, z, cuts) => [a - 1, ...cuts].map((c, n) => [c + 1, n < cuts.length ? cuts[n] - 1 : z]);
  const either = (rs) => ({ alts: rs.flatMap((r) => r.alts), refused: rs.flatMap((r) => r.refused) });
  function walk(a, z, depth = 0) {
    // A list (a read's arguments, path.join's parts): each item on its own, its paths joined in order.
    const commas = atTop(a, z, (t) => t.v === ',');
    if (commas.length) {
      let alts = [[]];
      const refused = [];
      for (const [x, y] of pieces(a, z, commas)) {
        const r = walk(x, y, depth);
        alts = cross(alts, r.alts);
        refused.push(...r.refused);
      }
      return { alts, refused };
    }
    if (a < z && toks[a].v === '(' && closing(toks, a) === z) return walk(a + 1, z - 1, depth);
    // A condition names each path it can take, never one of them guessed: a ? b : c, a || b, a ?? b.
    const [q] = atTop(a, z, (t) => t.v === '?');
    if (q !== undefined) {
      let colon = -1;
      for (let k = q + 1, d = 0, nested = 0; k <= z && colon === -1; k++) {
        const v = toks[k].v;
        if (toks[k].t === 'punct' && ['(', '[', '{'].includes(v)) d++;
        else if (toks[k].t === 'punct' && [')', ']', '}'].includes(v)) d--;
        else if (d === 0 && v === '?') nested++;
        else if (d === 0 && v === ':') {
          if (nested === 0) colon = k;
          else nested--;
        }
      }
      if (colon === -1) return { alts: [[]], refused: ['a condition this leg cannot split'] };
      return either([walk(q + 1, colon - 1, depth), walk(colon + 1, z, depth)]);
    }
    const ors = atTop(a, z, (t) => CONDITIONS.has(t.v));
    if (ors.length) return either(pieces(a, z, ors).map(([x, y]) => walk(x, y, depth)));
    let alts = [[]];
    const refused = [];
    for (let k = a; k <= z && k < toks.length; k++) {
      const t = toks[k];
      if (t.t === 'string' || (t.t === 'template' && t.open && t.close)) {
        alts = cross(alts, [[t.v]]);
        continue;
      }
      if (t.t === 'punct' && ['(', '[', '{'].includes(t.v)) {
        const close = closing(toks, k);
        if (t.v === '{') {
          // An object literal (a read's options) names no path.
          k = close;
          continue;
        }
        // `[a, b].find(...)` is exactly one of the elements: each is a path it can name.
        const found =
          t.v === '[' && toks[close + 1]?.v === '.' && toks[close + 2]?.v === 'find' && toks[close + 3]?.v === '(';
        if (found) {
          const elements = elementsOf(k, close) ?? [];
          const r = either(elements.map(([x, y]) => walk(x, y, depth)));
          alts = cross(alts, r.alts.length ? r.alts : [[]]);
          refused.push(...r.refused);
          k = closing(toks, close + 3);
          continue;
        }
        let e = close;
        while (['.', '?.'].includes(toks[e + 1]?.v) && toks[e + 2]?.t === 'ident') e += 2;
        if (e > close) {
          refused.push(`${t.v === '[' ? 'an array' : 'a group'}'s .${toks[e].v}, a member access`);
          k = toks[e + 1]?.v === '(' ? closing(toks, e + 1) : e;
          continue;
        }
        const r = walk(k + 1, close - 1, depth);
        alts = cross(alts, r.alts);
        refused.push(...r.refused);
        k = close;
        continue;
      }
      if (t.t !== 'ident' || ['.', '?.'].includes(toks[k - 1]?.v)) continue;
      if (toks[k + 1]?.v === ':' && ['{', ','].includes(toks[k - 1]?.v)) continue;
      if (NOT_PATHS.has(t.v)) continue;
      let e = k;
      while (['.', '?.'].includes(toks[e + 1]?.v) && toks[e + 2]?.t === 'ident') e += 2;
      const chain = toks
        .slice(k, e + 1)
        .filter((u) => u.t === 'ident')
        .map((u) => u.v)
        .join('.');
      if (toks[e + 1]?.v === '(') {
        const close = closing(toks, e + 1);
        // A string's own segments, split at '/', are its parts: ...HOOK_REL.split('/').
        const split =
          e === k + 2 &&
          toks[e].v === 'split' &&
          close === e + 3 &&
          toks[e + 2].t === 'string' &&
          toks[e + 2].v === '/';
        if (split) {
          const r = byName(t.v, k, depth);
          if (r.alts) {
            alts = cross(alts, r.alts);
            refused.push(...r.refused);
          } else refused.push(r.refused);
        } else if (isPathJoin(k, e) || FILE_URLS.has(toks[e].v)) {
          const r = walk(e + 2, close - 1, depth);
          alts = cross(alts, r.alts);
          refused.push(...r.refused);
        } else if (chain === 'URL' && toks[k - 1]?.v === 'new') {
          // new URL(<path>, import.meta.url) names <path> from the reader's own folder: its first argument.
          const [first] = atTop(e + 2, close - 1, (u) => u.v === ',');
          const r = walk(e + 2, first === undefined ? close - 1 : first - 1, depth);
          alts = cross(alts, r.alts);
          refused.push(...r.refused);
        } else refused.push(`${chain}(), a call`);
        k = close;
        continue;
      }
      if (e > k) {
        refused.push(`${chain}, a member access`);
        k = e;
        continue;
      }
      const r = byName(t.v, k, depth);
      if (r.alts) {
        alts = cross(alts, r.alts);
        refused.push(...r.refused);
      } else refused.push(r.refused);
    }
    return { alts, refused };
  }
  return walk;
}

// The file each shipped path holds, by that path: in the Kit variants/online/<p> for a path a variant
// row claims and the Kit's own <p> for every other shipped one; in a generated tree each file itself.
const shippedFiles = new WeakMap();
function shipsAt(ctx) {
  if (!shippedFiles.has(ctx)) shippedFiles.set(ctx, new Map((ctx.files ?? []).map((f) => [f.dst ?? f.src, f.src])));
  return shippedFiles.get(ctx);
}

/**
 * The tracked path a list of string segments names from `reader`, or null. A path resolves to the file
 * that ships at that path, the principle the ceilings are keyed by: in the Kit, where a variants/online/
 * row claims <p>, the file that ships at <p> is variants/online/<p>, so a test reading <p> is counted
 * where the online tree counts it; otherwise it is the Kit's own <p>, and a Kit file that ships nowhere
 * is tracked but out of scope. The file name is the last segment, and the segments before it are read
 * from the right, longest run first, because what went before them is a root this leg does not know (a
 * temp copy, the checkout); each run names a path from the repository root, then from the reader's
 * folder, and the first that ships or is tracked is the answer. A tracked file that only shares the
 * read's file name is never taken for it.
 */
export function resolveSegments(ctx, reader, segments) {
  const parts = segments.filter(
    (s) => s && !ENCODINGS.has(s.toLowerCase()) && !/\s/.test(s) && !s.startsWith('-') && !s.includes('://')
  );
  if (!parts.length) return null;
  const dir = path.posix.dirname(reader);
  const runs = parts.map((_, k) => parts.slice(k).join('/')).concat(parts.filter((p) => p.includes('/')));
  const shipped = shipsAt(ctx);
  for (const run of runs) {
    const norm = path.posix.normalize(run).replace(/^\.\//, '');
    for (const c of [norm, path.posix.normalize(path.posix.join(dir, norm))]) {
      if (c.startsWith('..')) continue;
      if (shipped.has(c)) return shipped.get(c);
      if (ctx.bySrc?.has(c) || ctx.tracked.has(c)) return c;
    }
  }
  return null;
}

const lineCount = (root, rel) => {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;
  } catch {
    return 0;
  }
};

const READ_CALLS = new Set(['readFileSync', 'readFile', 'createReadStream']);
const SPAWN_CALLS = new Set(['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec']);
// The calls that write their second argument, whole, to a file.
const WRITE_CALLS = new Set(['writeFileSync', 'writeFile']);

/**
 * The names a file calls one of `names` by: the names themselves, an import or destructuring alias
 * (`import { readFile as readText }`, `const { readFile: load } = fs.promises`), and a const bound to
 * the bare function (`const read = fs.readFileSync`).
 */
function callNames(toks, names) {
  const out = new Set(names);
  for (let k = 0; k + 2 < toks.length; k++) {
    const [a, b, c] = [toks[k], toks[k + 1], toks[k + 2]];
    if (a.t === 'ident' && names.has(a.v) && (b.v === 'as' || b.v === ':') && c.t === 'ident') out.add(c.v);
    if (!['const', 'let', 'var'].includes(a.v) || b.t !== 'ident' || c.v !== '=') continue;
    let j = k + 3;
    while (toks[j] && (toks[j].t === 'ident' || toks[j].v === '.')) j++;
    const last = toks[j - 1];
    if (j > k + 3 && last.t === 'ident' && names.has(last.v) && toks[j]?.v !== '(') out.add(b.v);
  }
  return out;
}

/**
 * Source-text reads of other files in a JS test: { reads: [{line, target, via}], unresolved:
 * [{line, via, why}], copies: [{line, target, via, proof}] }. A copy is not a text read: cp,
 * copyFileSync, cpSync and copyFile never look at the content, and neither does a read whose value goes,
 * unchanged, only into one write of the whole content (writeFileSync(dst, readFileSync(src)), a
 * const holding the read whose only use is such a write, or a same-file helper whose parameter goes
 * only into one). A copy of a tracked file is listed with the line of the write that proves it, and is
 * never a finding; a read whose value is used any other way (an assertion, a regex, a split, a second
 * write) stays a read. A read is a call to a read function by any name it goes by, a call to a
 * same-file helper whose body returns one (the helper's own path parts prefix the call's), a `git
 * show <rev>:<path>` through a spawn, and a spawn of another test file. A path resolves exactly, by
 * pathResolver, or not at all: a read one of whose parts is left out and that names no tracked file
 * is `unresolved`, and a read is never attributed to a guess.
 */
function jsReads(ctx, f) {
  const toks = significant(f.tokens);
  const scope = scopeModel(toks);
  const paths = pathResolver(toks, scope);
  const reads = callNames(toks, READ_CALLS);
  const spawns = callNames(toks, SPAWN_CALLS);
  const writes = callNames(toks, WRITE_CALLS);
  const helpers = new Map();
  const helperAt = (k) => {
    if (['.', '?.'].includes(toks[k - 1]?.v) || toks[k + 1]?.v !== '(') return null;
    const b = scope.lookup(toks[k].v, k);
    return b && helpers.has(b) ? b : null;
  };
  // The callee of a read or a helper call at j, through a member chain and an optional await, or -1.
  const callAt = (j) => {
    let k = toks[j]?.v === 'await' ? j + 1 : j;
    while (toks[k]?.t === 'ident' && toks[k + 1]?.v === '.' && toks[k + 2]?.t === 'ident') k += 2;
    const read = toks[k]?.t === 'ident' && reads.has(toks[k].v) && toks[k + 1]?.v === '(';
    return read || helperAt(k) ? k : -1;
  };
  // A helper RETURNS what a read call gives back: an arrow whose expression body is the call, or a
  // body whose own top-level return is. A helper that reads to copy a file into a fixture is not a
  // read, and neither is a function nested inside a helper. Gives the returned call's callee, or -1.
  const bodyReturns = (open) => {
    const close = closing(toks, open);
    for (let j = open, depth = 0; j <= close; j++) {
      if (toks[j].t === 'punct' && toks[j].v === '{') depth++;
      else if (toks[j].t === 'punct' && toks[j].v === '}') depth--;
      else if (toks[j].v === 'return' && depth === 1 && callAt(j + 1) !== -1) return callAt(j + 1);
    }
    return -1;
  };
  const returnedCall = ([from, to]) => {
    if (toks[from]?.v === '{') return bodyReturns(from);
    for (let j = from, depth = 0; j <= to; j++) {
      const t = toks[j];
      if (t.t === 'punct' && t.v === '{' && depth === 0 && toks[j - 1]?.v === ')') return bodyReturns(j);
      if (t.t === 'punct' && ['(', '[', '{'].includes(t.v)) depth++;
      else if (t.t === 'punct' && [')', ']', '}'].includes(t.v)) depth--;
      else if (t.v === '=>' && depth === 0) return toks[j + 1]?.v === '{' ? bodyReturns(j + 1) : callAt(j + 1);
    }
    return -1;
  };
  const candidates = scope.all.filter(
    (b) => !b.assigned && ((b.kind === 'value' && !reads.has(b.name)) || b.kind === 'function')
  );
  for (let pass = 0; pass < 2; pass++)
    for (const b of candidates) {
      const at = returnedCall(b.kind === 'function' ? b.body : b.init);
      if (at !== -1) helpers.set(b, at);
    }
  const returned = new Set(helpers.values());
  const cross = (xs, ys) => xs.flatMap((x) => ys.map((y) => [...x, ...y]));
  // A helper's path parts are those of the call it returns, after the parts of the helper that
  // call is, so lines(name), which returns read(name), reads the folder read() names.
  const prefixOf = (b, depth = 0) => {
    const at = helpers.get(b);
    const args = paths(at + 2, closing(toks, at + 1) - 1);
    const inner = helperAt(at);
    if (!inner || inner === b || depth >= 3) return args;
    const pre = prefixOf(inner, depth + 1);
    return { alts: cross(pre.alts, args.alts), refused: [...pre.refused, ...args.refused] };
  };
  // Where an expression toks[s..e] is one whole argument of a call: { open, index }, or null.
  const argumentAt = (s, e) => {
    if (!['(', ','].includes(toks[s - 1]?.v) || ![')', ','].includes(toks[e + 1]?.v)) return null;
    const open = toks[s - 1].v === '(' ? s - 1 : enclosers(toks, s)[0];
    if (open === undefined || toks[open].v !== '(' || toks[open - 1]?.t !== 'ident') return null;
    return { open, index: open === s - 1 ? 0 : atTopOf(open + 1, s - 1, ',').length };
  };
  const atTopOf = (a, z, v) => {
    const out = [];
    for (let j = a, d = 0; j <= z; j++) {
      if (['(', '[', '{'].includes(toks[j].v)) d++;
      else if ([')', ']', '}'].includes(toks[j].v)) d--;
      else if (d === 0 && toks[j].v === v) out.push(j);
    }
    return out;
  };
  // Write helpers: a same-file function one of whose parameters goes, unchanged and only, into one write.
  const writeHelpers = new Map();
  // Whether argument `index` of the call opening at toks[open] is written whole to a file.
  const writtenAt = ({ open, index }) => {
    const callee = toks[open - 1];
    if (writes.has(callee.v)) return index === 1;
    if (['.', '?.'].includes(toks[open - 2]?.v)) return false;
    const b = scope.lookup(callee.v, open - 1);
    return Boolean(b && writeHelpers.get(b) === index);
  };
  // The one use of a binding in its scope, or null when it has none or more than one.
  const onlyUse = (b) => {
    let use = null;
    for (let j = b.from; j <= b.to; j++) {
      if (j === b.at || toks[j].v !== b.name || toks[j].t !== 'ident' || ['.', '?.'].includes(toks[j - 1]?.v)) continue;
      if (scope.lookup(b.name, j) !== b) continue;
      if (use !== null) return null;
      use = j;
    }
    return use;
  };
  const parameterList = (b) => {
    if (b.kind === 'function') return toks[b.at + 1]?.v === '(' ? b.at + 1 : -1;
    const [a] = b.init;
    if (toks[a]?.v === '(' && toks[closing(toks, a) + 1]?.v === '=>') return a;
    if (toks[a]?.v === 'function') return toks[a + 1]?.v === '(' ? a + 1 : toks[a + 2]?.v === '(' ? a + 2 : -1;
    return -1;
  };
  const functions = scope.all.filter((b) => !b.assigned && (b.kind === 'function' || b.kind === 'value'));
  for (let pass = 0; pass < 2; pass++)
    for (const b of functions) {
      const open = parameterList(b);
      if (open === -1 || writeHelpers.has(b)) continue;
      const close = closing(toks, open);
      if (toks.slice(open + 1, close).some((u) => ['{', '[', '...'].includes(u.v))) continue;
      const names = patternNames(toks, open);
      names.forEach((at, index) => {
        const param = scope.all.find((x) => x.at === at && x.kind === 'param');
        const use = param ? onlyUse(param) : null;
        const arg = use === null ? null : argumentAt(use, use);
        if (arg && writtenAt(arg)) writeHelpers.set(b, index);
      });
    }
  // The write that makes the read (or read-helper call) at toks[k] a copy, or null. Its value must go,
  // unchanged, only into that write: straight in as the written argument, or through a const whose
  // one use is that argument.
  const copiedBy = (k) => {
    let s = k;
    while (toks[s - 1]?.v === '.' && toks[s - 2]?.t === 'ident') s -= 2;
    if (toks[s - 1]?.v === 'await') s -= 1;
    const e = closing(toks, k + 1);
    const direct = argumentAt(s, e);
    if (direct) return writtenAt(direct) ? direct.open : null;
    if (toks[s - 1]?.v !== '=' || toks[s - 2]?.t !== 'ident') return null;
    const b = scope.all.find((x) => x.at === s - 2 && x.kind === 'value' && !x.assigned);
    if (!b || b.init[0] !== s || b.init[1] !== e) return null;
    const use = onlyUse(b);
    const arg = use === null ? null : argumentAt(use, use);
    return arg && writtenAt(arg) ? arg.open : null;
  };
  const lineText = (line) => f.text.split('\n')[line - 1].trim();
  const out = [];
  const unresolved = [];
  const copies = [];
  for (let k = 0; k + 1 < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'ident' || toks[k + 1].v !== '(' || toks[k - 1]?.v === 'function') continue;
    const helper = helperAt(k);
    const isRead = reads.has(t.v) || Boolean(helper);
    const isSpawn = spawns.has(t.v);
    if (!isRead && !isSpawn) continue;
    const args = paths(k + 2, closing(toks, k + 1) - 1);
    if (isSpawn) {
      for (const strings of args.alts) {
        const words = strings.flatMap((s) => s.split(/\s+/));
        const shown = words.includes('git') && words.includes('show') && words.find((w) => /^[^:\s]+:[^:\s]+$/.test(w));
        const target = shown
          ? resolveSegments(ctx, f.src, [shown.slice(shown.indexOf(':') + 1)])
          : resolveSegments(ctx, f.src, strings);
        if (!target || target === f.src || !(shown || isTestFile(target))) continue;
        // cp copies the file whole and never looks at its text.
        if (!shown && words[0] === 'cp') copies.push({ line: t.line, target, via: 'cp', proof: lineText(t.line) });
        else out.push({ line: t.line, target, via: shown ? 'git show' : t.v });
      }
      continue;
    }
    const pre = helper ? prefixOf(helper) : { alts: [[]], refused: [] };
    const targets = new Set(
      cross(pre.alts, args.alts)
        .map((strings) => resolveSegments(ctx, f.src, strings))
        .filter((target) => target && target !== f.src)
    );
    const copy = copiedBy(k);
    if (copy !== null) {
      // A copy is neither a read nor an unresolved read; a copy of a tracked file is listed.
      for (const target of targets) copies.push({ line: t.line, target, via: t.v, proof: lineText(toks[copy].line) });
      continue;
    }
    for (const target of targets) out.push({ line: t.line, target, via: t.v });
    const why = [...pre.refused, ...args.refused];
    // The read a helper returns is resolved at each call of the helper, never at its own line.
    if (!targets.size && why.length && !returned.has(k))
      unresolved.push({ line: t.line, via: t.v, why: [...new Set(why)].join('; ') });
  }
  return { reads: out, unresolved, copies };
}

/**
 * The source-text reads of a Python test, as the helper resolved them: { reads, unresolved }, the
 * same shape as jsReads. Each read carries one list of path parts per path it can name (one, or one
 * per element of a literal list a for loop walks) and what the helper refused to read through.
 */
function pythonReads(ctx, f) {
  const reads = [];
  const unresolved = [];
  for (const r of f.reads) {
    const targets = new Set(
      (r.alternatives ?? [r.strings])
        .map((strings) => resolveSegments(ctx, f.src, strings))
        .filter((target) => target && target !== f.src)
    );
    for (const target of targets) reads.push({ line: r.line, target, via: r.func });
    if (!targets.size && r.refused?.length) unresolved.push({ line: r.line, via: r.func, why: r.refused.join('; ') });
  }
  return { reads, unresolved };
}

/**
 * Section 8.1 and 8.2: a test reading an in-scope code file as text needs a contract: tag at the site
 * naming that read, `contract: read as text by <reader>:<line>`, where <reader> is the test's path and
 * <line> (or a <from>-<to> range) holds the read. One tag answers for the reads it names and no other.
 * A tag naming a read that does not exist, and a contract: comment naming no <reader>:<line>, are
 * findings too: section 8.2 removes a tag with the contract it describes. So is a tag line naming more
 * than one <reader>:<line>, the same reader twice included: 8.2 gives each reader, and each place one
 * reader reads, a tag line of its own, stacked above the site. A reader named with an
 * `(unseen: <how>)` qualifier is taken without the read being seen, and counted in `unseen`, never a
 * finding; but the qualifier cannot hide a read: naming one the leg sees is a finding, and so is a
 * qualifier whose how is under three words or whose reader does not exist. Reads the leg would not
 * guess a path for are counted in `unresolved`, never findings. In a generated tree, a reader it does
 * not hold and a manifest drop row names by its exact path is one only the Kit holds: that tag is
 * named in `kitOnly`, never a finding, because the Kit's own run judges it.
 */
export function contractLeg(ctx) {
  const findings = [];
  const untaggable = [];
  const outOfScope = [];
  const unresolved = [];
  const unseen = [];
  const copies = [];
  const kitOnly = [];
  const readsOf = new Map();
  for (const f of ctx.files) {
    if (!isTestFile(f.src)) continue;
    const found =
      f.lang === 'js' ? jsReads(ctx, f) : f.lang === 'python' ? pythonReads(ctx, f) : { reads: [], unresolved: [] };
    for (const u of found.unresolved) unresolved.push({ reader: f.src, ...u });
    for (const c of found.copies ?? []) copies.push({ reader: f.src, ...c });
    for (const r of found.reads) {
      if (r.target.startsWith(FIXTURES)) continue;
      const site = ctx.bySrc.get(r.target);
      if (!TAGGABLE.test(r.target) && !r.target.endsWith('/pre-commit')) {
        untaggable.push(`${f.src}:${r.line} -> ${r.target}`);
        continue;
      }
      if (!site) {
        outOfScope.push(`${f.src}:${r.line} -> ${r.target}`);
        continue;
      }
      if (!readsOf.has(r.target)) readsOf.set(r.target, []);
      readsOf.get(r.target).push({ reader: f.src, line: r.line });
      const names = (ref) => ref.file === f.src && ref.from <= r.line && r.line <= ref.to;
      const tagged = site.comments.some((c) => (contractRefs(c.text) ?? []).some(names));
      if (!tagged)
        findings.push({
          file: r.target,
          line: 1,
          reader: f.src,
          kind: 'untagged',
          message: `read as text by ${f.src}:${r.line} (${r.via}) with no contract: tag naming ${f.src}:${r.line}`
        });
    }
  }
  for (const f of ctx.files) {
    for (const c of f.comments) {
      if (!/^\s*contract:/.test(c.text)) continue;
      const refs = contractRefs(c.text) ?? [];
      if (!refs.length) {
        findings.push({
          file: f.src,
          line: c.line,
          kind: 'malformed-tag',
          message: 'a contract: comment that names no reader: the tag is `contract: read as text by <file>:<line>`'
        });
        continue;
      }
      if (refs.length > 1)
        findings.push({
          file: f.src,
          line: c.line,
          kind: 'many-readers',
          message: `a contract: tag naming ${refs.length} readers on one line: section 8.2 stacks one tag line per reader, and a reader read in two places takes two`
        });
      const reads = readsOf.get(f.src) ?? [];
      for (const ref of refs) {
        // A reader this leg parses must read this file inside the named lines. Any other reader (a
        // non-test file, or a test outside this scope) must at least exist and hold those lines.
        const parsed = isTestFile(ref.file) && ctx.bySrc.has(ref.file);
        const seen = parsed && reads.some((r) => r.reader === ref.file && ref.from <= r.line && r.line <= ref.to);
        const exists = ctx.tracked.has(ref.file) && lineCount(ctx.root, ref.file) >= ref.to;
        // Only a generated tree leaves a reader to the Kit. The Kit judges every tag itself, a tag whose
        // reader is gone included, so a reader removed there is still a stale tag.
        const onlyInKit = !ctx.isKit && !ctx.tracked.has(ref.file) && ctx.droppedPaths.has(ref.file);
        const named = `${ref.file}:${ref.from}${ref.to !== ref.from ? `-${ref.to}` : ''}`;
        const add = (kind, message) => findings.push({ file: f.src, line: c.line, reader: ref.file, kind, message });
        const leaveToKit = () =>
          kitOnly.push({ file: f.src, line: c.line, reader: ref.file, from: ref.from, to: ref.to });
        if (ref.unseen !== undefined) {
          if (!hasReason(ref.unseen))
            add(
              'malformed-tag',
              `a contract: tag naming ${named} with an unseen: qualifier that does not say how the file is read in ${REASON_WORDS_MIN} words or more`
            );
          else if (seen)
            add('unseen-visible', `a contract: tag naming ${named}: the tag says unseen, the read is visible`);
          else if (onlyInKit) leaveToKit();
          else if (!exists) add('stale-tag', `a contract: tag naming ${named}, which does not exist`);
          else
            unseen.push({ file: f.src, line: c.line, reader: ref.file, from: ref.from, to: ref.to, how: ref.unseen });
          continue;
        }
        if (parsed ? seen : exists) continue;
        if (onlyInKit) leaveToKit();
        else add('stale-tag', `a contract: tag naming ${named}, which does not read this file there`);
      }
    }
  }
  return leg('contract', 'reads', findings, { untaggable, outOfScope, unresolved, unseen, copies, kitOnly });
}

/** Section 3.1: require() of an .mjs path inside a .js or .cjs file. Banned everywhere. */
export function moduleSplitLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    if (f.lang !== 'js' || f.src.endsWith('.mjs')) continue;
    const toks = significant(f.tokens);
    for (let k = 0; k + 1 < toks.length; k++) {
      if (toks[k].v !== 'require' || toks[k + 1].v !== '(' || toks[k - 1]?.v === '.') continue;
      const end = closing(toks, k + 1);
      if (literalsIn(toks, k + 2, end - 1).some((s) => /\.mjs$/.test(s))) {
        findings.push({ file: f.src, line: toks[k].line, message: 'require() of an .mjs module from CommonJS' });
      }
    }
  }
  return leg('module-split', 'sites', findings);
}

/**
 * Section 9.1: import.meta.main, which Node reads as undefined below 22.18.0. The laptop floor is
 * 22.16.0 (node:sqlite has no FTS5 before it), so a CLI guarded by it does nothing on a floor laptop
 * and exits 0. Banned everywhere.
 */
export function floorLeg(ctx) {
  const findings = [];
  for (const f of ctx.files) {
    if (f.lang !== 'js') continue;
    const toks = significant(f.tokens);
    for (let k = 0; k + 4 < toks.length; k++) {
      if (
        toks[k].v === 'import' &&
        toks[k + 1].v === '.' &&
        toks[k + 2].v === 'meta' &&
        toks[k + 3].v === '.' &&
        toks[k + 4].v === 'main'
      ) {
        findings.push({
          file: f.src,
          line: toks[k].line,
          message: 'import.meta.main is undefined below Node 22.18, and the laptop floor is 22.16'
        });
      }
    }
  }
  return leg('floor', 'sites', findings);
}

// A reason is a phrase, not a placeholder: at least this many words, once a leading comment marker is
// stripped (the ruff, flake8 and shellcheck suppression forms all put their reason after one). A
// non-string value - a malformed ratchet row, say - is never a reason.
export const REASON_WORDS_MIN = 3;
/** Whether `text` reads as a real reason (REASON_WORDS_MIN or more words once a leading comment
 * marker is stripped), never a placeholder; a non-string value is never a reason. */
export const hasReason = (text) =>
  typeof text === 'string' &&
  text
    .replace(/^[\s#:]+/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length >= REASON_WORDS_MIN;
const RULES = '[A-Z]+[0-9]+(?:\\s*,\\s*[A-Z]+[0-9]+)*';
const NOQA = new RegExp(`^\\s*noqa\\b(?::\\s*(${RULES}))?(.*)`, 'i');
// ruff reads flake8's file-level form as its own, codes and all (measured on ruff 0.16.9).
const FILE_NOQA = new RegExp(`^\\s*(ruff|flake8)\\s*:\\s*noqa\\b(?::\\s*(${RULES}))?(.*)`, 'i');
const RUFF_RANGE = /^\s*ruff\s*:\s*(disable|enable)\b(\[[^\]]*\])?(.*)/i;
const MYPY_INLINE = /^\s*mypy\s*:/i;
const TYPE_IGNORE = /^\s*type:\s*ignore\b(\[[^\]]*\])?(.*)/i;

/**
 * Where a directive can start in a Python comment's text: its start, and after every further '#'.
 * ruff reads `# noqa` after prose in the same comment (`# kept for later  # noqa`), so each is tried.
 */
const directiveStarts = (text) => [0, ...[...text.matchAll(/#/g)].map((m) => m.index + 1)].map((k) => text.slice(k));

/** The findings one Python comment's suppressions make: each needs a rule and a reason, and mypy's inline form is refused. */
function pythonSuppressions(text) {
  const out = [];
  const t = TYPE_IGNORE.exec(text);
  if (t) {
    const rest = t[2].trim();
    if (!t[1] || !rest) out.push('a type: ignore with no [code] or no reason');
    else if (!rest.startsWith('#'))
      out.push('a type: ignore whose reason is not after a second #, which mypy refuses as an invalid type: ignore');
    else if (!hasReason(rest)) out.push('a type: ignore with no [code] or no reason');
  }
  for (const s of directiveStarts(text)) {
    const file = FILE_NOQA.exec(s);
    const q = file ? null : NOQA.exec(s);
    const range = RUFF_RANGE.exec(s);
    if (file && !file[2])
      out.push(`a file-level ${file[1].toLowerCase()}: noqa with no rule, which silences every rule in the file`);
    else if (file && !hasReason(file[3])) out.push(`a file-level ${file[1].toLowerCase()}: noqa with no reason`);
    if (q && (!q[1] || !hasReason(q[2]))) out.push('a noqa with no rule or no reason');
    if (range && range[1].toLowerCase() === 'disable' && (!range[2] || !hasReason(range[3])))
      out.push('a ruff: disable with no [rule] or no reason');
    if (MYPY_INLINE.test(s))
      out.push(
        'a mypy: inline configuration comment, which changes what mypy checks in this file and which section 9.8 does not allow'
      );
  }
  return out;
}

// A shellcheck directive, read the way shellcheck 0.9 reads it: `# shellcheck disable=SC2086,SC2034`, a
// lower-case keyword at the start of the comment. Text after the codes must follow a second #; without
// it shellcheck refuses the line (SC1073), so a reason written any other way silences nothing it names.
const SHELLCHECK_DISABLE = /^\s*shellcheck\s+(?:[a-z-]+=\S*\s+)*disable=(\S*)(.*)$/;

/** The findings one shell comment's shellcheck directive makes: it names SC codes, never all, and a reason. */
function shellSuppressions(text) {
  const d = SHELLCHECK_DISABLE.exec(text);
  if (!d) return [];
  const codes = d[1].split(',').filter(Boolean);
  if (!codes.length || codes.some((code) => !/^SC\d{4}$/.test(code)))
    return ['a shellcheck disable with no SC code (or all), which silences every check it covers'];
  const rest = d[2].trim();
  if (!rest.startsWith('#'))
    return [
      rest
        ? 'a shellcheck disable whose reason is not after a second #, which shellcheck refuses (SC1073)'
        : 'a shellcheck disable with no reason'
    ];
  return hasReason(rest) ? [] : ['a shellcheck disable with no reason'];
}
const MIN_LITERAL = 8;

/** The source text of the statement that starts on the first code line after `line`. */
function statementBelow(f, line, withComment = false) {
  const toks = significant(f.tokens);
  const s = toks.findIndex((t) => t.line > line);
  if (s === -1) return '';
  let depth = 0;
  let e = s;
  for (; e < toks.length; e++) {
    const t = toks[e];
    if (t.t === 'punct' && ['(', '[', '{'].includes(t.v)) depth++;
    else if (t.t === 'punct' && [')', ']', '}'].includes(t.v)) {
      if (--depth < 0) break;
    } else if (depth === 0 && t.v === ';') break;
    if (
      depth === 0 &&
      toks[e + 1] &&
      toks[e + 1].line > t.line &&
      !['.', ',', '+', '||', '&&', '??', '?', ':', '='].includes(t.v)
    )
      break;
  }
  const end = toks[Math.min(e, toks.length - 1)];
  // A comment after the statement on its last line, when asked for: where a pragma sits.
  const trailing = withComment
    ? f.tokens.filter((t) => t.t === 'comment' && t.line === end.line && t.start >= end.end).at(-1)
    : null;
  return f.text.slice(toks[s].start, (trailing ?? end).end);
}

/**
 * The literals a contract reader writes where it reads: in a JavaScript test, the strings and regular
 * expressions of the innermost block around the read (the whole file for a top-level read); in a
 * Python test, the string literals of the function the read sits in. Null for a reader the leg
 * does not parse.
 */
function readerLiterals(ctx, ref) {
  const r = ctx.bySrc.get(ref.file);
  if (!r) return null;
  if (r.lang === 'python') {
    const reads = (r.reads || []).filter((x) => ref.from <= x.line && x.line <= ref.to);
    return reads.flatMap((x) => (x.nearby || []).map((s) => ({ string: s })));
  }
  if (r.lang !== 'js') return null;
  const toks = significant(r.tokens);
  const at = toks.findIndex((t) => t.line >= ref.from);
  let open = -1;
  for (let j = at - 1, depth = 0; j >= 0; j--) {
    if (toks[j].t !== 'punct') continue;
    if ([')', ']', '}'].includes(toks[j].v)) depth++;
    else if (['(', '['].includes(toks[j].v)) depth = Math.max(0, depth - 1);
    else if (toks[j].v === '{' && depth-- === 0) {
      open = j;
      break;
    }
  }
  const span = open === -1 ? toks : toks.slice(open, closing(toks, open) + 1);
  return span.flatMap((t) => (t.t === 'string' ? [{ string: t.v }] : t.t === 'regex' ? [{ regex: t.v }] : []));
}

/** True when one of the reader's literals is the statement's text or matches it. */
function assertsAbout(literals, text) {
  const test = (source, flags) => {
    try {
      return source.length >= MIN_LITERAL && new RegExp(source, flags.replace(/[gy]/g, '')).test(text);
    } catch {
      return false;
    }
  };
  return literals.some(({ string, regex }) => {
    if (regex) {
      const [, source, flags] = /^\/([\s\S]*)\/([a-z]*)$/.exec(regex);
      return test(source, flags);
    }
    // A test also writes a pattern as a string (new RegExp(s), Python's re), so a string may match either way.
    return (string.length >= MIN_LITERAL && text.includes(string)) || test(string, '');
  });
}

/**
 * Section 9.8: every suppression carries a rule and a reason of at least three words, never a bare
 * one: biome-ignore, noqa in any case, a file-level `ruff: noqa` or `flake8: noqa`, a
 * `ruff: disable[...]` range, `type: ignore` (its reason after a second #, the only form mypy
 * accepts), and a shell `shellcheck disable=` (SC codes, never all, its reason after a second #, the
 * only form shellcheck accepts). A `mypy:` inline configuration comment is refused outright: section
 * 9.8 names none. A format suppression sits under its section 8.2 tag, and the statement right under it is text that
 * tag's reader asserts about: one of the strings or regular expressions the reader writes where it
 * reads is that statement's text, or matches it; under a tag whose reader is unseen, the statement
 * with its trailing comment on the same line (the pragma the reader looks for), and each such pair
 * the leg takes is counted in `unseenPairs`, for an operator to review. A suppression is read where the tools read it: at
 * the start of a comment, and for the ruff, flake8 and mypy forms after any further # in it too; a
 * sentence that mentions one is prose.
 */
export function suppressionLeg(ctx) {
  const findings = [];
  const unseenPairs = [];
  const add = (f, c, message) => findings.push({ file: f.src, line: c.line, message });
  for (const f of ctx.files) {
    f.comments.forEach((c, k) => {
      const b = /^\s*biome-ignore(?:-all|-start|-end)?\s+([^\s:]+)(?::(.*))?/.exec(c.text);
      if (b) {
        if (!hasReason(b[2]))
          add(f, c, `a biome-ignore with no reason of at least ${REASON_WORDS_MIN} words after the colon`);
        if (/^format/.test(b[1])) {
          const prev = f.comments[k - 1];
          const refs = prev && prev.line === c.line - 1 ? (contractRefs(prev.text) ?? []) : [];
          if (!refs.length) add(f, c, 'a biome-ignore format with no contract: tag on the line above it');
          else if (f.lang === 'js') {
            // Under a tag with an unseen: reader, the statement is read with its trailing comment on the
            // same line: a pragma its reader looks for sits there, and a formatter would move it.
            const unseen = refs.filter((ref) => ref.unseen !== undefined);
            const text = statementBelow(f, c.line, unseen.length > 0);
            const judged = refs.map((ref) => readerLiterals(ctx, ref)).filter(Boolean);
            if (judged.length && !judged.some((literals) => assertsAbout(literals, text)))
              add(
                f,
                c,
                `the statement under this format suppression is not text its tag's reader asserts about: ${text.split('\n')[0].slice(0, 60)}`
              );
            else if (unseen.length)
              unseenPairs.push({
                file: f.src,
                line: c.line,
                readers: unseen.map((r) => `${r.file}:${r.from}${r.to !== r.from ? `-${r.to}` : ''}`),
                how: unseen.map((r) => r.unseen)
              });
          }
        }
      }
      if (f.lang === 'shell') for (const message of shellSuppressions(c.text)) add(f, c, message);
      if (f.lang !== 'python') return;
      for (const message of pythonSuppressions(c.text)) add(f, c, message);
    });
  }
  return leg('suppression', 'sites', findings, { unseenPairs });
}

// ------------------------------------------------------------------------------ pinned defects

const PIN_TITLE = /PINNED DEFECT\s+([^:]+):/;

/**
 * The defect ids in a pinned title. Two ids joined by "and" or a comma both count, a parenthetical
 * after an id is dropped, and an underscore reads as the hyphen the Python form writes it as.
 */
export function pinnedIdsOf(title) {
  const m = PIN_TITLE.exec(title);
  if (!m) return [];
  return m[1]
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:,|\band\b)\s*/)
    .map((s) => s.trim().replace(/_/g, '-'))
    .filter(Boolean);
}

function normalToken(t) {
  if (t.t === 'number') {
    const n = Number(t.v.replace(/_/g, '').replace(/n$/, ''));
    return Number.isFinite(n) ? String(n) : t.v.toLowerCase();
  }
  if (t.t === 'string' || t.t === 'ident' || t.t === 'template' || t.t === 'regex' || t.t === 'punct') return t.v;
  return '';
}

/** A fingerprint that survives a comment, a quote style, a semicolon, a trailing comma or a line break. */
export function fingerprintTokens(tokens) {
  const kept = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t === 'punct' && (t.v === ';' || t.v === '(' || t.v === ')')) continue;
    if (t.t === 'punct' && t.v === ',' && [')', ']', '}'].includes(tokens[k + 1]?.v)) continue;
    kept.push(normalToken(t));
  }
  return createHash('sha256').update(kept.join('\u0001')).digest('hex').slice(0, 16);
}

// The version of the pinned fingerprint. It moves whenever what a fingerprint covers moves, so a
// snapshot recorded under another version is re-recorded, never compared across versions. Version 3:
// a Python pin's fingerprint follows its helpers along its class chain, and every pin carries a run
// context beside it. Version 4: a JavaScript pin measures its run context too.
export const FINGERPRINT_VERSION = 4;

/**
 * The run context, the interface every language's pin collector plugs into. Beside `fingerprint`
 * (what the test asserts) and `stops` (each reason it would not run as written), every pin carries
 * `context`: a digest of everything outside the test's own body that decides whether it runs at all
 * (hooks, the class or suite around it, the file's entry point), or null for a language that does not
 * measure one yet. A context that moved is judged like a body that moved: it fails unless one of the
 * pin's ids has a FIX row for the current wave, or a new unfrozen row names the pin (pin:<id>) or its
 * file (pin-context:<file>, which re-records the contexts of that file and nothing else). A reason
 * not to run that the context holds goes into `stops` as well, and no FIX row licenses a stop.
 * Python measures it in scripts/tests/code_standard_ast.py, JavaScript in pinContext below. A language
 * joins by returning `context` from its collector and adding itself here, which moves FINGERPRINT_VERSION.
 */
export const RUN_CONTEXT_LANGS = new Set(['python', 'js']);

/** True when a pin's run context is not the one recorded for it. */
export const contextMoved = (was, is) => (was.context ?? null) !== (is.context ?? null);
const SKIP_KEYS = new Set(['skip', 'todo', 'only']);
const SUITES = new Set(['describe', 'suite']);

/**
 * Every declaration at the top level of a JS file: name -> [start, end], the whole statement, by
 * significant-token index. A destructuring declaration maps each name to the whole statement.
 */
function topLevelDeclarations(toks) {
  const decls = new Map();
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'punct' && ['(', '[', '{'].includes(t.v)) depth++;
    else if (t.t === 'punct' && [')', ']', '}'].includes(t.v)) depth--;
    if (depth !== 0 || t.t !== 'ident') continue;
    if ((t.v === 'function' || t.v === 'class') && toks[k + 1]?.t === 'ident') {
      let body = k + 2;
      while (body < toks.length && toks[body].v !== '{')
        body = toks[body].v === '(' ? closing(toks, body) + 1 : body + 1;
      const end = closing(toks, body);
      if (!decls.has(toks[k + 1].v)) decls.set(toks[k + 1].v, [k, end]);
      k = end;
      continue;
    }
    if (!['const', 'let', 'var'].includes(t.v)) continue;
    let end = k + 1;
    for (let d = 0; end < toks.length; end++) {
      const u = toks[end];
      if (u.t === 'punct' && ['(', '[', '{'].includes(u.v)) d++;
      else if (u.t === 'punct' && [')', ']', '}'].includes(u.v)) d--;
      else if (d === 0 && u.v === ';') break;
      if (
        d === 0 &&
        toks[end + 1] &&
        toks[end + 1].line > u.line &&
        ['const', 'let', 'var', 'function', 'test', 'it', 'describe', 'class'].includes(toks[end + 1].v)
      )
        break;
    }
    const eq = toks.findIndex((u, j) => j > k && u.v === '=');
    const stop = eq === -1 || eq > end ? end : eq;
    for (let j = k + 1; j < stop; j++) {
      const name = toks[j];
      if (name.t === 'ident' && toks[j + 1]?.v !== ':' && !decls.has(name.v)) decls.set(name.v, [k, end]);
    }
    k = end;
  }
  return decls;
}

/** The indices of the brackets that enclose toks[k], innermost first. */
function enclosers(toks, k) {
  const out = [];
  let depth = 0;
  for (let j = k - 1; j >= 0; j--) {
    if (toks[j].t !== 'punct') continue;
    if ([')', ']', '}'].includes(toks[j].v)) depth++;
    else if (['(', '[', '{'].includes(toks[j].v)) {
      if (depth === 0) out.push(j);
      else depth--;
    }
  }
  return out;
}

/** Index of the '(' that the ')' at toks[close] closes. */
function opening(toks, close) {
  let depth = 0;
  for (let j = close; j >= 0; j--) {
    if (toks[j].v === ')') depth++;
    else if (toks[j].v === '(' && --depth === 0) return j;
  }
  return 0;
}

/** Skip, todo or only named in an object literal's own keys: `{ skip: true }`, `{ todo }`. */
function skipKeys(toks, open) {
  const close = closing(toks, open);
  const keys = [];
  for (let j = open + 1, depth = 0; j < close; j++) {
    const v = toks[j].v;
    if (['(', '[', '{'].includes(v)) depth++;
    else if ([')', ']', '}'].includes(v)) depth--;
    else if (depth === 0 && toks[j].t === 'ident' && SKIP_KEYS.has(v) && [':', ',', '}'].includes(toks[j + 1]?.v))
      keys.push(v);
  }
  return keys;
}

/**
 * Why a suite call that opens at `open` (the '(' after describe or suite) would not run everything
 * inside it: a modifier (describe.skip) or a skip, todo or only key in its options.
 */
function suiteStops(toks, open) {
  const out = [];
  if (toks[open - 2]?.v === '.' && SUITES.has(toks[open - 3]?.v)) out.push(`${toks[open - 3].v}.${toks[open - 1].v}`);
  const close = closing(toks, open);
  for (let j = open + 1, depth = 0; j < close; j++) {
    if (depth === 0 && toks[j].v === '{' && toks[j - 1]?.v === ',')
      out.push(...skipKeys(toks, j).map((key) => `a suite with { ${key} }`));
    if (['(', '[', '{'].includes(toks[j].v)) depth++;
    else if ([')', ']', '}'].includes(toks[j].v)) depth--;
  }
  return out;
}

/** True when the '(' at toks[open] opens a call to describe or suite, with or without a modifier. */
const isSuiteCall = (toks, open) =>
  (toks[open - 1]?.t === 'ident' && SUITES.has(toks[open - 1].v) && toks[open - 2]?.v !== '.') ||
  (toks[open - 2]?.v === '.' && SUITES.has(toks[open - 3]?.v));

/** True when the '{' at toks[b] opens a function body: an arrow's, or a function expression's. */
function opensFunction(toks, b) {
  if (toks[b - 1]?.v === '=>') return true;
  if (toks[b - 1]?.v !== ')') return false;
  const p = opening(toks, b - 1);
  return toks[p - 1]?.v === 'function' || (toks[p - 1]?.t === 'ident' && toks[p - 2]?.v === 'function');
}

/**
 * Where a pinned test at toks[k] sits, and why it would not run there: [] when it is a statement at
 * the top level, directly inside a describe or suite callback, or directly inside a for...of loop over
 * a top-level const (whose head then joins the fingerprint). Anything else (an if, an else, a
 * function body, a skipped suite, an expression) is a place it may never run.
 */
function placement(toks, k, decls) {
  const stops = [];
  const loopHeads = [];
  const prev = toks[k - 1];
  const chain = enclosers(toks, k);
  // An arrow's expression body counts as a statement only when that arrow is a suite's argument.
  const suiteArrow =
    prev?.v === '=>' && chain[0] !== undefined && toks[chain[0]].v === '(' && isSuiteCall(toks, chain[0]);
  // A statement also starts on a new line after a token that can end one (no semicolon, ASI), unless
  // that token is the ')' of an if, while, for or with head, or a word that expects more.
  const endsAStatement =
    prev &&
    toks[k].line > prev.line &&
    (['string', 'number', 'template', 'regex'].includes(prev.t) ||
      (prev.t === 'ident' && !REGEX_AFTER_WORDS.has(prev.v)) ||
      prev.v === ']' ||
      (prev.v === ')' && !HEAD_WORDS.has(toks[opening(toks, k - 1) - 1]?.v)));
  const statementStart = !prev || suiteArrow || [';', '{', '}'].includes(prev.v) || endsAStatement;
  const forOf = (close) => {
    const p = opening(toks, close);
    if (toks[p - 1]?.v !== 'for') return null;
    const of = toks.findIndex((t, j) => j > p && j < close && t.v === 'of');
    const list = toks[of + 1];
    const ok = of !== -1 && of + 2 === close && list?.t === 'ident' && decls.has(list.v);
    return { ok, head: [p - 1, close] };
  };
  if (!statementStart) {
    const loop = prev?.v === ')' ? forOf(k - 1) : null;
    if (loop?.ok) loopHeads.push(loop.head);
    else if (prev?.v === '=>') stops.push('it is inside a function body, which may never be called');
    else
      stops.push(prev?.v === ')' || prev?.v === 'else' ? 'it sits under a condition' : 'it is part of an expression');
  }
  for (let n = 0; n < chain.length; n++) {
    const e = chain[n];
    const v = toks[e].v;
    if (v === '(' && isSuiteCall(toks, e)) {
      stops.push(...suiteStops(toks, e));
      continue;
    }
    if (v !== '{') {
      stops.push('it is inside an expression');
      continue;
    }
    if (opensFunction(toks, e)) {
      const call = chain[n + 1];
      if (call !== undefined && toks[call].v === '(' && isSuiteCall(toks, call)) {
        stops.push(...suiteStops(toks, call));
        n++;
        continue;
      }
      stops.push('it is inside a function body, which may never be called');
      continue;
    }
    const loop = toks[e - 1]?.v === ')' ? forOf(e - 1) : null;
    if (loop?.ok) {
      loopHeads.push(loop.head);
      continue;
    }
    stops.push('it sits under a condition or in a block');
  }
  return { stops: [...new Set(stops)], loopHeads };
}

/** The test-context skips a callback body makes at its own level: `t.skip(...)`, `t.todo(...)`. */
function contextSkips(toks, b) {
  const close = closing(toks, b);
  const out = [];
  for (let j = b + 1; j < close; j++) {
    if (toks[j].v !== '.' || !['skip', 'todo'].includes(toks[j + 1]?.v) || toks[j + 2]?.v !== '(') continue;
    const inner = enclosers(toks, j).filter((e) => e > b);
    if (!inner.some((e) => toks[e].v === '{' && opensFunction(toks, e)))
      out.push(`it calls ${toks[j - 1].v}.${toks[j + 1].v}()`);
  }
  return out;
}

/** True when a line break between two tokens ends a statement (ASI): the first can end one, the second start one. */
function breaksStatement(prev, next) {
  if (!prev || !next || next.line <= prev.line) return false;
  const ends =
    ['string', 'number', 'regex'].includes(prev.t) ||
    (prev.t === 'template' && prev.close) ||
    (prev.t === 'ident' && !REGEX_AFTER_WORDS.has(prev.v)) ||
    [')', ']', '}', '++', '--'].includes(prev.v);
  const starts =
    (next.t === 'ident' && !['in', 'instanceof', 'of'].includes(next.v)) ||
    ['string', 'number', 'regex'].includes(next.t) ||
    ['{', '!', '~', '++', '--'].includes(next.v);
  return ends && starts;
}

/**
 * True when the callback body that opens at toks[b] returns before its last statement. A return ends
 * where JavaScript ends it: at its semicolon, at the brace that closes its block, or at a line break,
 * since a bare return followed by a line break returns undefined and what follows never runs.
 */
function returnsEarly(toks, b) {
  const close = closing(toks, b);
  for (let r = b + 1; r < close; r++) {
    if (toks[r].v !== 'return') continue;
    const inner = enclosers(toks, r).filter((e) => e > b);
    if (inner.some((e) => toks[e].v === '{' && opensFunction(toks, e))) continue;
    let end = r + 1;
    if (end < close && toks[end].line === toks[r].line) {
      for (let d = 0; end < close; end++) {
        const v = toks[end].v;
        if (d === 0 && end > r + 1 && breaksStatement(toks[end - 1], toks[end])) break;
        if (['(', '[', '{'].includes(v)) d++;
        else if ([')', ']', '}'].includes(v)) {
          if (d-- === 0) break;
        } else if (d === 0 && v === ';') {
          end++;
          break;
        }
      }
    }
    if (toks.slice(end, close).some((t) => t.v !== '}' && t.v !== ';')) return true;
  }
  return false;
}

const LITERAL_WORDS = new Map([
  ['true', true],
  ['false', false],
  ['null', null],
  ['undefined', undefined],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY]
]);
const COMPARISONS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=']);

/** JavaScript's == on the primitives a literal can be, spelled without ==. */
function looselyEqual(a, b) {
  const nullish = (v) => v === null || v === undefined;
  if (nullish(a) || nullish(b)) return nullish(a) && nullish(b);
  return typeof a === typeof b ? a === b : Number(a) === Number(b);
}

function compared(op, a, b) {
  if (op === '===') return a === b;
  if (op === '!==') return a !== b;
  if (op === '==') return looselyEqual(a, b);
  if (op === '!=') return !looselyEqual(a, b);
  if (op === '<') return a < b;
  if (op === '>') return a > b;
  return op === '<=' ? a <= b : a >= b;
}

/**
 * The value of toks[a..z) when it is built from literals alone (false, 0, '', null, !true, 1 === 2,
 * false && anything), as { value }, or null when any part of it is not known before the test runs.
 * Nothing is evaluated: the grammar is literals, unary ! - + void, comparisons, && and ||.
 */
function constantValue(toks, a, z) {
  let k = a;
  const at = () => (k < z ? toks[k] : null);
  // The tokens of one operand the short circuit never evaluates, up to the next operator in `stops`.
  const skip = (stops) => {
    for (let d = 0; k < z; k++) {
      const v = toks[k].v;
      if (d === 0 && stops.includes(v)) return;
      if (['(', '[', '{'].includes(v)) d++;
      else if ([')', ']', '}'].includes(v)) d--;
    }
  };
  const unary = () => {
    const t = at();
    if (!t) return null;
    k++;
    if (['!', '-', '+'].includes(t.v) || t.v === 'void') {
      const r = unary();
      if (!r) return null;
      if (t.v === '!') return { value: !r.value };
      if (t.v === 'void') return { value: undefined };
      return { value: t.v === '-' ? -r.value : +r.value };
    }
    if (t.v === '(') {
      const c = closing(toks, k - 1);
      if (c >= z) return null;
      const r = constantValue(toks, k, c);
      k = c + 1;
      return r;
    }
    if (t.t === 'number' && !t.v.endsWith('n')) {
      const n = Number(t.v.replace(/_/g, ''));
      return Number.isNaN(n) ? null : { value: n };
    }
    if (t.t === 'string' || (t.t === 'template' && t.open && t.close)) return { value: t.v };
    if (t.t === 'ident' && LITERAL_WORDS.has(t.v) && toks[k]?.v !== '.') return { value: LITERAL_WORDS.get(t.v) };
    return null;
  };
  const comparison = () => {
    let left = unary();
    while (at() && COMPARISONS.has(at().v)) {
      const op = toks[k++].v;
      const right = unary();
      left = left && right ? { value: compared(op, left.value, right.value) } : null;
    }
    return left;
  };
  const conjunction = () => {
    let left = comparison();
    while (at()?.v === '&&') {
      k++;
      if (left && !left.value) skip(['&&', '||']);
      else {
        const right = comparison();
        left = left && right ? right : null;
      }
    }
    return left;
  };
  let value = conjunction();
  while (at()?.v === '||') {
    k++;
    if (value?.value) skip(['||']);
    else {
      const right = conjunction();
      value = value && right ? right : null;
    }
  }
  return k === z ? value : null;
}

/** The tokens toks[a..z) as one short line for a message, `if (1 === 2)`, never the file's own text. */
function shownTokens(toks, a, z) {
  const text = toks
    .slice(a, z)
    .map((t) => t.raw.replace(/\s+/g, ' '))
    .join(' ')
    .replace(/([(!]) /g, '$1')
    .replace(/ ?(\??\.) /g, '$1')
    .replace(/([\w$]) \(/g, '$1(')
    .replace(/ \)/g, ')');
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

/** The last token of the statement that starts at toks[s] (an if's consequent). */
function statementEnd(toks, s, close) {
  if (toks[s]?.v === '{') return closing(toks, s);
  for (let k = s, d = 0; k < close; k++) {
    const v = toks[k].v;
    if (['(', '[', '{'].includes(v)) d++;
    else if ([')', ']', '}'].includes(v)) {
      if (d-- === 0) return k - 1;
    } else if (d === 0 && v === ';') return k;
    if (d === 0 && breaksStatement(toks[k], toks[k + 1])) return k;
  }
  return close - 1;
}

/**
 * The parts of the callback body that opens at toks[b] that can never run, so an assertion there
 * passes by never being asked: code under a condition built from literals alone that is false (if,
 * while, for, &&, a ternary), the else of one that is true, and code after an unconditional break or
 * continue in the same block. A return is returnsEarly's.
 */
function deadParts(toks, b) {
  const close = closing(toks, b);
  const out = [];
  const doBodies = new Set();
  for (let j = b + 1; j < close; j++) {
    const t = toks[j];
    if (t.v === 'do' && toks[j + 1]?.v === '{') doBodies.add(closing(toks, j + 1) + 1);
    if (t.t === 'ident' && ['if', 'while', 'for'].includes(t.v) && toks[j + 1]?.v === '(' && toks[j - 1]?.v !== '.') {
      if (t.v === 'while' && doBodies.has(j)) continue;
      const q = closing(toks, j + 1);
      let [a, z] = [j + 2, q];
      if (t.v === 'for') {
        const semis = [];
        for (let k = j + 2, d = 0; k < q; k++) {
          if (['(', '[', '{'].includes(toks[k].v)) d++;
          else if ([')', ']', '}'].includes(toks[k].v)) d--;
          else if (d === 0 && toks[k].v === ';') semis.push(k);
        }
        if (semis.length !== 2 || semis[0] + 1 === semis[1]) continue;
        [a, z] = [semis[0] + 1, semis[1]];
      }
      const c = constantValue(toks, a, z);
      if (!c) continue;
      const cond = shownTokens(toks, a, z);
      const shown = t.v === 'for' ? `for (; ${cond};)` : `${t.v} (${cond})`;
      if (!c.value) out.push(`part of it sits under ${shown}, which never runs`);
      else if (t.v === 'if' && toks[statementEnd(toks, q + 1, close) + 1]?.v === 'else')
        out.push(`part of it sits under the else of ${shown}, which never runs`);
      continue;
    }
    if (['&&', '||', '?'].includes(t.v)) {
      const head = enclosers(toks, j)[0];
      if (head !== undefined && toks[head].v === '(' && HEAD_WORDS.has(toks[head - 1]?.v)) continue;
      let s = j;
      while (s - 1 > b) {
        const u = toks[s - 1];
        if (u.v === ')') s = opening(toks, s - 1);
        else if (
          ['number', 'string'].includes(u.t) ||
          (u.t === 'template' && u.open && u.close) ||
          (u.t === 'ident' && (LITERAL_WORDS.has(u.v) || u.v === 'void')) ||
          ['!', '-', '+'].includes(u.v)
        )
          s--;
        else break;
      }
      const before = toks[s - 1];
      const bounded =
        s < j &&
        (['(', ',', ';', '{', '}', '=', '=>', ':', '?', 'return'].includes(before.v) ||
          (t.v === '&&' && before.v === '&&') ||
          (toks[s].line > before.line && (before.t !== 'punct' || [')', ']', '}'].includes(before.v))));
      const c = bounded ? constantValue(toks, s, j) : null;
      if (!c) continue;
      const cond = shownTokens(toks, s, j);
      if (t.v === '&&' && !c.value) out.push(`part of it sits under ${cond} &&, which never runs`);
      else if (t.v === '||' && c.value) out.push(`part of it sits under ${cond} ||, which never runs`);
      else if (t.v === '?')
        out.push(`part of it sits under the ${c.value ? 'else' : 'then'} branch of ${cond} ?, which never runs`);
      continue;
    }
    if (t.v !== 'break' && t.v !== 'continue') continue;
    const prev = toks[j - 1];
    const unconditional =
      [';', '{', '}', ':'].includes(prev.v) ||
      (breaksStatement(prev, t) && !prev.closesHead && prev.v !== 'else' && prev.v !== 'do');
    if (!unconditional) continue;
    let end = j + 1;
    if (toks[end]?.t === 'ident' && toks[end].line === t.line && toks[end].v !== 'case' && toks[end].v !== 'default')
      end++;
    if (toks[end]?.v === ';') end++;
    const next = toks[end];
    if (end < close && next && !['}', 'case', 'default'].includes(next.v))
      out.push(`part of it sits after a ${t.v}, which never runs`);
  }
  return out;
}

// ------------------------------------------------------------------------ a JS pin's run context

const HOOKS = new Set(['before', 'beforeEach', 'after', 'afterEach']);
const NODE_TEST_EXPORTS = new Set(['test', 'it', 'describe', 'suite', ...HOOKS]);
const PROCESS_STOPS = new Set(['exit', 'abort', 'reallyExit', 'kill']);
const HOOK_SKIPS = new Set(['skip', 'todo', 'runOnly']);
const CONTINUES = new Set(['else', 'catch', 'finally']);

/** Index of the bracket that opens the one closing at toks[close], of any kind. */
function openerOf(toks, close) {
  for (let j = close, depth = 0; j >= 0; j--) {
    if (toks[j].t !== 'punct') continue;
    if ([')', ']', '}'].includes(toks[j].v)) depth++;
    else if (['(', '[', '{'].includes(toks[j].v) && --depth === 0) return j;
  }
  return 0;
}

/**
 * What a JS file binds to node:test: `names`, local name to the export it stands for (`b4` to before,
 * a default import to test), and `spaces`, the names whose members are its exports (`nt.before`). An
 * export's own name counts too unless the file declares it or imports it from elsewhere (`foreign`).
 */
function nodeTestNames(toks, decls) {
  const names = new Map();
  const spaces = new Set();
  const foreign = new Set(decls.keys());
  const bind = (open, into) => {
    const close = closing(toks, open);
    for (let j = open + 1; j < close; j++) {
      if (toks[j].t !== 'ident') continue;
      const alias = ['as', ':'].includes(toks[j + 1]?.v) && toks[j + 2]?.t === 'ident';
      into(alias ? toks[j + 2].v : toks[j].v, toks[j].v);
      if (alias) j += 2;
    }
  };
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].v !== 'from' || toks[k + 1]?.t !== 'string') continue;
    const ours = toks[k + 1].v === 'node:test';
    let s = k - 1;
    while (s > 0 && !['import', 'export', ';'].includes(toks[s].v)) s--;
    if (toks[s].v !== 'import') continue;
    for (let c = s + 1; c < k; c++) {
      const u = toks[c];
      if (u.v === '{') {
        bind(c, (local, imported) => (ours ? names.set(local, imported) : foreign.add(local)));
        c = closing(toks, c);
      } else if (u.v === '*' && toks[c + 1]?.v === 'as') {
        if (ours) spaces.add(toks[c + 2].v);
        else foreign.add(toks[c + 2].v);
        c += 2;
      } else if (u.t === 'ident') {
        if (ours) {
          names.set(u.v, 'test');
          spaces.add(u.v);
        } else foreign.add(u.v);
      }
    }
  }
  for (let k = 3; k + 1 < toks.length; k++) {
    if (toks[k].v !== 'node:test' || toks[k].t !== 'string' || toks[k - 2]?.v !== 'require' || toks[k + 1].v !== ')')
      continue;
    const target = toks[k - 4];
    if (toks[k - 3]?.v !== '=' || !target) continue;
    if (target.t === 'ident') {
      names.set(target.v, 'test');
      spaces.add(target.v);
      foreign.delete(target.v);
    } else if (target.v === '}')
      bind(openerOf(toks, k - 4), (local, imported) => {
        names.set(local, imported);
        foreign.delete(local);
      });
  }
  // A plain alias of one of those: const b4 = before; const d = nt.describe.
  for (let k = 0; k + 4 < toks.length; k++) {
    if (!['const', 'let', 'var'].includes(toks[k].v) || toks[k + 2].v !== '=') continue;
    const [name, val, next] = [toks[k + 1], toks[k + 3], toks[k + 4]];
    if (name.t !== 'ident' || val.t !== 'ident') continue;
    const member = toks[k + 5];
    if (names.has(val.v) && !['.', '(', '?.'].includes(next.v)) names.set(name.v, names.get(val.v));
    else if (spaces.has(val.v) && next.v === '.' && NODE_TEST_EXPORTS.has(member?.v) && toks[k + 6]?.v !== '(')
      names.set(name.v, member.v);
    else continue;
    foreign.delete(name.v);
  }
  return { names, spaces, foreign };
}

/**
 * The node:test call that opens at toks[open], as { name, modifier, start }: `before(`, `b4(`,
 * `nt.describe.skip(`, `test.only(`. Null for any other call.
 */
function calleeOf(toks, open, nt) {
  let s = open - 1;
  if (toks[s]?.t !== 'ident') return null;
  const parts = [toks[s].v];
  while (toks[s - 1]?.v === '.' && toks[s - 2]?.t === 'ident') {
    s -= 2;
    parts.unshift(toks[s].v);
  }
  if (['.', '?.'].includes(toks[s - 1]?.v)) return null;
  let [head, ...rest] = parts;
  if (nt.spaces.has(head) && NODE_TEST_EXPORTS.has(rest[0])) [head, ...rest] = rest;
  else head = nt.names.get(head) ?? (NODE_TEST_EXPORTS.has(head) && !nt.foreign.has(head) ? head : null);
  if (!head || rest.length > 1 || (rest.length && !SKIP_KEYS.has(rest[0]))) return null;
  return { name: head, modifier: rest[0] ?? null, start: s };
}

/** True when the '{' at toks[e] opens a function body: an arrow's, a function's, or a method's. */
function opensBody(toks, e) {
  if (opensFunction(toks, e)) return true;
  if (toks[e - 1]?.v !== ')' || toks[e - 1].closesHead) return false;
  const name = toks[opening(toks, e - 1) - 1];
  return name?.t === 'ident' && !['catch', 'switch'].includes(name.v);
}

/** The first token of the arrow function whose => sits at toks[arrow]: its parameters, or async. */
function fnStart(toks, arrow) {
  const p = toks[arrow - 1]?.v === ')' ? opening(toks, arrow - 1) : arrow - 1;
  return toks[p - 1]?.v === 'async' ? p - 1 : p;
}

/** The first token of the function expression whose body opens at toks[e] (opensFunction holds). */
function bodyStart(toks, e) {
  if (toks[e - 1]?.v === '=>') return fnStart(toks, e - 1);
  let s = opening(toks, e - 1) - 1;
  if (toks[s]?.v !== 'function') s--;
  return toks[s - 1]?.v === 'async' ? s - 1 : s;
}

/**
 * The => of an arrow whose expression body holds toks[from], scanning back to the bracket at toks[stop]
 * (-1 for the file), or -1: an arrow before a comma, a semicolon or a statement break is another's.
 */
function arrowBefore(toks, from, stop) {
  for (let j = from - 1, d = 0; j > stop; j--) {
    const v = toks[j].v;
    if (d === 0 && breaksStatement(toks[j], toks[j + 1])) return -1;
    if ([')', ']', '}'].includes(v)) d++;
    else if (['(', '[', '{'].includes(v)) d--;
    else if (d === 0 && v === '=>') return j;
    else if (d === 0 && (v === ',' || v === ';')) return -1;
  }
  return -1;
}

/**
 * Where the code at toks[k] runs, as { kind, suites, hook, open }: kind 'module' (as the file loads or
 * a suite registers its tests), 'test' (in a test or it callback), 'hook' (in a before, beforeEach,
 * after or afterEach callback, named by `hook`, whose call opens at `open`) or 'declared' (in a function
 * that runs only when something calls it). A function passed to any other call runs where that call
 * runs, so `setTimeout(() => process.exit(0))` at the top level is 'module'. `suites` are the parens of
 * the describe or suite calls it registers under, innermost first.
 */
function where(toks, k, nt) {
  const suites = [];
  const chain = enclosers(toks, k);
  let inner = k;
  for (let n = 0; n <= chain.length; n++) {
    const e = n < chain.length ? chain[n] : -1;
    let start = -1;
    let holderAt = n;
    const arrow = arrowBefore(toks, inner, e);
    if (arrow !== -1) start = fnStart(toks, arrow);
    else if (e !== -1 && toks[e].v === '{' && opensBody(toks, e)) {
      if (!opensFunction(toks, e)) return { kind: 'declared', suites };
      [start, holderAt] = [bodyStart(toks, e), n + 1];
    }
    if (start !== -1) {
      const holder = chain[holderAt];
      const direct =
        holder !== undefined && toks[holder].v === '(' && (toks[start - 1]?.v === ',' || start - 1 === holder);
      if (!direct) return { kind: 'declared', suites };
      n = holderAt;
    }
    const at = n < chain.length ? chain[n] : -1;
    if (at !== -1 && toks[at].v === '(') {
      const call = calleeOf(toks, at, nt);
      if (call && HOOKS.has(call.name)) return { kind: 'hook', suites, hook: call.name, open: at };
      if (call && (call.name === 'test' || call.name === 'it')) return { kind: 'test', suites };
      if (call && SUITES.has(call.name)) suites.push(at);
    }
    inner = at;
  }
  return { kind: 'module', suites };
}

/**
 * What a return at toks[k] leaves: { suite: -1 } at the top level, { suite, block } when it returns
 * from the callback of the suite call opening at `suite` (whose body opens at `block`), else null.
 */
function returnScope(toks, k, nt) {
  const chain = enclosers(toks, k);
  for (let n = 0; n < chain.length; n++) {
    const e = chain[n];
    if (toks[e].v !== '{' || !opensBody(toks, e)) continue;
    const holder = chain[n + 1];
    if (!opensFunction(toks, e) || holder === undefined || toks[holder].v !== '(') return null;
    const start = bodyStart(toks, e);
    const direct = toks[start - 1]?.v === ',' || start - 1 === holder;
    return direct && SUITES.has(calleeOf(toks, holder, nt)?.name) ? { suite: holder, block: e } : null;
  }
  return { suite: -1, block: -1 };
}

/** The innermost function body holding toks[k], or -1: the block a statement there belongs to. */
function blockOf(toks, k) {
  return enclosers(toks, k).find((e) => toks[e].v === '{' && opensBody(toks, e)) ?? -1;
}

/** The tokens of the statement holding toks[k], directly in the block that opens at toks[lo] (-1: the file). */
function statementAt(toks, k, lo) {
  const outer = enclosers(toks, k).filter((e) => e > lo);
  const o = outer.length ? outer[outer.length - 1] : k;
  let a = o;
  while (a - 1 > lo) {
    const p = toks[a - 1];
    if (p.v === ';' || (breaksStatement(p, toks[a]) && !CONTINUES.has(toks[a].v))) break;
    a = [')', ']', '}'].includes(p.v) ? openerOf(toks, a - 1) : a - 1;
  }
  const hi = lo === -1 ? toks.length : closing(toks, lo);
  let z = ['(', '[', '{'].includes(toks[o].v) ? closing(toks, o) : o;
  while (z + 1 < hi && toks[z].v !== ';') {
    const next = toks[z + 1];
    if (breaksStatement(toks[z], next) && !CONTINUES.has(next.v)) break;
    z = ['(', '[', '{'].includes(next.v) ? closing(toks, z + 1) : z + 1;
  }
  return toks.slice(a, z + 1);
}

/** A call's options after its title: { object } (the '{' of a literal) or { named } (a name), else -1s. */
function optionsAt(toks, open) {
  const close = closing(toks, open);
  const args = [];
  for (let j = open + 1, d = 0, from = open + 1; j <= close; j++) {
    const v = toks[j].v;
    if (d === 0 && (v === ',' || j === close)) {
      if (j > from) args.push([from, j]);
      from = j + 1;
    }
    if (['(', '[', '{'].includes(v)) d++;
    else if ([')', ']', '}'].includes(v)) d--;
  }
  const second = args[1];
  if (!second) return { object: -1, named: -1 };
  if (toks[second[0]].v === '{' && closing(toks, second[0]) === second[1] - 1) return { object: second[0], named: -1 };
  const single = second[1] - second[0] === 1 && toks[second[0]].t === 'ident' && args.length > 2;
  return { object: -1, named: single ? second[0] : -1 };
}

/** Every top-level declaration named in toks[a..z), not after a dot: the one level a context follows. */
function namedIn(toks, a, z, decls) {
  const out = new Set();
  for (let j = a; j < z; j++)
    if (toks[j].t === 'ident' && !['.', '?.'].includes(toks[j - 1]?.v) && decls.has(toks[j].v)) out.add(toks[j].v);
  return [...out].sort();
}

/**
 * What decides whether the tests of a JS file run at all, found once per file: the hooks registered
 * as it loads or as a suite registers (`suite` -1 for the file's own), the calls marked only, every
 * process.exit (abort, reallyExit, kill), throw and return with where it runs, the t.skip(), t.todo()
 * and t.runOnly() calls, and the top-level functions called as the file loads that exit (`loadExits`).
 */
function contextFacts(toks, nt, decls) {
  const facts = { hooks: [], only: [], exits: [], throws: [], returns: [], skips: [], loadExits: [] };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.v === '(') {
      const call = calleeOf(toks, k, nt);
      if (!call) continue;
      if (HOOKS.has(call.name)) {
        const w = where(toks, call.start, nt);
        if (w.kind === 'module')
          facts.hooks.push({
            name: call.name,
            start: call.start,
            open: k,
            close: closing(toks, k),
            suite: w.suites[0] ?? -1
          });
        continue;
      }
      const options = optionsAt(toks, k);
      if (call.modifier === 'only' || (options.object !== -1 && skipKeys(toks, options.object).includes('only')))
        facts.only.push({ start: call.start, open: k, options });
      continue;
    }
    if (t.t !== 'ident' || ['.', '?.'].includes(toks[k - 1]?.v)) continue;
    if (t.v === 'process' && toks[k + 1]?.v === '.' && PROCESS_STOPS.has(toks[k + 2]?.v) && toks[k + 3]?.v === '(')
      facts.exits.push({ k, what: `process.${toks[k + 2].v}()`, w: where(toks, k, nt) });
    else if (t.v === 'throw') facts.throws.push({ k, w: where(toks, k, nt) });
    else if (t.v === 'return') {
      const scope = returnScope(toks, k, nt);
      if (scope) facts.returns.push({ k, ...scope });
    } else if (
      toks[k + 1]?.v === '.' &&
      HOOK_SKIPS.has(toks[k + 2]?.v) &&
      toks[k + 3]?.v === '(' &&
      !nt.names.has(t.v) &&
      !nt.spaces.has(t.v) &&
      !NODE_TEST_EXPORTS.has(t.v)
    )
      facts.skips.push({ k, what: `${t.v}.${toks[k + 2].v}()` });
  }
  for (const [name, [a, b]] of decls) {
    const exit = facts.exits.find((x) => x.k > a && x.k < b);
    if (!exit) continue;
    for (let j = 0; j < toks.length; j++) {
      if (j === a) j = b;
      else if (toks[j].v === name && toks[j].t === 'ident' && !['.', '?.'].includes(toks[j - 1]?.v))
        if (where(toks, j, nt).kind === 'module') facts.loadExits.push({ k: j, name, what: exit.what });
    }
  }
  return facts;
}

/**
 * A JS pin's run context: everything outside its own body that decides whether it runs at all, as
 * { context, stops }. The context digests the hooks of its file and of every suite around it (their
 * bodies, and one level of the top-level declarations they name), each suite's call and options, the
 * calls marked only, and the statements that can stop the file or a suite before the pin runs.
 * `stops` names each reason found there, without a line number so a recorded one stays recognised.
 */
function pinContext(toks, k, open, facts, nt, decls) {
  const { suites } = where(toks, k, nt);
  const stops = [];
  const covered = [];
  const mark = (what) => covered.push({ t: 'ident', v: `\u0002${what}` });
  const inside = (list, a, b) => list.filter((x) => x.k > a && x.k < b);
  for (const h of facts.hooks.filter((x) => x.suite === -1 || suites.includes(x.suite))) {
    const hook = `${h.name.startsWith('a') ? 'an' : 'a'} ${h.name} hook${h.suite === -1 ? '' : ' of its suite'}`;
    mark(h.name);
    covered.push(...toks.slice(h.start, h.close + 1));
    for (const x of [...inside(facts.skips, h.open, h.close), ...inside(facts.exits, h.open, h.close)])
      stops.push(`${hook} calls ${x.what}`);
    for (const name of namedIn(toks, h.open, h.close, decls)) {
      const [a, b] = decls.get(name);
      for (const x of [...inside(facts.skips, a, b), ...inside(facts.exits, a, b)])
        stops.push(`${hook} runs ${name}, which calls ${x.what}`);
    }
  }
  for (const x of facts.exits.filter((e) => e.w.kind === 'module')) {
    mark('exit');
    covered.push(...statementAt(toks, x.k, blockOf(toks, x.k)));
    stops.push(`its file calls ${x.what} outside any test, so its tests may never run`);
  }
  for (const x of facts.loadExits) {
    mark('exit');
    covered.push(...statementAt(toks, x.k, blockOf(toks, x.k)));
    stops.push(`its file calls ${x.name} outside any test, which calls ${x.what}`);
  }
  for (const x of facts.throws.filter((e) => e.w.kind === 'module')) {
    mark('throw');
    covered.push(...statementAt(toks, x.k, blockOf(toks, x.k)));
    stops.push('its file can throw outside any test, before its tests run');
  }
  for (const r of facts.returns.filter((x) => x.suite === -1 || suites.includes(x.suite))) {
    mark('return');
    covered.push(...statementAt(toks, r.k, r.block));
    if (r.k < k)
      stops.push(
        r.suite === -1
          ? 'its file returns at the top level before its tests run'
          : 'its suite returns before it registers all its tests'
      );
  }
  for (const m of facts.only) {
    mark('only');
    covered.push(...toks.slice(m.start, m.open));
    if (m.options.object !== -1) covered.push(...toks.slice(m.options.object, closing(toks, m.options.object) + 1));
    const encloses = m.open < k && closing(toks, m.open) > k;
    if (m.open !== open && !encloses) stops.push('another test or suite in its file is marked only');
  }
  for (const s of [...suites].reverse()) {
    const call = calleeOf(toks, s, nt);
    const options = optionsAt(toks, s);
    mark('suite');
    covered.push(...toks.slice(call.start, s));
    if (options.object !== -1) covered.push(...toks.slice(options.object, closing(toks, options.object) + 1));
    if (options.named !== -1) {
      covered.push(toks[options.named]);
      stops.push('a suite around it takes its options by name, so they cannot be read');
    }
  }
  for (const name of namedIn(covered, 0, covered.length, decls)) {
    const [a, b] = decls.get(name);
    covered.push({ t: 'ident', v: `\u0002${name}` }, ...toks.slice(a, b + 1));
  }
  return { context: fingerprintTokens(covered), stops };
}

/**
 * Every pinned test in a JS test file: [{file, line, title, ids, fingerprint, context, stops}]. The
 * context is pinContext's: the hooks, suites, only marks and early exits that decide whether it runs,
 * and each reason it finds there joins `stops`. The fingerprint covers the call's modifier (test.skip), its options and its callback, the head of a for...of loop it
 * sits in, and one level of the top-level functions and consts those name, so a weakened helper moves
 * every pin that calls it. `stops` says why the test would not run as written: a modifier, a skip,
 * todo or only option, options passed by name, a place it may never run, a return before its end, or
 * a part of its body that never runs (under a condition built from literals alone, after a break).
 */
function jsPinned(f) {
  const toks = significant(f.tokens);
  const decls = topLevelDeclarations(toks);
  const nt = nodeTestNames(toks, decls);
  const facts = contextFacts(toks, nt, decls);
  const out = [];
  for (let k = 0; k + 2 < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'ident' || !['test', 'it'].includes(t.v) || toks[k - 1]?.v === '.') continue;
    let open = k + 1;
    const modifier = toks[open].v === '.' && toks[open + 1]?.t === 'ident' ? toks[open + 1].v : null;
    if (modifier) open += 2;
    if (toks[open]?.v !== '(') continue;
    const first = toks[open + 1];
    if (!first || (first.t !== 'string' && first.t !== 'template')) continue;
    const end = closing(toks, open);
    let titleEnd = open + 1;
    if (first.t === 'template' && !first.close) {
      while (titleEnd < end && !(toks[titleEnd].t === 'template' && toks[titleEnd].close)) titleEnd++;
    }
    const title = first.t === 'string' ? first.v : f.text.slice(first.start + 1, toks[titleEnd].end - 1);
    const ids = pinnedIdsOf(title);
    if (!ids.length) continue;
    const { stops, loopHeads } = placement(toks, k, decls);
    if (modifier) stops.unshift(`${t.v}.${modifier}`);
    const second = toks[titleEnd + 2];
    if (toks[titleEnd + 1]?.v === ',' && second?.v === '{')
      stops.push(...skipKeys(toks, titleEnd + 2).map((key) => `{ ${key} }`));
    else if (second?.t === 'ident' && toks[titleEnd + 3]?.v === ',') stops.push('its options are passed by name');
    const body = toks.findIndex((u, j) => j > titleEnd && j < end && u.v === '{' && opensFunction(toks, j));
    if (body !== -1) stops.push(...contextSkips(toks, body));
    if (body !== -1 && returnsEarly(toks, body)) stops.push('it returns before its last statement');
    if (body !== -1) stops.push(...deadParts(toks, body));
    const run = pinContext(toks, k, open, facts, nt, decls);
    stops.push(...run.stops);
    const covered = [...toks.slice(k + 1, k + 1 + (modifier ? 2 : 0)), ...toks.slice(titleEnd + 1, end)];
    for (const [a, b] of loopHeads) covered.push(...toks.slice(a, b + 1));
    const named = [
      ...new Set(
        covered.filter((u, j) => u.t === 'ident' && covered[j - 1]?.v !== '.' && decls.has(u.v)).map((u) => u.v)
      )
    ].sort();
    for (const name of named) {
      const [a, b] = decls.get(name);
      covered.push({ t: 'ident', v: `\u0002${name}` }, ...toks.slice(a, b + 1));
    }
    out.push({
      file: f.src,
      line: t.line,
      title,
      ids,
      fingerprint: fingerprintTokens(covered),
      context: run.context,
      stops: [...new Set(stops)]
    });
  }
  return out;
}

/**
 * Every pinned assertion the tree holds: [{file, line, title, ids, fingerprint, context, stops}],
 * sorted. In the Kit that is every tracked test file, in the online scope or not: a test the manifest
 * drops online still runs in the Kit's CI, so a manifest row cannot switch its pins off.
 */
export function collectPinned(ctx) {
  const out = [];
  for (const f of [...ctx.files, ...(ctx.extraTests || [])]) {
    if (!isTestFile(f.src)) continue;
    if (f.lang === 'js') out.push(...jsPinned(f));
    else if (f.lang === 'python') {
      for (const p of f.pinned)
        out.push({
          file: f.src,
          line: p.line,
          title: p.name,
          ids: p.ids,
          fingerprint: p.fingerprint,
          context: p.context,
          stops: p.stops
        });
    }
  }
  return out.sort((a, b) => (a.file + a.title < b.file + b.title ? -1 : a.file + a.title > b.file + b.title ? 1 : 0));
}

/**
 * The defect ledger's rule, KEEP by default and FIX by name: a pinned assertion whose body or run
 * context changed since the recorded snapshot passes only when one of its ids has a FIX row for the
 * current wave; a row for any other wave licenses nothing, before its wave or after it. A pinned test that gained a
 * reason not to run as written (a skip, todo or only, a condition around it, a context skip, a return
 * before its end) fails whatever the FIX list says: a fix changes what a pin asserts, it never stops
 * the pin from running. The snapshot records each pin's reasons, because some pins guard themselves
 * on purpose (no symlinks on this machine, no variants/ in a generated tree); only a reason the
 * snapshot does not hold is new. In the Kit a snapshot entry is judged wherever its file ships; one
 * whose file is gone counts as changed, because deleting a pinned test is the quietest way to flip it.
 * A generated tree does not judge an entry whose file it does not hold: the plan dropped it, and the
 * Kit judges it.
 */
export function pinnedLeg(ctx, ratchet) {
  const fix = licensedIds(ratchet);
  const otherWave = new Map((ratchet.fix_list || []).filter((r) => !fix.has(r.id)).map((r) => [r.id, r.wave]));
  const now = new Map(collectPinned(ctx).map((p) => [`${p.file}\u0000${p.title}`, p]));
  const recorded = new Map((ratchet.pinned || []).map((w) => [`${w.file}\u0000${w.title}`, w]));
  const findings = [];
  const fixed = [];
  let skipped = 0;
  // A snapshot recorded under another fingerprint version holds values this checker does not compute,
  // so comparing them would call every pin changed. The ratchet check fails on the version itself, with
  // the one step that fixes it (--record), and the direction leg, which fingerprints the base with
  // this checker, still judges every pin.
  const comparable = ratchet.fingerprint_version === undefined || ratchet.fingerprint_version === FINGERPRINT_VERSION;
  for (const [key, p] of now) {
    const allowed = new Set(recorded.get(key)?.stops || []);
    const fresh = p.stops.filter((s) => !allowed.has(s));
    if (fresh.length)
      findings.push({
        file: p.file,
        line: p.line,
        message: `PINNED DEFECT ${p.ids.join(', ')}: it would no longer run as written (${fresh.join('; ')}), whatever the FIX list says: "${p.title.slice(0, 90)}"`
      });
  }
  for (const was of comparable ? ratchet.pinned || [] : []) {
    const key = `${was.file}\u0000${was.title}`;
    const is = now.get(key);
    if (!ctx.isKit && !ctx.tracked.has(was.file)) {
      skipped++;
      continue;
    }
    const bodyMoved = !is || is.fingerprint !== was.fingerprint;
    const runMoved = Boolean(is) && contextMoved(was, is);
    if (!bodyMoved && !runMoved) continue;
    const change = is
      ? [bodyMoved && 'its body changed', runMoved && 'its run context changed'].filter(Boolean).join(' and ')
      : ctx.tracked.has(was.file)
        ? 'it is gone from the file'
        : 'its file is gone';
    const listed = was.ids.filter((id) => fix.has(id));
    const later = was.ids
      .filter((id) => otherWave.has(id))
      .map((id) => `${id} is listed for wave ${otherWave.get(id)}`);
    if (listed.length)
      fixed.push(
        `${was.file}: ${was.ids.join(', ')} (${change}; on the FIX list for wave ${ratchet.current_wave} as ${listed.join(', ')})`
      );
    else
      findings.push({
        file: was.file,
        line: is ? is.line : 1,
        message: `PINNED DEFECT ${was.ids.join(', ')}: ${change}, and no id is on the FIX list for wave ${ratchet.current_wave}${later.length ? ` (${later.join(', ')})` : ''}: "${was.title.slice(0, 90)}"`
      });
  }
  const added = [...now.values()].filter(
    (p) => !(ratchet.pinned || []).some((w) => w.file === p.file && w.title === p.title)
  );
  return leg('pinned', 'assertions', findings, { fixed, skipped, added: added.length, total: now.size, comparable });
}

// ------------------------------------------------------------------------------- duplication

// The fourteen duplicated concerns the standard's item 6 counts, each with its one home; the
// fourteenth is a list of small ones, measured as the sub-concerns a pattern can see. A
// detector reads code bodies (comments removed, strings kept) of in-scope files that are not test files
// or fixtures, except the one concern that IS the tests, and never counts the concern's home. A helper
// that sits under scripts/tests/ but is not a test is product code here. A count is files holding a
// copy. The exit-code concern counts files that exit 2 without a row in section 5.2's table.
const EXIT_TWO_TABLE = new Set([
  'scripts/secret-scan.mjs',
  'scripts/employer-data-guard.mjs',
  'scripts/personal-data-scan.js',
  'scripts/untrusted-lane-guard.js',
  'scripts/lib/build-soul-core.js',
  'scripts/skills-park.js',
  'work/18-recovery-layer/check.mjs',
  'scripts/build-online-template.mjs',
  'scripts/outputs-ledger.js',
  'scripts/heartbeat-check.mjs',
  'scripts/close-out-online.sh',
  'scripts/vault_search.py',
  'scripts/bootstrap.mjs',
  'scripts/generate-alex.js',
  'scripts/lib/template-gate.mjs',
  'scripts/run-log.mjs',
  'scripts/status-rotate.js',
  'scripts/lib/install-profile.js',
  'scripts/json-standard-audit.js',
  'scripts/prompt-regression-check.js',
  'scripts/import-memory.mjs'
]);

const escapeRe = (s) => s.replace(/[$^\\.*+?()[\]{}|]/g, '\\$&');

/** Lines where a name bound to a read's result is parsed as JSON: `const raw = readFileSync(p); JSON.parse(raw)`. */
function jsonOfARead(f) {
  const code = f.code;
  const names = [
    ...code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:[\w$.]+\.)?readFile(?:Sync)?\(/g)
  ].map((m) => m[1]);
  return names.flatMap((n) => matchLines(code, new RegExp(`JSON\\.parse\\(\\s*${escapeRe(n)}\\s*[,)]`)));
}

/**
 * A function's own `return 2;` or `return EXIT.REFUSED;`, anywhere in a top-level declaration's body,
 * where that declaration's name is later handed straight to process.exit or process.exitCode: the shape
 * exitThroughAConstant below cannot see, because no module-level name is ever bound to the literal 2.
 * `if (isMain(x)) process.exit(main(argv));` with `function main(argv) { ...; return 2; }` is exactly
 * this, and it is also how most CLIs in this tree actually reach exit 2.
 */
function returnsExitTwo(f) {
  if (f.lang !== 'js') return [];
  const toks = significant(f.tokens);
  const decls = topLevelDeclarations(toks);
  const out = [];
  for (const [name, [start, end]] of decls) {
    let returnsTwo = false;
    for (let k = start; k < end && !returnsTwo; k++) {
      if (toks[k].v !== 'return') continue;
      const a = toks[k + 1];
      if (a?.t === 'number' && a.v === '2' && toks[k + 2]?.v === ';') returnsTwo = true;
      else if (a?.t === 'ident' && a.v === 'EXIT' && toks[k + 2]?.v === '.' && toks[k + 3]?.v === 'REFUSED')
        returnsTwo = true;
    }
    if (!returnsTwo) continue;
    for (let k = 0; k + 2 < toks.length; k++) {
      const exits = toks[k].v === 'process' && toks[k + 1]?.v === '.' && ['exit', 'exitCode'].includes(toks[k + 2]?.v);
      if (!exits) continue;
      for (let j = k + 3; j < toks.length && j < k + 8 && toks[j].v !== ';'; j++) {
        if (toks[j].t === 'ident' && toks[j].v === name) {
          out.push(toks[k].line);
          break;
        }
      }
    }
  }
  return out;
}

/** Lines that exit through a constant bound to 2 (`const EXIT_REFUSED = 2; ... process.exit(EXIT_REFUSED)`),
 * or through a function whose own return value reaches process.exit/exitCode (returnsExitTwo above). */
function exitThroughAConstant(f) {
  const code = f.code;
  const names = [
    ...code.matchAll(/^\s*(?:(?:export\s+)?(?:const|let|var)\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*2\s*;?\s*(?:#.*)?$/gm)
  ].map((m) => m[1]);
  const constantLines = names.flatMap((n) =>
    matchLines(
      code,
      new RegExp(
        `(?:process\\.exit\\(\\s*|process\\.exitCode\\s*=\\s*|sys\\.exit\\(\\s*|SystemExit\\(\\s*|\\bexit\\s+"?\\$\\{?)${escapeRe(n)}\\b`
      )
    )
  );
  return [...constantLines, ...returnsExitTwo(f)];
}

export const CONCERNS = [
  {
    id: 'dup-repo-root',
    concern: 1,
    home: ['scripts/lib/repo-root.js'],
    // Copies that stay, each with its reason: the file must load copied alone, and frozen readers load
    // it that way, so taking repo-root.js would break them. Its header's HOW names those readers.
    sanctioned: {
      'scripts/lib/atomic-write.js': 'test-atomic-write-contract.mjs loads it copied alone',
      'scripts/capture-typed-input.js':
        'a UserPromptSubmit hook: a sibling that fails to load must never lose what the owner typed (standard 3.6), and its own tests run it copied alone',
      'scripts/lib/gen-launchd.js':
        'test-generator-libs-contract.mjs and its generated-plist test load it copied alone',
      'scripts/lib/write-lock.js': 'six tests copy it with no repo-root.js beside it',
      'scripts/autosave.sh':
        'a PostToolUse and Stop hook in shell: repo-root.js is JavaScript it cannot load, and its one git call is also the not-in-a-repository refusal before any save',
      'scripts/close-out-online.sh':
        'a Routine close-out in shell: repo-root.js is JavaScript it cannot load, and its one git call is also the not-in-a-repository refusal before any step',
      'scripts/hooks/pre-commit':
        'a shell hook: repo-root.js is JavaScript it cannot load, and its own git call doubles as the not-in-a-repository refusal before any guard leg runs',
      'kit:scripts/hooks/pre-commit':
        'a shell hook: repo-root.js is JavaScript it cannot load, and its own git call doubles as the not-in-a-repository refusal before any guard leg runs',
      'scripts/run-log.mjs':
        'computed by hand rather than imported from repo-root.js: every test that reaches this file copies it alone, without scripts/lib/, so a shared repo-root module would have to join each of those copy lists',
      'scripts/outputs-ledger.js':
        'computed by hand rather than imported from repo-root.js: every test that reaches this file copies it alone, without scripts/lib/, so a shared repo-root module would have to join that copy list',
      'scripts/waiting-on-them.js':
        'computed by hand rather than imported from repo-root.js, the same reason as its sibling human-actions.js and run-log.mjs: a test that reaches this file copies it alone, without scripts/lib/',
      'scripts/human-actions.js':
        'a SessionStart hook and Close-Out/Routine step (standard 3.6): computed by hand so a missing repo-root.js never stops even the degraded warning warnUnknownFlags still tries',
      'scripts/untrusted-lane-guard.js':
        'a PreToolUse hook that imports only Node builtins at its top level by its own NEVER paragraph: a require-time failure in a shared module must never turn a deny into a silent allow',
      'scripts/status-rotate.js':
        "required as a module by close-out-online.sh's heredoc for its lock functions alone (test-recall-online-closure.mjs): a hand-computed root keeps that require from depending on repo-root.js loading cleanly",
      'scripts/lib/build-soul-core.js':
        'every test that reaches this file copies it alone, named in its own HOW paragraph (test-build-soul-core-paths.mjs)',
      'work/18-recovery-layer/check.mjs':
        'copied alone by four test files, so a shared repo-root module would have to join each of their copy lists',
      'scripts/build-online-template.mjs':
        "HERE is the builder's own folder, used only to find clone-scrub-check.js beside it; the repository root itself comes from repo-root.js",
      'scripts/employer-data-guard.mjs':
        "its own HOW paragraph names the reason: it prefers the working directory's own git answer first and falls back to this file's checkout only when git fails, a different input from the shared resolver, which never asks git and is fixed once at load; a hook or a test can run this guard against a different repository than its own checkout"
    },
    patterns: [
      /path\.(?:join|resolve)\(\s*__dirname\s*,\s*['"]\.\.(?:[/\\]\.\.)*[/\\]?['"]/,
      /path\.dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)/,
      /path\.resolve\(\s*HERE\s*,\s*['"]\.\./,
      /rev-parse['",\s]+--show-toplevel/,
      /fileURLToPath\(\s*new URL\(\s*['"]\.\.?\//
    ]
  },
  {
    id: 'dup-args',
    concern: 2,
    home: ['scripts/lib/args.js'],
    sanctioned: {
      'scripts/heartbeat-check.mjs':
        'it already parses through scripts/lib/args.js; the argv slice only feeds parseCommandLine after a negative value is joined to its flag, which strict parseArgs would call ambiguous',
      'scripts/close-out-online.sh':
        "section 4's Routine edge written by hand in shell: an unknown flag warns and the save still runs; the heredoc reads two positionals this script passes itself",
      'scripts/generate-alex.js':
        "its own hand parser is the refusal surface test-generate-cli.mjs's G1 through G8 pin; routing it through args.js would retitle what each one asserts",
      'scripts/build-online-template.mjs':
        "its exported parseArgs is pinned by five of test-build-template-defects.mjs's own defect tests; moving it to args.js would retitle what each one asserts",
      'scripts/import-memory.mjs': 'argv is handed whole to main(), which parses it through scripts/lib/args.js',
      'scripts/prompt-regression-check.js':
        'argv is handed whole to main(), which parses it through scripts/lib/args.js',
      'scripts/run-migrations.js': 'argv is handed whole to main(), which parses it through scripts/lib/args.js',
      'scripts/run-log.mjs':
        'process.argv is split once, here, into the subcommand word and the rest; the rest is handed whole to append() or last(), which parse it through scripts/lib/args.js',
      'scripts/outputs-ledger.js':
        'process.argv is split once, here, into the subcommand word and the rest; the rest is handed whole to the dispatch below, which parses it through scripts/lib/args.js',
      'scripts/skills-park.js':
        'argv is captured once and handed whole to parseCommandLine on the operator edge; the argv.length === 0 check before it, which picks the --list default, is pinned at test-skills-park-cli.mjs:134',
      'work/23-self-review/diagnose/diagnose.js':
        "argv's third entry names the subcommand and the rest of argv is handed whole to parseRoutine for the subcommand it names: an adoption this pattern cannot see",
      'scripts/lib/install-profile.js':
        'its one flag check is an exact-token comparison, not a parser; args.js would turn its one documented refusal code into a different one',
      'scripts/bootstrap.mjs':
        'checks for one boolean flag anywhere on the line and ignores everything else by design (its own NEVER: any other argument is ignored); args.js would refuse an unrecognised one instead',
      'scripts/human-actions.js':
        'a SessionStart hook and Close-Out/Routine step (standard 3.6): arg() reads a flag by indexOf lookup, and warnUnknownFlags loads args.js inside a try so a missing or broken args.js only loses the unknown-flag warning, never the hook itself',
      'scripts/waiting-on-them.js':
        'a Routine-edge file, the mirror of human-actions.js: arg() reads a flag by indexOf lookup, and warnUnknownFlags loads args.js inside a try for the same reason',
      'scripts/status-rotate.js':
        "warnUnknownFlags loads args.js only for its unknown-flag warning and discards the rest, since this file's own --dry/--project rules are more lenient than a strict parse would allow; both it and args.js load only when the file runs as a command, so requiring the module for its lock functions alone pulls in neither",
      'scripts/untrusted-lane-guard.js':
        'a PreToolUse hook that imports only Node builtins at its top level by its own NEVER paragraph: a require-time failure in a shared module must never turn a deny into a silent allow',
      'scripts/secret-scan.mjs': 'a hook entry under standard 3.6: it imports builtins only',
      'scripts/tests/python-tools.mjs':
        'the whole file takes no argument at all (its own NEVER: accepts an argument); the argument list is checked only for being empty, which a parser does not simplify',
      'scripts/employer-data-guard.mjs': 'argv is handed whole to main(), which parses it through scripts/lib/args.js',
      'scripts/lib/install-state.js':
        'argv is handed whole to main(), which parses it through scripts/lib/args.js, required inside main() only because four readers load this library copied alone',
      'scripts/lib/template-gate.mjs': 'argv is handed whole to main(), which parses it through scripts/lib/args.js',
      'scripts/lib/build-soul-core.js':
        'args.js is loaded only inside a try for its unknown-flag warning (EDGE-WARN, standard section 4): a SessionStart hook must never let a failed require stop the card from building, so the one flag it reads stays a bare hand check outside that try',
      'scripts/lib/cli-version.js':
        'args.js is loaded only inside a try for its unknown-flag warning (EDGE-WARN, standard section 4): a SessionStart hook must never let a failed require stop the version check, so the one flag it reads stays a bare hand check outside that try',
      'work/18-recovery-layer/check.mjs':
        'args.js is loaded only inside a try for its unknown-flag warning (EDGE-WARN, standard section 4): a Routine edge must never let a failed require stop the sweep, so the one flag it reads stays a bare hand check outside that try'
    },
    patterns: [
      /process\.argv\.(?:slice|includes|indexOf|find|filter|some|at)\b|process\.argv\[[2-9]\]/,
      /\[\s*,\s*,[^\]]*\]\s*=\s*process\.argv\b|=\s*process\.argv\s*;/,
      /while\s+\[\s+"?\$#"?\s+-gt\s+0\s+\]/
    ],
    // A file that merely NAMES its own hand parser parseArgs (generate-alex.js, build-online-template.mjs)
    // is not node's parser, and this leg's job is to find exactly that kind of hand parser - so the
    // exemption below reads what the identifier resolves to, not what it is called: an import or a
    // destructured require of node:util's own parseArgs.
    unless:
      /\bparseArgs\b[^\n]*\bfrom\s+['"]node:util['"]|\{\s*parseArgs\s*\}\s*=\s*require\(\s*['"](?:node:)?util['"]\)/
  },
  {
    id: 'dup-json-read',
    concern: 3,
    home: ['scripts/lib/json-writer.js'],
    sanctioned: {
      'scripts/lib/write-lock.js':
        'six tests copy it with no json-writer.js beside it, so its holder read stays its own',
      'scripts/lib/validate/skills-json.js':
        "validate-alex.js loads it on every run and keeps json-writer.js behind V21's own catch, so a broken json-writer.js is one FAILED V21 line while every other leg still reports",
      'scripts/untrusted-lane-guard.js':
        'a PreToolUse hook that imports only Node builtins at its top level by its own NEVER paragraph: a require-time failure in a shared module must never turn a deny into a silent allow',
      'scripts/status-rotate.js':
        "reads system/manifest.json directly rather than through json-writer.js's reader, the same reason its root is computed by hand: requiring the module for its lock functions must not depend on json-writer.js loading cleanly either"
    },
    patterns: [/JSON\.parse\(\s*(?:fs\.)?readFileSync\(/],
    detect: jsonOfARead
  },
  {
    id: 'dup-run-log-read',
    concern: 4,
    home: ['scripts/lib/run-log-read.js'],
    sanctioned: {
      'work/18-recovery-layer/check.mjs':
        "names its own log path once, for the one sweep row it appends; every read of that file already goes through run-log-read.js's own reader, required at the top of this file, which is what the also pattern below mistakes for a second parse"
    },
    patterns: [/run-log\.jsonl/],
    also: /JSON\.parse/
  },
  {
    id: 'dup-lline-screen',
    concern: 5,
    home: ['system/recall/lib/lessons.js'],
    patterns: [/L:\?(?:\\s|\[\[:space:\]\])\*\s*(?:none|class=)/]
  },
  {
    id: 'dup-marker-region',
    concern: 6,
    home: ['scripts/lib/markers.js'],
    patterns: [/['"`]<!-- [A-Z][A-Z-]*(?::BEGIN|:END|_START|_END)\b/]
  },
  {
    id: 'dup-test-helpers',
    concern: 7,
    home: ['scripts/tests/portability-check.mjs'],
    tests: true,
    patterns: [/^[\s\S]/],
    unless: /from\s+['"]node:test['"]|require\(\s*['"]node:test['"]\s*\)|^\s*import\s+unittest\b|^\s*from\s+unittest\b/m
  },
  {
    id: 'dup-staged-paths',
    concern: 8,
    home: ['scripts/lib/staged-paths.js', 'scripts/lib/git.js'],
    sanctioned: {
      'scripts/autosave.sh':
        "a shell hook asking only whether anything is staged, by that quiet git call's exit code (no listing); the homes are JavaScript listers it cannot load",
      'scripts/hooks/pre-commit':
        'the size guard lists every staged add or modify by name through this one git diff call; the homes are JavaScript listers a shell hook cannot load',
      'kit:scripts/hooks/pre-commit':
        'the size guard lists every staged add or modify by name through this one git diff call; the homes are JavaScript listers a shell hook cannot load',
      'scripts/build-online-template.mjs': "it reads its own and the generated tree's index, never a commit's",
      'scripts/secret-scan.mjs':
        'a hook entry under standard 3.6: it imports builtins only, the same reason this file is already sanctioned under dup-args',
      'scripts/employer-data-guard.mjs':
        'scripts/tests/test-employer-guard-known-bad.mjs copies this file into a throwaway repository without scripts/lib/staged-paths.js or scripts/lib/git.js and runs the copy as a child process, the same constraint already sanctioned for run-log.mjs, outputs-ledger.js and waiting-on-them.js'
    },
    patterns: [/diff['",\s]+--cached/]
  },
  {
    id: 'dup-manifest-claim',
    concern: 9,
    home: ['scripts/lib/manifest-claim.js'],
    patterns: [/isDir\s*\?\s*[\w.]+\.startsWith\(\s*[\w.]+\.prefix\s*\)/]
  },
  {
    id: 'dup-mandatory-parse',
    concern: 10,
    home: ['scripts/lib/skill-state.js'],
    sanctioned: {
      'scripts/lib/validate/skills-json.js':
        'V17 parses the constitution a run is about to ship, the staged preview, and skill-state.js reads only the one on disk and loads json-writer.js as it loads; a parity test holds the two parses to one answer'
    },
    patterns: [/\/\^\\\|\.\*\\\|\\s\*MANDATORY/]
  },
  {
    id: 'dup-migration-ledger',
    concern: 11,
    home: ['scripts/lib/migration-ledger.js'],
    // The class keeps this pattern from matching its own source, which this leg also reads.
    patterns: [/migrations[-]applied/]
  },
  {
    id: 'dup-profile-read',
    concern: 12,
    home: ['scripts/lib/skill-state.js', 'scripts/lib/install-profile.js'],
    sanctioned: {
      'scripts/skills-park.js':
        "it reads through skill-state.js's readProfile and writes through install-profile.js; the two lines named are the write target and the owner's message, not a third reader",
      'scripts/employer-data-guard.mjs':
        "already reads leg 1's two profile fields through json-writer.js's byte-order-mark-tolerant reader; the lines this leg still finds are its own path constant and its own field names, not a second parse"
    },
    patterns: [/install-profile\.json/, /\bPROFILE_REL\b/],
    also: /readFileSync|readJson|JSON\.parse/
  },
  {
    id: 'dup-exit-two',
    concern: 13,
    home: [],
    exitTwo: true,
    patterns: [
      /process\.exit\(\s*2\s*\)|process\.exitCode\s*=\s*2\b|\bexit 2\b|sys\.exit\(\s*2\s*\)|SystemExit\(\s*2\s*\)/
    ],
    detect: exitThroughAConstant
  },
  { id: 'dup-refusal-class', concern: 14, home: ['scripts/lib/errors.js'], patterns: [/\bclass\s+Refusal\b/] },
  {
    id: 'dup-is-main',
    concern: 14,
    home: ['scripts/lib/errors.js'],
    patterns: [/realpathSync\.native\(\s*process\.argv\[1\]|\bconst\s+isMain\s*=/]
  },
  {
    id: 'dup-lastline',
    concern: 14,
    home: [],
    sanctioned: {
      'scripts/autosave.sh':
        "a hook entry sources nothing: a sibling that fails to load must never stop a save (standard 3.6); a parity test holds it equal to close-out-online.sh's",
      'scripts/close-out-online.sh':
        "a Routine close-out sources nothing, so every step line and the save survive a sibling that fails to load; a parity test holds it equal to autosave.sh's"
    },
    patterns: [/^\s*lastline\s*\(\)\s*\{/m]
  },
  {
    id: 'dup-max-blob-bytes',
    concern: 14,
    home: [],
    sanctioned: {
      'scripts/autosave.sh':
        'one number in two shells is a documented contract, not a shared constant (standard 3.4); test-autosave-paths.mjs compares it with both commit hooks',
      'scripts/hooks/pre-commit':
        'one number in two shells is a documented contract, not a shared constant (standard 3.4); test-autosave-paths.mjs compares it with the autosave',
      'kit:scripts/hooks/pre-commit':
        'one number in two shells is a documented contract, not a shared constant (standard 3.4); test-autosave-paths.mjs compares it with the autosave'
    },
    patterns: [/\bMAX_BLOB_BYTES\s*=\s*\d/]
  },
  {
    id: 'dup-job-name-regex',
    concern: 14,
    home: ['scripts/lib/read-sources.js'],
    sanctioned: {
      'scripts/lib/gen-launchd.js':
        'test-generator-libs-contract.mjs and its generated-plist test load it copied alone, without read-sources.js'
    },
    // The prefix before a character class, in a startsWith, or anchored at the start of a regular expression.
    patterns: [/\/[^/\n]*Alex-\[/, /startsWith\(\s*'Alex-'\s*\)/, /\^Alex[-]/]
  },
  {
    id: 'dup-pad-esc',
    concern: 14,
    home: ['scripts/lib/render-templates.js'],
    sanctioned: {
      'scripts/capture-typed-input.js':
        'a UserPromptSubmit hook: a sibling that fails to load must never lose what the owner typed (standard 3.6), and its own tests run it copied alone',
      'work/18-recovery-layer/check.mjs':
        "escapes a markdown table cell's own pipe characters the same way render-templates.js does, copied alone for the same reason as its repo-root: four test files copy it by itself"
    },
    // The value padded is a name or a member expression, String(n) or String(p.num).
    patterns: [/String\(\s*[\w$.]+\s*\)\.padStart\(\s*2\s*,\s*'0'\s*\)/, /\.replace\(\s*\/\\\|\/g\s*,/]
  },
  {
    id: 'dup-jsonl-row',
    concern: 14,
    home: ['scripts/lib/json-writer.js'],
    patterns: [/JSON\.stringify\(\s*JSON\.parse\(\s*canonicalText\(/]
  },
  {
    id: 'dup-source-rel',
    concern: 14,
    home: ['scripts/build-online-template.mjs'],
    sanctioned: {
      'scripts/lib/template-gate.mjs':
        "importing it from the builder, this concern's home, would drag the whole builder into every /update fixture run that exercises this file alone"
    },
    patterns: [/['"]system\/template-source\.json['"]/]
  }
];

/**
 * One leg per concern: the files holding a copy, with the lines where the copy sits; the home and a copy
 * the concern sanctions are left out. A sanction may name the path a file ships at, as the ceilings do, so
 * one entry covers a variant file in the Kit (variants/online/x) and the same file in a built tree (x).
 */
export function duplicationLegs(ctx) {
  return CONCERNS.map((d) => {
    const findings = [];
    const sanctioned = d.sanctioned ?? {};
    for (const f of ctx.files) {
      if (f.lang === 'json' || d.home.includes(f.src)) continue;
      if (Object.hasOwn(sanctioned, f.src) || Object.hasOwn(sanctioned, f.dst ?? f.src)) continue;
      if (d.tests ? !isTestFile(f.src) : isTestFile(f.src) || f.src.startsWith(FIXTURES)) continue;
      if (d.exitTwo && EXIT_TWO_TABLE.has(f.src)) continue;
      if (d.unless?.test(f.code)) continue;
      if (d.also && !d.also.test(f.code)) continue;
      const found = [...d.patterns.flatMap((re) => matchLines(f.code, re)), ...(d.detect ? d.detect(f) : [])];
      const lines = [...new Set(found)].sort((a, b) => a - b);
      if (lines.length)
        findings.push({
          file: f.src,
          line: lines[0],
          message: `a copy at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}`
        });
    }
    return leg(d.id, 'files', findings, { concern: d.concern });
  });
}

/**
 * A concern's home (or a sanctioned key) that names no tracked file makes that concern's leg
 * un-clearable and hides that a module the standard counts on was never built. A home not yet built is
 * named here as planned, with the copies that wait for it; any OTHER phantom fails. None is planned
 * today: every home the standard names, manifest-claim.js and migration-ledger.js included, is built.
 * A home or a sanctioned file that stops existing for any other reason (a typo, a rename nothing
 * followed) fails the moment it is not tracked, with no grace period.
 */
export const PLANNED_HOMES = {};

/**
 * CONCERNS' home and sanctioned entries, each a tracked file or a named planned exception. Judged only in
 * the Kit (ctx.isKit): CONCERNS names real Kit paths, so a synthetic fixture tree built to isolate an
 * unrelated mechanic (a handful of files, `isKit: false` by synth()'s own default) would otherwise report
 * every real home as phantom, breaking every OTHER test that runs a leg generically. The online tree
 * inherits the Kit's homes unchanged, so one Kit-side check covers both.
 */
export function homesLeg(ctx) {
  const findings = [];
  if (!ctx.isKit) return leg('homes', 'files', findings, { planned: PLANNED_HOMES });
  const seen = new Set();
  const check = (id, file, what) => {
    const key = `${what}\u0000${file}`;
    if (seen.has(key)) return;
    seen.add(key);
    // A kit: name is not itself a tracked path: git ls-files holds the Kit's own file underneath it.
    const tracked = file.startsWith(KIT_ONLY_PREFIX) ? file.slice(KIT_ONLY_PREFIX.length) : file;
    if (ctx.tracked.has(tracked) || Object.hasOwn(PLANNED_HOMES, file)) return;
    findings.push({
      file,
      line: 1,
      message: `${id}'s ${what} ${file} is not a tracked file, and not a planned home`
    });
  };
  for (const c of CONCERNS) {
    for (const home of c.home ?? []) check(c.id, home, 'home');
    for (const sanctioned of Object.keys(c.sanctioned ?? {})) check(c.id, sanctioned, 'sanctioned file');
  }
  return leg('homes', 'files', findings, { planned: PLANNED_HOMES });
}

// -------------------------------------------------------------------------------- everything

/** Every leg over one context, in the order the standard lists them. */
export function allLegs(ctx, ratchet) {
  return [
    headerLeg(ctx),
    headerCliLeg(ctx),
    diaryLeg(ctx, ratchet),
    danglingLeg(ctx),
    commentedOutLeg(ctx),
    contractLeg(ctx),
    moduleSplitLeg(ctx),
    floorLeg(ctx),
    suppressionLeg(ctx),
    pinnedLeg(ctx, ratchet),
    homesLeg(ctx),
    ...duplicationLegs(ctx)
  ];
}

/** Every leg whose number is a count, and so a ceiling: all of them except pinned, which is a snapshot. */
export const countedLegs = (legs) => legs.filter((l) => l.name !== 'pinned');
