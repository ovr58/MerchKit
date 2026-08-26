---
name: writing-skills
description: Use when creating a new SKILL.md or editing an existing one — to follow the skill format (trigger-first description, scannable structure, cross-references) so the skill is discoverable and reusable across projects.
---

# Writing Skills

## Overview

A skill is reusable methodology that Claude pulls into context *on relevance*. Its value
depends entirely on whether the `description` triggers at the right moment and whether the
body is short enough to act on. This meta-skill documents the format.

## When to Use (and When Not)

**Use when:**
- Adding a new skill to `.claude/skills/`, or fixing one that isn't triggering / is too vague.

**Don't use when:**
- A one-off instruction suffices — not every habit needs a skill.

## Process

1. **Start from the template:** copy `.claude/skills/_TEMPLATE/SKILL.md`.
2. **Write the `description` as triggers, not a summary.** Begin with **"Use when …"** and
   list only the *conditions* that make the skill relevant (symptoms, task types, keywords).
   Third person, ≤500 chars; whole frontmatter ≤1024 chars.
3. **Keep the body scannable:** Overview → When to Use (and When Not) → Process/Quick
   Reference → Common Mistakes → Cross-references.
4. **Language rule:** body in **English** for generic code methodology; **Russian** only
   where it encodes a project convention (plan lifecycle, monitoring, memory).
5. **Parameterize tech specifics** with placeholders (`{{TEST_COMMAND}}`,
   `{{PRIMARY_LOG_PATH}}`) so the skill ports between projects. Strip vendor/marketplace
   names.
6. **Link related skills** with `REQUIRED BACKGROUND: <name>` / `SUB-SKILL: <name>` (no `@`).
7. **Anything that spawns subagents** must cross-link cost-discipline
   (`docs/WORKING_RULES.md` §2). See `subagent-driven-development`.
8. **Register it:** add one row to `.claude/skills/INDEX.md`.

## Common Mistakes

- ❌ Description that restates the process → ✅ description = triggers only.
- ❌ A 300-line essay → ✅ short and scannable; offload detail to side files.
- ❌ Forgetting the `INDEX.md` row → ✅ add it in the same change.

## Cross-references

- See `.claude/skills/_TEMPLATE/SKILL.md` for the skeleton and `.claude/skills/INDEX.md` for the index.
