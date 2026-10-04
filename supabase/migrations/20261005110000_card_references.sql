-- Каталог референсов для сочинения карточки (ADR-0019, п. 7; шаг C4 плана
-- `html-layout-authoring_2026-10-05.md`).
--
-- Референс — образец карточки лидера выдачи, который модель сочинения видит рядом с кадром. Его
-- не разбирают в слои (это не библиотека макетов `card_layouts`), он только показывается модели.
-- Каталог пополняет владелец командой `npm run cards:references -- push`; следующая карточка
-- опирается на новые образцы без правки кода — это и есть петля улучшения. Выбор не больше
-- четырёх — чистая функция `pickReferences` (`card-layout/html/references.ts`), без модели.

create table public.card_references (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique check (storage_path <> ''),
  marketplace_id text not null references public.marketplaces (id),
  category_id text not null references public.categories (id),
  tags text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'retired')),
  added_at timestamptz not null default now()
);

comment on table public.card_references is
  'Каталог референсов сочинения карточки (ADR-0019 п. 7): картинка в приватном бакете references, площадка и категория для выбора. Читает только service_role.';
comment on column public.card_references.storage_path is
  'Путь в бакете references: <площадка>/<категория>/<sha256 содержимого>.<расширение>. Хеш в имени — дедуп по содержимому: тот же файл второй раз не заводится.';
comment on column public.card_references.tags is
  'Имена папок, из которых образец загружен (например, раздел площадки). Из распознавания не берутся.';
comment on column public.card_references.status is
  'retired — образец выведен из выбора, но строка и файл сохранены: так снимается неудачный референс без потери истории.';

/* ------------------------------------------------------------------------------ доступ */

alter table public.card_references enable row level security;

-- Политик нет — утверждение, а не недосмотр: каталог наполняет администратор, читает воркер
-- генерации под service_role, который RLS обходит (тот же уклад, что у card_icons).
revoke all on public.card_references from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('references', 'references', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']);

-- Политик Storage нет: пользователь референсов не видит и подменить их не может.
