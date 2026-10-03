# MEMORY — индекс долгой памяти

> Одна строка-указатель на каждый факт. Загружается в контекст каждой сессии. Тела фактов —
> в отдельных файлах рядом, всплывают по релевантности. Формат и правила — `docs/MEMORY_GUIDE.md`.

- [Профиль пользователя](user-profile.md) — кто пользователь, роль, предпочтения
- [Дисциплина затрат лимитов](working-rules-limit-discipline.md) — как работать, не сжигая лимиты
- [Предел heredoc в Bash](bash-heredoc-8kb-limit.md) — ~8 КБ, heredoc рвётся с unexpected EOF
- [Обратные кавычки съедают markdown-id](bash-backticks-eat-markdown-ids.md) — правку markdown/коммит писать скриптом или файлом, не аргументом оболочки
- [Heredoc раскрывает обратный слэш](heredoc-eats-backslash-escapes.md) — в файл молча попадает управляющий символ; правку с `\` писать файлом-скриптом
- [Замена строкой раскрывает $-паттерны](js-replace-eats-dollar-patterns.md) — String.replace портит файл, писать замену функцией
- [Линт-цепочка прячет вторую половину](lint-chain-hides-second-half.md) — красный eslint обрывает `A && B` до второй проверки
- [worktree remove не удаляет каталог](worktree-remove-fails-long-paths.md) — «Filename too long» на Windows: реестр git чист, копия дерева остаётся на диске
- [Дерево может держать незакоммиченное](worktree-may-hold-uncommitted-work.md) — перед `worktree remove` смотреть `git status`, пустая ветка ≠ пустая работа
- [node --test каталогом — ложный fail](node-test-directory-arg-fails.md) — MODULE_NOT_FOUND с путём каталога; запускать по глобу в кавычках
- [Хук читает всю строку команды](hook-reads-whole-command-string.md) — упоминание `.env` в тексте коммита валит `git commit`; писать сообщение файлом и `-F`
- [Edit/Write требуют свежий Read](edit-needs-read-in-same-session.md) — форматтер, тронувший файл после чтения, делает чтение недействительным
- [Дерево Agent — от origin/main](agent-worktree-starts-from-origin-main.md) — isolation "worktree" не видит незапушенный main; исполнитель первым ходом делает ff-only main
- [Auto-режим: классификатор, а не хук](auto-mode-classifier-owns-irreversible.md) — необратимое удаление, мёрдж без ревью — шаг владельца, повтор той же командой не проходит
