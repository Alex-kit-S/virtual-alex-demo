// @ts-check
// scripts/lib/args.js - reads a command line, and decides what an unknown flag does by who wrote the line.
//
// WHAT. The one argument parser for Alex's command lines. A person or an operator script that passes a
// flag the program does not know is refused, because a mistyped --dry-run that is silently ignored
// writes for real. A hook or a Routine is not refused for it: settings.json fills in a hook's line and a
// model fills in a Routine's, and a program that stopped over one invented flag would lose the save or
// the run-log row it exists for. There the flag is named on stderr and the run carries on without it.
//
// HOW. parseCommandLine takes the caller's node:util parseArgs option table, the program's name and its
// edge: 'operator', 'hook' or 'routine'. A first, lenient parseArgs pass with tokens finds every flag the
// table does not name. On the operator edge any such flag throws a Refusal from scripts/lib/errors.js
// that names it and the flags the command takes, with exit code EXIT.FAILURE, as docs/CODE-STANDARD.md
// section 4 orders. On a hook or Routine edge each one is dropped with one warning line, and so is the
// bare word right after it when the command takes no bare words, since that word was the flag's value.
// A short-flag group holding an unknown letter is dropped whole, and its warning names the whole group.
// What is left goes through parseArgs strictly on every edge, and anything it rejects (a known flag
// with no value, a bare word the command does not take) is a Refusal with node's own sentence, carrying
// node's own error as its cause, so a caller that needs to tell one kind of parse failure from another
// reads error.cause.code (node's ERR_PARSE_ARGS_* names) rather than matching that sentence. The
// values come back as parseArgs builds them, with no prototype, so a flag named like an Object method
// reads as unset until it is given. This module requires scripts/lib/errors.js and scripts/lib/exit-codes.js
// as it loads, so a hook entry loads it inside the try that section 3.6 of docs/CODE-STANDARD.md orders: a
// load failure there is exit 2 in the guard and a silent 0 in a prompt hook, never exit 1, which Claude Code
// reads as "proceed" in every armed lane.
//
// NEVER. Relaxes anything on a hook or Routine edge except an unknown flag: a known flag given wrongly is
// refused there too, and the caller decides what a hook does with a refusal. Turns a mistake in the
// caller's own option table into a Refusal: that is a defect in the program, and node's error passes
// through. Writes anything but warnings, and those only to stderr. Ends the process.
//
// Usage: module only - const { parseCommandLine } = require('./args');
'use strict';

const { parseArgs } = require('node:util');
const { Refusal } = require('./errors');
const { EXIT } = require('./exit-codes');

const EDGES = new Set(['operator', 'hook', 'routine']);

/**
 * @typedef {import('node:util').ParseArgsOptionsConfig} OptionTable
 * @typedef {{ values: Record<string, string | boolean | Array<string | boolean> | undefined>, positionals: string[] }} CommandLine
 * @typedef {{ flag: string, indexes: number[] }} UnknownFlag
 */

/** @param {string} line */
function toStderr(line) {
  process.stderr.write(`${line}\n`);
}

/**
 * Every flag the table does not name, with the argument positions that belong to it.
 * @param {string[]} argv
 * @param {OptionTable} options
 * @param {boolean} allowPositionals
 * @returns {UnknownFlag[]}
 */
function unknownFlags(argv, options, allowPositionals) {
  const { tokens } = parseArgs({ args: argv, options, strict: false, allowPositionals: true, tokens: true });
  /** @type {UnknownFlag[]} */
  const found = [];
  tokens.forEach((token, k) => {
    if (token.kind !== 'option' || Object.hasOwn(options, token.name)) return;
    const indexes = [token.index];
    const next = tokens[k + 1];
    const takesNextWord = token.value === undefined && !allowPositionals;
    if (takesNextWord && next?.kind === 'positional' && next.index === token.index + 1) indexes.push(next.index);
    found.push({ flag: token.rawName, indexes });
  });
  return found;
}

/**
 * The flags a command takes, for a refusal to name, each with its one-letter alias when it has one.
 * @param {OptionTable} options
 */
function knownFlags(options) {
  const names = Object.entries(options).map(([name, o]) => (o.short ? `--${name} (-${o.short})` : `--${name}`));
  return names.length ? `this command takes ${names.join(', ')}` : 'this command takes no flags';
}

/**
 * True when node:util parseArgs rejected the arguments, as opposed to the option table.
 * @param {unknown} error
 * @returns {error is TypeError}
 */
function isParseError(error) {
  return error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_');
}

/**
 * Parse a command line with node:util parseArgs, and settle an unknown flag by the edge the caller names.
 * @param {object} spec
 * @param {string} spec.name the program's name, which opens every warning line
 * @param {'operator' | 'hook' | 'routine'} spec.edge who writes this command line
 * @param {OptionTable} spec.options the parseArgs option table
 * @param {boolean} [spec.allowPositionals] whether the command takes bare words; false by default
 * @param {string[]} [spec.argv] the arguments; process.argv.slice(2) unless a test names others
 * @param {(line: string) => void} [spec.warn] where a warning line goes; stderr unless a test names another
 * @returns {CommandLine}
 */
function parseCommandLine(spec) {
  const { name, edge, options, allowPositionals = false, argv = process.argv.slice(2), warn = toStderr } = spec;
  if (!EDGES.has(edge)) throw new TypeError(`args: edge must be 'operator', 'hook' or 'routine', not ${edge}`);
  const unknown = unknownFlags(argv, options, allowPositionals);
  if (unknown.length && edge === 'operator') {
    const flags = unknown.map((u) => u.flag).join(', ');
    const noun = unknown.length > 1 ? 'flags' : 'flag';
    throw new Refusal(`unknown ${noun} ${flags}; ${knownFlags(options)}`, { exitCode: EXIT.FAILURE });
  }
  for (const u of unknown) {
    warn(`${name}: WARNING - ignored ${u.indexes.map((i) => argv[i]).join(' ')}: unknown flag ${u.flag}`);
  }
  const dropped = new Set(unknown.flatMap((u) => u.indexes));
  const kept = argv.filter((_, i) => !dropped.has(i));
  try {
    const { values, positionals } = parseArgs({ args: kept, options, allowPositionals, strict: true });
    return { values, positionals };
  } catch (error) {
    if (isParseError(error)) throw new Refusal(error.message, { exitCode: EXIT.FAILURE, cause: error });
    throw error;
  }
}

module.exports = { parseCommandLine };
