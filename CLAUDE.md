# Merch Kit — Claude Code entrypoint

> Автозагружается в каждую сессию Claude Code. **Это адаптер, а не канон.**
> Общие правила проекта — в корневом [`AGENTS.md`](AGENTS.md), он подтягивается импортом ниже.
> Здесь — **только то, чего нет у других хостов**. Не дублируй сюда содержимое канона: две
> копии правила расходятся, и становится непонятно, какая из них правило.

@AGENTS.md

---

## Claude-native рантайм

Что даёт именно Claude Code сверх канона (у Harvi Code и Copilot этого нет):

- **Скилы автообнаруживаются** из `.claude/skills/` и подтягиваются по релевантности. Правило
  consult-first — в каноне; здесь важно, что тебе не нужно открывать `INDEX.md` вручную, чтобы
  узнать о существовании скила. Карта — `.claude/skills/INDEX.md`.
- **Нативные слэш-команды** из `.claude/commands/`: `/spec-intake`, `/plan-new`,
  `/plan-status`, `/plan-archive`, `/review-branches` (последняя — пауза на смену
  модели/эффорта).
- **Субагенты** из `.claude/agents/` + инструмент `Agent`. Модель субагента — поле `model`
  (параметр вызова или frontmatter). Продолжать существующего агента — через `SendMessage`,
  а не новым холодным спавном.
- **Hooks** в `.claude/settings.json` (заготовка закомментирована). Опционально —
  SessionStart-хук, подмешивающий карту скилов в контекст; по умолчанию выключен,
  consult-first держится правилом.
- **Ponytail** приезжает плагином через `.claude/settings.json` (в Copilot — через
  `.github/instructions/ponytail.instructions.md`). Проверка — `docs/PONYTAIL_SETUP.md`.
- **Озвучивание (TTS, Windows):** ручное чтение выделенного текста через задачу VS Code
  `Speak Clipboard` + `/speech on|off|status` для автоозвучивания ответа по завершении хода
  (Stop-хук). Голос — Piper, если установлен (`tools/piper/install-piper.ps1`, опционально), иначе
  `System.Speech`. Регистрация хука — машинно-зависима, не коммитится. Установка —
  `docs/SPEECH_SETUP.md`.
- **Plan mode:** черновики планов живут в `~/.claude/plans/<slug>.md` — это стадия `Draft`
  перед `ACTIVE` в lifecycle из канона.

## Долгая память — только у Claude Code

Живёт **вне репозитория**: `~/.claude/projects/<derived-from-path>/memory/` — индекс
`MEMORY.md` + файлы-факты. Стартовый набор — `memory-seed/` (ставится вручную).
Устройство и вычисление каталога — [`docs/MEMORY_GUIDE.md`](docs/MEMORY_GUIDE.md).

На бутстрапе читается только индекс; факты — по релевантности. У Harvi Code и Copilot памяти
нет — не ссылайся на неё в артефактах, которые они будут читать.

## Мониторинг длительных прогонов — Claude-конкретика

Канон требует «низкошумного опроса». В Claude Code это значит:

- **`ScheduleWakeup` + `tail -N | grep -vE '<шум>'`, а не `Monitor`** — одно уведомление
  вместо десятков heartbeat-событий.
- **Интервал — под то, чего реально ждёшь, а не под кэш промптов.** TTL кэша здесь часовой,
  так что частый опрос «ради тёплого кэша» — чистые потери; таких wakeup не ставить.
- Внешний процесс без уведомления (CI, деплой) — по его скорости · fallback при наличии
  другого сигнала — 1200 с+ · холостой тик — 1200–1800 с.
- Фоновая задача: `Bash(run_in_background=true)` + `ScheduleWakeup` в одном ходе. Харнесс
  уведомит о завершении — не поллить, ставить длинный fallback.
- Windows: не `TaskStop` фонового монитора, пока жив bash-родитель.

Развёрнуто — [`docs/WORKING_RULES.md`](docs/WORKING_RULES.md) §1, §4.

## Конвенции кода — точка входа

Правила по областям — `.github/instructions/*.instructions.md`. В Copilot активируются по
`applyTo`-глобу; тебе их надо открыть по пути.

- TypeScript-конвенции — `.github/instructions/typescript.instructions.md`.
- React-конвенции — `.github/instructions/react.instructions.md`.
- Общие правила — `.github/instructions/general-code.instructions.md`.

<!-- Project-specific guidance: допиши сюда нюансы запуска Vite и локального Supabase,
известные баги, особенности отладки Edge Functions и т.п.
Жёсткие архитектурные границы проекта — в AGENTS.md (они кросс-AI), не здесь. -->
