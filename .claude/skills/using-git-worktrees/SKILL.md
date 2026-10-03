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
- ❌ **Several agent sessions in one directory, each believing it is "on its own branch"** →
  ✅ a worktree per session. The branch belongs to the directory, not to the session: two
  sessions sharing one directory share one `HEAD`, switch it under each other, and a broad
  `git add -A` can sweep a neighbour's uncommitted file into an unrelated commit. Until every
  session has its own worktree, the stopgap is: no `checkout`, no `add -A`, stage explicit paths
  only.
- ❌ **Assuming a worktree also isolates *numbers*.** It isolates files, not shared sequences:
  sequential ids (an ADR number, a backlog entry, a plan slug) are allocated by reading history,
  and two sessions reading the same history pick the same next number. Before taking one, check
  every branch (`git log --all --oneline -S'<the pattern you're about to claim>'` or
  `git branch -a --contains`), not just your own checkout. On a collision, the fix is renumbering
  the entry nothing references yet, not the older one.
- ❌ **Assuming a fresh worktree can run the project as-is.** It carries only what git tracks: any
  gitignored local file the build needs (`.env`, downloaded dependencies, a local database) is
  missing until you build it. ✅ First thing after `worktree add`: recreate `.env` from **both**
  halves — the dev defaults committed as `.env.example`, **plus** the real secret values, taken
  from the clone you branched from. Neither half alone is enough, and copying the donor clone's
  own `.env` file wholesale is the trap: it can hold only secrets and miss required dev defaults,
  or the reverse. This path is blocked by design on purpose (a deny rule, a protective hook, the
  harness's own destructive-action classifier all catch a raw copy over an existing `.env`) —
  build the file with a fresh write, not a copy. Then install dependencies (`npm ci` or
  equivalent) and bring up any local service the project needs (e.g. a database container) —
  a worktree arrives without either.
- ❌ **Reading a "resource busy" failure on `worktree remove` as a git problem.** On Windows git
  deletes what it can, unregisters the worktree, and leaves an orphan directory behind — so the
  failure surfaces as a *half-removed* worktree with a few undeletable empty directories. The
  holder is a **process whose working directory is inside the tree**, and it's usually not a
  shell — a stray background process left over from earlier work, still running with its cwd
  inside the tree. ✅ Find it by command line, confirm the path is yours before killing anything,
  then re-run the removal. Prefer checking this *before* `worktree remove`, so the removal stays
  atomic instead of stranding a directory.
- ❌ **Assuming a half-removed worktree always means a process is holding it.** There's a second
  cause that happens every time the tree ever installed dependencies: a package manager can
  create a **filesystem link per workspace** inside its dependency directory. Git deletes what it
  can, stops at the links, and leaves a skeleton behind — no process involved. ✅ Remove each link
  without descending into it, then delete the empty tree. **Mind the slash form on Windows from
  the Bash tool** — this is where it goes wrong: `cmd /c …` does NOT work there, because the
  POSIX layer rewrites the `/c` argument into a Windows path, so `cmd` never sees the flag and
  opens an interactive shell instead — it prints its banner and deletes nothing, while the call
  still looks like it succeeded. The doubled-slash form (`cmd //c rmdir "<path>"`) escapes that
  rewrite and actually removes the link; from PowerShell, deleting via the directory API achieves
  the same without traversing it. **Never recursively delete through a link** — on Windows that
  can walk into the link's target and take out the real directory it points to. Before removing
  any link, resolve where it points and confirm the target is inside the tree being deleted, not
  the live checkout.
- ❌ **Reading a stranded worktree directory as lost gigabytes.** The skeleton looks like a full
  dependency tree and isn't: git already removed the real content, so the leftovers cost bytes,
  not gigabytes. Measure before treating cleanup as urgent — and before deleting someone else's
  directory on a size argument that turns out to be false.

## Cross-references

- SUB-SKILL: finishing-a-development-branch
- Some harnesses create worktrees automatically for isolated subagents — see
  `subagent-driven-development`.
