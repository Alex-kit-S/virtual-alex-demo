# The code standard

This is the bar every file of Alex's own code is written to and scored against. It is not advice. Every
item below is either enforced by a pinned tool, measured by a command written here, or scored by a
reviewer against a rule written here, and each item says which of the three it is.

**Scope.** Alex's own code that ships in the online tree: the set
`node harness/inventory.mjs --tree <kit> --summary` reports, which asks the builder's own `planTree`
what a recruiter receives. At `work/pro-rewrite` `24dd6f3` that is **173 files, 37,969 lines**: 156
JavaScript (34,543), 10 Python (2,379), 4 shell (644), 2 CI workflows (299), 1 settings file (104).
The rewrite drops 23 of them from the online tree before any code is rewritten (the plan's wave D), so
the set this standard scores is **150 files, 34,492 lines**.

**Not in scope, and why.** The vendored skills under `.agents/skills/` are third-party and stay
upstream; every tool config below excludes them by an explicit line with the reason. Kit code that is a
`drop` row in `system/kit-manifest.json` (the launchers, the 22 `.ps1` local wrappers, the fleet
scripts, the donor scrub, and after wave D the recall spine and five more) is outside this standard,
but **the calls it makes into in-scope code are frozen** and this standard never licenses breaking one.

---

## 1. The file header: WHAT, HOW, NEVER

Every code file opens with it. The shape comes from `scripts/build-online-template.mjs`'s header, which
today overruns the 40-line window below (its `NEVER.` is at line 70); wave 9 brings it inside, and until
then it is not the model for length. This section is the first time the shape is written down.

```
#!/usr/bin/env node
// scripts/<path> - one line saying what this file IS, in the smallest true words.
//
// WHAT. What it does for an owner, in plain sentences. Not the implementation. A reader who does not
// know this system must be able to decide from WHAT alone whether this file is the one they want.
//
// HOW. The mechanism, in the order the code runs it. Name the inputs it reads and the outputs it
// writes, by path. Name every rule that is not obvious from the code. This is where a WHY belongs
// when a reader would otherwise "fix" something deliberate.
//
// NEVER. What this file must not do, and what it refuses. A guard, a fail-closed rule, a path it must
// not write, a system it must not reach. If there is nothing, write the line anyway and say so.
//
// Usage: <the exact command line, or "module only">
// Exit: 0 <meaning> - 1 <meaning> - 2 <meaning>          (omit for a module with no CLI)
```

Rules:

- The three words are capitalised and followed by a full stop, so they are greppable.
- **In Python the header IS the module docstring**, with the same three paragraphs and the same two
  closing lines. In shell and YAML the comment marker is `#`; nothing else changes.
- **JSON files carry no header.** JSON has no comments, and the one JSON file in scope,
  `variants/online/.claude/settings.json`, is read by Claude Code, where a comment is a syntax error and
  a headless run skips the broken file, which would remove every online hook at once. JSON files are
  scored on the other items only.
- **`Usage:` and `Exit:` are mandatory on any file with a CLI**, because the exit codes are a contract
  other programs read (section 5).
- A test file's header additionally states **what it would let through if it were deleted**. A test
  whose header cannot answer that is testing nothing.
- The header's `NEVER.` paragraph is the only place a date, an incident or a finding id may appear, and
  only when the code would otherwise be "corrected" back into a defect. The checker exempts exactly that
  paragraph: from the header line that opens with `NEVER.` to the first blank header line, `Usage:` or
  `Exit:`. See trash item 4.
- **A header must not carry a token a test asserts is absent.** `test-heartbeat-check.mjs:230,:274`
  asserts that `heartbeat.yml` contains neither `startsWith(github.repository` nor `contents: write`,
  and it matches comment text too, so a `NEVER.` line that names either fails the test.

**Measurement (checker).** A file passes when its first 40 lines (or its module docstring) contain
`WHAT.`, `HOW.` and `NEVER.`. In the 150-file scope, **112 of the 149 files that must carry one do
not** (109 JavaScript, shell and CI files, and 3 Python). Target 0.

**Measurement (checker), CLI files.** A file with a command line (a shebang, a `require.main` guard, an
identifier named `isMain` (outside `scripts/lib/errors.js`, which defines it) or `invokedDirectly`, `process.argv[1]` compared in one statement with the
module's own `import.meta.url`, `import.meta.filename` or `__filename`, a Python `__main__` block, or any
shell script) also carries `Usage:` and `Exit:` in the same window or docstring (the `header-cli` leg).
In the 150-file scope, 124 do not. Target 0.

---

## 2. The trash list, with a measurement for each item

"Looks professional" ends as a number. Each row says how the number is produced. **Tool** means a
pinned binary fails the build. **Checker** means `scripts/tests/test-code-standard.mjs` (section 9.7)
prints the count. **Review** means a named human rule a reviewer scores against, because no tool can
see it. Every checker leg is shown FAILING on a planted violation before its count is trusted.

| # | Trash | How it is measured | Today (150-file scope) | Target |
|---|---|---|---|---|
| 1 | Dead code: unused imports, variables, parameters, exports, unreachable branches, whole files | **Tool** `biome lint` (`noUnusedVariables`, `noUnusedImports`, `noUnusedFunctionParameters`, `noUnusedPrivateClassMembers`); `ruff` (`F401`, `F841`, `ARG`). **Checker** for exports and files: the `L2.json` census (section 3.5), which reads `.cmd`, `.command`, `.md`, `.sh`, `.ps1`, shell heredocs and dynamic `path.join` requires as loaders, because a scan of `.js` files alone missed every launcher and command-file caller | JS 10 (8 unused variables, 2 unused imports); Python 0 under `F`; 52+ unimported exports across three read slices, to be re-counted against `L2.json` | 0 |
| 2 | Commented-out code | **Tool** `ruff` rule `ERA001` for Python. **Checker** for JS: comment bodies that compile under `new Function()` as a function body, plain or async, or are an `import` or `export` declaration; that are longer than three tokens; and that carry one mark only code carries (`=`, `=>`, `;`, `{`, `[`, `===`, `!==`, `+=`, `-=`, `&&`, `\|\|`, `??`, `?.`, or a statement keyword: `const let var function return if for while throw await new class require typeof delete`) or are one call written as code writes it (the callee against its `(`). A run of line comments, and a block comment, are judged whole first, then line by line, blank lines never counted. The file's header (every comment before its first line of code, after a `'use strict'` prologue) and every JSDoc block are documentation and are not read. A tool directive is not code: `biome-ignore`, `eslint-`, `@ts-`, `portability-ok`, `secret-scan:`, `contract:`, `jshint`, `istanbul`, `c8`, `node:coverage`, and `global` followed by a bare list of names | `ERA` clean on the 10 Python files; JS 0 (the 7 counted at A1's first measure were usage examples and data shapes in headers) | 0 |
| 3 | Debug leftovers: a print that is not the program's real output | **Checker, not a tool.** `ruff`'s `T20` is deliberately NOT enabled: in `scripts/vault_search.py` every `print` IS the program's output. The measurement is the scenario harness: a stray print changes stdout and `harness/compare.mjs` reports it | n/a | every diff explained |
| 4 | Diary comments: dates, run and seat numbers, finding ids, incident stories | **Checker** over **comment bodies AND Python docstrings** (module, class and function), matching `\b(20\d\d-[01]\d-[0-3]\d\|R\d+-\d+L?\|C[1-5]-N\d\|HF[1-4]\|seat \d\|fleet seat\|finding F?\d+)\b`. The Python half uses Python's own `tokenize` and `ast` through a small stdlib helper, never a line regex, because a docstring is a string literal and a comment-only scan certifies it clean. A trailing comment counts like a full-line one. Exempt: string literals that are not docstrings, fixtures, the frozen migration text, the contract lines in section 8, a well-formed contract tag line, and the header's `NEVER.` paragraph (section 1) | **403 lines** in the 150-file scope at the A1 landing (450 in the 181 files the checker scores there; 401 and 447 at `77b9ed8`, before template 43's hotfix brought three dated comments, which the ratchet's two raise rows name): 388 in JavaScript, shell and CI comments, 15 in Python (8 in `#` comments, 7 in docstrings, two of them in `vault_search.py`'s own module docstring) | 0 |
| 5 | Dangling references: a comment naming a script that does not exist | **Checker** over comment bodies, for paths ending `.js .mjs .cjs .py .sh .ps1`, resolved exactly, folder by folder and in the same case, against `git ls-files`, the manifest's paths and the working tree; a path written with `\` counts; a path written from inside a folder resolves, one that only ends with a real path does not. Data paths created at run time are not dangling and are excluded by extension. `portability-check.mjs` P6 is a DIFFERENT check: it fails only on a `node scripts/...` call to a missing file (`:252`), so it cannot see a dangling `python scripts/...` call at all, which this leg covers | **7**: `scripts/generate-surfaces.ps1` (`lib/gen-routing-table.js:2`), `scripts/lib/json-writer.ps1` (`tests/test-json-writer.js:10`), `scripts/notify-run-status.ps1` (was in `lib/gen-scheduler.js`, gone since `671a1de`), `work/voice/alex_voice.py` (`capture-typed-input.js:7`), `work/voice/explainer/make-explainer.py` (`outputs-ledger.js:43`), and two paths into the donor repository, `personal-os/scripts/bootstrap.mjs` (`bootstrap.mjs:3`) and `personal-os/scripts/tests/portability-check.mjs` (`portability-check.mjs:4`). In prose, `scripts/skills-installer.js` is named in three shipped documents and does not exist | 0 |
| 6 | Duplication | **Checker**. One leg per concern, the fourteenth measured as eight sub-legs, 21 legs in all, defined in `CONCERNS` in `scripts/tests/code-standard.mjs` with the home each moves to (none yet for exit 2, `lastline` and `MAX_BLOB_BYTES`). Each leg reads the code bodies of in-scope files that are not test files or fixtures (a helper under `scripts/tests/` that is not a test counts), except concern 7, which reads only test files; comments, test files, fixtures, dropped code and the concern's own home are excluded, and so is a copy the concern sanctions: its `sanctioned` map names the file with the reason it cannot take the home (a file that must load copied alone, a hook entry under 3.6, a designed load isolation the home would break, a different input the home does not serve, or an adoption the detector's pattern cannot see). A copy counts in any spelling a pattern or detector names. A grep over the tree is not a counter: it counts tests, comments, dropped code and the home itself | 21 legs, each file's copy recorded as a ceiling in the ratchet file | one home each, or two copies with a byte-parity test and a stated reason |
| 7 | Inconsistency: exit codes, streams, error handling, headers | **Tool + review.** Format by `biome` and `ruff format`; the exit-code and stream table in section 5, scored per file against its own `Exit:` line | see section 5.2's measured list | one table, every exception named |
| 8 | Donor traces, personal data, em-dashes, AI slop in comments | **Tool** the repository's own walls (`scripts/clone-scrub-check.js`, `scripts/personal-data-scan.js`, `scripts/secret-scan.mjs`, `scripts/employer-data-guard.mjs`) plus a dash scan. **Review** for slop, against `soul.md`'s Detection-proofing list | 0 em-dashes. 1 en-dash, in `narrative-drift-check.py:246` inside a regex, where it is data; it leaves with that file in wave 1 | 0 prose dashes; a dash inside a pattern is written as an escape |

**A comment names a function, a test or a contract tag, never a bare line number: a line number
outside a `contract:` tag is a review finding.** No leg can tell whether such a pointer is still true,
only that it exists; the checker's own contract leg already proves every tagged line, and a bare
number anywhere else just rots the first time the code around it moves. Header truth (item 6's "a
reviewer... finds nothing in the body they would have to ask about") stays score item 6, a review item,
not a count.

Nothing in this list licenses deleting a guard. **Guard-class code is never deleted as dead without
the master's ruling**: a guard that has never fired looks exactly like dead code, and
`REWRITE-PLAN.md` section 10.5 lists the guards that cannot fire where they sit and are correct.

---

## 3. Naming, modules and hook entries

### 3.1 The module split stays, and it has one consequence people get wrong

`.js` is CommonJS at its path. `.mjs` is ESM. A new file is `.mjs` unless something requires
otherwise. Launchers and the previous release's `/update` text `require()` `.js` files by path
(`Update-Alex.cmd:137`, `Update-Alex.command:133`, `.claude/commands/update.md:280`), which is why the
split is a ruling and not a preference.

**A module needed by both module systems is written as `.js` CommonJS.** An `.mjs` file imports it by
path and gets its named exports (verified: `import { repoRoot } from './lib/repo-root.js'` resolves).
**Never the reverse.** `require()` of an `.mjs` module works only from Node 22.12, and TypeScript under
`nodenext` accepts it, so neither Node nor `tsc` refuses it on the machine that writes the code. The
checker's `module-split` leg is what refuses it: any `require(` of a `.mjs` path inside a `.js` file
fails the build.

### 3.2 Names

- **One word per concept, everywhere.** The repository root is `repoRoot()` and the constant is
  `REPO`. Not `ROOT`, not `HERE`. **One carve-out, by the census:** the builder's `KIT` is imported by
  name by the fleet (`new-virtual-alex.mjs`), so it stays `KIT`.
- A file name says what the file is, in lower kebab case. A `lib/` module is named for the noun it owns,
  a top-level script for the verb it performs.
- **Nothing on the caller census is renamed**, changes extension, or changes its output (section 3.5).
- No abbreviation a reader must decode. Long-standing census names stay: `V_MAX`, the `G1-G4` and
  `V1-V21` leg ids.

### 3.3 Function and file size

- A function does one thing and its name says which. If the name needs "and", it is two functions.
- **A pure core with a thin shell is the target shape for every CLI**: parse, call, map the result to
  an exit code and an output line. `evaluateProtectedChangeset` at `lib/validate/commit.js:219-256` is the
  existing example.
- No hard line limit. The limit is the header: if `HOW.` cannot describe the file in a paragraph, the
  file is doing two jobs.

### 3.4 Constants and configuration

- A number or string that means something gets a named constant with the meaning in its name, at the
  top of the file, and the header says if another file holds the same value.
- **A value duplicated across two languages or two shells is a documented contract, not a shared
  constant.** `MAX_BLOB_BYTES = 10485760` lives in `autosave.sh:70` and in both pre-commit hooks; the
  rule is a test that compares the three, not a fourth copy.
- No magic path. Every path an in-scope file reads or writes is a constant resolved from `repoRoot()`
  or from an environment variable the header names.

### 3.5 The L2 surface is a published list, not a directory

A file is L2 (frozen by path and export name; its arguments, exit codes and output are frozen by the
scenario harness) when a caller the rewrite may not change reaches it: a hook, a Routine prompt, a
command file, a launcher, a git hook, a CI step, a `node -e` by path, dropped Kit code, a shell
heredoc, or a dynamic `require(path.join(...))`. That is not the same as "a top-level script":
`scripts/lib/install-state.js` (`stamp`, from both launchers and `update.md:280`), `json-writer.js`
(`readJson`/`writeJson` from the fleet, `jsonlRow` from the heredoc at `close-out-online.sh:205`),
`write-lock.js`, `radar-feeds.js`, `skill-state.js`, `system/recall/lib/lessons.js` and
`build-soul-core.js` (a hook CLI, and migration 001's dynamic require at
`001-structural-voice-tells.js:178`) are all L2.

**`docs/L2.json`**, written by `node scripts/tests/test-l2-surface.mjs --write --census <folder>`, lists
every L2 file with the export names its frozen callers are shown to use (which can be fewer than the names
prose cites), and every frozen caller with the arguments it passes and what it reads back.
`test-l2-surface.mjs` asserts every listed file is at its path and every listed name resolves in the
module system its callers use, each probe its own node child. **L2.json freezes paths and export names;
the scenario harness freezes arguments and output.** A file or name leaves `docs/L2.json` only with an
unfrozen row (`--unfreeze l2:<path>[#<name>]`), and the checker's direction leg fails the change
otherwise.

### 3.6 Hook entries load nothing that can fail at require time

Claude Code's hook contract: exit 2 blocks, and **any other non-zero exit is a non-blocking error: the
action proceeds.** So a require-time throw in a hook entry (a typo in a shared module, a path that did
not ship) exits 1, and for the untrusted-lane guard that means every tool call in every untrusted lane
is allowed, with every test green, because the tests run the happy module graph.

- A hook entry imports **builtins only** at top level.
- A shared module is loaded inside a `try`. A load failure maps to **exit 2 when the lane gate is armed**
  (the guard), and to **a silent exit 0** in a prompt hook (`capture-typed-input.js`,
  `recall-inject.js`), where a non-zero exit erases or delays the owner's prompt.
- Guard class: a negative test deletes the shared module in a temp copy, sends a payload the guard must
  block, and asserts exit 2.

---

## 4. Errors

- **An error says what failed, what it was given and what to do.** `install-state.js:136-141` is the
  shape. This applies to every error path a wave writes or rewrites. **An error path a test pins as it
  is today stays as it is** until the defect ledger schedules its fix: `vault_search.py`'s uncaught
  tracebacks, which C1 asserts by shape, are KEEP. **The defect ledger is `scripts/tests/code-standard-
  ratchet.json`'s FIX list and pinned-assertion snapshot** (section 9.7): the FIX list names which id
  schedules which defect's fix and for which wave, and the snapshot is every pin the checker currently
  holds. Both ship with the Kit, unlike a rewrite's own planning document, so a reader on any machine
  can resolve the phrase by reading the one file it names.
- **A refusal is a class, not a string.** `Refusal` exists in three `.mjs` files; it moves to
  `scripts/lib/errors.js` and every refusing file imports it.
- **Never catch and continue silently, with one named class of exception: telemetry.** A write whose
  failure must never change the program's answer (the vault read log, a heartbeat push) fails open and
  silent, says so in its `NEVER.` line, and catches **only the named error types it expects**, never
  `Exception`. The read log catches `(OSError, ValueError)`: `ValueError` because a POSIX `argv` byte
  under `surrogateescape` raises `UnicodeEncodeError` on write, and a narrower catch crashes the search
  before any result prints.
- **Fail closed in a guard, fail open in a heartbeat.** Every file states which it is, in `NEVER.`.
- **An unknown flag is a refusal on an operator CLI and a WARNING on a hook or Routine edge.** Three of
  the tree's defects come from flags silently ignored, but a Routine's command line is filled in by a
  model, and C2 already measured what a slip costs there (`CO-N1`: no run-log row, no save). So a file
  with a B1 (hook) or B2 (Routine) caller prints the unknown flag on stderr and carries on; every other
  CLI refuses with exit 1.

---

## 5. Exit codes and output

### 5.1 The table

| Code | Meaning | Stream |
|---:|---|---|
| 0 | success | data on stdout |
| 1 | any failure, including "the answer is no" (a check failed, a test failed) | the reason on stderr |
| 2 | **only** a refusal contract a caller distinguishes from failure, listed in 5.2 | the finding on stderr, one line per finding, the refusal last |

This is the tree as it already behaves: `validate-alex.js:253` exits 1 on a failed suite,
`heartbeat-check.mjs` and `portability-check.mjs` exit 1 on a finding, and every `node:test` and
`unittest` file exits 1 on a failure. A table that called those defects would order seats to renumber
codes that `pre-commit`, `heartbeat.yml` and the Routine prompts read.

### 5.2 Every use of exit 2, listed

| File | Exit 2 means | Who reads it |
|---|---|---|
| `scripts/secret-scan.mjs`, `scripts/employer-data-guard.mjs`, `scripts/personal-data-scan.js` | the wall FOUND something | both pre-commit hooks, `autosave.sh:250-258` |
| `scripts/untrusted-lane-guard.js` | DENY: Claude Code blocks the tool call | the harness (`variants/online/.claude/settings.json:56`) |
| `scripts/lib/build-soul-core.js`, `scripts/skills-park.js` | the write lock is busy | `run-vault-index.ps1:90-93` (dropped Kit code, frozen) |
| `work/18-recovery-layer/check.mjs` | AMBER, a degraded but not failed sweep | four Routine prompts and `/status` |
| `scripts/build-online-template.mjs` | the build REFUSED (an unclaimed path, drift under `--check`) | the fleet scripts and the operator |
| `scripts/outputs-ledger.js validate` | the ledger failed validation | `check.mjs:228` (C12), which tells 2 from any other failure |
| `scripts/heartbeat-check.mjs` | bad arguments | nobody distinguishes it today; kept, listed |
| `scripts/close-out-online.sh` | REFUSED: a missing or empty `--job`, a missing or empty `--status`, or no repository to run in | its own final verdict line |
| `scripts/vault_search.py` | argparse usage errors (argparse owns them), an empty query, a non-integer `-n`, `stats` before any build, and an unsearchable index | the model reading the output; C1 pins eight of these |
| `scripts/bootstrap.mjs:543` | a required item is MISSING | the Kit CI step (`ci.yml:547-550` passes 0 or 2, fails 1); `kit-doctor.js:180` reads any non-zero as FAILED |
| `scripts/generate-alex.js:115` | REFUSED: bad arguments, nothing run | `Install-Alex.command:267` (any non-zero); the model in the command files |
| `scripts/prompt-regression-check.js:349` | REFUSED: an unknown flag or argument, an empty one included, nothing checked (PR-D1) | the generator's step 3b passes fixed arguments, so no caller sends one; an owner running it by hand reads the refusal line |
| `scripts/import-memory.mjs:433` | REFUSED: one of the import's own guards fired (an escaping path, a credential-bearing file, a hard link, a second `--apply` with no `--overwrite`) - nothing written | nobody (not L2); an owner running it by hand reads the `REFUSED` lines |
| `scripts/lib/template-gate.mjs:246` | REFUSED (a Refusal) | `/update` (`update.md:103`, `:113`, any non-zero) |
| `scripts/run-log.mjs:111` | REFUSED: a malformed append | nobody tells 2 from 1: `close-out-online.sh:234` and `check.mjs:435` read any non-zero as a failed append; `snapshot.md:65` does not check it |
| `scripts/status-rotate.js:383` | the write lock is busy (deferred) | `close-out-online.sh:157`, the one reader that tells 2 apart (a deferred step, not a failure); `run-job.mjs:396`, `run-vault-index.ps1:34`, which read only 1 as a failure; the same meaning as `build-soul-core` and `skills-park` |
| `scripts/lib/install-profile.js:158` | a usage error | nobody (not L2) |
| `scripts/json-standard-audit.js` (`main`'s return, as `EXIT.REFUSED`) | findings, or under `--enforced` a regression | the CI step (any non-zero fails); V21 calls `auditText` in-process and never reads the code |

(`hooks-gate-dry-run.mjs:184` also exits 2 and leaves in wave D.) The checker keeps this table as
`EXIT_TWO_TABLE` in `scripts/tests/code-standard.mjs`; a row is added to both in the same commit.

Two more exceptions to the rest of the table, deliberate and kept: `scripts/autosave.sh`'s `finish()`
always exits 0 (a failing PostToolUse hook interrupts the owner; the refusal travels in the result
line), and `scripts/capture-typed-input.js` always exits 0 and prints nothing (a non-zero
`UserPromptSubmit` exit erases the owner's prompt). A use of exit 2 not in this table is a defect, and
a new one needs a row here in the same commit.

### 5.3 Output

- **Data on stdout, diagnostics on stderr.** A program whose output another program parses prints
  that output and nothing else on stdout.
- **A line another program parses is a contract** and is listed in section 8, tagged at its site.
- No progress chatter, no banners, no colour. A run under CI, under a hook and under a Routine produces
  the same bytes.

---

## 6. Tests

- **`node:test` with `node:assert/strict` for JavaScript; `unittest` for Python.** In the 150-file
  scope, 36 JS test files still hand-roll an `ok()`/`check()`/`assert()` helper; they are converted in
  the plan's wave 12.
- **One CI step per test file**, byte-identical in all three lists. A step that cannot run in one list
  needs an `EXEMPT` row in `test-ci-parity.mjs` naming the list, the step and a real reason.
- **One concern per file**, with the header saying what it would let through if deleted.
- **Every refusal is shown before the pass.**
- **A test kills a mutation.** A new or rewritten test file is shown FAILING on a planted change to
  the code it guards, in a throwaway clone. **A converted test file runs against the C seats' existing
  mutation set, and its kills must include every kill the old file made**, with an old-assertion to
  new-test map in the wave report. One mutation is one data point, not an equivalence proof.
- **A test touches nothing outside its own temp folder.** Fixtures in a temp directory, inherited
  `GIT_*` stripped, git pinned (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL`), no network, no scheduler
  (a preload stubs it where the code would call one), and every env path the code reads set into the
  temp folder. **The proof is `git status --short --ignored` in a clean clone after the run, and it must
  be empty.** That check caught `system/recall/recall-metrics.jsonl` (`char-c5.md` finding 3) and
  `system/vault-reads.jsonl`, which the freshness test wrote because it did not set `ALEX_READS_LOG`
  (T1, fixed in wave A1; the retyped test sets it at `test_vault_search_freshness.py:84`).
- **No test imports an L2 module that has no main guard.** `generate-alex.js` is an async IIFE from
  `:102` to `:252`: importing it runs the generator with the test's arguments, swaps staged files into
  the checkout and, at `:223-226`, calls `schtasks /create`. `heartbeat-check.mjs` runs its CLI at top
  level. `recall-inject.js` ends in `try { main(); } catch (_) {}` and `process.exit(0)`. Such a file is
  tested by running it as a child process.
- **A fixture lives in `scripts/tests/fixtures/`** and is named for what it stands in for. Fixtures are
  not matched by `testFilesIn`, so they need no CI step and are not orphans.
- **A test never asserts on another file's source text** unless that text is a contract listed in
  section 8. Where it must, the site carries the tag from 8.2.
- **A defect a test pins on purpose is tagged in its name**: `PINNED DEFECT <id>: <one sentence>` in a
  JavaScript test title, and the suffix `_PINNED_DEFECT_<id>` in a Python method name, with `-` written
  as `_` (`C1-N1` becomes `C1_N1`). The checker reads both forms.
- **In an "EDITED, no assertion changes" test file, a narrowing `assert` that `mypy --strict` requires
  and that cannot fail on today's code is permitted** (a `re.match(...)` before `.group`, a
  `spec.loader` before `exec_module`); each one is listed in the wave report.

---

## 7. Python

- **Standard library only.** Anything an owner runs imports nothing that is not in CPython.
- **The runtime floor of product code is not raised by this rewrite.** On a Mac, the nightly index runs
  whatever `python3` answers first (`run-job.mjs:401-404`, dropped Kit code), while the installer
  itself avoids the bare name and calls `python3.12` (`Install-Alex.command:228-229`), so the
  interpreter that runs `vault_search.py` there may be older than any CI list. Today the file parses at
  every `feature_version` from 3.8 to 3.12 and uses no 3.10+ API. So:
  - **Product modules target 3.9**: `from __future__ import annotations` in every typed module, so
    `X | None` in annotations is a string; no 3.10+ syntax or API. `ruff` enforces the syntax half at
    `target-version = "py39"`, and a floor step in CI (section 9.1) runs the product on 3.9.
  - **Tests target 3.10**: they already need `TemporaryDirectory(ignore_cleanup_errors=True)`, and they
    run only in CI, on 3.12.
  - **`mypy` checks at 3.10**, its lowest: `mypy 2.3.1 --python-version 3.9` refuses to run. The 3.9
    gap in mypy is covered by `ruff`'s target and the floor step, and nothing else.
- **`ruff format` is the formatter and there is no second opinion.** Line length 120.
- **`ruff check` with the rule set in `ruff.toml`** (section 9.3). Measured with exactly that file, by
  the CI command over `.`: **20 findings, all in Kit files (11 in `narrative-drift-check.py`, which wave
  1 deleted; 5 in `vault_search.py`; 4 in tests), 0 in vendored code, and all 10 files fail
  `ruff format --check`.**
- **`mypy --strict` through `mypy.ini`.** Today: **570 errors over the nine files `mypy.ini` names**
  (measured by the printed command); across all ten, 590 on a Windows host and 592 on Linux and macOS
  (the two extra are a Windows-only `stat_result.st_reparse_tag` in the file wave 1 deletes).
  578 are missing annotations (`no-untyped-call` 383, `no-untyped-def` 195). **Annotating
  `vault_search.py` does not remove the `no-untyped-call` errors in its tests**: no test imports the
  module by name (they run it as a child or load a temp copy through `importlib`), and the 358 untyped
  calls in the eight test files are calls to the tests' own helpers. The Python type job is about 540
  edits across the tests plus 30 in the product. Per-platform results differ legitimately, which is
  why the step runs in all three lists.
- **Type hints on every function.** A `dict` that crosses a function boundary in PRODUCT code gets a
  `TypedDict` or a dataclass; test helpers that only assert on a parsed JSON row may pass a `dict`.
- **`pathlib` over `os.path`** in new and rewritten code (`ruff`'s `PTH`), except where a path is
  handed straight to a stdlib call that wants a string.
- **`vault_search.py` stays one self-contained file.** Four tests copy it alone into a temp folder and
  run or import the copy (`db_states.py:212`, `read_log.py:232`, `index_contract.py:124`), so a
  sibling helper module raises `ModuleNotFoundError` there.
- **One row writer, inside the file that writes the row.** `vault_search.py`'s one JSONL write goes
  through an in-file `append_jsonl_row()`, and **its bytes stay as they are** (insertion order,
  `json.dumps` defaults, text-mode newline): the row is read by a script outside the Kit
  (`read-r1.md`, the read log's one reader) and two C1 tests assert its shape without a defect tag.
  Byte parity with a JavaScript row format is not required by this standard; see `REWRITE-PLAN.md`
  section 15's split list.
- **A docstring on every module and every public function**, saying what it returns and what it
  raises. The module docstring is the WHAT/HOW/NEVER header.

---

## 8. Contracts: code that other code reads as bytes

These cannot be reformatted. **A `contract:` comment documents a contract; it does not stop a
formatter.** Running this standard's own formatter over every JS file turned five Kit CI steps red, two
of them at contracts this list already named. So every site carries two lines:

```js
// contract: read as text by scripts/tests/test-employer-data-guard.mjs:120. Keep on one line.
// biome-ignore format: the guard test builds a live RegExp from this exact line
const PERSONNUMMER = /.../;
```

Proven both ways on a clean clone: formatted without the suppression, `PERSONNUMMER` splits and two
guard tests fail; with it, the file formats clean and all 61 pass. The same pair on `recall-inject.js`'s
vault query keeps C1's index-contract test green while the rest of that file is formatted.

**Three kinds of site take the tag alone, with no `biome-ignore format:`.** An output contract (a line a
program prints, which a test or a caller compares), a site a test copies whole and runs, and a "no code
line calls X" contract (`fs.symlinkSync(` in `bootstrap.mjs` and `skills-park.js`). A formatter never
changes what a program prints or what a file does when it runs whole, and a "no line calls" contract has
no one statement under the tag to hold, so the suppression leg refuses a `biome-ignore` at all three.

### 8.1 The list, and how it is built

**This list is regenerated from a census, not remembered.** Wave A2 read every test file for
`readFileSync`, `readFile` and `createReadStream` under any alias, `read_text`, `read_bytes`, `open`, a
local helper that returns a read (through the helpers it calls), a `git show <rev>:<path>`, and a spawn
of another test file, on a non-fixture tracked path. The checker's `contract` leg makes the same count on
every run and fails on a source-text read with no matching `contract:` tag at its site.

Two things the leg counts are not rows. A read's path resolves to the file that ships at that path
(section 9.7); a path it cannot resolve exactly is reported by `--report`, never guessed. A copy (`cp` in
a spawn, or a read whose value goes unchanged into one whole write) never inspects content, so it is
counted as a copy and named by `--report`, never a finding.

Each row is held one of four ways. **Tagged**: the site carries a `contract:` tag naming this reader.
**Row only**: the contract lives here and not at the site, because the reader takes a whole file by
name (a test that runs it or reads it whole), sits outside the checker's reach, or reads immutable
history (migration 001 is held by running the migration). **Converted**: the source-text read became a
behaviour test; the row records what the old read held. **Not a contract**: ruled out.

In the Fails column, **silent** means a broken contract leaves every check green (a stale count stays
current), and loud means a test or a run fails.

| Text | Site | Read by | Fails | Held |
|---|---|---|---|---|
| MAX_BLOB_BYTES=10485760 at column 0 of its own line | `scripts/autosave.sh:70` | `scripts/tests/test-autosave-paths.mjs:417` | loud | tagged |
| json_escape() { at column 0 through a column-0 } | `scripts/autosave.sh:96` | `scripts/tests/test-autosave.mjs:1228` | loud | tagged |
| outputs/logs/bootstrap-check.log, which the doctor writes | `scripts/bootstrap.mjs` | `scripts/tests/test-bootstrap-doctor.mjs:360` | loud | row only |
| no code line calling fs.symlinkSync( anywhere in bootstrap.mjs | `scripts/bootstrap.mjs:376` | `scripts/tests/test-skill-links.mjs:159` | loud | tagged |
| scripts/build-online-template.mjs | `scripts/build-online-template.mjs` | `scripts/tests/test-build-template-results.mjs:114`; `scripts/tests/test-build-template-defects.mjs:103` | loud | row only |
| node scripts/status-rotate.js, node scripts/outputs-ledger.js reconcile and render, as literal command lines | `scripts/close-out-online.sh:153`, `:168`, `:172` | `scripts/tests/test-recall-online-closure.mjs:140-145` | **silent** | tagged |
| require(path.resolve('system/recall/lib/lessons.js')) in the heredoc, with the L: none screen above it | `scripts/close-out-online.sh:204` | `scripts/tests/test-recall-online-closure.mjs:140-164` | loud | tagged |
| const PERSONNUMMER = /.../; one literal on one line | `scripts/employer-data-guard.mjs:90` | `scripts/tests/test-employer-data-guard.mjs:135-137` | loud | tagged |
| scripts/generate-alex.js | `scripts/generate-alex.js` | `scripts/tests/test-generate-no-soul.mjs:181` | loud | row only |
| const VALID_ONLY = ['docs', 'claude', 'tokens', 'scheduler', 'commands', 'soulcore', 'routines']; one array literal of single-quoted names | `scripts/generate-alex.js:56` | `scripts/tests/test-generate-cli.mjs:168` | loud | tagged |
| '--file', 'system/run-log.jsonl' and '--max-hours', '48' | `scripts/heartbeat-check.mjs:40-41` (the defaults, applied at `:120-121`) | `scripts/tests/test-heartbeat-check.mjs:109` (at the base) | loud | converted |
| module.exports stays one plain object whose auditText can be replaced by code appended after the file's last line | `scripts/json-standard-audit.js:1348` | `scripts/tests/test-validate-known-bad-shipped.mjs:547` | loud | tagged |
| scripts/kit-doctor.js | `scripts/kit-doctor.js` | `scripts/tests/test-kit-doctor.mjs:45` | loud | row only |
| line 17 is the launchd sleep-replay sentence and stays line 17 | `scripts/lib/gen-launchd.js:17` | `scripts/tests/test-generator-libs-contract.mjs:634-635` | loud | tagged |
| (portability-ok: ...) on the line naming the run-job call | `scripts/lib/gen-launchd.js:78` | `scripts/tests/test-generator-libs-contract.mjs:647-650`; `scripts/tests/portability-check.mjs:301` | loud | tagged |
| scripts/lib/install-profile.js | `scripts/lib/install-profile.js` | `scripts/tests/test-install-profile-cli.mjs:46` | loud | row only |
| scripts/lib/template-gate.mjs | `scripts/lib/template-gate.mjs` | `scripts/tests/test-update-command-contract.mjs:126` | loud | row only |
| migration 001's RULE block | `scripts/migrations/001-structural-voice-tells.js:85` | `scripts/tests/test-migrations-frozen.mjs:194` | loud | row only |
| scripts/run-migrations.js | `scripts/run-migrations.js` | `scripts/tests/test-run-migrations-cli.mjs:75` | loud | row only |
| writeJson(LEDGER, ...) as the ledger's one write, and no writeFileSync(LEDGER anywhere | `scripts/run-migrations.js:103` | `scripts/tests/test-run-migrations-ledger.mjs:170` | loud | tagged |
| const OPAQUE = '[A-Za-z0-9_\\-]'; (no '<' in the value class) | `scripts/secret-scan.mjs:47` | `scripts/tests/test-secret-scan-known-bad.mjs:225-229` | loud | tagged |
| the PLACEHOLDER tail x{4,}\|<)/i; | `scripts/secret-scan.mjs:82` | `scripts/tests/test-secret-scan-known-bad.mjs:225-230` | loud | tagged |
| no code line calling fs.symlinkSync( anywhere in skills-park.js | `scripts/skills-park.js:208` | `scripts/tests/test-skill-links.mjs:159` | loud | tagged |
| function writeProfileFile(p) { installProfile.writeProfile(REPO, p); } with no JSON.stringify inside | `scripts/skills-park.js:92` | `scripts/tests/test-install-profile.mjs:154` | loud | tagged |
| the seven header lines ^//   (P\d) , in order | `scripts/tests/portability-check.mjs:13` | `scripts/tests/test-online-workflows-contract.mjs:129` | loud | tagged |
| P6's finding name P6 DEADCALL and the words this tree does not hold; P6_EXT holds '.md' | `scripts/tests/portability-check.mjs:306` | `scripts/tests/test-recall-online-closure.mjs:303-305` | loud | tagged |
| the stdout line 'FAIL  H2a doctor probed a real tool set - 3 rows' (ok()'s format and the H2a name) | `scripts/tests/test-doctor-honesty.mjs:106` | `scripts/tests/test-bootstrap-doctor.mjs:404`; `scripts/tests/test-bootstrap-doctor.mjs:406` | loud | tagged |
| require('../../system/recall/lib/lessons') byte for byte | `scripts/tests/test-lesson-parse.js:24` | `scripts/tests/test-recall-online-closure.mjs:201` | loud | tagged |
| GOLDEN_MATURE_SHA, the sha256 of the mature card | `scripts/tests/test-soul-core-floor.mjs:53` | `scripts/tests/test-soul-core-floor.mjs:291` | loud | tagged |
| // portability-ok: at the end of the line holding the Windows path literal it waives | `scripts/tests/test-untrusted-guard.js:551` | `scripts/tests/portability-check.mjs:272` | loud | tagged |
| // portability-ok: at the end of the line holding the Windows path literal it waives | `scripts/tests/test-untrusted-guard.js:554` | `scripts/tests/portability-check.mjs:272` | loud | tagged |
| the one line --identity-paths prints: IDENTITY_PATHS joined by single spaces, no spec holding a space | `scripts/untrusted-lane-guard.js:1615` | `scripts/autosave.sh:181` | loud | tagged |
| the h-validators contract (V_MAX line, first G1-G<n>) | `scripts/validate-alex.js` | `scripts/tests/test-recall-harvest.mjs:215` | loud | row only |
| the previous validator, read from git history (git show HEAD~, else the parent of the oldest git log -S kitManifestDropClaim hit) | `scripts/validate-alex.js` (git history) | `scripts/tests/test-validate-v13-drop.mjs:127` | **silent** | converted |
| function kitManifestDropClaim(stagedDir) | `scripts/lib/validate/shipped.js:39` (the entry no longer carries the identifier) | `scripts/tests/test-validate-cli-contract.mjs:150` | loud | tagged |
| the first G1-G<n> match in the file, today the header comment 'the structural guards G1-G4' | `scripts/validate-alex.js:7` | `system/recall/harvesters/h-validators.js:23`; `scripts/tests/test-validate-cli-contract.mjs:56` | **silent** | tagged |
| const V_MAX = 21; on one line at column 0 | `scripts/validate-alex.js:91` | `system/recall/harvesters/h-validators.js:17`; `scripts/tests/test-validate-cli-contract.mjs:56` | **silent** | tagged |
| build() takes no argument | `scripts/vault_search.py:158` | `scripts/tests/test_vault_search_db_states.py:231-235` (unseen: calls the imported copy) | loud | tagged |
| the chunks FTS5 CREATE statement: columns in the order path, heading, body, linestart UNINDEXED | `scripts/vault_search.py:179-183` | `system/recall/recall-inject.js:118-128` | loud | tagged |
| chunk_file is a module global that build() looks up by name at every call | `scripts/vault_search.py:196` | `scripts/tests/test_vault_search_db_states.py:237-260` (unseen: swaps in a spy) | loud | tagged |
| the build line `indexed <n> files -> <n> chunks in <t>s -> <db>` | `scripts/vault_search.py:213` | `scripts/run-vault-index.ps1:50` (Kit only: the wrapper is an online drop row) | loud | row only |
| the read-log row's bytes: json.dumps(..., ensure_ascii=False), "a" text mode in UTF-8, a text-mode newline | `scripts/vault_search.py:271-278` | `scripts/tests/test_vault_search_read_log.py:139-148` (unseen: compares log bytes); `scripts/tests/test_vault_search_read_log.py:151-159` (unseen: counts log newlines); `personal-os` scripts/vault-reads-report.py:57-64 (outside the Kit) | loud | tagged |
| the read-log row's keys: ts, query, results in that order | `scripts/vault_search.py:290` | `scripts/tests/test_vault_search_read_log.py:131` (unseen: parses the log); `scripts/tests/test_vault_search_read_log.py:139-148` (unseen: compares log bytes); `personal-os` scripts/vault-reads-report.py:57-64 (outside the Kit) | loud | tagged |
| the rebuild notice 'index stale (vault changed since last build) - rebuilding before search...' on stderr | `scripts/vault_search.py:311` | `scripts/tests/test_vault_search_db_states.py:51` (unseen: compares child stderr); `scripts/tests/test_vault_search_rebuild.py:39` (unseen: compares child stderr); `scripts/tests/test_vault_search_exclusions.py:41` (unseen: compares child stderr) | loud | tagged |
| the search result block: 'N. path:line  [heading]' then '   snippet' and a blank line | `scripts/vault_search.py:337-343` | `scripts/tests/test_vault_search_cli.py:186-194` (unseen: compares child stdout) | loud | tagged |
| the four stats lines db:, files:, chunks:, built: with their padding | `scripts/vault_search.py:360-363` | `scripts/tests/test_vault_search_cli.py:151-163` (unseen: compares child stdout) | loud | tagged |
| the module globals VAULT, DB, READS_LOG, read once at import | `scripts/vault_search.py:51-54` | `scripts/tests/test_vault_search_db_states.py:285-290` (unseen: imports the module copy) | loud | tagged |
| build() stamps built_at through the module global time, once, after the last chunk row and before the first meta row | `scripts/vault_search.py:202` | `scripts/tests/test_vault_search_db_states.py:262-283` (unseen: swaps in a clock) | loud | tagged |
| the vault prepare() SQL: double-quoted literals joined by +, FROM chunks, positional snippet and bm25 | `system/recall/recall-inject.js:126` | `scripts/tests/test_vault_search_recall_reader.py:42` (Kit only) | loud | tagged |
| const { DatabaseSync } = require('node:sqlite'); alone at the top level | `system/recall/recall-inject.js:31` | `scripts/tests/test-recall-laptop-closure.mjs:81` (Kit only) | loud | tagged |
| process.env.ALEX_INDEX_DB \|\| path.join(REPO, 'scripts', 'vault-index', 'vault-search.db') | `system/recall/recall-inject.js:43` | `scripts/tests/test_vault_search_recall_reader.py:61-66` (Kit only) | loud | tagged |
| Edit(/scripts/lib/**) | `variants/online/.claude/settings.json` | `scripts/tests/test-template-gate.mjs:331` | loud | row only |
| # Virtual Alex CI title line; exactly one ^ {4}if: gate | `variants/online/.github/workflows/ci.yml:1` | `scripts/tests/test-ci-parity.mjs:699` | loud | tagged |
| name, triggers, token, the one job, runner, timeout, versions, floor step last, action tags, portability step name | `variants/online/.github/workflows/ci.yml:28` | `scripts/tests/test-online-workflows-contract.mjs:58`; `scripts/tests/test-online-workflows-contract.mjs:64`; `scripts/tests/test-online-workflows-contract.mjs:68`; `scripts/tests/test-online-workflows-contract.mjs:116`; `scripts/tests/test-online-workflows-contract.mjs:126` | loud | tagged |
| the step list in the shapes parseJobs reads; the title line; one four-space job gate | `variants/online/.github/workflows/ci.yml:28` | `scripts/tests/test-ci-parity.mjs:512`; `scripts/tests/test-ci-parity.mjs:513`; `scripts/tests/test-ci-parity.mjs:522` | loud | tagged |
|   portable-tests: at two spaces under jobs | `variants/online/.github/workflows/ci.yml:40` | `scripts/tests/test-template-gate.mjs:323` | loud | tagged |
| every non-comment line: cron, manual trigger, gate step, each later if: (evaluated as JavaScript), the script call, contents: read | `variants/online/.github/workflows/heartbeat.yml:28` | `scripts/tests/test-heartbeat-check.mjs:265` | loud | tagged |
| name, one job, runner, timeout, node 22, GH_TOKEN and the template= output, three readers of it, two action tags | `variants/online/.github/workflows/heartbeat.yml:28` | `scripts/tests/test-online-workflows-contract.mjs:91`; `scripts/tests/test-online-workflows-contract.mjs:102`; `scripts/tests/test-online-workflows-contract.mjs:122` | loud | tagged |
| the whole hook, written into each throwaway repository and run there | `variants/online/scripts/hooks/pre-commit:1` | `scripts/tests/test-online-pre-commit.mjs:90` | loud | not a contract |
| line 2 carries VIRTUAL ALEX VARIANT | `variants/online/scripts/hooks/pre-commit:2` | `scripts/tests/test-employer-data-guard.mjs:113` | loud | tagged |
| MAX_BLOB_BYTES=<digits> from column 0, the same number as the autosave | `variants/online/scripts/hooks/pre-commit:61` | `scripts/tests/test-autosave-paths.mjs:418` | loud | tagged |
| MAX_BLOB_BYTES=<digits> at column 0 of its own line, the same number as the autosave | `scripts/hooks/pre-commit:88` | `scripts/tests/test-autosave-paths.mjs:420` | loud | row only |
| the size guard loop, from BIG="$(git diff --cached through the size-guard-clean echo, held equal to the Kit hook's own copy | `variants/online/scripts/hooks/pre-commit:63` | `scripts/tests/test-online-pre-commit-kit.mjs:38`; `scripts/tests/test-online-pre-commit-kit.mjs:39` (Kit only; the checker's text-read scan credits both of that test's reads to this file, the Kit's own copy included) | loud | tagged |
| the validator call in its exact hook form: "$NODE" "$ROOT/scripts/validate-alex.js" --context=pre-commit --changed | `variants/online/scripts/hooks/pre-commit:106` | `scripts/tests/test-validate-cli-contract.mjs:166` | loud | tagged |
| if (!exists('outputs')) { add('C12', GREEN, 'no outputs/ directory yet; nothing to name'); return; } | `work/18-recovery-layer/check.mjs:289` | `scripts/tests/test-recall-online-closure.mjs:309` | loud | tagged |
| if (!exists('scripts/outputs-ledger.js')) { add('C12', AMBER, | `work/18-recovery-layer/check.mjs:292` | `scripts/tests/test-recall-online-closure.mjs:309` | loud | tagged |
| [abs('scripts/outputs-ledger.js'), 'validate'] | `work/18-recovery-layer/check.mjs:295` | `scripts/tests/test-recall-online-closure.mjs:309` | loud | tagged |

Two contracts are rules over many files rather than sites. `// portability-ok:` sits on the same line
as the call it waives (`portability-check.mjs` P5), so a formatter that re-wraps the call moves the
pragma off it and P5 fires. A call-shaped `node scripts/<x>` in any shipped non-test file must name a
file the tree holds (P6, which skips `scripts/tests/`), so dropping a file from the online tree fails CI
until its call-shaped mentions go too.

A green run over the `vault_search.py` white-box rows does NOT prove equivalence: a retype that re-reads
`ALEX_INDEX_DB` inside `build()` passes all 95 tests. Wave 1 re-runs C1's mutation driver for that.

### 8.2 The tag

```js
// contract: read as text by <reader>:<line>. <what must not change>.
// contract: read as text by <reader>:<line> (unseen: <how>). <what must not change>.
```

`contract:` names its reader with a `file:line`, and `biome-ignore format:` (JavaScript) keeps the
formatter off the one statement, except at the three kinds of site section 8 names. Python contract
sites need no suppression: `ruff format` leaves the build line and the row alone (measured: all 95 C1
tests green after `ruff format` and `ruff check --fix` on `vault_search.py`). A tag with no reader is
removed with the contract it describes.

A tag answers for the read at the `<file>:<line>` it names and for no other. A range (`:179-181`) is
allowed, one range per path. More than one reader is allowed, one tag line per reader, stacked directly
above the site, and a reader that reads the site in two places takes two tag lines. The contract leg
reports a tag line naming more than one `<file>:<line>`. When the stack would push a line past the formatter's width (120 columns for ruff), the
sentence saying what must not change sits once, on its own plain comment line, directly above the stack.

**`(unseen: <how>)`** marks a reader that sees the text through a path the checker cannot resolve: a
test that imports the module, swaps in a spy, compares a child's stdout or stderr, or parses a log the
program writes. `<how>` is three words or more. The qualifier never hides a read the leg can see: on a
read it resolves, the qualifier is a finding. `--report` names every unseen contract and every format
suppression taken under one.

**A tag never contains a string its reader matches.** A reader that searches the file for a string
passes on the tag's own copy of it once the real line is gone, and no checker sees that. The tag
describes the text; it does not quote it.

A tag naming a read that does not exist, and a `contract:` comment naming no `<file>:<line>`, are
findings. The statement right under a `biome-ignore format:` must be text the tag's reader asserts about:
one of the strings or regular expressions the reader writes where it reads is that statement or matches
it.

**A reader the Kit keeps and the online tree drops is the Kit's to judge.** In a generated tree, a tag
whose reader the tree does not hold, and which a `drop` row of the shipped `system/kit-manifest.json`
names by its exact path, is not a finding: `--report` names it, and the Kit's own run judges it like any
other tag, a removed reader included. A reader the manifest ships, names in no row, or drops only through
a directory row, is still a finding when the tree lacks it. So a file that becomes a Kit-only reader takes
an exact-path drop row.

### 8.3 The direction of travel

A source-text assertion becomes a behaviour assertion wherever it can, **by running the program, never
by importing a module that has no main guard** (section 6): `VALID_ONLY` through the `--help` usage
line the test already derives from (`test-generate-cli.mjs:153-159`); the heartbeat defaults by running
the CLI in a temp repo with a run log at the default path. What must stay text stays byte-identical,
tagged and suppressed.

### 8.4 Cross-language data contracts

The vault index is written in Python and read in JavaScript, so the shared thing is a contract, not a
module. Its one home is this section, because the writer ships online and the reader does not:

- `chunks` is FTS5 with columns **in this order**: `path, heading, body, linestart UNINDEXED`. The
  reader uses `snippet(chunks,2,...)` and positional `bm25(chunks,0.25,2.0,1.0,0.0)`, so the ORDER is
  the contract. `meta(key, val)` holds `built_at, built_epoch, files, chunks`, all TEXT.
- The two query builders differ on purpose: `vault_search.py` ANDs `[\w']+` terms; `recall-inject.js`
  ORs lowercased terms capped at 12.
- Writer `scripts/vault_search.py:158-214`; reader `system/recall/recall-inject.js:118-128`; held by
  `test_vault_search_index_contract.py` (11 tests, ships) and the Kit-only
  `test_vault_search_recall_reader.py` (3 tests, which run the reader's own query); which of the two catches
  C1's mutation M4, a heading/body swap, is re-measured when wave 1 re-runs C1's mutation driver.

---

## 9. The tooling

**Where it runs.** As exact-pinned steps inside the EXISTING gated job. The online workflow allows
exactly one gated job (`test-ci-parity.mjs` leg G0 counts four-space `if:` lines in the file whose first
comment is `# Virtual Alex CI`), so a tool step is a step of `portable-tests`, never a new job. Parity
applies: a step goes in all three lists byte-identical, or carries an `EXEMPT` row with a reason. A
`uses:` step is identified by its action and its `with:` inputs together, so a runtime version cannot
differ between the lists without a row saying why (the online list's second `setup-python`, at 3.9, has
one in each Kit job).

**No `package.json`, no `node_modules` and no cache in the checkout.** Every command below either
downloads its own pinned binary (`npx --yes`, `pipx run`) or writes into the directory ABOVE the
checkout. The proof is `git status --short --ignored` in a clean clone after the run, and it must be
empty. Measured with the commands below: after `ruff check --no-cache`, `ruff format --check
--no-cache`, `mypy --cache-dir ../.mypy-cache` and all eight Python test files, the only ignored file was
T1's read log, which wave A1 removes; no `.ruff_cache`, no `.mypy_cache`, no `__pycache__`.

**Versions verified against the tools' own current documentation and their registries on
2026-09-25.** A version moves only as a deliberate commit that records the new findings count.

### 9.1 The commands

| Job | Command | Runs in |
|---|---|---|
| JavaScript lint, format and types | `node scripts/tests/js-tools.mjs`: `npx --yes @biomejs/biome@2.5.14 ci --error-on-warnings --config-path biome.json .`, then `npm install --silent --no-audit --no-fund --prefix .. @types/node@22.16.5` and `npx --yes --package typescript@7.0.2 -- tsc -p <a config that extends jsconfig.json and names Biome's list>`, on Biome's `files.includes` only; with none it runs no tool and says so | all three lists |
| Python lint, format and types | `node scripts/tests/python-tools.mjs`: `ruff==0.16.9 check --config ruff.toml --no-cache --output-format=github`, `ruff==0.16.9 format --check --config ruff.toml --no-cache` and `mypy==2.3.1 --config-file mypy.ini --cache-dir ../.mypy-cache` through `pipx run` (or `uvx --from` where pipx is absent), on the ratchet's enforced `.py` paths only (Biome's list refuses a `.py` path); with none it runs no tool and says so, and with some it refuses to run without `ruff.toml` and `mypy.ini` | all three lists |
| Shell lint | `node scripts/tests/shell-tools.mjs`: `shellcheck --norc` on the ratchet's enforced shell files only, from PATH or, where there is none, `uvx --from shellcheck-py==0.9.0.6`; with none it runs no tool and says so | **online list only**; `EXEMPT` in both Kit jobs |
| Python floor | a second `actions/setup-python` at `'3.9'`, LAST in the job, then `node scripts/tests/python-floor.mjs`: `python scripts/vault_search.py build` and `search` against a fixture vault it writes into a temp folder | **online list only**; `EXEMPT` in both Kit jobs |

**One helper per tool family, and why.** Measured at the landing: with an empty list, `biome ci .` checks
only `biome.json` and exits 0, but it still downloads Biome first, so a registry outage would turn an
empty step red; `tsc -p jsconfig.json` as 9.5 prints it reads all 167 JavaScript files the `include`
globs name, and a config that names no file is refused (`TS18003`, exit 2). So each tool step is a small
Node helper beside `python-tools.mjs`: it decides whether its tool starts at all, runs it on the enforced
set only, and fails when the set is not empty and the tool, its config or a listed file is missing. The
helpers are siblings, not one file with a mode, because their steps sit in different lists and each takes
no argument, as the ratchet decides the files.

- **`js-tools.mjs`** takes Biome's list as the checker resolves it (`enforcedSet` over the checker's
  scope, less the ratchet's own list, which holds the two migrations), and fails on any problem the
  checker finds with the enforced set. Biome gets `.` and reads its own list. tsc takes no file list
  beside `-p`, so it gets a config written into a fresh folder in the checkout's parent that extends
  `jsconfig.json`, names exactly the enforced files and includes nothing else; the folder is removed
  after the run.
- **`shell-tools.mjs`** reads the ratchet's list and keeps what the checker scores as shell. An entry
  under `variants/online/` is read where it sits in the Kit and at the path it ships to in the online
  tree, which is how the online pre-commit hook is found in both.
- **`python-floor.mjs`** reads the floor from `ruff.toml`'s `target-version`, so the static target and
  the runtime check cannot name two versions. It takes `python` when that is the floor (in CI, the
  setup-python step before it) or what `uv python find` reports, and fails naming what it found when
  neither is the floor, so it never passes on a newer Python.
- **Every helper hands its tool the tracked config by name**: `--config ruff.toml`,
  `--config-file mypy.ini`, `--config-path biome.json`, `shellcheck --norc` (the tree tracks no
  `.shellcheckrc`, so the defaults are the standard), and a tsc config that extends `jsconfig.json`. A
  config a wave adds deeper in the tree then cannot replace the root one for its folder. **Biome is the
  exception the flag does not cover**: it applies a nested `biome.json` or `biome.jsonc` to its folder
  whatever `--config-path` says, and one whose `files.includes` is `"!**"` makes `biome ci` pass a
  finding unread, so `js-tools.mjs` refuses a Biome config in any folder between an enforced file and
  the root.

Facts behind those choices, each checked rather than assumed:

- **`pipx` is preinstalled on the three images the labels resolve to** (`actions/runner-images`, read
  2026-09-25): `ubuntu-latest` is Ubuntu 24.04, pipx 1.16.7; `windows-latest` is Windows Server 2025,
  pipx 1.17.5; `macos-latest` is **macOS 26 Arm64**, pipx 1.17.2. It is not on the master's PC, where
  `uv` 0.11.17 is; the documented equivalent is
  `uvx --from ruff==0.16.9 ruff ...` and `uvx --from mypy==2.3.1 mypy ...`, same pins and arguments.
  The first run of these steps on each runner is itself the smoke of the `pipx run` form.
- **`shellcheck` is preinstalled on ubuntu only** (0.9.0-1); the Kit's Windows and macOS jobs exist to
  prove PowerShell, the launchers and the link layer, and shell lint is platform-independent.
- **The Python floor step sits in the Ubuntu list, not the macOS job**, because the macOS job cannot run
  it: the `actions/python-versions` manifest's newest 3.9 (3.9.25) has builds for Linux 24.04 x64 and
  darwin x64 and none for darwin arm64, which `macos-latest` is. The question is the interpreter version,
  not the operating system. It runs last because a second `setup-python` changes `python` for every later
  step.
- **The laptop floor is Node 22.16.0, and `@types/node` is pinned to it, not the latest.** The floor is
  22.16.0 because `system/recall/recall-inject.js` queries the vault index's FTS5 table through
  `node:sqlite` (`:121`), and `node:sqlite` has FTS5 only from 22.16.0. Measured: 22.13.1, 22.14.0 and
  22.15.0 fail `CREATE VIRTUAL TABLE ... USING fts5` with `no such module: fts5`, and the hook swallows
  that error (`:127`), so an older Node loses every vault snippet without a word. The installers' check,
  `require('node:sqlite')` (`Install-Alex.cmd:124`, `Install-Alex.command:182`), still accepts 22.13;
  making it probe FTS5 is a product change, scheduled for the install wave as NODE-FTS5. The types are
  `@types/node@22.16.5`, the newest 22.16 release on the registry. `@types/node@26` accepted
  `import.meta.main`, the global `URLPattern` and `process.execve`; `import.meta.main` was added in
  v22.18.0, so a laptop between 22.16 and 22.17 reads it as `undefined` and a CLI guarded by it does
  nothing and exits 0. **All three lists run `node-version: '22.16'`**, which changed the line the
  runtime test of `test-online-workflows-contract.mjs` asserts; that assertion inverted in the same
  commit, named by the FIX row `NODE-FLOOR` in the ratchet. The checker bans `import.meta.main` until the
  floor passes 22.18.
- **`@types/node` goes in the checkout's PARENT**, `--prefix ..`. `tsc` resolves `node_modules/@types`
  by walking up from the config it is handed, and the config `js-tools.mjs` writes sits in a folder in
  the parent, so `jsconfig.json` names no path and the checkout stays clean.
- **The mypy cache goes in the parent too**, `--cache-dir ../.mypy-cache`: the same text works in bash,
  in PowerShell (the Windows job's default shell) and on the master's PC, which `/dev/null` and
  `${{ runner.temp }}` do not.

### 9.2 `biome.json` (tracked, repository root)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "files": { "includes": [] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 120 },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always", "trailingCommas": "none" },
    "assist": { "enabled": false }
  },
  "json": { "formatter": { "enabled": false }, "linter": { "enabled": false } },
  "linter": { "enabled": true, "rules": { "preset": "recommended" } },
  "overrides": [
    {
      "includes": ["**/*.js"],
      "linter": { "rules": { "suspicious": { "noRedundantUseStrict": "off" } } }
    }
  ]
}
```

Every line is a decision:

- **`files.includes` is the JavaScript half of the ratchet, and it starts empty.** A path there that is
  not `.js`, `.mjs` or `.cjs` fails the checker. Each wave appends the exact paths of the files it
  finished. Measured: with an empty list, `biome ci --error-on-warnings .` checks only `biome.json`
  itself and exits 0, and the CI step does not start Biome at all then (9.1). So the three CI lists are
  green from the commit that adds the tool, and nothing outside the enforced set is ever linted: not
  the vendored skills, not the dropped Kit code (the fleet, `run-job.mjs`, the donor scrub), whose
  formatting would break `test-online-workflows-contract.mjs:72`.
- **The two migrations never enter the list.** The formatter wants five changes below
  `001-structural-voice-tells.js`'s header (`:76`, `:109`, `:116`, `:150`, `:171`), and section 10
  allows the header and nothing else. They are the one standing exception to score item 3.
- **JSON is off.** `system/install-profile.example.json` is on `json_standard.enforced[]` and written only
  by `json-writer.js`; Biome's JSON formatter wants `"tags": [\n "community"\n ]` collapsed to one
  line, so `biome ci` and `json-standard-audit.js --enforced` would be mutually unsatisfiable. The JSON
  standard owns JSON bytes.
- **Assists are off.** `organizeImports` reports 99 files, and reordering `require()` calls in CommonJS
  is a behaviour change (module side effects run in require order) that the harness would have to prove
  file by file.
- **`"preset": "recommended"`**, not `"recommended": true`: Biome 2.5 deprecates the older key and
  prints a notice for it on every run.
- **The `.js` override**: with no `package.json` Biome reads `.js` as ESM, where `'use strict'` is
  redundant; in CommonJS it is not, and 72 files carry it. The four `.mjs` files carrying a genuinely
  redundant one are still reported.

**The size of the JS job**, measured with this configuration and `files.includes` set to the 131
in-scope JS files (the 150-file scope minus the migrations and the Python, shell and CI files):
**24 errors, 139 warnings, 297 infos, and 130 of the 131 files need formatting.** That is the job, not
the CI state, which starts at zero enforced files.

### 9.3 `ruff.toml` (tracked, repository root)

```toml
line-length = 120
target-version = "py39"
include = ["scripts/*.py", "scripts/tests/*.py"]
extend-exclude = [".agents"]

[per-file-target-version]
"scripts/tests/*.py" = "py310"

[lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "A", "C4", "SIM", "PTH", "RUF", "ARG", "ERA", "BLE", "S"]
# T20 is deliberately absent: in scripts/vault_search.py the prints ARE the program's output. A
# debug leftover is caught by the scenario harness instead, as a stdout diff against the baseline.

[lint.per-file-ignores]
# unittest mandates setUp and tearDown, which N802 would report; a test asserts (S101); and a test of a
# CLI spawns it (S603). All three are what a test is for, so they are off for tests and nowhere else.
"scripts/tests/*.py" = ["N802", "S101", "S603"]

[format]
quote-style = "double"
```

- **`include` and `extend-exclude`**: ruff's default excludes do not name `.agents`, and `ruff check .`
  without them reported 474 findings, 454 of them in vendored skills. With them: 20, all Kit. CI does not
  lint by `include`: the Python tool step passes the ratchet's enforced files, so `include` governs a
  local `ruff check .` only, and it names this file with `--config`, so a `ruff.toml` or `pyproject.toml`
  deeper in the tree cannot replace it for its folder.
- **`include` names `.py` files only**, so ruff never formats Markdown. Ruff 0.16 formats Python fences
  inside Markdown, and a rewriter running `ruff format .` must never rewrite a command file or a
  Routine prompt.
- **`target-version = "py39"`** for product code (section 7), with tests at `py310`. Measured: at `py39`
  no `UP` rule asks `vault_search.py` for 3.10+ syntax.

### 9.4 `mypy.ini` (tracked, repository root)

```ini
[mypy]
strict = True
python_version = 3.10
files = scripts/vault_search.py, scripts/tests
```

`files` is the whole Python set for a local run; CI passes the ratchet's enforced `.py` paths instead,
which override it, and names this file with `--config-file`; `narrative-drift-check.py` is absent because
wave 1 deleted it.
`python_version = 3.10` is mypy's lowest, stated so the verdict does not move with whichever Python
`pipx` happens to run on.

### 9.5 `jsconfig.json` (tracked, repository root)

```json
{
  "compilerOptions": {
    "allowJs": true, "checkJs": false, "noEmit": true, "strict": true,
    "module": "nodenext", "moduleResolution": "nodenext", "target": "es2023",
    "types": ["node"]
  },
  "include": ["scripts/**/*.js", "scripts/**/*.mjs", "system/**/*.js", "work/**/*.js", "work/**/*.mjs"]
}
```

**`checkJs` is false on purpose.** A file opts in with `// @ts-check` on line 1. **`@ts-check` is
mandatory for every RETYPED file, every new `scripts/lib/` module and every EDITED + LOGIC file, and
optional for an EDITED file.** Measured by the second challenger: `@ts-check` on all 68 non-test JS files
gives 1,292 strict errors (763 implicit any), which is a job of its own and is not smuggled into
"edited".

`include` is the whole JavaScript set for a local run and an editor. CI never reads it: the JavaScript
tool step hands tsc a config that extends this file and names Biome's `files.includes` instead (9.1).
tsc also checks, beside the enforced files, any `@ts-check` file one of them imports; none carries the
line today.

### 9.6 The manifest row the four configs need

The builder refuses any tracked path no row claims (`build-online-template.mjs:266-270`), and no
directory row claims the repository root. `docs/CODE-STANDARD.md` needed no row because the `docs/`
row claims it; the configs do. They land in ONE commit with this row, `ship` because the online CI
list runs the tools:

```json
{"id":"code-standard-tooling","paths":["biome.json","ruff.toml","mypy.ini","jsconfig.json"],"kind":"universal","needs_migration":false,"online":"ship","note":"The tool configs docs/CODE-STANDARD.md section 9 prints. Ship, because the online CI list runs the same pinned tools the Kit lists run."}
```

### 9.7 The checker: `scripts/tests/test-code-standard.mjs`

Four CI steps in all three lists (wave A1): the base fetch, this checker, the L2 test and the Python tool
step. The enforced set is the union of `biome.json` `files.includes` (JavaScript only, exact paths; a
glob or another language is refused) and the `enforced` list in `scripts/tests/code-standard-ratchet.json`
(Python, shell, the workflows and the two migrations; a JavaScript path there is refused). In the Kit an
entry naming no in-scope file is a failure. Every counted leg prints its count over the whole scope and
fails when any one file's count rises above that file's ceiling, keyed by the path the file ships at,
whatever another file did; a finding in the enforced set fails even at its ceiling. The ceilings start at
the base's counts, so the checker is green from its first commit. They come down with `--record`, which
never raises anything. A rise (`--raise`), a FIX row (`--fix`), a moved wave (`--wave`), and letting a
pin, an enforced path or an L2 file or name go (`--unfreeze`) each need `--reason` and write a dated row
into the ratchet. A direction leg compares the ratchet, `biome.json` and `docs/L2.json` with a base
(`--base` or `CODE_STANDARD_BASE`; in CI the pull request's base, or the commit before a push; locally
`HEAD`) and fails every move the wrong way no row new since the base names; with no base in the clone it
says so in one line.

Legs: `header`, `header-cli` (section 1's `Usage:`/`Exit:` rule), `diary` (JavaScript comments; Python
through a stdlib `tokenize`/`ast` helper), `dangling`, `commented-out`, `contract` (a source-text read in
a test with no `contract:` tag at its site; the read's path resolves to the file that ships at that path,
so in the Kit a path resolves to `variants/online/<p>` where a variant row claims `<p>`, else to the
Kit's own `<p>`, and a Kit file that ships nowhere is out of scope; copies are counted apart, section
8.1; in a generated tree a tag whose reader a drop row names by exact path is left to the Kit, section
8.2), `module-split` (a `require(` of an `.mjs` path in a `.js`
file), `floor` (`import.meta.main`), `suppression` (every `biome-ignore` carries a reason; one on a
contract line carries its `contract:` tag), `pinned` (a `PINNED DEFECT` assertion that changed since the
previous wave must have a FIX row for the ratchet's current wave (`fix_list`, `current_wave`); a pinned
test that gains a reason not to run (a skip, todo or only, a condition, a context skip, an early return)
fails whatever the FIX list says; the snapshot records the guards pins carry on purpose), and one
duplication leg per concern. Every leg is shown red on a planted violation before its count is trusted.

**Three layers keep the ratchet honest.** (a) `--record` only tightens. (b) Every loosening is its own
command with a reason and a dated row, and the direction leg fails a loosening no new row names. (c)
**The paths only the master changes**: the three CI lists, `system/kit-manifest.json`, this standard,
the ratchet (ceilings, enforced set, FIX list, pins), `docs/L2.json`, the four tool configs, and the
checker's own files. A wave that cannot raise a ceiling could still weaken the leg that counts, and a
seat that raises a ceiling in the same change as the violation it hides is caught for certain only at
the merge. The relay's `harness/merge-gate.mjs` holds the exact list and refuses a seat's branch that
changes one of those paths unless the master names it; this standard states the rule.

### 9.8 Suppressions

`// biome-ignore <category>: <reason>`, `# noqa: <rule>  <reason>`, a file-level
`# ruff: noqa: <rule>  <reason>` and `# type: ignore[<code>]  # <reason>` are allowed, counted per wave,
and never bare: a reason is three words or more, and `noqa` is matched in any case. Two known ones before
wave 1: `noControlCharactersInRegex` at `untrusted-lane-guard.js:248`
(`/[\u0000- \u007f\\]/` is the check that refuses a URL authority carrying control characters;
"fixing" it weakens a guard), and `noTemplateCurlyInString` at `test-hook-contracts.mjs:139-144,:175`
(`${CLAUDE_PROJECT_DIR:-.}` there is shell, not JavaScript, inside a frozen hook command string). **A
lint "fix" in guard-class code needs its negative test first.**

### 9.9 The commit gate is not changed

`scripts/hooks/pre-commit` and `variants/online/scripts/hooks/pre-commit` keep exactly the legs they
have. Linters and type checkers do not join a commit hook: the online hook runs on every autosave in an
owner's session, where a tool download would cost the owner seconds per file write.

---

## 10. What this standard does not govern

- **The vendored skills** under `.agents/skills/`: third-party, never in `files.includes`, excluded from
  ruff by `extend-exclude`, with their provenance in `.agents/skills/README.md`.
- **The bytes a shipped migration writes, and its body.** `scripts/migrations/001-*.js` and `002-*.js`
  may gain the section 1 header and lose diary comments, and nothing else: not a literal, not a branch,
  not a sentence the runner prints, not a formatter change. The test of that is a byte-diff of the file
  with every leading comment line stripped, plus `test-migrations-frozen.mjs` green. They never enter
  Biome's enforced set. A migration whose own NEVER paragraph forbids changing any byte below its header
  keeps its diary comments there too: that is the specific case and it wins over this bullet's general
  permission to drop them.
- **Dropped Kit code** (`online: drop` rows), including everything wave D drops. It is outside the online
  tree and outside this standard, and the calls it makes into in-scope code are frozen.
- **What a program does.** This file governs how code is written, never what it decides. A behaviour
  change is a documented diff with its own failing-first test, listed on the defect ledger, and listed
  for the owner at the end of the run.

---

## 11. The score

A file passes when all of these are true, and the score is the count of files that pass out of the
files in scope:

1. the WHAT/HOW/NEVER header is present (the module docstring in Python; JSON is exempt), and
   `Usage:` and `Exit:` where it has a CLI;
2. its trash counts are zero on every row of section 2 that a tool or checker can measure;
3. the tool for its language exits 0 on it, and it is inside the ratchet's enforced set (the two
   migrations are the one standing exception, section 10);
4. every exit code it returns is in the section 5 table;
5. every text contract it holds carries a `contract:` tag naming a reader, and in JavaScript a
   `biome-ignore format:` on the same statement;
6. a reviewer who does not know this system can say what the file does from its header alone, and
   finds nothing in the body they would have to ask about.

Items 1 to 5 are counted by command. Item 6 is one reviewer, one line per file, and it is the only
part of the score a machine does not produce.
