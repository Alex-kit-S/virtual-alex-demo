---
class: other
created: 2026-06-14
last_used: 2026-06-14
times_used: 1
---
# Flight search (cheapest fare lookup)

> **LANE BUDGET: 3 spawned agents at a time, maximum.** This system runs on a Claude Pro plan, where
> the daily allowance is the binding constraint and parallel agents are the fastest way to spend it.
> If the roster below names more than three lanes, that is not permission to spawn them all at once:
> run the first three, let them report, then run the rest as a second pass against what came back.
> A second pass is usually BETTER than a wider first one, because the later lanes get to see the
> earlier findings instead of guessing in parallel. Say the plan out loud at the approval gate,
> including how many passes it will take, before spawning anything.

## Question shape
"Find me the cheapest flight" type. Live price lookup, not deep research. Route + date window + stay length + constraints (direct, cabin, baggage, passengers). NOT a multi-agent job, answer-without-team.

## Team
None. Direct tool use:
- Kiwi.com `search-flight` (aggregator = cheapest across all airlines) as primary. Use city names for flyFrom/flyTo to cover all airports. cabinClass M, set curr to the owner's local currency. sort=price.
- Cover a wide date window with multiple searches using departureDateFlexRange / returnDateFlexRange (max +-3 each). Two-three searches tile a 2-week window.
- An airline's own MCP tool, when one is connected, only as a direct-booking cross-check; a round trip there can be a fiddly two-step.

## Synthesis approach
- Kiwi results are large -> saved to a file by the harness. Parse with Python locally (json.load), DO NOT pull into context.
- **Kiwi returns TWO record shapes, handle both or you miss flights:**
  1. **Stay-as-layover:** no `return` key; the multi-day destination stop is one entry in `layovers`, real connections are extra short entries. Nonstop both ways = exactly 1 layover (the long one). out_arr = stay.arrival, ret_dep = stay.departure, dest = stay.at.
  2. **Explicit return object:** has a `return` key with its own `layovers`. Nonstop = top-level `layovers` empty AND `return.layovers` empty. ret_dep = return.departure.
  Branch on presence of `return`. (First pass that only handled shape 1 silently dropped every budget-hub option.)
- Stay nights = ret_dep - out_arr. Filter nights in target range, nonstop, dep-date in window. Sort by price, dedup on (from,to,out,ret,price).
- Carrier is NOT in the data. Infer from schedule (a departure time that matches none of the flag carrier's flights is another airline) or have the user open the deeplink. A city with two airports often splits them: flag carriers at the main one, budget carriers at the other.
- Present a small markdown table (price, out, return, nights, deeplink) + the single cheapest pick + any date-pattern (e.g. mid-month cheaper).

## Lessons
- Always ask passengers + baggage up front; both move price materially.
- Flag: prices are live/perishable, Kiwi is an OTA (offer airline-direct), cheapest fare is often carry-on only.
- Example finding: on one route the cheapest "direct" fare was on a carrier the data didn't name; the budget-hub alternative did NOT undercut it once red-eye returns were counted; and the airline's own booking tool priced HIGHER than the aggregator. Mid-month departures ran cheaper than early-month.
- LESSON: do not assume the carrier from route; Kiwi hides it. And cross-check the airline's own tool for the direct-booking price, it can be HIGHER than the aggregator when the cheapest flight is a different carrier.
