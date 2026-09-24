# /radar - Weekly Capability + Opportunity Radar

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#15 /radar · LIVE · Trigger: weekly Monday 07:30**
> Registry: `system/manifest.json` · Spec: `work/15-radar/CLAUDE.md` · Status: `vault/projects/radar/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Full spec: `work/15-radar/CLAUDE.md` (read it first, it is authoritative).

One engine, three taps, sequenced. Tap 1 (capability upgrades) is the only one on by default. Tap 2 (content angles) is nearly free once the engine runs. Tap 3 (things to build and sell) stays dark behind the drop-rule until Tap 1 has earned trust.

**Alex proposes, you decide.** Nothing advances past `Interesting` unattended, except an auto deep-dive reaching `Researched`, because research is reading. Nothing is ever installed, built or bought without an explicit yes.

## Modes
- `/radar` - the full loop on demand.
- `/radar --weekly` - the Monday sweep (job `Alex-radar`), surfaced as the Radar section of `/morning-brief`.
- `/radar {url}` - **seed mode.** You dropped a link. Skip the fetch, run steps 2 and 4 to 9 on that ONE item. Your reaction goes to `decisions.md` like any other, and seeded items warm the taste profile faster than anything else, because you already had an opinion when you sent it.

## Steps

1. **First-run check.** Read `vault/projects/radar/status.md`. If it does not exist, create `vault/projects/radar/` and copy the missing memory files from `work/15-radar/seeds/` (`taste-profile.md`, `friction-list.md`, `landscape-memory.md`, `decisions.md`), stamping `created:` in each. Write `status.md` with the board table header, the thresholds (Fit >= 16, corroboration >= 2) and `last_run: null`. **Never overwrite a file that already exists** - the seeds are for what is missing, and a taste profile is the one file in this system that cannot be rebuilt.

2. **Read memory.** `taste-profile.md`, `landscape-memory.md`, `decisions.md`, and `friction-list.md` (the demand side). Load `soul.md` for voice and priorities.

3. **Resolve the feed list, then fetch.**
   - `node scripts/lib/radar-feeds.js --json` is the single source of truth for which feeds this machine sweeps. It reads `system/install-profile.json` through the same reader the skill layer uses.
   - **If `configured` is false, STOP the sweep and say so.** Print the `note` it returns, offer to add three or four sources now (ask what the owner already reads; never propose a list of your own), and write them into `system/install-profile.json` on their yes. Do not substitute a default list. Do not "just this once" pick some feeds to demonstrate the run. An invented feed list is the one failure this design exists to prevent.
   - Report every `warning` it returns. A dropped feed row is news, not noise.
   - Fetch each feed with WebFetch (load via ToolSearch first). **Name any feed that did not answer**, and carry on with the rest. A silent feed is reported, never absorbed.
   - Window: the last 8 days, widened by Run Check 7 when a sweep was missed.

3b. **Capability diff (first run of each month only).** Inventory what is actually installed here - `claude --version`, the MCP servers that answer, `node scripts/lib/radar-feeds.js` for the self-watch feeds - and diff it against releases from the `self_watch` feeds since the last diff (the date is in `status.md`). Upgrade candidates become ordinary board rows at `Interesting` or below. **Never install anything.** Skip this entirely on the other runs of the month and do not mention it.

4. **Run Checks, all eight, before any output is written.** 1 dedup-before-count · 2 permission status gate (stop at `Interesting`) · 3 corroboration (2+ independent sources for high confidence) · 4 cold-start guard (seed from the vault on run 1; low-confidence until 20+ dated decisions) · 5 recency cap + drift sweep on the taste profile · 6 Tap 3 leash (dark until Tap 1 has 3+ good weeks) · 7 **missed-run detection** · 8 outcome metric. Full text in the spec.

   **Run Check 7 is load-bearing in this version and gets said out loud every run.** There is no server collecting while this machine is off, so a missed Monday is a lost week rather than a delayed one. Read `last_run` from `status.md`. If sweeps were missed, the output OPENS with `Missed N sweep(s) since YYYY-MM-DD` and the window widens as far as the feeds still reach. If none were missed, say `no sweeps missed` anyway - a check that only speaks when it is unhappy is a check nobody can tell is running.

5. **Friction match, then score.** Check every survivor against `friction-list.md` FIRST. A match is named out loud ("this kills friction #3"), justifies a maxed Leverage score, and is presented **even in a week when nothing else clears the bar**. Then score the rubric: real-vs-hype, fit-to-stack, leverage, effort-inverse, each 1-5, total out of 20. Route to the right tap. Maintain the list: a new workaround built means a new row; a friction killed means a strikethrough plus the date, never a deletion.

6. **Write.** Add or update board rows in `vault/projects/radar/status.md` at `Interesting` or below only. Update `landscape-memory.md` with deduped theme counts. Write `vault/projects/radar/radars/YYYY-MM-DD.md` with the shortlist, the scores and the corroboration counts.

7. **Auto deep-dive.** If the top item clears Fit >= 16 AND corroboration >= 2, invoke `/research-team` (#04) with its decision-brief pattern. Rate cap: 1 on an on-demand run, 2 on a weekly sweep, highest-scored only. Produce the brief to `outputs/radar/YYYY-MM-DD/{slug}.md` plus `vault/research/{slug}.md`, move the row to `Researched`, and **then stop**. No adopting, no installing, no spending. **Zero deep-dives is the common and correct outcome**; if the allowance is tight, skip it and say why.

8. **Present, in Alex's voice.** Lead with the ONE item that clears the bar, or with "nothing cleared the bar this week", which is a good result and not an apology. Then the memory update, then any theme that is genuinely accelerating after dedup (check the amplified-not-accelerating flag before calling anything a trend). Name any auto brief and where it is. No digest-speak, no padding to look busy.

9. **On a yes / no / park:** append to `decisions.md` with the date and **their reason in their own words**, update `taste-profile.md` (dated append, never a blob overwrite), and only THEN advance a board row past `Researched` (auto items) or `Interesting` (everything else).

## Post-Run
- `vault/log.md`: `## [YYYY-MM-DD HH:MM] radar | {n} scored, {m} presented, outcome {x/y}`.
- New companies or people met in a deep-dive go to `vault/business/` and `vault/people/` per the intake protocols.
- Refresh `status.md`: the board, `last_run`, the outcome metric. Update `vault/index.md` only when a page type is new.
- **Never install, build, deploy, spend, or advance a row past `Interesting` without an explicit yes.**

## Guardrails
Fabricates nothing. A feed that failed is named. A week with nothing is reported as nothing. Every score carries its confidence label while the profile is cold. The feed list is never invented and never defaulted.

## Close-Out
Print the Close-Out Report. Radar extras: the feed count and any feed that failed to answer, Run Check 7's verdict either way, zero-item runs reported as a result, and no row advanced past its permitted rung.
