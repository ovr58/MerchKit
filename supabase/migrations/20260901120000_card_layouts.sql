-- Веха M7, шаг B0: библиотека макетов и снимок конкретной сборки.
--
-- Макет — данные по схеме A1, а не файл, зашитый в функцию. Таблица — источник правды для
-- подбора и сборки; `tools/card-pipeline/samples/` остаётся рабочей копией для офлайн-конвейера.
-- Снимок рядом с генерацией намеренно дублирует библиотеку: её будущая правка не должна менять
-- уже оплаченную карточку при бесплатной пересборке (ADR-0013).

/* -------------------------------------------------------------- библиотека макетов */

create table public.card_layouts (
  id text primary key,
  title text not null check (title <> ''),
  layout jsonb not null,
  source text not null check (source <> ''),
  category_id text references public.categories (id),
  marketplace_id text references public.marketplaces (id),
  preset_id text references public.presets (id),
  uses_logo boolean not null default false,
  hands_hidden boolean not null default false,
  is_fallback boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.card_layouts is
  'Библиотека макетов карточек (M7 B0): CardLayout хранится jsonb, теги подбора ссылаются на справочники. Рабочая копия — tools/card-pipeline/samples; читает только service_role.';
comment on column public.card_layouts.layout is
  'Макет CardLayout по схеме A1. Ёмкость модулей, число кадров, cutout и пропорция выводятся представлением card_layout_metadata, а не хранятся рядом.';
comment on column public.card_layouts.source is
  'Откуда получен образец: путь файла, URL или «собран вручную». Нужен, чтобы библиотека не теряла происхождение.';
comment on column public.card_layouts.hands_hidden is
  'Тег K-4: кисти человека в кадре скрыты или не в фокусе. Заполняется подтверждёнными данными B2.0.';
comment on column public.card_layouts.is_fallback is
  'Универсальный макет — последний рубеж подбора, когда совпадений по тегам нет.';

-- Производные признаки живут в представлении: для 34 строк библиотеки вычисление дешевле и
-- надёжнее ручной денормализации, а представление всегда читает текущий JSON-макет.
create view public.card_layout_metadata
with (security_invoker = on) as
with recursive layers (layout_id, layer) as (
  select l.id, element
    from public.card_layouts l
    cross join lateral jsonb_array_elements(l.layout -> 'layers') as element
  union all
  select layers.layout_id, child
    from layers
    cross join lateral jsonb_array_elements(
      case when layers.layer ->> 'type' = 'group'
        then coalesce(layers.layer -> 'children', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as child
)
select
  l.id,
  count(*) filter (where layer -> 'bind' ->> 'kind' = 'prop')::integer as prop_slots,
  coalesce(max((coalesce(layer -> 'bind' ->> 'index', '0'))::integer)
    filter (where layer -> 'bind' ->> 'kind' = 'frame') + 1, 0)::integer as frames,
  coalesce(bool_or(layer ->> 'type' = 'cutout'), false) as has_cutout,
  (l.layout #>> '{canvas,aspectW}')::numeric as aspect_w,
  (l.layout #>> '{canvas,aspectH}')::numeric as aspect_h
from public.card_layouts l
left join layers on layers.layout_id = l.id
group by l.id, l.layout;

comment on view public.card_layout_metadata is
  'Производные признаки макета для подбора: prop_slots, frames, has_cutout и пропорция. Считаются из layout, поэтому не расходятся с ним.';

-- Библиотека обязана переживать пустой поиск. Это самостоятельный, исполнимый макет: даже до
-- первого `cards:layouts push` подбор вернёт кадр, а не пустой JSON. Рабочая копия при push
-- заменит его полным разбором dress-summer и сохранит за ним признак универсального макета.
insert into public.card_layouts (id, title, layout, source, is_fallback) values
  ('dress-summer',
   'Женская одежда: тёмная колонка слева, карточка размеров, нумерованные выгоды',
   jsonb_build_object(
     'id', 'dress-summer',
     'title', 'Женская одежда: тёмная колонка слева, карточка размеров, нумерованные выгоды',
     'canvas', jsonb_build_object(
       'aspectW', 665,
       'aspectH', 892,
       'background', jsonb_build_object('kind', 'solid', 'color', '#241c19')
     ),
     'layers', jsonb_build_array(
       jsonb_build_object(
         'id', 'frame',
         'type', 'frame',
         'z', 0,
         'box', jsonb_build_object('x', 0, 'y', 0, 'w', 1, 'h', 1),
         'fit', 'cover',
         'bind', jsonb_build_object('kind', 'frame')
       )
     )
   ),
   'tools/card-pipeline/samples/dress-summer.json',
   true);

-- Полный JSON всех 34 разборов, включая dress-summer, возвращает `cards:layouts push` после
-- db reset. Миграция хранит форму и гарантированный запасной вариант, а не второй снимок
-- рабочей копии на десятки тысяч строк.

/* -------------------------------------------------------------- снимок генерации */

create table public.generation_cards (
  generation_id uuid primary key references public.generations (id) on delete cascade,
  layout_id text references public.card_layouts (id),
  layout jsonb not null,
  content jsonb not null,
  font_map jsonb not null,
  assembled_at timestamptz not null default now()
);

comment on table public.generation_cards is
  'Снимок карточки конкретной генерации (M7 B0): выбранный layout_id для статистики, плюс неизменные layout/content/font_map для бесплатной воспроизводимой пересборки.';
comment on column public.generation_cards.layout_id is
  'Макет, выбранный из библиотеки. Nullable для старых снимков, если запись библиотеки позже удалена; пересборка читает layout-снимок.';

/* ------------------------------------------------------------------------------ доступ */

alter table public.card_layouts enable row level security;
alter table public.generation_cards enable row level security;

-- У библиотеки политик нет: и подбор, и превью, и сборка серверные. Снимок читает только
-- владелец своей генерации; пишет его service_role после сборки.
create policy generation_cards_select_own on public.generation_cards
  for select to authenticated using (
    exists (
      select 1
        from public.generations g
       where g.id = generation_cards.generation_id
         and app.is_owner(g.user_id)
    )
  );

revoke all on public.card_layouts from anon, authenticated;
revoke all on public.card_layout_metadata from anon, authenticated;
revoke all on public.generation_cards from anon, authenticated;
grant select on public.generation_cards to authenticated;
