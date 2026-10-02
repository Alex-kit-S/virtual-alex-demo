// scripts/lib/validate/shipped.js - the content checks on surfaces that ship (or are about to),
// split from scripts/validate-alex.js: V13, V14, V15, V18, V19, and kitManifestDropClaim.
//
// WHAT. Five legs that all ask the same underlying question of a different shipped surface - does this
// file's content still match what it claims or what the registry says - plus the one shared helper they
// (and V21, in skills-json.js) all need to tell an online drop from a real regression: V13 the local
// `claude -p` wrapper model pins, V14 Alex's gender-neutrality contract on unpublished episode drafts,
// V15 command-file CMD-HEADER freshness, V18 the shipped executables and command files (control bytes,
// non-terminating .cmd guards, dangling /commands, cut-project pointers, dead markdown links, and on
// win32 a real PowerShell parse of every .ps1), and V19 the Routine prompt files bound to
// system/manifest.json routines[].
//
// HOW. kitManifestDropClaim(stagedDir) reads system/kit-manifest.json (staged first) and returns a
// predicate: true when the most specific claim for a path is a `drop` row, the one rule
// scripts/lib/manifest-claim.js's claimFor also decides for scripts/build-online-template.mjs's own
// PLAN step. V13 and V18 use it directly; V21 (scripts/lib/validate/skills-json.js) imports it from
// here, so the online-drop rule is one piece of code everywhere it is asked. V18's win32-only
// PowerShell syntax sweep writes one throwaway file under os.tmpdir(), removed in a finally.
//
// NEVER. Retro-edits a PUBLISHED episode (status: published in its header) - that is the archive of what
// actually went out. Leaves its os.tmpdir() PowerShell file list behind on any exit path.
//
// Usage: module only - const { v18ShippedExecutables, kitManifestDropClaim, ... } = require('./shipped');
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os'); // V18 leg (f): temp file for the PS parse sweep
const { execFileSync } = require('node:child_process'); // V18 leg (f): ask the PowerShell parser itself

const { routineRows, ROUTINES_DIR } = require('../gen-routines'); // V19: the Routine prompt contract
const { REPO, effective, listFiles } = require('./structure');
const { claimFor } = require('../manifest-claim');

// The most specific claim in system/kit-manifest.json for a path, through claimFor (an exact name beats
// a directory, a longer prefix beats a shorter one). Returns a predicate: true when that claim is a
// `drop` row. An absent or unreadable kit-manifest drops nothing, so V13 falls back to its old
// behaviour rather than guessing.
// contract: read as text by scripts/tests/test-validate-cli-contract.mjs:150. This declaration keeps its name and its one parameter.
function kitManifestDropClaim(stagedDir) {
  const eff = effective(stagedDir, 'system/kit-manifest.json');
  if (!eff) return () => false;
  let rows;
  try {
    rows = JSON.parse(eff.text).components || [];
  } catch (_) {
    return () => false;
  }
  const claims = [];
  for (const r of rows)
    for (const p of r && Array.isArray(r.paths) ? r.paths : [])
      if (typeof p === 'string') claims.push({ online: r.online, prefix: p, isDir: p.endsWith('/') });
  return (rel) => claimFor(rel, claims)?.online === 'drop';
}

// ---------------------------------------------------------------------------------------------
// V13 - local wrapper model-pin contract: asserts the scheduled `claude -p` wrappers under scripts/
//       against meta.model_routing.local_wrappers. Pure file reads, no network, so it runs in EVERY
//       context (generator + pre-commit). Root fix for "a wrapper omits --model and inherits the
//       global default" (a cost-control convention needed a machine-checked enforcement, not just an
//       agreement to follow it).
//       COMPLETE by construction: every scripts/run-*.ps1 (+ auth-check.ps1) that makes a real
//       `claude -p` call MUST be in `pins` (with the matching model) or `deterministic_no_pin`
//       (makes no claude call), else FAIL - so a new/copied wrapper cannot slip through uncovered.
//       This is the bidirectional shape V2 uses for scheduled jobs, applied to the model contract.
// ---------------------------------------------------------------------------------------------
function v13LocalWrapperPins({ stagedDir, manifest }, failures, warnings) {
  const lw = manifest.meta?.model_routing?.local_wrappers;
  if (!lw?.pins) {
    warnings.push(
      'WARNING V13: system/manifest.json meta.model_routing.local_wrappers.pins is not set - the local wrapper model-pin contract is unenforced (add it to enable V13)'
    );
    return;
  }
  const pins = lw.pins;
  const detNoPin = new Set(lw.deterministic_no_pin || []);
  const scriptsDir = path.join(REPO, 'scripts');
  let files;
  try {
    files = fs.readdirSync(scriptsDir).filter((f) => /^run-.*\.ps1$/.test(f) || f === 'auth-check.ps1');
  } catch (e) {
    failures.push(`FAILED V13: cannot read scripts/ to enforce the wrapper pin contract - ${e.message}`);
    return;
  }

  // The real reasoning-call line: a non-comment line that invokes claude (claude.ps1 / $ClaudeCmd /
  // a bare `claude`) with the -p prompt flag. (mcp-list warmups use `& claude.ps1 mcp list` with no
  // -p, so they are correctly ignored.)
  // Logical lines are joined across backtick continuations, and matching does not require the `&`
  // call operator on the same line, so a PowerShell backtick continuation or a `Start-Process`/
  // bare-command invocation is still read correctly. COVERAGE does not depend on this parser at all
  // - see the declaration-completeness rule below - so a future unparseable call shape can cost a
  // model assertion but can never create an UNDECLARED wrapper.
  const logicalLines = (text) => {
    const out = [];
    let buf = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = buf === null ? raw : `${buf} ${raw.trim()}`;
      if (/`\s*$/.test(line)) {
        buf = line.replace(/`\s*$/, '');
        continue;
      } // PS line continuation
      buf = null;
      out.push(line);
    }
    if (buf !== null) out.push(buf);
    return out;
  };
  const claudeCallLine = (text) => {
    for (const line of logicalLines(text)) {
      if (/^\s*#/.test(line)) continue; // skip comments
      if (!/claude/i.test(line)) continue; // names claude.ps1 / $ClaudeCmd / claude
      if (!/(^|\s)-p(\s|$)/.test(line)) continue; // the prompt flag
      return line;
    }
    return null;
  };
  const modelOf = (line) => {
    const m = line.match(/--model\s+([A-Za-z0-9._-]+)/);
    return m ? m[1] : null;
  };

  for (const f of files) {
    const eff = effective(stagedDir, `scripts/${f}`);
    if (!eff) continue;
    const line = claudeCallLine(eff.text);
    const inPins = Object.hasOwn(pins, f);
    const inDet = detNoPin.has(f);

    // COMPLETENESS, parser-independent: every wrapper the glob finds MUST be declared,
    // whether or not a claude call is detected. This is what makes V13 complete by construction - a
    // new or copied wrapper cannot slip through on a call shape the matcher cannot read.
    if (!inPins && !inDet) {
      failures.push(
        `FAILED V13: scripts/${f} is in NEITHER meta.model_routing.local_wrappers.pins NOR deterministic_no_pin - every scheduled wrapper must be declared (an unlisted wrapper that calls claude inherits the global model default); add it to the contract`
      );
      continue;
    }
    if (inPins && inDet)
      failures.push(
        `FAILED V13: scripts/${f} is declared in BOTH pins and deterministic_no_pin - the contract must say exactly one`
      );

    if (line) {
      if (inDet)
        failures.push(
          `FAILED V13: scripts/${f} is declared deterministic_no_pin but makes a real 'claude -p' call - move it to pins with its model, or the flag is a bug`
        );
      if (!inPins) continue;
      const want = pins[f],
        got = modelOf(line);
      if (!got)
        failures.push(
          `FAILED V13: scripts/${f} 'claude -p' call has no --model (the contract wants ${want}; without it the wrapper inherits the global default)`
        );
      else if (got !== want)
        failures.push(
          `FAILED V13: scripts/${f} pins --model ${got} but meta.model_routing.local_wrappers wants ${want}`
        );
    } else if (inPins) {
      warnings.push(
        `WARNING V13: scripts/${f} is in local_wrappers.pins but has no 'claude -p' call - stale pin entry (remove it, or the wrapper lost its reasoning call)`
      );
    }
  }
  // A pin whose file is ABSENT here AND whose path a `drop` row in system/kit-manifest.json claims
  // is skipped. The online tree ships
  // the registry as is while every scheduled wrapper is a drop row and never exists there, so
  // without this every autosave online printed six V13 lines for files that are absent by design.
  // On a laptop the files exist and are checked exactly as before. A pin naming an absent file that
  // NO drop row claims still FAILS: that is a stale contract, not a dropped one. Silent on purpose:
  // a permanent warning for a by-design absence is the amber-blindness class.
  const dropped = kitManifestDropClaim(stagedDir);
  for (const f of Object.keys(pins)) {
    if (files.includes(f) || dropped(`scripts/${f}`)) continue;
    failures.push(`FAILED V13: local_wrappers.pins names scripts/${f} which does not exist`);
  }
  for (const f of detNoPin) {
    if (files.includes(f) || dropped(`scripts/${f}`)) continue;
    warnings.push(`WARNING V13: local_wrappers.deterministic_no_pin names scripts/${f} which does not exist`);
  }
}

// V14 - Alex gender-neutrality contract: no third-person gendered pronoun refers to Alex in an
//       unpublished post draft. A convention that only an agent remembers to apply is not a gate;
//       this is the same lesson as V6 - expectations live as DATA and are machine-checked, not as
//       prose someone is trusted to have read.
//
//       ONE NARROW SCAN, deliberately not a blanket sweep: EPISODE BODIES of drafts that are NOT yet
//       published. In a post body the only two characters are the owner (I/my) and Alex, so ANY
//       third-person gendered pronoun there is a real violation. High precision by construction.
//
//       WHAT IT DELIBERATELY DOES NOT TOUCH: PUBLISHED episodes (header line carries `status:
//       published`). They are the archive of what actually went out; retro-editing them would make
//       the archive lie.
// The drafts folder this scans is optional: it exists only if the owner writes posts. Absent, the
// scan reports SKIPPED rather than passing, because a scan that ran over nothing is not a pass.
const V14_EPISODES_DIR = 'outputs/drafts';
const V14_PRONOUN_RE = /\b(he|him|his|himself|she|her|hers|herself)\b/i;

function v14AlexGenderNeutrality({ stagedDir }, failures, warnings) {
  // unpublished episode drafts - scan the POST BODY only, never the provenance header.
  const dir = path.join(REPO, V14_EPISODES_DIR);
  if (!fs.existsSync(dir)) {
    warnings.push(`WARNING V14 SKIPPED: ${V14_EPISODES_DIR} not found - the episode gender scan did not run`);
    return;
  }
  for (const abs of listFiles(dir)) {
    if (!abs.endsWith('.md')) continue;
    const rel = path.relative(REPO, abs).replace(/\\/g, '/');
    const raw = effective(stagedDir, rel);
    if (!raw) continue;
    const parts = raw.text.split(/\r?\n---\r?\n/);
    if (parts.length < 2) continue; // no header/body split (plan.md etc.) - not an episode
    const header = parts[0];
    if (/^\s*status:\s*published/im.test(header)) continue; // ARCHIVE - never scanned, never edited
    const body = parts.slice(1).join('\n---\n');
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(V14_PRONOUN_RE);
      if (!m) continue;
      failures.push(
        `FAILED V14: ${rel} body line ${i + 1} uses "${m[0]}" - Alex has no gender. ` +
          `Use the name plus sentence restructuring; "it" is not a ` +
          `substitute. If the pronoun refers to a real third person and not to Alex, rephrase ` +
          `to name them, because a post body cannot distinguish the two: ${lines[i].trim().slice(0, 90)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V15 - command-file state/trigger headers.
//       Every LIVE/EVENT command file must carry the GENERATED CMD-HEADER block, byte-matching what
//       scripts/lib/gen-command-headers.js renders from system/manifest.json.
//
//       WHY: a command file is prose, and nothing else reads its trigger, schedule or method against
//       the registry, so it can drift from system/manifest.json silently. check.ps1 C1/C2 and V7 read
//       .claude/commands, but only for file EXISTENCE, ownership and NAMES; this is the one leg that
//       reads content. The manifest renders the block; the file is asserted to contain that exact
//       block, never the other way around, so the check can never infer intent from the prose it is
//       checking.
//
//       TIER: WARNING for its first cycle by design. An ERROR-tier check with a false positive blocks
//       the nightly 21:30 commit and pushes the backup RED, so it observes before it blocks. Promote by
//       moving the push below from `warnings` to `failures`.
// ---------------------------------------------------------------------------------------------
function v15CommandHeaders({ stagedDir, manifest }, _failures, warnings) {
  let genCmdHeaders;
  try {
    genCmdHeaders = require('../gen-command-headers');
  } catch (e) {
    warnings.push(`WARNING V15 SKIPPED: gen-command-headers module unavailable (${e.message})`);
    return;
  }

  const missing = [],
    stale = [];
  for (const t of genCmdHeaders.targets(manifest)) {
    const f = effective(stagedDir, t.rel);
    if (!f) continue; // C1 already fails a declared-but-absent command file; V15 does not double-report
    const want = genCmdHeaders.block(t);
    const bi = f.text.indexOf(genCmdHeaders.BEGIN),
      ei = f.text.indexOf(genCmdHeaders.END);
    if (bi === -1 || ei === -1) {
      missing.push(t.rel);
      continue;
    }
    const have = f.text.slice(bi, ei + genCmdHeaders.END.length);
    if (have !== want) stale.push(`${t.rel} (state/trigger no longer matches #${t.project.num} in the registry)`);
  }
  if (missing.length)
    warnings.push(
      `WARNING V15: LIVE/EVENT command file(s) missing the generated CMD-HEADER block: ${missing.join(', ')} - run 'node scripts/generate-alex.js'`
    );
  if (stale.length)
    warnings.push(
      `WARNING V15: command header(s) drifted from system/manifest.json: ${stale.join('; ')} - run 'node scripts/generate-alex.js' (never hand-edit between the markers)`
    );
}

// ---------------------------------------------------------------------------------------------
// V18 - shipped executables and command files: six legs over surfaces no other checker reads.
//
//       WHY: the manifest has a checker, the docs have a checker, the vault links have a checker; the
//       .cmd files, the command-file prose and the relative markdown links have none. That gap is
//       exactly where a shipped defect hides longest: a stray control byte, a guard that prints a
//       warning and carries on anyway, a command or a project path that does not exist.
//
//       Six legs (a) through (f) below, each guarding a surface no other leg reaches:
//         (a) CONTROL BYTES. A .cmd file is executed by a parser with no syntax checking worth the
//             name; a stray byte inside a path produces a silent no-op, and output is usually
//             redirected to a log nobody reads.
//         (b) NON-TERMINATING GUARDS. `exit /b 1` inside a CALLed label pops the subroutine and
//             returns. Any `call :<label>` whose label ends in `exit /b 1` and is not immediately
//             followed by its own exit is a guard that does not guard.
//         (c) DANGLING COMMANDS. A /command named in a shipping file must exist as a command file.
//             The product teaches its users that "unknown command" means they opened the wrong
//             folder, so naming a command that does not exist manufactures the single most
//             confusing failure the product has.
//         (d) CUT-PROJECT PATHS. A shipping file must not point at a work/ or vault/projects/ path
//             belonging to a project that is not in the registry: a rule or a gate sourced from a
//             deleted project has lost its source and nobody notices.
//         (e) DEAD RELATIVE LINKS. A [text](file.md) link under docs/ must resolve to a real file: a
//             broken one fails silently for the reader, who finds nothing and trusts the page a
//             little less.
//         (f) UNPARSEABLE POWERSHELL (win32 only). Every .ps1 this product ships must parse: a script
//             that cannot parse never runs and never reaches its own failure reporting, so it fails
//             SILENTLY.
// ---------------------------------------------------------------------------------------------
const V18_CMD_EXT = new Set(['.cmd', '.bat']);
const NEWLINE_RE = /\r?\n/;
const MD_LINK_RE = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
const EXTERNAL_URL_RE = /^[a-z]+:\/\//i;

// Claude Code ships these; this repo does not define them and must not be asked to.
// `skills` and `schedule` are here because the housekeeping Routine
// snapshots the claude.ai skills list, and the routines doc names the CLI's custom-cron path.
const V18_BUILTINS = new Set([
  'mcp',
  'voice',
  'clear',
  'help',
  'login',
  'logout',
  'config',
  'doctor',
  'compact',
  'resume',
  'agents',
  'plugin',
  'review',
  'init',
  'model',
  'cost',
  'memory',
  'terminal-setup',
  'vim',
  'permissions',
  'add-dir',
  'bug',
  'exit',
  'quit',
  'skills',
  'schedule',
  // web-setup is the Claude Code built-in that stores a GitHub token at Anthropic. The Virtual Alex
  // /setup names it in order to say NEVER use it, and a name that is a warning has to
  // resolve, or the warning itself reads as a dangling command.
  'web-setup'
]);
// Command-line switches that a slash-command regex cannot tell from a command.
const V18_CLI_SWITCHES = new Set([
  'change',
  'query',
  'create',
  'xml',
  'one',
  'inheritance',
  'grant',
  'sc',
  'st',
  'mo',
  'tn',
  'tr',
  'delay',
  'b',
  'v',
  'c',
  'f',
  'd',
  'g',
  'i',
  'e',
  's',
  'n',
  'p',
  'silent',
  'accept-package-agreements',
  'accept-source-agreements',
  'fo',
  'nul',
  'dev'
]);

function v18ShippedExecutables({ stagedDir, manifest }, failures, warnings) {
  // TWO command trees. The Kit's own .claude/commands/ is the laptop set, and
  // variants/online/.claude/commands/ carries the online variant's: a file there lands at its real
  // path in the generated template, so a name that resolves in either tree is a real command
  // somewhere this product runs. The first online-only command is /alex-status, which exists
  // because the claude.ai web session has a built-in /status of its own that swallows Alex's.
  // Reading one tree would have made every mention of it read as a dangling command.
  const cmdDirs = [
    path.join(REPO, '.claude', 'commands'),
    path.join(REPO, 'variants', 'online', '.claude', 'commands')
  ];
  const commandNames = new Set(
    cmdDirs
      .flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d) : []))
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
  );

  // ---- (a) control bytes in ANY shipped text file ---------------------------------------------
  // Deliberately NOT limited to .cmd: a stray control byte can land in a path inside an installer
  // script or inside a JavaScript regular expression just as easily, where it collapses a word
  // boundary into a literal backspace character. Both look perfectly correct in an editor and in
  // `cat`. A control byte is invisible in every normal view and changes behaviour silently, which
  // makes it precisely the kind of defect that only a machine will ever find.
  const textExt = new Set(['.cmd', '.bat', '.js', '.ps1', '.py', '.json', '.md', '.sh']);
  const scanCtrl = (abs, rel) => {
    const raw = fs.readFileSync(abs);
    const bad = [];
    for (let i = 0; i < raw.length; i++) {
      const b = raw[i];
      if (b < 9 || (b >= 11 && b <= 12) || (b >= 14 && b <= 31)) {
        bad.push(`byte 0x${b.toString(16)} at offset ${i}`);
        if (bad.length >= 3) break;
      }
    }
    if (bad.length)
      failures.push(
        `FAILED V18: ${rel} contains control byte(s) (${bad.join(', ')}) - almost always a backslash escape eaten by whatever wrote the file. It is invisible in an editor and it changes behaviour silently.`
      );
  };
  const walkCtrl = (absDir, relDir) => {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.agents' || e.name === '.claude') continue;
      const abs = path.join(absDir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walkCtrl(abs, rel);
        continue;
      }
      if (textExt.has(path.extname(e.name).toLowerCase())) scanCtrl(abs, rel);
    }
  };
  walkCtrl(REPO, '');

  // ---- (f) EVERY .ps1 must PARSE ------------------------------------------------------------------
  // Leg (a) scans for control bytes and must exclude 0x0A/0x0D or it would flag every newline. That
  // is a structural hole: when an eaten escape lands on a NEWLINE instead of a control byte, leg (a)
  // cannot see it, and a script can stop parsing (or parse into something legal but wrong) with no
  // signal at all - a job that dies on its first line never reaches its own failure reporting.
  // The generic instrument is to ASK THE PARSER instead of pattern-matching for known corruptions.
  // Nothing else in this system asks its own parser this way either - there is no `node --check`
  // sweep and no `py_compile` pass anywhere in these scripts or workflows. PowerShell is the one leg
  // that does, because it is where every .ps1 in this system runs unattended. Windows-only by nature;
  // skipped elsewhere.
  if (process.platform === 'win32') {
    const psFiles = [];
    const walkPs = (absDir) => {
      for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const abs = path.join(absDir, e.name);
        if (e.isDirectory()) {
          walkPs(abs);
          continue;
        }
        if (path.extname(e.name).toLowerCase() === '.ps1') psFiles.push(abs);
      }
    };
    walkPs(REPO);
    if (psFiles.length) {
      const listFile = path.join(os.tmpdir(), `alex-v18-ps-${process.pid}.txt`);
      fs.writeFileSync(listFile, psFiles.join('\n'), 'utf8');
      try {
        // -Encoding UTF8: this list is written as UTF-8, and Windows PowerShell 5.1's Get-Content
        // otherwise reads a BOM-less file in the ANSI code page, mojibaking a non-ASCII repo path.
        const ps =
          `$bad=@(); foreach($f in (Get-Content -Encoding UTF8 -LiteralPath '${listFile.replace(/'/g, "''")}')) { ` +
          `$e=$null;$t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f,[ref]$t,[ref]$e); ` +
          `if($e.Count){ $bad += ($f + ' line ' + $e[0].Extent.StartLineNumber + ': ' + $e[0].Message) } }; ` +
          `$bad -join "\`n"`;
        const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024
        }).trim();
        if (out) {
          for (const line of out
            .split('\n')
            .map((s) => s.replace(/\r$/, ''))
            .filter(Boolean)) {
            failures.push(
              `FAILED V18: PowerShell parse error - ${line.replace(REPO, '').replace(/^[\\/]/, '')}. ` +
                `A .ps1 that does not parse never runs, and never reaches its own failure reporting, so it fails SILENTLY.`
            );
          }
        }
      } catch (e) {
        warnings.push(
          `WARNING V18: could not run the PowerShell parse sweep (${String(e.message).slice(0, 120)}) - ${psFiles.length} .ps1 file(s) unchecked`
        );
      } finally {
        try {
          fs.unlinkSync(listFile);
        } catch (_) {
          /* best effort */
        }
      }
    }
  }

  // ---- (b) non-terminating guards in the .cmd files ---------------------------------------------
  for (const f of fs.readdirSync(REPO)) {
    if (!V18_CMD_EXT.has(path.extname(f).toLowerCase())) continue;
    const abs = path.join(REPO, f);
    const text = fs.readFileSync(abs).toString('utf8');
    const lines = text.split(/\r?\n/);

    // A label that ends in `exit /b 1` is a failure path. Reaching it with CALL returns to the
    // caller and the script carries on, which is the defect. Require `goto :<label>` instead.
    const failLabels = new Set();
    let current = null;
    for (const line of lines) {
      const lab = line.match(/^\s*:([A-Za-z_][A-Za-z0-9_]*)\s*$/);
      if (lab) {
        current = lab[1];
        continue;
      }
      if (current && /^\s*exit\s*\/b\s*[1-9]/i.test(line)) failLabels.add(current);
    }
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*call\s+:([A-Za-z_][A-Za-z0-9_]*)/i);
      if (!m || !failLabels.has(m[1])) continue;
      const next = (lines[i + 1] || '').trim();
      if (!/^exit\s*\/b\s*[1-9]/i.test(next) && !/^goto\s+:/i.test(next))
        failures.push(
          `FAILED V18: ${f}:${i + 1} uses \`call :${m[1]}\`, but :${m[1]} is a failure path ending in \`exit /b\`. \`exit /b\` inside a CALLed label RETURNS to the caller, so this guard prints its warning and then carries on. Use \`goto :${m[1]}\`, or follow the call with its own \`exit /b 1\`.`
        );
    }
  }

  // ---- (e) relative markdown links in docs/ resolve --------------------------------------------
  // C6 covers [[wiki links]] inside the vault; nothing else covers an ordinary [text](file.md) link
  // under docs/, the human-readable layer a non-technical owner is most likely to open. A dead link
  // does not error: the reader simply finds nothing and quietly trusts the system a bit less.
  const walkDocs = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        walkDocs(a, r);
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      const lines = fs.readFileSync(a, 'utf8').split(NEWLINE_RE);
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(MD_LINK_RE)) {
          const target = m[1];
          if (EXTERNAL_URL_RE.test(target)) continue;
          if (!fs.existsSync(path.resolve(path.dirname(a), target)))
            failures.push(`FAILED V18: ${r}:${i + 1} links to '${target}', which does not exist`);
        }
      }
    }
  };
  walkDocs(path.join(REPO, 'docs'), 'docs');

  // ---- (c) + (d): the shipping markdown surfaces ------------------------------------------------
  const liveWorkDirs = new Set(manifest.projects.map((p) => (p.work_dir || '').replace(/\\/g, '/')));
  const liveStatus = new Set(manifest.projects.map((p) => (p.status_md || '').replace(/\\/g, '/')));
  const utility = new Set(manifest.meta.utility_commands || []);
  const known = new Set([...commandNames, ...utility]);

  // EACH PAGE AGAINST THE WORLD IT SHIPS TO. A plain union
  // would let a laptop-only page name /alex-status and an online-only page name /cron-setup. In the
  // Kit (variants/online present) three sets now apply: a page under variants/online/ is online-only
  // and resolves against the ONLINE commands (the Kit's own minus the drop rows, plus the variants);
  // a Kit page that a drop row or a variant replaces is laptop-only and resolves against the LAPTOP
  // commands; a page shipped to both keeps the union, because it speaks to both worlds (update.md
  // tells a laptop owner to stop and double-click instead). A generated tree has one set: `known`.
  const variantsDir = path.join(REPO, 'variants', 'online');
  const inKit = fs.existsSync(variantsDir);
  const dropped = kitManifestDropClaim(stagedDir);
  const namesIn = (d) =>
    (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  const laptopKnown = new Set([...namesIn(cmdDirs[0]), ...utility]);
  const onlineKnown = new Set([
    ...namesIn(cmdDirs[0]).filter((n) => !dropped(`.claude/commands/${n}.md`)),
    ...namesIn(cmdDirs[1])
  ]);
  const knownFor = (rel) => {
    if (!inKit) return { set: known, world: 'in this system' };
    if (rel.startsWith('variants/online/')) return { set: onlineKnown, world: 'online, where this page ships alone' };
    if (dropped(rel) || fs.existsSync(path.join(variantsDir, rel)))
      return { set: laptopKnown, world: 'on a laptop, where this page ships alone' };
    return { set: known, world: 'in either world' };
  };

  const surfaces = [];
  const pushDir = (rel, recurse) => {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (recurse) pushDir(r, recurse);
        continue;
      }
      if (e.name.endsWith('.md')) surfaces.push(r);
    }
  };
  pushDir('.claude/commands', false);
  pushDir('work', true);
  surfaces.push('CLAUDE.md');
  if (inKit) {
    // the online-only pages, read against the online commands (they were not read at all before)
    pushDir('variants/online/.claude/commands', false);
    surfaces.push('variants/online/CLAUDE.md');
  }

  for (const rel of surfaces) {
    const eff = effective(stagedDir, rel);
    if (!eff) continue;
    const { set: pageKnown, world } = knownFor(rel);
    const lines = eff.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(#|>)?\s*(RETIRED|CUT|removed)\b/i.test(line)) continue;

      // (c) every /command token must resolve
      for (const m of line.matchAll(/(?:^|[\s(`"'*])\/([a-z][a-z0-9-]{2,})\b/g)) {
        const name = m[1];
        if (pageKnown.has(name)) continue;
        // Claude Code's own built-ins are real commands that this repo does not define. They are
        // listed rather than pattern-matched, because "anything I do not recognise is probably a
        // built-in" is how a checker learns to pass.
        if (V18_BUILTINS.has(name)) continue;
        // CLI switches read as commands to a regex: `schtasks /change`, `icacls /grant`, `/sc DAILY`.
        // A switch is preceded by a command word on the same line, so require the token to start a
        // line or follow punctuation that a prose mention would use.
        if (V18_CLI_SWITCHES.has(name)) continue;
        // An absolute POSIX path is not a command. A slash command has exactly one slash
        // (/cron-setup); a path has another one right after the first segment (/var/db/...,
        // /usr/local/bin, /Library/LaunchAgents). The Kit runs on macOS too,
        // so absolute POSIX paths appear in its docs, and backticks are in the allowed prefix
        // set above - so every one of them would read as an unknown command without this skip.
        // Narrow on purpose: it
        // skips ONLY when a slash follows immediately, which no real command reference does.
        if (line[m.index + m[0].length] === '/') continue;
        // A line saying the command does not exist is warning the reader off it, never telling them
        // to type it (the online constitution: "`/cron-setup` does not exist here"). Narrow on
        // purpose: the exact backticked name followed by "does not exist".
        if (line.includes(`\`/${name}\` does not exist`)) continue;
        if (/\.(md|json|js|ps1|cmd|py|txt)$/.test(name)) continue;
        failures.push(
          `FAILED V18: ${rel}:${i + 1} names \`/${name}\`, which is not a command ${world}. Telling a user to type a command that does not exist produces "unknown command", and this product teaches its users that "unknown command" means they opened the wrong folder.`
        );
      }

      // (d) no path belonging to a project that is not registered
      for (const m of line.matchAll(/\b(work\/[0-9]{2}-[a-z0-9-]+)/g))
        if (!liveWorkDirs.has(m[1]))
          failures.push(
            `FAILED V18: ${rel}:${i + 1} points at \`${m[1]}\`, which is not a project in system/manifest.json`
          );
      for (const m of line.matchAll(/\b(vault\/projects\/[a-z0-9-]+\/status\.md)/g))
        if (!liveStatus.has(m[1]))
          failures.push(
            `FAILED V18: ${rel}:${i + 1} points at \`${m[1]}\`, the status page of a project that does not exist here. If that pointer carries a RULE, the rule now has no source.`
          );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// V19 - Routine prompt files bound to the registry.
//       Online the scheduler is five Routines on the owner's claude.ai account, each a form whose
//       prompt is one line pointing at a committed file under scheduler/routines/. The rows in
//       system/manifest.json routines[] are what the generator renders into docs/ROUTINES-FORMS.md
//       and what the weekly sweep (work/18-recovery-layer/check.mjs) reads back against the run
//       log. A prompt file with no row is an order nobody scheduled and nobody checks; a row naming
//       a missing file is a form that points at nothing and a Routine that fails on its first
//       line. Both FAIL. The row shape is gen-routines.js's own contract (routineRows), so the
//       generator and this leg cannot disagree about what a row must carry. Pure file reads, every
//       context. A drift leg under CLAUDE_CODE_REMOTE (REMOTE_DRIFT_LEGS): scheduler/routines/ is
//       identity-denied in every unattended session, so an orphan there is an owner's edit, and an
//       autosave is never blocked on it; the persisting one is the weekly sweep's to name.
// ---------------------------------------------------------------------------------------------
function v19RoutinePrompts({ manifest }, failures, warnings) {
  let rows;
  try {
    rows = routineRows(manifest);
  } catch (e) {
    failures.push(`FAILED V19: system/manifest.json routines[] is malformed - ${e.message}`);
    return;
  }
  const dir = path.join(REPO, ...ROUTINES_DIR.split('/'));
  const onDisk = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => `${ROUTINES_DIR}/${f}`)
    : [];
  const named = new Set(rows.map((r) => r.prompt_file));
  for (const r of rows) {
    if (!fs.existsSync(path.join(REPO, ...r.prompt_file.split('/'))))
      failures.push(
        `FAILED V19: routines[] row "${r.name}" names ${r.prompt_file}, which does not exist - a form pointing at a missing file is a Routine that fails on its first line`
      );
  }
  for (const f of onDisk) {
    if (!named.has(f))
      failures.push(
        `FAILED V19: ${f} has no routines[] row in system/manifest.json - a prompt file nobody scheduled is an order nobody checks; add the row (${['name', 'prompt_file', 'preset', 'time_local', 'cadence_hours', 'environment', 'connectors', 'repositories', 'model', 'first_run_check'].join(', ')}) or remove the file`
      );
  }
  const def = manifest.meta?.model_routing?.default;
  for (const r of rows) {
    if (def && r.model !== def)
      warnings.push(
        `WARNING V19: routines[] row "${r.name}" carries model ${r.model} while meta.model_routing.default is ${def} - a deliberate override is allowed, an accidental one is the cost-leak class V13 exists for`
      );
  }
}

module.exports = {
  kitManifestDropClaim,
  v13LocalWrapperPins,
  v14AlexGenderNeutrality,
  v15CommandHeaders,
  v18ShippedExecutables,
  v19RoutinePrompts
};
