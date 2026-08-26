---
name: executing-plans
description: Use when an approved plan exists and you are implementing it — to work through steps in order, keep plan status current, verify as you go, and avoid scope creep.
---

# Executing Plans

## Overview

Execution drift — doing steps out of order, silently expanding scope, or marking work done
without checking — wastes the plan's value. This skill keeps execution faithful to the plan.

## When to Use (and When Not)

**Use when:**
- A plan in `planning/active/` has been approved and it's time to build.

**Don't use when:**
- No plan exists yet (write one first) or the change is a trivial one-off.

## Process

1. **Re-read the plan in full** before starting; confirm assumptions still hold.
2. **Work steps in order.** Finish and verify one before starting the next. Read the affected
   code in full before editing it.
3. **Verify each step cheaply** (the plan's Verification section, a unit test, a targeted
   reproduction) — not a full end-to-end run unless required.
4. **Track progress** with the in-session todo list; mark steps done only after verification.
5. **If reality diverges from the plan** (a step is wrong, a dependency surfaces): stop,
   update the plan text, and surface the change — don't silently improvise scope.
6. **On completion**, move the plan to `Status: DONE (выполнено YYYY-MM-DD)` with a short
   "what was actually done" block, and update the `planning/INDEX.md` row in the same change.

## Common Mistakes

- ❌ "While I'm here" refactors → ✅ stay within plan scope; new work → new plan.
- ❌ Marking a step done unverified → ✅ verify, then mark.
- ❌ Leaving `INDEX.md`/plan status stale after finishing → ✅ update both.

## Cross-references

- REQUIRED BACKGROUND: writing-plans
- SUB-SKILL: test-driven-development, verification-before-completion
- Status transitions: `/plan-status`, `/plan-archive`.
