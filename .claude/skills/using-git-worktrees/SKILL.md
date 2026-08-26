---
name: using-git-worktrees
description: Use when working on multiple branches at once, or isolating risky/experimental/long-running work from the main checkout — to use git worktrees instead of stashing and branch-switching in a single directory.
---

# Using Git Worktrees

## Overview

Stashing and switching branches in one directory loses context, risks half-applied changes,
and serializes work. A worktree gives each branch its own directory off the same repo, so
parallel or risky work stays isolated.

## When to Use (and When Not)

**Use when:**
- You need to work on two branches concurrently (e.g. review one while building another).
- You want experimental/risky changes isolated from a clean main checkout.
- A subagent or parallel task needs its own working copy.

**Don't use when:**
- A single linear change on one branch — a worktree is overhead you don't need.

## Quick Reference

```bash
git worktree add ../<repo>-<branch> <branch>     # new dir for an existing branch
git worktree add -b <new-branch> ../<repo>-<new> # new branch + dir at once
git worktree list                                # see all worktrees
git worktree remove ../<repo>-<branch>           # remove when done (must be clean)
git worktree prune                               # clean up stale entries
```

1. Create a worktree per parallel/isolated line of work.
2. Each worktree shares the repo's history/objects but has its own index and checkout.
3. When finished, commit or discard, then `git worktree remove` (see
   `finishing-a-development-branch`).

## Common Mistakes

- ❌ Stashing and switching to juggle branches → ✅ a worktree per branch.
- ❌ Leaving stale worktrees around → ✅ `remove`/`prune` when done.
- ❌ Two worktrees editing the same files expecting isolation — they share history but the
  branches must differ; don't check out the same branch twice.

## Cross-references

- SUB-SKILL: finishing-a-development-branch
- Some harnesses create worktrees automatically for isolated subagents — see
  `subagent-driven-development`.
