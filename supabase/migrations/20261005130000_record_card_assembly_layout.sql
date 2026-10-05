-- B40: повтор доставки события после записанной сборки (NFR-03, ADR-0019 п. 6).
--
-- Воркер переигрывает генерацию в статусе `running` целиком. Пока сочинение писалось отдельной
-- функцией `record_card_authored` до `record_card_assembly`, повтор расходился с записанным: при
-- собранном снимке сочинение отказывало («уже собран») и генерация падала с возвратом, а откат на
-- библиотеку оставлял снимок `origin = author` с содержимым библиотеки.
--
-- Теперь макет, по которому собрано, его происхождение и содержимое пишутся одной записью
-- `record_card_assembly`: повтор перезаписывает их вместе и всегда согласованно. До
-- `finish_generation` карточка продавцу не отдана, перезапись снимка ничего оплаченного не
-- меняет. Без макета (пересборка, B5.9 — она собирает по снимку) снимок и происхождение не
-- трогаются, как раньше. `layout_id` по-прежнему называет макет подбора — макет отката.
--
-- Сигнатура меняется, поэтому старая снимается: иначе вызов тремя именованными аргументами был бы
-- неоднозначен между двумя перегрузками. Новые параметры — со значением по умолчанию, и прежний
-- вызов (пересборка; воркер, задеплоенный до этой миграции) проходит как есть.
-- `record_card_authored` остаётся для воркера, задеплоенного до этой миграции; новый её не зовёт.

drop function public.record_card_assembly(uuid, jsonb, jsonb);

create function public.record_card_assembly(
  target_generation uuid,
  assembled_content jsonb,
  assembled_font_map jsonb,
  assembled_layout jsonb default null,
  assembled_origin text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (assembled_layout is null) <> (assembled_origin is null) then
    raise exception 'Макет и происхождение снимка пишутся вместе: %', target_generation;
  end if;

  update public.generation_cards
     set content = assembled_content,
         font_map = assembled_font_map,
         layout = coalesce(assembled_layout, layout),
         origin = coalesce(assembled_origin, origin),
         assembled_at = now()
   where generation_id = target_generation;

  -- Снимка нет — значит, макет не подбирался, и записывать содержимое не к чему. Молча
  -- проглотить нельзя: пересборка потом не нашла бы, из чего собирать.
  if not found then
    raise exception 'Снимок макета не найден: %', target_generation;
  end if;
end;
$$;

comment on function public.record_card_assembly(uuid, jsonb, jsonb, jsonb, text) is
  'B7.4, B40: содержимое и карта шрифтов собранной карточки; с макетом — и снимок с происхождением (library | author) той же записью, повтор доставки перезаписывает их вместе. Без макета снимок не трогает (пересборка). Только service_role.';

revoke all on function public.record_card_assembly(uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_card_assembly(uuid, jsonb, jsonb, jsonb, text) to service_role;
