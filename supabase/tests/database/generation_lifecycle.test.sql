-- Жизненный цикл генерации по docs/VISUALS.md V-07 и его связь с балансом: заявка →
-- работа → один из двух исходов. Промежуточного `partial` нет (решение 2026-08-29), и
-- при любом неуспехе возврат ПОЛНЫЙ (FR-13, US-E4).
--
-- Проверяется контракт БД, а не воркер: именно здесь живёт правило «статус и баллы
-- двигаются одной транзакцией», и именно его нельзя проверить через интерфейс.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seller-a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'seller-b@example.com');
update auth.users set email_confirmed_at = now()
 where id in ('aaaaaaaa-0000-4000-8000-000000000001',
              'bbbbbbbb-0000-4000-8000-000000000002');

/* ------------------------------------------------- заявка принята: списание в той же транзакции */

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  120,
  'Стартовый баланс — 120 стартовых баллов'
);

create temporary table run (id uuid);

insert into run
select public.create_generation(
  'aaaaaaaa-0000-4000-8000-000000000001', 'card', 'ozon', 'clothing', 'clothing-model',
  'Куртка-бомбер', 'Плащёвка на синтепоне, хаки, S–XXL', '',
  array['aaaaaaaa-0000-4000-8000-000000000001/photo-1.jpg'], 55);

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  65,
  'Заявка принята — списано 55 баллов (V-07, статус queued)'
);

select is(
  (select status from public.generations where id = (select id from run)),
  'queued',
  'Новая генерация стоит в очереди'
);

select is(
  (select generation_id from public.ledger
    where idempotency_key = 'generation:' || (select id from run) || ':charge'),
  (select id from run),
  'Строка журнала связана с генерацией внешним ключом (долг M3 закрыт)'
);

/* ---------------------------------------------------------------- сценарий не из своей категории */

select throws_ok(
  $$ select public.create_generation(
       'aaaaaaaa-0000-4000-8000-000000000001', 'photo', 'ozon', 'clothing', 'tech-studio',
       'Куртка', '', '', '{}'::text[], 50) $$,
  'Сценарий tech-studio не принадлежит категории clothing',
  'Сценарий чужой категории не принимается (FR-08)'
);

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  65,
  'Отклонённая заявка не списала баллов: откатилась вся транзакция'
);

/* --------------------------------------------------------------------- не хватает баллов (US-E3) */

select throws_ok(
  $$ select public.create_generation(
       'bbbbbbbb-0000-4000-8000-000000000002', 'card', 'ozon', 'food', null,
       'Кофе в зёрнах', '', '', '{}'::text[], 500) $$,
  '23514',
  null,
  'Заявка дороже баланса отклоняется, а не уводит в минус (US-E3)'
);

select is(
  (select count(*)::int from public.generations
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000002'),
  0,
  'После отказа по балансу заявки не остаётся: не запускать и не списывать (US-E3)'
);

/* ------------------------------------------------------------------------------- работа и успех */

select public.start_generation((select id from run));

select is(
  (select status from public.generations where id = (select id from run)),
  'running',
  'Воркер взял задачу: queued → running'
);

-- Половина карточки не отдаётся: тексты обязательны для kind = card (FR-07, US-E4).
select throws_ok(
  format(
    $$ select public.finish_generation(%L, 'Куртка-бомбер хаки', null, null,
         '[{"storage_path":"a/result.jpg","width":1200,"height":1600,"format":"jpeg"}]'::jsonb) $$,
    (select id from run)),
  null,
  'Карточка без заголовка и описания не может завершиться успехом (US-E4)'
);

select public.finish_generation(
  (select id from run), 'Куртка-бомбер хаки, мужская',
  'Куртка-бомбер хаки, мужская — плащёвка на синтепоне',
  'Тёплый бомбер из плотной плащёвки на синтепоне. Размерный ряд S–XXL.',
  format('[{"storage_path":%s,"width":1200,"height":1600,"format":"jpeg"}]',
         to_json('aaaaaaaa-0000-4000-8000-000000000001/result.jpg'::text))::jsonb);

select is(
  (select status from public.generations where id = (select id from run)),
  'done',
  'Получено всё — генерация завершена (V-07)'
);

select is(
  (select balance from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  65,
  'Успешная генерация баланс не трогает: списание уже прошло при приёме заявки'
);

-- Повторная доставка события завершения (NFR-03): ни второго результата, ни новых движений.
select public.finish_generation(
  (select id from run), 'Другое название', 'Другой заголовок', 'Другое описание',
  format('[{"storage_path":%s,"width":1200,"height":1600,"format":"jpeg"}]',
         to_json('aaaaaaaa-0000-4000-8000-000000000001/result.jpg'::text))::jsonb);

select is(
  (select title from public.generations where id = (select id from run)),
  'Куртка-бомбер хаки, мужская',
  'Повторная доставка события завершения не переписывает готовую генерацию (NFR-03)'
);

select is(
  (select count(*)::int from public.generation_assets
    where generation_id = (select id from run)),
  1,
  'Повторная доставка не задваивает результат (NFR-03)'
);

-- Готовую генерацию нельзя объявить неуспешной и вернуть за неё баллы.
select is(
  public.fail_generation('aaaaaaaa-0000-4000-8000-000000000001', (select id from run),
                         'передумал'),
  65,
  'Завершённую генерацию не завалить задним числом: возврата нет'
);

/* --------------------------------------------------------------- неуспех: полный возврат (US-E4) */

create temporary table broken (id uuid);

insert into broken
select public.create_generation(
  'aaaaaaaa-0000-4000-8000-000000000001', 'card', 'wildberries', 'tech', 'tech-studio',
  'Наушники накладные', '', 'тёплый свет', '{}'::text[], 55);

select public.start_generation((select id from broken));

-- «Изображение получено, текстов карточки нет» — это тот же неуспех, что и молчание
-- провайдера: пользователь не получает ничего, баланс восстанавливается ровно.
select is(
  public.fail_generation('aaaaaaaa-0000-4000-8000-000000000001', (select id from broken),
                         'Карточка не собралась целиком'),
  65,
  'Неуспех вернул все списанные баллы: баланс равен балансу до запуска (FR-13, US-E4)'
);

select is(
  public.fail_generation('aaaaaaaa-0000-4000-8000-000000000001', (select id from broken),
                         'то же событие ещё раз'),
  65,
  'Повторная доставка события неуспеха не возвращает баллы дважды (NFR-03)'
);

select is(
  (select count(*)::int from public.generations
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'done'),
  1,
  'Неуспешная генерация не попадает в каталог как готовая (US-E4)'
);

select * from finish();

rollback;
