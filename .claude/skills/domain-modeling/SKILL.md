---
name: domain-modeling
description: Use when terminology is drifting or a term/decision needs pinning down and the plan is already clear — to maintain the project's ubiquitous language in CONTEXT.md and record irreversible decisions as ADRs under docs/adr/. The reference discipline that grill-with-docs applies during interviews.
---

# Domain Modeling

## Overview

The discipline of keeping one shared vocabulary for the project (its *ubiquitous language*)
and a durable record of the decisions you can't cheaply undo. Two artifacts carry it:
`CONTEXT.md` (the living glossary at repo root) and `docs/adr/` (one file per irreversible
decision). `grill-with-docs` drives these interactively; this skill is the reference for what
goes where, and in what format.

## When to Use (and When Not)

**Use when:**
- A term is used two ways, or a new domain concept needs a canonical name + meaning.
- A decision was just made that would be expensive or embarrassing to reverse silently.
- The plan is already clear and you only need to pin down or record — no interview needed
  (else → `grill-with-docs`).

**Don't use when:**
- The naming is obvious and local (a private helper) — not every name is domain vocabulary.
- The decision is reversible — it belongs in the plan/PR, not an ADR.

## Process / Quick Reference

**`CONTEXT.md` (repo root) — the ubiquitous language:**
1. One entry per term: the term in the project's own words, its boundary (what it is *not*),
   and where it lives if it maps to code/modules.
2. Prefer the team's real words over generic tech terms. If two words mean the same thing, pick
   one and say so.
3. It's a living file: append/refine as understanding sharpens; don't gate it behind a big rewrite.

**`docs/adr/` — irreversible decisions** (index → `docs/adr/README.md`, format → `0000-template.md`):
4. One Markdown file per decision, numbered `NNNN-slug.md`. Sections: **Status · Date · Context ·
   Decision · Consequences**.
5. Only hard-to-reverse / surprising / trade-off-driven choices. Status moves
   `Accepted → Superseded by ADR-XXXX` — never edit a past decision in place; supersede it.
6. Cross-link the ADR from the code/comment it constrains, and from `CONTEXT.md` if it defines a
   term.

## Common Mistakes

- ❌ `CONTEXT.md` as a data dictionary of every field → ✅ only concepts that carry shared meaning.
- ❌ Editing an old ADR to change the decision → ✅ write a new ADR that supersedes it.
- ❌ ADRs for reversible choices → ✅ keep those in the plan; ADRs are for the ones you'd regret
  losing.

## Cross-references

- SUB-SKILL of: grill-with-docs (which populates these artifacts through interview)
- codebase-design uses `CONTEXT.md` vocabulary when naming modules/seams.
