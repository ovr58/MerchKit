---
name: codebase-design
description: Use when designing a new module or reworking one, or when two modules must be worked on independently across a boundary — to shape deep modules (a small, stable interface hiding real complexity) at clean seams, and to freeze a contract with test doubles and a contract test so neither side waits for the other. Vocabulary: module/interface/depth/seam/adapter/leverage/locality. Complements ponytail: depth must remove complexity, not add gold-plating.
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
**locality** (a concept understood in one place, not scattered) · **contract freeze** (the
moment the interface stops moving) · **test double** (a stand-in for the other side of a seam) ·
**contract test** (the check that both sides still agree).

## Process / Quick Reference

1. **Name the concept in domain terms** (`CONTEXT.md`), not mechanism terms ("Order intake",
   not "FooBarHandler").
2. **Narrow, stable interface;** push variation and detail behind it.
3. **Put the seam where substitution is plausible;** keep adapters thin.
4. **Deletion test:** if you deleted this module, would complexity concentrate behind a smaller
   interface, or just move around? Only the former earns the module.
5. **Prefer one deep module** over three shallow ones extracted only to be testable — test
   through the real seam.

## Freezing a contract so a seam can be worked from both ends

A seam that only *exists* still makes the consumer wait for the provider. Three things turn it
into a boundary two people (or two sessions) can work across:

1. **Freeze the interface before either side starts** — not after the provider is done. The
   frozen thing is the small surface from step 2 above: names, shapes, errors, ordering
   guarantees. Freezing is cheap precisely because the interface is narrow; if freezing feels
   expensive, the interface is too wide and the module isn't deep yet.
2. **Give each side a test double of the other** — a stand-in it can run and test against
   without the real counterpart. Cheapest first (ponytail): a hand-written implementation of
   the frozen interface, living next to the consumer's tests. Reach for codegen from a schema
   or a Pact-style tool only once the hand-written double starts drifting from the provider.
3. **Cover the seam with a contract test** — one check both sides run, asserting they still
   agree. Its whole job is to make a mismatch fail *at the seam*, early and locally, instead of
   at integration when everything lands at once.

Record the state of each seam (frozen? double? contract test?) in `docs/SPEC.md` §3 — "no" is a
legitimate answer there, and means the two sides are being done sequentially.

**A contract separates modules; a network boundary does not follow from it.** Independent work
across a seam never requires splitting into separate apps, services or deployments — that's an
expensive decision with its own justification (release cadence, scaling, failure isolation) and
its own ADR. "Split it so we can parallelize" is not that justification. Do not reach for a
double you don't need either: a seam nobody is about to cross doesn't need freezing.

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
- Seam state lives in `docs/SPEC.md` §3; which milestone freezes which contract — `docs/SPEC.md` §12.
- Writing the contract test first is `test-driven-development` applied at the seam.
- Complements the ponytail plugin (YAGNI/reuse) — see `CLAUDE.md` and `docs/PONYTAIL_SETUP.md`.
- improve-codebase-architecture scans for shallow modules to deepen using this vocabulary.
