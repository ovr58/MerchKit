# METHODOLOGY — модули методики из шаблона-родителя

> **Единственный источник** ответа на вопросы «какая методика в проекте включена, из чего она
> состоит, как её снять и до какой версии шаблона проект синхронизирован». В других файлах этот
> список не пересказывается — только ссылка сюда. Контракт модулей —
> [ADR-T0010](adr/T0010-methodology-profile-and-opt-out.md); в шаблоне таблица живёт в его
> `INIT.md` шаг 4б, здесь — потому что `INIT.md` удалён на бутстрапе проекта.

## Шаблон-родитель и точка синхронизации

| Что | Значение |
| --- | --- |
| Репозиторий шаблона | `D:\project-template` (git, ветка `main`) |
| Проект поднят из | `4d4a874` (2026-08-26) |
| **Синхронизирован до** | **`190e610` (2026-10-03)** — синхронизация 2026-10-03 |

## Модули

Правила снятия — ADR-T0010: решает владелец, один вопрос на модуль, одним изменением вместе со
ссылками (`grep -rn` по имени модуля и каждому пути). Хук снимается записью в
`.claude/settings.json`, файл остаётся. ADR модуля не удаляется — его supersede-ит новый ADR
«модуль снят, причина».

| Модуль | Статус | Носители — они же список для снятия |
| --- | --- | --- |
| **Ядро планирования** — дробление плана под холодного исполнителя | вкл | `.claude/skills/fragmenting-plans-for-executors/`, `.claude/commands/validate-plan.md` и их строки в `.claude/skills/INDEX.md` и `CLAUDE.md`; раздел «Изоморфное дробление» в `AGENTS.md`; скелет «Порядок исполнения» в `.claude/commands/plan-new.md`; строка `SEE ALSO` в `.claude/skills/executing-plans/SKILL.md`; ADR-T0011 |
| **Контур хуков** — предохранители, исполняемые харнессом | вкл | записи `SessionStart`, `SubagentStart` и `PreToolUse` (кроме `protect-irreplaceable`) в `.claude/settings.json`; файлы `.claude/hooks/session-start.mjs`, `session-start.md`, `pre-commit-reminder.js`, `analytics-registry.js`, `contour-own-worktree.js`, `contour-own-worktree.test.js` — `session-start.mjs` и `contour-own-worktree.js` снимаются только вместе. Карта — `docs/HOOKS_TEMPLATE.md` |
| **Слой Claude Code** — добыча истории сессий и seed-память | вкл | `.claude/skills/mining-session-transcripts/` (с `mine.py`) и строка в `.claude/skills/INDEX.md`; факты `memory-seed/` `bash-heredoc-8kb-limit`, `bash-backticks-eat-markdown-ids`, `heredoc-eats-backslash-escapes`, `js-replace-eats-dollar-patterns`, `lint-chain-hides-second-half`, `worktree-remove-fails-long-paths`, `worktree-may-hold-uncommitted-work`, `hook-reads-whole-command-string`, `node-test-directory-arg-fails` и их строки в `memory-seed/MEMORY.md` |
| **Супервизор** — параллельное исполнение строк плана с раскладкой по швам файлов | вкл — `planning/SUPERVISOR_HANDOFF.md` заводится при первом вызове команды | `.claude/commands/supervisor-prompt.md`, `.claude/agents/plan-executor.md`; абзац «Несколько исполнителей одновременно — через супервизора» в `AGENTS.md`; строка команды в `CLAUDE.md`; термины «Супервизор», «Хендоф супервизора», «Волна», «Чистая точка» в `CONTEXT.md`; строка `.tmp-review/` в `.gitignore`; `planning/SUPERVISOR_HANDOFF.md`, если заведён, — в `planning/archive/` со строкой `INDEX.md` |
| **Грабли харнесса** | вкл | факты `memory-seed/edit-needs-read-in-same-session`, `auto-mode-classifier-owns-irreversible`, `agent-worktree-starts-from-origin-main` и их строки в `memory-seed/MEMORY.md`; правило «общий грабль предлагается шаблону» в `AGENTS.md` и пункт 5 `.claude/skills/finishing-a-development-branch/SKILL.md`; строка про потолок чтения 256 КБ в `docs/WORKING_RULES.md` |
| **Аналитика и наблюдаемость** | вкл — метод привезён, проектирование не сделано (B25 в `planning/BACKLOG.md`) | `.claude/skills/instrumenting-analytics/` и строка в `.claude/skills/INDEX.md`; `docs/ANALYTICS.md`; `docs/SPEC.md` §9; хук `analytics-registry.js` (носитель — контур хуков); `planning/reference/ANALYTICS_RESEARCH.md`; ADR-T0005, ADR-T0006 |
| **Дизайн-система — реестр** | вкл, уровень 1, путь «минимум» | `docs/DESIGN_SYSTEM.md`; `docs/SPEC.md` §3.1; `planning/reference/DESIGN_SYSTEM_RESEARCH.md`; ADR-T0007, ADR-T0008, ADR-T0009 |
| **Дизайн-трио Figma** — кадр Figma как источник вёрстки | **выкл** — проект рисует в Claude Design (`docs/design/`), Figma-кадров нет | не привезены: скилы `figma-to-code`, `drawing-in-figma-via-mcp`, `marking-design-edits-for-review`, `using-design-tokens`, хук `pre-figma-write.js`, `tools/fig-map.py`, ADR-0012 шаблона. Включить — привезти их из шаблона и поднять уровень в `docs/DESIGN_SYSTEM.md` |
| **UI-аудит** | **не заведён** на бутстрапе — харнесс `tools/ui-audit/` под WinUI, проект веб | скил `auditing-ui`, команда `/audit-ui`, `tools/ui-audit/` в шаблоне |
| **Адаптеры Copilot** | **не заведены** — решение в шапке `AGENTS.md` | `.github/copilot-instructions.md`, `.github/prompts/`, `.github/agents/` в шаблоне |
| **`/bug-intake`** | **не заведён** на бутстрапе | `.claude/commands/bug-intake.md` в шаблоне |

**Вне модулей — стоят всегда:** `.claude/hooks/protect-irreplaceable.js` (+ тест) и
`.claude/hooks/package.json` (CommonJS-область хуков, `docs/HOOKS_TEMPLATE.md`). Озвучивание
(`on-stop.ps1`, `/speech`) — опционально, регистрируется машинно в `settings.local.json`
(`docs/SPEECH_SETUP.md`).

## Как синхронизироваться в следующий раз

1. `git -C D:/project-template diff --name-status <Синхронизирован до> HEAD` — что поменялось.
2. По каждому файлу:
   - **нет в проекте** — решить по таблице модулей: носитель включённого модуля — привезти;
     выключенного или не заведённого — нет. Новый модуль шаблона — вопрос владельцу с дефолтом.
   - **в проекте не менялся** с прошлой синхронизации — взять версию шаблона;
   - **менялся с обеих сторон** — трёхстороннее слияние, база — шаблон на коммите
     «Синхронизирован до»: `git merge-file <проект> <база> <шаблон>`.
3. В привезённом тексте `ADR-00NN` (с `0005`) → `ADR-T00NN` — **только в строках, пришедших из
   шаблона**: в тех же файлах есть ссылки на собственные ADR проекта.
4. Сверить адреса, которые у проекта свои: номера NFR в `docs/TZ.md` (приватность — NFR-06,
   наблюдаемость — NFR-10), термины `CONTEXT.md` против домена (слово «кадр» занято доменом).
5. Не привозить артефакты самого шаблона: `INIT.md`, `EXAMPLE_INIT_PROMPT.md`, его
   `planning/active|archive`, `BACKLOG`, разведки о других проектах.
6. Обновить строку «Синхронизирован до» в этом файле — тем же изменением.
