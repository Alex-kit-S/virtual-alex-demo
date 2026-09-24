#!/usr/bin/env node
// scripts/lib/cli-version.js - say on the first screen when this Claude Code is too old to hear a hook.
//
// WHAT. The Virtual Alex autosave tells the model about a refused save through a hook's systemMessage
// (PostToolUse) and a Stop block. Claude Code honours systemMessage only from 2.1.227 (fleet RUN-STATE
// 2026-09-23 21:55, review finding F14). Below that the refusal never reaches the model, and a save
// that did not happen looks exactly like one that did. The cloud VM's CLI is not ours to pin, and a
// hook's input carries no version field, so the online SessionStart hook runs this and it asks the CLI:
//   at or above 2.1.227   prints NOTHING (a healthy line on every session would be noise)
//   below                 ---CLI-OLD--- Claude Code <v> is older than 2.1.227: ...
//   unreadable            ---CLI-UNKNOWN--- (not on PATH, no version in the answer, too slow to
//                         answer): the same sentence, because an unknown version is exactly the
//                         case that must not look healthy
//
// HOW. node scripts/lib/cli-version.js [--show]
//   --show  also prints the raw `claude --version` answer and the verdict when it is healthy, for a
//           person (or seat 9's acceptance run) reading it inside a cloud session.
//   ALEX_CLI_VERSION_TIMEOUT_MS  how long to wait for the answer (default 5000); tests shorten it.
//
// NEVER. Never blocks and never fails: every path exits 0, including a CLI that is missing, hangs or
// answers nonsense, because a session-start hook that errors is worse than the risk it reports.
// Never writes a file. Node builtins only.
'use strict';

const { spawnSync } = require('child_process');

const FLOOR = [2, 1, 227];
const FLOOR_TEXT = FLOOR.join('.');
const CONSEQUENCE = 'a save the commit gate refuses will NOT be reported to Alex in this session. Say so in your first reply, and ask the owner to check the autosave log with /alex-status before trusting that anything was saved.';

/** [major, minor, patch] from `claude --version` output, or null. */
function parseVersion(text) {
  const m = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function atLeast(v, floor = FLOOR) {
  for (let i = 0; i < 3; i++) if (v[i] !== floor[i]) return v[i] > floor[i];
  return true;
}

/** { raw, version, line }: line is '' when healthy. Never throws. */
function verdict(run = defaultRun) {
  let raw = '';
  try {
    const r = run();
    raw = r && r.ok ? String(r.stdout || '').trim() : '';
    const why = r && !r.ok ? r.why : '';
    const v = parseVersion(raw);
    if (!v) {
      return { raw, version: null, line: `---CLI-UNKNOWN--- The Claude Code version could not be read (${why || `no version in "${raw.slice(0, 40)}"`}), so ${CONSEQUENCE}` };
    }
    const text = v.join('.');
    if (!atLeast(v)) return { raw, version: text, line: `---CLI-OLD--- Claude Code ${text} is older than ${FLOOR_TEXT}: ${CONSEQUENCE}` };
    return { raw, version: text, line: '' };
  } catch (e) {
    return { raw, version: null, line: `---CLI-UNKNOWN--- The Claude Code version could not be read (${e.message}), so ${CONSEQUENCE}` };
  }
}

function defaultRun() {
  const timeout = Number(process.env.ALEX_CLI_VERSION_TIMEOUT_MS) || 5000;
  // A shell only on Windows, where the CLI is a .cmd or .exe that a bare spawn cannot find.
  const r = spawnSync('claude', ['--version'], {
    encoding: 'utf8', timeout, killSignal: 'SIGKILL', windowsHide: true,
    shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error && r.error.code === 'ENOENT') return { ok: false, why: 'claude is not on the PATH inside the hook' };
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, why: `no answer within ${timeout} ms` };
  if (r.error) return { ok: false, why: r.error.code || r.error.message };
  if (r.status !== 0) return { ok: false, why: `claude --version exited ${r.status === null ? 'on a signal' : r.status}` };
  return { ok: true, stdout: r.stdout };
}

module.exports = { parseVersion, atLeast, verdict, FLOOR_TEXT };

if (require.main === module) {
  try {
    const v = verdict();
    if (process.argv.includes('--show')) {
      console.log(`claude --version: ${v.raw || '(no answer)'}`);
      if (!v.line) console.log(`cli-version: ${v.version} is at or above ${FLOOR_TEXT}; hook messages reach Alex.`);
    }
    if (v.line) console.log(v.line);
  } catch {
    // fail-open: nothing a session-start hook prints is worth an error
  }
  process.exit(0);
}
