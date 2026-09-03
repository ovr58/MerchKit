-- Веха M7, шаг B3: логотип продавца в заявке.
--
-- **Отдельная колонка, а не пятый путь в `source_paths`.** Оба массива — пути в бакете
-- `uploads`, но живут они по-разному: входные фото уезжают вендору референсами товара и
-- возвращаются в мастер при повторе неуспешной генерации (US-E4), а знак не делает ни того
-- ни другого — его ставит наш сборщик по привязке `logo` (ADR-0012). Слей мы их в один
-- массив, вендор получил бы знак пятым фото товара, а повтор вернул бы его миниатюрой фото.
--
-- **Знак допустим только у карточки.** У генерации типа `photo` макета нет вовсе, ставить
-- знак некуда — то же правило и по той же причине, что у снимка макета (миграция
-- `20260901160000`). Проверка стоит в схеме, а не только в интерфейсе: путь в базу ведёт и
-- мимо мастера.
--
-- Требования к самому файлу (PNG, прозрачность, минимальная сторона) схема не проверяет:
-- байтов она не видит. Их проверяет `supabase/functions/_shared/logo.ts` — одинаково у
-- клиента до отправки и у `generate` перед списанием баллов.

alter table public.generations
  add column logo_path text
  check (logo_path is null or length(btrim(logo_path)) > 0);

alter table public.generations
  add constraint generations_logo_only_for_card
  check (logo_path is null or kind = 'card');

comment on column public.generations.logo_path is
  'Путь знака продавца в приватном бакете uploads (шаг B3). NULL — штатный случай: слой logo снимается правилом K-3, карточка собирается без него.';

-- Ещё одна перегрузка по той же причине, что и у свойств товара (миграция 20260901140000):
-- прежний контракт остаётся для старых заявок и тестов, а новый путь передаёт знак явно.
-- Default здесь нельзя — он сделал бы прежний вызов неоднозначным.
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
  properties jsonb,
  logo text
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
    product_title, product_description, wishes, product_properties, source_paths, price, logo_path
  ) values (
    owner_id, generation_kind, marketplace, category, preset,
    title_of_product, coalesce(description_of_product, ''), coalesce(free_wishes, ''),
    coalesce(properties, '[]'::jsonb), coalesce(photo_paths, '{}'), charged_price,
    nullif(btrim(coalesce(logo, '')), '')
  )
  returning id into new_id;

  perform public.charge_for_generation(owner_id, new_id, charged_price);

  return new_id;
end;
$$;

comment on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb, text) is
  'Заявка на генерацию: строка, подтверждённые свойства B1, знак продавца B3 и списание в одной транзакции (V-07). Не хватает баллов — откатывается всё, заявки не остаётся (US-E3).';

revoke all on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_generation(uuid, text, text, text, text, text, text, text, text[], integer, jsonb, text)
  to service_role;
