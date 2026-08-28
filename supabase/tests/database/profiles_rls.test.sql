-- NFR-04: изоляция проверяется на уровне БД, а не интерфейса. Маршруты и гварды в UI
-- ничего не защищают: `anon`-ключ Supabase публичен by design, и обратиться к API может кто
-- угодно. Поэтому тест ходит прямо в Postgres, подменяя сессию, а не кликает по экранам.

begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

-- Фикстура: два пользователя. Профили им должен завести триггер, а не этот тест.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seller-a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'seller-b@example.com');

-- Считаем только своих подопытных, а не все строки таблицы: прогон не должен зависеть от
-- того, что осталось в базе от ручных проверок. Тест, который проходит лишь на свежем
-- `db reset`, однажды соврёт — и не о том, что сломалось.
select is(
  (select count(*)::int from public.profiles
   where id in ('aaaaaaaa-0000-4000-8000-000000000001',
                'bbbbbbbb-0000-4000-8000-000000000002')),
  2,
  'Триггер завёл профиль каждому новому пользователю Auth'
);

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0,
  'Новый профиль стартует с нулём: стартовые баллы начисляет M3 через журнал'
);

-- Дальше — от лица пользователя A: роль и claim'ы те же, что выдаёт Supabase Auth.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles),
  1,
  'Пользователь видит ровно одну строку — свою'
);

select is(
  (select count(*)::int from public.profiles
   where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'Прямой запрос чужого профиля по id возвращает пусто, а не чужую строку (NFR-04)'
);

select throws_ok(
  $$ update public.profiles set balance = 100000
     where id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'Клиент не может изменить даже собственный баланс: запись только у service-role (NFR-05)'
);

select throws_ok(
  $$ insert into public.profiles (id, balance)
     values ('cccccccc-0000-4000-8000-000000000003', 100000) $$,
  '42501',
  null,
  'Клиент не может завести себе профиль с произвольным балансом'
);

reset role;
set local role anon;

select throws_ok(
  $$ select balance from public.profiles $$,
  '42501',
  null,
  'Неавторизованному профили недоступны совсем'
);

select * from finish();

rollback;
