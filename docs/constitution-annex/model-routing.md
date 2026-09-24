# Constitution annex: model routing

The enforced contract is `system/manifest.json` -> `meta.model_routing`. Validator V13 reads that
structured data and asserts it against the actual wrapper scripts. `CLAUDE.md` keeps the operative
rule. This page explains why it is built that way.

**The current default is `claude-sonnet-4-6`, and the manifest is authoritative.** If this sentence
and the manifest ever disagree, the manifest is right and this page is stale, which is precisely why
check C21 tests this line against the ledger every week.

## Why the contract is data and not prose

An earlier version of this system had a checker that worked out what model things SHOULD run by
regex-reading a sentence in the rulebook. It worked until the day a legitimate exception was written
down: the sentence gained a paragraph, the regex could not read a paragraph, and the checker
false-failed and blocked the whole build.

The general rule that came out of it, and it applies far beyond models: **a validator must never
derive its expectation from prose.** Desired state lives in structured data. The check reads the
data. The prose explains the data to humans and is allowed to be imperfect, because nothing depends
on parsing it.

## What is actually pinned here

Only the LOCAL scheduled wrappers, because those are the ones nobody is watching.

- `meta.model_routing.local_wrappers.pins` names each `scripts/run-*.ps1` and the exact `--model` it
  must pass.
- `deterministic_no_pin` lists the wrappers that make no model call at all and cost nothing.
- **V13 is complete by construction:** a wrapper appearing in neither list FAILS the build. That is
  the guard against the real failure, which is not "somebody picked the wrong model" but "somebody
  copied an existing wrapper, forgot the `--model` flag, and it silently inherited the expensive
  default".

## Why this matters more on a Claude Pro plan

On Pro the allowance is the binding constraint. A scheduled job quietly running on the most
expensive model does not produce an error: it produces a day where Alex works fine in the morning
and refuses to do anything after lunch, with no obvious cause. The pin is what stops that, and V13
is what stops the pin from being forgotten.

Interactive sessions keep whatever default is configured. Only the unattended jobs are pinned.
