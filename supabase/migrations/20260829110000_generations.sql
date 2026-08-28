-- Веха M4, шаг 2: заявка на генерацию, её результаты и переходы статуса по V-07.
--
-- **Статус двигают функции, а не воркер напрямую** (решение шага 0 плана вехи). Причина
-- одна: статус и движение баллов обязаны меняться в ОДНОЙ транзакции. Если воркер пометит
-- генерацию `failed` своим запросом, а возврат баллов сделает вторым, то падение между
-- ними оставит пользователя без результата и без денег — состояние, которое никто не
-- чинит и которое обнаружится в претензии. Здесь оба движения неразделимы.
--
-- Идемпотентность (NFR-03) держится на двух вещах сразу: уникальный ключ в `ledger`,
-- заложенный ещё на M3, и условный переход статуса. Повторная доставка события статуса
-- не находит генерацию в исходном состоянии и не делает ничего.

/* ------------------------------------------------------------------------- заявка */

create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  kind text not null check (kind in ('photo', 'card')),
  marketplace_id text not null references public.marketplaces (id),
  category_id text not null references public.categories (id),
  preset_id text references public.presets (id),
  product_title text not null check (length(btrim(product_title)) > 0),
  product_description text not null default '',
  wishes text not null default '',
  objects_count integer not null default 1 check (objects_count >= 1),
  price integer not null check (price > 0),
  title text,
  card_title text,
  card_description text,
  failure_reason text,
  source_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

comment on table public.generations is
  'Заявка на генерацию и её жизненный цикл (docs/VISUALS.md V-07). Единица продажи и учёта: именно она попадает в каталог и оплачивается (CONTEXT.md «Генерация»).';
comment on column public.generations.status is
  'Стадия по V-07: queued (принята, баллы списаны) → running → done | failed. Исходов ровно два: промежуточного partial нет (решение 2026-08-29).';
comment on column public.generations.kind is
  'Тип генерации: photo — только изображение, card — изображение с вёрсткой плюс заголовок и описание (FR-06, FR-07).';
comment on column public.generations.preset_id is
  'Выбранный сценарий показа. NULL допустим: у категории «Прочее» сценариев нет, там работает только свободный ввод (FR-08, FR-09).';
comment on column public.generations.objects_count is
  'Объектов в результате. Потолок — политика продаж, а не ограничение схемы: он живёт в pricing.ts (MAX_OBJECTS_PER_GENERATION) и снимается там, без миграции.';
comment on column public.generations.price is
  'Цена в баллах, посчитанная СЕРВЕРОМ. Клиентская цена справочная (docs/SPEC.md §3): расхождение — ошибка, а не «клиент прав».';
comment on column public.generations.title is
  'Название генерации от ИИ (FR-16). Заполняется при переходе в done: список из «Генерация №17» нечитаем.';
comment on column public.generations.card_title is
  'Заголовок карточки (FR-07). Только для kind = card и только при done: неполная карточка не отдаётся вовсе (US-E4).';
comment on column public.generations.source_paths is
  'Пути входных фото в приватном бакете uploads. До четырёх (FR-02): ограничение на ВХОД, не на выход.';
comment on column public.generations.failure_reason is
  'Человеческая причина неуспеха для экрана результата. Устройство провайдера наружу не выносим.';

-- Каталог читается ровно одним способом: свои генерации, свежие сверху (FR-01).
create index generations_user_created_idx
  on public.generations (user_id, created_at desc);

/* --------------------------------------------------------------------- результаты */

create table public.generation_assets (
  id bigint generated always as identity primary key,
  generation_id uuid not null references public.generations (id) on delete cascade,
  storage_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  format text not null,
  created_at timestamptz not null default now(),
  unique (generation_id, storage_path)
);

comment on table public.generation_assets is
  'Изображения генерации в приватном бакете results. Тексты карточки живут в generations: они пишутся на генерацию целиком, а не на каждое изображение.';
comment on column public.generation_assets.width is
  'Фактический размер сохранённого файла. Хранится, чтобы соответствие профилю FR-25 можно было проверить по базе, а не перекачивая файл.';
comment on constraint generation_assets_generation_id_storage_path_key on public.generation_assets is
  'Повторная доставка события завершения не задваивает результат (NFR-03).';

/* -------------------------------------------- связь журнала с генерацией (долг вехи M3) */

-- Тот самый внешний ключ, который M3 отложила: таблицы `generations` тогда не существовало.
-- `on delete set null`, а не каскад: строка журнала переживает удаление аккаунта
-- обезличенной (ADR-0009), и удаление генерации не имеет права уносить учётную запись.
alter table public.ledger
  add column generation_id uuid references public.generations (id) on delete set null;

comment on column public.ledger.generation_id is
  'Генерация, породившая операцию. Заполняется из context триггером ниже: списание и возврат кладут туда generation_id с вехи M3, и менять единственную точку изменения баланса ради колонки незачем.';

create index ledger_generation_idx on public.ledger (generation_id)
  where generation_id is not null;

-- Колонку заполняет триггер, а не `apply_credit_operation`. Так функция изменения баланса —
-- код, который дороже всего сломать, — остаётся ровно той, что написана и проверена на M3.
create function app.ledger_link_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.generation_id := (new.context ->> 'generation_id')::uuid;
  return new;
end;
$$;

comment on function app.ledger_link_generation() is
  'Достаёт generation_id из context строки журнала в отдельную колонку — ради внешнего ключа на generations.';

create trigger ledger_link_generation_trg
  before insert on public.ledger
  for each row
  execute function app.ledger_link_generation();

/* ------------------------- следствие: параметры функций M3 переименованы */

-- Миграция журнала M3 предупреждала: «имена параметров нарочно не совпадают с именами
-- колонок — PL/pgSQL подставляет переменные в выражения, и одноимённый параметр превратил
-- бы ссылку на колонку в неоднозначную». Колонка `ledger.generation_id`, добавленная выше,
-- ровно это и сделала с параметром `generation_id` у функций списания и возврата: запрос
-- внутри `refund_for_generation` перестал понимать, что значит `generation_id`.
--
-- Поймано тестом `ledger_operations.test.sql` (ERROR 42702), а не на проде. Правится
-- переименованием параметра, а не переименованием колонки: правило M3 остаётся правилом.
-- `create or replace` имя параметра менять не умеет, поэтому обе функции пересоздаются
-- целиком — тела ниже дословно те же, что были написаны и проверены на M3.

drop function public.charge_for_generation(uuid, uuid, integer);
drop function public.refund_for_generation(uuid, uuid, integer);

create function public.charge_for_generation(
  owner_id uuid,
  target_generation uuid,
  price integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if price <= 0 then
    raise exception 'Списание за генерацию % должно быть положительным, получено %',
      target_generation, price;
  end if;

  -- V-07: заявка принята → статус `queued` → баллы списаны. Один ключ на генерацию:
  -- сколько бы раз событие ни доставили, списание одно.
  return public.apply_credit_operation(
    owner_id,
    - price,
    'charge',
    'generation:' || target_generation || ':charge',
    jsonb_build_object('generation_id', target_generation)
  );
end;
$$;

comment on function public.charge_for_generation(uuid, uuid, integer) is
  'Списание за генерацию (V-07, статус queued). Цену считает сервер: клиентская цена справочная (docs/SPEC.md §3).';

create function public.refund_for_generation(
  owner_id uuid,
  target_generation uuid,
  amount integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  charged integer;
begin
  -- Возврат опирается на журнал, а не на слово вызывающего: вернуть больше, чем списали,
  -- значит напечатать баллы из воздуха. Ошибка в воркере не должна этого мочь.
  select - delta into charged
    from public.ledger
   where idempotency_key = 'generation:' || target_generation || ':charge';

  if not found then
    raise exception 'Возврат по генерации % без списания', target_generation;
  end if;

  if amount <= 0 or amount > charged then
    raise exception 'Возврат по генерации % вне границ списания: списано %, просят %',
      target_generation, charged, amount;
  end if;

  -- Возврат на генерацию один: исходов у генерации два, и `failed` возвращает всё (US-E4).
  return public.apply_credit_operation(
    owner_id,
    amount,
    'refund',
    'generation:' || target_generation || ':refund',
    jsonb_build_object('generation_id', target_generation, 'charged', charged)
  );
end;
$$;

comment on function public.refund_for_generation(uuid, uuid, integer) is
  'Возврат за генерацию (V-07, failed — полностью). Больше списанного не вернёт.';

revoke all on function public.charge_for_generation(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.refund_for_generation(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.charge_for_generation(uuid, uuid, integer) to service_role;
grant execute on function public.refund_for_generation(uuid, uuid, integer) to service_role;

/* ------------------------------------------------------- переходы статуса (V-07) */

-- Заявка принята: запись и списание в одной транзакции. Порознь их делать нельзя — падение
-- между ними оставляет либо неоплаченную генерацию, либо списание в никуда.
create function public.create_generation(
  owner_id uuid,
  generation_kind text,
  marketplace text,
  category text,
  preset text,
  title_of_product text,
  description_of_product text,
  free_wishes text,
  photo_paths text[],
  charged_price integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  preset_category text;
begin
  -- Сценарий обязан принадлежать выбранной категории, а у «Прочего» его быть не может
  -- (FR-08). Проверка стоит здесь, а не только в интерфейсе: списание уже произошло бы.
  if preset is not null then
    select category_id into preset_category from public.presets where id = preset;

    if not found then
      raise exception 'Неизвестный сценарий показа: %', preset;
    end if;

    if preset_category <> category then
      raise exception 'Сценарий % не принадлежит категории %', preset, category;
    end if;
  end if;

  insert into public.generations (
    user_id, kind, marketplace_id, category_id, preset_id,
    product_title, product_description, wishes, source_paths, price
  ) values (
    owner_id, generation_kind, marketplace, category, preset,
    title_of_product, coalesce(description_of_product, ''), coalesce(free_wishes, ''),
    coalesce(photo_paths, '{}'), charged_price
  )
  returning id into new_id;

  -- Недостаток баллов поднимет исключение внутри (US-E3) — вся транзакция откатится, и
  -- заявки не останется. Это и есть «не запускать генерацию и не списывать баллы».
  perform public.charge_for_generation(owner_id, new_id, charged_price);

  return new_id;
end;
$$;

comment on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer) is
  'Заявка на генерацию: строка и списание в одной транзакции (V-07, статус queued). Не хватает баллов — откатывается всё, заявки не остаётся (US-E3).';

create function public.start_generation(target_generation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.generations
     set status = 'running', started_at = now()
   where id = target_generation and status = 'queued';
$$;

comment on function public.start_generation(uuid) is
  'Воркер взял задачу: queued → running (V-07). Условие по статусу делает повторную доставку события no-op (NFR-03).';

create function public.finish_generation(
  target_generation uuid,
  generated_title text,
  title_of_card text,
  description_of_card text,
  assets jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  finished_kind text;
begin
  update public.generations
     set status = 'done',
         title = generated_title,
         card_title = title_of_card,
         card_description = description_of_card,
         finished_at = now()
   where id = target_generation and status = 'running'
  returning kind into finished_kind;

  -- Генерация уже не в работе: либо событие доставлено повторно, либо её успели завалить.
  -- И то и другое — не ошибка, но и делать больше нечего (NFR-03).
  if not found then
    return;
  end if;

  -- Половину карточки не отдаём (US-E4). Проверка здесь — последняя: воркер обязан был
  -- позвать fail_generation, но контракт «done без текстов невозможен» держит база.
  if finished_kind = 'card'
     and (coalesce(btrim(title_of_card), '') = '' or coalesce(btrim(description_of_card), '') = '')
  then
    raise exception 'Карточка % без заголовка или описания не может быть завершена (US-E4)',
      target_generation;
  end if;

  insert into public.generation_assets (generation_id, storage_path, width, height, format)
  select target_generation,
         asset ->> 'storage_path',
         (asset ->> 'width')::integer,
         (asset ->> 'height')::integer,
         asset ->> 'format'
    from jsonb_array_elements(coalesce(assets, '[]'::jsonb)) as asset
  on conflict (generation_id, storage_path) do nothing;

  if not exists (
    select 1 from public.generation_assets a where a.generation_id = target_generation
  ) then
    raise exception 'Генерация % не может быть завершена без изображения', target_generation;
  end if;
end;
$$;

comment on function public.finish_generation(uuid, text, text, text, jsonb) is
  'running → done (V-07): название от ИИ, тексты карточки и результаты одной транзакцией. Завершиться без изображения или с половиной карточки не даёт (FR-07, US-E4).';

create function public.fail_generation(
  owner_id uuid,
  target_generation uuid,
  reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  charged integer;
begin
  update public.generations
     set status = 'failed', failure_reason = reason, finished_at = now()
   where id = target_generation
     and user_id = owner_id
     and status in ('queued', 'running')
  returning price into charged;

  -- Генерация уже в конечном состоянии. Возвращать повторно нечего: `done` оплачена
  -- по делу, а по `failed` возврат уже прошёл (NFR-03).
  if not found then
    return (select balance from public.profiles where id = owner_id);
  end if;

  -- Возврат ПОЛНЫЙ и всегда (FR-13). Промежуточного исхода нет: не получилось изображение
  -- или не получились тексты карточки — с точки зрения баланса это один и тот же случай.
  return public.refund_for_generation(owner_id, target_generation, charged);
end;
$$;

comment on function public.fail_generation(uuid, uuid, text) is
  'queued|running → failed (V-07) с ПОЛНЫМ возвратом баллов в той же транзакции (FR-13, US-E4). Готовую генерацию не трогает.';

/* ------------------------------------------------------------------------------ доступ */

alter table public.generations enable row level security;
alter table public.generation_assets enable row level security;

-- Чтение своих строк. Политик на запись нет намеренно: статус двигают функции выше, а их
-- вызывает Edge Function с service-role, которая RLS обходит (NFR-04, NFR-05).
create policy generations_select_own on public.generations
  for select to authenticated using (app.is_owner(user_id));

create policy generation_assets_select_own on public.generation_assets
  for select to authenticated using (
    exists (
      select 1 from public.generations g
       where g.id = generation_assets.generation_id and app.is_owner(g.user_id)
    )
  );

revoke all on public.generations from anon, authenticated;
revoke all on public.generation_assets from anon, authenticated;
grant select on public.generations to authenticated;
grant select on public.generation_assets to authenticated;

-- Поимённо: прямые гранты Supabase не снимаются через PUBLIC (см. миграцию ledger).
revoke all on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer)
  from public, anon, authenticated;
revoke all on function public.start_generation(uuid) from public, anon, authenticated;
revoke all on function public.finish_generation(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_generation(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer)
  to service_role;
grant execute on function public.start_generation(uuid) to service_role;
grant execute on function public.finish_generation(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.fail_generation(uuid, uuid, text) to service_role;
