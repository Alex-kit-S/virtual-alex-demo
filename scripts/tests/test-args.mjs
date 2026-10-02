// @ts-check
// scripts/tests/test-args.mjs - an unknown flag is refused from a person and named-then-dropped from a hook.
//
// WHAT. Proves scripts/lib/args.js on every edge its callers name. On the operator edge an unknown flag,
// a known flag with no value and a bare word the command does not take are each refused with exit code
// 1 and a sentence that says what was wrong. On a hook or Routine edge an unknown flag is named in one
// warning line and dropped, with its value, and the rest still parses; a known flag given wrongly is
// still refused. A Refusal from a real node:util parseArgs failure carries that failure as its `cause`,
// so a caller reads error.cause.code instead of matching node's wording; a Refusal args.js throws itself
// (an unknown flag) carries none. Deleted, it would let a mistyped --dry-run be ignored and the program
// write for real, or let one invented flag stop a hook or a Routine that exists to save the run.
//
// HOW. Calls parseCommandLine with one option table and named arguments, collecting warning lines in an
// array, and asserts values, positionals, the lines and every Refusal's class, exit code and message.
// Every refusal is asserted before the pass it guards. One node child shows the default warning goes to
// stderr and leaves stdout to the program, with the script on stdin so its own arguments are real.
//
// NEVER. Writes a file, reaches a network or reads this process's own arguments: every command line it
// tests is an array it passes.
//
// Usage: node scripts/tests/test-args.mjs
// Exit: 0 every assertion held - 1 one failed

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCommandLine } from '../lib/args.js';
import { Refusal } from '../lib/errors.js';

const MODULE = fileURLToPath(new URL('../lib/args.js', import.meta.url));

/** @type {import('node:util').ParseArgsOptionsConfig} */
const OPTIONS = {
  'dry-run': { type: 'boolean' },
  job: { type: 'string' },
  tag: { type: 'string', multiple: true },
  mode: { type: 'string', default: 'daily' },
  verbose: { type: 'boolean', short: 'v' }
};

/**
 * Parse argv on an edge, collecting warnings instead of printing them, with the values copied into a plain
 * object so they compare with a literal.
 * @param {'operator' | 'hook' | 'routine'} edge
 * @param {string[]} argv
 * @param {boolean} [allowPositionals]
 */
function parse(edge, argv, allowPositionals = false) {
  /** @type {string[]} */
  const warnings = [];
  const line = parseCommandLine({
    name: 'demo',
    edge,
    options: OPTIONS,
    argv,
    allowPositionals,
    warn: (w) => warnings.push(w)
  });
  return { values: { ...line.values }, positionals: line.positionals, warnings };
}

/**
 * Assert the call throws a Refusal with exit code 1 and exactly this message.
 * @param {() => unknown} call
 * @param {string} message
 */
function refuses(call, message) {
  assert.throws(call, (e) => {
    assert.ok(e instanceof Refusal, `a Refusal, not ${e}`);
    assert.deepEqual([e.exitCode, e.message], [1, message]);
    return true;
  });
}

const TAKES = 'this command takes --dry-run, --job, --tag, --mode, --verbose (-v)';

describe('the operator edge refuses', () => {
  test('a mistyped flag, which would otherwise be ignored while the program writes', () => {
    refuses(() => parse('operator', ['--dryrun']), `unknown flag --dryrun; ${TAKES}`);
  });

  test('every unknown flag at once, written with or without a value', () => {
    refuses(() => parse('operator', ['--zz=1', '--job', 'a', '-q']), `unknown flags --zz, -q; ${TAKES}`);
  });

  test('a known flag with no value, and a bare word the command does not take', () => {
    refuses(() => parse('operator', ['--job']), "Option '--job <value>' argument missing");
    refuses(
      () => parse('operator', ['stray']),
      "Unexpected argument 'stray'. This command does not take positional arguments"
    );
  });

  test('and names that a command with no flags takes none', () => {
    const call = () => parseCommandLine({ name: 'demo', edge: 'operator', options: {}, argv: ['--x'] });
    refuses(call, 'unknown flag --x; this command takes no flags');
  });
});

describe('the operator edge parses', () => {
  test('known flags, repeated flags, short flags and defaults', () => {
    const line = parse('operator', ['--dry-run', '--job', 'nightly', '--tag', 'a', '--tag=b', '-v']);
    assert.deepEqual(line.values, { 'dry-run': true, job: 'nightly', tag: ['a', 'b'], verbose: true, mode: 'daily' });
    assert.deepEqual([line.positionals, line.warnings], [[], []]);
  });

  test('values with no prototype, so a flag named like an Object method is unset until given', () => {
    const options = { toString: { type: /** @type {const} */ ('boolean') } };
    const line = parseCommandLine({ name: 'demo', edge: 'operator', options, argv: [] });
    assert.equal(Object.getPrototypeOf(line.values), null);
    assert.equal(line.values.toString, undefined);
  });

  test('bare words when the command takes them, and anything after -- as a bare word', () => {
    const line = parse('operator', ['one', '--', '--zz'], true);
    assert.deepEqual(line.positionals, ['one', '--zz']);
  });
});

describe('a hook or Routine edge', () => {
  for (const edge of /** @type {const} */ (['hook', 'routine'])) {
    test(`${edge}: names an unknown flag and its value in one line, drops both, and parses the rest`, () => {
      const line = parse(edge, ['--note', 'saved it', '--job', 'nightly']);
      assert.deepEqual(line.warnings, ['demo: WARNING - ignored --note saved it: unknown flag --note']);
      assert.deepEqual([line.values, line.positionals], [{ job: 'nightly', mode: 'daily' }, []]);
    });
  }

  test('drops a flag written with its value, and keeps the next bare word when the command takes bare words', () => {
    assert.deepEqual(parse('hook', ['--zz=1', '--dry-run']).warnings, [
      'demo: WARNING - ignored --zz=1: unknown flag --zz'
    ]);
    const line = parse('hook', ['--zz', 'file.md'], true);
    assert.deepEqual(
      [line.warnings, line.positionals],
      [['demo: WARNING - ignored --zz: unknown flag --zz'], ['file.md']]
    );
  });

  test('drops a short-flag group holding an unknown letter whole, and names the group', () => {
    const line = parse('hook', ['-vq', '--job', 'x']);
    assert.deepEqual(line.warnings, ['demo: WARNING - ignored -vq: unknown flag -q']);
    assert.deepEqual(line.values, { job: 'x', mode: 'daily' });
  });

  test('still refuses a known flag given wrongly', () => {
    refuses(() => parse('hook', ['--zz', '--job']), "Option '--job <value>' argument missing");
    refuses(
      () => parse('routine', ['stray']),
      "Unexpected argument 'stray'. This command does not take positional arguments"
    );
  });
});

describe("a Refusal wraps node's own parse error as its cause, so a caller reads the code, not the words", () => {
  test("a known flag with no value, and a bare word: cause.code is node's ERR_PARSE_ARGS_* name", () => {
    assert.throws(
      () => parse('operator', ['--job']),
      (e) => e instanceof Refusal && /** @type {any} */ (e.cause)?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
    );
    assert.throws(
      () => parse('operator', ['stray']),
      (e) => e instanceof Refusal && /** @type {any} */ (e.cause)?.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
    );
  });

  test("an unknown flag is args.js's own Refusal, thrown with no cause at all", () => {
    assert.throws(
      () => parse('operator', ['--dryrun']),
      (e) => e instanceof Refusal && e.cause === undefined
    );
  });
});

describe('a defect in the caller is not a refusal', () => {
  test('an edge nobody defined', () => {
    const edge = /** @type {any} */ ('hooks');
    const call = () => parseCommandLine({ name: 'demo', edge, options: OPTIONS, argv: [] });
    assert.throws(call, (e) => e instanceof TypeError && !(e instanceof Refusal) && /edge must be/.test(e.message));
  });

  test('an option table node:util cannot read', () => {
    const options = /** @type {any} */ ({ n: { type: 'number' } });
    const call = () => parseCommandLine({ name: 'demo', edge: 'operator', options, argv: [] });
    assert.throws(call, (e) => e instanceof TypeError && !(e instanceof Refusal));
  });
});

test("the default warning goes to stderr, and stdout stays the program's own", () => {
  const script = [
    `const { parseCommandLine } = require(${JSON.stringify(MODULE)});`,
    "const line = parseCommandLine({ name: 'demo', edge: 'hook', options: { job: { type: 'string' } } });",
    'console.log(JSON.stringify(line.values));'
  ].join('\n');
  const child = spawnSync(process.execPath, ['-', '--zz', '--job', 'x'], {
    input: script,
    encoding: 'utf8',
    timeout: 30_000
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '{"job":"x"}\n');
  assert.equal(child.stderr, 'demo: WARNING - ignored --zz: unknown flag --zz\n');
});
