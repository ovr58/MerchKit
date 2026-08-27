-- Веха M2 «Аккаунт»: первая доменная таблица и первая RLS-политика проекта.
-- RLS включается здесь же, в миграции, создающей таблицу — сквозное правило генплана.

-- Единая функция условия доступа (docs/SPEC.md §4). Политики ссылаются на неё, а не
-- повторяют условие текстом: ролей сейчас нет, появятся — правка будет в одном месте,
-- а не в каждой политике каждой таблицы.
--
-- `security invoker` — намеренно: функция обязана видеть `auth.uid()` вызывающего.
-- `search_path = ''` закрывает подмену схемы, поэтому имена внутри полные.
create function app.is_owner(record_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select auth.uid()) = record_owner
$$;

comment on function app.is_owner(uuid) is
  'Единственное условие доступа к пользовательским строкам: владелец — текущая сессия.';

-- Профиль пользователя. Email и дата регистрации живут в `auth.users` и не дублируются:
-- вторая копия расходится с первой. Здесь только то, чего в Auth нет — баланс.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0)
);

comment on table public.profiles is
  'Баланс баллов пользователя. Меняется только Edge Function с service-role и только вместе с записью в ledger (веха M3, NFR-05).';
comment on column public.profiles.balance is
  'Баллы. На M2 всегда 0: начисление стартовых баллов требует журнала операций и приезжает на M3.';

alter table public.profiles enable row level security;

-- Клиенту — только чтение своей строки. Политик на запись нет намеренно: любое движение
-- баланса пойдёт через service-role, которая RLS обходит (NFR-05).
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (app.is_owner(id));

-- Права уровня таблицы дублируют то же намерение: RLS фильтрует строки, гранты — операции.
-- Без явного revoke таблица унаследовала бы права по умолчанию, выданные Supabase.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

grant usage on schema app to authenticated;
grant execute on function app.is_owner(uuid) to authenticated;

-- Профиль заводит триггер, а не клиент: иначе клиент решал бы, с каким балансом появиться.
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Заводит профиль на каждого нового пользователя Auth. security definer — таблица клиенту на запись закрыта.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function app.handle_new_user();
