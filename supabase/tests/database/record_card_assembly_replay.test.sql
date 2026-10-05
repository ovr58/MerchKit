-- Повтор доставки события после записанной сборки (B40, NFR-03, ADR-0019 п. 6).
--
-- Воркер переигрывает генерацию в статусе `running` целиком. Снимок, содержимое и происхождение
-- пишутся одной записью `record_card_assembly`, поэтому повтор перезаписывает их вместе: сочинение
-- поверх собранного снимка проходит, откат на библиотеку возвращает и макет, и `origin`. Без макета
-- (пересборка, B5.9) снимок и происхождение не трогаются.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000064', 'replay-owner@example.com');

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values
  ('64646464-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000064',
   'card', 'ozon', 'home', null, 'Кресло с ушами', 55, 'running');

select public.snapshot_generation_layout(
  '64646464-0000-4000-8000-000000000001',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);

set local role service_role;

-- Первый прогон: сочинение принято и собрано.
select lives_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {"first": 1}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author", "layers": []}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  'Сборка сочинения пишет макет, происхождение и содержимое одной записью'
);

reset role;

select is(
  (select origin || ' · ' || (layout ->> 'id') || ' · ' || layout_id from public.generation_cards
    where generation_id = '64646464-0000-4000-8000-000000000001'),
  'author · html-author · dress-summer',
  'Снимок — сочинение, layout_id по-прежнему называет макет подбора'
);

set local role service_role;

-- Повтор: снимок уже собран, сочинение снова принято — не отказ.
select lives_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {"second": 2}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author", "layers": []}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  'Повтор с сочинением поверх собранного снимка проходит'
);

reset role;

select is(
  (select content -> 'texts' from public.generation_cards
    where generation_id = '64646464-0000-4000-8000-000000000001'),
  '{"second": 2}'::jsonb,
  'Повтор перезаписал содержимое'
);

set local role service_role;

-- Повтор откатился на библиотеку: макет и происхождение возвращаются вместе с содержимым.
select lives_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {"library": 3}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => (select layout from public.card_layouts where id = 'dress-summer'),
       assembled_origin => 'library'
     ) $$,
  'Повтор с откатом на библиотеку проходит'
);

reset role;

select is(
  (select origin from public.generation_cards
    where generation_id = '64646464-0000-4000-8000-000000000001'),
  'library',
  'После отката происхождение — библиотека'
);
select is(
  (select layout ->> 'id' from public.generation_cards
    where generation_id = '64646464-0000-4000-8000-000000000001'),
  'dress-summer',
  'После отката снимок — макет библиотеки, не сочинение'
);

-- Пересборка (B5.9) пишет содержимое без макета: снимок и происхождение остаются.
update public.generation_cards
   set layout = '{"id": "html-author", "layers": []}'::jsonb, origin = 'author'
 where generation_id = '64646464-0000-4000-8000-000000000001';

set local role service_role;

select lives_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{"frames": ["u/g/frame-1.png"], "texts": {"rebuild": 4}, "props": [], "swatches": []}'::jsonb,
       assembled_font_map => '{}'::jsonb
     ) $$,
  'Вызов без макета — как у пересборки — проходит'
);

reset role;

select is(
  (select origin || ' · ' || (layout ->> 'id') from public.generation_cards
    where generation_id = '64646464-0000-4000-8000-000000000001'),
  'author · html-author',
  'Без макета снимок и происхождение не тронуты'
);

set local role service_role;

select throws_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author"}'::jsonb
     ) $$,
  'P0001',
  'Макет и происхождение снимка пишутся вместе: 64646464-0000-4000-8000-000000000001',
  'Макет без происхождения не пишется'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000064","role":"authenticated"}';

select throws_ok(
  $$ select public.record_card_assembly(
       target_generation => '64646464-0000-4000-8000-000000000001',
       assembled_content => '{}'::jsonb,
       assembled_font_map => '{}'::jsonb,
       assembled_layout => '{"id": "html-author"}'::jsonb,
       assembled_origin => 'author'
     ) $$,
  '42501',
  null,
  'Владелец генерации не пишет снимок мимо service-role'
);

reset role;

select * from finish();

rollback;
