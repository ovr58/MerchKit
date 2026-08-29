-- Контракт лимита бесплатных распознаваний (веха M5, шаг 5).
--
-- Проверяется ровно то, ради чего лимит заводился: счёт ведётся на вызывающего, решение
-- принимается тем же запросом, что и счёт, сутки обнуляют счётчик, а адрес в таблицу не
-- попадает. Последнее — не придирка: строка счётчика переживает пользователя, и хранить в
-- ней адрес значило бы завести журнал посещений там, где нужен только счёт (ADR-0009).

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

/* ------------------------------------------------------- счёт и порог */

select ok(
  public.consume_recognize_quota('addr:203.0.113.7', 3),
  'Первое распознавание разрешено'
);

select ok(
  public.consume_recognize_quota('addr:203.0.113.7', 3),
  'Второе разрешено'
);

select ok(
  public.consume_recognize_quota('addr:203.0.113.7', 3),
  'Третье — последнее в пределах лимита — разрешено'
);

select ok(
  not public.consume_recognize_quota('addr:203.0.113.7', 3),
  'Четвёртое за лимитом и запрещено'
);

-- Счётчик продолжает расти после отказа. Останавливался бы — упёршийся в лимит сбрасывал
-- бы себя сам, чередуя запросы, и лимит перестал бы что-либо значить.
select is(
  (select used from public.recognize_quota
    where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex')),
  4,
  'Отказанная попытка тоже посчитана'
);

/* ------------------------------------------- счёт ведётся на вызывающего */

select ok(
  public.consume_recognize_quota('addr:198.51.100.4', 3),
  'Другой вызывающий начинает со своего счёта, а не с чужого'
);

/* --------------------------------------------------- сутки обнуляют счёт */

update public.recognize_quota
   set day = current_date - 1
 where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex');

select ok(
  public.consume_recognize_quota('addr:203.0.113.7', 3),
  'Новые сутки обнуляют счётчик в той же строке'
);

select is(
  (select used from public.recognize_quota
    where subject = encode(sha256(convert_to('addr:203.0.113.7', 'utf8')), 'hex')),
  1,
  'После обнуления счёт начинается с единицы'
);

/* ------------------------------------------------ адреса в таблице нет */

select is(
  (select count(*)::int from public.recognize_quota where subject like '%203.0.113.7%'),
  0,
  'В таблицу попал отпечаток, а не адрес (ADR-0009)'
);

select * from finish();

rollback;
