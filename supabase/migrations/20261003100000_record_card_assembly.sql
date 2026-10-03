-- M7 B7.4: воркер записывает, ИЗ ЧЕГО собрана карточка, — содержимое и карту шрифтов.
--
-- Снимок макета (`layout`, `layout_id`) пишет `snapshot_generation_layout` до вызова
-- провайдера и не перезаписывает при повторной доставке события. Эта функция его не трогает:
-- пересборка (B7.5) обязана собирать по тому макету, который продавец увидел и оплатил, а не
-- по текущей записи библиотеки.
--
-- Содержимое приходит в хранимой форме (`storedContent` в `card-layout/filling.ts`): вместо
-- картинок — адреса в хранилище. Мегабайты data-URI в `jsonb` не пишутся.

create or replace function public.record_card_assembly(
  target_generation uuid,
  assembled_content jsonb,
  assembled_font_map jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.generation_cards
     set content = assembled_content,
         font_map = assembled_font_map,
         assembled_at = now()
   where generation_id = target_generation;

  -- Снимка нет — значит, макет не подбирался, и записывать содержимое не к чему. Молча
  -- проглотить нельзя: пересборка потом не нашла бы, из чего собирать.
  if not found then
    raise exception 'Снимок макета не найден: %', target_generation;
  end if;
end;
$$;

comment on function public.record_card_assembly(uuid, jsonb, jsonb) is
  'M7 B7.4: записывает содержимое сборки (хранимая форма, без data-URI) и карту шрифтов в снимок карточки. Снимок layout/layout_id не меняет. Только service_role.';

revoke all on function public.record_card_assembly(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_card_assembly(uuid, jsonb, jsonb) to service_role;
