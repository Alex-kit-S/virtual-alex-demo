// scripts/tests/code-standard/ratchet.mjs - the ratchet file's own math, and every operator mode.
//
// WHAT. Turns a run's legs into per-file ceilings (ceilingsOf, countsByFile, ceilingFailures), says
// which FIX ids the ratchet's current wave licenses (licensedIds, in shared.mjs since legs.mjs needs it
// too), checks the ratchet file's own shape (ratchetProblems), and is the whole surface behind the
// checker's five operator modes: --record, --raise, --fix, --unfreeze and --wave, plus writeRatchet,
// the ratchet's one writer.
//
// HOW. Every operator function takes the previous ratchet object and returns { data, rows } (or, for
// --unfreeze, { data, rows }), never writing anything itself: the caller in test-code-standard.mjs
// decides whether to call writeRatchet. recordRatchet, raiseRatchet and the rest call legs.mjs's
// allLegs/collectPinned/countedLegs to measure the tree they are handed, and reads.mjs's languageOf and
// readJsonFile for the same enforced-set and Biome-list questions enforcedSet answers at measurement
// time. writeRatchet is the one place scripts/lib/json-writer.js's writer runs, in the ratchet's own
// field order.
//
// NEVER. Decides a verdict; that is test-code-standard.mjs's job over this module's ceilingFailures.
// Runs a leg itself; it only reads what legs.mjs already computed.
//
// Usage: module only

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  allLegs,
  collectPinned,
  contextMoved,
  countedLegs,
  FINGERPRINT_VERSION,
  hasReason,
  REASON_WORDS_MIN,
  RUN_CONTEXT_LANGS
} from './legs.mjs';
import { languageOf, readJsonFile } from './reads.mjs';
import { BIOME_REL, keyOf, licensedIds, RATCHET_REL, RATCHET_SCHEMA, RATCHET_WRITER } from './shared.mjs';

const require = createRequire(import.meta.url);

// ------------------------------------------------------------------------------------ the ratchet

export const L2_REL = 'docs/L2.json';

const { Refusal } = require('../../lib/errors.js');
const { EXIT } = require('../../lib/exit-codes.js');
/** An operator mode refusing what it was asked; the CLI prints it and exits 1 (EXIT.FAILURE: an
 * operator edge's bad command line is a failure, never one of section 5.2's listed refusal
 * contracts). */
export class OperatorRefusal extends Refusal {
  /** @param {string} message what was refused and why */
  constructor(message) {
    super(message, { exitCode: EXIT.FAILURE });
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const pinEntry = (p) => ({
  context: p.context ?? null,
  file: p.file,
  fingerprint: p.fingerprint,
  ids: p.ids,
  stops: [...(p.stops || [])].sort(),
  title: p.title
});

const same = (p) => p;

/**
 * The path a file ships at, from the path it has in this tree: in the Kit, variants/online/x ships as
 * x; in a generated tree every path is already the shipped one. A ceiling is keyed by the shipped path,
 * so the one ratchet file judges the Kit and every tree built from it alike.
 */
export function shippedPath(ctx) {
  const dst = new Map((ctx.files || []).map((f) => [f.src, f.dst]));
  return (src) => dst.get(src) ?? src;
}

/**
 * The per-file ceilings of a ratchet: Map of `leg\0path` to count, keyed by the shipped path (a row
 * written under a Kit path is read at the path it ships at). A file with no row has a ceiling of 0.
 */
export function ceilingsOf(ratchet, dstOf = same) {
  const out = new Map();
  for (const r of ratchet.ceilings || []) {
    const k = keyOf(r.leg, dstOf(r.file));
    out.set(k, Math.max(out.get(k) ?? 0, r.count));
  }
  return out;
}

/** One leg's count in each file, keyed by the file's shipped path, from its findings. */
export function countsByFile(l, dstOf = same) {
  const out = new Map();
  for (const f of l.findings) out.set(dstOf(f.file), (out.get(dstOf(f.file)) || 0) + 1);
  return out;
}

/**
 * What is wrong with one counted leg: a file whose count is above its own ceiling, however the rest of
 * the scope moved (a finding removed in one file never pays for one added in another), and every
 * finding in the enforced set (for contract, the site or the reading test), even at the ceiling.
 */
export function ceilingFailures(l, ceilings, inForce, dstOf = same) {
  const failures = [];
  for (const [file, count] of countsByFile(l, dstOf)) {
    const ceiling = ceilings.get(keyOf(l.name, file)) ?? 0;
    if (count > ceiling)
      failures.push(
        `${l.name}: ${file} is at ${count}, above its ceiling of ${ceiling} (${l.unit} in that file). A file's count only goes down, whatever another file did`
      );
  }
  for (const f of l.findings.filter((x) => inForce.has(x.file) || (x.reader && inForce.has(x.reader))))
    failures.push(`${f.file}:${f.line} ${f.message} (in the enforced set)`);
  return failures;
}

/**
 * What is wrong with the ratchet file itself: a ceiling row naming no counted leg or no file, a count
 * that is not a whole number above 0, two rows for one leg and file, no current wave, a snapshot
 * recorded under another fingerprint version, a snapshot row with no run context in a language that
 * measures one, and a FIX, raises or unfrozen row missing its date or a reason of at least three words.
 */
export function ratchetProblems(ratchet, legNames) {
  const problems = [];
  const seen = new Set();
  for (const r of ratchet.ceilings || []) {
    if (!legNames.has(r.leg)) problems.push(`a ceiling row names ${JSON.stringify(r.leg)}, which is not a counted leg`);
    if (typeof r.file !== 'string' || !r.file)
      problems.push(`a ${r.leg} ceiling row names no file: a ceiling is per file`);
    if (!Number.isInteger(r.count) || r.count < 1)
      problems.push(
        `the ${r.leg} ceiling of ${r.file} is ${JSON.stringify(r.count)}: a whole number above 0 (a file at 0 has no row)`
      );
    const k = keyOf(r.leg, r.file);
    if (seen.has(k)) problems.push(`two ${r.leg} ceiling rows name ${r.file}`);
    seen.add(k);
  }
  if (typeof ratchet.current_wave !== 'string' || !ratchet.current_wave)
    problems.push('the ratchet names no current_wave, so no FIX row can be read');
  if (ratchet.fingerprint_version !== FINGERPRINT_VERSION)
    problems.push(
      `the pinned snapshot was recorded under fingerprint version ${ratchet.fingerprint_version}, and this checker computes version ${FINGERPRINT_VERSION}: --record re-records it`
    );
  const ids = new Set();
  for (const r of ratchet.fix_list || []) {
    if (!r.id || !r.wave || !r.date || !hasReason(r.reason))
      problems.push(
        `the FIX row ${JSON.stringify(r.id)} needs an id, a wave, a date and a reason of ${REASON_WORDS_MIN} words or more`
      );
    if (ids.has(r.id)) problems.push(`two FIX rows name ${r.id}`);
    ids.add(r.id);
  }
  for (const [list, rows] of [
    ['raises', ratchet.raises || []],
    ['unfrozen', ratchet.unfrozen || []]
  ]) {
    for (const r of rows)
      if (!r.what || !r.date || !('from' in r) || !('to' in r) || !hasReason(r.reason))
        problems.push(
          `a ${list} row (${JSON.stringify(r.what)}) needs what, from, to, a date and a reason of ${REASON_WORDS_MIN} words or more`
        );
  }
  const pins = new Set();
  for (const p of ratchet.pinned || []) {
    const k = keyOf(p.file, p.title);
    if (pins.has(k)) problems.push(`two snapshot rows name ${p.file}: ${p.title}`);
    pins.add(k);
    const lang = languageOf(p.file);
    if (
      ratchet.fingerprint_version === FINGERPRINT_VERSION &&
      RUN_CONTEXT_LANGS.has(lang) &&
      !/^[0-9a-f]{16}$/.test(p.context ?? '')
    )
      problems.push(
        `the snapshot row ${p.file}: ${p.title} carries no run context, and every ${lang} pin has one: --record re-records it`
      );
  }
  return problems;
}

/**
 * --record: lower every ceiling to today's count in its file, grow the enforced list, add pinned tests
 * the snapshot does not hold, and follow a changed pin only where one of its ids has a FIX row for the
 * current wave and it gained no reason not to run. It never raises anything: a rise, and a pin changed
 * or gone outside the FIX list, is returned in `held`, stays as recorded, and keeps failing the checker
 * until --raise or --unfreeze names it. When the fingerprint version moved (a checker change), every
 * pin the tree still holds is re-fingerprinted; the direction leg, which fingerprints the base tree
 * the same way, is what keeps that honest.
 */
export function recordRatchet(ctx, prev, { enforce = [] } = {}) {
  const held = [];
  const dstOf = shippedPath(ctx);
  const old = ceilingsOf(prev, dstOf);
  const ceilings = [];
  for (const l of countedLegs(allLegs(ctx, prev))) {
    for (const [file, count] of countsByFile(l, dstOf)) {
      const was = old.get(keyOf(l.name, file)) ?? 0;
      if (count > was)
        held.push(`ceiling ${l.name} ${file}: ${was} -> ${count} is a raise (--raise ${l.name}=${file})`);
      if (Math.min(count, was) > 0) ceilings.push({ count: Math.min(count, was), file, leg: l.name });
    }
  }
  const tree = new Map(collectPinned(ctx).map((p) => [keyOf(p.file, p.title), p]));
  const licensed = licensedIds(prev);
  const sameVersion = prev.fingerprint_version === FINGERPRINT_VERSION;
  const pinned = [];
  const known = new Set();
  for (const was of prev.pinned || []) {
    const k = keyOf(was.file, was.title);
    known.add(k);
    const is = tree.get(k);
    const gained = is ? is.stops.filter((s) => !(was.stops || []).includes(s)) : [];
    const bodyMoved = !is || is.fingerprint !== was.fingerprint;
    if (is && !gained.length && (!sameVersion || (!bodyMoved && !contextMoved(was, is)))) {
      pinned.push(pinEntry(is));
      continue;
    }
    if (!is && !ctx.isKit && !ctx.tracked.has(was.file)) {
      pinned.push(was);
      continue;
    }
    if (!gained.length && was.ids.some((id) => licensed.has(id))) {
      if (is) pinned.push(pinEntry(is));
      continue;
    }
    const how = !is
      ? 'is gone'
      : gained.length
        ? `gained ${gained.join('; ')}`
        : bodyMoved
          ? 'changed'
          : 'changed its run context';
    const named = !is || gained.length || bodyMoved ? `pin:${was.ids[0]}` : `pin-context:${was.file}`;
    held.push(`pin ${was.file} :: ${was.title.slice(0, 70)} ${how} outside the FIX list (--unfreeze ${named})`);
    pinned.push(was);
  }
  for (const [k, p] of tree) if (!known.has(k)) pinned.push(pinEntry(p));
  const data = {
    ...prev,
    ceilings,
    enforced: [...new Set([...(prev.enforced || []), ...enforce])],
    fingerprint_version: FINGERPRINT_VERSION,
    pinned
  };
  return { data, held };
}

/** --raise <leg>[=<file>]: lift the named leg's ceilings to today's counts where they rose, one dated row each. */
export function raiseRatchet(ctx, prev, specs, reason, date = today()) {
  const legs = new Map(countedLegs(allLegs(ctx, prev)).map((l) => [l.name, l]));
  const dstOf = shippedPath(ctx);
  const ceilings = ceilingsOf(prev, dstOf);
  const rows = [];
  for (const spec of specs) {
    const cut = spec.indexOf('=');
    const [name, only] = cut === -1 ? [spec, null] : [spec.slice(0, cut), dstOf(spec.slice(cut + 1))];
    const l = legs.get(name);
    if (!l) throw new OperatorRefusal(`--raise ${spec}: ${name} is not a counted leg`);
    const before = rows.length;
    for (const [file, count] of countsByFile(l, dstOf)) {
      const was = ceilings.get(keyOf(name, file)) ?? 0;
      if ((only && file !== only) || count <= was) continue;
      ceilings.set(keyOf(name, file), count);
      rows.push({ date, from: was, reason, to: count, what: `ceiling ${name} ${file}` });
    }
    if (rows.length === before) throw new OperatorRefusal(`--raise ${spec}: nothing there is above its ceiling`);
  }
  const data = {
    ...prev,
    ceilings: [...ceilings].map(([k, count]) => {
      const [leg, file] = k.split('\u0000');
      return { count, file, leg };
    }),
    raises: [...(prev.raises || []), ...rows]
  };
  return { data, rows };
}

/** --fix <id>=<wave>: add, or move to another wave, a FIX row, dated and with its reason. */
export function fixRatchet(prev, specs, reason, date = today()) {
  const byId = new Map((prev.fix_list || []).map((r) => [r.id, r]));
  const rows = [];
  for (const spec of specs) {
    const m = /^([A-Za-z0-9-]+)=([A-Za-z0-9]+)$/.exec(spec);
    if (!m) throw new OperatorRefusal(`--fix ${spec}: expected <id>=<wave>, for example ABC-1=5`);
    if (byId.get(m[1])?.wave === m[2])
      throw new OperatorRefusal(`--fix ${spec}: ${m[1]} is already on the FIX list for wave ${m[2]}`);
    const row = { date, id: m[1], reason, wave: m[2] };
    byId.set(m[1], row);
    rows.push(row);
  }
  return { data: { ...prev, fix_list: [...byId.values()] }, rows };
}

/** A short digest of a list of run contexts, for an unfrozen row's from and to. */
const contextsDigest = (contexts) => createHash('sha256').update(JSON.stringify(contexts)).digest('hex').slice(0, 16);

/**
 * --unfreeze pin:<id> | pin-context:<file> | enforced:<path> | l2:<path>[#<name>]: the loosenings an
 * operator names by hand. A pin is re-recorded as the tree holds it (or dropped when gone). pin-context
 * re-records the run context of every pin in one file whose context moved, and nothing else of them,
 * so a refactor of a shared base class or hook is one row, while a body that changed or a new reason
 * not to run still needs its own FIX row or pin:<id>. An enforced path leaves the ratchet's list
 * (Biome's list is edited by hand); an L2 file or export name is let go. Each writes one dated row
 * saying what moved from what to what.
 */
export function unfreezeRatchet(ctx, prev, specs, reason, date = today()) {
  let pinned = [...(prev.pinned || [])];
  let enforced = [...(prev.enforced || [])];
  const rows = [];
  const tree = new Map(collectPinned(ctx).map((p) => [keyOf(p.file, p.title), p]));
  for (const spec of specs) {
    const cut = spec.indexOf(':');
    const [kind, target] = cut === -1 ? [spec, ''] : [spec.slice(0, cut), spec.slice(cut + 1)];
    if (kind === 'pin' && target) {
      const before = rows.length;
      const next = [];
      for (const was of pinned) {
        const is = tree.get(keyOf(was.file, was.title));
        const moved =
          !is ||
          is.fingerprint !== was.fingerprint ||
          contextMoved(was, is) ||
          is.stops.some((s) => !(was.stops || []).includes(s));
        if (!was.ids.includes(target) || !moved) {
          next.push(was);
          continue;
        }
        rows.push({
          date,
          from: was.fingerprint,
          reason,
          to: is ? is.fingerprint : 'removed',
          what: `pin ${was.file} :: ${was.title}`
        });
        if (is) next.push(pinEntry(is));
      }
      if (rows.length === before)
        throw new OperatorRefusal(`--unfreeze ${spec}: no pinned test with id ${target} moved`);
      pinned = next;
    } else if (kind === 'pin-context' && target) {
      const now = (was) => tree.get(keyOf(was.file, was.title));
      const moved = pinned.filter((was) => was.file === target && now(was) && contextMoved(was, now(was)));
      if (!moved.length)
        throw new OperatorRefusal(`--unfreeze ${spec}: no pinned test in ${target} has a run context that moved`);
      rows.push({
        date,
        from: contextsDigest(moved.map((was) => was.context ?? null)),
        reason,
        to: contextsDigest(moved.map((was) => now(was).context)),
        what: `pin-context ${target}`
      });
      pinned = pinned.map((was) => (moved.includes(was) ? { ...was, context: now(was).context } : was));
    } else if (kind === 'enforced' && target) {
      const biome = readJsonFile(ctx.root, BIOME_REL);
      if (!enforced.includes(target) && !(biome?.files?.includes || []).includes(target))
        throw new OperatorRefusal(`--unfreeze ${spec}: ${target} is not enforced`);
      enforced = enforced.filter((p) => p !== target);
      rows.push({ date, from: 'enforced', reason, to: 'not enforced', what: `enforced ${target}` });
    } else if (kind === 'l2' && target) {
      const [file, name] = target.split('#');
      rows.push({ date, from: 'frozen', reason, to: 'removed', what: name ? `l2 ${file} ${name}` : `l2 ${file}` });
    } else {
      throw new OperatorRefusal(
        `--unfreeze ${spec}: expected pin:<id>, pin-context:<file>, enforced:<path> or l2:<path>[#<name>]`
      );
    }
  }
  return { data: { ...prev, enforced, pinned, unfrozen: [...(prev.unfrozen || []), ...rows] }, rows };
}

/** --wave <id>: move the current wave, the wave whose FIX rows license a pinned change. */
export function waveRatchet(prev, wave, reason, date = today()) {
  if (!/^[A-Za-z0-9]+$/.test(wave)) throw new OperatorRefusal(`--wave ${wave}: a wave is letters and digits`);
  if (wave === prev.current_wave) throw new OperatorRefusal(`--wave ${wave}: that is already the current wave`);
  const row = { date, from: prev.current_wave ?? 'none', reason, to: wave, what: 'current_wave' };
  return { data: { ...prev, current_wave: wave, raises: [...(prev.raises || []), row] }, rows: [row] };
}

/**
 * Write the ratchet through scripts/lib/json-writer.js, in its one order: ceilings by leg and file,
 * the lists sorted, and the raises and unfrozen rows in the order they were written, which is their
 * history. An unchanged ratchet is not rewritten at all.
 */
export function writeRatchet(root, data) {
  const { writeJson } = require(path.join(root, 'scripts', 'lib', 'json-writer.js'));
  const by = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
  const out = {
    ceilings: [...data.ceilings]
      .sort(by((r) => keyOf(r.leg, r.file)))
      .map((r) => ({ count: r.count, file: r.file, leg: r.leg })),
    current_wave: data.current_wave,
    enforced: [...new Set(data.enforced || [])].sort(),
    fingerprint_version: data.fingerprint_version,
    fix_list: [...(data.fix_list || [])]
      .sort(by((r) => r.id))
      .map((r) => ({ date: r.date, id: r.id, reason: r.reason, wave: r.wave })),
    pinned: [...(data.pinned || [])].sort(by((p) => keyOf(p.file, p.title))).map(pinEntry),
    raises: data.raises || [],
    unfrozen: data.unfrozen || []
  };
  return writeJson(path.join(root, RATCHET_REL), out, {
    purpose:
      "The code standard checker's ratchet: each file's ceiling per counted leg, the files it enforces beyond Biome's list, the FIX list and the wave it is read for, the pinned-assertion snapshot, and the dated rows that name every raise and every loosening.",
    writer: RATCHET_WRITER,
    schema: RATCHET_SCHEMA
  });
}
