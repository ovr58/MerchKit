-- Операция `directCard` в учёте себестоимости (ADR-0018, шаг B5.6 плана вехи M7).
--
-- Расширяет проверку `generation_costs.operation`: арт-директор пишет свои вызовы тем же
-- путём `record_generation_costs`. Ограничение на посторонние имена остаётся: его покрывает отказ для `foo`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

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

select lives_ok(
  $$ select public.record_generation_costs((select id from run),
       '[{"operation":"directCard","vendor":"aitunnel","costRub":0.02,"durationMs":3100}]'::jsonb) $$,
  'directCard вставляется: вызов арт-директора пишется строкой затрат, как любой платный вызов'
);

select is(
  (select count(*)::int from public.generation_costs
    where generation_id = (select id from run) and operation = 'directCard'),
  1,
  'Строка легла под именем directCard'
);

select throws_ok(
  $$ select public.record_generation_costs((select id from run),
       '[{"operation":"foo","vendor":"aitunnel","costRub":0.02,"durationMs":3100}]'::jsonb) $$,
  '23514',
  null,
  'Постороннее имя операции отвергается: проверка расширена, а не снята'
);

select * from finish();

rollback;
