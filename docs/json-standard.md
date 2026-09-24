# The JSON standard

Every JSON file Alex owns is written the same way, by one helper, so the shape cannot drift.

**Why a standard at all.** Left alone, a system's JSON files diverge into private dialects: one file
puts its explanation in `_doc`, the next in `_readme`, a third in `_what`, a fourth in `meta`. One
writer emits a byte-order mark and every reader grows a strip-on-read patch for it. Keys arrive in
insertion order, so two runs over identical data produce different bytes and no diff means anything.
None of that is a bug anyone files. It is the slow kind of damage, and the only real cure is to make
the correct shape the ONLY shape a writer can emit.

**This is a port.** The standard was designed and proven upstream across a nine-commit build arc,
including a migration wave over eight real files and a 14-step recipe earned in the field rather than
derived. What arrives here is the rules, the helper and the recipe. The incidents that produced them
stay upstream, except where naming one is what makes a rule make sense.

**What you get.** `scripts/lib/json-writer.js` is the whole enforcement mechanism: a file written
through `writeJson()` cannot carry a BOM, CRLF endings, an unsorted key or a missing header, because
there is no code path that emits one. `readJson()` is its other half and fails loudly on a schema it
does not recognise rather than guessing.

**Where it stands, rewritten 2026-09-23 when the guards landed.** Read this before the rules.

- **The audit and the check are here.** `node scripts/json-standard-audit.js` prints the per-file
  table for every in-scope file and every code path that writes one without the helper. Validator
  check V21 refuses a commit while an ENFORCED file breaks a rule, and CI runs the same ratchet as
  `node scripts/json-standard-audit.js --enforced`. Section 3 says how they fit.
- **The enforced list is `system/kit-manifest.json` -> `json_standard.enforced[]`.** Three files are
  on it: `system/employer-data-allowlist.json` (on the helper since the day it was created),
  `system/migrations-applied.json` (moved onto the helper on 2026-09-23), and `system/fleet.json`
  (born on the helper on 2026-09-24; written only by `scripts/new-virtual-alex.mjs`, and gitignored,
  so V21 checks it on the operator's machine and warns that it is absent everywhere else). Everything
  else still breaks the rules, which the audit and a V21 warning both count on every run.
- **`system/install-state.json` is on the helper but deliberately NOT enforced yet.** An owner
  repository still on template build 17 or earlier runs its own old `/update`, and that text stamps
  this file with a raw `JSON.stringify` and then commits through the gate the same update just
  installed. Enforcing it now would refuse that update. It joins the list once no owner repository
  is below build 18.
- **The PowerShell side is an open gap, and it is not theoretical.** The audit lists the sites by
  file and line. See the end of section 3.

---

## 1. The ten rules

### Rule 1: Encoding

UTF-8 **without** a byte-order mark. LF line endings. Exactly one trailing newline.

This is the rule that pays for the whole standard, and it is the one this repo is breaking today.
The BOM is not cosmetic: **Windows PowerShell 5.1 `Set-Content -Encoding utf8` emits one and
`JSON.parse` rejects it.** Measured here on 2026-09-20, `work/18-recovery-layer/state/baseline.json`
and `work/18-recovery-layer/state/log-highwater.json` both carry a BOM, written by
`work/18-recovery-layer/check.ps1`.

Upstream this bug was found three separate times and patched three separate times, each time at a
READING site with a strip-on-read workaround and never at the writer. That is the pattern to refuse:
every new node reader of a PowerShell-written file starts the same bug over, and the patches
accumulate while the cause survives. Fix it at the writer or not at all.

### Rule 2: Header

Every file carries exactly four generated fields:

| Field | Meaning |
|---|---|
| `_purpose` | What this file is for, one sentence, in plain words |
| `_writer` | The exact script that owns this file, as a repo-relative path |
| `_generated_at` | UTC, ISO 8601, trailing `Z` |
| `_schema` | The schema identifier (rule 3) |

**These are produced by the writer helper and are never typed by hand.** A hand-typed `_writer` is a
claim about code made without reading it, and a hand-typed timestamp is worse than no timestamp.

Four fields replace the mess this consolidates: the inventory found **17 distinct doc-like header
names in use for the same idea**, of which 13 are underscore-prefixed (`_readme`, `_doc`, `_what`,
`_limits`, `_comment`, `_cap_note` and others) and 4 carry no underscore (`doc`, `meta`, `notes`,
`why_two_legs`). Bare `doc` appears in 6 files, `meta` in 7.

The underscore prefix is load-bearing, not decoration. Under plain alphabetical ordering (rule 6),
`_generated_at`, `_purpose`, `_schema`, `_writer` sort ahead of every payload key, so the header block
stays at the top of the file without needing an ordering exception. Rules 2 and 6 cooperate.

`_generated_at` in UTC with a trailing `Z` is what the writer helper stamps: `scripts/lib/json-writer.js`
owns the convention (`HEADER_KEYS` near the top of the file, and the determinism-versus-timestamp
rule in the comment above `writeJson`). An earlier version of this line pointed at
`scripts/log-append.js`, a file that does not exist in this Kit (corrected 2026-09-23).

### Rule 3: Schema identifier

`_schema` names **the schema and its revision**, never a bare number.

A bare `"version": 3` tells a reader nothing about what it is version 3 of, and two unrelated files
both sitting at version 3 look interchangeable when they are not. Illustrative shape:

    "_schema": "alex/recovery-baseline@3"

The exact token grammar is the writer helper's to fix at build time. The rule is the content: a name
and a revision, together, in one field.

### Rule 4: Version enforcement

**Every reader checks `_schema` and fails loudly on a value it does not know.**

Not a warning. Not a silent default to the newest shape it understands. A reader that quietly accepts
an unknown schema is how a format change becomes a wrong answer instead of an error, and that exact
failure class has already fired here: S5 read `$baseline.listeners` off a file with no `listeners` key
(error-log 2026-08-23). Loud failure is the whole value of carrying the identifier at all.

### Rule 5: Naming

`snake_case`. **No dates inside key names.**

The date clause is not hypothetical. `system/personal-data-allowlist.json` carries
`_reviewed_2026-07-20` and `_reviewed_2026-07-25` as literal keys, which makes it a review log smuggled
into a key namespace: every new review invents a new key, and no reader can enumerate them without
pattern-matching on dates. A date is a value. It goes in a value.

Casing across the set is mixed today, including `backup-destinations.json` in kebab-case, the only
kebab file among the guard-read state files.

**The one declared exception: identifier maps (added 2026-09-24, fleet Fix D, F11).** A map keyed BY
NAMES is data, not schema. The install profile's `lanes` is keyed by lane id, and one lane id is
`business-validation`; renaming it would need a migration on every family laptop's gitignored profile
or the lane silently resets, and it would buy nothing, because snake_case exists to make a schema's
own field names uniform, not to rename the things a map is keyed by. Two Kit rules contradicted each
other, and the STANDARD moved, narrowly:

- The exception is **declared, never inferred**. `ID_MAPS` in `scripts/lib/json-writer.js` names, per
  schema identifier, the dotted payload paths whose OWN keys are identifiers
  (`^[a-z0-9]+([-_][a-z0-9]+)*$`). Today it holds one row: `install-profile@1` declares `lanes`.
- **One registry, two readers.** The writer reads it by the schema it is writing; the audit (and so
  V21) reads it by the file's `_schema`. They cannot disagree, and a caller cannot opt in on its own.
- **Everything else stays snake_case**: a kebab key outside the declared path, one level below it, or
  in any file whose schema declares nothing, is refused by name exactly as before. The date clause
  still applies inside a declared map. `scripts/tests/test-json-writer.js` and
  `scripts/tests/test-json-standard.mjs` hold both directions, each negative shown failing on a
  deliberately leaking copy of the helper first.
- **Widening the list is a standard change.** Add the row, say why here, and add the test legs.
  `skills-lock.json` (skill names), `backup-destinations.json` (`google-drive`) and the run-status
  file's `jobs` (job names) have the same shape and are UNBLOCKED by this, not migrated: each still
  has its own reason to wait (a third-party lockfile shape; a PowerShell twin writer; a PowerShell
  writer), recorded in the audit's writer table.

The first file on it is `system/install-profile.example.json`, written only by
`node scripts/lib/install-profile.js --write-example` and on `json_standard.enforced[]`. The LIVE
`system/install-profile.json` is written through the same module by `scripts/skills-park.js`, but it
is not enforced: `/setup` still edits it in prose and older laptop copies are headerless, so its
readers stay tolerant of both shapes.

### Rule 6: Key ordering

Alphabetical, at every level of nesting.

Ordering is what makes rule 7 achievable. Without a fixed order, two runs over identical data produce
different bytes purely from key insertion order, and every diff becomes unreadable.

### Rule 7: Determinism

**The same data written twice produces byte-identical output.**

The one field that legitimately varies is `_generated_at`. Everything else is stable across runs. This
is the rule that makes a diff mean something: if the bytes changed, the data changed. Without it, no
guard can separate real drift from writer noise, and no reviewer can trust a diff.

**Determinism must not freeze damage (amended 2026-09-20).** The helper achieves rule 7 by NOT
WRITING when the content is unchanged, and that comparison is over parsed content, so a BOM, CRLF
endings or a missing trailing newline all compare equal to a clean file. Left there, a hand-edit that
breaks rule 1 becomes PERMANENT: the audit flags it forever and no writer ever repairs it, because
the content never changes again. Found on `work/07-email-triage/state/job-threads.json`. So the rule
is precisely: same content AND same bytes means no write; same content but different bytes means
REPAIR the bytes while KEEPING the existing `_generated_at`, because the content genuinely has not
changed and moving that stamp would misreport when it last did.

### Rule 8: Formatting

Pretty-printed, consistent indentation, one indent width across the system.

These files get read by humans during incidents. A minified state file at 3am costs more than the bytes
it saves.

### Rule 9: Shape

One shape per concept. **No bare value where an object belongs.**

If a concept can ever carry a second attribute, it is an object from the start. Promoting a bare string
to an object later is a schema change (anti-goal 3) and breaks every reader at once. Deciding this
correctly on day one costs nothing. Deciding it late costs a migration.

### Rule 10: Empties

No overloaded nulls. **Absent is distinct from empty.** Each field means exactly one thing.

`null`, `""`, `[]`, `0` and a missing key are five different statements. A field that uses one of them
to mean "not applicable" and also "not yet measured" and also "measured as zero" cannot be read
correctly by anyone, including its own author six weeks later. If a field needs to express "unknown",
it gets an explicit way to say so.

## 2. Scope

**The rule: a file is in scope when we define its schema. It is out of scope when an external system
defines it.**

Who writes the bytes is irrelevant. What matters is who owns the shape. Our code writing a file does
not make its schema ours.

**In scope here:** `system/*.json`, `work/*/state/*.json`, `work/*/config/*.json`, `skills-lock.json`.
These are the files Alex defines, writes and reads.

**`.jsonl` files are not documents, so the ten rules do not apply to them as files.** A stream of
rows cannot carry one header, and appending is the whole point of the format (several of them merge
by union in `.gitattributes`). What the rules CAN reach is the row: `scripts/run-log.mjs` and the
template changelog writer in `scripts/build-online-template.mjs` already pass every row through the
helper's `canonicalText()` and collapse it to one line, so each row has sorted, snake_case keys.
The other row writers still use a raw `JSON.stringify`; a small row helper beside `writeJson()`
would be the way to reach them, and nothing has needed one yet.

### Explicitly out of scope

**Claude Code harness files.** `.claude/settings.json`, `.claude/settings.local.json` and the rest of
the harness surface. Anthropic defines those shapes and changes them on its own schedule. Imposing a
house convention would break the harness and be silently reverted by the next update.

**Anything under `.agents/skills/`.** Third-party skills bring their own files and their own shapes.
We did not define them and we do not get to reformat them.

**Any file whose inner shape belongs to a service.** If a file is a request payload, an export, or
anything sent to or received from somewhere else, the receiver owns its shape, and applying house
casing or key-ordering rules to it breaks it at the far end. The test is about schema ownership and
not about which program wrote the bytes, and this case is exactly why.

---

## 3. Enforcement, in order

The order matters. Each step depends on the one before it.

### Step 1: The writer helper

`scripts/lib/json-writer.js`. Done, ported, and proven by `scripts/tests/test-json-writer.js` (70
assertions, both directions).

    const { writeJson, readJson } = require('./lib/json-writer');

    writeJson('system/thing.json', { alpha: 1 }, {
      purpose: 'One sentence, plain words, saying what this file is for',
      writer: 'scripts/whatever-owns-it.js',
      schema: 'thing@1',
    });

    const doc = readJson('system/thing.json', 'thing@1');   // throws on any other schema

The helper stamps the four header fields itself; a caller never types them. It refuses a
non-snake_case key, a date inside a key name, an underscore-prefixed payload key and a malformed
schema identifier, each by name, before anything touches the disk. It writes atomically, staging
beside the destination and replacing in one operation, so a process dying mid-write leaves the OLD
file intact and never half of a new one.

**Determinism is achieved by NOT WRITING when the content is unchanged**, so `_generated_at` means
when the content last changed rather than when a script last ran. If the content matches but the
BYTES do not, it repairs the bytes and keeps the existing timestamp, so a hand-edit that broke rule 1
gets healed rather than frozen in place.

### Step 2: Migration, in waves by blast radius

**Three files are done** (the status block at the top names them). Move the next one at a time, by the
recipe in the appendix, in this order:

1. **Files with ONE writer and no guard reading them.** Smallest blast radius. Start here.
2. **Files with several writers.** Every writer moves in the SAME commit; there is never a state
   where a migrated and an unmigrated writer alternate shapes on the same file.
3. **Files a guard or a check reads.** These go last, and they are what the recipe's step 13 is
   about: migrate the file AND prove the guard against the new shape, then break it on purpose to
   confirm the guard actually refuses.

### Step 3: A check, once there is something to check

**Shipped 2026-09-23 as validator check V21**, scoped to an explicit list, where a file joins the
list in the same commit that moves its writer onto the helper. That makes the check a RATCHET: it
cannot regress what has been fixed and it never blocks what has not. **A check before the migration
blocks every commit against files nobody has moved, and a check before the helper has nothing to
tell an author to do about a failure.** Hence the ordering.

How the pieces fit:

- **The list** is `system/kit-manifest.json` -> `json_standard.enforced[]`, not the project registry
  the upstream standard uses. The registry (`system/manifest.json`) is edited by `/new` on every
  install, so a Kit release adding a path to a list inside it would be editing a file every owner
  has already changed, which is how an update conflicts. The Kit manifest is the Kit's own. A missing
  list is a FAILURE in both readers below, never a pass: a check with no scope asserts nothing.
- **V21** (`scripts/validate-alex.js`) runs in both commit gates, the Kit's and the online one, inside
  their validate-alex leg. It is a CONTENT leg, so it still blocks inside a cloud session. A tracked
  enforced file that goes missing fails; a gitignored one that is absent only warns, because that is
  a machine whose writer has not run yet.
- **The ratchet in CI** is `node scripts/json-standard-audit.js --enforced`. Same parser, same rule
  engine as V21, plus one thing V21 cannot see: a code path that writes an enforced file with a raw
  `JSON.stringify` fails it, even when that file is not on disk yet. **What "a code path" covers,
  exactly (corrected 2026-09-24, fleet Fix D, F05):** `writeFileSync`, `writeFile` (plain,
  `fs.promises.` and imported from `fs/promises`) and `appendFile(Sync)` whose data argument carries
  `JSON.stringify` directly or through a name that is ever given it, on any earlier line; and any
  `createWriteStream` opened on the file, judged by its target alone. Until that date only the first
  form with `JSON.stringify` inside the argument list was seen, so a two-line writer passed while this
  line said it failed. **What it still cannot see:** a destination it cannot resolve statically (a
  path computed at runtime, or a property like `skillState.PROFILE_REL`), which is LISTED as
  unresolved and never counted, and JSON that reaches the call through a `function` declaration's
  return value or from another module (an arrow function held in a `const` IS followed). A name is judged over every value it is ever given, so the scan over-reports rather
  than under-reports.
- **Every enforced path is pinned `text eol=lf` in `.gitattributes`.** Without the pin, a clone made
  with `core.autocrlf=true` (the Git for Windows default, and GitHub's Windows runner) checks the file
  out CRLF and V21 refuses a commit that did nothing wrong. `scripts/tests/test-json-standard.mjs`
  fails when an enforced path has no pin.
- **Adding a file:** move every writer onto `writeJson()` (recipe step 10), then in the SAME commit
  add the path to `enforced[]` and its line to `.gitattributes`. Before that commit, map every writer
  that can reach the file, including the old copies of `.claude/commands/*.md` still running in owner
  repositories: those are writers too, and they are why `system/install-state.json` waits.

### THE POWERSHELL GAP, measured on this repo 2026-09-20

The helper is node. **Eight PowerShell sites in this repo write JSON to a file** and none of them can
reach it. They are named here by function or by the file they write, never by line number, because
line numbers move with every edit (this list once said `vault-backup.ps1:251` for a site that had
moved to `:223`). For today's line numbers run `node scripts/json-standard-audit.js`, which lists
every site on every run:

    scripts/lib/close-out.ps1        Set-AlexQuotaCapped and Clear-AlexQuotaCapped (system/quota-state.json)
    scripts/lib/run-status.ps1       Write-RunStatus
    scripts/vault-backup.ps1         the backup-destinations state ($destState)
    work/18-recovery-layer/check.ps1 the -Init baseline ($baselineFile) and log high-water mark ($hwFile),
                                     then on every sweep the log high-water mark ($hwFile) and the soul
                                     high-water mark ($soulHwFile)

Six of those use `Set-Content -Encoding utf8` or `Out-File -Encoding utf8`. **In Windows PowerShell
5.1 that emits a byte-order mark, and `JSON.parse` rejects a BOM.** This is rule 1's founding
incident, and it is not hypothetical here: `work/18-recovery-layer/state/baseline.json` and
`work/18-recovery-layer/state/log-highwater.json` both carry a BOM on this machine right now.

There was once a PowerShell twin of the helper, proven byte-identical to the node one across Arabic,
Swedish, astral emoji and thirteen awkward numbers. It was retired upstream when that platform went
away, so there is nothing left to port. **The gap is named rather than closed**, and closing it is a
real decision with three options: rebuild a PowerShell helper, move those writers to node, or accept
the BOM and make every reader strip it. The third is what this standard exists to stop.

---

## 4. The anti-goals

Three things this standard explicitly does not do. Each is a tempting move that would cost more than the
standard is worth.

### Anti-goal 1: No reformatting outside the helper

Files change encoding, ordering and formatting **when their writer starts going through the helper**,
and at no other time. No bulk sweep, no drive-by fix, no "while I was in there".

A reformat outside the helper produces a large diff that nothing verified, buries any real change inside
it, and gets silently undone the next time the unmigrated writer runs. It looks like progress and leaves
the system exactly where it was.

### Anti-goal 2: No file migrates before its readers are known

If it is not established who reads a file, that file does not move. Resolving ownership is a
prerequisite to migration, not something discovered during it.

"Known" means named read sites with file and line, INCLUDING the routes a grep does not find. The
upstream ownership pass turned up three readers a filename grep could never have found: one fetching
the file over a URL path, and two building the path by joining a directory to a value read from a
config file. Check those three indirect routes every time: a URL or route string, a path assembled
from config, and a path read from an environment variable. **"No reader found" is only ever "no
reader found by the searches actually run", and it is reported that way.**

### Anti-goal 3: A key rename is a schema change

Renaming a key is **not** a formatting change and does not travel in a formatting wave. It gets the full
treatment: a `_schema` revision bump, every reader updated in the same commit, and a read-back verifying
the readers still work.

This is the anti-goal most likely to be violated by accident, because a rename looks like tidying while
it is in the editor. It is not. It is the one migration operation that can break a reader silently, and
under rule 4 an unknown `_schema` is exactly what turns that silence into a loud failure. Use it.

---

## Appendix: the migration recipe

Distilled upstream from a real migration wave: a first file with one writer, then a hard case with
four writers across two languages that took four passes just to establish its own writer set. Every
step below was earned by something going wrong. Follow it per file instead of re-deriving it.

**1. Map the file before touching it.** Grep the basename across the whole tree, not just `scripts/`.
**Writers, not just readers, can be prose:** `.claude/commands/**` instructions that say "update
X.json" are live writers, and no code sweep finds them. Check the three indirect routes too: env
vars, paths assembled from config values, URL paths.

**2. When a brief cites `file:line` as a reader or writer, read that line in context first.** A
*mention* is not a *dereference*. Twice now a citation has pointed at a comment: In one case a cited "reader" turned out to be a
COMMENT about a different file, naming this one as a prior instance of the same trap. Grep cannot tell a mention from a use.

**3. Trace to the line that SERIALIZES.** A script that appears to mutate the file may only be calling
another script's function. One file counted three writers by its own `_doc`, four by
scripts-that-mention, five by write paths, and **two** by the only measure that matters: functions
that actually serialize. Everything else is a caller. Counting files gives the wrong answer.

**4. A named remote writer may not write bytes at all.** Establish whether it writes the file or only
*signals* a local writer. A remote service was documented as a writer of one file; it
actually inserted a metric that a LOCAL command then mirrored. That distinction reshaped the whole
migration and removed a `last_source` value that would otherwise have lied.

**5. Check for an mtime consumer.** The determinism gate stops the file's mtime tracking runs. If
anything reads mtime as liveness, that breaks the moment you migrate. Stop and report.

**6. Audit the payload.** snake_case, no dates in key names, at every depth. Then hunt the subtler
class: **anything that changes without the content's meaning changing.** A per-run timestamp
(`generated`), a per-run free-text note (`_note`), both defeat the determinism gate and both must
move to the header or come out. Timestamps that survive are content and move only when their state
moves.

**7. Unify formats while the writers are in one field of view.** Merging writers is the only moment
divergence is visible. One file had a writer stamping local time and another
stamping UTC, and a gate's TTL arithmetic read whichever it found: a two-hour skew, not a cosmetic
difference.

**8. Multi-writer: answer concurrency explicitly.** Atomic rename guarantees no torn file, but two
overlapping read-modify-write cycles still means last-write-wins and a silently lost update. State the
real schedules, name the window and its likelihood, and **do not build locking unbidden**, propose
the route.

**9. Prose writers get a CLI, not an instruction.** The standard's own hierarchy puts "a rule in
instructions" at the weakest tier. Give the prose writer a small setter CLI that reads through
the reader, applies the change, and writes through the writer. The agent hands over CONTENT as
arguments; the helper owns SHAPE. Which sensor triggered the write is content, so it goes in the
payload, not the header. This applies to a HUMAN hand-editing JSON too: that is also a prose writer,
and an enforced file with no CLI is a trap, because the next hand-edit fails the check with no tool
to comply.

**10. Migrate every writer in ONE commit.** No partial state where a migrated and an unmigrated writer
alternate shapes on the same file.

**11. Prove positive, then negative, at the REAL call sites.** Conforming bytes, normal reader output,
repeat write produces no write, cross-language byte identity where two languages write. Then: wrong
schema stops the actual consumer process, bad key throws naming the key, CLI refuses unknown enum
values.

**12. Make every new assertion fail once on purpose.** Three vacuous assertions have shipped in this
wave, a pattern that never matched the artifact, a buffer compared to itself. An assertion that has
never failed is indistinguishable from one that cannot.

**13. A guard-read file means proving the GUARD against the migrated shape.** A check and its input
file can be wrong in *compensating* ways, and then each conceals the other. The real case: a recovery check
dereferenced three keys that no writer had ever produced, so one whole branch of it had never fired
once in its life; meanwhile the file still described a state that had ended weeks earlier. The check
that would have caught the stale state was blind to it, and the stale state was the only thing that
would have exposed the blindness. Never assume the guard was
ever right: read what it dereferences, compare that to what the file actually contains, and if they
disagree, fixing the guard is part of the migration. Then fail its assertions on purpose - a check
that has never fired has never been tested.

**14. Sweep what the move invalidated.** Every pointer to an old path is drift you created. Delete
BOM strips and other read-side workarounds **last**, only once no writer can emit the defect, a
silent cure at the read site is how a file accumulates patches while the cause survives.

---

## Appendix: environment note

A fact about Windows machines, not a rule.

**Two path worlds in one pipeline.** Git Bash resolves `/tmp` to the user's `AppData\Local\Temp`;
Windows Python resolves it to `C:\tmp`. A `cp` to `/tmp` from bash therefore lands somewhere Python
then reports as missing, which reads as "the backup failed" when nothing failed. When a step mixes
bash and Python, resolve the path once (`cd /tmp && pwd -W`) and hand the absolute Windows form to
both.

---

## Appendix: why this document lives in `docs/`

`system/` was the tempting home: this standard governs the files under `system/`, and putting the
rules next to the data they govern reads as tidy.

Two reasons it is here instead, and both generalise to any future standard:

1. **`docs/` is the human-readable layer.** A convention document is read by people, and the rules
   that govern machine-read data are not themselves machine-read data.
2. **Check `git check-ignore` on the candidate path BEFORE writing, not after.** Upstream, `system/*`
   is default-deny gitignored with a handful of files re-included by name, so a standard written to
   `system/json-standard.md` would have been invisible on the public repo and could never have
   reached an installed copy at all. A document nobody can see is not a weaker version of a standard,
   it is not a standard.

**The general rule:** `system/` is for machine-read data, `docs/` is for the rules that govern it.
