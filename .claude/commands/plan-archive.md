---
description: Перевести выполненный план в DONE и перенести в planning/archive/plans/, обновив INDEX
argument-hint: <slug файла в planning/active/>
allowed-tools: Read, Edit, Glob, Bash(git mv:*), Bash(mv:*)
---

# Архивировать выполненный план

Вход: `$ARGUMENTS` — slug плана (имя файла в `planning/active/`, можно без `.md`).
Если пусто — показать список `planning/active/*.md` и спросить, какой.

Тонкая команда — БЕЗ субагентов. Перемещение + правка markdown.

## Шаги

1. Открыть `planning/active/<slug>.md`. В шапке заменить `Status: ACTIVE …` на
   `Status: DONE (выполнено <YYYY-MM-DD — сегодня>)` и дописать в конец короткий блок
   `## Что реально сделано` (3–6 строк по факту).

2. Переместить файл: `planning/active/<slug>.md` → `planning/archive/plans/<slug>.md`
   (если репозиторий под git — `git mv`; иначе обычный move).

3. **Пересчитать ссылки — перенос сменил глубину файла.** Это отдельный шаг, а не мелочь:
   `active/` лежит на два уровня от корня, `archive/plans/` — на три.
   - **Внутри плана:** каждая относительная ссылка получает ещё один `../`
     (`](../../docs/TZ.md)` → `](../../../docs/TZ.md)`, `](../BACKLOG.md)` → `](../../BACKLOG.md)`).
     Якоря внутри файла (`#раздел`) не меняются.
   - **Ссылки НА план:** переписать `active/<slug>` на `archive/plans/<slug>` там, где на него
     ссылаются живые файлы — `planning/BACKLOG.md` (в том числе строки «→ заведён план»),
     `planning/reference/*`, строки `Related:` в `docs/adr/*`.
   - **Проверка:** `grep -rn "active/<slug>" --include=*.md .` — пусто, и каждая правленая ссылка
     открывается.

4. В `planning/INDEX.md`: удалить строку плана из таблицы `## active/` и добавить её в
   `## archive/plans/` со статусом `ARCHIVED`.

5. Не удалять файл (archive-never-delete). Сообщить новый путь и число правленых ссылок.

> Lifecycle: ACTIVE → DONE → ARCHIVED. Обновление INDEX — обязательная часть того же изменения.
