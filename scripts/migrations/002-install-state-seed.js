// scripts/migrations/002-install-state-seed.js - seeds the version record on a laptop that has none yet.
//
// WHAT. Writes system/install-state.json, the record of which template version this copy carries, on a
// laptop copy installed before that record existed, so kit-doctor can answer "when did this copy last
// update?" without reading git. The updater writes the record on every run, in place of the tracked
// VERSION file it once stamped (which kept the tree dirty); this covers only the gap before a machine's
// updater has written it once.
//
// HOW. Run once by scripts/run-migrations.js, which calls run({ root, log }). In a cloud session it
// declines at once and writes nothing: there the repository is the owner's, its HEAD is their own
// autosave commit and never a template version, and /update writes the real template commit on every
// run. On a laptop the checkout IS the template clone, so: a record already there is skipped; otherwise
// the version is `git rev-parse HEAD`, anything but 40 hex digits declines, and the record goes through
// its one writer, scripts/lib/install-state.js, whose stamp() reads it back. A record that did not verify
// declines, because a wrong record is worse than none: every reader downstream believes it.
// Idempotent on purpose: a second run finds the record it wrote and reports skipped.
//
// NEVER. Seeds from HEAD in a cloud session: run inside /update on a real install on 2026-09-23, it left the
// record holding two key sets, one of them describing the owner's autosave. Writes anything but that one
// gitignored record, or through anything but its writer. Changes a byte below this header: every owner's
// ledger holds this id and a pending machine runs these exact bytes, so a fix is a new migration or a runner
// change. The runner records the cloud decline as not-applicable (R4-1). Kept as pinned: an empty record
// {} counts as a record, so 002 skips and no version is ever recorded (R4-12).
//
// Usage: module only - run({ root, log }) returns { status, message }; scripts/run-migrations.js calls it
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
