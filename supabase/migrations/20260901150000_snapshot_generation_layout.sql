-- M7 B2: the worker stores its chosen layout as an immutable generation snapshot before any
-- provider call. B7 later fills the deliberately empty content and font map during assembly.

alter table public.card_layouts drop column uses_logo;

drop view public.card_layout_metadata;

create view public.card_layout_metadata
with (security_invoker = on) as
with recursive layers (layout_id, layer) as (
  select l.id, element
    from public.card_layouts l
    cross join lateral jsonb_array_elements(l.layout -> 'layers') as element
  union all
  select layers.layout_id, child
    from layers
    cross join lateral jsonb_array_elements(
      case when layers.layer ->> 'type' = 'group'
        then coalesce(layers.layer -> 'children', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as child
)
select
  l.id,
  count(distinct (layer -> 'bind' ->> 'index')) filter (where layer -> 'bind' ->> 'kind' = 'prop')::integer as prop_slots,
  coalesce(max((coalesce(layer -> 'bind' ->> 'index', '0'))::integer)
    filter (where layer -> 'bind' ->> 'kind' = 'frame') + 1, 0)::integer as frames,
  coalesce(bool_or(layer ->> 'type' = 'cutout'), false) as has_cutout,
  coalesce(bool_or(layer -> 'bind' ->> 'kind' = 'logo'), false) as uses_logo,
  (l.layout #>> '{canvas,aspectW}')::numeric as aspect_w,
  (l.layout #>> '{canvas,aspectH}')::numeric as aspect_h
from public.card_layouts l
left join layers on layers.layout_id = l.id
group by l.id, l.layout;

comment on view public.card_layout_metadata is
  'Производные признаки макета для подбора: ёмкость модулей по уникальным prop-index, frames, cutout, logo и пропорция. Считаются из layout, поэтому не расходятся с ним.';

revoke all on public.card_layout_metadata from anon, authenticated;

create function public.snapshot_generation_layout(
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
  'M7 B2: фиксирует выбранный сервером макет до генерации. Снимок и layout_id не перезаписываются при повторной доставке worker; content/font_map заполнятся на B7.';

revoke all on function public.snapshot_generation_layout(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.snapshot_generation_layout(uuid, text, jsonb) to service_role;
