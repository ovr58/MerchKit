---
name: research
description: Use when a question needs investigating against primary sources (docs, specs, standards, code) rather than answered from memory — to gather evidence and produce a cited Markdown findings note. Default inline (WebSearch/WebFetch); spawn a research subagent only under cost-discipline; model by complexity.
---

# Research

## Overview

Turns an open question into a findings note backed by primary sources, so a decision rests on
evidence you can re-check — not on recollection. Every claim carries a citation (URL, doc path,
spec section, or `file:line`). The output is durable Markdown, not a chat answer that evaporates.

## When to Use (and When Not)

**Use when:**
- A choice hinges on facts you shouldn't answer from memory (API behavior, licensing, version
  differences, standards, an unfamiliar area of the codebase).
- You need a citable record others can audit.
- Anything touching Claude/Anthropic/LLM specifics — pair with the `claude-api` skill; don't
  answer from memory.

**Don't use when:**
- The answer is already known and trivially verifiable.
- It's a design debate, not fact-finding → `brainstorming` / `grill-with-docs`.

## Process / Quick Reference

1. **State the question** and what a good-enough answer looks like (the decision it feeds).
2. **Prefer primary sources:** official docs, specs, standards, the source code itself — over
   blog summaries. For code cite `file:line`; for the web, the canonical URL.
3. **Gather** with WebSearch/WebFetch (web) and Grep/Read (codebase). When sources disagree,
   note the disagreement rather than picking silently.
4. **Write a findings note** in Markdown: the question, the answer, the evidence (each point
   cited), and open/uncertain areas. Keep it scannable.
5. **Feed it back** into the decision (`grill-with-docs`, or an ADR if it settles something
   irreversible).

## Cost-discipline (spawns are gated)

Default: do the research **inline** with your own WebSearch/WebFetch/Grep — you already hold the
context. Spawn a subagent only under `docs/WORKING_RULES.md` §2 (see `subagent-driven-development`):
a wide fan-out sweep, or isolating a large/noisy source haul from the main thread. Match the
model to the work — read-only gathering/extraction → a cheap model (Haiku/Sonnet); hard
synthesis → Opus. Continue an existing agent via SendMessage rather than cold-spawning again.

## Common Mistakes

- ❌ Answering from memory on a checkable fact → ✅ fetch and cite the primary source.
- ❌ Citing a blog when the spec exists → ✅ primary source wins.
- ❌ Cold-spawning a subagent for a quick lookup → ✅ inline; spawn only under §2's gate.
- ❌ A findings blob with no citations → ✅ every claim traceable.

## Cross-references

- Cost-discipline: `docs/WORKING_RULES.md` §2 · subagent-driven-development · dispatching-parallel-agents
- For LLM/Anthropic questions: the `claude-api` skill.
- Feeds: grill-with-docs, domain-modeling (an ADR if a finding settles something irreversible).
