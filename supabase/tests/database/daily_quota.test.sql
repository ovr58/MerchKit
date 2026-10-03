-- Контракт суточного счётчика бесплатных операций (веха M5, шаг 5; переименован из
-- `recognize_quota` миграцией 20261003110000). Им считаются распознавания и превью карточки.
--
-- Проверяется ровно то, ради чего лимит заводился: счёт ведётся на вызывающего, решение
-- принимается тем же запросом, что и счёт, сутки обнуляют счётчик, а адрес в таблицу не
-- попадает. Последнее — не придирка: строка счётчика переживает пользователя, и хранить в
-- ней адрес значило бы завести журнал посещений там, где нужен только счёт (ADR-0009).

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

/* ------------------------------------------------------- счёт и порог */

select ok(
  public.consume_daily_quota('addr:203.0.113.7', 3),
  'Первое распознавание разрешено'
);

select ok(
  public.consume_daily_quota('addr:203.0.113.7', 3),
  'Второе разрешено'
);

select ok(
  public.consume_daily_quota('addr:203.0.113.7', 3),
  'Третье — последнее в пределах лимита — разрешено'
);

select ok(
  not public.consume_daily_quota('addr:203.0.113.7', 3),
  'Четвёртое за лимитом и запрещено'
);

-- Счётчик продолжает расти после отказа. Останавливался бы — упёршийся в лимит сбрасывал
-- бы себя сам, чередуя запросы, и лимит перестал бы что-либо значить.
select is(
  (select used from public.daily_quota
    where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex')),
  4,
  'Отказанная попытка тоже посчитана'
);

/* ------------------------------------------- счёт ведётся на вызывающего */

select ok(
  public.consume_daily_quota('addr:198.51.100.4', 3),
  'Другой вызывающий начинает со своего счёта, а не с чужого'
);

/* ------------------- разные операции одного пользователя считаются раздельно */

-- Распознавание ходит с ключом `user:<id>`, превью — с `preview:user:<id>`. Один счёт на
-- двоих означал бы, что превью съедают распознавания и наоборот.
select ok(
  public.consume_daily_quota('user:test-user', 1),
  'Распознавание пользователя разрешено в пределах своего лимита'
);

select ok(
  public.consume_daily_quota('preview:user:test-user', 1),
  'Превью того же пользователя считается отдельно и разрешено'
);

/* ------------------------------------------- старые имена после переименования */

select is(
  (to_regclass('public.recognize_quota') is null
    and to_regprocedure('public.consume_recognize_quota(text, integer)') is null),
  true,
  'Таблицы recognize_quota и функции consume_recognize_quota больше нет'
);

/* --------------------------------------------------- сутки обнуляют счёт */

update public.daily_quota
   set day = current_date - 1
 where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex');

select ok(
  public.consume_daily_quota('addr:203.0.113.7', 3),
  'Новые сутки обнуляют счётчик в той же строке'
);

select is(
  (select used from public.daily_quota
    where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex')),
  1,
  'После обнуления счёт начинается с единицы'
);

/* ------------------------------------------------ адреса в таблице нет */

select is(
  (select count(*)::int from public.daily_quota where subject like '%203.0.113.7%'),
  0,
  'В таблицу попал отпечаток, а не адрес (ADR-0009)'
);

select * from finish();

rollback;
