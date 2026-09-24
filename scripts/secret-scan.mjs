#!/usr/bin/env node
/*
 * scripts/secret-scan.mjs - the in-repo secret scanner (Virtual Alex plan Phase 3, seat 5 C2,
 * built 2026-09-23).
 *
 * WHY IT EXISTS. The Kit's pre-commit ran gitleaks when the binary was present and printed a
 * WARNING and carried on when it was not (a documented decision for a non-technical owner). On a
 * cloud VM the binary is never present, so the secret leg would have run nowhere, and a guard that
 * can be absent is not a guard. This scanner ships in the repo, needs nothing but node, and fails
 * CLOSED: a hit refuses, an error refuses, and there is no code path that proceeds unscanned.
 * gitleaks stays as an extra leg where it happens to be installed.
 *
 * WHAT IT MATCHES. Ten shaped patterns, the shapes a real pasted credential takes: the Anthropic
 * key prefix, the GitHub token prefixes (classic and fine-grained), the AWS access-key prefix, the
 * Google API key and OAuth client secret prefixes, a private-key block header, the Slack token
 * prefix, a JWT (two base64url segments each opening with the JSON header marker) and a generic
 * `key|secret|token|password` assignment carrying a 16+ character opaque value. Every pattern is
 * ASSEMBLED at run time from fragments, so this file's own text never carries a shape it hunts:
 * seat 2 watched a stub scanner refuse itself on the autosave's per-file scan, and a scanner that
 * refuses its own source can never be saved or updated (seat-2-platform.md, own finding 6).
 *
 * THE ALLOW MARKER. A line carrying `# secret-scan: allow` (assembled below too) is skipped. A
 * reviewed exception therefore sits on the line itself, visible in the diff, instead of in a side
 * file nobody reads; an allowlist file would also be one more surface a hijacked lane could edit.
 *
 * TWO MODES, ONE CONTRACT (the autosave contract, scripts/autosave.sh step 2):
 *   node scripts/secret-scan.mjs --file <path>     one file, as it is on disk
 *   node scripts/secret-scan.mjs --staged          every path this commit adds or modifies, read
 *                                                  from the INDEX (the staged blob, not the working
 *                                                  copy), for scripts/hooks/pre-commit
 * Exit 0 = clean. Exit 2 = at least one hit, each printed as
 *   secret-scan: <file>:<line> <pattern-name>
 * and NEVER the matched value (the scanner's output lands in logs and transcripts that live for
 * months). Exit 1 = the scanner could not do its job (no mode, unreadable file, git failed); the
 * callers treat anything non-zero as a refusal, which is the fail-closed half.
 *
 * A file with a NUL byte in its first 8000 bytes is binary by git's own test and is skipped in
 * --file mode and in --staged mode alike: the ten shapes are text, and the size guard beside this
 * leg is what keeps a large blob out.
 *
 * Node builtins only. Test: node scripts/tests/test-secret-scan.mjs (every refusal shown before
 * the pass).
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Fragments joined at run time. Keep every literal here SHORT of the shape it builds; a future edit
// that pastes a whole prefix into one string will make the scanner refuse this file on the next
// autosave, which is the failure the fragments exist to prevent.
const j = (...parts) => parts.join('');
const OPAQUE = '[A-Za-z0-9_\\-]';
const PATTERNS = [
  { name: 'anthropic-api-key', re: new RegExp(j('sk-', 'ant-', OPAQUE, '{20,}')) },
  { name: 'github-token', re: new RegExp(j('\\bgh', '[pousr]_', '[A-Za-z0-9]{20,}')) },
  { name: 'github-fine-grained-token', re: new RegExp(j('\\bgithub', '_pat_', '[A-Za-z0-9_]{20,}')) },
  { name: 'aws-access-key', re: new RegExp(j('\\bAK', 'IA', '[0-9A-Z]{16}\\b')) },
  { name: 'google-api-key', re: new RegExp(j('\\bAI', 'za', '[0-9A-Za-z_\\-]{35}')) },
  { name: 'google-oauth-client-secret', re: new RegExp(j('\\bGOC', 'SPX-', OPAQUE, '{20,}')) },
  { name: 'private-key-block', re: new RegExp(j('-----BEGIN ', '[A-Z ]*', 'PRIVATE', ' KEY-----')) },
  // A real Slack token opens with a 10+ digit workspace segment before its first dash, so the class
  // has no dash: `xoxb-your-token` (a vendored skill doc, measured 2026-09-23) is not a token.
  { name: 'slack-token', re: new RegExp(j('\\bxo', 'x[abp]-', '[A-Za-z0-9]{10,}')) },
  { name: 'jwt', re: new RegExp(j('\\bey', 'J', OPAQUE, '{10,}\\.', 'ey', 'J', OPAQUE, '{10,}')) },
  { name: 'assigned-secret', re: new RegExp(j('(k', 'ey|sec', 'ret|tok', 'en|pass', 'word)', '\\s*[:=]\\s*["\']?(', OPAQUE, '{16,})'), 'i') },
];
const ALLOW_MARKER = j('# secret', '-scan: ', 'allow');

// The generic assignment pattern is the one with judgement in it, so it carries two exact refinements
// the nine prefix patterns do not need:
//   1. A placeholder value is not a secret. gitleaks keeps a stopword list for its generic rule for
//      the same reason; `encryption_key="your-32-byte-encryption-key-here"` in a vendored skill doc
//      (measured 2026-09-23) is documentation, and blocking it would block every commit that stages
//      that file. The list is short and deliberate; a real credential never starts with these.
//   2. The Kit's own canary line. soul.md carries `SOUL-CANARY-TOKEN: <hex>` twice by design (the
//      proof that a scheduled run received the file), every reader takes the hex by `[0-9a-f]{12,}`
//      after the label, and online soul.md is committed on every autosave. Without this line the
//      scanner would refuse the identity file on every save, which is the one file it must never
//      refuse. The shape accepted is exactly the documented line and nothing wider.
const PLACEHOLDER = /^(your|example|placeholder|changeme|dummy|sample|todo|test|xxx|x{4,}|<)/i;
const CANARY_LINE = new RegExp(j('^SOUL-CANARY', '-TOKEN:\\s*[0-9a-f]{12,}\\s*$'));
function assignedSecretHit(line, m) {
  if (CANARY_LINE.test(line)) return false;
  const value = m[2] || '';
  return !PLACEHOLDER.test(value);
}

export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Pure: returns [{ line, name }] for a text. Line numbers are 1-based. A line carrying the allow
// marker contributes nothing.
export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      if (p.name === 'assigned-secret' && !assignedSecretHit(line, m)) continue;
      hits.push({ line: i + 1, name: p.name });
    }
  }
  return hits;
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

function report(file, hits) {
  for (const h of hits) process.stdout.write(`secret-scan: ${file}:${h.line} ${h.name}\n`);
}

function scanBuffer(file, buf) {
  if (isBinary(buf)) return [];
  return scanText(buf.toString('utf8'));
}

export function main(argv) {
  const fileIdx = argv.indexOf('--file');
  const staged = argv.includes('--staged');
  if ((fileIdx >= 0) === staged) {
    process.stderr.write('secret-scan: usage: node scripts/secret-scan.mjs --file <path> | --staged\n');
    return 1;
  }
  try {
    let total = 0;
    if (fileIdx >= 0) {
      const file = argv[fileIdx + 1];
      if (!file) { process.stderr.write('secret-scan: --file needs a path\n'); return 1; }
      const hits = scanBuffer(file, fs.readFileSync(file));
      report(file, hits);
      total = hits.length;
    } else {
      // --no-renames: a renamed-and-edited file is read as an add, so its whole staged content is
      // scanned rather than only the rename record.
      const paths = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '--no-renames', '-z'])
        .toString('utf8').split('\0').filter(Boolean);
      for (const file of paths) {
        const hits = scanBuffer(file, git(['show', `:${file}`]));
        report(file, hits);
        total += hits.length;
      }
    }
    if (total > 0) {
      process.stderr.write(`secret-scan: ${total} hit(s); the value is never printed. Remove it, rotate it if it was real, or put the marker on that line to accept a reviewed exception.\n`);
      return 2;
    }
    return 0;
  } catch (e) {
    process.stderr.write(`secret-scan: ERROR ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && /secret-scan\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  process.exit(main(process.argv.slice(2)));
}
