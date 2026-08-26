---
name: dispatching-parallel-agents
description: Use when you have genuinely independent workstreams that could run concurrently AND a subagent has already been justified — to fan out parallel subagents correctly, gated by this project's cost-discipline.
---

# Dispatching Parallel Agents

## Overview

Parallel subagents can compress wall-clock time, but each one is a separate cold context and
a separate request counter. Parallelism multiplies the most expensive path. This skill is
**gated**: only reach it after `subagent-driven-development` has already justified spawning at
all.

> On this project, subagent-heavy sessions are the entire source of observed limit burn.
> Parallel fan-out is the highest-cost pattern — use it only when the work is truly
> independent and the time saving is worth the multiplied cost.

## When to Use (and When Not)

**Use when:**
- 2+ workstreams are **truly independent** (no shared state, no ordering dependency) and each
  is substantial enough to justify a cold agent.
- A wide search splits cleanly into non-overlapping regions.

**Don't use when:**
- The streams depend on each other's output → do them sequentially / inline.
- The work is small → inline is cheaper and faster than spawning N cold agents.
- You're parallelizing for "thoroughness" rather than real independence.

## Process

1. **Partition** the work into non-overlapping units, each with one clear deliverable.
2. **Size each agent's model** to its unit (read-only → cheap; hard reasoning → Opus).
3. **Dispatch** the independent calls together (one turn, multiple Agent calls) so they run
   concurrently. Use worktree isolation (`using-git-worktrees`) if they touch files.
4. **Collect and reconcile** results yourself; resolve overlaps/conflicts in the main thread.
5. **Prefer `SendMessage`** to extend an existing agent over spawning yet another cold one.

## Common Mistakes

- ❌ Fanning out dependent steps in parallel → ✅ they must be independent or run in order.
- ❌ N cold agents for a small job → ✅ inline.
- ❌ Opus across the whole fleet by default → ✅ model per unit.

## Cross-references

- REQUIRED BACKGROUND: subagent-driven-development, cost-discipline (`docs/WORKING_RULES.md` §2)
- SUB-SKILL: using-git-worktrees
