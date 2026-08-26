---
name: writing-plans
description: Use when a task spans multiple steps or files, needs design decisions, or will be picked up in a later session — to produce a clear, reviewable implementation plan before writing code, following this project's plan lifecycle.
---

# Writing Plans

## Overview

A plan is a contract you can review before paying for execution. It catches wrong
assumptions while they are cheap and lets work survive a context reset or a handoff.

## When to Use (and When Not)

**Use when:**
- The task touches multiple files/modules or needs ordered steps.
- There are design choices a reviewer should sign off on first.
- The work may continue in a later session (plans persist; chat context doesn't).

**Don't use when:**
- It's a single obvious edit — just do it.

## Process

1. **Settle the approach first** (see `brainstorming`) — a plan documents a decision, it
   doesn't make it.
2. **Create the plan via the lifecycle**, not an ad-hoc note: use `/plan-new` →
   `planning/active/<slug>_<YYYY-MM-DD>.md` with header `Status: ACTIVE (с YYYY-MM-DD)`.
   If the work was queued in `planning/BACKLOG.md`, draft from that entry, then mark its
   backlog row `→ заведён план <файл>`.
3. **Structure the plan** so each step is independently checkable:
   - **Context** — why this exists, expected outcome.
   - **Critical files** — what gets created/edited (paths).
   - **Steps** — ordered, checkbox list, each one verifiable.
   - **Verification** — concrete checks proving "done" (commands, greps, observed behavior).
   - **Open questions** — anything still unresolved.
4. **Register it**: add exactly one row to the `## active/` table in `planning/INDEX.md` in
   the *same* change.
5. **Don't execute in the same session the plan is approved** if project convention forbids
   it — leave a note that steps await a separate session.

## Common Mistakes

- ❌ Vague steps ("improve X") → ✅ each step names files and a checkable outcome.
- ❌ No verification section → ✅ state how "done" will be proven.
- ❌ Adding the plan file but forgetting the `INDEX.md` row → ✅ both, same change.

## Cross-references

- REQUIRED BACKGROUND: brainstorming
- SUB-SKILL: executing-plans   <!-- once approved -->
- See the "Навигация по planning/" section in `CLAUDE.md` for the full lifecycle.
- Forks worth a *future* plan (not now) → queue in `planning/BACKLOG.md` (`docs/WORKING_RULES.md` §8).
