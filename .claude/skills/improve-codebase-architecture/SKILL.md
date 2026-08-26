---
name: improve-codebase-architecture
description: Use when doing periodic architecture maintenance (every few days, not as a step in a chain) — to scan git-churned code for deepening opportunities (shallow modules that could become deep), pass each through the deletion test, emit a self-contained HTML report to the OS temp dir, then grill the chosen candidate. Uses CONTEXT.md vocabulary; spawns gated by cost-discipline.
---

# Improve Codebase Architecture

## Overview

A periodic scan that hunts for **deepening opportunities** — places where a shallow module could
become a deep one with a smaller, more stable interface — and presents them as a browser-ready
HTML report you triage, then grills the one you pick into a concrete design. It's maintenance
you run every few days, not a step wired into a build chain.

## When to Use (and When Not)

**Use when:**
- Doing periodic architecture upkeep on an actively-changing codebase.
- Friction is rising in a module that changes a lot and leaks its internals.

**Don't use when:**
- You already know the module and the change you want — go straight to `codebase-design`.
- The codebase is small/young enough that the churn signal is just noise.

## Process / Quick Reference

1. **Scan, biased toward recently-changed code** — deepening pays off where change is frequent.
   Read git churn to rank candidates.
2. **Filter with the deletion test:** keep only candidates where hiding the module would
   *concentrate* complexity behind a smaller interface — not merely relocate it. Reject generic
   cleanup.
3. **Frame each candidate in domain terms** from `CONTEXT.md` ("deepen the Order intake module",
   not "refactor FooBarHandler") plus the `codebase-design` vocabulary
   (module/interface/depth/seam/leverage/locality).
4. **Emit a self-contained HTML report to the OS temp dir** (the scratchpad) — nothing lands in
   the repo. Each card: files involved, the friction, a plain-English fix, benefit in
   locality/leverage, a before/after sketch, and a confidence badge (Strong / Worth exploring /
   Speculative). Close with a recommended first candidate.
5. **On your pick, run the grilling loop** (`grill-with-docs`) over that design — constraints,
   what sits behind the seam, which tests survive — updating `CONTEXT.md`/ADRs inline as
   decisions crystallise.

## Cost-discipline (spawns are gated)

Default to running the scan **inline**. Spawn a subagent only under the fan-out / isolation gate
in `docs/WORKING_RULES.md` §2 (see `subagent-driven-development`): e.g. a genuinely wide
read-only sweep of a large tree, on a cheap model. The report and the grilling are yours to
drive — don't fan those out.

## Common Mistakes

- ❌ Generic "refactor X" suggestions → ✅ every candidate passes the deletion test or is dropped.
- ❌ Writing the report into the repo → ✅ OS temp dir only; nothing committed.
- ❌ Scanning the whole history → ✅ bias to recent churn where deepening pays off.
- ❌ Fanning out subagents by default → ✅ inline unless §2's gate is met.

## Cross-references

- REQUIRED BACKGROUND: codebase-design   <!-- depth/seam vocabulary and the deletion test -->
- SUB-SKILL: grill-with-docs   <!-- grills the chosen candidate into a design -->
- Cost-discipline: `docs/WORKING_RULES.md` §2 · subagent-driven-development
- Uses `CONTEXT.md` vocabulary (domain-modeling).
