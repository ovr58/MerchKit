-- Происхождение снимка карточки (шаг C3 плана html-layout-authoring, ADR-0019 п. 6, «Снимок»).
--
-- По умолчанию снимок — макет библиотеки. Принятое сочинение пишет в снимок транспилированный
-- макет и пометку `author` — только service-role и только до сборки: после неё снимок не
-- перезаписывается, пересборка читает его.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000063', 'origin-owner@example.com');

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values
  ('63636363-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000063',
   'card', 'ozon', 'home', null, 'Кресло с ушами', 55, 'running'),
  ('63636363-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000063',
   'card', 'ozon', 'home', null, 'Кресло с ушами', 55, 'running');

select public.snapshot_generation_layout(
  '63636363-0000-4000-8000-000000000001',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);
select public.snapshot_generation_layout(
  '63636363-0000-4000-8000-000000000002',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);

select is(
  (select origin from public.generation_cards
    where generation_id = '63636363-0000-4000-8000-000000000001'),
  'library',
  'Снимок по умолчанию — библиотека'
);

select throws_ok(
  $$ update public.generation_cards set origin = 'чужое'
      where generation_id = '63636363-0000-4000-8000-000000000001' $$,
  '23514',
  null,
  'Происхождение — только library или author'
);

set local role service_role;

select lives_ok(
  $$ select public.record_card_authored(
       '63636363-0000-4000-8000-000000000001',
       '{"id": "html-author", "title": "Сочинение карточки (HTML)", "canvas": {"aspectW": 3, "aspectH": 4}, "layers": []}'::jsonb
     ) $$,
  'service-role записывает принятое сочинение'
);

reset role;

select is(
  (select origin from public.generation_cards
    where generation_id = '63636363-0000-4000-8000-000000000001'),
  'author',
  'Происхождение — сочинение'
);
select is(
  (select layout ->> 'id' from public.generation_cards
    where generation_id = '63636363-0000-4000-8000-000000000001'),
  'html-author',
  'Снимок — транспилированный макет'
);
select is(
  (select layout_id from public.generation_cards
    where generation_id = '63636363-0000-4000-8000-000000000001'),
  'dress-summer',
  'layout_id по-прежнему называет макет подбора'
);

-- Вторая генерация уже собрана: снимок после сборки не перезаписывается.
select public.record_card_assembly(
  '63636363-0000-4000-8000-000000000002',
  '{"frames": ["u/g/frame-1.png"], "texts": {}, "props": [], "swatches": []}'::jsonb,
  '{}'::jsonb
);

set local role service_role;

select throws_ok(
  $$ select public.record_card_authored('63636363-0000-4000-8000-000000000002', '{"id": "html-author"}'::jsonb) $$,
  'P0001',
  'Снимок макета не найден или уже собран: 63636363-0000-4000-8000-000000000002',
  'После сборки снимок не перезаписывается'
);

select throws_ok(
  $$ select public.record_card_authored('63636363-0000-4000-8000-000000000099', '{"id": "html-author"}'::jsonb) $$,
  'P0001',
  'Снимок макета не найден или уже собран: 63636363-0000-4000-8000-000000000099',
  'Без снимка сочинение не записывается молча'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000063","role":"authenticated"}';

select throws_ok(
  $$ select public.record_card_authored('63636363-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501',
  null,
  'Владелец генерации не может записать сочинение мимо service-role'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.record_card_authored('63636363-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501',
  null,
  'Аноним не может записать сочинение'
);

select * from finish();

rollback;
