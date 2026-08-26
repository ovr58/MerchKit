---
name: test-driven-development
description: Use when implementing new behavior or fixing a bug that can be reproduced — to write a failing test first (RED), make it pass with the simplest change (GREEN), then refactor, so the change is provably correct and stays correct.
---

# Test-Driven Development

## Overview

A test written *after* the code tends to confirm whatever the code already does, bugs
included. Writing it first pins the intended behavior, gives an objective "done", and leaves
a regression guard for free.

## When to Use (and When Not)

**Use when:**
- Adding new behavior with a definable expected output.
- Fixing a bug you can reproduce — the reproduction *is* the first failing test.

**Don't use when:**
- Pure exploration/spike (throwaway), or untestable glue where a test adds no signal — say so
  rather than skipping silently.

## Process (RED → GREEN → REFACTOR)

1. **RED** — write the smallest test that captures the desired behavior (or the bug). Run it
   with `npm test` and *watch it fail for the expected reason*. A test that passes
   immediately tests nothing.
2. **GREEN** — write the minimum code to make it pass. Resist building beyond the test.
3. Run `npm test` — the new test passes and nothing else broke.
4. **REFACTOR** — clean up code and test now that they're green; re-run to confirm.
5. For bugs: keep the reproduction test permanently as a regression guard.

## Common Mistakes

- ❌ Writing code first, test after → ✅ test first, see it fail.
- ❌ A test that can't fail (no assertion / wrong target) → ✅ confirm the RED failure reason.
- ❌ Over-building in GREEN → ✅ simplest pass; extra behavior needs its own test.
- ❌ Editing working tests to fit new code → ✅ if a real contract changed, change the test
  deliberately and say why.

## Cross-references

- REQUIRED BACKGROUND: systematic-debugging   <!-- for bugs: reproduce before testing -->
- SUB-SKILL: verification-before-completion
