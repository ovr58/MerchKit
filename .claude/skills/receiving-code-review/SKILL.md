---
name: receiving-code-review
description: Use when you've received review feedback (from a human, /code-review, or another agent) — to triage comments, apply the valid ones, push back with reasons on the rest, and avoid blindly rewriting working code.
---

# Receiving Code Review

## Overview

Review feedback is input, not orders. Blindly applying every comment can introduce bugs or
churn; ignoring them wastes the review. The job is to judge each comment on merit.

## When to Use (and When Not)

**Use when:**
- Review comments have arrived and you're deciding what to change.

**Don't use when:**
- No feedback yet, or the change has already merged.

## Process

1. **Read all comments before editing.** Group them: real bugs, valid improvements, style
   preferences, misunderstandings.
2. **Fix real correctness issues first**, smallest change that addresses the comment.
3. **Apply good improvements** when cheap and clearly better; skip speculative gold-plating.
4. **Push back, with a reason,** when a comment is wrong, out of scope, or a worse tradeoff —
   don't silently comply or silently ignore. Surface the disagreement.
5. **Re-verify** after edits (`verification-before-completion`): comment-driven changes can
   break things the original passed.
6. **Reply concisely** per comment: done / done-differently / won't-do-because.

## Common Mistakes

- ❌ Applying every suggestion mechanically → ✅ judge each; reviewers are sometimes wrong.
- ❌ Silently dropping a comment you disagree with → ✅ say why you're not doing it.
- ❌ Not re-testing after addressing feedback → ✅ re-verify.

## Cross-references

- REQUIRED BACKGROUND: requesting-code-review
- SUB-SKILL: verification-before-completion
