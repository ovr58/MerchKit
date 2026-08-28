-- Веха M3 «Баллы»: журнал операций и единственная точка изменения баланса.
--
-- Баланс в `profiles` — производная величина (CONTEXT.md «Журнал операций»). Двигать его
-- отдельно от журнала нельзя даже сервером: расхождение между балансом и суммой операций
-- обнаруживается не в момент ошибки, а через месяц и в претензии пользователя. Поэтому
-- точка изменения ровно одна — функция в конце этой миграции.

create table public.ledger (
  id bigint generated always as identity primary key,
  -- Владелец обнуляется, а не каскадится: строка журнала переживает удаление аккаунта
  -- обезличенной (ADR-0009). Отсюда nullable — это штатное состояние, а не порча данных.
  user_id uuid references auth.users (id) on delete set null,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('signup_bonus', 'topup', 'charge', 'refund')),
  idempotency_key text not null unique,
  context jsonb not null default '{}'::jsonb,
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

comment on table public.ledger is
  'Журнал операций с баллами: единственный источник правды о движении. Пишется только функцией public.apply_credit_operation, клиенту доступен на чтение своих строк (NFR-04, NFR-05).';
comment on column public.ledger.user_id is
  'Владелец операции. NULL — аккаунт удалён, строка обезличена и не видна никому, кроме service-role (ADR-0009).';
comment on column public.ledger.delta is
  'Знаковое движение баллов: списание отрицательно, начисление положительно. Ноль запрещён — операция без движения не операция.';
comment on column public.ledger.kind is
  'Вид операции: signup_bonus — стартовые баллы за подтверждение email, topup — пакет пополнения, charge — списание за генерацию, refund — возврат (docs/VISUALS.md V-07).';
comment on column public.ledger.idempotency_key is
  'Ключ события, породившего операцию. Уникален: повторная доставка того же события не двигает баланс дважды (NFR-03). Адреса и прочих персональных данных не содержит — только отпечатки (ADR-0009).';
comment on column public.ledger.context is
  'Подробности операции для разбора и показа: идентификатор пакета, идентификатор генерации. Не участвует в расчётах.';
comment on column public.ledger.balance_after is
  'Баланс после операции. Хранится, а не считается на лету: колонка «Баланс» в истории обязана оставаться верной при любой постраничной выборке.';

-- Индекс под единственный сценарий чтения: своя история, свежие сверху. Он же снимает
-- полный проход по журналу при `on delete set null`, когда удаляется пользователь.
create index ledger_user_created_idx on public.ledger (user_id, created_at desc);

alter table public.ledger enable row level security;

-- Как и у `profiles`: чтение своих строк, политик на запись нет намеренно — пишет
-- service-role, которая RLS обходит.
create policy ledger_select_own
  on public.ledger
  for select
  to authenticated
  using (app.is_owner(user_id));

revoke all on public.ledger from anon, authenticated;
grant select on public.ledger to authenticated;

-- Единственная точка изменения баланса: строка журнала и новый баланс в одной транзакции.
--
-- Живёт в `public`, а не в `app`, по одной причине: PostgREST показывает только схемы из
-- `api.schemas` (`public`, `graphql_public`), а Edge Function вызывает функцию через
-- `rest/v1/rpc`. Доступа это не добавляет — права ниже отданы только service-role.
--
-- Имена параметров нарочно не совпадают с именами колонок: PL/pgSQL подставляет переменные
-- в выражения, и одноимённый параметр превратил бы ссылку на колонку в неоднозначную.
create function public.apply_credit_operation(
  owner_id uuid,
  credits_delta integer,
  operation_kind text,
  operation_key text,
  operation_context jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_balance integer;
  next_balance integer;
begin
  -- Блокировка строки профиля прежде всего остального: два одновременных списания обязаны
  -- выстроиться в очередь, иначе оба прочитают один и тот же баланс и оба сочтут, что
  -- баллов хватает. Она же делает проверку повтора ниже достоверной.
  select balance into current_balance
    from public.profiles
   where id = owner_id
     for update;

  if not found then
    raise exception 'Профиль % не найден: движение баллов без владельца невозможно', owner_id;
  end if;

  -- Повтор доставки события — не ошибка: операция уже учтена, баланс не двигаем (NFR-03).
  -- Проверка стоит ДО проверки достатка баллов намеренно: повторно доставленное списание
  -- не обязано укладываться в остаток, который сам же и обнулило.
  if exists (select 1 from public.ledger where idempotency_key = operation_key) then
    return current_balance;
  end if;

  next_balance := current_balance + credits_delta;

  if next_balance < 0 then
    raise exception 'Недостаточно баллов: на балансе %, требуется %',
      current_balance, - credits_delta
      using errcode = 'check_violation';
  end if;

  -- Уникальный индекс по ключу — последняя защита: проверка выше опирается на блокировку
  -- профиля, индекс не опирается ни на что (NFR-03).
  insert into public.ledger (user_id, delta, kind, idempotency_key, context, balance_after)
  values (owner_id, credits_delta, operation_kind, operation_key, operation_context,
          next_balance);

  update public.profiles set balance = next_balance where id = owner_id;

  return next_balance;
end;
$$;

comment on function public.apply_credit_operation(uuid, integer, text, text, jsonb) is
  'Единственная точка изменения баланса: пишет строку журнала и двигает profiles.balance в одной транзакции. Повторный ключ — не ошибка, а no-op с текущим балансом (NFR-03).';

-- Право выполнения снимается явно и поимённо. `revoke from public` тут НЕ работает:
-- Supabase раздаёт execute на функции схемы `public` прямыми грантами ролям через
-- `alter default privileges`, а не через PUBLIC. Без этих строк `authenticated` дотянулся
-- бы до функции через PostgREST и начислил себе баллов (NFR-05) — проверено тестом
-- `supabase/tests/database/ledger_rls.test.sql`.
revoke all on function public.apply_credit_operation(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_credit_operation(uuid, integer, text, text, jsonb) to service_role;

-- Комментарий M2 «на M2 всегда 0» устарел этой вехой.
comment on column public.profiles.balance is
  'Баллы. Производная величина: меняется только функцией public.apply_credit_operation вместе с записью в ledger (NFR-03, NFR-05).';
