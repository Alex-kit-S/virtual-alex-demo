<!-- ALEX PROVENANCE HEADER - added 2026-08-26 when this file came into the repo -->

> **What this is.** The model layer of `/prompting` (#26). Compiled from Anthropic's official prompt engineering
> documentation, retrieved **26 August 2026**, and brought into the Alex Kit on 2026-08-26. The spec
> (`work/26-prompting/CLAUDE.md`) POINTS at this file rather than restating it, per the pointer-style hard rule.
>
> **Why it lives in the repo.** It arrived as a Desktop file. A generated prompt that points at an unbacked local
> path breaks the moment it is run on another machine, restored from backup, or shipped to the Alex Kit. Public-repo
> safe: it is compiled from public documentation and carries no personal data, no credentials and no vault content.
>
> **Refresh trigger.** A new Claude model shipping, or Anthropic revising a per-model prompting page. A new flagship model means this file needs a section
> and `work/26-prompting/CLAUDE.md` needs a matching addendum block, or `/prompting` will quietly hand out guidance
> written for the wrong model. Sources are listed in section 12 and are the place to re-read from.
>
> **Do not hand-tune the guidance below to fit this system.** It is the upstream record. Where Alex's constitution
> and this file disagree, the disagreement is real and belongs in a findings list, not in an edit to this file.

---

# Claude Prompting Playbook, Model by Model

Compiled from Anthropic's official prompt engineering documentation, August 2026.
Deep focus on Claude Fable 5 and Claude Opus 5, with reference sections for the other current models.

---

## Table of contents

1. [How to use this playbook](#1-how-to-use-this-playbook)
2. [The universal layer: techniques that apply to every Claude model](#2-the-universal-layer)
3. [The effort parameter, explained once](#3-the-effort-parameter-explained-once)
4. [Claude Fable 5 and Mythos 5, in depth](#4-claude-fable-5-and-mythos-5-in-depth)
5. [Claude Opus 5, in depth](#5-claude-opus-5-in-depth)
6. [Claude Sonnet 5](#6-claude-sonnet-5)
7. [Claude Opus 4.8, 4.7 and 4.6](#7-claude-opus-48-47-and-46)
8. [Claude Haiku 4.5 and Sonnet 4.6](#8-claude-haiku-45-and-sonnet-46)
9. [Which model for which job](#9-which-model-for-which-job)
10. [Migration checklist: what to delete from old prompts](#10-migration-checklist)
11. [Copy-paste prompt block library](#11-copy-paste-prompt-block-library)
12. [Sources](#12-sources)

---

## 1. How to use this playbook

Prompting a current Claude model is now two layers stacked on top of each other.

The **universal layer** is the set of techniques that work on every model: clarity, context, examples, XML structure, and document ordering. This layer has barely changed and is where most of your quality comes from.

The **model layer** is a short list of behavioral quirks specific to each model, and the small prompt adjustments that correct them. This layer changes with every release. Anthropic now publishes a dedicated page per flagship model precisely because these differences are small in number but large in effect.

The practical rule: write the universal layer once, reuse it everywhere, and keep a short per-model addendum that you swap in and out. Do not rewrite whole prompts per model.

One warning that appears in almost every model page: **instructions written to work around an older model's weaknesses now actively hurt.** The models became more literal and more proactive. Old pressure language ("CRITICAL", "you MUST", "always double-check") causes over-triggering, over-verification, and wasted tokens. Deleting instructions is now a legitimate optimization technique.

---

## 2. The universal layer

These apply to Fable 5, Mythos 5, Opus 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6, and Haiku 4.5.

### 2.1 Be clear and direct

Treat Claude as a brilliant new employee with zero context on your norms and workflows. The golden rule from the docs: show your prompt to a colleague who knows nothing about the task; if they would be confused, so will Claude.

- Be specific about the desired output format and constraints.
- Use numbered lists when the order or completeness of steps genuinely matters.
- If you want "above and beyond" work, ask for it explicitly rather than hoping it is inferred.

### 2.2 Give the reason, not only the request

Explaining why an instruction matters lets Claude generalize to cases you never wrote rules for. Anthropic's own template, which appears in the Fable 5 guide:

```
I'm working on [the larger task] for [who it's for]. They need [what the output enables].
With that in mind: [request].
```

### 2.3 Use examples well

Examples are the most reliable way to steer format, tone, and structure. Make them:

- **Relevant:** mirroring your real use case.
- **Diverse:** varied enough that Claude does not pick up an unintended pattern.
- **Structured:** each in `<example>` tags, all inside `<examples>`.

Three to five examples is the documented sweet spot. Positive examples of what you want beat negative instructions about what to avoid.

### 2.4 Structure with XML tags

Wrap each type of content in its own tag so instructions, context, input data, and examples never blur together.

```
<instructions>
Extract the invoice number and total as JSON.
</instructions>

<context>
Suppliers are Swedish; amounts use a comma as the decimal separator.
</context>

<input>
[raw email text]
</input>
```

Use consistent tag names across your prompts, and nest where there is a natural hierarchy.

### 2.5 Give Claude a role

A single sentence in the system prompt shifts tone and focus, for example "You are a helpful coding assistant specializing in Python."

### 2.6 Long context: documents on top

For inputs of roughly 20K tokens or more:

- Put long documents at the top, above your query, instructions, and examples. Queries at the end can improve response quality by up to 30 percent, especially with complex multi-document inputs.
- Wrap each document in `<document>` tags with `<document_content>` and `<source>` subtags.
- Ask Claude to quote the relevant passages first, then perform the task. This keeps it anchored and reduces drift on very large inputs.

### 2.7 Control format by describing what you want

Tell Claude what to do rather than what to avoid. "Write in smoothly flowing prose paragraphs" beats "do not use markdown". Matching your own prompt's style to the desired output style also helps; a prompt with no markdown tends to produce less markdown.

### 2.8 Prefill is gone on modern models

Prefilled assistant responses on the last turn return a 400 error starting with the 4.6 generation and Claude Mythos Preview. Ask for the format directly, or use tool definitions and structured outputs.

### 2.9 Thinking

Claude 4.6 and later use adaptive thinking, where Claude decides when and how much to think based on the effort setting and query complexity. Prefer general instructions ("think thoroughly") over prescribing a step-by-step plan, because the model's own reasoning frequently exceeds what a human would prescribe. Manual `budget_tokens` is deprecated and returns a 400 error on 4.7 and later.

---

## 3. The effort parameter, explained once

Effort is now the main dial for the trade-off between intelligence, latency, and cost. It affects **all** tokens: response text, thinking, and tool calls. Lower effort means fewer tool calls and less preamble; higher effort means more tool calls, more planning, more thorough verification.

| Level | What it is for |
|---|---|
| `max` | Absolute maximum capability, no constraint on token spend. Deepest reasoning. |
| `xhigh` | Long-horizon agentic and coding work, runs over 30 minutes, million-token budgets. |
| `high` | The API default. Complex reasoning, hard coding, agentic tasks. |
| `medium` | Balanced. Agentic work needing a mix of speed, cost, and performance. |
| `low` | Most efficient. Simple tasks, quick lookups, subagents, high volume. |

Key facts worth memorizing:

- `high` is the default and behaves exactly the same as omitting the parameter.
- Effort is a behavioral signal, not a hard token budget. At low effort Claude still thinks on genuinely hard problems, just less.
- Do not pass `adaptive` as an effort value. Adaptive is a thinking mode, not an effort level.
- Changing effort mid-conversation invalidates prompt caching, because effort shapes the rendered prompt. Pick a level at the start of a cached session and hold it.
- At `xhigh` or `max`, set a large `max_tokens` (64k is a reasonable starting point) because `max_tokens` caps thinking plus response text together.

Per-model starting points:

| Model | Recommended start |
|---|---|
| Fable 5 / Mythos 5 | `high`; `xhigh` for the most capability-sensitive work; `medium` or `low` for routine tasks |
| Opus 5 | `high`; step up to `xhigh` for demanding coding and agentic work; use `low` and `medium` liberally as the main cost control |
| Opus 4.8 / 4.7 | `xhigh` for coding and agentic work; `high` as the minimum for intelligence-sensitive workloads |
| Sonnet 5 | `high`; `xhigh` for the hardest coding and agentic tasks |
| Sonnet 4.6 | `medium` as the practical default; set it explicitly to avoid unexpected latency |

If you migrate a workload between models, run a fresh effort sweep on your own evals. The levels were recalibrated between generations, so carried-over settings are usually wrong.

---

## 4. Claude Fable 5 and Mythos 5, in depth

Fable 5 is built for problems that were previously too complex, long-running, or ambiguous. It is strongest on end-to-end work that would take a person hours, days, or weeks. Anthropic notes that teams testing it only on simple workloads tend to undersell it, so point it at your hardest unsolved problem.

Mythos 5 shares the same underlying model; Fable 5 adds safety measures for biology, cybersecurity, and LLM research. All prompting guidance below applies to both.

### 4.1 What changed versus Opus 4.8

- **Long-horizon autonomy.** Sustains multi-day, goal-directed runs with strong instruction retention.
- **First-shot correctness** on complex, well-specified problems. Testers reported single-pass implementations of systems that previously took days of iteration.
- **Vision.** Much higher accuracy on dense technical images, web apps, and screenshots, often with fewer output tokens. It is trained to use bash and crop tools on flipped, blurry, or noisy images.
- **Enterprise work.** Stays in scope and produces professional output on financial analysis, spreadsheets, slides, and documents.
- **Code review and debugging.** Noticeably higher bug-finding recall, including search across codebases and repository history.
- **Ambiguity.** Performs well on complex multithreaded requests where it must determine next steps itself.
- **Delegation.** Significantly more dependable at dispatching and sustaining parallel subagents.

### 4.2 Plan for much longer turns

This is the single biggest operational shift. Individual requests on hard tasks can run for many minutes at higher effort, and autonomous runs can extend for hours.

Before you migrate: adjust client timeouts, enable streaming, add user-facing progress indicators, and consider restructuring your harness to check on runs asynchronously through scheduled jobs rather than blocking.

To stop it overplanning on ambiguous tasks:

```
When you have enough information to act, act. Do not re-derive facts already established
in the conversation, re-litigate a decision the user has already made, or narrate options
you will not pursue in user-facing messages. If you are weighing a choice, give a
recommendation, not an exhaustive survey. This does not apply to thinking blocks.
```

### 4.3 Use the whole effort range

Start at `high`. Use `xhigh` for the most capability-sensitive workloads and step down to `medium` or `low` for routine work. Important: lower effort on Fable 5 still performs well and often exceeds `xhigh` on prior models, so do not reflexively max it out. Reduce effort if a task finishes but takes longer than needed, or if you want a snappier interactive feel.

At higher effort Fable 5 can tidy and refactor beyond the task. To prevent that:

```
Don't add features, refactor, or introduce abstractions beyond what the task requires.
A bug fix doesn't need surrounding cleanup and a one-shot operation usually doesn't need
a helper. Don't design for hypothetical future requirements: do the simplest thing that
works well. Avoid premature abstraction and half-finished implementations. Don't add error
handling, fallbacks, or validation for scenarios that cannot happen. Trust internal code
and framework guarantees. Only validate at system boundaries (user input, external APIs).
Don't use feature flags or backwards-compatibility shims when you can just change the code.
```

### 4.4 Short instructions beat long enumerations

Instruction following is strong enough that a brief instruction steers a whole family of behaviors. You no longer need to name each one.

Brevity, for example, is handled by one block rather than a list of banned patterns:

```
Lead with the outcome. Your first sentence after finishing should answer "what happened"
or "what did you find": the thing the user would ask for if they said "just give me the
TLDR." Supporting detail and reasoning come after. Being readable and being concise are
different things, and readability matters more.

The way to keep output short is to be selective about what you include (drop details that
don't change what the reader would do next), not to compress the writing into fragments,
abbreviations, arrow chains like A - B - fails, or jargon.
```

Checkpoint behavior likewise needs no case-by-case list:

```
Pause for the user only when the work genuinely requires them: a destructive or
irreversible action, a real scope change, or input that only they can provide. If you hit
one of these, ask and end the turn, rather than ending on a promise.
```

### 4.5 Ground progress claims on long runs

In Anthropic's testing this instruction nearly eliminated fabricated status reports, even on tasks designed to elicit them:

```
Before reporting progress, audit each claim against a tool result from this session. Only
report work you can point to evidence for; if something is not yet verified, say so
explicitly. Report outcomes faithfully: if tests fail, say so with the output; if a step
was skipped, say that; when something is done and verified, state it plainly without hedging.
```

### 4.6 State the boundaries

Fable 5 can occasionally take unrequested actions, such as drafting an email nobody asked for or creating defensive git branch backups.

```
When the user is describing a problem, asking a question, or thinking out loud rather than
requesting a change, the deliverable is your assessment. Report your findings and stop.
Don't apply a fix until they ask for one. Before running a command that changes system
state (restarts, deletes, config edits), check that the evidence actually supports that
specific action. A signal that pattern-matches to a known failure may have a different cause.
```

### 4.7 Parallel subagents

Fable 5 dispatches subagents readily and manages them well. Use them frequently, give explicit guidance on when delegation is appropriate, and prefer asynchronous communication over blocking until each subagent returns. Long-lived subagents that keep context across subtasks save time and cost through cache reads and avoid bottlenecking on the slowest one.

```
Delegate independent subtasks to subagents and keep working while they run. Intervene if a
subagent goes off track or is missing relevant context.
```

### 4.8 Build a memory system

Fable 5 performs particularly well when it can record lessons from previous runs and reference them later. A Markdown file is enough.

```
Store one lesson per file with a one-line summary at the top. Record corrections and
confirmed approaches alike, including why they mattered. Don't save what the repo or chat
history already records; update an existing note rather than creating a duplicate; delete
notes that turn out to be wrong.
```

To bootstrap it from history you already have:

```
Reflect on the previous sessions we've had together. Use subagents to identify core themes
and lessons, and store them in [X]. Make sure you know to reference [X] for future use.
```

### 4.9 Rare failure modes and their fixes

**Early stopping.** Deep into a long session, Fable 5 can occasionally end a turn with a statement of intent ("I'll now run X") without issuing the tool call, or ask permission when it already has enough to proceed. A simple "continue" or "go ahead and do it end to end" resolves it. For autonomous pipelines, add:

```
You are operating autonomously. The user is not watching in real time and cannot answer
questions mid-task, so asking "Want me to...?" or "Shall I...?" will block the work. For
reversible actions that follow from the original request, proceed without asking. Offering
follow-ups after the task is done is fine; asking permission after already discussing with
the user before doing the work is not. Before ending your turn, check your last paragraph.
If it is a plan, an analysis, a question, a list of next steps, or a promise about work you
have not done ("I'll...", "let me know when..."), do that work now with tool calls. End
your turn only when the task is complete or you are blocked on input only the user can provide.
```

**Context-budget anxiety.** In very long sessions Fable 5 can suggest starting a new session or offer to summarize and hand off. This is usually triggered by a harness showing a remaining-token countdown. Avoid surfacing those counts. If you must:

```
You have ample context remaining. Do not stop, summarize, or suggest a new session on
account of context limits. Continue the work.
```

### 4.10 Readability in agentic conversations

After many tool calls, Fable 5 can produce dense shorthand that assumes context the user never saw. The fix:

```
Terse shorthand is fine between tool calls (that's you thinking out loud, and brevity there
is good). Your final summary is different: it's for a reader who didn't see any of that.

If you've been working for a while without the user watching (overnight, across many tool
calls, since they last spoke), your final message is their first look at any of it. Write it
as a re-grounding, not a continuation of your working thread: the outcome first, then the one
or two things you need from them, each explained as if new. The vocabulary you built up while
working is yours, not theirs; leave it behind unless you re-introduce it.

When you write the summary at the end, drop the working shorthand. Write complete sentences.
Spell out terms. Don't use arrow chains, hyphen-stacked compounds, or labels you made up
earlier. When you mention files, commits, flags, or other identifiers, give each one its own
plain-language clause. Open with the outcome: one sentence on what happened or what you found.
Then the supporting detail. If you have to choose between short and clear, choose clear.
```

### 4.11 The send-to-user tool

For long asynchronous agents, give the model a way to show the user a message verbatim without ending its turn. Tool inputs are never summarized, so content arrives intact.

```json
{
  "name": "send_to_user",
  "description": "Display a message directly to the user. Use this for progress updates, partial results, or content the user must see exactly as written before the task finishes.",
  "input_schema": {
    "type": "object",
    "properties": {
      "message": {
        "type": "string",
        "description": "The content to display to the user."
      }
    },
    "required": ["message"]
  }
}
```

Defining the tool is not enough on its own. Without an instruction in the system prompt, Fable 5 rarely calls it:

```
Between tool calls, when you have content the user must read verbatim (a partial
deliverable, a direct answer to their question), call the send_to_user tool with that
content. Use send_to_user only for user-facing content, not for narration or reasoning.
```

Do not route narration or reasoning through it; over-calling defeats the purpose.

### 4.12 Scaffolding changes worth making

- **Start at the top of your difficulty range.** Pick a task harder than you would assign to prior models, and have Fable 5 scope it, ask clarifying questions, and execute.
- **Make self-verification explicit on long runs.** Fresh-context verifier subagents outperform self-critique: `Establish a method for checking your own work at an interval of [X] as you build. Run this every [X interval], verifying your work with subagents against the specification.`
- **Refactor old prompts and skills.** Skills built for prior models are often too prescriptive and can degrade output quality. Remove older instructions where default behavior is already better. Fable 5 is also good at updating skills on the fly based on what it learns.
- **Never ask it to reproduce its reasoning in the response.** Instructions to echo, transcribe, or explain internal reasoning as response text can trigger the `reasoning_extraction` refusal category and cause fallbacks to Opus 4.8. If you need reasoning visibility, read the structured `thinking` blocks from adaptive thinking instead.

### 4.13 Safety routing you should design for

Fable 5 runs classifiers targeting offensive cybersecurity techniques, biology and life sciences content, and extraction of its summarized thinking. Benign work in those areas can also trigger them. Configure server-side or client-side fallback to Opus 4.8 so declined requests re-route automatically rather than failing.

---

## 5. Claude Opus 5, in depth

Opus 5 is built for complex agentic coding and enterprise work, with particular strength on long-horizon agentic tasks. Good news for migration: it performs well out of the box on existing Opus 4.8 prompts. You are tuning a handful of behaviors, not rewriting.

### 5.1 What changed that matters for prompting

- **Agentic coding.** Strongest on multi-file features, larger refactors, and end-to-end feature work. It completes tasks rather than leaving stubs or placeholders, and performs best when given the complete specification up front and left to run.
- **Code review.** High precision and recall; extra findings are mostly real issues, not false positives. Accuracy holds at lower effort, which supports a fast pass at review time and a thorough pass later.
- **Efficiency at lower effort.** `low` and `medium` give strong quality at a fraction of the tokens and latency.
- **Vision.** Strong on charts, documents, diagrams, and UI replication. Re-validate old vision workarounds; they may no longer be needed. Giving it tools to crop and visually verify beats adding thinking.
- **Long context.** A 1M token window as both default and maximum, with instruction following, tool calling, and reasoning staying consistent throughout.
- **Office documents.** Handles complex multi-sheet spreadsheets with non-trivial formulas and produces well-structured decks. Give it your styles and templates explicitly.
- **Multi-agent coordination.** Coordinates subagent teams well, with effective writer-verifier patterns and few cases of agents overwriting each other.

### 5.2 Response length: prompt for it, do not use effort

This is the most common Opus 5 surprise. Its default user-facing responses run longer than prior Opus models, and **effort controls how much it thinks, not how much it says**. Lowering effort will not reliably shorten the visible answer.

```
Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend
most of the response on the main answer. When asked to explain something, give a high-level
summary unless an in-depth explanation is specifically requested.
```

In a long system prompt, pair that with a short reminder near the end:

```
<tone_preference>
Keep outputs reasonably concise.
</tone_preference>
```

### 5.3 Written deliverable length

Separate from conversational verbosity, files Opus 5 writes to disk (reports, Markdown documents, summaries) are often longer than on prior models. If your product ships Claude-authored documents:

```
Match the length of written documents to what the task needs: cover the substance, but do
not pad with filler sections, redundant summaries, or boilerplate.
```

### 5.4 Progress narration

Opus 5 narrates readily during agentic work and announces what it is about to do. To tune it down, describe the cadence you want rather than forbidding narration:

```
Before your first tool call, say in one sentence what you're about to do. While working,
give a brief update only when you find something important or change direction. When you
finish, lead with the outcome: your first sentence should answer "what happened" or "what
did you find," with supporting detail after it for readers who want it.
```

The same lever works in reverse if you want more narration. Positive examples of the style you want are more effective than instructions about what to avoid.

### 5.5 Delete your verification instructions

Opus 5 verifies its own work without being told. If your prompt says "include a final verification step for any non-trivial task" or "use a subagent to verify", **remove it**. These instructions compound with the model's own behavior, cause over-verification, and add cost with no quality gain. The same applies to legacy harness scaffolding that bolts on separate verification steps.

Same story for self-correction: avoid "double-check your answer" and "re-verify before responding".

Opus 5 also narrates corrections to its own earlier statements more than prior models, which can look messy in a user-facing product:

```
Only correct an earlier statement when the error would change the user's code, conclusions,
or decisions. State corrections plainly and briefly, then continue the task. For slips that
change nothing for the user, make the fix and move on without noting it.
```

### 5.6 Task scope

Opus 5 can expand scope, adding steps that were not requested or applying its own judgment about what the task should be. For narrow, surgical tasks, constrain it:

```
Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and
check in only when different readings of the request would lead to materially different
work. If the request seems mistaken or a better approach exists, say so in a sentence and
continue with the task as asked rather than quietly narrowing, widening, or transforming
it. Finish the whole task, and stop short of actions that are clearly beyond what was asked.
```

For a single surgical change, also name what is off limits, for example: change only the retry-count constant in this file, do not refactor surrounding code.

### 5.7 Controlling subagent spawning

Opus 5 delegates more readily than prior models. Delegation pays on genuinely independent, sizeable tracks of work and wastes money on small ones.

```
Delegate to a subagent only for large tasks that are genuinely independent and
parallelizable, such as a wide multi-file investigation. Do not delegate work you can finish
yourself in a handful of tool calls, and do not use subagents to verify or double-check your
own work. If one subagent can complete the task, use one rather than several, and keep spawn
counts low.
```

If your harness is Claude Code or the Claude Agent SDK, there are deterministic caps: the `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` environment variables, and the SDK's `max_budget_usd` option. They require Claude Code 2.1.217 or later, so update a pinned SDK before pointing it at Opus 5. Claude Code adds its own delegation instruction only when you use the `claude_code` system prompt preset; with a custom or omitted system prompt, add one yourself.

### 5.8 Code review prompting

Because Opus 5 follows instructions literally, a review prompt saying "only report high-severity issues" or "be conservative" will make it report less. Ask for full coverage and filter in a separate pass instead.

### 5.9 Running with thinking disabled

Thinking is on by default on Opus 5, and can only be disabled at `high` effort or below; requests that disable it at `xhigh` or `max` return a 400 error.

With thinking disabled, two artifacts can appear:

- **Tool calls as text.** The model occasionally writes a tool call into visible text instead of emitting a structured `tool_use` block. The call never runs, and in agentic loops the leaked text stays in history and affects later turns. Most common on tool-heavy workloads like search.
- **Internal XML tags in output.** It can emit `<thinking>` or other internal tags. If your system prompt contains a rule telling the model not to think or not to reason, remove it; that increases leakage.

The recommended fix is not to disable thinking at all. For most tasks, thinking enabled at `low` effort performs better than thinking disabled at similar cost. If you must keep it disabled:

```
When you use a tool, you may say a brief sentence first. If no tool can express what the
user asked for, say so instead of guessing. Do not include internal or system XML tags in
your response.
```

Naming the tags specifically is less effective than this general form.

---

## 6. Claude Sonnet 5

Strong on coding and agentic tasks, and works well out of the box on existing Sonnet 4.6 prompts.

**Response length.** Calibrates to task complexity rather than a fixed verbosity: shorter on simple lookups, longer on open-ended analysis. To reduce: `Provide concise, focused responses. Skip non-essential context, and keep examples minimal.`

**Effort and thinking.** Defaults to `high`. Adaptive thinking is now on by default, a change from Sonnet 4.6 where requests without a `thinking` field ran with no thinking. Manual extended thinking with `budget_tokens` returns a 400 error. Useful mapping when migrating: Sonnet 5 at `medium` is comparable to Sonnet 4.6 at `high`, and Sonnet 5 at `high` is comparable to Sonnet 4.6 at `max`.

**Watch `max_tokens`.** Sonnet 5 uses a new tokenizer producing roughly 30 percent more tokens for the same text, so limits tuned for 4.6 may truncate. At high effort, leave headroom or you may get a response that is mostly thinking followed by a truncated answer.

**Tool use.** More agentic than 4.6 and reaches for tools more readily. With thinking disabled it is less likely to reach for tools, so add an explicit nudge. Higher effort produces substantially more tool use.

**Literal instruction following.** Sonnet 5 interprets prompts literally, especially at lower effort. It does not silently generalize an instruction from one item to another. If you want something applied broadly, say so: "Apply this formatting to every section, not just the first one."

**Sampling parameters are gone.** Setting `temperature`, `top_p`, or `top_k` to a non-default value returns a 400 error. Steer tone and variety through the system prompt instead.

**Design work.** It can settle into one default visual style. Generic instructions just shift it to a different fixed palette. Two things work: specify a concrete alternative in detail, or ask it to propose several distinct visual directions first and implement only the one you pick.

---

## 7. Claude Opus 4.8, 4.7 and 4.6

**Opus 4.8 and 4.7.** Start at `xhigh` for coding and agentic use cases, use `high` as the minimum for intelligence-sensitive workloads, and step down only when your evals show quality holds. These models respect effort levels strictly, especially at `low` and `medium`, where they scope work tightly to what was asked. If reasoning looks shallow, raise effort rather than prompting around it. Response length calibrates to judged task complexity, so add "Provide concise, focused responses" if you need consistency.

**Opus 4.6.** Two documented tendencies to manage. It does more upfront exploration than earlier models, so replace blanket defaults like "Default to using [tool]" with targeted guidance like "Use [tool] when it would enhance your understanding of the problem", and remove "if in doubt, use [tool]" style prompting entirely. It also has a strong predilection for subagents and may spawn them where a direct grep would be faster. Without guidance it may take hard-to-reverse actions, so add a confirmation policy for destructive operations.

**Overeagerness on 4.5 and 4.6.** Both tend to over-engineer: extra files, unnecessary abstractions, unrequested flexibility. The anti-over-engineering block in section 11 addresses this.

**Note on the word "think".** When extended thinking is disabled, Opus 4.5 is particularly sensitive to the word "think" and its variants. Use "consider", "evaluate", or "reason through" instead.

---

## 8. Claude Haiku 4.5 and Sonnet 4.6

**Haiku 4.5.** The fast, low-cost tier. It benefits most from the universal layer done properly: explicit scope, a small output example to lock the format, and no reliance on inference. Treat it like the smaller models in any family: more explicit, more structured, fewer implied steps.

**Sonnet 4.6.** Defaults to `high` effort but Anthropic recommends explicitly setting `medium` as the practical default to avoid unexpected latency. It supports context awareness, meaning it can track its remaining token budget through a conversation. If your harness compacts context or saves state to files, tell the model so in the prompt, otherwise it may naturally try to wrap up work as it approaches the limit.

---

## 9. Which model for which job

| Job | Model | Effort | Key addendum |
|---|---|---|---|
| Multi-day autonomous agent | Fable 5 | `high`, `xhigh` if critical | Grounded progress, boundaries, memory system, send-to-user tool |
| Hardest one-shot implementation | Fable 5 | `xhigh` | Give the full spec, let it run |
| Complex agentic coding, enterprise work | Opus 5 | `high`, `xhigh` when demanding | Conciseness, scope constraint, subagent cap; delete verification instructions |
| Code review at volume | Opus 5 | `low` or `medium` first pass | Ask for full coverage, filter downstream |
| Long-document analysis (up to 1M tokens) | Opus 5 | `medium` | Documents on top, quote-first instruction |
| Everyday coding and agentic work | Sonnet 5 | `high` | State scope explicitly; watch `max_tokens` |
| High-volume classification, extraction | Haiku 4.5 or Sonnet 5 at `low` | `low` | Tight schema plus one example |

---

## 10. Migration checklist

Go through your existing prompts and skills and delete or rewrite these:

- [ ] Prefilled assistant turns. They now return a 400 error on 4.6 and later.
- [ ] `budget_tokens` extended thinking config. Deprecated on 4.6, an error on 4.7 and later. Move budget control to `effort`.
- [ ] `temperature`, `top_p`, `top_k` on Sonnet 5. They return a 400 error.
- [ ] "CRITICAL: You MUST use this tool when..." Reduce to "Use this tool when...".
- [ ] "If in doubt, use [tool]" and "Default to using [tool]". These now cause over-triggering.
- [ ] "Double-check your work", "include a final verification step", "use a subagent to verify". On Opus 5 these cause over-verification with no quality gain.
- [ ] Forced interim status scaffolding like "After every 3 tool calls, summarize progress". Sonnet 5 and Fable 5 handle updates well on their own.
- [ ] Instructions to echo, transcribe, or explain internal reasoning as visible text. On Fable 5 these can trigger a refusal and force a fallback.
- [ ] Any rule telling the model not to think or not to reason. On Opus 5 with thinking disabled, this increases XML tag leakage.
- [ ] Hand-written step-by-step reasoning plans. Replace with the goal, the constraints, and a quality bar.
- [ ] Effort settings carried over from a previous model. Re-run a sweep on your evals.
- [ ] Skills written for older models. Too prescriptive is now a real cost.

Then add, where relevant: a conciseness instruction, a scope boundary, a subagent policy, and for long autonomous runs, a grounded-progress instruction.

---

## 11. Copy-paste prompt block library

**Universal context frame**

```
I'm working on [the larger task] for [who it's for]. They need [what the output enables].
With that in mind: [request].
```

**Conciseness (Opus 5 and any verbose model)**

```
Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend
most of the response on the main answer. When asked to explain something, give a high-level
summary unless an in-depth explanation is specifically requested.
```

**Scope boundary**

```
Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and
check in only when different readings of the request would lead to materially different
work. If the request seems mistaken or a better approach exists, say so in a sentence and
continue with the task as asked rather than quietly narrowing, widening, or transforming it.
Finish the whole task, and stop short of actions that are clearly beyond what was asked.
```

**Anti-over-engineering** - the canonical text is in section 4.3. **Do not copy from here.**

> Moved to a pointer 2026-08-26. This library held a SECOND copy of the 4.3 block and the two had already
> drifted: 4.3 carries "Don't use feature flags or backwards-compatibility shims when you can just change the
> code" and "Avoid premature abstraction and half-finished implementations", neither of which was here, while
> this copy carried a docstrings line 4.3 does not. A run following the spec's old "full text in section 11"
> pointer shipped the WEAKER block. Two homes for one fact is what the one-home rule forbids, and it broke
> here first. Read 4.3.

**Grounded progress on long runs**

```
Before reporting progress, audit each claim against a tool result from this session. Only
report work you can point to evidence for; if something is not yet verified, say so
explicitly. Report outcomes faithfully: if tests fail, say so with the output; if a step was
skipped, say that; when something is done and verified, state it plainly without hedging.
```

**Autonomous operation** - the canonical text is in section 4.9. **Do not copy from here.**

> Moved to a pointer 2026-08-26. Same drift as the block above: 4.9 carries "asking 'Want me to...?' or
> 'Shall I...?' will block the work", the offering-follow-ups-is-fine clarification, and "a list of next
> steps" in the last-paragraph check. None of the three were in this copy. Read 4.9.

**Subagent policy**

```
Delegate to a subagent only for large tasks that are genuinely independent and
parallelizable. Do not delegate work you can finish yourself in a handful of tool calls, and
do not use subagents to verify or double-check your own work. If one subagent can complete
the task, use one rather than several, and keep spawn counts low.
```

**Safety confirmation policy**

```
Consider the reversibility and potential impact of your actions. Take local, reversible
actions like editing files or running tests freely, but for actions that are hard to
reverse, affect shared systems, or could be destructive, ask before proceeding. When you
hit obstacles, do not use destructive actions as a shortcut.
```

**Parallel tool calling**

```
If you intend to call multiple tools and there are no dependencies between the calls, make
all of the independent calls in parallel. If some calls depend on previous results for
their parameters, call those sequentially. Never use placeholders or guess missing
parameters in tool calls.
```

**Grounded answers, no speculation**

```
Never speculate about code you have not opened. If the user references a specific file, read
the file before answering. Investigate relevant files before answering questions about the
codebase, and never make claims about code before investigating unless you are certain.
```

**Long-document structure**

```
<documents>
  <document index="1">
    <source>[filename or URL]</source>
    <document_content>
    [the long content]
    </document_content>
  </document>
</documents>

First, quote the passages from the documents that are relevant to the question below.
Then answer using only those passages.

Question: [your question]
```

---

## 12. Sources

All official Anthropic documentation, retrieved 26 August 2026.

- Prompting best practices: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- Prompting Claude Fable 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5
- Prompting Claude Opus 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
- Prompting Claude Sonnet 5: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5
- Prompting Claude Opus 4.8: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-4-8
- Effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Thinking: https://platform.claude.com/docs/en/build-with-claude/thinking
- Refusals and fallback: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- Models overview: https://platform.claude.com/docs/en/models/overview
