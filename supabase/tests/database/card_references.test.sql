-- Каталог референсов сочинения (ADR-0019, п. 7; шаг C4 плана html-layout-authoring): закрыт от
-- пользователя, бакет приватный, площадка и категория — из справочников, путь — уникален.

begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(
  exists (select 1 from storage.buckets where id = 'references' and public = false),
  'Референсы лежат в приватном бакете'
);
select is(
  (select file_size_limit from storage.buckets where id = 'references'),
  2097152::bigint,
  'Референс не больше двух мегабайт — тот же предел, что у инструмента загрузки'
);

insert into public.card_references (storage_path, marketplace_id, category_id, tags)
values ('ozon/home/abc.jpg', 'ozon', 'home', array['Дом']);

select throws_ok(
  $$ insert into public.card_references (storage_path, marketplace_id, category_id)
     values ('ozon/home/abc.jpg', 'ozon', 'home') $$,
  '23505',
  null,
  'Тот же путь второй раз не заводится: дедуп по содержимому держит база'
);
select throws_ok(
  $$ insert into public.card_references (storage_path, marketplace_id, category_id)
     values ('x/home/def.jpg', 'x', 'home') $$,
  '23503',
  null,
  'Площадка — только из справочника marketplaces'
);
select throws_ok(
  $$ update public.card_references set status = 'hidden' where storage_path = 'ozon/home/abc.jpg' $$,
  '23514',
  null,
  'Статус — active или retired'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select count(*) from public.card_references $$,
  '42501',
  null,
  'Пользователю каталог не виден вовсе: это административный путь'
);

select * from finish();

rollback;
