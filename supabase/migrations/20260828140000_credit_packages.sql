-- Веха M3, FR-23 / US-05: пакеты пополнения. Эквайринга в этой версии нет сознательно —
-- баллы зачисляются мгновенно и бесплатно (B4 в planning/BACKLOG.md).

-- Справочник заводится миграцией, а не админкой: ролей в проекте нет (docs/SPEC.md §4).
create table public.credit_packages (
  id text primary key,
  title text not null,
  credits integer not null check (credits > 0),
  price_rub integer not null check (price_rub > 0),
  is_featured boolean not null default false,
  sort_order integer not null
);

comment on table public.credit_packages is
  'Пакеты пополнения баланса. Номинал берётся отсюда, а не из запроса клиента: иначе клиент назначал бы себе сумму (FR-23).';
comment on column public.credit_packages.is_featured is
  'Выделенный пакет: на артборде D1 «Профиль» — подпись «Выгоднее» и зелёная карточка. Текст подписи живёт в интерфейсе, здесь только признак.';
comment on column public.credit_packages.price_rub is
  'Номинальная цена в рублях. Ничего не списывает: платёжных шагов в этой версии нет.';

-- Цифры утверждены пользователем 2026-08-27 (docs/TZ.md §11, docs/VISUALS.md V-09).
-- Меняются — правятся вместе с TZ и артбордами, в одном изменении.
insert into public.credit_packages (id, title, credits, price_rub, is_featured, sort_order)
values
  ('start',    'Старт',    300,   390, false, 1),
  ('standard', 'Стандарт', 1000, 1090, true,  2),
  ('pro',      'Про',      3000, 2030, false, 3);

alter table public.credit_packages enable row level security;

-- Справочник, а не пользовательские данные: своего владельца у строки нет, поэтому
-- `app.is_owner` здесь неприменима и условие честно написано как «всем вошедшим».
create policy credit_packages_select_all
  on public.credit_packages
  for select
  to authenticated
  using (true);

revoke all on public.credit_packages from anon, authenticated;
grant select on public.credit_packages to authenticated;

-- Пополнение. Номинал читается из справочника по идентификатору пакета — тело запроса
-- влияет только на то, КАКОЙ пакет, но не на то, СКОЛЬКО баллов.
create function public.topup_balance(
  owner_id uuid,
  package_id text,
  operation_key text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen public.credit_packages;
begin
  select * into chosen from public.credit_packages where id = package_id;

  if not found then
    raise exception 'Неизвестный пакет пополнения: %', package_id;
  end if;

  -- Очередь из кликов — одно намерение, даже если клиент прислал разные ключи попытки.
  --
  -- Ключ идемпотентности закрывает повторную ДОСТАВКУ одного вызова, но не второй клик по
  -- кнопке: клиент ротирует ключ после успеха, и для сервера такой клик неотличим от новой
  -- покупки. Найдено проверкой Playwright 2026-08-28 — два клика с разницей 122 мс зачислили
  -- пакет дважды. Городить защиту на клиенте бессмысленно: любая схема, где клик может
  -- сменить ключ, ломается вторым кликом. Здесь окно короткое и серверное.
  --
  -- Второй клик внутри окна отвечает текущим балансом, а не ошибкой: для человека двойной
  -- клик обязан выглядеть как одна удачная покупка. Цена решения: кто действительно хочет
  -- два одинаковых пакета подряд, получит один и повторит через несколько секунд —
  -- баланс на экране покажет ему ровно то, что зачислено.
  if exists (
    select 1 from public.ledger
     where user_id = owner_id
       and kind = 'topup'
       and context->>'package_id' = chosen.id
       and created_at > now() - interval '10 seconds'
  ) then
    return (select balance from public.profiles where id = owner_id);
  end if;

  -- Ключ приходит снаружи и относится к попытке пополнения: повторная доставка того же
  -- вызова не зачисляет второй раз (NFR-03).
  return public.apply_credit_operation(
    owner_id,
    chosen.credits,
    'topup',
    'topup:' || operation_key,
    jsonb_build_object('package_id', chosen.id, 'price_rub', chosen.price_rub)
  );
end;
$$;

comment on function public.topup_balance(uuid, text, text) is
  'Зачисляет пакет пополнения по его идентификатору. Номинал — из справочника, не из запроса (FR-23).';

-- Поимённо: прямые гранты Supabase не снимаются через PUBLIC (см. миграцию ledger).
revoke all on function public.topup_balance(uuid, text, text) from public, anon, authenticated;
grant execute on function public.topup_balance(uuid, text, text) to service_role;
