-- Веха M5, шаг 4: себестоимость вызовов провайдера рядом с `generationId`.
--
-- До сих пор `usage.cost_rub` шлюза и длительность вызова уходили только в `console.info`
-- (aitunnel.ts) — при первом счёте от шлюза сверить фактический расход с ценой в баллах
-- было бы нечем, кроме логов платформы. `docs/SPEC.md` §8–§9 требует это с первого дня:
-- «Писать себестоимость каждого вызова в лог рядом с generationId».
--
-- **Одна строка — один вызов вендора**, не одна строка на генерацию: пять операций
-- контракта могут уйти разным вендорам (ADR-0005), а `generateImages` при `objects_count`
-- больше единицы — это несколько независимых оплаченных вызовов, не один. Суммировать на
-- лету в коде значило бы терять разбивку, которая и нужна для разбора расхождения.
--
-- **Область этой таблицы — cтоимость ГЕНЕРАЦИИ**, не любого вызова провайдера вообще:
-- `recognize` (шаг мастера, ещё без генерации и без гарантии, что она вообще будет создана)
-- сюда сознательно не входит — у него уже есть отдельная, посчитанная ранее себестоимость
-- (0,13 ₽ из 4,13 ₽, шаг 5 плана вехи) и своя причина существования (защита от чужого
-- трафика), а не сверка цены в баллах за генерацию. Смешивать оба смысла в одной таблице —
-- усложнение без надобности (YAGNI): понадобится взгляд на стоимость `recognize` по
-- строкам — это отдельная маленькая миграция по образцу этой, а не расширение этой сейчас.
--
-- `generation_id not null` и `on delete cascade` — не как у `ledger` (ADR-0009, переживает
-- удаление аккаунта обезличенным): это внутренняя бухгалтерия себестоимости, не финансовый
-- журнал перед пользователем, и смысла без своей генерации не имеет. Из этого же следует
-- известный, принятый пробел: вызов `moderate`, ЗАВЕРШИВШИЙСЯ ОТКАЗОМ (заявка отклонена до
-- `create_generation`), потратил рубли шлюза, но генерации, к которой их привязать, не
-- возникло — эта строка не пишется. Сумма пренебрежимо мала (~0,05 ₽ на отклонённую заявку)
-- и не входит в сверку цены за генерацию, которую решает этот шаг; расширять схему ради
-- этого случая сейчас — усложнение без обоснованной надобности.

create table public.generation_costs (
  id bigint generated always as identity primary key,
  generation_id uuid not null references public.generations (id) on delete cascade,
  operation text not null
    check (operation in ('moderate', 'generateImages', 'composeCard', 'nameGeneration')),
  vendor text not null,
  cost_rub numeric(10, 4) not null check (cost_rub >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

comment on table public.generation_costs is
  'Себестоимость и длительность каждого вызова провайдера за генерацию (docs/SPEC.md §8–§9, шаг 4 плана вехи M5). Одна строка — один вызов вендора, не одна на генерацию.';
comment on column public.generation_costs.operation is
  'Имя операции контракта ai-provider (types.ts) — тем же словом, что метод интерфейса, без перевода. recognize сюда не входит — см. заголовок миграции.';
comment on column public.generation_costs.vendor is
  'Профиль провайдера на момент вызова (providerProfile().name — "stub" или "aitunnel"). Не читается из ai-provider.ts: смена вендора не должна требовать миграции.';
comment on column public.generation_costs.cost_rub is
  '`usage.cost_rub` ответа шлюза для живого вендора; 0 для заглушки. Дробные рубли — не баллы, сюда не подмешиваются (ledger.delta остаётся единственным местом движения баллов).';

create index generation_costs_generation_idx on public.generation_costs (generation_id);

alter table public.generation_costs enable row level security;

-- Себестоимость — внутренняя цифра маржи, не то, что видит пользователь (в отличие от
-- generations/generation_assets рядом). Ни одной select-политики намеренно: только
-- service-role читает и пишет, RLS для него не действует.
revoke all on public.generation_costs from anon, authenticated;

-- Запись — только через функцию, по тому же правилу, что charge_for_generation и
-- finish_generation: контролируемая точка записи вместо прямого INSERT из Edge Function,
-- и один вызов сохраняет сразу все накопленные за генерацию записи одной транзакцией.
create function public.record_generation_costs(
  target_generation uuid,
  entries jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.generation_costs (generation_id, operation, vendor, cost_rub, duration_ms)
  select target_generation,
         entry ->> 'operation',
         entry ->> 'vendor',
         (entry ->> 'costRub')::numeric,
         (entry ->> 'durationMs')::integer
    from jsonb_array_elements(entries) as entry;
$$;

comment on function public.record_generation_costs(uuid, jsonb) is
  'Пишет накопленные за генерацию вызовы провайдера одной транзакцией (шаг 4 плана вехи M5). Пустой entries — не глядя на generation_id (finish/fail могли обойтись без вызовов провайдера, что штатно).';

revoke all on function public.record_generation_costs(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_generation_costs(uuid, jsonb) to service_role;
