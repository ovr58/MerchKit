-- Веха M7, шаг A5: базы иконок и шрифтов — то, из чего сборщик берёт содержимое слоёв
-- `asset` и чем рисует слои `text` (план card-assembly-pipeline_2026-08-31.md).
--
-- **Это административный путь, а не пользовательский.** Строки заводит разбор образца
-- (шаг A4), содержимое вкладывает человек процедурой `tools/card-pipeline/assets.mts`.
-- Пользователь баз не видит и не правит: политик для anon и authenticated здесь нет
-- вовсе, читает только service_role — то есть сборщик внутри generation-worker.
--
-- **Почему в базе, а не файлами рядом с функцией.** Дедуп по содержимому — требование
-- шага A5, и в базе он выражается ограничением, а не кодом, который можно забыть вызвать.
-- Плюс сборщик и так разговаривает с Postgres, а второй путь доступа (бакет Storage) завёл
-- бы собственную логику уникальности. Оговорка про размер: начертание весит ~450 КБ, и
-- пока база — десятки строк, это единицы мегабайт. Вырастет до сотен — содержимое уедет в
-- Storage, а таблица оставит себе хеш и путь; на форму записи это не влияет.
--
-- **Заявка и готовая запись — одна строка, а не две таблицы.** Разбор создаёт имя,
-- описание и происхождение, содержимое остаётся пустым: это «заявка». Человек вкладывает
-- содержимое — та же строка становится «готово». Статус поэтому вычисляется из наличия
-- содержимого, а не хранится отдельным полем, которое разъедется с фактом.

/* --------------------------------------------------------------------- база 2: иконки */

create table public.card_icons (
  name text primary key
    check (name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null check (description <> ''),
  -- Откуда родилась заявка: id разбора (`tools/card-pipeline/samples/<id>.json`) или
  -- 'manual'. Нужно, чтобы через полгода было видно, зачем в базе лежит эта иконка.
  requested_by text not null check (requested_by <> ''),
  -- Исходник SVG в байтах. NULL — заявка: имя занято, рисунка ещё нет, и слой иконки
  -- сборщик снимает правилом K-3, оставляя текст модуля на месте.
  content bytea
    check (content is null or (octet_length(content) between 1 and 65536
           and strpos(encode(content, 'escape'), '<svg') > 0)),
  content_hash text generated always as (encode(sha256(content), 'hex')) stored,
  status text generated always as
    (case when content is null then 'заявка' else 'готово' end) stored,
  created_at timestamptz not null default now()
);

comment on table public.card_icons is
  'База иконок карточки (веха M7, шаг A5). Строка заводится разбором образца как заявка, содержимое вкладывает человек процедурой tools/card-pipeline/assets.mts. Читает service_role: сборщик подставляет содержимое в слои asset на сборке.';
comment on column public.card_icons.name is
  'Дедуп по имени. Разбор называет иконку именем, а не содержимым: одно имя — одна иконка на всю базу.';
comment on column public.card_icons.content is
  'Исходник SVG в байтах, самодостаточный: внешних ссылок и шрифтов внутри быть не должно, сборка в сеть не ходит. Смотреть глазами — convert_from(content, ''UTF8'').';
comment on column public.card_icons.content_hash is
  'Дедуп по содержимому. Один и тот же рисунок под двумя именами — не расширение базы, а её замусоривание: вставка второго упрётся в уникальный индекс.';
comment on column public.card_icons.status is
  'Вычисляется из наличия содержимого, отдельным полем не хранится. «заявка» — рисунка ещё нет, слой снимется правилом K-3; «готово» — иконка рисуется.';

-- Частичный индекс, а не unique-колонка: у заявок содержимого нет, и их NULL-хеши не должны
-- мешать друг другу.
create unique index card_icons_content_idx
  on public.card_icons (content_hash) where content_hash is not null;

/* ------------------------------------------------------------- база 3: шрифты, семьи */

-- Гарнитура отдельно от начертаний, потому что лицензия — свойство семьи, а не файла.
-- Хранить её на каждом из четырёх начертаний Montserrat значит завести четыре копии одного
-- утверждения и однажды их разъехать.
create table public.card_font_families (
  family text primary key check (family <> ''),
  -- Лицензия полем — требование шага A5. Коммерческое использование карточек делает
  -- свободную лицензию условием работы, а не формальностью: пустой она быть не может.
  license text not null check (license <> ''),
  license_url text not null check (license_url like 'https://%'),
  -- Полный текст лицензии: OFL требует распространять его вместе со шрифтом, а раздаёт
  -- шрифт отсюда сборщик. NULL — та же «заявка», что и у содержимого: вкладывается
  -- процедурой из файла OFL-*.txt рядом со шрифтом.
  license_text text check (license_text is null or license_text <> ''),
  source_url text not null check (source_url like 'https://%'),
  note text not null default ''
);

comment on table public.card_font_families is
  'Гарнитуры базы шрифтов (веха M7, шаг A5). Только свободные для коммерческого использования: лицензия — обязательное поле, а не примечание.';
comment on column public.card_font_families.license_text is
  'Полный текст лицензии рядом со шрифтом: OFL требует распространять его вместе с файлами, а файлы раздаёт сборщик отсюда.';

/* -------------------------------------------------------- база 3: шрифты, начертания */

-- Начертание, а не «шрифт»: переменные шрифты не годятся — resvg берёт у них только
-- экземпляр по умолчанию, и font-weight в SVG не действует (замер 2026-08-31 на
-- Montserrat[wght] и Inter[opsz,wght]). Поэтому в базе по файлу на насыщенность.
create table public.card_fonts (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  family text not null references public.card_font_families (family),
  weight integer not null check (weight between 100 and 900),
  italic boolean not null default false,
  -- Файл начертания. NULL — заявка: гарнитура выбрана и лицензия проверена, файла ещё нет.
  content bytea check (content is null or octet_length(content) > 0),
  content_hash text generated always as (encode(sha256(content), 'hex')) stored,
  status text generated always as
    (case when content is null then 'заявка' else 'готово' end) stored,
  created_at timestamptz not null default now(),
  -- Дедуп по имени: одно начертание семьи — одна строка, как бы её ни назвали в id.
  unique (family, weight, italic)
);

comment on table public.card_fonts is
  'Начертания базы шрифтов (веха M7, шаг A5): по файлу на насыщенность, потому что переменные шрифты resvg не поддерживает — берёт у них только экземпляр по умолчанию.';
comment on column public.card_fonts.content is
  'Файл начертания (TTF/OTF) байтами. Заполняется процедурой tools/card-pipeline/assets.mts; в миграциях содержимого нет — миграция про форму базы, а не про полтора мегабайта шрифтов.';

create unique index card_fonts_content_idx
  on public.card_fonts (content_hash) where content_hash is not null;

/* ------------------------------------------------------------ база 3: роли и гарнитуры */

-- Разбор образца называет не гарнитуру, а роль: по растру чужой карточки гарнитуру
-- достоверно не восстановить и чаще всего не лицензировать (решение шага A4). Отображение
-- роли в семью живёт здесь, а не в коде сборщика: сменить гарнитуру заголовка — это правка
-- строки, а не релиз.
create table public.card_font_roles (
  role text primary key
    check (role in ('display', 'heading', 'body', 'label', 'accent')),
  family text not null references public.card_font_families (family),
  note text not null default ''
);

comment on table public.card_font_roles is
  'Отображение роли шрифта в гарнитуру (FONT_ROLES из supabase/functions/_shared/card-layout/types.ts). Ровно пять ролей: словарь макета закрытый, лишней роли здесь взяться неоткуда.';

/* -------------------------------------------------------------------- стартовый набор */

-- Гарнитуры и роли — решение, а не содержимое: обе семьи выбраны 2026-08-31 под пять ролей,
-- обе с кириллицей и обе SIL OFL. Файлы вкладывает процедура заполнения.
insert into public.card_font_families (family, license, license_url, source_url, note) values
  ('Montserrat', 'SIL Open Font License 1.1',
   'https://openfontlicense.org/open-font-license-official-text/',
   'https://fonts.google.com/specimen/Montserrat',
   'Гротеск на четыре насыщенности: четыре роли из пяти.'),
  ('Marck Script', 'SIL Open Font License 1.1',
   'https://openfontlicense.org/open-font-license-official-text/',
   'https://fonts.google.com/specimen/Marck+Script',
   'Рукописный акцент: подписи и «от руки» на карточке.');

insert into public.card_fonts (id, family, weight) values
  ('montserrat-regular',  'Montserrat',   400),
  ('montserrat-semibold', 'Montserrat',   600),
  ('montserrat-bold',     'Montserrat',   700),
  ('montserrat-black',    'Montserrat',   900),
  ('marck-script',        'Marck Script', 400);

insert into public.card_font_roles (role, family, note) values
  ('display', 'Montserrat',   'Крупная надпись поверх кадра: Black.'),
  ('heading', 'Montserrat',   'Заголовок модуля: Bold.'),
  ('body',    'Montserrat',   'Описание и абзацы: Regular.'),
  ('label',   'Montserrat',   'Подписи в плашках: SemiBold.'),
  ('accent',  'Marck Script', 'Рукописный акцент.');

-- Пять ролей закрытого словаря должны быть покрыты все: макет, сославшийся на роль без
-- гарнитуры, останется без шрифта уже на сборке. Проверяем утверждением здесь, а не
-- надеждой на внимательность будущей миграции.
do $$
begin
  if (select count(*) from public.card_font_roles) <> 5 then
    raise exception 'Ролей шрифта должно быть 5 (FONT_ROLES), получено %',
      (select count(*) from public.card_font_roles);
  end if;
end;
$$;

-- Иконки стартового набора заведены заявками: имена родились из разбора образца с курткой,
-- рисунки вкладывает процедура заполнения. Это и есть два приёма из витрины V-12.
insert into public.card_icons (name, description, requested_by) values
  ('thermometer', 'Температурный режим: столбик термометра со шкалой', 'jacket-outventure'),
  ('droplet',     'Водоотталкивающая пропитка: капля',                 'jacket-outventure');

/* ------------------------------------------------------------------------------ доступ */

alter table public.card_icons enable row level security;
alter table public.card_font_families enable row level security;
alter table public.card_fonts enable row level security;
alter table public.card_font_roles enable row level security;

-- Политик нет ни одной — и это утверждение, а не недосмотр: базы наполняет администратор,
-- а читает сборщик под service_role, который RLS обходит. Понадобится сборка на клиенте
-- (запасной путь шага A2) — read-политика заводится тогда же и отдельным решением, а не
-- выдаётся заранее «на всякий случай».
revoke all on public.card_icons from anon, authenticated;
revoke all on public.card_font_families from anon, authenticated;
revoke all on public.card_fonts from anon, authenticated;
revoke all on public.card_font_roles from anon, authenticated;
