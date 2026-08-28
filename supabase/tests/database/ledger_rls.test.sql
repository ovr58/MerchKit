-- NFR-04 / NFR-05 на журнале операций: чужие записи не читаются, а изменить баланс клиент
-- не может ни через таблицу, ни через функцию. Проверка идёт прямо в Postgres, потому что
-- защищает данные политика, а не интерфейс: `anon`-ключ Supabase публичен by design.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seller-a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'seller-b@example.com');

-- Журнал наполняет тот же путь, что и в облаке: подтверждение email начисляет 120.
update auth.users set email_confirmed_at = now()
 where id in ('aaaaaaaa-0000-4000-8000-000000000001',
              'bbbbbbbb-0000-4000-8000-000000000002');

select is(
  (select count(*)::int from public.ledger
    where user_id in ('aaaaaaaa-0000-4000-8000-000000000001',
                      'bbbbbbbb-0000-4000-8000-000000000002')),
  2,
  'У каждого подтвердившего email появилась строка журнала'
);

-- Дальше — от лица пользователя A: роль и claim'ы те же, что выдаёт Supabase Auth.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.ledger),
  1,
  'Пользователь видит только свои строки журнала'
);

select is(
  (select count(*)::int from public.ledger
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'Прямой запрос чужих строк по user_id возвращает пусто (NFR-04)'
);

select throws_ok(
  $$ insert into public.ledger (user_id, delta, kind, idempotency_key, balance_after)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 1000000, 'topup', 'forged', 1000000) $$,
  '42501',
  null,
  'Клиент не может дописать себе строку журнала'
);

select throws_ok(
  $$ update public.ledger set delta = 1000000
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'Клиент не может переписать собственную строку журнала'
);

select throws_ok(
  $$ delete from public.ledger
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'Клиент не может стереть строку журнала: это учётный регистр, а не история для показа'
);

-- Функции — второй путь к балансу, и он закрыт отдельно от таблицы (NFR-05).
select throws_ok(
  $$ select public.apply_credit_operation(
       'aaaaaaaa-0000-4000-8000-000000000001', 1000000, 'topup', 'forged-rpc') $$,
  '42501',
  null,
  'Клиент не может вызвать единственную точку изменения баланса'
);

select throws_ok(
  $$ select public.topup_balance(
       'aaaaaaaa-0000-4000-8000-000000000001', 'pro', 'forged-attempt') $$,
  '42501',
  null,
  'Клиент не может зачислить себе пакет в обход Edge Function'
);

select throws_ok(
  $$ select public.charge_for_generation(
       'aaaaaaaa-0000-4000-8000-000000000001',
       'cccccccc-0000-4000-8000-000000000009', 50) $$,
  '42501',
  null,
  'Клиент не может списать баллы напрямую'
);

select is(
  (select count(*)::int from public.credit_packages),
  3,
  'Справочник пакетов читается вошедшим: без него нечего показать в профиле'
);

reset role;
set local role anon;

select throws_ok(
  $$ select delta from public.ledger $$,
  '42501',
  null,
  'Неавторизованному журнал недоступен совсем'
);

select throws_ok(
  $$ select credits from public.credit_packages $$,
  '42501',
  null,
  'Неавторизованному недоступен и справочник пакетов'
);

select * from finish();

rollback;
