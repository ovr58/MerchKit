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
5. **Run the ponytail ladder before every structural decision**, not after — a new column,
   table, module, abstraction, dependency, or schema change. YAGNI → reuse → stdlib → native →
   dep → one-liner, and write down **which rung won and why** in the plan. The ladder applies to
   requirements and diagnoses too, not only code (`AGENTS.md`). This step exists because "it
   fires by itself" never fires: a rule with no carrier survives only as long as someone
   remembers to apply it, and a multi-session wave has been observed to run start to finish
   without it.
6. **If reality diverges from the plan** (a step is wrong, a dependency surfaces): stop,
   update the plan text, and surface the change — don't silently improvise scope.
7. **On completion**, move the plan to `Status: DONE (выполнено YYYY-MM-DD)` with a short
   "what was actually done" block, and update the `planning/INDEX.md` row in the same change.
   When a supervisor coordinates several sessions, `INDEX.md` is **theirs** — hand them the row
   instead of editing it, or several sessions collide on one line.

## Report form — nine points, when a supervisor is coordinating

Write for a **cold** reader, without leaning on your own dialogue. This is what makes several
sessions surface divergences instead of quietly absorbing them.

1. **Model, lane, branch.** Conservative lane → review-handoff without being asked.
2. **What is closed**, by plan item.
3. **What diverged from the plan** — the most valuable point. What the plan said, what turned out
   to be true, what you did. A divergence is the pass's *result*; silence about it is its
   failure.
4. **Which rung of the ladder won** for each structural decision, and what you rejected.
5. **How it was verified** — the command and its output, not "all green". Separately: **what you
   did not check**.
6. **What was left undone and why.** Trimming scope is the supervisor's call, not yours.
7. **Numbers and identifiers taken** — markers, backlog ids, ADRs, migrations. Exactly what
   collides if you stay silent. Sequences often have **two carriers** (repository and, if the
   project has one, a design file); check both.
8. **Tool-call budget** where an external tool was used — actual against the benchmark.
9. **What this changes in other plans** — other passes, the backlog, questions for the owner.

A fork big enough for its own plan is **not yours to settle**: write a line in
`planning/BACKLOG.md` — a ready prompt plus references, working cold.

## Common Mistakes

- ❌ "While I'm here" refactors → ✅ stay within plan scope; new work → new plan.
- ❌ Marking a step done unverified → ✅ verify, then mark.
- ❌ Leaving `INDEX.md`/plan status stale after finishing → ✅ update both.

## Cross-references

- REQUIRED BACKGROUND: writing-plans
- SUB-SKILL: test-driven-development, verification-before-completion
- SEE ALSO: fragmenting-plans-for-executors — a step forcing an undocumented decision is a
  fragmentation defect, not something to solve mid-execution.
- Status transitions: `/plan-status`, `/plan-archive`.
