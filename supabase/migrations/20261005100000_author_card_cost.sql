-- Операция провайдера `authorCard` — сочинение карточки в HTML (ADR-0019, п. 3; шаг C1 плана
-- `html-layout-authoring_2026-10-05.md`).
--
-- Каждый вызов сочинения — платный вызов модели шлюза и пишется отдельной строкой
-- `generation_costs` под тем же словом, что метод интерфейса `ai-provider`. Проверка перечисляет
-- допустимые имена, поэтому без этой миграции `record_generation_costs` упал бы на первой строке
-- `authorCard` и унёс бы с собой остальные затраты генерации — так же, как с `directCard`
-- (`20261003120000_generation_costs_direct_card.sql`).

alter table public.generation_costs
  drop constraint generation_costs_operation_check;

alter table public.generation_costs
  add constraint generation_costs_operation_check
  check (operation in ('moderate', 'generateImages', 'composeCard', 'nameGeneration', 'directCard', 'authorCard'));
