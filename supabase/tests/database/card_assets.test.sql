-- Контракт баз иконок и шрифтов (веха M7, шаг A5).
--
-- Проверяется ровно то, ради чего таблицы заводились и чего нельзя доверить внимательности
-- человека: дедуп по имени и по содержимому, статус как следствие содержимого (а не второе
-- поле, которое с ним разъедется), обязательная лицензия у гарнитуры и полная закрытость
-- баз от пользователя. Процедуру заполнения (`tools/card-pipeline/assets.mts`) это не
-- дублирует: там сеть и файлы, здесь — ограничения базы.

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

/* ------------------------------------------------------------------- дедуп по имени */

select throws_ok(
  $$ insert into public.card_icons (name, description, requested_by)
     values ('thermometer', 'Второй термометр', 'manual') $$,
  '23505',
  null,
  'Иконка с занятым именем не заводится: одно имя — одна иконка на всю базу'
);

select throws_ok(
  $$ insert into public.card_fonts (id, family, weight)
     values ('montserrat-bold-copy', 'Montserrat', 700) $$,
  '23505',
  null,
  'Одно начертание семьи — одна строка, как бы её ни назвали в id'
);

select throws_ok(
  $$ insert into public.card_icons (name, description, requested_by)
     values ('Термометр', 'Имя не по формату', 'manual') $$,
  '23514',
  null,
  'Имя иконки — только латиница через дефис: на него ссылается разбор образца'
);

/* -------------------------------------------------------------- дедуп по содержимому */

insert into public.card_icons (name, description, requested_by, content) values
  ('test-first', 'Проба дедупа', 'manual', convert_to('<svg viewBox="0 0 1 1"/>', 'UTF8'));

select throws_ok(
  $$ insert into public.card_icons (name, description, requested_by, content)
     values ('test-second', 'Тот же рисунок под другим именем', 'manual',
             convert_to('<svg viewBox="0 0 1 1"/>', 'UTF8')) $$,
  '23505',
  null,
  'Один и тот же рисунок под двумя именами базу не расширяет, а замусоривает'
);

insert into public.card_icons (name, description, requested_by) values
  ('test-request-a', 'Заявка без содержимого', 'manual'),
  ('test-request-b', 'Вторая заявка без содержимого', 'manual');

select is(
  (select count(*)::int from public.card_icons where name like 'test-request-%'),
  2,
  'Пустое содержимое дедупу не мешает: заявок без рисунка может быть сколько угодно'
);

select throws_ok(
  $$ insert into public.card_icons (name, description, requested_by, content)
     values ('test-not-svg', 'Не рисунок', 'manual', convert_to('просто текст', 'UTF8')) $$,
  '23514',
  null,
  'В базу иконок кладётся SVG, а не что попало: сборка не умеет рисовать чужой формат'
);

/* --------------------------------------------------------- статус — следствие, не поле */

select is(
  (select status from public.card_icons where name = 'test-request-a'),
  'заявка',
  'Строка без содержимого — заявка'
);

update public.card_icons
   set content = convert_to('<svg viewBox="0 0 2 2"/>', 'UTF8')
 where name = 'test-request-a';

select is(
  (select status from public.card_icons where name = 'test-request-a'),
  'готово',
  'Вложили содержимое — та же строка стала готовой, второго поля для этого не нужно'
);

/* ----------------------------------------------------------------- лицензия шрифтов */

select throws_ok(
  $$ insert into public.card_font_families (family, license, license_url, source_url)
     values ('Тестовая', '', 'https://example.org/l', 'https://example.org/f') $$,
  '23514',
  null,
  'Гарнитура без лицензии в базу не попадает: коммерческое использование делает её условием'
);

select is(
  (select count(*)::int from public.card_font_families where license_url not like 'https://%'),
  0,
  'У каждой гарнитуры есть ссылка на текст лицензии'
);

/* -------------------------------------------------------------- роли шрифта покрыты */

select is(
  (select count(*)::int
     from unnest(array['display', 'heading', 'body', 'label', 'accent']) as role
    where not exists (
      select 1
        from public.card_font_roles r
        join public.card_fonts f on f.family = r.family
       where r.role = role.role
    )),
  0,
  'Каждой роли словаря макета отвечает гарнитура, у которой есть хотя бы одно начертание'
);

/* -------------------------------------------------------------------- закрытость баз */

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select count(*) from public.card_icons $$,
  '42501',
  null,
  'Пользователю базы не видны вовсе: это административный путь, а не часть продукта'
);

select * from finish();

rollback;
