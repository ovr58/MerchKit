-- Веха M5, шаг 5: лимит бесплатных распознаваний.
--
-- **Зачем.** Мастер по FR-12 проходится без входа целиком — перехват стоит только на
-- «Запустить генерацию», — значит `recognize` обязан отвечать и анониму. На заглушке это
-- ничего не стоило. На живом вендоре каждый ответ гостю — деньги с нашего счёта, и открытый
-- эндпоинт превращается в наш платёж за чужой трафик.
--
-- **Почему лимит, а не плата за распознавание** (решение пользователя 2026-08-29, разобрано
-- в плане вехи). Списать баллы можно только у вошедшего, а дыра ровно в госте: плата свелась
-- бы к «распознавание только после входа» с ценником сверху. Сверх того она стоит 1,7 балла
-- при чеке в 50 (себестоимость распознавания 0,13 ₽, балла — 0,076 ₽), требует нового типа
-- операции в журнале со своим ключом идемпотентности и ломает обещание FR-13 «не получилось
-- — вернули всё»: невозвратные баллы превращают его в «вернули не всё». Лимит закрывает
-- ровно анонима и не трогает ни прайс из ТЗ §11, ни FR-13, ни проход мастера по FR-12.
--
-- **Адреса здесь не хранятся.** В таблицу попадает только отпечаток — `sha256` от ключа
-- вызывающего, тем же приёмом, что ключ начисления в `signup_bonus` (ADR-0009). `sha256`
-- встроена в Postgres, расширения не требует.

create table public.recognize_quota (
  subject text primary key,
  day date not null,
  used integer not null check (used > 0),
  updated_at timestamptz not null default now()
);

comment on table public.recognize_quota is
  'Счётчик распознаваний на вызывающего за сутки (веха M5, шаг 5). Одна строка на вызывающего: она переиспользуется каждый день, а не копится по дате.';
comment on column public.recognize_quota.subject is
  'Отпечаток вызывающего — sha256 от «user:<id>» либо «addr:<адрес>». Ни адреса, ни идентификатора в открытом виде тут нет (ADR-0009).';
comment on column public.recognize_quota.day is
  'Сутки, к которым относится счёт. Смена даты обнуляет счётчик в той же строке — отдельная уборка для этого не нужна.';
comment on column public.recognize_quota.used is
  'Сколько распознаваний вызывающий израсходовал за эти сутки. Растёт и после исчерпания лимита: иначе счётчик сбрасывался бы сам собой у того, кто в него упёрся.';

/**
 * Расходует одно распознавание и отвечает, можно ли его выполнять.
 *
 * Счёт и решение — одним запросом: разнеси их, и два одновременных вызова оба увидели бы
 * «лимит не исчерпан». Именно так квоты и обходят.
 */
create function public.consume_recognize_quota(caller_key text, daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed integer;
begin
  -- Имена параметров нарочно не совпадают с именами колонок: PL/pgSQL подставляет
  -- переменные в выражения, и одноимённый параметр превратил бы ссылку на колонку в
  -- неоднозначную. На вехе M3 этот урок уже стоил пересоздания двух функций.
  if daily_limit <= 0 then
    raise exception 'Лимит распознаваний должен быть положительным, получено %', daily_limit;
  end if;

  insert into public.recognize_quota as q (subject, day, used)
  values (encode(sha256(convert_to(caller_key, 'utf8')), 'hex'), current_date, 1)
  on conflict (subject) do update
     set day = current_date,
         used = case when q.day = current_date then q.used + 1 else 1 end,
         updated_at = now()
  returning q.used into consumed;

  return consumed <= daily_limit;
end;
$$;

comment on function public.consume_recognize_quota(text, integer) is
  'Расходует одно распознавание вызывающего и возвращает, разрешено ли оно. Счёт и решение в одном запросе: врозь два одновременных вызова оба прошли бы лимит.';

/* ------------------------------------------------------------------------------ доступ */

alter table public.recognize_quota enable row level security;

-- Политик нет намеренно: таблицу двигает только функция выше, а её зовёт Edge Function с
-- service-role, которая RLS обходит. Чужой счётчик читать незачем даже своему владельцу —
-- это учётные данные защиты, а не пользовательские (NFR-04).
revoke all on public.recognize_quota from anon, authenticated;

-- Поимённо: прямые гранты Supabase не снимаются через PUBLIC (см. миграцию ledger).
revoke all on function public.consume_recognize_quota(text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_recognize_quota(text, integer) to service_role;
