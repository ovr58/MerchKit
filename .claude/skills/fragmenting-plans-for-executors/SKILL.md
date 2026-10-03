---
name: fragmenting-plans-for-executors
description: Use when writing or auditing the steps of a plan — judging whether a step is cut finely enough, whether it earns the verdict `НЕДЕЛИМ`, or how steps group into sessions in the «Порядок исполнения» table. Also when a cold executor session stalls on a decision its step never stated, when a plan reads as notes for its own author, or when cutting a step further starts to feel endless.
---

# Fragmenting Plans for Executors

> **Turning this off.** This skill is the head carrier of the "planning core" module, switched
> off via `docs/METHODOLOGY.md` (ADR-T0010). Without the module, plans can no longer be cut to
> isomorphic micro-steps for a cold executor: the diagnostic-question cut, the `НЕДЕЛИМ` verdict,
> the «Порядок исполнения» session layout and its `/validate-plan` audit all go with it. Plans
> still get written and executed — just sized and audited by feel instead of this method.

## Overview

A plan is written by the session that understands the most and executed by the session that
knows the least. This skill is the operational side of the law in `AGENTS.md` («Изоморфное
дробление») and `docs/adr/T0011-isomorphic-fragmentation-of-plans.md`: how to cut a step until a
cold session can run it, when to stop cutting, and how to lay the result out across sessions so
the cutting actually pays for itself.

Do not restate the law here or in a plan — link it. The model rubric lives in `docs/SPEC.md`,
and there is no second rubric: it is applied to the *step* exactly as it is applied to a
milestone.

## When to Use (and When Not)

**Use when:**
- Writing the Steps section of a plan, or re-cutting a block of an existing one.
- Auditing a plan's steps — the reading half of `/validate-plan`.
- A step feels too big but you cannot say what is actually wrong with it.
- Deciding which steps share a session and which get one of their own.

**Don't use when:**
- The approach itself is not settled yet — `brainstorming`, then `writing-plans`.
- You are executing rather than planning — `executing-plans`.

## Process

### 1. Ask the diagnostic question, not "is this step big?"

> *What does this step force the executor to decide that its own text does not say?*

- **No answer** — the step is atomic, whatever its size. A step that edits nine files
  mechanically is atomic; a three-line step that picks a data model is not.
- **An answer** — that answer is a **missing line of the step's contract**, and only sometimes a
  reason to cut. Write the decision into the step, then ask again. Most "too big" steps are
  under-specified rather than under-cut, and cutting them multiplies the ambiguity instead of
  removing it.

### 2. Write the step to the micro-step template

```markdown
### <ID>. <одно действие> — <модель>
- **Целевой файл(ы):** <путь>
- **Файлы-контракты (читать, не править):** <путь> — <что оттуда берётся>
- **Границы:** <что этот шаг НЕ трогает / что запрещено импортировать>
- **Задача:** <механическое действие, без выбора архитектуры>
- **Критерий приёмки:** <исполняемая команда или проверяемое наблюдение>
```

Every field earns its place. **Файлы-контракты** is what spares the cold session from
re-deriving context that already exists. **Границы** is what stops scope creep in a session that
cannot see the rest of the plan.

**Критерий приёмки не смеет называть боевой файл.** A step whose acceptance criterion says
«без ключа в `.env` — внятная ошибка» invites the executor to delete the real `.env`; that is
exactly what happened in practice, and the owner's keys were gone for good. Negative checks
(«файла нет», «переменная не задана», «база пустая») name a copy in OS-temp, never a real path in
the working tree. Хук `.claude/hooks/protect-irreplaceable.js` теперь валит такие команды, но
дефект здесь в формулировке шага, а не в исполнителе: границы шага обязаны запрещать не только
чужие модули, но и боевые файлы, которые он трогать не должен. **Критерий приёмки** must be a
command or an observation — never "works" or "готово".

**A layout step (screen, state, component) has four more lines** — the frame is the input, and
the step names it (template ADR-0012, not imported). The rule holds only while the "Figma design trio" module is on
(`docs/METHODOLOGY.md` — **off in this project**): at design level 0 there are no accepted frames, so no step is frame-backed
and the four lines below don't apply.

```markdown
- **Кадр:** <код> · нода <id в файле Figma `{{FIGMA_FILE_KEY}}`, реестр `docs/VISUALS.md`>
- **Ссылка на кадр:** https://www.figma.com/design/{{FIGMA_FILE_KEY}}/-?node-id=<id, двоеточие → дефис>
- **Вход вёрстки:** <код, снятый `tools/figma-to-code` с этой ноды — путь или команда (скил `figma-to-code`)>
- **Критерий:** скриншот собранного экрана рядом с кадром; каждое отличие — владельцу, он решает
  (поправить приложение · поправить Figma · записать отход в `DESIGN_SYSTEM.md` §6), и отличие
  показывается **ссылкой на кадр плюс снимком**, а не снимком одним
```

**The link line is not a duplicate of the id line.** The id is what tooling takes; the link is what
a human opens — and both the cold executor calibrating the channel and the owner deciding on a
difference need to reach the frame itself. Writing it costs nothing at planning time (the id is
already there) and costs a search per difference if it is left out. Shape:
`?node-id=<sessionID-localID>`, the node id's colon written as `-` (or `%3A`).

A step whose frame carries an unremoved review marker (`marking-design-edits-for-review`) is not
ready: it waits for the owner's acceptance.

**A screen step takes its shape from the design, not from the API.** Its inputs and outputs are
listed from the screen (its entry in the screen registry, `docs/VISUALS.md`); how they map onto
the API is a contract line of its own (e.g. one composite API field split into several screen
counters). Copying a server step's boundary into a screen step is a defect even when both are
true on their own: in practice a field the API treats as one number moved unchanged from a server
step into a screen step whose design showed three separate counters — and the executor stalled.

**The schema subset of a milestone is derived from the milestone's screens, not from its FR
list.** Before cutting server steps, walk the screen registry (`docs/VISUALS.md`) field by field:
every field whose source screen belongs to the milestone is either taken into the schema or
deferred by an owner decision recorded in the plan. A field silently cut surfaces later as a new
server step in the middle of the screen chain — it has happened more than once, each time on a
field that looked minor enough to skip.

**A step waiting on an owner's answer is not `ОК`.** The question is written yes/no, in terms of the
screen and its behaviour, citing the requirement and the design that already exist; the contract
lines for **each** answer are written in advance, so the answer lands without re-fragmenting. Until
then the audit verdict is `БРАК`.

### 3. Two passes, then a verdict

Cut a step at most **twice**. If it still demands planner-level intelligence, stop cutting and
write the verdict together with its cause — the cause is the useful half:

```
НЕДЕЛИМ (<модель>) — <сквозной инвариант | необратимое решение | шов между модулями>
```

What the verdict carries with it:

- **Routing, not an exemption.** The step gets its own session in the trusted lane (ADR-0002)
  and its own launch prompt. The planner does not quietly execute it in the planning session.
- **First in its block, never last.** It is indivisible because it holds a decision the rest of
  the block leans on, and such decisions freeze before mechanical work. If it cannot move to the
  front, the block boundary is in the wrong place: break the block there and let the indivisible
  step open the next one.
- **No excuse for a missing acceptance criterion.** A step with nothing executable to check is a
  different defect — an unverifiable step — and this verdict does not cure it.
- **Hitting a wall during execution is not this.** Prerequisites undelivered or review pending
  is plan *status*: write a blocker line and let the step wait. Do not hold the session open
  waiting — a turn costs more the longer its session has been running.

### 4. Lay the steps out across sessions — «Порядок исполнения»

Cutting with no session layout saves nothing. Cost per turn is set by session length, so fifteen
micro-steps walked by one session cost **more** than the uncut plan. Row = one session; columns
are the session's steps and its «модель · полоса · ветка», plus dependency and parallelism.

- **Batch of 3–5 steps per row.** A step that takes one or two turns in a fresh session does not
  deserve a session of its own; past five, the session you were keeping short re-inflates.
- **The row's model is the highest demand among its steps**, taken from the rubric in
  `docs/SPEC.md`. The lane follows from the model (ADR-0002), and the branch prefix follows from
  the lane: `claude/<slug>` for Opus or Fable (ADR-T0013), `feature/<slug>` · `fix/<slug>` · `exp/<slug>` otherwise.
  Never average the steps down to a cheaper row.
- **`НЕДЕЛИМ` steps sit in a planner-model row**, first in their block. Two indivisible steps
  share a row only when both are trusted-lane and belong to the same block.
- **Independent rows run in parallel, each in its own worktree.** The branch is a property of
  the directory, not of the session (`using-git-worktrees`). Mark every row's dependency
  explicitly: a row with nothing written in that column reads as "start it now".
- **Switching model inside a live session** instead of opening a new one is allowed only when
  that session has just closed the indivisible step's prerequisites **and** is shorter than
  roughly 100 turns. Longer than that — close it and start fresh; a session bootstrap is cheaper
  than a single turn in a bloated one.
- The **empty skeleton** of the section belongs to `/plan-new`; the semantics belong here. Do
  not copy either into the other.

### 5. Report the audit

One line per step, then the layout, then a count. Three verdicts only — `ОК`, `БРАК`, `НЕДЕЛИМ`:

```
<ID> — ОК
<ID> — БРАК: <что шаг заставляет решать, чего в его тексте нет> → <какой строки контракта нет>
<ID> — НЕДЕЛИМ (<модель>): <причина>
```

Then check the layout table against its invariants and list only what it violates:

- every step of the plan appears in **exactly one** row;
- every `НЕДЕЛИМ` step is in a planner-model row and first in its block;
- no row carries more than five steps;
- rows meant to run in parallel are marked independent.

Close with the count — `N шагов: X ОК · Y БРАК · Z НЕДЕЛИМ` — and nothing else. The audit reads
and reports; rewriting the steps is a separate pass, so that a bad audit is cheap to throw away.

## Common Mistakes

- ❌ Cutting a step because it looks long → ✅ ask the diagnostic question; length is not the test.
- ❌ Answering the question by cutting → ✅ write the answer **into** the step, then re-ask.
- ❌ `НЕДЕЛИМ` read as "this one is hard, I'll just do it myself while I'm here" → ✅ it routes
  the step to its own session in the trusted lane.
- ❌ An indivisible step parked at the end of its block → ✅ head of the block, or the block
  boundary moves.
- ❌ Fifteen micro-steps and no «Порядок исполнения» table → ✅ no layout, no saving; the plan
  came out more expensive than before it was cut.
- ❌ Restating the law or the model rubric inside the plan → ✅ link `AGENTS.md`, ADR-T0011 and
  `docs/SPEC.md`; two copies of a rule drift apart.
- ❌ Parallel rows sharing one working directory → ✅ a worktree per row.
- ❌ A step whose acceptance criterion is "готово" → ✅ a command, or an observation someone else
  can repeat.
- ❌ A screen step bounded by the server's shape («одно число») → ✅ bounded by the design; the
  mapping to the API is its own contract line.
- ❌ Schema subset picked from the FR list → ✅ from the screen registry × the milestone's
  screens; a cut field needs an owner decision in the plan.
- ❌ «По ответу владельца» inside a step → ✅ a yes/no question in screen terms, both answers
  already written as contract lines.

## Cross-references

- REQUIRED BACKGROUND: writing-plans
- SUB-SKILL: using-git-worktrees   <!-- parallel rows of the layout table -->
- The execution side of the same contract: `executing-plans`.
- Audit of a finished plan: `/validate-plan` — it checks the *form*; the diagnostic question
  still has to be asked by a reader.
- Law and rationale: `AGENTS.md` («Изоморфное дробление») and
  `docs/adr/T0011-isomorphic-fragmentation-of-plans.md`. Model rubric: `docs/SPEC.md`.
  Session-length figures behind the batch size and the 100-turn rule: `docs/WORKING_RULES.md` §2.
