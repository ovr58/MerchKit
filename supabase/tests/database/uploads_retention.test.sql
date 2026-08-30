-- Срок хранения входных фото (веха M5, шаг 6).
--
-- Отбор путей — единственное место, где живёт сам срок: ошибись он в сторону «моложе», и
-- уборка снесёт фото активной генерации; в сторону «старше» — мы нарушим то, что сказали
-- человеку на экране загрузки. Живой прогон этого не увидит: `supabase/tests/*.mjs` ходят
-- через API и в `storage.objects` не заглядывают.
--
-- Отдельно закрепляется, что бакет `results` уборке не подлежит вообще: это оплаченный
-- результат, FR-17 обещает повторное скачивание из каталога без списания.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into storage.objects (bucket_id, name, created_at, updated_at) values
  ('uploads', 'user-1/gen-1/old.jpg',      now() - interval '4 days',  now() - interval '4 days'),
  ('uploads', 'user-1/gen-2/fresh.jpg',    now() - interval '1 hour',  now() - interval '1 hour'),
  ('uploads', 'user-2/gen-3/oldest.jpg',   now() - interval '9 days',  now() - interval '9 days'),
  ('uploads', 'user-2/gen-4/no-date.jpg',  null,                       now() - interval '5 days'),
  ('results', 'user-1/gen-1/result-1.jpg', now() - interval '90 days', now() - interval '90 days');

/* ------------------------------------------------------- что попадает под уборку */

select set_eq(
  $$ select path from public.expired_upload_paths(interval '3 days') $$,
  $$ values ('user-1/gen-1/old.jpg'), ('user-2/gen-3/oldest.jpg'), ('user-2/gen-4/no-date.jpg') $$,
  'Под уборку идут все фото старше срока, включая объект без даты создания (по updated_at)'
);

select is(
  (select count(*)::int from public.expired_upload_paths(interval '3 days')
    where path = 'user-1/gen-2/fresh.jpg'),
  0,
  'Фото внутри срока хранения уборка не трогает: US-E4 обязан повторить генерацию с ними'
);

select is(
  (select count(*)::int from public.expired_upload_paths(interval '1 second')
    where path like '%result%'),
  0,
  'Результаты генераций не убираются никогда — они хранятся бессрочно (FR-17)'
);

/* ------------------------------------------------------- потолок одного прогона */

select is(
  (select count(*)::int from public.expired_upload_paths(interval '3 days', 1)),
  1,
  'batch_limit ограничивает прогон: очередь длиннее разбирается следующим заходом'
);

select is(
  (select path from public.expired_upload_paths(interval '3 days', 1)),
  'user-2/gen-3/oldest.jpg',
  'Первым уходит самое старое фото, а не случайное из очереди'
);

/* ------------------------------------------------------- кому эта функция доступна */

select ok(
  not has_function_privilege('authenticated', 'public.expired_upload_paths(interval, integer)', 'execute')
    and not has_function_privilege('anon', 'public.expired_upload_paths(interval, integer)', 'execute'),
  'Пути чужих файлов пользователю не отдаются: функция только для service-role (NFR-04)'
);

select * from finish();

rollback;
