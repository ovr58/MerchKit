---
name: verification-before-completion
description: Use when about to claim a task is done, fixed, or working (or before a handoff/PR) — to verify the change actually behaves as intended (tests pass, behavior observed) and to report honestly what was and wasn't verified.
---

# Verification Before Completion

## Overview

"Should work" is not "works". Declaring completion on the basis of having written code,
without observing it, is the most common way a session ships a broken change.

## When to Use (and When Not)

**Use when:**
- About to say "done", "fixed", "works", or to hand off / open a PR.

**Don't use when:**
- Mid-task with no completion claim yet.

## Process

1. **Name the success criterion** in concrete terms (which test, which observable behavior).
2. **Run the cheapest sufficient check:** `npm test` for unit-level; a targeted
   reproduction for a bug fix; actually launch/observe for UI/behavioral changes. Don't claim
   a full end-to-end pass you didn't run.
3. **Check for collateral damage:** did anything adjacent break? Run the relevant existing
   tests, not just the new one.
4. **Report honestly:**
   - Verified and passing → state it plainly, no hedging.
   - Failing → report immediately, with the actual output.
   - Skipped/couldn't verify → say so explicitly and why (e.g. "needs a target VM").
5. **If the change adds or alters a user-facing step, verify its event too** — «событие `E-NN`
   ушло и с теми свойствами», проверенное **в dev**. Инструментирование одинаково во всех
   окружениях именно ради этой проверки; пропустив её, дыру в данных обнаруживают в проде через
   неделю, когда залить её уже нечем (`instrumenting-analytics`, `docs/ANALYTICS.md`).
6. **Run lint on the changed files too.** A test runner does not run the linter; a branch green
   on tests and red on lint is still red. Each check its own command and exit code — not
   `A && B | tail`, which hides the second half.
7. **Don't** re-read files you just edited to "confirm" — Edit/Write would have errored on
   failure.

## Checks that lie green

Each of these was paid for by a branch in a donor project. They pass while the defect stays.

- **A check keyed on the same feature as the action proves only itself.** Removal by a name
  pattern, verified by the same pattern, is an honest zero on the wrong sample. Verify through a
  **different** carrier.
- **A generated file is checked against its source.** Edit the source of a generated artifact
  (contract → client, tokens → theme) and the generator runs and its output is committed in the
  same change; otherwise the output silently lags until someone builds.
- **Two carriers of one value are read side by side,** not each on its own: each alone looks
  plausible, together they name different numbers.
- **A report names the state AFTER itself.** "Headers differed, the repeat came after the edit"
  reads cold as "no repeat now". A record of an edit describes the edit, not the state — the state
  is learned by opening the carrier.
- **Two correct edits can add up to a wrong result.** Recompute the total, don't just re-check
  the last edit.
- **An acceptance criterion is a command you ran once** before writing it down. A criterion that
  can't run (`node --test <directory>` on Windows) makes "green" mean anything.

## Common Mistakes

- ❌ "This should fix it" as a closing statement → ✅ run it, then report what happened.
- ❌ Hiding a skipped step → ✅ surface every gap between claimed and verified.
- ❌ Verifying only the happy path you wrote → ✅ check regressions too.

## Cross-references

- REQUIRED BACKGROUND: test-driven-development, systematic-debugging
- Events of a changed user flow: `instrumenting-analytics` (verify in dev, not in prod).
- Honest-reporting rule: `docs/WORKING_RULES.md` §6.
