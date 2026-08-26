---
name: finishing-a-development-branch
description: Use when a feature or fix branch is complete — to do the final verification, clean history/diff, open a PR or merge, and tidy up the branch and any worktree.
---

# Finishing a Development Branch

## Overview

The last mile of a branch is where loose ends accumulate: unverified claims, messy diffs,
orphaned branches. A short closing checklist prevents shipping a half-finished change.

## When to Use (and When Not)

**Use when:**
- A branch's work is done and you're about to merge / open a PR / hand it off.

**Don't use when:**
- The branch is still in active development.

## Process

1. **Verify end-to-end** (`verification-before-completion`): the full intended behavior, plus
   the existing test suite — not just the new test.
2. **Clean the diff** (`requesting-code-review`): no debug code, no unrelated changes.
3. **Update docs/plan status**: if a plan drove this, set it to `DONE` with a "what was done"
   block and update `planning/INDEX.md` in the same change.
4. **Commit/push only when the user asks.** If on the default branch, branch first. Follow
   the project's commit-message convention (e.g. trailer).
5. **Open the PR / merge** per project norms. PR body: what + why + how verified.
6. **Tidy up:** delete the merged branch; `git worktree remove` any worktree
   (`using-git-worktrees`); `git worktree prune`.

## Common Mistakes

- ❌ Opening a PR off an unverified branch → ✅ verify first.
- ❌ Pushing/merging without being asked → ✅ confirm; the user owns outward actions.
- ❌ Leaving merged branches/worktrees behind → ✅ clean them up.

## Cross-references

- REQUIRED BACKGROUND: verification-before-completion, requesting-code-review
- SUB-SKILL: using-git-worktrees
