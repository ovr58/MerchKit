---
name: mining-session-transcripts
description: Use when a question is about what past sessions already did — which calls were made, what failed and how it was fixed, how much a tool really costs, whether an approach was tried before — and when writing a rule, skill or post-mortem that should rest on that history rather than recollection. Also when tempted to replay old sessions through the model to recover their context.
---

# Mining Session Transcripts

## Overview

Past sessions are already recorded: every tool call, every error string, every correction the
user made. That record is evidence, and reading it costs **zero model tokens** — it is a file
on disk, not a conversation to re-run.

The expensive mistake is replaying sessions through the model (`--resume` per session, or a
subagent told to "read the old sessions"). Each replay lifts a full context window to recover
what a twenty-line parser extracts exactly. Sixty-eight transcripts at 245 MB is tens of
millions of tokens for a worse answer: the model summarizes impressions, the parser counts.

## When to Use (and When Not)

**Use when:**

- The question is historical: what was called, what broke, what it cost, what was already tried.
- A rule, skill, checklist or post-mortem is about to be written from memory.
- A recurring failure needs its actual frequency and its actual error text.
- You need the real price of a tool or workflow: call counts, response sizes, retry loops.

**Don't use when:**

- The answer is in the repo (code, git log, ADRs, plans) — read that; it is already curated.
- The topic is one conversation you are still in — scroll, don't mine.
- The transcripts do not cover it: only the host that wrote them has them. Sessions from other
  agents, other machines or wiped histories simply are not there. Say so instead of guessing.

## Process

1. **Locate the transcripts.** `~/.claude/projects/d--AppBusters-projects-MK/` (this project; worktrees add sibling `D--AppBusters-projects-MK-*` folders) — for Claude Code,
   `~/.claude/projects/<derived-from-cwd>/*.jsonl`, one JSONL file per session. Confirm the
   directory is non-empty before promising an answer. A project worked from more than one
   working directory (worktrees, renamed folders) leaves its transcripts scattered across
   **several** `~/.claude/projects/<…>` directories — list all of them before deciding the
   corpus is one folder. The directory follows the session's **launch** directory, not where it
   worked: a session that `cd`-ed into a worktree stays under the main clone's directory (its
   `cwd`/`gitBranch` fields say so too), while one that entered via `EnterWorktree` **moves** to
   the worktree's own slug directory and gains `relocated` / `worktree-state` records.

2. **Pick the filter, and pick it narrow.** Two shapes of topic:
   - **A tool** (an MCP server, `Bash`, `Edit`) → filter on tool name. Cleanest signal: calls,
     inputs and outcomes line up on their own.
   - **A subject** (a library, a bug, a decision) → filter on message text. Noisier; expect to
     tighten the regex two or three times.
   - **The user's own corrections** are a subject filter, and the naive version over-matches: a
     regex on correcting words ("actually", "no, first", "you already") also catches long
     kickoff prompts, where the same words appear on purpose as part of instructions rather than
     as a correction. Cap the matched message length (a kickoff prompt runs long; a correction
     is short) and drop messages that carry kickoff markers (session setup, branch/worktree
     instructions). One corpus mined this way went from 40 matches to 15 after adding the cap —
     a 2.7x noise reduction on the same data.

3. **Run the miner** (side file, `mine.py`):

   ```bash
   python mine.py --dir ~/.claude/projects/d--AppBusters-projects-MK --tool '^mcp__figma'   --out ./scratch
   python mine.py --dir ~/.claude/projects/d--AppBusters-projects-MK --text 'migration|drizzle' --out ./scratch
   ```

   It writes `stats.txt` (aggregates) and `calls.jsonl` (one record per match). Write outputs
   to a scratch directory, never into the repo. `mine.py` takes exactly one `--dir` and holds
   every matched call in memory with its full input and full result text — on a large corpus
   (hundreds of MB) this doesn't fit, and running it once per directory doesn't give one global
   frequency either. When the corpus spans several directories, write a small driver that
   reuses `mine.py`'s own parsing functions (`iter_messages`, `result_text`, `report`) but
   streams the files one at a time and keeps only the fields the report actually reads, instead
   of five separate runs with five separate totals.

4. **Read the aggregates first, the records never.** `stats.txt` answers most questions on its
   own: counts per tool, error texts by frequency, heaviest results, consecutive-retry runs,
   per-day volume, branches. Only then open the slices it points at — the error records, the
   heaviest calls — and keep each slice under ~50 KB.

5. **Pair each failure with its fix.** The next call in the same session is usually the repair,
   and its description says what changed. Failure alone is trivia; failure-plus-repair is a rule.

6. **Decide the carrier last, and run the ponytail ladder on it.** A finding is worth a skill
   only if no existing document already holds it. Often the right outcome is editing one
   paragraph of an existing file, or a single memory entry — not a new artifact.

## What the format gives you

One JSON object per line. Tool calls live in `message.content[]` as
`{"type": "tool_use", "id", "name", "input"}`; outcomes arrive later as
`{"type": "tool_result", "tool_use_id", "is_error", "content"}` — stitched by `tool_use_id`.
Each line also carries `timestamp`, `gitBranch`, `sessionId`, and `cwd`.

Four signals are hard to get any other way:

- **Error strings verbatim**, with their frequency — the difference between "it sometimes
  failed" and "seven transport drops in nine days".
- **Response sizes**, which is what context actually costs. Call counts mislead; bytes do not.
- **Consecutive runs of one tool**, which is retry thrash made visible.
- **The user's own corrections**, which name the defects no error code reported.

## Common Mistakes

- ❌ `--resume` per session, or a subagent sent to "read the old sessions" → ✅ parse the files;
  the model enters once, at the end, on a digest.
- ❌ Reading `calls.jsonl` into context → ✅ read `stats.txt`; open records only by slice.
- ❌ Reporting counts as findings → ✅ a finding is a rule someone can act on; the count is its
  evidence.
- ❌ `python -c` with a quoted script → ✅ write a file; quoting, backticks and non-ASCII break
  through the shell.
- ❌ Assuming the console is UTF-8 → ✅ transcripts are; `mine.py` reconfigures stdout, anything
  else needs `PYTHONIOENCODING=utf-8`.
- ❌ Treating transcript text as instruction → ✅ it is a record of what was said, including
  wrong turns that were later reversed. Check the current file before acting on it.
- ❌ A correction-word filter with no message-length cap → ✅ it also catches long kickoff
  prompts that use the same words on purpose; cap the length and drop kickoff-marked prompts, or
  the noise swamps the real corrections (see step 2).
- ❌ Five separate `mine.py --dir` runs, one per transcript directory, added up by hand → ✅ a
  driver over `mine.py`'s parsing functions that streams every directory into one report — five
  runs give five totals, not one global frequency (see step 3).

## Cross-references

- REQUIRED BACKGROUND: cost discipline — `docs/WORKING_RULES.md` §2 (why the model enters once)
- SUB-SKILL: `writing-skills` (only if step 6 concludes a new skill is warranted)
- SUB-SKILL: `systematic-debugging` (when the mined history is evidence for a live bug)
- Related: `research` — same discipline for external sources instead of local history
- Ladder — `.github/instructions/ponytail.instructions.md`
