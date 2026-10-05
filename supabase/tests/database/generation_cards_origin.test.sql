-- Происхождение снимка карточки (шаг C3 плана html-layout-authoring, ADR-0019 п. 6, «Снимок»; B40, B41).
--
-- По умолчанию снимок — макет библиотеки. Макет, по которому собрано, и его происхождение
-- (`library` | `author`) пишутся вместе с содержимым одной записью `record_card_assembly` — только
-- service-role. Повтор доставки перезаписывает снимок целиком: первая запись не побеждает.
-- Отдельного писателя происхождения (`record_card_authored`) больше нет.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select hasnt_function(
  'public', 'record_card_authored', array['uuid', 'jsonb'],
  'У снимка один писатель происхождения — record_card_authored снята'
);

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
  $$ select public.record_card_assembly(
       target_generation => '63636363-0000-4000-8000-000000000001',
       assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author", "title": "Сочинение карточки (HTML)", "canvas": {"aspectW": 3, "aspectH": 4}, "layers": []}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  'service-role записывает собранное сочинение'
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

-- Вторая генерация собрана по библиотеке; повтор доставки принял сочинение — первая запись не
-- побеждает, снимок переписывается целиком.
set local role service_role;

select public.record_card_assembly(
  target_generation => '63636363-0000-4000-8000-000000000002',
  assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {}, "props": [], "swatches": []}'::jsonb,
  assembled_font_map => '{}'::jsonb,
  assembled_layout => (select layout from public.card_layouts where id = 'dress-summer'),
  assembled_origin => 'library'
);

select lives_ok(
  $$ select public.record_card_assembly(
       target_generation => '63636363-0000-4000-8000-000000000002',
       assembled_content => '{"frames": ["u/g/frame-2.png"], "texts": {}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author", "layers": []}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  'Повтор с сочинением поверх собранного снимка проходит'
);

reset role;

select is(
  (select origin || ' · ' || (layout ->> 'id') || ' · ' || (content -> 'frames' ->> 0)
     from public.generation_cards
    where generation_id = '63636363-0000-4000-8000-000000000002'),
  'author · html-author · u/g/frame-2.png',
  'Повтор переписал макет, происхождение и содержимое вместе'
);

set local role service_role;

select throws_ok(
  $$ select public.record_card_assembly(
       target_generation => '63636363-0000-4000-8000-000000000099',
       assembled_content => '{}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author"}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  'P0001',
  'Снимок макета не найден: 63636363-0000-4000-8000-000000000099',
  'Без снимка сочинение не записывается молча'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000063","role":"authenticated"}';

select throws_ok(
  $$ select public.record_card_assembly(
       target_generation => '63636363-0000-4000-8000-000000000001',
       assembled_content => '{}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author"}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  '42501',
  null,
  'Владелец генерации не может записать сочинение мимо service-role'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.record_card_assembly(
       target_generation => '63636363-0000-4000-8000-000000000001',
       assembled_content => '{}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author"}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  '42501',
  null,
  'Аноним не может записать сочинение'
);

select * from finish();

rollback;
