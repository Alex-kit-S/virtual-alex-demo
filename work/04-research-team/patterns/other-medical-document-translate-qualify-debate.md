---
class: other
created: 2026-08-08
last_used: 2026-08-08
times_used: 2
---
# Medical document: translate -> qualify -> adversarial debate -> family-language deliverable

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Read this foreign-language medical document and tell my family what it means." A fixed
document (no external research), a lay audience in a second language, and a domain where a
confident wrong answer causes real harm. Retro-fitted 2026-08-08 after its second run; the first run
(2026-07-12) wrote no pattern.

## Team
Sequential, master-gated at every hand-off. No parallelism: each agent's value comes from
attacking the previous one's finished work.

- **Agent 1, translator + validator:** extract and translate every value, unit, reference
  range and printed flag. Compute an INDEPENDENT flag per row and report any disagreement
  with the lab's own. Verify absences by search. | tools: PyMuPDF, Python | output: complete
  analyte table + counts + unresolved items.
- **Agent 2, senior physician:** severity, what the abnormals mean TOGETHER, ranked
  differential, management with real intervals, red flags. | output: the report under attack.
- **Agent 3, adversarial:** rule on the master's binding challenges, audit Agent 2 point by
  point (AGREE / DISAGREE / AMEND with evidence), hunt what both missed, then RESOLVE into
  the final consolidated report in lay language. | output: the thing that ships.

## Synthesis approach
The master owns verification, not just routing:
1. **Extract the source YOURSELF, before Agent 1 runs.** Then diff. This converts Agent 1
   from an unchecked oracle into a second independent read. On the second run they matched
   line-for-line across every analyte, which is what made the dataset trustworthy downstream.
2. **Recompute every arithmetic claim** each agent makes. Both runs had agents assert
   derived numbers; all verified, but the check is the point.
3. **Hand the adversary a real weapon.** The second run's master found Agent 2 had chosen the
   flattering of two true framings (a value as a multiple of its floor, versus how far up its
   reference band it sits) and made it a binding challenge. An adversary given only "go attack this" produces
   theatre; one given a specific asymmetry produces a ruling.
4. **Master amendments are stated separately from the agents' verdicts**, never merged.

## Lessons
- **A printed lab flag is not automatically a patient finding.** A low flag on one absolute count
  was a reference-range configuration defect, provable from inside the document (its floor
  implied a percentage floor 30x the same report's printed percentage ceiling). Always test whether a
  flagged row contradicts another row of the same document.
- **The adversarial seat pays for itself in the differential, not the data.** On the first run it
  added a screening test neither earlier agent had proposed. On the second it caught a material
  clinical error: Agent 2 favoured one carrier state, then prescribed the test for a different one
  and called it definitive. A single pass ships that.
- **Ask what free information exists before designing new tests.** The second run's highest
  value-per-effort finding was "does an old blood count exist", which both earlier agents
  missed while planning elaborate future panels.
- **Cut pseudo-quantitative confidence.** "Roughly 1 in 10" beside traceable lab values
  borrows their credibility and traces to nothing. Ordinal words carry the same information
  honestly. Check that stated probabilities actually partition; the second run's did not.
- **A conditional does not survive translation.** "If the complaint was X" becomes "the report
  says X is happening". Never write a reconstructed symptom into a
  document a family keeps; ask them instead.
- **Split the verdict when one question hides two.** "Is the deficiency causing harm today"
  (near-certain) and "can we prove stores are adequate" (one test short) deserve different
  confidences. Blending them understates the first and overstates the second.
- **Route the frightening detail to a doctor-facing appendix**, keep the symptom trigger in
  the family document. Naming a searchable disease the evidence disfavours buys anxiety and
  nothing else. Frame red flags as an instruction list that opens by stating none of it is
  present.
- **RTL build: wrap in LOGICAL order, shape each line only at draw time.** Reshaping a
  paragraph then letting the layout engine wrap it scrambles line order. Also: route any
  table cell containing Arabic through the Arabic font even if the column is nominally Latin,
  and wrap Latin tokens carrying `#`/`%` in an explicit LTR embedding (U+202A/U+202C) or bidi
  renders `ABC#` as `#ABC`. python-bidi rejects the modern U+2066 isolate.
- **Render the PDF and LOOK at every page.** The second run's build exited 0 with two real defects
  on page 1. One low-resolution glance also produced a false positive, so zoom before ruling.
- **Privacy is part of the pattern.** Medical deliverables stay local: prove `git check-ignore`
  on the real paths, skip Notion deliberately, and delete compiled artifacts (`__pycache__`
  holds the content too).
- **State the no-web-search consequence in the claims table.** Clinical judgement here is
  model reasoning capped at `med`; guideline thresholds are recalled, not fetched. Say so.
