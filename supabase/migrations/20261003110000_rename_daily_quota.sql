-- Переименование счётчика квоты: `recognize_quota` → `daily_quota`.
--
-- **Зачем.** Механизм из `20260829130000_recognize_quota.sql` считает и решает одним запросом,
-- поэтому потолок превью (`card-preview`) переиспользовал его же с другим префиксом ключа
-- (`preview:user:<id>`), а не завёл вторую такую же таблицу. Имя осталось по первой операции,
-- а считает таблица любые бесплатные операции вызывающего за сутки. Старая миграция уже
-- применена и не правится — переименование отдельным шагом.
--
-- Данные, RLS и гранты таблицы переезжают вместе с объектом: `alter ... rename` их не трогает.
-- Исключение — тело функции: PL/pgSQL хранит текст, и ссылка на таблицу по старому имени
-- после переименования сломалась бы, поэтому функция пересоздаётся под новым именем.

alter table public.recognize_quota rename to daily_quota;

alter table public.daily_quota rename constraint recognize_quota_pkey to daily_quota_pkey;
alter table public.daily_quota rename constraint recognize_quota_used_check to daily_quota_used_check;

comment on table public.daily_quota is
  'Счётчик бесплатных операций на вызывающего за сутки (распознавание, превью карточки). Одна строка на ключ вызывающего: она переиспользуется каждый день, а не копится по дате. Операции различаются префиксом ключа до хеширования.';
comment on column public.daily_quota.subject is
  'Отпечаток ключа вызывающего — sha256 от «user:<id>», «addr:<адрес>» или «preview:user:<id>». Ни адреса, ни идентификатора в открытом виде тут нет (ADR-0009).';
comment on column public.daily_quota.used is
  'Сколько операций вызывающий израсходовал за эти сутки. Растёт и после исчерпания лимита: иначе счётчик сбрасывался бы сам собой у того, кто в него упёрся.';

drop function public.consume_recognize_quota(text, integer);

/**
 * Расходует одну операцию и отвечает, можно ли её выполнять.
 *
 * Счёт и решение — одним запросом: разнеси их, и два одновременных вызова оба увидели бы
 * «лимит не исчерпан». Именно так квоты и обходят. Какая это операция, решает префикс ключа:
 * у разных операций счета раздельные.
 */
create function public.consume_daily_quota(caller_key text, daily_limit integer)
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
  -- неоднозначную.
  if daily_limit <= 0 then
    raise exception 'Суточный лимит должен быть положительным, получено %', daily_limit;
  end if;

  insert into public.daily_quota as q (subject, day, used)
  values (encode(sha256(convert_to(caller_key, 'utf8')), 'hex'), current_date, 1)
  on conflict (subject) do update
     set day = current_date,
         used = case when q.day = current_date then q.used + 1 else 1 end,
         updated_at = now()
  returning q.used into consumed;

  return consumed <= daily_limit;
end;
$$;

comment on function public.consume_daily_quota(text, integer) is
  'Расходует одну бесплатную операцию вызывающего и возвращает, разрешена ли она. Счёт и решение в одном запросе: врозь два одновременных вызова оба прошли бы лимит. Операции различаются префиксом ключа.';

-- RLS остаётся включённым на переименованной таблице, политик по-прежнему нет. Права новой
-- функции заводятся заново, как в исходной миграции: поимённо, потому что прямые гранты
-- Supabase через PUBLIC не снимаются.
revoke all on function public.consume_daily_quota(text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_daily_quota(text, integer) to service_role;
