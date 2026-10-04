-- M7 B5.8: итоговая правка арт-директора хранится у генерации (ADR-0018, п. 3, «Хранение»).
--
-- Снимок макета (`layout`) не перезаписывается (ADR-0013, B7.4): пересборка получает макет как
-- `applyDirection(снимок, direction)`, а строки гнёзд и иконки — из того же `direction`. Так
-- бесплатная пересборка воспроизводит оплаченную карточку, а снимок остаётся тем, что подобрал
-- подбор.
--
-- Запись — отдельной функцией, а не расширением `record_card_assembly`: эта запись идёт только
-- при непустом патче, и менять сигнатуру сборочной функции ради необязательного поля значило бы
-- тронуть B7.4 без нужды.

alter table public.generation_cards
  add column direction jsonb;

comment on column public.generation_cards.direction is
  'Итоговый патч арт-директора и сдвига, ADR-0018: {boxes, texts, icons}. null — правки не было, ступень 4.';

create or replace function public.record_card_direction(
  target_generation uuid,
  card_direction jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.generation_cards
     set direction = card_direction
   where generation_id = target_generation;

  -- Снимка нет — значит, макет не подбирался и патчу не к чему лечь. Молча проглотить нельзя:
  -- пересборка потом собрала бы другую карточку, чем оплаченная.
  if not found then
    raise exception 'Снимок макета не найден: %', target_generation;
  end if;
end;
$$;

comment on function public.record_card_direction(uuid, jsonb) is
  'M7 B5.8: записывает итоговый патч арт-директора в снимок карточки. Пишет только direction; layout, layout_id и содержимое не меняет. Только service_role.';

revoke all on function public.record_card_direction(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_card_direction(uuid, jsonb) to service_role;
