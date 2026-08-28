-- Веха M4, шаг 1: справочники генерации — категории, сценарии показа, маркетплейсы и
-- параметры конечного изображения по паре «площадка × категория» (FR-25, ТЗ §5.2).
--
-- Всё это заводится миграциями, а не админкой: ролей в проекте нет (docs/SPEC.md §4),
-- редактировать справочник через Studio можно, но источник правды — этот файл.
--
-- **Читают справочники и гости.** Мастер генерации проходится без входа целиком, перехват
-- стоит только на «Запустить генерацию» (FR-12), поэтому `select` выдан и `anon`, и
-- `authenticated`. У `credit_packages` этого нет и не нужно: пакеты видит только вошедший.

/* ---------------------------------------------------------------- категории (ТЗ §5.1) */

create table public.categories (
  id text primary key,
  title text not null,
  sort_order integer not null unique
);

comment on table public.categories is
  'Семь фиксированных категорий товара (docs/TZ.md §5.1). Перечень закрытый: пользователь своих категорий не заводит, ИИ обязан вернуть значение отсюда (FR-03).';
comment on column public.categories.id is
  'Устойчивый идентификатор для кода и промптов. Не меняется при правке заголовка: на него ссылаются presets и marketplace_profiles.';

insert into public.categories (id, title, sort_order) values
  ('clothing',    'Одежда и обувь',     1),
  ('accessories', 'Аксессуары',         2),
  ('food',        'Еда и напитки',      3),
  ('beauty',      'Косметика и уход',   4),
  ('tech',        'Гаджеты и техника',  5),
  ('home',        'Дом и мебель',       6),
  ('other',       'Прочее',             7);

/* ------------------------------------------- сценарии показа: 6 × 4 = 24 (FR-08, ТЗ §5.1) */

-- Сценарий показа — **данные, а не код**: промпт живёт в строке таблицы и правится
-- миграцией, а не релизом фронтенда. Это прямой ответ на риск генплана «промпты разбросаны
-- по коду»: когда формулировки утвердят (открытый вопрос ТЗ §11), меняется этот справочник.
create table public.presets (
  id text primary key,
  category_id text not null references public.categories (id),
  title text not null,
  description text not null,
  prompt text not null,
  sort_order integer not null,
  unique (category_id, sort_order)
);

comment on table public.presets is
  'Предсозданные сценарии показа товара: по 4 на каждую категорию, кроме «Прочее» (FR-08). Промпт — данные: правится миграцией, а не релизом.';
comment on column public.presets.prompt is
  'Фрагмент промпта, описывающий подачу товара. Формулировки ВРЕМЕННЫЕ: 24 утверждённых сценария — открытый вопрос docs/TZ.md §11, закрывается на M6.';
comment on column public.presets.description is
  'Подпись под превью на артборде «Как показать товар» (V-08).';

-- Четыре сценария «Одежды и обуви» подтверждены референсом (V-05), остальные двадцать —
-- временные: строки справочника, а не строки кода, именно чтобы их замена ничего не ломала.
insert into public.presets (id, category_id, title, description, prompt, sort_order) values
  ('clothing-model',       'clothing',    'На модели',          'Носимый контекст, акцент на посадке',        'товар надет на модели, видна посадка по фигуре, естественная поза, ростовой или поясной кадр', 1),
  ('clothing-store',       'clothing',    'Как в магазине',     'На вешалке или подставке',                   'товар на вешалке или манекене, как на витрине магазина, ровные складки', 2),
  ('clothing-flatlay',     'clothing',    'Раскладка сверху',   'Вид строго сверху',                          'товар разложен на плоскости, съёмка строго сверху, мягкая тень', 3),
  ('clothing-studio',      'clothing',    'Каталог (студийно)', 'Чистый объект на нейтральном фоне',          'товар отдельно на однородном фоне, студийный свет, без реквизита', 4),

  ('accessories-inhand',   'accessories', 'В руках',            'Масштаб виден по руке модели',               'товар в руках модели, по руке читается реальный размер, мягкий дневной свет', 1),
  ('accessories-display',  'accessories', 'На витрине',         'На подставке под направленным светом',       'товар на подставке под направленным светом, акцент на фактуре материала', 2),
  ('accessories-flatlay',  'accessories', 'Раскладка сверху',   'Композиция из предмета и спутников',         'товар и пара сопутствующих предметов разложены сверху, аккуратная композиция', 3),
  ('accessories-studio',   'accessories', 'Каталог (студийно)', 'Чистый объект на нейтральном фоне',          'товар отдельно на однородном фоне, студийный свет, без реквизита', 4),

  ('food-served',          'food',        'Сервировка',         'Готовое блюдо или напиток на столе',         'продукт подан на столе как готовое блюдо или напиток, тёплый свет, уютный контекст', 1),
  ('food-ingredients',     'food',        'Состав рядом',       'Упаковка и ингредиенты в кадре',             'упаковка продукта и его ингредиенты рядом в кадре, читается состав', 2),
  ('food-flatlay',         'food',        'Раскладка сверху',   'Вид строго сверху на композицию',            'продукт и ингредиенты разложены сверху, съёмка строго сверху', 3),
  ('food-studio',          'food',        'Каталог (студийно)', 'Упаковка на нейтральном фоне',               'упаковка отдельно на однородном фоне, студийный свет, этикетка читается', 4),

  ('beauty-bathroom',      'beauty',      'В интерьере ванной', 'Средство в бытовом контексте',               'средство на полке ванной комнаты, бытовой контекст, мягкий рассеянный свет', 1),
  ('beauty-texture',       'beauty',      'Текстура рядом',     'Мазок продукта рядом с упаковкой',           'упаковка и мазок продукта рядом, видна текстура средства', 2),
  ('beauty-flatlay',       'beauty',      'Раскладка сверху',   'Композиция средств сверху',                  'средство и сопутствующие предметы разложены сверху, чистая композиция', 3),
  ('beauty-studio',        'beauty',      'Каталог (студийно)', 'Флакон на нейтральном фоне',                 'флакон или туба отдельно на однородном фоне, студийный свет, этикетка читается', 4),

  ('tech-inuse',           'tech',        'В использовании',    'Устройство в руках, экран включён',          'устройство в руках человека в работе, экран или индикаторы включены', 1),
  ('tech-desk',            'tech',        'На рабочем столе',   'Бытовой контекст',                           'устройство на рабочем столе в бытовом окружении, дневной свет', 2),
  ('tech-flatlay',         'tech',        'Раскладка сверху',   'Устройство и комплектация',                  'устройство и его комплектация разложены сверху, аккуратная сетка', 3),
  ('tech-studio',          'tech',        'Каталог (студийно)', 'Чистый объект на нейтральном фоне',          'устройство отдельно на однородном фоне, студийный свет, без реквизита', 4),

  ('home-interior',        'home',        'В интерьере',        'Предмет в комнате',                          'предмет расставлен в жилой комнате, видно, как он вписан в интерьер', 1),
  ('home-corner',          'home',        'Уголок сцены',       'Фрагмент интерьера крупно',                  'фрагмент интерьера с предметом крупным планом, уютная сцена', 2),
  ('home-flatlay',         'home',        'Раскладка сверху',   'Вид сверху на предмет и текстиль',           'предмет и текстиль разложены сверху, съёмка строго сверху', 3),
  ('home-studio',          'home',        'Каталог (студийно)', 'Чистый объект на нейтральном фоне',          'предмет отдельно на однородном фоне, студийный свет, без реквизита', 4);

-- «Прочее» осталось без сценариев намеренно (FR-08): там работает только свободный ввод
-- пожеланий (FR-09). Проверяем это утверждением, а не комментарием — миграция, которая
-- когда-нибудь добавит туда строку, упадёт здесь, а не тихо изменит поведение мастера.
do $$
begin
  if exists (select 1 from public.presets where category_id = 'other') then
    raise exception 'У категории «Прочее» не может быть сценариев показа (FR-08)';
  end if;

  if (select count(*) from public.presets) <> 24 then
    raise exception 'Сценариев показа должно быть 24 (6 категорий x 4), получено %',
      (select count(*) from public.presets);
  end if;
end;
$$;

/* -------------------------------------------------- маркетплейсы и профили (FR-25, §5.2) */

create table public.marketplaces (
  id text primary key,
  title text not null,
  note text not null,
  sort_order integer not null unique
);

comment on table public.marketplaces is
  'Целевые площадки генерации (FR-25). Перечень закрытый: своих площадок пользователь не заводит. Публиковать карточки мы не умеем — маркетплейс здесь только набор требований к файлу (CONTEXT.md «Маркетплейс»).';
comment on column public.marketplaces.note is
  'Пояснение на карточке выбора площадки (артборд WizardMarketplace): чем требования этой площадки отличаются от соседних.';

insert into public.marketplaces (id, title, note, sort_order) values
  ('ozon',        'Ozon',           'Для одежды, обуви и аксессуаров требует серый фон, а не белый. Еду показывает квадратом.', 1),
  ('wildberries', 'Wildberries',    'Вертикальный кадр 3 : 4, минимум 700 × 900. Фон белый или светлый.',                       2),
  ('yandex',      'Яндекс Маркет',  'Порог мягче — от 300 × 300, но витрина показывает всё в 3 : 4.',                           3);

-- Параметры конечного изображения. Строка без категории — правило площадки по умолчанию,
-- строка с категорией — исключение для конкретной пары. Исключений сейчас два, и оба
-- живут здесь **строками**, а не `if`-ами в коде (требование плана вехи).
create table public.marketplace_profiles (
  marketplace_id text not null references public.marketplaces (id),
  category_id text references public.categories (id),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  format text not null check (format in ('jpeg')),
  color_space text not null default 'sRGB',
  background_hex text not null check (background_hex ~ '^#[0-9A-F]{6}$'),
  background_title text not null
);

-- Одна строка по умолчанию на площадку и не больше одной на пару. Частичные уникальные
-- индексы вместо первичного ключа: в PK колонка не может быть NULL, а «по умолчанию» —
-- это именно отсутствие категории.
create unique index marketplace_profiles_default_idx
  on public.marketplace_profiles (marketplace_id) where category_id is null;
create unique index marketplace_profiles_pair_idx
  on public.marketplace_profiles (marketplace_id, category_id) where category_id is not null;

comment on table public.marketplace_profiles is
  'Параметры конечного изображения (FR-25, docs/TZ.md §5.2). Строка с category_id = NULL — правило площадки по умолчанию, строка с категорией — исключение для пары. Обоснование каждой цифры и источники — planning/reference/MARKETPLACE_IMAGE_REQUIREMENTS.md.';
comment on column public.marketplace_profiles.category_id is
  'NULL — правило действует для всех категорий площадки. Заполнено — исключение для пары «площадка × категория», оно перекрывает правило по умолчанию.';
comment on column public.marketplace_profiles.background_hex is
  'Цвет фона конечного изображения. Это параметр ГЕНЕРАЦИИ, а не постобработки: фон рисуется вместе с кадром (ТЗ §5.2), поэтому уходит в запрос к провайдеру.';
comment on column public.marketplace_profiles.background_title is
  'Как фон называется человеку на экране «Куда пойдёт изображение». Свотч рисуется по background_hex.';

-- Разрешение 1200 × 1600 выбрано нами, а не взято из требований площадок: это ближайший к
-- их рекомендациям размер, проходящий с запасом пороги всех трёх (справочник требований,
-- раздел «Профили»). Меняется — меняется вместе с docs/TZ.md §5.2, в одном изменении.
insert into public.marketplace_profiles
  (marketplace_id, category_id, width, height, format, background_hex, background_title) values
  ('ozon',        null,       1200, 1600, 'jpeg', '#FFFFFF', 'белый'),
  -- Исключение 1: Ozon требует серый #F2F3F5 для одежды, обуви и аксессуаров.
  ('ozon',        'clothing', 1200, 1600, 'jpeg', '#F2F3F5', 'серый #F2F3F5'),
  -- Исключение 2: Ozon Fresh (еда и напитки) показывает товар квадратом 1 : 1.
  ('ozon',        'food',     1600, 1600, 'jpeg', '#FFFFFF', 'белый'),
  ('wildberries', null,       1200, 1600, 'jpeg', '#FFFFFF', 'белый или светлый'),
  ('yandex',      null,       1200, 1600, 'jpeg', '#FFFFFF', 'белый или светлый');

-- Разрешённая пара «площадка × категория» — одной строкой на пару.
--
-- Зачем представление, а не разбор исключений в коде: параметры обязан показать интерфейс
-- ДО списания (FR-25), а применить — воркер. Две реализации одного правила разъезжаются
-- (ровно эту ошибку `pricing.ts` обходит одним файлом на клиента и сервер), поэтому правило
-- живёт в базе, а обе стороны читают готовую строку.
create view public.marketplace_output_profiles
with (security_invoker = on) as
select
  m.id as marketplace_id,
  c.id as category_id,
  p.width,
  p.height,
  (p.width / gcd(p.width, p.height))::text || ' : ' || (p.height / gcd(p.width, p.height))::text
    as aspect_label,
  p.format,
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
   -- Исключение для пары бьёт правило по умолчанию: строка с категорией идёт первой.
   order by mp.category_id nulls last
   limit 1
) p;

comment on view public.marketplace_output_profiles is
  'Параметры конечного изображения по паре «маркетплейс × категория» — по одной строке на пару, исключения уже применены (FR-25). Единственный источник и для показа в мастере, и для запроса к провайдеру.';

/* ------------------------------------------------------------------------------ доступ */

alter table public.categories enable row level security;
alter table public.presets enable row level security;
alter table public.marketplaces enable row level security;
alter table public.marketplace_profiles enable row level security;

-- Справочники: своего владельца у строки нет, поэтому `app.is_owner` неприменима и условие
-- честно написано как «всем». Политик на запись нет намеренно — правит только миграция.
create policy categories_select_all on public.categories
  for select to anon, authenticated using (true);
create policy presets_select_all on public.presets
  for select to anon, authenticated using (true);
create policy marketplaces_select_all on public.marketplaces
  for select to anon, authenticated using (true);
create policy marketplace_profiles_select_all on public.marketplace_profiles
  for select to anon, authenticated using (true);

revoke all on public.categories from anon, authenticated;
revoke all on public.presets from anon, authenticated;
revoke all on public.marketplaces from anon, authenticated;
revoke all on public.marketplace_profiles from anon, authenticated;
revoke all on public.marketplace_output_profiles from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant select on public.presets to anon, authenticated;
grant select on public.marketplaces to anon, authenticated;
grant select on public.marketplace_profiles to anon, authenticated;
grant select on public.marketplace_output_profiles to anon, authenticated;
