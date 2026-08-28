-- Контракт движения баллов: NFR-03 (идемпотентность), FR-19 (стартовые баллы), FR-23
-- (пакеты) и списание/возврат по docs/VISUALS.md V-07.
--
-- Списание писалось на M3 под **фиктивного потребителя**: генерации как сущности тогда не
-- было. Веха M4 её завела и повесила внешний ключ `ledger` → `generations`, поэтому
-- подопытные генерации здесь настоящие строки. Контракт списания и возврата от этого не
-- изменился — тем и ценно, что он проектировался до потребителя.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Se.ller+promo@Gmail.com');

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0,
  'До подтверждения email баланс нулевой (FR-19)'
);

update auth.users set email_confirmed_at = now()
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  120,
  'Подтверждение email начислило 120 стартовых баллов (FR-19)'
);

-- Повторный переход по ссылке подтверждения: GoTrue снова проставляет дату.
update auth.users set email_confirmed_at = now()
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  120,
  'Повторное подтверждение не начисляет 120 второй раз (NFR-03)'
);

-- Та самая дыра, найденная на живом стейдже 2026-08-28: плюс-адресация и точки дают одному
-- ящику неограниченное число «разных» адресов.
insert into auth.users (id, email) values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'seller@googlemail.com');
update auth.users set email_confirmed_at = now()
 where id = 'bbbbbbbb-0000-4000-8000-000000000002';

select is(
  (select balance from public.profiles where id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'Тот же ящик через плюс-адресацию и точки второй раз 120 баллов не получает'
);

-- А другой ящик — получает: нормализация не должна склеивать разных людей.
insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000004', 'se.ller+promo@yandex.ru');
update auth.users set email_confirmed_at = now()
 where id = 'dddddddd-0000-4000-8000-000000000004';

select is(
  (select balance from public.profiles where id = 'dddddddd-0000-4000-8000-000000000004'),
  120,
  'У не-Gmail точки и «+» значимы: это другой ящик, и он получает свои 120'
);

select is(
  app.normalize_email('SELLER@Example.COM'),
  'seller@example.com',
  'Нормализация приводит адрес к нижнему регистру'
);

select is(
  app.normalize_email('s.e.l.l.e.r+one@googlemail.com'),
  'seller@gmail.com',
  'Gmail и Googlemail сводятся к одному адресу без точек и хвоста от «+»'
);

-- Пополнение (FR-23, US-05).
select is(
  public.topup_balance('aaaaaaaa-0000-4000-8000-000000000001', 'standard', 'attempt-1'),
  1120,
  'Пакет «Стандарт» зачислил 1000 баллов из справочника'
);

select is(
  public.topup_balance('aaaaaaaa-0000-4000-8000-000000000001', 'standard', 'attempt-1'),
  1120,
  'Двойной клик по кнопке пакета не даёт двойного зачисления (NFR-03)'
);

-- Второй клик по той же кнопке приходит со СВОИМ ключом попытки: клиент ротирует ключ
-- после успеха. Для сервера он неотличим от новой покупки — если не смотреть на окно.
select is(
  public.topup_balance('aaaaaaaa-0000-4000-8000-000000000001', 'standard', 'attempt-2'),
  1120,
  'Второй клик по пакету с другим ключом попытки не зачисляет пакет второй раз'
);

select is(
  (select count(*)::int from public.ledger
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and kind = 'topup'),
  1,
  'В журнале от очереди кликов осталась одна строка пополнения, а не две'
);

select throws_ok(
  $$ select public.topup_balance(
       'aaaaaaaa-0000-4000-8000-000000000001', 'unlimited', 'attempt-3') $$,
  'Неизвестный пакет пополнения: unlimited',
  'Номинал берётся из справочника: пакета, которого там нет, не существует'
);

-- Списание и возврат по V-07. Заявки заводятся напрямую, а не через `create_generation`:
-- проверяется контракт журнала, а не приёмка заявки — её проверяет generation_lifecycle.
insert into public.generations (id, user_id, kind, marketplace_id, category_id, product_title, price) values
  ('cccccccc-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000001',
   'card', 'ozon', 'clothing', 'Куртка-бомбер', 55),
  ('cccccccc-0000-4000-8000-000000000008', 'bbbbbbbb-0000-4000-8000-000000000002',
   'photo', 'wildberries', 'tech', 'Наушники', 50);

select is(
  public.charge_for_generation(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000009', 55),
  1065,
  'Заявка принята — баллы списаны (V-07, статус queued)'
);

select is(
  public.charge_for_generation(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000009', 55),
  1065,
  'Повторная доставка того же события не списывает дважды (NFR-03)'
);

-- Внешний ключ M4: строка журнала знает свою генерацию не только по context.
select is(
  (select generation_id from public.ledger
    where idempotency_key = 'generation:cccccccc-0000-4000-8000-000000000009:charge'),
  'cccccccc-0000-4000-8000-000000000009'::uuid,
  'Списание связано с генерацией внешним ключом, а не только полем context'
);

select is(
  public.refund_for_generation(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'cccccccc-0000-4000-8000-000000000009', 55),
  1120,
  'Провайдер недоступен — возврат восстановил баланс ровно до исходного (V-07, failed)'
);

select throws_ok(
  $$ select public.refund_for_generation(
       'aaaaaaaa-0000-4000-8000-000000000001',
       'cccccccc-0000-4000-8000-000000000009', 500) $$,
  null,
  'Вернуть больше, чем списано, нельзя: это печатание баллов из воздуха'
);

select throws_ok(
  $$ select public.charge_for_generation(
       'bbbbbbbb-0000-4000-8000-000000000002',
       'cccccccc-0000-4000-8000-000000000008', 50) $$,
  '23514',
  null,
  'Списание сверх баланса отклоняется, а не уводит в минус (US-E3)'
);

-- Удаление аккаунта: строка журнала переживает его обезличенной (ADR-0009).
delete from auth.users where id = 'dddddddd-0000-4000-8000-000000000004';

-- Проверяем свою строку по ключу, а не общее число обезличенных: в базе остаются следы
-- ручных прогонов и `npm run test:billing`, и счёт по всей таблице однажды соврёт.
select ok(
  exists (
    select 1 from public.ledger
     where idempotency_key = app.signup_bonus_key('se.ller+promo@yandex.ru')
       and user_id is null
  ),
  'Удаление аккаунта обезличило строку журнала, а не стёрло её (ADR-0009)'
);

select * from finish();

rollback;
