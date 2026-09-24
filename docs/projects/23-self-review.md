# 23 - Self-Review

## What it actually does
Once a month, Alex reads its own trail: the corrections you made, the errors that happened, the runs
that ended incomplete. It looks for the pattern behind them rather than the individual mistakes, and
proposes changes.

It proposes. It does not apply. A system that rewrites its own rules on the strength of its own
analysis has removed the only reviewer it had.

## Why monthly
Because something has to drain the queue. Lessons are collected automatically every night, and this
is the only thing that reads them: unscheduled, that pile grows forever with nobody acting on it, and
the promise that a correction sticks quietly stops being true. Weekly was the other extreme, because
this is a reasoning-heavy run and on a Pro plan a weekly one spends allowance you want for real work.

## /deep-audit is off by default
The whole-repo adversarial sweep is thorough in a way that costs real money on a Pro plan: it can
spend most of a day's allowance in one run, and the symptom is not an error, it is Alex refusing to
do anything else until the limit resets. The weekly system check is zero-token and catches the same
class of drift.

## Works together with
- **[Teach-Alex](22-teach-alex.md)** - the corrections log it reads.
- **[Recovery Layer](18-recovery-layer.md)** - the findings and the incomplete runs it clusters.
