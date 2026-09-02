-- Контракт библиотеки макетов и снимка у генерации (веха M7, шаг B0).
--
-- Производные признаки нельзя заполнять руками: они обязаны следовать из JSON-макета.
-- Отдельно держим последний рубеж подбора — хотя бы один универсальный макет — и закрываем
-- снимок генерации от чужого пользователя тем же правилом, что и остальные её данные.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_table('public', 'card_layouts', 'Библиотека макетов создана');
select has_table('public', 'generation_cards', 'Снимок карточки у генерации создан');
select policies_are(
  'public',
  'card_layouts',
  array[]::text[],
  'У библиотеки нет RLS-политик: она доступна только service-role'
);

select ok(
  exists (select 1 from public.card_layouts where is_fallback),
  'В библиотеке есть универсальный макет: подбор не упадёт на пустом совпадении'
);
select throws_ok(
  $$ insert into public.card_layouts (id, title, layout, source, is_fallback) values (
       'second-fallback', 'Второй универсальный',
       '{"id": "second-fallback", "title": "Второй универсальный",
         "canvas": {"aspectW": 3, "aspectH": 4, "background": {"kind": "solid", "color": "#ffffff"}},
         "layers": []}'::jsonb,
       'test', true) $$,
  '23505',
  null,
  'Второго универсального макета быть не может: иначе подбор перестаёт быть воспроизводимым'
);

insert into public.card_layouts (id, title, layout, source) values (
  'test-derived-layout',
  'Проверка производных признаков',
  '{
    "id": "test-derived-layout",
    "title": "Проверка производных признаков",
    "canvas": {"aspectW": 3, "aspectH": 4, "background": {"kind": "solid", "color": "#ffffff"}},
    "layers": [
      {"id": "frame-1", "type": "frame", "z": 0, "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "fit": "cover", "bind": {"kind": "frame"}},
      {"id": "frame-3", "type": "frame", "z": 1, "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "fit": "cover", "bind": {"kind": "frame", "index": 2}},
      {"id": "cutout", "type": "cutout", "z": 2, "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "fit": "cover", "bind": {"kind": "cutout"}},
      {"id": "prop-module", "type": "group", "z": 3, "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "bind": {"kind": "prop", "index": 0}, "children": [
        {"id": "prop-label", "type": "text", "z": 1, "box": {"x": 0, "y": 0, "w": 1, "h": 1}, "bind": {"kind": "prop", "index": 0, "part": "label"}, "style": {"role": "body", "size": 0.1, "weight": 400, "color": "#111111", "align": "left", "valign": "top", "lineHeight": 1}}
      ]}
    ]
  }'::jsonb,
  'test'
);

select is(
  (select prop_slots from public.card_layout_metadata where id = 'test-derived-layout'),
  1,
  'Ёмкость модулей считает уникальные prop-index, включая вложенные привязки одного модуля'
);
select is(
  (select uses_logo from public.card_layout_metadata where id = 'test-derived-layout'),
  false,
  'Использование логотипа выводится из привязок макета, а не хранится отдельно'
);
select is(
  (select frames from public.card_layout_metadata where id = 'test-derived-layout'),
  3,
  'Число кадров — максимальный индекс привязки frame плюс один'
);
select is(
  (select has_cutout from public.card_layout_metadata where id = 'test-derived-layout'),
  true,
  'Наличие слоя cutout выводится из макета'
);
select is(
  (select aspect_w from public.card_layout_metadata where id = 'test-derived-layout'),
  3::numeric,
  'Ширина пропорции выводится из canvas макета'
);
select is(
  (select aspect_h from public.card_layout_metadata where id = 'test-derived-layout'),
  4::numeric,
  'Высота пропорции выводится из canvas макета'
);

insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-000000000003', 'layout-owner@example.com'),
  ('dddddddd-0000-4000-8000-000000000004', 'layout-stranger@example.com');
update auth.users set email_confirmed_at = now()
 where id in ('cccccccc-0000-4000-8000-000000000003', 'dddddddd-0000-4000-8000-000000000004');

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values (
  '33333333-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000003',
  'card', 'wildberries', 'clothing', 'clothing-model', 'Тестовая куртка', 50, 'done'
);
select public.snapshot_generation_layout(
  '33333333-0000-4000-8000-000000000003',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);
select is(
  (select layout_id from public.generation_cards where generation_id = '33333333-0000-4000-8000-000000000003'),
  'dress-summer',
  'Серверный снимок сохраняет выбранный layout_id'
);
select is(
  (select content from public.generation_cards where generation_id = '33333333-0000-4000-8000-000000000003'),
  '{"texts": {}, "props": [], "swatches": []}'::jsonb,
  'B2 начинает снимок с пустого содержимого до сборки B7'
);

delete from public.generations where id = '33333333-0000-4000-8000-000000000003';

select is(
  (select count(*)::int from public.generation_cards),
  0,
  'Удаление генерации удаляет её снимок карточки каскадно'
);

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values (
  '33333333-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000003',
  'photo', 'wildberries', 'clothing', 'clothing-model', 'Тестовая куртка', 50, 'done'
);
select throws_ok(
  $$ select public.snapshot_generation_layout(
       '33333333-0000-4000-8000-000000000004',
       'dress-summer',
       (select layout from public.card_layouts where id = 'dress-summer')
     ) $$,
  'P0001',
  'Снимок макета допустим только для генерации карточки: 33333333-0000-4000-8000-000000000004',
  'Снимок макета нельзя записать для генерации фото'
);
delete from public.generations where id = '33333333-0000-4000-8000-000000000004';

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values (
  '33333333-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000003',
  'card', 'wildberries', 'clothing', 'clothing-model', 'Тестовая куртка', 50, 'done'
);
insert into public.generation_cards (generation_id, layout_id, layout, content, font_map) values (
  '33333333-0000-4000-8000-000000000003', 'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer'),
  '{"texts": {}, "props": [], "swatches": []}'::jsonb,
  '{"display": "Montserrat"}'::jsonb
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-0000-4000-8000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.generation_cards),
  0,
  'Пользователь не читает снимок чужой генерации'
);
select throws_ok(
  $$ insert into public.generation_cards (generation_id, layout, content, font_map)
     values ('33333333-0000-4000-8000-000000000003', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb) $$,
  '42501',
  null,
  'Пользователь не может записать снимок мимо service-role'
);

select * from finish();

rollback;
