-- Шаг C3 плана html-layout-authoring_2026-10-05: происхождение снимка карточки (ADR-0019, п. 6,
-- «Снимок»).
--
-- В `generation_cards.layout` хранится то, что реально собиралось (ADR-0013, п. 5): при
-- принятом сочинении — транспилированный макет с пометкой `author`, при откате и без сочинения —
-- макет библиотеки с пометкой `library`. `layout_id` по-прежнему называет макет, выбранный
-- подбором: он и есть макет отката.
--
-- Запись сочинения — отдельной функцией, по образцу `record_card_direction`: она идёт только при
-- принятом сочинении, а `snapshot_generation_layout` и `record_card_assembly` остаются как были.
-- Пишет до сборки: снимок, по которому карточка уже собрана, не перезаписывается — пересборка
-- обязана собирать по оплаченному. «Собрана» — в содержимом есть кадры (`record_card_assembly`
-- пишет их; тот же признак у пересборки, `isRebuildable`): `assembled_at` для этого не годится,
-- он заполнен с момента снимка.

alter table public.generation_cards
  add column origin text not null default 'library'
    check (origin in ('library', 'author'));

comment on column public.generation_cards.origin is
  'Происхождение снимка layout, ADR-0019 п. 6: library — макет библиотеки (без сочинения или откат), author — транспилированное сочинение карточки.';

create function public.record_card_authored(
  target_generation uuid,
  authored_layout jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.generation_cards
     set layout = authored_layout,
         origin = 'author'
   where generation_id = target_generation
     and not (content ? 'frames');

  -- Снимка нет — макет не подбирался; снимок уже собран — перезапись разошлась бы с оплаченной
  -- карточкой. Ни то ни другое молча не проглатывается.
  if not found then
    raise exception 'Снимок макета не найден или уже собран: %', target_generation;
  end if;
end;
$$;

comment on function public.record_card_authored(uuid, jsonb) is
  'C3 (ADR-0019 п. 6): записывает принятое сочинение — транспилированный макет в снимок и origin = author — до сборки. layout_id не меняет. Только service_role.';

revoke all on function public.record_card_authored(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_card_authored(uuid, jsonb) to service_role;
