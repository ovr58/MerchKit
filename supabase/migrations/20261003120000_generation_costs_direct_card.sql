-- Операция провайдера `directCard` (арт-директор, ADR-0018, шаг B5.6 плана вехи M7).
--
-- Каждая попытка арт-директора — отдельный платный вызов текстовой модели, и пишется он
-- отдельной строкой `generation_costs` под тем же словом, что метод интерфейса `ai-provider`
-- (см. комментарий к колонке `operation` в `20260830000000_generation_costs.sql`). Проверка
-- перечисляет допустимые имена, поэтому без этой миграции `record_generation_costs` упал бы
-- на первой же строке `directCard` и унёс бы вместе с ней остальные затраты генерации.
--
-- Имя ограничения — то, что Postgres дал безымянной проверке колонки при создании таблицы.

alter table public.generation_costs
  drop constraint generation_costs_operation_check;

alter table public.generation_costs
  add constraint generation_costs_operation_check
  check (operation in ('moderate', 'generateImages', 'composeCard', 'nameGeneration', 'directCard'));
