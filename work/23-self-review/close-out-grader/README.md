# Close-Out Grader (separate-context, advisory)

Built 2026-07-07 (upgrade-scan item 2). Implements Anthropic's Outcomes pattern inside Alex's
Close-Out Gate item C: a grader that sees ONLY the finished artifact + a written rubric, never the
producing context's reasoning, and returns per-criterion PASS/FAIL.

## Why
Close-Out item C ("delivery verified: check prose vs soul.md + My Words; render visuals and look")
was self-graded by the same session that produced the output. Self-preference by construction: the
maker is the worst judge of whether it drifted. The 2026-07-03 brand incident (a dashboard shipped
with improvised off-brand styling because the brand file was never read, caught by the owner not by
Alex) is exactly the class a cold grader with a rubric catches mechanically.

## What's here
- `rubric.md` - independently checkable criteria (palette, accent, type, red, logo; dashes, AI-tells,
  softeners, rhythm, the owner's words; pre-flight). Derived from brand-config.md + soul.md; those files win
  on any disagreement.
- `grader-prompt.md` - the subagent mission. Paste as an Agent-tool prompt (general-purpose/Explore)
  with the rubric + the artifact. Matches Alex's existing convention of inline subagent prompts (like
  the research-team), so there is no new Claude Code config surface to maintain.

## How to run it (Close-Out item C, identity-carrying outputs)
1. Finish the identity output (visual and/or prose).
2. Spawn a fresh subagent with `grader-prompt.md` as its mission; paste in `rubric.md` and the
   artifact (for a visual: the source with its hexes/fonts/logo refs + whether a pre-flight line was
   printed). Give it nothing about how or why you built it.
3. Read the VERDICT. PASS -> item C is `verified (grader PASS)`. FAIL -> fix the named criteria and
   re-grade, or (the owner's call) ship and record the FAIL + reason in the Close-Out Report.

## The hard constraint: ADVISORY, never a new blocking gate
The grader reports; it does not stop anything. Scheduled runs exit ONLY on the mechanical A-checks in
`scripts/lib/close-out.ps1` (blank output, crash, not-logged-in, quota, non-zero exit). This grader is
deliberately NOT wired into that script, so a grader FAIL, a grader that is slow, or a grader that is
unavailable can never fail one of the 15 scheduled jobs. It is a judgment aid for item C, advisory
until it earns promotion. Do not add it to close-out.ps1.

## Verified 2026-07-07
Run against a reconstructed 2026-07-03-style violating artifact (retired-brand navy #0C1651 + Arial +
em-dashes + "it's important to note" corporate voice) and a compliant one. The grader FAILED the
violator on the brand + voice criteria and PASSED the compliant artifact. Evidence in
[[projects/self-review/status]] and the session log.
