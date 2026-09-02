-- Ресурсы растеризатора M7 B0.1: они не должны попасть в публичный Storage или стать доступны
-- пользователю. Содержимое проверяет процедура `cards:render-assets`, здесь — контракт бакета.

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  exists (select 1 from storage.buckets where id = 'card-render-assets' and public = false),
  'Ресурсы растеризатора лежат в приватном бакете'
);
select is(
  (select file_size_limit from storage.buckets where id = 'card-render-assets'),
  5242880::bigint,
  'Размер wasm и набора шрифтов ограничен пятью мегабайтами'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'card-render-assets'),
  array['application/wasm', 'application/json', 'font/ttf']::text[],
  'Бакет принимает только wasm, манифест и статические TTF'
);
select policies_are(
  'storage',
  'objects',
  array[
    'results_select_own',
    'uploads_delete_own',
    'uploads_insert_own',
    'uploads_select_own'
  ]::text[],
  'Для ресурсов растеризатора нет пользовательских политик Storage'
);

select * from finish();

rollback;
