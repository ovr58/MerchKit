-- B3: знак продавца хранится с заявкой отдельным путём и только у карточки.
--
-- Проверяется то, ради чего колонка заведена отдельно от `source_paths`: знак не должен
-- уехать вендору пятым фото товара и не должен появиться у генерации, где макета нет вовсе.

begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email) values
  ('ffffffff-0000-4000-8000-000000000006', 'logo-owner@example.com');
update auth.users set email_confirmed_at = now()
 where id = 'ffffffff-0000-4000-8000-000000000006';

create temporary table run (id uuid);

insert into run
select public.create_generation(
  'ffffffff-0000-4000-8000-000000000006', 'card', 'ozon', 'clothing', 'clothing-model',
  'Куртка-бомбер', '', '', array['ffffffff-0000-4000-8000-000000000006/1-photo'], 55,
  '[]'::jsonb, 'ffffffff-0000-4000-8000-000000000006/1-logo.png'
);

select is(
  (select logo_path from public.generations where id = (select id from run)),
  'ffffffff-0000-4000-8000-000000000006/1-logo.png',
  'Путь знака сохраняется с заявкой'
);

select is(
  (select source_paths from public.generations where id = (select id from run)),
  array['ffffffff-0000-4000-8000-000000000006/1-photo'],
  'Знак не попадает во входные фото: вендор получает только референсы товара'
);

-- Пустая строка вместо пути — не «знак есть», а «знака нет»: иначе подбор макета получил бы
-- ложное «логотип загружен» и предпочёл макет с гнездом под знак, которое нечем заполнить.
insert into run
select public.create_generation(
  'ffffffff-0000-4000-8000-000000000006', 'card', 'ozon', 'clothing', 'clothing-model',
  'Куртка без знака', '', '', '{}'::text[], 55, '[]'::jsonb, '   '
);

select is(
  (select count(*)::int from public.generations
    where user_id = 'ffffffff-0000-4000-8000-000000000006' and logo_path is null),
  1,
  'Пустой путь знака хранится как отсутствие знака, а не как пустая строка'
);

select throws_ok(
  $$ select public.create_generation(
       'ffffffff-0000-4000-8000-000000000006', 'photo', 'ozon', 'clothing', 'clothing-model',
       'Куртка-бомбер', '', '', '{}'::text[], 40, '[]'::jsonb,
       'ffffffff-0000-4000-8000-000000000006/2-logo.png') $$,
  '23514',
  null,
  'У генерации фото знака быть не может: макета нет, ставить его некуда'
);

select is(
  (select count(*)::int from public.generations where user_id = 'ffffffff-0000-4000-8000-000000000006'),
  2,
  'Отклонённая заявка со знаком у фото не оставляет строки'
);

select * from finish();

rollback;
