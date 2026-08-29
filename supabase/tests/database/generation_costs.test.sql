-- Контракт учёта себестоимости (веха M5, шаг 4).
--
-- Заводится отдельным тестом, потому что живой прогон `supabase/tests/generation-flow.mjs`
-- этих строк не видит: его teardown удаляет тестовых пользователей, а `generation_costs`
-- уходит за генерацией каскадом — регресс здесь не поймала бы ни одна существующая
-- проверка. Найдено ревью Sonnet-хвоста вехи.
--
-- Проверяется ровно то, ради чего таблица заводилась: одна строка на вызов, `recognize`
-- в неё не попадает, и цифра маржи не видна пользователю — ни на чтение, ни на запись.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seller-a@example.com');
update auth.users set email_confirmed_at = now()
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

create temporary table run (id uuid);

insert into run
select public.create_generation(
  'aaaaaaaa-0000-4000-8000-000000000001', 'card', 'ozon', 'clothing', 'clothing-model',
  'Куртка-бомбер', '', '',
  array['aaaaaaaa-0000-4000-8000-000000000001/photo-1.jpg'], 55);

/* --------------------------------------------- одна строка на вызов вендора */

select public.record_generation_costs(
  (select id from run),
  '[{"operation":"moderate",       "vendor":"aitunnel", "costRub":0.0512, "durationMs":840},
    {"operation":"generateImages", "vendor":"aitunnel", "costRub":11.54,  "durationMs":18400}]'::jsonb
);

select is(
  (select count(*)::int from public.generation_costs where generation_id = (select id from run)),
  2,
  'Два вызова — две строки: разбивка не схлопывается в одну сумму на генерацию'
);

select is(
  (select cost_rub from public.generation_costs
    where generation_id = (select id from run) and operation = 'generateImages'),
  11.5400::numeric,
  'Себестоимость легла как есть, в рублях с копейками, а не в баллах'
);

select is(
  (select vendor from public.generation_costs
    where generation_id = (select id from run) and operation = 'moderate'),
  'aitunnel',
  'Вендор записан тот, что в самом деле обслужил вызов'
);

/* ------------------------------------ пустой список — штатный исход, не ошибка */

-- finish/fail могли обойтись без единого вызова провайдера. Строк при этом ноль, и
-- `generation_id` не проверяется вовсе — вставлять нечего.
select lives_ok(
  $$ select public.record_generation_costs(
       '00000000-0000-4000-8000-000000000000'::uuid, '[]'::jsonb) $$,
  'Пустой список не падает даже на несуществующей генерации'
);

select is(
  (select count(*)::int from public.generation_costs),
  2,
  'И ничего не пишет'
);

/* ------------------------------------------- область таблицы — только генерация */

select throws_ok(
  $$ select public.record_generation_costs((select id from run),
       '[{"operation":"recognize","vendor":"aitunnel","costRub":0.13,"durationMs":900}]'::jsonb) $$,
  '23514',
  null,
  'recognize в эту таблицу не пишется — это ограничение схемы, а не договорённость'
);

select throws_ok(
  $$ select public.record_generation_costs((select id from run),
       '[{"operation":"moderate","vendor":"aitunnel","costRub":-1,"durationMs":10}]'::jsonb) $$,
  '23514',
  null,
  'Отрицательная себестоимость — не «возврат от вендора», а испорченный ответ шлюза'
);

/* ------------------------------------------------- смысла без генерации не имеет */

delete from public.generations where id = (select id from run);

select is(
  (select count(*)::int from public.generation_costs),
  0,
  'Удаление генерации уносит её себестоимость (on delete cascade)'
);

/* ------------------------- цифра маржи не для пользователя (docs/SPEC.md §8–§9) */

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

-- Политик на таблице нет ни одной, поэтому отказ приходит уровнем прав, а не пустой
-- выборкой: «нет строк» и «не твоё дело» — разные ответы, и здесь нужен второй.
select throws_ok(
  $$ select count(*) from public.generation_costs $$,
  '42501',
  null,
  'Себестоимость не читается пользователем вовсе, а не «читается, но пустой»'
);

select throws_ok(
  $$ select public.record_generation_costs(
       '00000000-0000-4000-8000-000000000000'::uuid, '[]'::jsonb) $$,
  '42501',
  null,
  'И записать её мимо service_role тоже нельзя'
);

reset role;

select * from finish();

rollback;
