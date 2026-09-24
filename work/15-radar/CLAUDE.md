# Radar

## Type
Automation. Weekly on the clock (Mondays 07:30), plus on-demand `/radar` and a ten-second seed mode `/radar {url}`.

## Purpose
Turn the weekly flood of noise in your field into a small number of decisions you actually act on, and get sharper about your taste every week while doing it. Not a digest. A research partner with compounding memory.

One fetch feeds one scoring pass, which routes what survives to three taps:
- **Tap 1 (capability upgrades):** new tools, models, libraries and techniques that make Alex and your existing automations better. **This is what ships first and it is the only tap on by default.**
- **Tap 2 (content angles):** items worth writing about. Nearly free once the engine runs.
- **Tap 3 (product opportunities):** things you could build and sell. **Stays dark until Tap 1 has earned trust**, and when it is live it runs behind the drop-rule (Run Check 6).

Core principle, encoded and not hoped: **Alex proposes, you decide.** Alex never advances an item past `Interesting`, never installs, never builds, never deploys, never spends, without an explicit yes from you. The permission rule is a status gate (Run Check 2), not a promise in prose.

The constraint this was built around is **output, not signal**. You are not short of interesting things. You are short of finished ones. So the radar is only allowed to be net-neutral or net-negative on open loops: every "ready to build" has to name what gets dropped to make room.

## The one real capability loss, stated plainly

The system this was ported from ran a server-side collector every morning and had an urgent lane that pushed breaking news to a phone the day it landed. **This version has neither, and there is no local substitute.**

What that means in practice, and it is not a footnote:
- **Breaking news waits for Monday.** A tool that changes on Wednesday reaches you five days later. For a weekly capability sweep that is usually fine. For a breaking change that takes one of your own automations down, it is not, and nothing here will tell you sooner.
- **A closed laptop DELAYS the sweep, it does not skip it.** Corrected 2026-09-20: an earlier draft of
  this line said a laptop asleep on the scheduled day loses the week entirely. That is wrong on both
  paths, and the code says so. `scripts/lib/gen-launchd.js:17` records that launchd replays a
  `StartCalendarInterval` missed during sleep, coalesced to one run on wake. Power-off is the one gap
  launchd cannot cover, and the `Alex-catchup` agent plus `CADENCE_HOURS.radar = 192` in
  `scripts/run-job.mjs` replays it at the next login. Leaving that row out is what would lose the
  week, which is why its comment says so.
- **What IS genuinely lost is same-day news.** There is no server collecting while your machine is
  shut and no urgent lane, so a breaking change reaches you at the next sweep rather than the same
  day. A delay of hours or a day costs nothing here. A gap of several weeks, with the machine off the
  whole time, is a real loss, because the feeds are windows and not archives.

The only mitigation is **Run Check 7, missed-run detection**, and that check is therefore load-bearing rather than decorative. Every run opens by reading the last run date out of `status.md` and, if a sweep was missed, says so in the first line and widens its own lookback window to cover the gap. That converts a silent loss into a visible one. It does not convert it back into signal.

Two honest consequences to carry:
- If something in your stack breaks and the fix is upstream, you will most likely find out from the breakage, not from the radar.
- If you go away for three weeks, the run that comes back will say "missed 3 sweeps" and look at the last 8 days. The two weeks in the middle are gone, and the run is not allowed to pretend otherwise.

## Entry Points
- **`/radar`** - the full loop on demand: fetch, dedup, score, present, update memory.
- **`/radar --weekly`** - the Monday sweep, registered as `Alex-radar`. `/morning-brief` surfaces the result as its Radar section, so it is not a separate ritual you have to remember.
- **`/radar {url}`** - **seed mode.** You spotted a link somewhere. Alex scores that ONE item through the same rubric and the same run checks (dedup against memory, corroboration search, friction match), files it at `Interesting` or below, and updates memory. Ten seconds of your attention. Every reaction on a seeded item warms the taste profile, which is the coldest part of this system on day one and the part that makes it worth anything by month three.

## Where the feed list lives, and why it is not in this file

**The template ships NO feeds.** Not a default list, not a starter list, not a commented-out list.

This is deliberate and it is the single most important design decision in the port. This Kit is installed by different people doing different work. A feed list is the most personal thing in the whole project: it is a statement about what you consider worth knowing. Shipping one person's feeds to everyone else produces a radar that is confidently, quietly wrong for every reader but one, and the failure is invisible because it still returns items every week.

So the feed list lives in the **per-install profile layer**, the same layer that already decides which skills are awake on this machine:

- **`system/install-profile.json`**, key `radar`, gitignored, machine-local. Yours.
- **`system/install-profile.example.json`** carries the shape plus three worked examples you can copy.
- **`scripts/lib/radar-feeds.js`** is the single resolver. It reads the profile through `scripts/lib/skill-state.js:readProfile`, the function that already owns profile reading, rather than opening the file a second way. One reader, one answer, as with the skill layer.

**With no feeds configured the run does not guess and does not invent.** It reports `no feeds configured`, names the file to edit, and exits clean. A radar that fabricates a source list to look busy is worse than one that says it has nothing.

`/setup` asks for this at install time (three or four sources, whatever you already read), and `/radar` asks once if it finds the list empty.

## Tools Used
- **WebFetch + WebSearch** (load via ToolSearch first) - the whole data layer. Public feeds only, no keys, no scraping, no paid tier.
- **Vault (Read / Write / Edit)** - the compounding memory. This is the hero of the project and it is plain markdown, so you can read and correct it yourself.
- **`/research-team`** (#04) - the engine behind the auto deep-dive. The radar is the trigger; #04 does the work.
- **`/morning-brief`** (#02) - the delivery surface for the weekly run.

## Sources (what a feed may be)
Every source must be **free and keyless**. That is a hard rule, not a preference: the moment a feed needs an account, this project acquires a credential to rotate, a bill to watch and a failure mode that looks like an empty week.

Shapes that work, with no opinion about which you want:
- **Search APIs with open endpoints.** Hacker News Algolia (`hn.algolia.com/api/v1/search?query=...&tags=story`) is the reference example: no key, no rate limit, returns JSON.
- **Release feeds.** Any GitHub repo publishes `https://github.com/{owner}/{repo}/releases.atom`. This is the best signal-to-noise source there is for tools you already depend on.
- **Blog and changelog RSS.** Most vendors publish one. Some do not, and then the answer is to fetch the news page, which is slower and more fragile. Note it in the profile rather than pretending the feed exists.
- **Community RSS.** Reddit (`reddit.com/r/{sub}/.rss`) and Discourse forums (`{host}/latest.rss`) are the earliest signal and the worst noise. Guardrails below.

**Self-watch lane.** A subset of your feeds should be the release feeds of the tools Alex itself is built from, not your field. That is the mirror: it tells you when the ground under your own system moves. Items from it score like any other item and are tagged `Improves: Alex`.

**Community guardrails while the taste profile is cold (under 20 dated decisions):** at most 2 community items presented per sweep; echo inside a single community counts as ONE corroboration, never N; no community item reaches high confidence without a non-community corroborating source.

## The status ladder (this replaces a database, and it is an upgrade)

Upstream this was a Notion database whose only structural job was the permission gate. It is a markdown table here, and that is better rather than a downgrade, for a reason worth knowing: **the donor system already maintained this board by hand**, because its Notion connector cannot list database rows. So the database was the write path and a hand-kept markdown table was the read path. Dropping the database removes the write leg and keeps the leg that was doing the work.

The board lives in `vault/projects/radar/status.md`:

| Item | Type | Improves | Fit | Corrob | Status | Effort | First seen | Source |
|------|------|----------|-----|--------|--------|--------|------------|--------|

- **Type:** Tool · Model · Library · Technique · Product
- **Status, and this ladder IS the permission gate:** `New` → `Interesting` → `Approved to research` → `Researched` → `Approved to adopt` → `Adopted` → `Dropped`
- **Effort:** Trivial · Moderate · Heavy
- **Fit:** the rubric total out of 20. **Corrob:** independent sources after dedup.

There is no `Page ID` column. There is no page. The row is the record.

## Scoring
No model re-checking a model. Deterministic gates, then one reasoning pass.

**Fit score, four axes each 1-5, total out of 20:**
- **Real vs hype** - is it shipping and usable, or an announcement and a demo video
- **Fit to your stack** - does it slot into what you actually run
- **Leverage** - how much it improves Alex or an automation you already have
- **Effort-inverse** - 5 is trivial to adopt, 1 is heavy

**Corroboration gate:** 2 or more independent sources after dedup before anything is presented as high-confidence or ready. A single-source item stays a watch item and is capped at `Interesting` whatever it scores.

*(The Tap 3 rubric, when that tap ever opens: real-vs-hype, buildable-with-your-stack, novelty, sellable-size. Same 20-point shape.)*

## Friction-first matching

`vault/projects/radar/friction-list.md` is the demand side: a table of the things that are currently annoying, and the workaround each one currently has.

Every sweep matches survivors against that table **before** generic scoring. A friction match is named out loud in the presentation ("this kills friction #3"), it justifies a maxed Leverage score, and **it gets presented even in a week where nothing else clears the bar**. That is the point: a tool that removes a real annoyance beats a more impressive tool that removes nothing.

Alex maintains the list. A new workaround built means a new row. Something that kills a friction means a strikethrough with the date, kept rather than deleted, because the record of what used to hurt is how you notice you have stopped noticing.

The template ships this list **generic and mostly empty**, seeded from `work/15-radar/seeds/friction-list.md`. Your frictions are yours. Inheriting someone else's is how a radar ends up hunting for a fix to a problem you have never had.

## Run Checks (all eight, every run, before any output is written)

1. **Dedup before count.** Canonical URL plus fuzzy title match. Collapse the same story from N sources into ONE item carrying N as its corroboration count. Reshares and echo count as one, never as N independent signals. This runs BEFORE anything is counted into landscape memory, which is what stops one loud story from looking like a trend.
2. **Permission status gate.** Never advance a row past `Interesting` without an explicit yes. Hard stop, no exceptions except the one named in Run Check 8's sibling below (auto deep-dive may reach `Researched`, because research is reading). This is the encoded permission model and it is the reason this project is safe to run unattended.
3. **Corroboration gate.** 2 or more independent sources before anything is called high-confidence or ready. Single-source items stay watch items.
4. **Cold-start guard.** On the first run, seed `taste-profile.md` from `soul.md`, `vault/me/goals.md` and `vault/me/preferences.md`. Until `decisions.md` holds 20 or more dated decisions, label every score "low confidence, profile still cold" and do NOT narrow hard on taste. An opinionated filter built on four data points is not taste, it is noise with a confident voice.
5. **Recency cap and drift sweep.** Weekly, run a contradiction sweep over `taste-profile.md`: store dated decisions rather than overwriting into a prose blob, cap recency weighting so the last three weeks do not dominate a year, and reconcile or drop contradictions. Hold out a few past judgments and check the profile still predicts them.
6. **Tap 3 leash (the drop-rule).** Tap 3 stays dark until the weekly sweep has run for 3 or more weeks with a positive outcome metric. When it is live, NO idea is presented as ready to build unless it names what you drop to make room. Net-neutral on open loops or it does not ship.
7. **Cadence and missed-run detection. Load-bearing here, see the capability-loss section above.** Read `last_run` from `status.md`. If one or more sweeps were missed, the output OPENS with `Missed N sweep(s) since YYYY-MM-DD` and the lookback window widens to cover the gap as far as the feeds still reach. Never silently absorb a gap. With no server-side collector behind it, this check is the only thing standing between a skipped week and a system that looks like it is working.
8. **Outcome metric, not approval rate.** Track the real signal: of the items presented, how many were adopted, shipped or posted **within 30 days**. Weekly approval share is secondary and is gameable by safe picks; the 30-day downstream-action count is ground truth. Both live in `status.md`.

## Auto deep-dive

High-conviction items get researched automatically, with no manual greenlight, on one principle: **research is reading.** Building, installing or spending still always needs an explicit yes.

- **Trigger:** Fit >= 16/20 AND corroboration >= 2 independent sources after dedup. Both thresholds are tunable in `status.md`.
- **Rate cap:** top 1 per on-demand run, top 2 per weekly sweep, highest-scored only. **Zero is a fine and common answer.** A threshold that fires on everything is the failure mode; the cap is what protects your allowance and your attention.
- **What runs:** `/research-team` (#04) with its decision-brief pattern, extended with a phased build plan. The radar is the trigger; #04 is the engine. Nothing is rebuilt here.
- **Auto runs skip #04's interactive team-approval gate** by design, because automating it is the entire point. The score threshold and the rate cap are the control instead.
- **Question shape:** "Evaluate {item}: what it is, how it works, buildable with my stack, upside, downside, challenges, potential, and a phased build plan."
- **Output:** a brief at `outputs/radar/YYYY-MM-DD/{slug}.md` (or PDF, branded per `brand/config/brand-config.md`, if you want one) plus `vault/research/{slug}.md`. The board row moves to `Researched`, and **then stops**. Adopting is still your call.
- **Cost:** this spends Claude allowance, which on a Pro plan is the binding constraint. The rate cap is what bounds it. If a week is tight, the honest move is to skip the deep-dive and say so, not to run it and be unavailable on Tuesday.

## Vault Structure
`work/` holds this spec and the seeds. Everything that compounds is in the vault.

- **Tier 1:** `vault/projects/radar/status.md` - the board table, the phase, last run, the thresholds, the outcome metric.
- **Tier 2:**
  - `vault/projects/radar/taste-profile.md` - **the hero.** Alex's model of you. Seeded generic from `seeds/`, then earned. Sections: your stack · what "worth it" means to you · greenlit patterns · rejected patterns · topics you care about · topics to ignore · profile confidence · last pruned.
  - `vault/projects/radar/landscape-memory.md` - the what-is-cooking tracker. One row per theme: theme · first seen · last seen · **deduped independent-event count** · notable players · trajectory (accelerating / steady / cooling) · amplified-not-accelerating flag.
  - `vault/projects/radar/friction-list.md` - the demand side, matched before generic scoring.
  - `vault/projects/radar/decisions.md` - **append-only ground truth.** One line per yes / no / park, dated, with the reason in your own words. Feeds the taste profile and the outcome metric. Never overwritten, never summarised in place.
  - `vault/projects/radar/radars/YYYY-MM-DD.md` - one output page per run.

## Seeds (what a fresh install starts with)
`work/15-radar/seeds/` holds the generic first-run copies of `taste-profile.md`, `friction-list.md`, `landscape-memory.md` and `decisions.md`. Run 1 copies any that are missing into `vault/projects/radar/` and then fills the taste profile from your own `soul.md` and `vault/me/`.

They are deliberately thin. A seeded opinion you did not form is worse than an empty section, because you will not notice it is there and the scores will quietly carry it for months.

## Vault Reads
`soul.md` (voice and priorities), `taste-profile.md`, `landscape-memory.md`, `decisions.md`, `friction-list.md`, `vault/me/goals.md`, `vault/me/preferences.md`, and `vault/projects/*/status.md` so "improves which project" and "fit to my stack" are grounded rather than guessed.

## Vault Writes
`radars/YYYY-MM-DD.md` per run · `taste-profile.md` (dated append plus prune, never a blob overwrite) · `landscape-memory.md` (deduped counts) · `decisions.md` (append on every yes / no / park) · `status.md` (board, last_run, outcome metric) · `vault/log.md` · `vault/index.md` on first run only.

## Connections
- **Feeds into:** `/morning-brief` (#02) as its Radar section, which is the delivery surface.
- **Fed by:** your own feed list in `system/install-profile.json`, plus `soul.md` and the vault for the taste seed.
- **Auto-invokes:** `/research-team` (#04) for the deep-dive on high-conviction items.
- **Reviewed by:** `/self-review` (#23), which will see this project's close-out trail like any other.

## Permission Model (hard rules)
- **Allowed with no asking:** read, fetch, dedup, score, file a row at `Interesting` or below, update vault memory, present.
- **The one relaxation:** an item clearing the auto deep-dive threshold may advance to `Researched` and get a brief without a per-item yes, because research is reading.
- **Never without an explicit yes:** install anything, build anything, deploy anything, spend anything, change any live system, or advance any row past `Researched` (auto items) or `Interesting` (everything else).

## Cost
Effectively zero in money. Public keyless feeds only. The real cost is Claude allowance, spent on the weekly reasoning pass and any auto deep-dive, which is why the rate cap exists and why the weekly cadence is weekly rather than daily.

## Close-Out Extras
- The run states its feed count and names any feed that failed to answer. A silent feed is reported, never absorbed.
- Run Check 7's verdict appears in the output whether or not a sweep was missed ("no sweeps missed" is a result).
- Zero-item runs are a **good** outcome and are reported as such. Never manufacture an item to look useful.
- Every score carries its confidence label while the profile is cold.
- No row advances past `Interesting` in an unattended run, `Researched` for auto deep-dives.

## Trifecta
Gate: **read-only**. Legs: private_data=true, untrusted_content=true, external_comm=false.

Private taste memory on one side, untrusted external feeds on the other, and no outbound channel at all: this project reads the public web and writes the local vault, nothing else. That is what makes it safe to leave on a schedule while it reads text that strangers wrote. Source of truth is the `trifecta` block in `system/manifest.json`; validator V12 fails the build if this line stops matching it.

## What was deliberately NOT ported
The upstream version had a server behind it. This one does not, and these were dropped rather than approximated:
- the daily server-side collector workflow and its inbox table
- the same-day urgent lane that pushed breaking news to a phone
- the metrics push to a hosted dashboard
- the paid social-scrape lane, which was already dark upstream
- the self-hosted version probe inside the monthly capability diff

The first two are the real loss and they are documented above rather than buried here. The rest needed infrastructure this Kit does not have and does not want.
