-- M7 B2: a layout snapshot belongs only to a card generation. Photo generations do not enter
-- the card assembly pipeline and must not depend on the layout library.

create or replace function public.snapshot_generation_layout(
  target_generation uuid,
  selected_layout text,
  selected_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select kind from public.generations where id = target_generation) is distinct from 'card' then
    raise exception 'Снимок макета допустим только для генерации карточки: %', target_generation;
  end if;

  if not exists (select 1 from public.card_layouts where id = selected_layout) then
    raise exception 'Макет не найден: %', selected_layout;
  end if;

  if selected_snapshot ->> 'id' is distinct from selected_layout then
    raise exception 'Снимок макета не соответствует выбранному макету: %', selected_layout;
  end if;

  insert into public.generation_cards (generation_id, layout_id, layout, content, font_map)
  values (
    target_generation,
    selected_layout,
    selected_snapshot,
    '{"texts": {}, "props": [], "swatches": []}'::jsonb,
    '{}'::jsonb
  )
  on conflict (generation_id) do nothing;
end;
$$;

comment on function public.snapshot_generation_layout(uuid, text, jsonb) is
  'M7 B2: фиксирует выбранный сервером макет только у генерации карточки до вызова провайдера. Снимок и layout_id не перезаписываются при повторной доставке worker; content/font_map заполнятся на B7.';
