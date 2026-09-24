# 26 - Prompting

## What it actually does
On demand: you describe what you want in plain English, spoken or typed, and Alex acts as a senior prompt engineer, handing back a clean three-part prompt (context, input, output) ready to paste into Claude Code, or run right away in the same session. Before building anything it checks whether one of the existing automations already does the job, and if so it says so and asks whether to extend that instead of building a duplicate. If details are missing (what format, where it lives), it asks everything in one short round of questions, with a standing "just use defaults" escape hatch.

## Why it exists
You should never have to write prompts. You speak intent; the system does the prompt engineering, at a senior level, every time, with the house rules baked in: the right skills named for the task, files referenced instead of copied (so prompts never go stale), the brand and close-out gates wired in by name, and no padding around the deliverable. It also protects the system from its most likely failure: plain English quietly re-describing something that already exists and getting it rebuilt under a new name.

## Works together with
- **The whole routing table** - step 0 checks every request against the live automations before generating anything.
- **The Skill Bindings table** - every generated prompt names the exact skills the task needs; mandatory ones are non-negotiable.
- **/new** - if the request is a durable automation rather than a one-off task, the prompt routes the build through the registry-first /new flow.
- **#23 Self-Review** - every delivered prompt is saved to outputs/prompting/, so the weekly review can mine which prompts actually worked.
