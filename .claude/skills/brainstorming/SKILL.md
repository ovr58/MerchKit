---
name: brainstorming
description: Use when starting a non-trivial feature, facing an ambiguous or under-specified request, choosing between competing approaches, or before writing a plan — to widen the solution space and surface assumptions, constraints, and tradeoffs before committing to a design.
---

# Brainstorming

## Overview

Jumping straight to the first idea locks in hidden assumptions and misses cheaper or
sturdier designs. Brainstorming separates *generating* options from *judging* them, so the
chosen approach is a decision, not an accident.

## When to Use (and When Not)

**Use when:**
- The request is ambiguous, large, or has several plausible designs.
- You're about to pick a library, data model, or architecture with lasting consequences.
- Right before `writing-plans` for anything beyond a one-line change.

**Don't use when:**
- The change is small and obvious (a typo, a one-liner, a mechanical rename).
- A design is already agreed and you just need to execute.

## Process

1. **Restate the problem** in one sentence and list the hard constraints (perf, deadline,
   compatibility, who maintains it). Confirm the restatement with the user if anything is fuzzy.
2. **Diverge — generate 2–4 distinct approaches.** Force genuine variety (e.g. "do nothing
   smart / minimal / robust"), not three flavors of the same idea.
3. For each: **one line of how it works + its main tradeoff** (cost, risk, blast radius,
   reversibility).
4. **Converge — recommend one** and say why, in terms of the stated constraints. Note what
   would change the recommendation.
5. **Surface open questions** that only the user can answer; ask them in a single batch
   rather than drip-feeding.

## Common Mistakes

- ❌ Presenting one option as if it were the only one → ✅ show the alternatives you rejected and why.
- ❌ Listing every option without a recommendation → ✅ decide; the user can override.
- ❌ Inventing requirements → ✅ ask; don't pad the design with speculative needs.

## Cross-references

- SUB-SKILL: writing-plans   <!-- once an approach is chosen, turn it into a plan -->
- Use plan mode for design discussion before any edits.
