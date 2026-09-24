---
squad: research
class: iterative (fan-out then converge)
progression-model: iterative        # doc 2 taxonomy: self-contained | iterative | pipeline
created: 2026-07-20
roster: up to 3 lanes + 1 synthesizer (the master session)
---

# Squad: research

The default #04 shape, written down so the owner commissions it in one line instead of re-dictating the relay. This is EXTERNAL-evidence research: "what is true out there," not "is this Alex conclusion right" (that is the merge-decide squad's adversarial job, or Adversarial Verification Mode).

## Question shape it fits
market-scan | competitor-deep-dive | technical-evaluation | person-or-company-profile | any open question that gets settled by gathering outside evidence.

## Roster (UP TO 3 lanes, each narrow, independent where possible; more inputs means a second pass, not a wider first one)
Each lane gets: a name, a one-sentence mission, a TOOL SCOPE (what it may touch, nothing more), and an OUTPUT CONTRACT (what it must return). Independent lanes run in parallel; dependent lanes wait.

| Lane | Mission (one sentence) | Tool scope | Output contract |
|---|---|---|---|
| L1 breadth | Map the space fast: who/what/where the evidence lives | WebSearch + WebFetch (read-only); Explore agent on the laptop | 8-15 sources ranked by weight, one line each, no conclusions |
| L2 depth-A | Answer the sharpest sub-question with primary sources | WebFetch, Chrome only if a site blocks plain fetch; docs | findings + every claim traced to a named source |
| L3 depth-B | A second independent angle on the same question | same, DIFFERENT sources than L2 | findings + sources; explicit "nothing found" is a valid result |
| L4 internal (optional) | Check the vault + Notion: is this already answered | vault_search.py, notion-search (read-only) | what Alex already knows; link, don't re-research |

## Convergence (the master session only)
The master synthesizes; lanes report, they do NOT conclude. Findings first, confidence levels, unknown stays unknown. Two lanes agreeing is NOT proof (see anti-laundering). Alex voice, no padding.

## Gates (every squad file carries these four)
- **Approval gate.** Show the roster (lanes + missions + scopes) BEFORE spawning. AskUserQuestion: approve / modify / answer-without-team. Sub-agents are the expensive path; never spawn before approval.
- **Anti-laundering.** Same-model lanes agreeing is not corroboration. A conclusion stands on external evidence, never on lane consensus. If every lane only reasoned (no external anchor), the finding is flagged WEAK.
- **Master-only-writes-vault.** Lanes never write the vault. Only the master session writes, and only the VALIDATED result. This matches #04 discipline and the memory-pollution rail (root CLAUDE.md, decision run 2026-07-20).
- **Timebox every lane.** Each mission ends with: "if reasonable effort turns up nothing, report 'nothing found' with what you tried; do not keep digging." An empty lane is a finding. Never re-spawn to retry an empty lane without a CHANGED approach.

## Commission line
`/research-team squad=research question="<the question>"`  (or just `/research-team <question>`, which is the default).

## Environment note
- **Laptop (Agent tool available):** independent lanes = parallel Agent spawns in one block (Explore for breadth, general-purpose for depth).
- **claude.ai project env (no Agent spawns):** run the lanes SEQUENTIALLY as isolated passes, same evidence discipline, same output contracts. The shape is identical; only the concurrency changes.

## Deliverable
Per #04 step 9: vault/research/{topic-slug}.md + Notion page + (team runs) a branded Claude Design deck or PDF to outputs/research-team/YYYY-MM-DD/. answer-without-team runs: the vault + Notion page IS the deliverable.
