-- Веха M7, шаг B1: подтверждённые продавцом свойства товара.
--
-- Извлечение — лишь помощь текстовой модели: в заявке сохраняется список, который продавец
-- увидел и при необходимости изменил. Порядок несёт смысл важности и позднее определит, что
-- попадёт в ограниченную ёмкость выбранного макета (B2/B6).

alter table public.generations
  add column product_properties jsonb not null default '[]'::jsonb
  check (jsonb_typeof(product_properties) = 'array');

comment on column public.generations.product_properties is
  'Свойства товара из B1: массив объектов {label, value} в подтверждённом продавцом порядке важности. Это вход B2/B5/B6, не результат генеративной модели без проверки.';

-- Это отдельная перегрузка: прежний десятипараметровый контракт остаётся для старых заявок и
-- тестов, а новый путь передаёт список явно. Default здесь нельзя: он сделал бы старый вызов
-- неоднозначным. JSON проверяет функция, а не доверяет браузеру.
create or replace function public.create_generation(
  owner_id uuid,
  generation_kind text,
  marketplace text,
  category text,
  preset text,
  title_of_product text,
  description_of_product text,
  free_wishes text,
  photo_paths text[],
  charged_price integer,
  properties jsonb
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
  if jsonb_typeof(coalesce(properties, '[]'::jsonb)) <> 'array' then
    raise exception 'Свойства товара должны быть списком';
  end if;

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
    product_title, product_description, wishes, product_properties, source_paths, price
  ) values (
    owner_id, generation_kind, marketplace, category, preset,
    title_of_product, coalesce(description_of_product, ''), coalesce(free_wishes, ''),
    coalesce(properties, '[]'::jsonb), coalesce(photo_paths, '{}'), charged_price
  )
  returning id into new_id;

  perform public.charge_for_generation(owner_id, new_id, charged_price);

  return new_id;
end;
$$;

comment on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb) is
  'Заявка на генерацию: строка, подтверждённые свойства B1 и списание в одной транзакции (V-07). Не хватает баллов — откатывается всё, заявки не остаётся (US-E3).';

-- У текста модели есть денежная себестоимость, поэтому квота отдельна от распознавания фото:
-- расход одного не должен неожиданно отнимать лимит у другого действия.
create table public.product_properties_quota (
  subject text primary key,
  day date not null,
  used integer not null check (used > 0),
  updated_at timestamptz not null default now()
);

comment on table public.product_properties_quota is
  'Счётчик запросов B1 на извлечение свойств товара: хранит только sha256 отпечатка пользователя.';

create function public.consume_product_properties_quota(caller_key text, daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed integer;
begin
  if daily_limit <= 0 then
    raise exception 'Лимит подбора свойств должен быть положительным, получено %', daily_limit;
  end if;

  insert into public.product_properties_quota as q (subject, day, used)
  values (encode(sha256(convert_to(caller_key, 'utf8')), 'hex'), current_date, 1)
  on conflict (subject) do update
     set day = current_date,
         used = case when q.day = current_date then q.used + 1 else 1 end,
         updated_at = now()
  returning q.used into consumed;

  return consumed <= daily_limit;
end;
$$;

alter table public.product_properties_quota enable row level security;
revoke all on public.product_properties_quota from anon, authenticated;
revoke all on function public.consume_product_properties_quota(text, integer) from public, anon, authenticated;
grant execute on function public.consume_product_properties_quota(text, integer) to service_role;
revoke all on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb)
  to service_role;
