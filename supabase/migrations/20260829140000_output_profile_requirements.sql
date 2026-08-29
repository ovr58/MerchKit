-- Веха M5, шаг 2: профиль изображения описывается требованиями площадки, а не одним
-- точным размером.
--
-- ЧТО ВЫЯСНИЛОСЬ НА ЖИВОМ ВЕНДОРЕ (прогон 2026-08-29, bench/runs/aitunnel-images-*).
-- Профиль требовал JPEG ровно 1200 × 1600, и это оказалось недостижимо ни у одной модели
-- шлюза AITunnel: генерация изображений принимает не пиксели, а **бакеты** разрешения
-- (512 / 1K / 2K / 4K) плюс соотношение сторон. На 3 : 4 бакет 1K даёт 896 × 1200, 2K —
-- 1792 × 2400; произвольного размера нет и не появится. Формат при этом недетерминирован:
-- на одинаковых запросах шлюз вернул JPEG в трёх случаях из семи и PNG в четырёх
-- (`supported_output_formats` у моделей Gemini пуст — выбора формата вендор не даёт).
-- Проверка равенством отвергала бы **каждую** генерацию: пользователю возврат баллов,
-- нам — уплаченные вендору деньги за выброшенный кадр.
--
-- ПОЧЕМУ ЭТО ПРАВКА ПРОФИЛЯ, А НЕ ОБРАБОТКА КАРТИНКИ. Размер 1200 × 1600 был **нашим
-- выбором**, а не требованием площадок: так и записано в прежнем комментарии к seed-у
-- («выбрано нами, а не взято из требований площадок»). Сами площадки формулируют
-- требования как **порог и рекомендацию**, а форматов принимают несколько — см.
-- planning/reference/MARKETPLACE_IMAGE_REQUIREMENTS.md, значения там согласованы
-- заказчиком и подтверждены им повторно 2026-08-29. Приводим профиль к тому, как
-- требования сформулированы на самом деле, вместо того чтобы дописывать ресэмплер ради
-- цифры, которой никто не требовал.
--
-- ЧТО ЭТО ДАЁТ ПО ДЕНЬГАМ. Бакет привязан к цене: 2K стоил 17,25 ₽ за изображение, 1K —
-- 11,54 ₽ (замерено, usage.cost_rub шлюза). Там, где порог площадки проходит 1K, платим
-- меньше на треть.

/* ------------------------------------------------------- порог, форматы и предел веса */

-- Порог площадки — то, ниже чего файл не примут. Прежде его в базе не было вовсе:
-- единственное число `width`/`height` играло сразу и порог, и цель, и потому не могло
-- пережить вендора, который отдаёт размер бакетами.
alter table public.marketplace_profiles
  add column min_width integer not null default 1 check (min_width > 0),
  add column min_height integer not null default 1 check (min_height > 0),
  -- Предел веса файла: у всех трёх площадок он совпал и равен 10 МБ (справочник, сводка).
  add column max_bytes integer not null default 10485760 check (max_bytes > 0);

-- Соотношение сторон хранится **явно**, а не выводится из width/height. Пока кадр был
-- 1200 × 1600, сокращение давало ровные 3 : 4 и разницы не было; целевой кадр под бакет
-- вендора (1792 × 2400) сокращается в 56 : 75 — соотношение, которого нет ни у площадки,
-- ни у вендора в списке допустимых. Соотношение диктует площадка, а пиксели выбираем мы
-- под возможности вендора — это две разные величины, и одна из другой не выводится.
alter table public.marketplace_profiles
  add column aspect_w integer not null default 3 check (aspect_w > 0),
  add column aspect_h integer not null default 4 check (aspect_h > 0);

-- Форматов у площадки несколько, и вендор выбирает из них сам. Множественное число здесь
-- не «на будущее», а отражение факта: на одном и том же запросе приходит то JPEG, то PNG,
-- и оба площадками принимаются.
alter table public.marketplace_profiles
  add column formats text[] not null default array['jpeg']
    check (formats <@ array['jpeg', 'png', 'webp', 'heic'] and array_length(formats, 1) > 0);

update public.marketplace_profiles set formats = array['jpeg', 'png'];

-- Прежняя колонка уходит: держать рядом `format` и `formats` значит заводить два ответа на
-- один вопрос. Представление ниже пересоздаётся, поэтому зависимость снимается сама.
drop view public.marketplace_output_profiles;
alter table public.marketplace_profiles drop column format;

alter table public.marketplace_profiles alter column min_width drop default;
alter table public.marketplace_profiles alter column min_height drop default;

comment on column public.marketplace_profiles.min_width is
  'Нижний порог площадки по ширине: файл меньше не примут. Источник — planning/reference/MARKETPLACE_IMAGE_REQUIREMENTS.md.';
comment on column public.marketplace_profiles.min_height is
  'Нижний порог площадки по высоте. Порог и целевой кадр (width/height) — разные вещи: порог диктует площадка, кадр выбираем мы под возможности вендора.';
comment on column public.marketplace_profiles.formats is
  'Форматы, которые площадка принимает. Их несколько намеренно: модели изображений выбирают формат сами и на одинаковых запросах возвращают то JPEG, то PNG (проверено на живом вендоре 2026-08-29).';
comment on column public.marketplace_profiles.max_bytes is
  'Предел веса готового файла. У всех трёх площадок — 10 МБ; то же число служит пределом на вход (US-E1).';

comment on column public.marketplace_profiles.width is
  'Целевой кадр по ширине: что запрашиваем у провайдера и показываем пользователю до списания (FR-25). Обязан быть достижим вендором и не ниже min_width.';
comment on column public.marketplace_profiles.height is
  'Целевой кадр по высоте. Вместе с width задаёт соотношение сторон — именно оно, а не абсолютный размер, уходит в запрос к провайдеру.';

-- Целевой кадр не может быть ниже порога площадки: иначе профиль сам себе противоречит и
-- обещает пользователю то, что площадка отвергнет.
alter table public.marketplace_profiles
  add constraint marketplace_profiles_target_clears_floor
  check (width >= min_width and height >= min_height);

/* --------------------------------------------------------------- значения под вендора */

-- Кадры выбраны так, чтобы каждый был ровно тем, что отдаёт бакет шлюза, и при этом
-- проходил порог своей площадки самым дешёвым бакетом:
--   3 : 4 → 1K = 896 × 1200, 2K = 1792 × 2400
--   1 : 1 → 1K = 1024 × 1024
-- Замерено вызовами, а не взято из документации шлюза: каталог публикует только имена
-- бакетов, без пикселей.
update public.marketplace_profiles set
  min_width = 200, min_height = 200, width = 896, height = 1200
  where marketplace_id = 'ozon' and category_id is null;

-- Ozon для «Одежды, обуви и аксессуаров» держит порог 900 × 1200 — на четыре пикселя выше
-- того, что даёт бакет 1K (896). Поэтому здесь и только здесь остаётся 2K: занизить порог
-- нельзя, а промежуточного бакета у вендора нет. Эти две пары дороже прочих — 17,25 ₽
-- против 11,54 ₽ за изображение.
update public.marketplace_profiles set
  min_width = 900, min_height = 1200, width = 1792, height = 2400
  where marketplace_id = 'ozon' and category_id = 'clothing';

-- Аксессуары: строки-исключения для них не было вовсе — пара падала на правило Ozon по
-- умолчанию и получала белый фон вместо серого. Расхождение со справочником (там серый
-- #F2F3F5 назван для «одежды, обуви И АКСЕССУАРОВ») найдено при этой правке и чинится
-- здесь же: порог у аксессуаров тот же, что у одежды, и фон тоже.
insert into public.marketplace_profiles
  (marketplace_id, category_id, min_width, min_height, width, height, aspect_w, aspect_h,
   formats, max_bytes, background_hex, background_title)
values
  ('ozon', 'accessories', 900, 1200, 1792, 2400, 3, 4,
   array['jpeg', 'png'], 10485760, '#F2F3F5', 'серый #F2F3F5');

update public.marketplace_profiles set
  min_width = 200, min_height = 200, width = 1024, height = 1024, aspect_w = 1, aspect_h = 1
  where marketplace_id = 'ozon' and category_id = 'food';

update public.marketplace_profiles set
  min_width = 700, min_height = 900, width = 896, height = 1200
  where marketplace_id = 'wildberries' and category_id is null;

update public.marketplace_profiles set
  min_width = 300, min_height = 300, width = 896, height = 1200
  where marketplace_id = 'yandex' and category_id is null;

/* ------------------------------------------------------------- бакет результатов */

-- Бакет `results` — последний рубеж по формату на стороне Storage, и он остался с M4 на
-- одном `image/jpeg`: тогда выход был всегда наш собственный JPEG. Вендор выбирает формат
-- сам, и PNG отвергался уже ПОСЛЕ оплаты вызова — изображение получено, профиль площадки
-- пройден, а загрузка падает с HTTP 400. Поймано первым прогоном боевого пути 2026-08-29:
-- четыре генерации из семи потеряны так, деньги вендору за них уплачены.
-- Набор приводится к тому же перечню, что и `marketplace_profiles.formats`.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png']
 where id = 'results';

/* ---------------------------------------------------------------------- представление */

-- Пересоздаётся один в один с прежним, кроме колонок формата и порога: правило по-прежнему
-- живёт в базе, а интерфейс и воркер читают готовую строку на пару (см. обоснование в
-- миграции таксономии).
create view public.marketplace_output_profiles
with (security_invoker = on) as
select
  m.id as marketplace_id,
  c.id as category_id,
  p.width,
  p.height,
  p.min_width,
  p.min_height,
  p.aspect_w,
  p.aspect_h,
  -- Подпись собирается из объявленного соотношения, а не из целевых пикселей: иначе кадр
  -- 1792 × 2400 показал бы человеку «56 : 75» вместо честного «3 : 4».
  p.aspect_w::text || ' : ' || p.aspect_h::text as aspect_label,
  p.formats,
  p.max_bytes,
  p.color_space,
  p.background_hex,
  p.background_title
from public.marketplaces m
cross join public.categories c
cross join lateral (
  select mp.*
    from public.marketplace_profiles mp
   where mp.marketplace_id = m.id
     and (mp.category_id = c.id or mp.category_id is null)
   order by mp.category_id nulls last
   limit 1
) p;

comment on view public.marketplace_output_profiles is
  'Параметры конечного изображения по паре «маркетплейс × категория» — по одной строке на пару, исключения уже применены (FR-25). Единственный источник и для показа в мастере, и для запроса к провайдеру.';

revoke all on public.marketplace_output_profiles from anon, authenticated;
grant select on public.marketplace_output_profiles to anon, authenticated;
