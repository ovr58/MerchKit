-- Веха M3, шаг 5: контракт списания и возврата по docs/VISUALS.md V-07.
--
-- Потребителя ещё нет — генерация приезжает на M4. Контракт пишется до него сознательно:
-- журнал, спроектированный без потребителя, не переделаешь, когда на нём уже висят реальные
-- операции (риск генплана). Ключ идемпотентности строится из идентификатора генерации,
-- поэтому повторная доставка одного события статуса не двигает баланс дважды (NFR-03).
--
-- Внешнего ключа на `generations` здесь нет и быть не может: таблицы ещё не существует.
-- Она появится на M4 — тогда же появится и ссылка.

create function public.charge_for_generation(
  owner_id uuid,
  generation_id uuid,
  price integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if price <= 0 then
    raise exception 'Списание за генерацию % должно быть положительным, получено %',
      generation_id, price;
  end if;

  -- V-07: заявка принята → статус `queued` → баллы списаны. Один ключ на генерацию:
  -- сколько бы раз событие ни доставили, списание одно.
  return public.apply_credit_operation(
    owner_id,
    - price,
    'charge',
    'generation:' || generation_id || ':charge',
    jsonb_build_object('generation_id', generation_id)
  );
end;
$$;

comment on function public.charge_for_generation(uuid, uuid, integer) is
  'Списание за генерацию (V-07, статус queued). Цену считает сервер: клиентская цена справочная (docs/SPEC.md §3).';

create function public.refund_for_generation(
  owner_id uuid,
  generation_id uuid,
  amount integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  charged integer;
begin
  -- Возврат опирается на журнал, а не на слово вызывающего: вернуть больше, чем списали,
  -- значит напечатать баллы из воздуха. Ошибка в воркере M4 не должна этого мочь.
  select - delta into charged
    from public.ledger
   where idempotency_key = 'generation:' || generation_id || ':charge';

  if not found then
    raise exception 'Возврат по генерации % без списания', generation_id;
  end if;

  if amount <= 0 or amount > charged then
    raise exception 'Возврат по генерации % вне границ списания: списано %, просят %',
      generation_id, charged, amount;
  end if;

  -- V-07: `failed` — полный возврат, `partial` — возврат за неполученные объекты.
  -- Возврат на генерацию один: частичный и полный различаются суммой, а не числом событий.
  return public.apply_credit_operation(
    owner_id,
    amount,
    'refund',
    'generation:' || generation_id || ':refund',
    jsonb_build_object('generation_id', generation_id, 'charged', charged)
  );
end;
$$;

comment on function public.refund_for_generation(uuid, uuid, integer) is
  'Возврат за генерацию (V-07: failed — полностью, partial — за неполученные объекты). Больше списанного не вернёт.';

-- Поимённо: прямые гранты Supabase не снимаются через PUBLIC (см. миграцию ledger).
revoke all on function public.charge_for_generation(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.refund_for_generation(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.charge_for_generation(uuid, uuid, integer) to service_role;
grant execute on function public.refund_for_generation(uuid, uuid, integer) to service_role;
