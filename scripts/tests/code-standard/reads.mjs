// scripts/tests/code-standard/reads.mjs - builds the tree the legs score, and reads the ratchet.
//
// WHAT. Decides what is in scope (loadScope), reads and analyses every file in it (loadContext), knows
// the ratchet's own file (readRatchet) and which files Biome's list and the ratchet's enforced list
// together name (enforcedSet). Every other module receives the context this one builds; none of them
// walks the tree or the manifest itself.
//
// HOW. In the Kit, scope is the builder's own planTree over the tracked files, so it cannot drift from
// what a recruiter receives; everywhere else it is every tracked file, because that tree IS the build.
// loadContext reads each file's text (a Kit-only path's real file under its kit: prefix) and hands it to
// lex.mjs's analyze() with the Python facts pythonFacts already gathered in one run. readJsonFile is the
// one plain-JSON read this module and the ratchet share, through json-writer's own headerless reader, so
// it stays safe over a synthetic tree built for a test (it never requires scripts/lib/ from that tree).
//
// NEVER. Judges a file's content; that is legs.mjs's job over the context this module hands it.
//
// Usage: module only

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, pythonFacts } from './lex.mjs';
import {
  BIOME_REL,
  isTestFile,
  KIT_ONLY_PREFIX,
  MIGRATIONS,
  RATCHET_REL,
  RATCHET_SCHEMA,
  readJsonHeaderless,
  REPO,
  TESTS,
  VARIANT_PREFIX
} from './shared.mjs';

const require = createRequire(import.meta.url);

// ----------------------------------------------------------------------------------------- scope

const LANG_BY_EXT = { '.py': 'python', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.sh': 'shell' };

/** The language a shipped path is scored as, or null when it is not code this standard scores. */
export function languageOf(dst) {
  if (dst.startsWith('.agents/')) return null;
  if (dst === 'scripts/hooks/pre-commit') return 'shell';
  if (dst === '.claude/settings.json') return 'json';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(dst)) return 'ci';
  return LANG_BY_EXT[path.extname(dst)] ?? null;
}

/** process.env with the four GIT_* variables a caller's own repository context could leave set
 * removed, so a git call this file makes always reads the tree it was handed, never an outer one. */
export function gitEnv() {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[k];
  return env;
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, env: gitEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`git ${args.join(' ')} failed in ${root} (exit ${r.status}): ${String(r.stderr).trim()}`);
  return r.stdout;
}

/**
 * The files this standard scores in the tree at `root`: [{src, dst, lang}], sorted by src.
 * isKit is true where variants/online/ exists, the same test the builder's own tests use. A tracked
 * file deleted from the working tree is gone for every leg, the same as one deleted and staged: a wave
 * is judged on the tree it hands over, and the pinned leg must see a deleted test as deleted.
 */
export async function loadScope(root = REPO) {
  const present = (p) => fs.existsSync(path.join(root, p));
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean).filter(present);
  const isKit = fs.existsSync(path.join(root, 'variants', 'online'));
  let pairs;
  if (isKit) {
    const builder = await import(pathToFileURL(path.join(root, 'scripts', 'build-online-template.mjs')).href);
    const claims = builder.resolveRows(builder.loadManifest(path.join(root, builder.MANIFEST_REL)));
    const { files } = builder.planTree(builder.trackedEntries(root), claims, root);
    pairs = files.map((f) => ({ dst: f.dst, src: path.relative(root, f.src).split(path.sep).join('/') }));
  } else {
    pairs = tracked.map((p) => ({ dst: p, src: p }));
  }
  const kitOnly = isKit
    ? kitOnlyVariantPaths(readManifestComponents(root))
        .filter(present)
        .map((p) => ({ src: `${KIT_ONLY_PREFIX}${p}`, dst: `${KIT_ONLY_PREFIX}${p}`, lang: languageOf(p) }))
    : [];
  const files = pairs
    .map((p) => ({ ...p, lang: languageOf(p.dst) }))
    .filter((p) => p.lang && present(p.src))
    .concat(kitOnly)
    .sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
  return { root, isKit, files, tracked: new Set(tracked), ...manifestPaths(root) };
}

function readManifestComponents(root) {
  return readJsonFile(root, 'system/kit-manifest.json')?.components || [];
}

/**
 * The exact, non-directory paths a `variant` row claims that are also code this standard scores: the
 * Kit's own file at each is shadowed by its online replacement everywhere the builder plans a tree, so
 * only loadScope's Kit branch, which reads this, ever sees it. A directory claim (paths ending `/`, e.g.
 * `scheduler/`) is not a single file the leg could key a finding on, and a non-code path (CLAUDE.md,
 * README.md, .gitignore) is already out of scope by languageOf.
 */
export function kitOnlyVariantPaths(components) {
  return (components || [])
    .filter((c) => c.online === 'variant')
    .flatMap((c) => (Array.isArray(c.paths) ? c.paths : []))
    .filter((p) => !p.endsWith('/') && languageOf(p));
}

/**
 * The exact paths the manifest's rows name, and the ones its drop rows name. A generated tree resolves
 * a Kit-only path in a comment against the first, and knows a reader only the Kit holds by the second.
 */
function manifestPaths(root) {
  const rows = readManifestComponents(root);
  const exact = (named) =>
    new Set(named.flatMap((r) => (Array.isArray(r.paths) ? r.paths : [])).filter((p) => !p.endsWith('/')));
  return { manifestPaths: exact(rows), droppedPaths: exact(rows.filter((r) => r.online === 'drop')) };
}

export const isTestPath = (src) => src.startsWith(TESTS);

export async function loadContext(root = REPO) {
  const scope = await loadScope(root);
  // A kit: entry's shipped identity is not where it sits: it is the Kit's own file, read at the real
  // path underneath the prefix.
  const realPath = (src) => (src.startsWith(KIT_ONLY_PREFIX) ? src.slice(KIT_ONLY_PREFIX.length) : src);
  const read = (src) => fs.readFileSync(path.join(root, realPath(src)), 'utf8').replace(/^\uFEFF/, '');
  const inScope = new Set(scope.files.map((f) => f.src));
  const extra = scope.isKit
    ? [...scope.tracked]
        .filter((p) => isTestFile(p) && !inScope.has(p) && ['js', 'python'].includes(languageOf(p)))
        .sort()
        .map((p) => ({ src: p, dst: p, lang: languageOf(p) }))
    : [];
  const py = pythonFacts(
    root,
    [...scope.files, ...extra].filter((f) => f.lang === 'python').map((f) => f.src)
  );
  const files = scope.files.map((f) => analyze(f, read(f.src), py));
  const extraTests = extra.map((f) => analyze(f, read(f.src), py));
  return { ...scope, files, extraTests, bySrc: new Map(files.map((f) => [f.src, f])) };
}

// --------------------------------------------------------------------------- the enforced set

/** A plain JSON file at `root`/`rel`, through json-writer's own headerless reader; null when nothing is
 * there. The reader is the checker's own (it never changes with the tree being scored), so this stays
 * safe over a synthetic tree that carries no scripts/lib/ of its own. */
export function readJsonFile(root, rel) {
  return readJsonHeaderless(path.join(root, rel), { ifMissing: null });
}

/** The ratchet file through the JSON standard's reader, or a refusal naming what is wrong with it. */
export function readRatchet(root = REPO) {
  const { readJson } = require(path.join(root, 'scripts', 'lib', 'json-writer.js'));
  return readJson(path.join(root, RATCHET_REL), RATCHET_SCHEMA);
}

/**
 * The enforced set: {srcs: Set of src paths, problems: [string]}. A glob in Biome's list, a path the
 * scope does not hold, and a JavaScript path in the ratchet's own list are problems, never skipped:
 * a ratchet entry the checker cannot score silently enforces nothing.
 */
export function enforcedSet(ctx, ratchet) {
  const problems = [];
  const bySrc = new Set(ctx.files.map((f) => f.src));
  const byDst = new Map(ctx.files.map((f) => [f.dst, f.src]));
  const srcs = new Set();
  const place = (entry, from) => {
    const dst = entry.startsWith(VARIANT_PREFIX) ? entry.slice(VARIANT_PREFIX.length) : entry;
    const src = bySrc.has(entry) ? entry : ctx.isKit ? null : byDst.get(dst);
    if (src) srcs.add(src);
    else if (ctx.isKit) problems.push(`${from} names ${entry}, which is not in the scope this standard scores`);
  };
  const biome = readJsonFile(ctx.root, BIOME_REL);
  const includes = Array.isArray(biome?.files?.includes) ? biome.files.includes : [];
  for (const entry of includes) {
    if (typeof entry !== 'string' || /[*?[\]{}!]/.test(entry)) {
      problems.push(
        `${BIOME_REL} files.includes holds ${JSON.stringify(entry)}: the ratchet holds exact paths, and a pattern cannot be scored file by file`
      );
      continue;
    }
    if (!/\.(?:js|mjs|cjs)$/.test(entry)) {
      problems.push(
        `${BIOME_REL} files.includes names ${entry}, which is not JavaScript: that list is the JavaScript half of the ratchet, and a Python, shell or workflow path belongs in ${RATCHET_REL} enforced, the list the Python tool step reads`
      );
      continue;
    }
    place(entry, `${BIOME_REL} files.includes`);
  }
  for (const entry of ratchet.enforced || []) {
    if (/\.(?:js|mjs|cjs)$/.test(entry) && !MIGRATIONS.test(entry)) {
      problems.push(
        `${RATCHET_REL} enforced names ${entry}, a JavaScript file: it belongs in ${BIOME_REL} files.includes, the one JavaScript list`
      );
      continue;
    }
    place(entry, `${RATCHET_REL} enforced`);
  }
  return { srcs, problems };
}
