# 02 - Morning Brief

## What it actually does
You type `/morning-brief` and get seven lines: what arrived overnight that needs a reply, what is on
today's calendar, what you are waiting on from other people, what other people are waiting on from
you, any notes you left yourself, and whether everything ran last night. It points; it does not
explain. The detail lives in the things the lines point at.

## Why it exists
The question is always the same at the start of a day, and answering it by hand means opening four
things and holding the answer in your head. Seven lines is the whole point: a long brief does not get
read, and a brief that does not get read is worse than none, because you believe you have been told.

## Why it is NOT scheduled
Because it would cost part of your Claude allowance every single morning whether you read it or not,
and typing it costs you thirty seconds. That is a deliberate trade for a Pro plan, not an oversight.
If you would rather it fired on its own, it is one entry in `scheduler/schedule.md`.

## Works together with
- **[Email Triage](07-email-triage.md)** - does the overnight sorting and drafting. The brief just
  counts what it found.
- **[Recovery Layer](18-recovery-layer.md)** - the health line, and the last system check.
- **[Teach-Alex](22-teach-alex.md)** - the notes you left yourself in the inbox folder.
- **`/status`** - reads the same four things, so unscheduling the brief did not orphan any of them.
