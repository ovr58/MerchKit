---
name: subagent-driven-development
description: Use when considering delegating work to a subagent (or tempted to spawn one because a task is "big" or "thorough") — to decide whether a subagent is actually warranted versus doing it inline, and if so how to scope and model it under this project's cost-discipline.
---

# Subagent-Driven Development

## Overview

A subagent starts **cold**: it re-derives context you already hold and runs its own request
stream — the single most expensive path on a metered plan. In the observed usage of this
project, **100% of limit burn came from subagent-heavy sessions**. So the default is *not*
to spawn. This skill gates the decision; it does **not** encourage delegation by default.

> Strategic priority is **result quality**; cost-saving is tactical — used only where it
> doesn't lower quality. The cheapest quality-preserving lever is doing work inline and, when
> a subagent *is* right, sizing its model to the task.

## When to Spawn (and When Not)

**Spawn only when one is genuinely true:**
- **Wide fan-out search** across many files where you only need the conclusion, not the reads.
- **Genuinely independent parallel work** (see `dispatching-parallel-agents`).
- **Context isolation** — a large/noisy job you want kept out of the main thread.
- The user **explicitly asked** for a subagent.

**Do NOT spawn when:**
- The context is already in your head — a task labeled "thorough / multi-angle / many parts"
  is *not* by itself a reason to spawn. Do it **inline** with your own tools.
- You'd be spawning a fresh cold agent to continue something an existing agent already has
  context for — **continue it via `SendMessage`** instead.

## Process (if spawning is justified)

1. **Scope tightly:** one clear deliverable; tell the agent exactly what to return (the
   conclusion/diff, not a file dump).
2. **Model by complexity:** read-only search / extraction / mechanical work → cheap model
   (Haiku/Sonnet); hard reasoning, architecture, code review → Opus. Set via the `model`
   field (Agent param or `model:` in `.claude/agents/*.md`).
3. **Reuse over re-spawn:** continue an existing agent with `SendMessage`; don't fan out cold
   spawns on the same topic.
4. **Relay, don't dump:** the agent's final message returns to you — summarize what matters
   to the user; the user doesn't see the agent's transcript.

## Common Mistakes

- ❌ Spawning because the task "feels big" → ✅ inline unless a spawn trigger above is met.
- ❌ Opus for a grep-style lookup → ✅ cheap model for read-only/extraction.
- ❌ New cold spawn to continue prior work → ✅ `SendMessage` to the existing agent.

## Cross-references

- REQUIRED BACKGROUND: cost-discipline — `docs/WORKING_RULES.md` §2 (and the
  `subagent-cost-discipline` long-term memory, where present).
- SUB-SKILL: dispatching-parallel-agents
