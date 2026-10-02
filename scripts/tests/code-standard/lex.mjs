// scripts/tests/code-standard/lex.mjs - turns one file's raw text into tokens, comments and facts.
//
// WHAT. The lexers the legs read instead of re-parsing source text themselves: a hand-written JavaScript
// tokenizer, shell and YAML comment scanners, the bridge to the Python helper, and analyze(), which picks
// the right one by language and returns the shape every leg expects (comments, code with comments
// blanked out, and for JS its tokens, for Python its docstrings and reads).
//
// HOW. lexJs walks one JavaScript file by hand (no parser dependency), deciding a `/` is a regular
// expression or a division from the token before it, the same rule HEAD_WORDS and REGEX_AFTER_WORDS name
// so legs.mjs's dead-code scan can re-derive it without re-lexing. scanShell and scanYaml track quotes
// and heredocs by hand; findPython picks python3 or python, the order bootstrap.mjs uses, then
// pythonFacts spawns scripts/tests/code_standard_ast.py once for every Python file and trusts its JSON.
//
// NEVER. Judges a file: no function here returns a finding, only facts about one file's text. Reads the
// tree or a manifest; reads.mjs decides what is in scope and analyze() here only reads the one file it is
// handed.
//
// Usage: module only

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PY_HELPER_REL, REPO } from './shared.mjs';

const PUNCTUATORS = [
  '>>>=',
  '...',
  '===',
  '!==',
  '**=',
  '<<=',
  '>>=',
  '>>>',
  '&&=',
  '||=',
  '??=',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '?.',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '**',
  '<<',
  '>>',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ';',
  ',',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
  '!',
  '~',
  '?',
  ':',
  '=',
  '.',
  '@',
  '#'
];
/** Identifiers after which a '/' opens a regular expression rather than starting a division: in
 * lexJs itself, and in any other scan that re-derives the same rule (legs.mjs's dead-code scan). */
export const REGEX_AFTER_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await'
]);
/** Identifiers whose '(' opens a head (if/while/for/with) whose closing ')' can be followed by a
 * regular expression rather than a division, the same rule lexJs and legs.mjs's dead-code scan share. */
export const HEAD_WORDS = new Set(['if', 'while', 'for', 'with']);
const IDENT_START = /[A-Za-z_$\u0080-\uffff]/;
const IDENT_PART = /[A-Za-z0-9_$\u0080-\uffff]/;

export class LexError extends Error {}

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function decodeString(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\r\n|[\s\S])/g, (_, e) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e === '\n' || e === '\r\n' || e === '\r') return '';
    return ESCAPES[e] ?? e;
  });
}

/**
 * Tokens of a JavaScript source: [{t, v, raw, line, start, end}], t one of comment, string, template,
 * regex, number, ident, punct. A comment carries kind (line or block) and own (nothing but space
 * before it on its line). Throws LexError on a string, template, regex or comment it cannot close.
 */
export function lexJs(src, label = '<source>') {
  const out = [];
  let i = 0;
  let line = 1;
  const templateDepth = [];
  let prev = null;
  let beforePrev = null;
  // One entry per open parenthesis: true when it opens the head of an if, while, for or with, so the
  // ')' closing it ends a head and a '/' after that starts a regular expression, never a division.
  const parens = [];
  const fail = (what) => {
    throw new LexError(`${label}:${line}: ${what}`);
  };
  const push = (tok) => {
    out.push(tok);
    if (tok.t !== 'comment') {
      beforePrev = prev;
      prev = tok;
    }
  };
  const regexAllowed = () => {
    if (!prev) return true;
    if (prev.t === 'punct' && prev.v === ')') return prev.closesHead === true;
    if (prev.t === 'punct') return ![']', '}', '++', '--'].includes(prev.v);
    if (prev.t === 'ident') return REGEX_AFTER_WORDS.has(prev.v);
    return false;
  };
  const lineStartsBlank = (at) => {
    let k = at - 1;
    while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k--;
    return k < 0 || src[k] === '\n';
  };
  const scanTemplate = (from, startLine) => {
    let k = from;
    while (k < src.length) {
      const c = src[k];
      if (c === '\\') {
        k += src[k + 1] === '\r' && src[k + 2] === '\n' ? 3 : 2;
        continue;
      }
      if (c === '`') return { end: k + 1, closed: 'tick' };
      if (c === '$' && src[k + 1] === '{') return { end: k + 2, closed: 'expr' };
      k++;
    }
    line = startLine;
    return fail('unterminated template literal');
  };
  const countLines = (a, b) => {
    for (let k = a; k < b; k++) if (src[k] === '\n') line++;
  };

  if (src.startsWith('#!')) {
    while (i < src.length && src[i] !== '\n') i++;
  }
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '\uFEFF' || c === '\u00a0') {
      i++;
      continue;
    }
    const start = i;
    const startLine = line;
    if (c === '/' && src[i + 1] === '/') {
      let k = i + 2;
      while (k < src.length && src[k] !== '\n') k++;
      push({
        t: 'comment',
        kind: 'line',
        v: src.slice(i + 2, k).replace(/\r$/, ''),
        raw: src.slice(i, k),
        line: startLine,
        endLine: startLine,
        start,
        end: k,
        own: lineStartsBlank(i)
      });
      i = k;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      if (k === -1) fail('unterminated block comment');
      countLines(i, k);
      push({
        t: 'comment',
        kind: 'block',
        v: src.slice(i + 2, k),
        raw: src.slice(i, k + 2),
        line: startLine,
        endLine: line,
        start,
        end: k + 2,
        own: lineStartsBlank(i)
      });
      i = k + 2;
      continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < src.length && src[k] !== c) {
        if (src[k] === '\\') {
          // A line continuation is a backslash and the line break after it; in a CRLF file that break
          // is two characters, so the escape is three long.
          const crlf = src[k + 1] === '\r' && src[k + 2] === '\n';
          if (crlf || src[k + 1] === '\n') line++;
          k += crlf ? 3 : 2;
          continue;
        }
        if (src[k] === '\n') fail('unterminated string');
        k++;
      }
      if (k >= src.length) fail('unterminated string');
      push({
        t: 'string',
        v: decodeString(src.slice(i + 1, k)),
        raw: src.slice(i, k + 1),
        line: startLine,
        start,
        end: k + 1
      });
      i = k + 1;
      continue;
    }
    if (c === '`' || (c === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === 0)) {
      if (c === '}') templateDepth.pop();
      const r = scanTemplate(i + 1, startLine);
      countLines(i, r.end);
      push({
        t: 'template',
        v: src.slice(i + 1, r.closed === 'tick' ? r.end - 1 : r.end - 2),
        raw: src.slice(i, r.end),
        line: startLine,
        start,
        end: r.end,
        open: c === '`',
        close: r.closed === 'tick'
      });
      if (r.closed === 'expr') templateDepth.push(0);
      i = r.end;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m =
        /^(?:0[xX][0-9a-fA-F_]+n?|0[oO][0-7_]+n?|0[bB][01_]+n?|(?:[0-9][0-9_]*)?\.?[0-9_]*(?:[eE][+-]?[0-9_]+)?n?)/.exec(
          src.slice(i, i + 64)
        );
      const raw = m?.[0] ? m[0] : c;
      push({ t: 'number', v: raw, raw, line: startLine, start, end: i + raw.length });
      i += raw.length;
      continue;
    }
    if (IDENT_START.test(c) || (c === '\\' && src[i + 1] === 'u')) {
      let k = i + 1;
      while (k < src.length && (IDENT_PART.test(src[k]) || (src[k] === '\\' && src[k + 1] === 'u'))) k++;
      push({ t: 'ident', v: src.slice(i, k), raw: src.slice(i, k), line: startLine, start, end: k });
      i = k;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length) {
        const d = src[k];
        if (d === '\n') fail('unterminated regular expression');
        if (d === '\\') {
          k += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        k++;
      }
      if (k >= src.length) fail('unterminated regular expression');
      k++;
      while (k < src.length && /[a-z]/.test(src[k])) k++;
      push({ t: 'regex', v: src.slice(i, k), raw: src.slice(i, k), line: startLine, start, end: k });
      i = k;
      continue;
    }
    const p = PUNCTUATORS.find((op) => src.startsWith(op, i));
    if (!p) fail(`unexpected character ${JSON.stringify(c)}`);
    if (templateDepth.length) {
      if (p === '{') templateDepth[templateDepth.length - 1]++;
      else if (p === '}') templateDepth[templateDepth.length - 1]--;
    }
    const tok = { t: 'punct', v: p, raw: p, line: startLine, start, end: i + p.length };
    if (p === '(') parens.push(prev?.t === 'ident' && HEAD_WORDS.has(prev.v) && beforePrev?.v !== '.');
    else if (p === ')') tok.closesHead = parens.pop() === true;
    push(tok);
    i += p.length;
  }
  if (templateDepth.length) fail('a template literal placeholder was never closed');
  return out;
}

/** The source with every comment replaced by spaces, newlines kept, so line numbers still match. */
function blankRanges(src, ranges) {
  const chars = src.split('');
  for (const [a, b] of ranges) for (let k = a; k < b; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
  return chars.join('');
}

/** Comment lines of a lexed JS file: one entry per physical line, block comments split, stars removed. */
function jsCommentLines(tokens) {
  const lines = [];
  for (const t of tokens) {
    if (t.t !== 'comment') continue;
    if (t.kind === 'line') {
      lines.push({ line: t.line, text: t.v, own: t.own });
      continue;
    }
    t.v.split('\n').forEach((raw, k) => {
      lines.push({ line: t.line + k, text: raw.replace(/\r$/, '').replace(/^\s*\*(?!\/)/, ''), own: k > 0 || t.own });
    });
  }
  return lines;
}

// ----------------------------------------------------------------------- shell and YAML scans

/**
 * Comments and code of a shell script. A '#' starts a comment at the start of a word, outside
 * quotes; a heredoc body is code, never a comment, whatever it holds.
 */
export function scanShell(src) {
  const comments = [];
  const ranges = [];
  let quote = null;
  const heredocs = [];
  const lines = src.split('\n');
  let offset = 0;
  let inHeredoc = null;
  lines.forEach((text, n) => {
    const lineNo = n + 1;
    const bare = text.replace(/\r$/, '');
    if (inHeredoc) {
      const probe = inHeredoc.strip ? bare.replace(/^\t+/, '') : bare;
      if (probe === inHeredoc.word) inHeredoc = heredocs.shift() || null;
      offset += text.length + 1;
      return;
    }
    for (let k = 0; k < bare.length; k++) {
      const c = bare[k];
      if (quote === "'") {
        if (c === "'") quote = null;
        continue;
      }
      if (quote === '"') {
        if (c === '\\') {
          k++;
          continue;
        }
        if (c === '"') quote = null;
        continue;
      }
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === '<' && bare[k + 1] === '<' && bare[k + 2] !== '<') {
        const m = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(bare.slice(k));
        if (m) {
          heredocs.push({ word: m[3], strip: m[1] === '-' });
          k += m[0].length - 1;
          continue;
        }
      }
      if (c === '#' && (k === 0 || /[\s;&|()]/.test(bare[k - 1]))) {
        comments.push({ line: lineNo, text: bare.slice(k + 1), own: bare.slice(0, k).trim() === '' });
        ranges.push([offset + k, offset + bare.length]);
        break;
      }
    }
    if (!quote && heredocs.length) inHeredoc = heredocs.shift();
    offset += text.length + 1;
  });
  return { comments, code: blankRanges(src, ranges) };
}

/** Comments and code of a YAML workflow: a '#' at the start of a line or after a space, outside quotes. */
export function scanYaml(src) {
  const comments = [];
  const ranges = [];
  let offset = 0;
  src.split('\n').forEach((text, n) => {
    const bare = text.replace(/\r$/, '');
    let quote = null;
    for (let k = 0; k < bare.length; k++) {
      const c = bare[k];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if ((c === "'" || c === '"') && (k === 0 || /[\s:[{,]/.test(bare[k - 1]))) {
        quote = c;
        continue;
      }
      if (c === '#' && (k === 0 || /\s/.test(bare[k - 1]))) {
        comments.push({ line: n + 1, text: bare.slice(k + 1), own: bare.slice(0, k).trim() === '' });
        ranges.push([offset + k, offset + bare.length]);
        break;
      }
    }
    offset += text.length + 1;
  });
  return { comments, code: blankRanges(src, ranges) };
}

// ---------------------------------------------------------------------------- the Python half

let pythonCommand = null;

/** The first of python3 and python that answers --version, the order bootstrap.mjs uses. */
export function findPython() {
  if (pythonCommand) return pythonCommand;
  for (const name of ['python3', 'python']) {
    const r = spawnSync(name, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3\./.test(`${r.stdout}${r.stderr}`)) {
      pythonCommand = name;
      return name;
    }
  }
  throw new Error(
    'no Python 3 answers as python3 or python; the Python half of the header, diary, dangling, contract and pinned legs cannot run, and a leg that cannot run is not a clean leg'
  );
}

/**
 * Facts for every Python file, by src path, from one run of the stdlib helper. A file the helper could
 * not decode, parse or walk throws, naming the file and why; an interpreter below the helper's floor
 * (3.10) throws with the helper's own sentence.
 */
export function pythonFacts(root, srcs) {
  if (!srcs.length) return new Map();
  const helper = path.join(REPO, PY_HELPER_REL);
  const r = spawnSync(findPython(), [helper, ...srcs], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${PY_HELPER_REL} exited ${r.status}: ${String(r.stderr).trim()}`);
  const report = JSON.parse(r.stdout);
  const out = new Map();
  for (const src of srcs) {
    const f = report[src];
    if (!f || f.error) throw new Error(`${src}: ${f ? f.error : 'the Python helper did not report it'}`);
    out.set(src, f);
  }
  return out;
}

// ------------------------------------------------------------------------------ file analysis

/**
 * Everything the legs need from one file: {text, lang, comments: [{line, text, own}], code,
 * tokens (JS), docstrings, moduleDoc, mainGuard, encoding, pinned and reads (Python)}.
 */
export function analyze(file, text, py) {
  const base = { ...file, text };
  if (file.lang === 'js') {
    const tokens = lexJs(text, file.src);
    const code = blankRanges(
      text,
      tokens.filter((t) => t.t === 'comment').map((t) => [t.start, t.end])
    );
    return { ...base, tokens, comments: jsCommentLines(tokens), code };
  }
  if (file.lang === 'shell') return { ...base, ...scanShell(text) };
  if (file.lang === 'ci') return { ...base, ...scanYaml(text) };
  if (file.lang === 'python') {
    const f = py.get(file.src);
    return {
      ...base,
      comments: f.comments.map(([line, t]) => ({ line, text: t, own: true })),
      code: f.code,
      docstrings: f.docstrings.map(([line, endLine, t]) => ({ line, endLine, text: t })),
      moduleDoc: f.module_doc,
      mainGuard: f.main_guard,
      encoding: f.encoding,
      pinned: f.pinned,
      reads: f.reads
    };
  }
  return { ...base, comments: [], code: text };
}
