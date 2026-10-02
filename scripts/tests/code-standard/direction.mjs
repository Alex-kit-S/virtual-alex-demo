// scripts/tests/code-standard/direction.mjs - the direction leg: nothing gets worse with no row saying so.
//
// WHAT. Compares the current tree and ratchet against a base commit, read through git, and says what
// moved the wrong way with no dated row naming it: a ceiling that rose, the current wave moving, a file
// leaving the enforced set or docs/L2.json, or a pinned test that changed, went away, changed its run
// context or gained a reason not to run with no FIX row or unfrozen row covering it.
//
// HOW. resolveBase picks the commit to compare against (--base, then CODE_STANDARD_BASE, then the usual
// GitHub Actions shapes, then HEAD locally). pinsAt re-reads every PINNED DEFECT test at that commit
// through one `git cat-file --batch`, re-analysing each file with lex.mjs's analyze() (and, for Python,
// a throwaway temp folder and lex.mjs's pythonFacts) so it is fingerprinted by legs.mjs's collectPinned
// exactly the way the current tree is. Every other comparison (ceilings, enforced set, docs/L2.json) is
// read straight from the two ratchet objects and reads.mjs's readJsonFile over biome.json.
//
// NEVER. Writes anything; a finding here is read by test-code-standard.mjs, never acted on in this file.
//
// Usage: module only

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, pythonFacts } from './lex.mjs';
import { collectPinned, contextMoved } from './legs.mjs';
import { ceilingsOf, L2_REL, shippedPath } from './ratchet.mjs';
import { gitEnv, languageOf, readJsonFile } from './reads.mjs';
import { BIOME_REL, isTestFile, keyOf, licensedIds, RATCHET_REL, RATCHET_SCHEMA } from './shared.mjs';

// ------------------------------------------------------------------------------------ direction

function gitTry(root, args, input) {
  return spawnSync('git', args, { cwd: root, env: gitEnv(), input, maxBuffer: 256 * 1024 * 1024 });
}

/**
 * The commit the direction leg compares against: --base, then CODE_STANDARD_BASE, then in GitHub
 * Actions origin/$GITHUB_BASE_REF on a pull request and HEAD~1 on a push, and locally HEAD, so a local
 * run judges the uncommitted change. {ref, sha, explicit, why}; sha is null when the ref does not
 * resolve here (a first commit, a shallow clone, a base never fetched).
 */
export function resolveBase(root, flag, env = process.env) {
  let pick;
  if (flag) pick = [flag, true, '--base'];
  else if (env.CODE_STANDARD_BASE) pick = [env.CODE_STANDARD_BASE, true, 'CODE_STANDARD_BASE'];
  else if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_BASE_REF)
    pick = [`origin/${env.GITHUB_BASE_REF}`, false, 'a pull request in GitHub Actions'];
  else if (env.GITHUB_ACTIONS === 'true') pick = ['HEAD~1', false, 'a push in GitHub Actions'];
  else pick = ['HEAD', false, 'a local run, which judges the uncommitted change'];
  const [ref, explicit, why] = pick;
  const r = gitTry(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return { ref, explicit, why, sha: r.status === 0 ? String(r.stdout).trim() : null };
}

/** Each path's text at a commit, through one `git cat-file --batch`: Map of path to text, or null when absent. */
function readAt(root, sha, paths) {
  const out = new Map();
  if (!paths.length) return out;
  const r = gitTry(root, ['cat-file', '--batch'], paths.map((p) => `${sha}:${p}\n`).join(''));
  if (r.status !== 0) throw new Error(`git cat-file --batch failed in ${root}: ${String(r.stderr).trim()}`);
  const buf = r.stdout;
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(10, at);
    const header = buf.subarray(at, nl).toString('utf8');
    at = nl + 1;
    if (header.endsWith(' missing')) {
      out.set(p, null);
      continue;
    }
    const size = Number(header.split(' ')[2]);
    out.set(p, buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}

/**
 * The pinned tests the tree held at a commit, fingerprinted by THIS checker: Map of `file\0title` to
 * {file, title, ids, fingerprint, stops}. Two trees fingerprinted the same way stay comparable across
 * a change of fingerprint version.
 */
function pinsAt(ctx, sha) {
  const r = gitTry(ctx.root, [
    'grep',
    '-l',
    '-I',
    '-e',
    'PINNED DEFECT',
    '-e',
    '_PINNED_DEFECT_',
    sha,
    '--',
    'scripts/tests'
  ]);
  const paths =
    r.status === 0
      ? String(r.stdout)
          .split('\n')
          .filter(Boolean)
          .map((l) => l.slice(sha.length + 1))
          .filter((p) => isTestFile(p) && ['js', 'python'].includes(languageOf(p)))
      : [];
  const texts = readAt(ctx.root, sha, paths);
  const files = paths.map((p) => ({ src: p, dst: p, lang: languageOf(p), text: texts.get(p).replace(/^\uFEFF/, '') }));
  const pyFiles = files.filter((f) => f.lang === 'python');
  let py = new Map();
  if (pyFiles.length) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alex-code-standard-base-'));
    try {
      for (const f of pyFiles) {
        fs.mkdirSync(path.dirname(path.join(tmp, f.src)), { recursive: true });
        fs.writeFileSync(path.join(tmp, f.src), f.text);
      }
      py = pythonFacts(
        tmp,
        pyFiles.map((f) => f.src)
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const analysed = files.map((f) => analyze({ src: f.src, dst: f.dst, lang: f.lang }, f.text, py));
  return new Map(collectPinned({ files: analysed }).map((p) => [keyOf(p.file, p.title), p]));
}

/**
 * The direction leg: what moved the wrong way between the base and this tree with no row naming it. A
 * ceiling may only fall (a rise needs a new raises row naming the leg, the file, from and to); the
 * current wave moves only with a raises row; nothing leaves the enforced set (the ratchet's list or
 * Biome's) and no file or export name leaves docs/L2.json without a new unfrozen row naming it; and no
 * pinned test the base held may change, go, change its run context or gain a reason not to run,
 * unless one of its ids has a FIX row for the current wave or a new unfrozen row names it (for a run
 * context alone, a pin-context row for its file names it too). A row counts only if it is new since
 * the base, so an old row never licenses a new move. Returns {findings, notes}.
 */
export function directionFindings(ctx, head, base) {
  const findings = [];
  const notes = [];
  const texts = readAt(ctx.root, base.sha, [RATCHET_REL, BIOME_REL, L2_REL]);
  const parse = (rel) => {
    const t = texts.get(rel);
    if (t === null || t === undefined) return null;
    try {
      return JSON.parse(t);
    } catch {
      findings.push(`${rel} at ${base.ref} is not JSON, so nothing can be compared with it`);
      return null;
    }
  };
  const was = parse(RATCHET_REL);
  const comparable = was?._schema === RATCHET_SCHEMA;
  if (!was) notes.push(`${base.ref} holds no ${RATCHET_REL}, so this change introduces it`);
  else if (!comparable)
    notes.push(
      `${RATCHET_REL} at ${base.ref} is ${was._schema}: its ceilings and wave are not comparable with ${RATCHET_SCHEMA}`
    );
  const fresh = (list, old) => {
    const seen = new Set((old || []).map((r) => JSON.stringify(r)));
    return (list || []).filter((r) => !seen.has(JSON.stringify(r)));
  };
  const raises = fresh(head.raises, comparable ? was.raises : []);
  const unfrozen = fresh(head.unfrozen, comparable ? was.unfrozen : []);
  const named = (rows, what, from, to) =>
    rows.some((r) => r.what === what && String(r.from) === String(from) && String(r.to) === String(to));
  if (comparable) {
    const dstOf = shippedPath(ctx);
    const before = ceilingsOf(was, dstOf);
    for (const [k, count] of ceilingsOf(head, dstOf)) {
      const [leg, file] = k.split('\u0000');
      const r = { count, file, leg };
      const from = before.get(k) ?? 0;
      if (r.count > from && !named(raises, `ceiling ${r.leg} ${r.file}`, from, r.count))
        findings.push(
          `the ${r.leg} ceiling of ${r.file} rose from ${from} to ${r.count}, and no new raises row names it`
        );
    }
    if (was.current_wave !== head.current_wave && !named(raises, 'current_wave', was.current_wave, head.current_wave))
      findings.push(
        `the current wave moved from ${was.current_wave} to ${head.current_wave}, and no new raises row names it`
      );
    // A dropped row is licensed the way --record drops it: every id it pins has a FIX row for the
    // current wave (a fixed pin leaves the snapshot with its FIX row). Otherwise a new unfrozen row names it.
    const headPins = new Set((head.pinned || []).map((p) => keyOf(p.file, p.title)));
    const fixedNow = licensedIds(head);
    for (const p of was.pinned || []) {
      if (headPins.has(keyOf(p.file, p.title))) continue;
      if (p.ids.length && p.ids.every((id) => fixedNow.has(id))) continue;
      if (!unfrozen.some((r) => r.what === `pin ${p.file} :: ${p.title}`))
        findings.push(
          `the snapshot dropped ${p.file} :: ${p.title.slice(0, 70)}, and neither a FIX row for wave ${head.current_wave} for every id it pins nor a new unfrozen row names it`
        );
    }
  }
  const biomeWas = parse(BIOME_REL);
  const biomeNow = readJsonFile(ctx.root, BIOME_REL);
  const enforcedWas = new Set([...(was?.enforced || []), ...(biomeWas?.files?.includes || [])]);
  const enforcedNow = new Set([...(head.enforced || []), ...(biomeNow?.files?.includes || [])]);
  for (const p of enforcedWas)
    if (!enforcedNow.has(p) && !named(unfrozen, `enforced ${p}`, 'enforced', 'not enforced'))
      findings.push(`${p} left the enforced set, and no new unfrozen row names it`);
  const l2Was = parse(L2_REL);
  if (l2Was?.files) {
    const l2Now = readJsonFile(ctx.root, L2_REL);
    const now = new Map((l2Now?.files || []).map((f) => [f.path, new Set((f.exports || []).map((e) => e.name))]));
    for (const f of l2Was.files) {
      if (!now.has(f.path)) {
        if (!named(unfrozen, `l2 ${f.path}`, 'frozen', 'removed'))
          findings.push(`${f.path} left ${L2_REL}, and no new unfrozen row names it`);
        continue;
      }
      for (const e of f.exports || [])
        if (!now.get(f.path).has(e.name) && !named(unfrozen, `l2 ${f.path} ${e.name}`, 'frozen', 'removed'))
          findings.push(`${f.path} lost its frozen export ${e.name} in ${L2_REL}, and no new unfrozen row names it`);
    }
  }
  const licensed = licensedIds(head);
  const now = new Map(collectPinned(ctx).map((p) => [keyOf(p.file, p.title), p]));
  for (const [k, b] of pinsAt(ctx, base.sha)) {
    if (!ctx.isKit && !ctx.tracked.has(b.file)) continue;
    const is = now.get(k);
    const gained = is ? is.stops.filter((s) => !b.stops.includes(s)) : [];
    const bodyMoved = !is || is.fingerprint !== b.fingerprint;
    const runMoved = Boolean(is) && contextMoved(b, is);
    if (!bodyMoved && !runMoved && !gained.length) continue;
    if (!gained.length && b.ids.some((id) => licensed.has(id))) continue;
    if (unfrozen.some((r) => r.what === `pin ${b.file} :: ${b.title}`)) continue;
    if (!gained.length && !bodyMoved && unfrozen.some((r) => r.what === `pin-context ${b.file}`)) continue;
    const how = !is
      ? 'is gone'
      : gained.length
        ? `no longer runs (${gained.join('; ')})`
        : [bodyMoved && 'changed', runMoved && 'changed its run context'].filter(Boolean).join(' and ');
    findings.push(
      `PINNED DEFECT ${b.ids.join(', ')} in ${b.file} ${how} since ${base.ref}, and neither a FIX row for wave ${head.current_wave} nor a new unfrozen row names it`
    );
  }
  return { findings, notes };
}
