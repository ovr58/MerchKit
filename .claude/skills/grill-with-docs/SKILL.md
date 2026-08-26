---
name: grill-with-docs
description: Use when a plan, design, or spec is still fuzzy and you need shared understanding before building — to interview one question at a time (self-answering from the codebase where possible), settle vocabulary into CONTEXT.md, and record only hard-to-reverse decisions as ADRs. Precedes writing-plans; complements brainstorming.
---

# Grill With Docs

## Overview

An interview loop that challenges a plan/design against what the codebase and docs already
say — one question at a time — until you and the agent share the same understanding. Its
by-products are durable: settled vocabulary lands in `CONTEXT.md` and genuinely hard-to-reverse
choices land as ADRs under `docs/adr/`, so the next session starts from agreement, not
re-litigation.

## When to Use (and When Not)

**Use when:**
- A plan/spec/design is still fuzzy and you're about to build on unstated assumptions.
- Terminology is being invented on the fly and nobody has written it down.
- Right before `writing-plans` on anything non-trivial.

**Don't use when:**
- The design is already agreed and written — just execute.
- You still need to widen the option space — `brainstorming` (diverge) comes *before* this
  (converge).
- A one-off terminology/decision capture with no interview needed → `domain-modeling` directly.

## Process / Quick Reference

1. **Restate the goal** in one sentence; confirm it before drilling in.
2. **One question at a time.** Wait for the answer before the next. No questionnaires.
3. **Self-answer from the codebase first:** read the code/docs and propose the answer for
   confirmation instead of asking what's already knowable. Only ask what the code can't tell you.
4. **Resolve dependencies in order** — settle the decision a later question depends on before
   asking it.
5. **Capture vocabulary live:** the moment a term is pinned, write it to `CONTEXT.md` (its
   meaning in the project's own words). Don't batch to the end.
6. **Record decisions sparingly:** only a genuinely hard-to-reverse / surprising choice with a
   real trade-off becomes an ADR under `docs/adr/` (schema → `domain-modeling`). Reversible
   details stay in the plan, not in an ADR.
7. **Stop** when no open question left would change the build. Hand the settled understanding
   to `writing-plans`.

## Common Mistakes

- ❌ Firing a batch of questions at once → ✅ one at a time, dependency-ordered.
- ❌ Asking what the code already answers → ✅ read first, then confirm.
- ❌ Minting an ADR for every choice → ✅ ADR only for the irreversible/surprising few; the rest
  is just the plan.
- ❌ Leaving vocabulary in the chat → ✅ write it to `CONTEXT.md` as it settles.

## Cross-references

- REQUIRED BACKGROUND: domain-modeling   <!-- the CONTEXT.md + docs/adr/ schema this writes into -->
- Use `brainstorming` first to widen options; this skill converges them.
- SUB-SKILL: writing-plans   <!-- turn the settled understanding into a plan -->
