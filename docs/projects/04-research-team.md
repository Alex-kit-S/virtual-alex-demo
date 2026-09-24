# 04 - Research Team

## What it actually does
Runs a real research question properly: it plans the work, shows you the plan and what it will cost
before spending anything, then splits the question across up to three agents working in parallel,
each forced to source its claims. They report, and one seat argues with the results rather than
summarising them. You get a brief with a claims table, where every claim carries its source or is
marked unverified.

It also has an adversarial mode: give it a claim and it will genuinely try to refute it, grounded in
outside evidence, and come back with CONFIRMED, REFUTED or UNRESOLVED. That is the sanctioned way to
check something Alex itself told you.

## Why it exists
The gap between "ask a question and get a confident paragraph" and "ask a question and get something
you would put your name on" is sourcing and disagreement. This does both on purpose.

## The three-lane cap, and why it matters
Parallel agents are the fastest way to spend a day's Claude allowance. The cap is three at a time,
and it binds the pattern library too: several patterns here were written for a bigger plan and name
more lanes, and loading one does not lift the cap. Extra lanes run as a second pass, which is usually
better research anyway, because the later lanes see what the earlier ones found.

## Works together with
- **[Prompting](26-prompting.md)** - turns a vague ask into the precise brief this runs on.
- **[Meeting Intel](06-meeting-intel.md)** - research goes in, a document comes back out.
- **`brand/config/writing-style.md`** - a blocking house-style pass on every prose deliverable.
