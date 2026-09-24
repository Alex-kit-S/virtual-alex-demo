# 15 - Radar

## What it actually does
Once a week it reads the handful of sources you chose, throws away almost everything, and hands you
the one or two things that are actually worth your time. It scores them against your own taste and
against a list of the things that currently annoy you, so a small tool that removes a real
annoyance beats an impressive one that removes nothing.

It proposes. You decide. It never installs anything, never buys anything, and never moves an item
past "interesting" on its own.

## The memory is the point
A weekly digest you could get anywhere. What makes this worth running is that it remembers. Every
time you say yes or no, it writes down what you said and why, and the next week it is slightly less
wrong about you. After a couple of months it stops showing you the category of thing you always
reject, which is most of the value.

Three files do that work, and they are plain markdown you can read and correct yourself: what it
thinks your taste is, what it has seen the field doing, and the log of every decision you made.

## You choose the sources, and the template ships none
The feed list lives in your own machine-local settings file, not in the template. That is
deliberate. A list of sources is a statement about what you think is worth knowing, and inheriting
somebody else's would give you a radar that is confidently wrong every single week while still
looking like it works. `/setup` asks you for three or four sources. Anything free and public works:
a release feed for a tool you depend on, a search feed for your topic, a forum you already read.

If you never set it up, it says so and stops. It will not pick sources for you.

## What it cannot do, and this one matters
There is no server behind this. It runs on your machine, once a week.

**Breaking news waits for Monday.** If something changes on Wednesday, you hear about it five days
later. For "what is new in my field" that is fine. For "the thing I depend on just broke" it is not,
and nothing here will tell you sooner.

**A machine that is off all Monday loses that week.** The feeds are not archives. Nothing was
collecting while you were away.

The one protection is that it counts. Every run checks when it last ran, and if it missed a week it
says `Missed 1 sweep` in the first line and looks further back. That turns a quiet loss into a
visible one. It does not turn it back into news you missed.

## Zero is a good week
Most weeks nothing clears the bar, and the run says so in one line. A radar that finds something
every single week is not being useful, it is being agreeable.

## Works together with
- **[Morning Brief](02-morning-brief.md)** - where the weekly result shows up, so it is not another
  thing to remember to open.
- **[Research Team](04-research-team.md)** - the engine it hands the high-conviction items to for a
  proper brief.
- **[Self-Review](23-self-review.md)** - reads this project's trail like any other.
