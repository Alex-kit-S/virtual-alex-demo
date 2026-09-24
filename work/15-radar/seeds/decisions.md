---
tags: [radar, decisions, memory, ground-truth]
created: null
updated: null
---

# Decisions - ground truth (append-only)

Every yes / no / park you give a radar item, dated, with your reason in your own words.

**This is the ground truth the whole project rests on.** [[projects/radar/taste-profile]] is derived
from this file and can be rebuilt from it; this file cannot be rebuilt from anything. It is never
overwritten and never summarised in place.

Format:

`- YYYY-MM-DD | {item} | {yes|no|park} | {your reason, your words} | outcome@30d: {pending|adopted|shipped|posted|dropped}`

**The reason field matters more than the verdict.** A yes with no reason teaches the taste profile
almost nothing. A no with a reason teaches it more than three unexplained yeses, which is why the
radar asks for one and takes "no reason, just not now" as a real answer rather than pushing.

**`outcome@30d` is the honest metric** (Run Check 8). Approval rate measures whether the radar
picked things you liked the sound of. This measures whether anything actually happened. Set it to
`pending` on the day, and let the 30-day review fill it in, including when the answer is `dropped`.

## Log
_(first entry goes here)_
