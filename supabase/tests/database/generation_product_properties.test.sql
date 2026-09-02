-- B1: свойства сохраняются с заявкой в выбранном продавцом порядке; это вход подбора и сборки,
-- поэтому нельзя оставить их только в черновике браузера.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000005', 'properties-owner@example.com');
update auth.users set email_confirmed_at = now()
 where id = 'eeeeeeee-0000-4000-8000-000000000005';

create temporary table run (id uuid);

insert into run
select public.create_generation(
  'eeeeeeee-0000-4000-8000-000000000005', 'card', 'ozon', 'clothing', 'clothing-model',
  'Куртка-бомбер', 'Хлопок, хаки', '', '{}'::text[], 55,
  '[{"label":"Материал","value":"Хлопок"},{"label":"Цвет","value":"Хаки"}]'::jsonb
);

select is(
  (select product_properties from public.generations where id = (select id from run)),
  '[{"label":"Материал","value":"Хлопок"},{"label":"Цвет","value":"Хаки"}]'::jsonb,
  'Порядок свойств в заявке совпадает с порядком, подтверждённым продавцом'
);

select throws_ok(
  $$ select public.create_generation(
       'eeeeeeee-0000-4000-8000-000000000005', 'card', 'ozon', 'clothing', 'clothing-model',
       'Куртка-бомбер', '', '', '{}'::text[], 55, '{}'::jsonb) $$,
  'Свойства товара должны быть списком',
  'Объект вместо списка свойств база не принимает'
);

select is(
  (select count(*)::int from public.generations where user_id = 'eeeeeeee-0000-4000-8000-000000000005'),
  1,
  'Отклонённая форма свойств не оставляет частичную заявку'
);

select is(
  public.consume_product_properties_quota('user:test-properties', 1),
  true,
  'Первый подбор свойств в лимите разрешён'
);
select is(
  public.consume_product_properties_quota('user:test-properties', 1),
  false,
  'Следующий подбор свойств за пределом лимита отклонён'
);

select * from finish();

rollback;
