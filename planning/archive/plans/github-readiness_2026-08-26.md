# GitHub-готовность репозитория

Status: DONE (2026-08-26)

## Context

Репозиторий до сих пор жил только локально: ни одного коммита, remote не заведён.
Локальный хук `githooks/pre-commit` защищает trunk лишь на этой машине — он не пушится
и ничего не гарантирует на GitHub. Сторонним контрибьюторам-людям правила проекта
недоступны: `AGENTS.md` написан для AI-агентов и говорит на языке полос доверия.

Запись-предтеча — B1 в `planning/BACKLOG.md`.

## Цель

Подготовить репо к публикации на `https://github.com/ovr58/MerchKit.git`: снять разнобой
`master`↔`main`, описать серверный аналог локального хука (branch protection), дать людям
человекочитаемые правила контрибьюции и шаблон PR.

## Шаги

- [x] 1. Развилка `master`↔`main`: зафиксировать `main` (совпадает с GitHub-дефолтом).
      Проверить, что документы/хук/память не ссылаются на `master` как на trunk этого репо.
- [x] 2. `docs/BRANCH_PROTECTION.md` — настройка защиты `main` на GitHub как серверный
      аналог `githooks/pre-commit`: запрет прямого push, обязательный PR, статус-чеки
      под будущий CI. Согласовать с полосами доверия (ADR-0002): доверенная полоса
      сохраняет fast-merge, консервативная — ждёт ревью.
- [x] 3. `CONTRIBUTING.md` — для людей: установка хука, ветвление, PR-флоу, ревью,
      стиль коммитов. Отдельно от AI-канона в `AGENTS.md`, со ссылкой на него.
- [x] 4. `.github/PULL_REQUEST_TEMPLATE.md`. `CODEOWNERS` — сознательно не заводим
      (репо одного мейнтейнера; обоснование — в `docs/BRANCH_PROTECTION.md`).
- [x] 5. Ссылки: README → CONTRIBUTING/BRANCH_PROTECTION; B1 в `BACKLOG.md` помечена
      заведённой; строка плана в `planning/INDEX.md`.
- [x] 6. Первая публикация: `origin` → `https://github.com/ovr58/MerchKit.git`, ветка
      влита в `main` fast-forward, push по явной команде пользователя.

## Verification

- `git branch --show-current` на trunk даёт `main`; `grep -rn "master"` по репо не находит
  упоминаний `master` как trunk этого проекта (остаются только двойные проверки в хуке
  и в командах — они по смыслу host-neutral).
- Коммит в `main` напрямую отбивается хуком (`.git/hooks/pre-commit` установлен).
- `docs/BRANCH_PROTECTION.md` содержит настройки, воспроизводимые вручную в UI и командой
  `gh api` — без «примерно так».
- `git push -u origin main` проходит; `git ls-remote origin` показывает `refs/heads/main`.

## Ограничения

- Сама защита веток на GitHub включается владельцем репо в настройках — агент этого сделать
  не может (нет авторизованного `gh`). План даёт воспроизводимую инструкцию, а не факт
  включённой защиты.

## Что реально сделано

- `main` подтверждён как trunk: переименовывать нечего, упоминания `master` в репо остались
  только там, где они host-neutral (`githooks/pre-commit`, `.claude/commands/review-branches.md`).
- Заведён `docs/BRANCH_PROTECTION.md`: ruleset на `main` (запрет удаления и force-push,
  обязательный PR, `Required approvals: 0` для репо одного мейнтейнера, статус-чеки — вместе
  с будущим CI), раскладка на полосы доверия, воспроизводящая команда `gh api`, отказ от
  `CODEOWNERS` с обоснованием.
- Заведён `CONTRIBUTING.md` для людей: установка хука, конвенция веток, стиль коммитов,
  PR-флоу и ревью, таблица «что обновлять вместе с кодом», три инварианта проекта.
- Заведён `.github/PULL_REQUEST_TEMPLATE.md`.
- Ссылки: `README.md` → `CONTRIBUTING.md` и `docs/BRANCH_PROTECTION.md`; B1 перенесена в
  «Закрытые» в `planning/BACKLOG.md`.
- Первый коммит репозитория сделан на ветке `claude/github-readiness`, влит в `main`
  fast-forward и запушен в `https://github.com/ovr58/MerchKit.git` по команде пользователя.

## Осталось за пользователем

Само включение branch protection — ручной шаг владельца репозитория: локальный `gh` не
авторизован (`gh auth status` → «not logged into any GitHub hosts»), настройки репозитория
агент не менял. Порядок — `docs/BRANCH_PROTECTION.md`.
