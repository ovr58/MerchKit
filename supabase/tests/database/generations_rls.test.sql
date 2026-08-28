-- NFR-04 на генерациях и файлах: чужая генерация не читается, чужой файл не отдаётся, а
-- статус генерации клиент не двигает вовсе. Проверка идёт прямо в Postgres, потому что
-- защищает данные политика, а не интерфейс: `anon`-ключ Supabase публичен by design и
-- обратиться к API можно мимо любого экрана.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seller-a@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'seller-b@example.com');

update auth.users set email_confirmed_at = now()
 where id in ('aaaaaaaa-0000-4000-8000-000000000001',
              'bbbbbbbb-0000-4000-8000-000000000002');

-- По генерации у каждого. У A — готовая с результатом, у B — своя, чтобы было что прятать.
insert into public.generations (id, user_id, kind, marketplace_id, category_id, preset_id, product_title, price, status, title)
values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'card', 'ozon', 'clothing', 'clothing-model', 'Куртка-бомбер', 55, 'done', 'Куртка-бомбер хаки'),
  ('22222222-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   'photo', 'wildberries', 'tech', 'tech-studio', 'Наушники', 50, 'done', 'Наушники накладные');

insert into public.generation_assets (generation_id, storage_path, width, height, format) values
  ('11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001/11111111-0000-4000-8000-000000000001/result.jpg',
   1200, 1600, 'jpeg'),
  ('22222222-0000-4000-8000-000000000002',
   'bbbbbbbb-0000-4000-8000-000000000002/22222222-0000-4000-8000-000000000002/result.jpg',
   1200, 1600, 'jpeg');

-- Файлы кладём в бакеты теми же путями: изоляция Storage стоит на первом сегменте пути.
insert into storage.objects (bucket_id, name, owner) values
  ('results', 'aaaaaaaa-0000-4000-8000-000000000001/11111111-0000-4000-8000-000000000001/result.jpg',
   'aaaaaaaa-0000-4000-8000-000000000001'),
  ('results', 'bbbbbbbb-0000-4000-8000-000000000002/22222222-0000-4000-8000-000000000002/result.jpg',
   'bbbbbbbb-0000-4000-8000-000000000002'),
  ('uploads', 'bbbbbbbb-0000-4000-8000-000000000002/22222222-0000-4000-8000-000000000002/photo-1.jpg',
   'bbbbbbbb-0000-4000-8000-000000000002');

-- Дальше — от лица пользователя A: роль и claim'ы те же, что выдаёт Supabase Auth.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.generations),
  1,
  'Пользователь видит только свои генерации (FR-01, NFR-04)'
);

select is(
  (select count(*)::int from public.generations
    where id = '22222222-0000-4000-8000-000000000002'),
  0,
  'Прямой запрос чужой генерации по её идентификатору возвращает пусто (NFR-04)'
);

select is(
  (select count(*)::int from public.generation_assets),
  1,
  'Результаты чужой генерации не читаются (NFR-04)'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'results'),
  1,
  'Чужой файл результата не виден по прямому пути (NFR-04)'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'uploads'),
  0,
  'Чужое входное фото не видно даже владельцу соседней генерации (NFR-04)'
);

-- Статус — не пользовательское поле. Ни своей генерации, ни чужой клиент не двигает:
-- политик на запись нет вовсе, поэтому отказ приходит на уровне прав таблицы.
select throws_ok(
  $$ update public.generations set status = 'done'
      where id = '11111111-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'Клиент не может двигать статус даже своей генерации (NFR-05)'
);

select throws_ok(
  $$ insert into public.generations (user_id, kind, marketplace_id, category_id, product_title, price)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'card', 'ozon', 'clothing', 'Даром', 55) $$,
  '42501',
  null,
  'Клиент не может завести себе генерацию мимо списания'
);

select throws_ok(
  $$ insert into public.generation_assets (generation_id, storage_path, width, height, format)
     values ('11111111-0000-4000-8000-000000000001', 'подделка.jpg', 1200, 1600, 'jpeg') $$,
  '42501',
  null,
  'Клиент не может дописать себе результат'
);

-- Функции перехода статуса недоступны клиенту поимённо: прямые гранты Supabase не
-- снимаются через PUBLIC, и без явного revoke до них дотянулись бы через PostgREST.
select throws_ok(
  $$ select public.fail_generation(
       'aaaaaaaa-0000-4000-8000-000000000001',
       '11111111-0000-4000-8000-000000000001', 'хочу баллы обратно') $$,
  '42501',
  null,
  'Клиент не может сам объявить генерацию неуспешной и вернуть себе баллы (NFR-05)'
);

select throws_ok(
  $$ select public.create_generation(
       'aaaaaaaa-0000-4000-8000-000000000001', 'card', 'ozon', 'clothing', 'clothing-model',
       'Даром', '', '', '{}'::text[], 1) $$,
  '42501',
  null,
  'Клиент не может принять себе заявку по своей цене (NFR-05)'
);

-- Справочники, наоборот, читают все: мастер генерации проходится и гостем (FR-12).
select ok(
  (select count(*) from public.marketplace_output_profiles) = 21,
  'Профиль есть у каждой пары «маркетплейс × категория» — 3 x 7 (FR-25)'
);

select * from finish();

rollback;
