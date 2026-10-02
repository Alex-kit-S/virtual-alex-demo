// @ts-check
// scripts/lib/repo-root.js - the one way a script finds the root of the checkout it belongs to.
//
// WHAT. Every script that reads or writes a path in this repository starts from its root. REPO is that
// root, and repoRoot() returns it; a hook can also ask for the project Claude Code opened, which is the
// same folder in every install and can differ only when the harness says so.
//
// HOW. This file sits at scripts/lib/repo-root.js, so the root is two folders above it, resolved once at
// load from __dirname. node has already resolved __dirname through any link, so a checkout reached
// through a symbolic link or a junction gives its real folder - but not a fully canonical one: node's own
// loader resolves __dirname with the JS realpath, not the native one, so REPO keeps a Windows short (8.3)
// name segment exactly as reached, rather than expanding it to the long name (test-repo-root.mjs pins
// this). repoRoot({ hook: true }) returns CLAUDE_PROJECT_DIR from the environment when it is set and not
// empty, as the Claude Code hook harness sets it, and REPO otherwise; the value is returned as the harness
// wrote it. An ES module imports this file by path and receives both names.
//
// NEVER. Moves out of scripts/lib/: the root is computed from where this file sits, and a copy one
// folder deeper or higher answers with the wrong folder. Lets an environment variable redirect a script
// that did not ask as a hook, because a variable left over in a shell would then send a generator's
// writes into another checkout. Asks git, which a laptop or a Routine may not have on PATH.
//
// Usage: module only - const { REPO, repoRoot } = require('./repo-root');
'use strict';

const path = require('node:path');

/** The root of the checkout this file belongs to. */
const REPO = path.resolve(__dirname, '..', '..');

/**
 * The repository root, or, for a hook, the project the Claude Code harness names.
 * @param {{ hook?: boolean, env?: NodeJS.ProcessEnv }} [options] `env` is process.env unless a test names another
 * @returns {string}
 */
function repoRoot(options = {}) {
  const { hook = false, env = process.env } = options;
  return (hook && env.CLAUDE_PROJECT_DIR) || REPO;
}

module.exports = { REPO, repoRoot };
