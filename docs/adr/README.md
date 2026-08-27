# Architecture Decision Records (ADR)

Необратимые / дорогие-к-откату решения — **по одному файлу на решение**. Дополняет «Конвенции
кода» в `CLAUDE.md` (там — где живёт термин; здесь — где живёт решение) и `CONTEXT.md` (единый
язык проекта).

## Правила

- **Файл-на-решение:** `NNNN-slug.md`, номер — сквозной инкремент (`0001`, `0002`, …). Шаблон —
  [`0000-template.md`](0000-template.md).
- **Только необратимое / удивительное / с реальным трейд-оффом.** Обратимое остаётся в плане/PR,
  а не здесь (см. скилы `domain-modeling`, `grill-with-docs`).
- **Историю не переписываем:** устаревшее решение не редактируем на месте — заводим новый ADR со
  `Status: Accepted`, а старому ставим `Superseded by ADR-XXXX`.
- **Кросс-линк:** из кода/комментария, который ADR ограничивает, ссылаться на конкретный
  `docs/adr/NNNN-*.md`; из `CONTEXT.md` — если ADR определяет термин.

## Индекс

| ADR | Дата | Статус | Решение |
| --- | --- | --- | --- |
| [0001](0001-agents-md-canon-without-ai-layer.md) | 2026-08-26 | Accepted | Канон кросс-AI правил — `AGENTS.md` + host-neutral `.claude/`; слой `.ai/` не заводим |
| [0002](0002-trust-lane-by-model-not-host.md) | 2026-08-26 | Accepted | Полоса доверия (self-review / fast-merge) определяется моделью (Opus), а не хостом |
| [0003](0003-spec-first-initialization.md) | 2026-08-26 | Accepted | Инициализация spec-first: три входа интейка → `docs/TZ.md` + `SPEC.md` + `VISUALS.md`, обязательный handoff с паузой на смену модели |
| [0004](0004-single-visual-artifact.md) | 2026-08-26 | Accepted | Визуальный слой — один `docs/VISUALS.md` со стабильными ID `V-NN`, переписывается на месте; ТЗ и спека ссылаются, а не копируют |
| [0005](0005-ai-provider-abstraction.md) | 2026-08-26 | Accepted | AI-провайдер за интерфейсом `ai-provider` из четырёх операций; выбор вендора отложен, для `local` — заглушка |
| [0006](0006-supabase-as-backend.md) | 2026-08-26 | Accepted | Supabase — единственный бэкенд; чтение через RLS, баланс и вызов провайдера — только Edge Functions; баланс производен от журнала `ledger` |
| [0007](0007-vite-spa-no-ssr.md) | 2026-08-27 | Accepted | Vite + React-SPA без SSR; серверной логике негде жить, кроме Edge Functions |
