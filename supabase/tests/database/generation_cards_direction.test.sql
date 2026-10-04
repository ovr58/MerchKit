-- Запись правки арт-директора в снимок карточки (веха M7, шаг B5.8, ADR-0018).
--
-- Пишет только service-role и только `direction`: снимок макета, его содержимое и карта
-- шрифтов остаются теми, что записала сборка, — пересборка обязана собирать по оплаченному.

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000058', 'direction-owner@example.com');

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values (
  '58585858-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000058',
  'card', 'wildberries', 'clothing', 'clothing-model', 'Тестовая куртка', 55, 'running'
);

select public.snapshot_generation_layout(
  '58585858-0000-4000-8000-000000000001',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);

select public.record_card_assembly(
  '58585858-0000-4000-8000-000000000001',
  '{"texts": {"title": ["Куртка"]}, "props": [], "swatches": []}'::jsonb,
  '{"display": "Montserrat"}'::jsonb
);

select is(
  (select direction from public.generation_cards
    where generation_id = '58585858-0000-4000-8000-000000000001'),
  null,
  'До записи правки direction пуст: ступень 4'
);

create temporary table before_call as
select layout, layout_id, content, font_map, assembled_at from public.generation_cards
 where generation_id = '58585858-0000-4000-8000-000000000001';
grant select on before_call to service_role, authenticated;

set local role service_role;

select lives_ok(
  $$ select public.record_card_direction(
       '58585858-0000-4000-8000-000000000001',
       '{"boxes": [{"layerId": "title", "box": {"x": 0.05, "y": 0.05, "w": 0.5, "h": 0.1}}],
         "texts": {"subtitle": ["Мембрана"]}, "icons": [{"prop": 0, "icon": null}]}'::jsonb
     ) $$,
  'service-role записывает правку арт-директора'
);

reset role;

select is(
  (select direction -> 'boxes' -> 0 ->> 'layerId' from public.generation_cards
    where generation_id = '58585858-0000-4000-8000-000000000001'),
  'title',
  'Боксы правки записаны'
);
select is(
  (select direction -> 'texts' -> 'subtitle' ->> 0 from public.generation_cards
    where generation_id = '58585858-0000-4000-8000-000000000001'),
  'Мембрана',
  'Строки гнёзд записаны'
);
select ok(
  (select layout = (select layout from before_call) and layout_id = (select layout_id from before_call)
     from public.generation_cards where generation_id = '58585858-0000-4000-8000-000000000001'),
  'Снимок макета не изменился'
);
select ok(
  (select content = (select content from before_call) and font_map = (select font_map from before_call)
          and assembled_at = (select assembled_at from before_call)
     from public.generation_cards where generation_id = '58585858-0000-4000-8000-000000000001'),
  'Содержимое сборки, карта шрифтов и отметка сборки не изменились'
);

select throws_ok(
  $$ select public.record_card_direction('58585858-0000-4000-8000-000000000099', '{}'::jsonb) $$,
  'P0001',
  'Снимок макета не найден: 58585858-0000-4000-8000-000000000099',
  'Без снимка правка не записывается молча'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000058","role":"authenticated"}';

select throws_ok(
  $$ select public.record_card_direction('58585858-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501',
  null,
  'Владелец генерации не может записать правку мимо service-role'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.record_card_direction('58585858-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501',
  null,
  'Аноним не может записать правку'
);

select * from finish();

rollback;
