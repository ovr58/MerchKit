-- Веха M5, шаг 6: срок хранения загруженных фото.
--
-- **Решение пользователя 2026-08-29.** Входные фото (`uploads`) живут 3 дня, и мы прямо
-- говорим об этом на экране загрузки. Результаты генераций (`results`) — бессрочно: это
-- оплаченный продукт, и FR-17 обещает повторное скачивание из каталога без списания.
-- Более долгое хранение исходников уходит в «Дальнейшие апгрейды» как часть будущей
-- платной подписки.
--
-- **Удаление по возрасту объекта, а не по завершению генерации.** «Удалять сразу после
-- работы воркера» столкнулось бы с уже реализованным US-E4: `restoreDraftFrom`
-- (src/features/generation/api.ts) выкачивает исходные фото обратно, чтобы вернуть мастер
-- к параметрам неуспешной генерации. При сроке в три дня повтор внутри срока работает как
-- задумано, а за его пределами мастер честно говорит «фото загрузите заново» — штатный
-- исход, а не сбой.
--
-- **Почему отбор путей живёт в SQL, а удаление — нет.** Storage API умеет листинг только
-- по префиксу: папка за папкой, по одной на пользователя, с фильтром по возрасту уже в
-- коде. В `storage.objects` возраст лежит колонкой — весь отбор укладывается в один
-- запрос. Удаляет при этом всё равно Storage API (функция `purge-uploads`): строка в
-- `storage.objects` — только метаданные, сам файл лежит в объектном хранилище, и удаление
-- строки оставило бы файл сиротой, за который мы продолжаем платить.

create function public.expired_upload_paths(max_age interval, batch_limit integer default 500)
returns table (path text)
language sql
security definer
set search_path = ''
as $$
  -- `coalesce`: `created_at` в `storage.objects` объявлена nullable, и объект без даты
  -- создания не должен становиться бессмертным — тогда считаем по последней записи.
  select o.name
    from storage.objects o
   where o.bucket_id = 'uploads'
     and coalesce(o.created_at, o.updated_at) < now() - max_age
   order by coalesce(o.created_at, o.updated_at)
   limit batch_limit
$$;

comment on function public.expired_upload_paths(interval, integer) is
  'Пути входных фото, переживших срок хранения (веха M5, шаг 6). Только отбор: удаляет Storage API из функции purge-uploads, иначе файл остаётся в объектном хранилище сиротой. batch_limit — потолок одного прогона уборки, а не всей очереди.';

-- Поимённо: прямые гранты Supabase не снимаются через PUBLIC (см. миграцию ledger).
-- Пользователю эта функция не нужна вовсе: свои файлы он и так видит через Storage,
-- а чужие пути — чужая приватность (NFR-04, NFR-06).
revoke all on function public.expired_upload_paths(interval, integer)
  from public, anon, authenticated;
grant execute on function public.expired_upload_paths(interval, integer) to service_role;
