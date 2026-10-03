---
name: auto-mode-classifier-owns-irreversible
description: В auto-режиме необратимое локальное удаление, мёрдж без ревью и остановку чужих процессов запрещает классификатор харнесса, а не хук проекта — повтор той же командой не проходит, это шаг владельца
metadata:
  type: feedback
---

В auto-режиме действия вроде необратимого локального удаления, мёрджа без ревью или остановки
чужих процессов блокирует **классификатор харнесса**, а не хук проекта: `Permission for this
action was denied by the Claude Code auto mode classifier. Reason: [Irreversible Local
Destruction]`, `Reason: [Merge Without Review]`. Это не разрешение, которое можно запросить
повторно той же командой — оно не пройдёт снова.

**Why:** замер по корпусу сессий: 44 отказа классификатора, шесть причин — Irreversible Local
Destruction 19, Blocked by classifier 16, Merge Without Review 5, Modify Shared Resources 3,
Interfere With Workloads 2, Cloud Storage Mass Delete 1.

**How to apply:** отказ классификатора — не повод искать обходной путь тем же действием; нужное
действие остаётся шагом владельца: описать, что требуется, и дождаться, пока владелец выполнит
его сам или явно разрешит. Хук проекта (`protect-irreplaceable` и подобные) — отдельный, более
узкий контур; отказ классификатора его не заменяет и им не снимается.
