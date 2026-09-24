# /alex-status - Is Alex OK? (Virtual Alex)

Do exactly what `.claude/commands/status.md` says, from its first line to its last. Read that file
now. This one overrides nothing in it: the whole behaviour, both modes, the identity line, the
health board, the waiting-on lists and the inbox sweep live there, in one copy.

It adds two lines, both from files in this repository and nothing from the network. Print them
first, as they print, before the report `status.md` describes:

```bash
node scripts/lib/install-state.js line
node scripts/lib/cli-version.js --show
```

The first says which template build this copy carries, how old that build is, and when this copy
took it. No Routine can see the template, so this is how the owner sees the age of their Alex;
whether a newer build exists is `/update`'s answer, never this command's. The second names the
Claude Code version: below 2.1.227 a save the commit gate refuses is NOT reported to Alex, so when
it prints `---CLI-OLD---` or `---CLI-UNKNOWN---`, also print the newest line of
`outputs/logs/autosave.log` that contains `REFUSED` (or "no refused save in the log"), because that
log is the one place a refusal is written whatever the version.

## Why the command has a different name here

The claude.ai web session has a built-in `/status` of its own, which is why Alex's is
`/alex-status` here. Typing `/status` in a cloud session never reaches Alex: the page answers
"Session info is available once the session starts" and the command file is never read. Measured on
a real install on 2026-09-23, on the first day of the first Virtual Alex, by an owner following the
install guide step by step.

So online the command is `/alex-status`. The name carries the product's own name on purpose: a
platform built-in is a generic word (status, help, model, clear), and a platform will not ship a
command named after this product, so this name cannot be taken from under us the way `/status` was.

`.claude/commands/status.md` still ships. It is where the behaviour is written and `/alex-status`
sends you to it. On a laptop install that file IS the `/status` command; here it is a file you
read, and nothing an owner can type reaches it.

## If the owner types /status instead of /alex-status

They get the web page's answer, not Alex, and nothing reaches this session. If they mention it, or
if a document tells them to type it, say in one plain sentence: "In a cloud session `/status` is the
web page's own command. Alex's is `/alex-status`." Then run it for them.
