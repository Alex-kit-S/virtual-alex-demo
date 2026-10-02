// @ts-check
// scripts/lib/exit-codes.js - the three exit codes an Alex program ends with, each named once.
//
// WHAT. The numbers a program hands back to whatever started it: the Claude Code hook harness, git,
// GitHub Actions, a Routine prompt or a person at a terminal. Each has a name here, so a reader sees
// what a program means when it ends, and the values are the table in docs/CODE-STANDARD.md section 5.1.
//
// HOW. One frozen object, EXIT. SUCCESS is 0. FAILURE is 1, for every failure, including a check whose
// answer is no. REFUSED is 2, and only for the refusal contracts that section 5.2 lists, where the
// caller tells a refusal apart from a failure; a program that ends with it has a row in that table.
//
// NEVER. Holds a fourth code, or gives one of the three another value: the pre-commit hooks, the
// workflows, the hook harness and the Routine prompts read these numbers, and none of them changes
// with this file. Ends the process itself; the program that imports it does that.
//
// Usage: module only - const { EXIT } = require('./exit-codes');
'use strict';

const EXIT = Object.freeze({
  SUCCESS: 0,
  FAILURE: 1,
  REFUSED: 2
});

module.exports = { EXIT };
