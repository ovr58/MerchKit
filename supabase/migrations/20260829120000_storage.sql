-- Веха M4, шаг 3: приватные бакеты `uploads` (входные фото) и `results` (изображения
-- генераций). Доступ — только подписанными ссылками с коротким сроком жизни
-- (docs/SPEC.md §4), поэтому `public = false` у обоих и никакой «публичной папки».
--
-- Соглашение о путях: `<user_id>/<generation_id>/<имя>`. Первый сегмент — владелец, и
-- на нём же стоит вся изоляция (NFR-04). Класть файл мимо своей папки клиент не может:
-- политика проверяет путь при записи, а не только при чтении.

-- Пределы входа (US-E1) стоят в двух местах намеренно и обязаны меняться вместе:
--   * здесь — как последний рубеж на стороне Storage, мимо интерфейса его не обойти;
--   * в `supabase/functions/_shared/uploads.ts` — как значение, которое видит человек
--     в подписи под зоной загрузки и которое проверяется до отправки файла.
-- Цифры взяты от требований маркетплейсов, а не выдуманы: 10 МБ — общий предел всех трёх
-- площадок, набор форматов — их пересечение (docs/TZ.md §11, справочник требований).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('uploads', 'uploads', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('results', 'results', false, 20971520,
   array['image/jpeg']);

-- Условие доступа к файлу — в одной функции, как и `app.is_owner` для строк (docs/SPEC.md
-- §4): появится роль администратора — правка будет здесь, а не в каждой из четырёх политик.
create function app.owns_storage_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select split_part(object_name, '/', 1) = (select auth.uid())::text
$$;

comment on function app.owns_storage_path(text) is
  'Владелец файла — тот, чей идентификатор стоит первым сегментом пути. Единственное условие доступа к объектам Storage (NFR-04).';

grant execute on function app.owns_storage_path(text) to authenticated;

/* ------------------------------------------------------- uploads: входные фото (FR-02) */

-- Загружает и удаляет свои файлы сам пользователь: фото уходят в бакет прямо из браузера,
-- Edge Function в этом пути не участвует — гонять десять мегабайт через функцию незачем.
create policy uploads_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and app.owns_storage_path(name));

create policy uploads_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and app.owns_storage_path(name));

create policy uploads_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and app.owns_storage_path(name));

/* --------------------------------------------------- results: изображения генераций */

-- Только чтение своих. Пишет сюда воркер с service-role: результат генерации не должен
-- зависеть от того, что браузер сумеет положить в бакет (NFR-04, NFR-05).
--
-- Повторное скачивание из каталога (FR-17) — это ровно эта политика плюс подписанная
-- ссылка: баллы за доступ к своему файлу не списываются, потому что списывать негде.
create policy results_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'results' and app.owns_storage_path(name));
