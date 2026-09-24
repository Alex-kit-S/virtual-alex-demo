/*
 * 002-install-state-seed.js
 *
 * Seeds system/install-state.json on LAPTOP copies installed BEFORE 2026-08-31.
 *
 * WHY. Until 2026-08-31 every update stamped the tracked VERSION file locally, which kept the
 * tree permanently dirty and armed a stash-pop dead end the day upstream ever changed VERSION.
 * Update-Alex now stamps system/install-state.json instead - gitignored, machine-local, what
 * the manifest always said the version record should be. The updater itself writes the stamp
 * on every run from now on; this migration only covers the gap where kit-doctor asks "when did
 * this copy last update?" on a machine whose updater has not stamped the new file yet.
 *
 * WHY IT DECLINES IN A CLOUD SESSION (2026-09-23). The seed reads `git rev-parse HEAD` because on
 * a laptop the checkout IS the template clone, so its HEAD is the version it carries. Online that
 * is not true: the repository is the OWNER'S, and its HEAD is their own autosave commit. Seeding
 * from it records a version that was never a version. There is no gap to cover online anyway -
 * an online copy is born from a template that already ships the changelog, and /update writes the
 * real template commit on every run. So online this migration reads the state and writes nothing.
 * Measured on 2026-09-23: it ran inside /update on a real install and left the record holding two
 * key sets, one of them describing the owner's autosave.
 *
 * Idempotent and boring on purpose: if the record exists, report skipped; if git cannot answer,
 * decline and stay pending. It writes ONE gitignored file, through the one writer
 * (scripts/lib/install-state.js), and touches nothing else.
 */
'use strict';
const { execFileSync } = require('child_process');
const installState = require('../lib/install-state.js');

const ID = '002-install-state-seed';

function run({ root, log }) {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    return {
      status: 'declined',
      message: 'this is a cloud session, where the repository HEAD is the owner\'s own commit and not a template version; /update writes the real one.',
    };
  }

  if (installState.read(root)) {
    return { status: 'skipped', message: 'version record already exists; nothing to seed.' };
  }

  let head = '';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch (e) {
    return { status: 'declined', message: `could not read the current version from git (${e.message}); will retry next update.` };
  }
  if (!/^[0-9a-f]{40}$/.test(head)) {
    return { status: 'declined', message: 'git gave an unexpected answer; will retry next update.' };
  }

  // stamp() writes through the JSON standard and reads the record back; a record that did not
  // land is worse than none, because every reader downstream believes it.
  try {
    installState.stamp(root, head, { by: ID });
  } catch (e) {
    return { status: 'declined', message: `the version record did not verify after writing (${e.message}); will retry next update.` };
  }

  log(`version record seeded at ${head.slice(0, 12)}`);
  return { status: 'applied', message: 'Alex can now answer "am I up to date?" without reading git.' };
}

module.exports = { id: ID, run };
