---
name: requesting-code-review
description: Use when a change is ready for review (self-review before commit/PR, or asking another agent/human) — to prepare a focused diff, a clear summary, and the context a reviewer needs to be effective.
---

# Requesting Code Review

## Overview

A review is only as good as what the reviewer can see. A tidy, well-framed diff gets sharper
feedback and catches more before it ships; a sprawling unexplained diff gets rubber-stamped.

## When to Use (and When Not)

**Use when:**
- A change is complete and about to be committed, pushed, or handed to a reviewer.
- You want a second pass before declaring done (pairs with `verification-before-completion`).

**Don't use when:**
- Work is still mid-flight and the diff doesn't represent a coherent change yet.

## Process

1. **Self-review the diff first** (`git diff`): remove debug prints, dead code, stray TODOs,
   accidental file changes. Confirm the diff contains *only* what this change needs.
2. **Verify before requesting** — don't ask a reviewer to find what a test would catch
   (`verification-before-completion`).
3. **Write a tight summary:** what changed, why, and what to look at first. Call out risky
   spots and anything you're unsure about — direct the reviewer's attention.
4. **Keep it reviewable:** one logical change per review; split unrelated work.
5. **Pick the right reviewer:** for an automated pass use the project's review command
   (e.g. `/code-review`); for deep multi-angle review, the heavier reviewer — mindful of
   cost-discipline (`docs/WORKING_RULES.md` §2).

## Common Mistakes

- ❌ "Please review" with no summary → ✅ frame what to look at and why.
- ❌ Mixing refactor + feature + fix in one diff → ✅ separate, reviewable changes.
- ❌ Skipping self-review → ✅ read your own diff first; you'll catch half the issues.

## Cross-references

- REQUIRED BACKGROUND: verification-before-completion
- SUB-SKILL: receiving-code-review
