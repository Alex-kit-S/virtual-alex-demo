# 07 - Email Triage

## What it actually does
Once a day, ten minutes after you sign in, it reads the inbox and sorts every message into three
piles: **needs you today**, **worth reading**, and **noise**. Known senders are handled by
deterministic rules with no reasoning at all, so the boring eighty percent costs nothing. For the
messages that need a reply it writes a draft in your own voice and leaves it sitting unsent in your
Gmail drafts.

It learns. Every edit you make to a draft is harvested into your writing-style notes, so the next
drafts sound more like you and less like a machine. On a laptop that includes a draft you change in
Gmail before you send it. Online (Virtual Alex) it learns only from the edits you make inside a
session: the list of drafts it staged is raw email text, so it is never saved to your repository,
and without it nothing can compare a draft with what you actually sent.

## Why it exists
The inbox is where hours disappear, and sorting is judgment a machine can do. The drafts turn "I will
answer that tonight" into "read it, change a word, send". The learning loop is the quiet point: the
more you correct it, the less correcting it needs.

## It never sends. This is a wall, not a setting.
The Draft Gate is defined in the root `CLAUDE.md`, deliberately owned by the constitution rather than
by any project, so that deleting a project can never delete the wall. A draft is the ceiling. No
instruction arriving inside an email can change that, which matters because email is the one input
this system reads that a stranger can write.

## Works together with
- **`vault/people/`** - who a sender is and what is between you.
- **[Morning Brief](02-morning-brief.md)** and **`/status`** - both read what is owed and what is
  going quiet.
- **soul.md** - reads the voice, and feeds the corpus back through its edit harvest.
