---
name: codebase-design
description: Use when designing a new module or reworking one — to shape deep modules (a small, stable interface hiding real complexity) at clean seams, using the shared vocabulary module/interface/depth/seam/adapter/leverage/locality. Complements ponytail: depth must remove complexity, not add gold-plating.
---

# Codebase Design

## Overview

A vocabulary and a heuristic for where to put complexity so it stays hidden. A **deep** module
hides a lot of functionality behind a small, stable interface; a **shallow** one leaks its
implementation through an interface almost as wide as the code beneath it. Designing for depth
at clean seams is what keeps future changes local.

## When to Use (and When Not)

**Use when:**
- Introducing a new module/service/boundary, or reworking one that keeps leaking.
- A concept is smeared across many files and every change touches all of them.
- Naming an interface/seam — reach for `CONTEXT.md` vocabulary so it reads in domain terms.

**Don't use when:**
- The change is a local edit inside an existing, well-shaped module.
- You're tempted to add a module "for future flexibility" — that's ponytail's YAGNI gate, not depth.

## Shared vocabulary

**module** · **interface** (the surface callers see) · **depth** (functionality-behind-interface
÷ interface-width — maximize it) · **seam** (a clean boundary you can cut/substitute at) ·
**adapter** (thin translation at a seam) · **leverage** (how much a change here buys you) ·
**locality** (a concept understood in one place, not scattered).

## Process / Quick Reference

1. **Name the concept in domain terms** (`CONTEXT.md`), not mechanism terms ("Order intake",
   not "FooBarHandler").
2. **Narrow, stable interface;** push variation and detail behind it.
3. **Put the seam where substitution is plausible;** keep adapters thin.
4. **Deletion test:** if you deleted this module, would complexity concentrate behind a smaller
   interface, or just move around? Only the former earns the module.
5. **Prefer one deep module** over three shallow ones extracted only to be testable — test
   through the real seam.

## Complements ponytail (not a contradiction)

Ponytail (YAGNI → reuse → stdlib → native → dep) decides *whether* a module should exist;
codebase-design decides, once it must, *how* to shape it so it hides complexity. Depth is never
gold-plating: a deep module has to remove more complexity from its callers than it adds — or it
fails YAGNI and shouldn't be built.

## Common Mistakes

- ❌ Wide interface that mirrors the implementation → ✅ narrow, stable surface; detail hidden.
- ❌ Extracting pure functions only for tests while the real bug lives in caller wiring → ✅ test
  through the seam that actually runs.
- ❌ Adding depth speculatively → ✅ depth must pay its way now (see ponytail).

## Cross-references

- Uses `CONTEXT.md` vocabulary (see domain-modeling).
- Complements the ponytail plugin (YAGNI/reuse) — see `CLAUDE.md` and `docs/PONYTAIL_SETUP.md`.
- improve-codebase-architecture scans for shallow modules to deepen using this vocabulary.
