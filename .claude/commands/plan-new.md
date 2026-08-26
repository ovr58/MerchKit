---
description: Завести новый план жизненного цикла в planning/active/ и зарегистрировать в INDEX
argument-hint: <заголовок плана> | <краткая цель>
allowed-tools: Read, Write, Edit, Glob
---

# Новый план (lifecycle)

Вход: `$ARGUMENTS` — формат `<Заголовок плана> | <Краткая цель>` (часть после `|`
опциональна; если нет — спроси одной строкой).

Тонкая команда — БЕЗ субагентов и без свежих контекстов (токен-гигиена). Только правка
markdown.

## Шаги

1. Сгенерировать `slug` из заголовка (kebab-case, латиница/транслит). К имени файла
   добавить дату: `<slug>_<YYYY-MM-DD>` (сегодня).

2. Создать `planning/active/<slug>_<YYYY-MM-DD>.md` с шапкой:

   ```markdown
   # <Заголовок плана>

   Status: ACTIVE (с <YYYY-MM-DD — сегодня>)

   ## Context
   <зачем этот план: проблема/потребность, ожидаемый исход>

   ## Цель
   <краткая цель>

   ## Шаги
   - [ ] …

   ## Verification
   - …
   ```

3. Добавить ОДНУ строку в таблицу `## active/` файла `planning/INDEX.md`:
   `| <slug>_<YYYY-MM-DD>.md | <краткая цель> | ACTIVE (с <дата>) |`

4. Не запускать долгие процессы и не спавнить агентов. Сообщить путь созданного файла.

> Lifecycle: Draft (`~/.claude/plans/`) → ACTIVE (`planning/active/`) → DONE → ARCHIVED
> (`planning/archive/plans/`). См. раздел «Навигация по planning/» в `CLAUDE.md`.
