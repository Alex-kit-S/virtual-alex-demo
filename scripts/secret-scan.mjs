#!/usr/bin/env node
// scripts/secret-scan.mjs - the in-repo secret scanner: the first content leg of both commit gates,
// the online autosave's per-file scan, and the gate of /update.
//
// WHAT. The Kit's pre-commit ran gitleaks when the binary happened to be installed, and printed a
// WARNING and carried on when it was not; on a machine where the binary is simply never present the
// secret leg would run nowhere. This scanner ships in the repo, needs nothing but node, and fails
// CLOSED: a hit refuses and an error refuses. gitleaks stays as an extra leg wherever it happens to be
// installed. It matches ten shaped patterns, the shapes a real pasted credential takes: the Anthropic
// key prefix, the GitHub token prefixes (classic and fine-grained), the AWS access-key prefix, the
// Google API key and OAuth client secret prefixes, a private-key block header, the Slack token prefix,
// a JWT (two base64url segments each opening with the JSON header marker), and a generic
// key|secret|token|password assignment, the key quoted or not, carrying a 16+ character opaque value.
//
// HOW. Every pattern is ASSEMBLED at run time from fragments, so this file's own text never carries a
// shape it hunts, which is why the scanner passes over its own source. A line carrying the allow
// marker `# secret-scan: allow` is skipped, so a reviewed exception sits on the line itself, visible
// in the diff, instead of in a side file a hijacked lane could edit. The generic rule adds two
// refinements: a placeholder value (your/example/changeme/...) is not a secret, and the exact
// soul-canary line (`SOUL-CANARY-TOKEN: <hex>`, committed online on every autosave) is never a hit,
// because that is the one file this scanner must never refuse. Two modes, the autosave contract
// (scripts/autosave.sh step 2):
//   node scripts/secret-scan.mjs --file <path>     one file, as it is on disk
//   node scripts/secret-scan.mjs --staged          every path this commit adds or modifies, read
//                                                  from the INDEX (the staged blob, not the working
//                                                  copy), for scripts/hooks/pre-commit
// A file with a NUL byte in its first 8000 bytes is binary by git's own test and is skipped in both
// modes: the ten shapes are text, and the size guard beside this leg is what keeps a large blob out.
//
// NEVER. Prints the matched value: a hit prints only `secret-scan: <file>:<line> <pattern-name>`, and
// this scanner's own output lands in logs and transcripts that live for months. Exits 0 past a hit or
// an error: exit 2 is at least one hit, exit 1 is "the scanner could not do its job" (no mode given,
// an unreadable file, git failed), and every caller treats anything non-zero as a refusal.
//
// Usage: node scripts/secret-scan.mjs --file <path> | --staged
// Exit: 0 clean - 1 the scanner could not do its job - 2 at least one hit

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// Fragments joined at run time. Keep every literal here SHORT of the shape it builds; a future edit
// that pastes a whole prefix into one string will make the scanner refuse this file on the next
// autosave, which is the failure the fragments exist to prevent.
const j = (...parts) => parts.join('');
// contract: read as text by scripts/tests/test-secret-scan-known-bad.mjs:225-229. This value class stays one declaration on one line and holds no angle bracket, which is why the placeholder list's last alternative can never fire.
// biome-ignore format: the known-bad test finds this whole declaration in the source
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
  // has no dash: `xoxb-your-token` (found verbatim in a vendored skill doc) is not a token.
  { name: 'slack-token', re: new RegExp(j('\\bxo', 'x[abp]-', '[A-Za-z0-9]{10,}')) },
  { name: 'jwt', re: new RegExp(j('\\bey', 'J', OPAQUE, '{10,}\\.', 'ey', 'J', OPAQUE, '{10,}')) },
  // The quote after the key word is what lets `"api_key": "<value>"` (JSON, a dict, a JS object) be
  // read the way `api_key: <value>` always was; without it the Kit's own configuration format passed.
  {
    name: 'assigned-secret',
    re: new RegExp(j('(k', 'ey|sec', 'ret|tok', 'en|pass', 'word)', '["\']?\\s*[:=]\\s*["\']?(', OPAQUE, '{16,})'), 'i')
  }
];
const ALLOW_MARKER = j('# secret', '-scan: ', 'allow');

// The generic assignment pattern is the one with judgement in it, so it carries two exact refinements
// the nine prefix patterns do not need:
//   1. A placeholder value is not a secret. gitleaks keeps a stopword list for its generic rule for
//      the same reason; `encryption_key="your-32-byte-encryption-key-here"` found verbatim in a
//      vendored skill doc is documentation, and blocking it would block every commit that stages
//      that file. The list is short and deliberate; a real credential never starts with these.
//   2. The Kit's own canary line. soul.md carries `SOUL-CANARY-TOKEN: <hex>` twice by design (the
//      proof that a scheduled run received the file), every reader takes the hex by `[0-9a-f]{12,}`
//      after the label, and online soul.md is committed on every autosave. Without this line the
//      scanner would refuse the identity file on every save, which is the one file it must never
//      refuse. The shape accepted is exactly the documented line and nothing wider.
// contract: read as text by scripts/tests/test-secret-scan-known-bad.mjs:225-230. The list keeps its dead angle-bracket alternative last, as that test pins it, until the defect is fixed on purpose.
// biome-ignore format: the known-bad test finds the tail of this pattern in the source
const PLACEHOLDER = /^(your|example|placeholder|changeme|dummy|sample|todo|test|xxx|x{4,}|<)/i;
const CANARY_LINE = new RegExp(j('^SOUL-CANARY', '-TOKEN:\\s*[0-9a-f]{12,}\\s*$'));
function assignedSecretHit(line, m) {
  if (CANARY_LINE.test(line)) return false;
  const value = m[2] || '';
  return !PLACEHOLDER.test(value);
}

/**
 * Whether `buf` is binary, by git's own test: a NUL byte in the first 8000 bytes.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * Pure: the hits for one text, line numbers 1-based. A line carrying the allow marker contributes nothing.
 * @param {string} text
 * @returns {{ line: number, name: string }[]}
 */
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

// This function, isBinary above and the staged-path listing below are duplicated in
// employer-data-guard.mjs; scripts/lib/git.js and scripts/lib/staged-paths.js hold the shared shape,
// but adoption is held here because scripts/tests/test-secret-scan-known-bad.mjs copies this file into
// a throwaway repository without scripts/lib/ and runs the copy as a child process.
function git(args) {
  const r = spawnSync('git', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr.toString('utf8').trim()}`);
  return r.stdout;
}

function report(file, hits) {
  for (const h of hits) process.stdout.write(`secret-scan: ${file}:${h.line} ${h.name}\n`);
}

function scanBuffer(buf) {
  if (isBinary(buf)) return [];
  return scanText(buf.toString('utf8'));
}

/**
 * The CLI: --file <path> scans one file as it is on disk, --staged scans every path this commit adds or
 * modifies, read from the index.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  const fileIdx = argv.indexOf('--file');
  const staged = argv.includes('--staged');
  if (fileIdx >= 0 === staged) {
    process.stderr.write('secret-scan: usage: node scripts/secret-scan.mjs --file <path> | --staged\n');
    return 1;
  }
  try {
    let total = 0;
    if (fileIdx >= 0) {
      const file = argv[fileIdx + 1];
      if (!file) {
        process.stderr.write('secret-scan: --file needs a path\n');
        return 1;
      }
      const hits = scanBuffer(fs.readFileSync(file));
      report(file, hits);
      total = hits.length;
    } else {
      // --no-renames: a renamed-and-edited file is read as an add, so its whole staged content is
      // scanned rather than only the rename record.
      const paths = git(['diff', '--cached', '--name-only', '--diff-filter=AM', '--no-renames', '-z'])
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
      for (const file of paths) {
        // :0:<path> (stage 0, explicit), not :<path>: `git show :<path>` reads a path that starts with
        // `0:` as a stage number, so a path literally named "0:x" would otherwise be read as "stage 0 of
        // x" instead of "stage 0 of the path 0:x".
        const hits = scanBuffer(git(['show', `:0:${file}`]));
        report(file, hits);
        total += hits.length;
      }
    }
    if (total > 0) {
      process.stderr.write(
        `secret-scan: ${total} hit(s); the value is never printed. Remove it, rotate it if it was real, or put the marker on that line to accept a reviewed exception.\n`
      );
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
