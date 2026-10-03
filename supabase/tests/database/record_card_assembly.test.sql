-- Запись содержимого сборки в снимок карточки (веха M7, шаг B7.4).
--
-- Пишет только service-role, пишет оба поля и не трогает снимок макета: пересборка обязана
-- собирать по тому макету, который продавец оплатил.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000074', 'assembly-owner@example.com');

insert into public.generations (
  id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status
) values (
  '74747474-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-000000000074',
  'card', 'wildberries', 'clothing', 'clothing-model', 'Тестовые джинсы', 55, 'running'
);

select public.snapshot_generation_layout(
  '74747474-0000-4000-8000-000000000001',
  'dress-summer',
  (select layout from public.card_layouts where id = 'dress-summer')
);

create temporary table before_call as
select layout, layout_id, assembled_at from public.generation_cards
 where generation_id = '74747474-0000-4000-8000-000000000001';
grant select on before_call to service_role, authenticated;

-- now() в транзакции неизменен: отодвигаем отметку, чтобы увидеть, что вызов её обновил.
update public.generation_cards set assembled_at = now() - interval '1 hour'
 where generation_id = '74747474-0000-4000-8000-000000000001';

set local role service_role;

select lives_ok(
  $$ select public.record_card_assembly(
       '74747474-0000-4000-8000-000000000001',
       '{"texts": {"title": ["Джинсы"]}, "props": [], "swatches": [],
         "frames": [{"bucket": "results", "path": "u/g/frame-1.jpeg", "width": 896, "height": 1200}]}'::jsonb,
       '{"display": "Montserrat", "body": "Inter"}'::jsonb
     ) $$,
  'service-role записывает содержимое сборки'
);

reset role;

select is(
  (select content -> 'texts' -> 'title' ->> 0 from public.generation_cards
    where generation_id = '74747474-0000-4000-8000-000000000001'),
  'Джинсы',
  'Содержимое сборки записано'
);
select is(
  (select font_map from public.generation_cards
    where generation_id = '74747474-0000-4000-8000-000000000001'),
  '{"display": "Montserrat", "body": "Inter"}'::jsonb,
  'Карта шрифтов записана'
);
select ok(
  (select layout = (select layout from before_call) and layout_id = (select layout_id from before_call)
          and assembled_at = now()
     from public.generation_cards where generation_id = '74747474-0000-4000-8000-000000000001'),
  'Снимок макета не изменился, отметка сборки обновлена'
);

select throws_ok(
  $$ select public.record_card_assembly('74747474-0000-4000-8000-000000000099', '{}'::jsonb, '{}'::jsonb) $$,
  'P0001',
  'Снимок макета не найден: 74747474-0000-4000-8000-000000000099',
  'Без снимка содержимое не записывается молча'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000074","role":"authenticated"}';

select throws_ok(
  $$ select public.record_card_assembly('74747474-0000-4000-8000-000000000001', '{}'::jsonb, '{}'::jsonb) $$,
  '42501',
  null,
  'Владелец генерации не может записать содержимое мимо service-role'
);

select * from finish();

rollback;
