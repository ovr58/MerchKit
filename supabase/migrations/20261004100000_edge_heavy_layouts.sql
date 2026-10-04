-- Веха M7, шаг B7.7 (решения Q-1 и Q-3, 2026-10-04): список тяжёлых макетов и новый
-- универсальный макет.
--
-- Замер в размерах профилей площадок (`cards:bench -- assemble --size WxH`, три прогона,
-- 896×1200 и 1024×1024): `tires-formula-ice` не собирается в изоляте никогда, `dress-summer`
-- — в одном-двух прогонах из трёх, с запасом 25–290 мс. Остальные 32 макета укладываются
-- с запасом от 634 мс. Оба выпадают из подбора (`edge_heavy`), пока сборка не переехала на
-- коробку (ADR-0015); снять — одной миграцией.
--
-- `dress-summer` был универсальным, а универсальный макет тяжёлым быть не может (`check` из
-- 20261003130000): он последний рубеж подбора. Решение Q-3: универсальным становится
-- почищенный `school-shirt-girls-dark` (без вшитой плашки с назначением товара).

-- Как и `dress-summer` в 20260901120000: до первого `cards:layouts push` на пустой стенд
-- нужен исполнимый универсальный макет. Полный разбор вернёт push; на стенде с готовой
-- библиотекой строка уже есть, и `on conflict` её не трогает.
insert into public.card_layouts (id, title, layout, source, is_fallback) values
  ('school-shirt-girls-dark',
   'Школьная рубашка: тёмный фон, крупный заголовок и колонка круглых модулей слева, фото манекена справа',
   jsonb_build_object(
     'id', 'school-shirt-girls-dark',
     'title', 'Школьная рубашка: тёмный фон, крупный заголовок и колонка круглых модулей слева, фото манекена справа',
     'canvas', jsonb_build_object(
       'aspectW', 631,
       'aspectH', 842,
       'background', jsonb_build_object('kind', 'solid', 'color', '#2f2f32')
     ),
     'layers', jsonb_build_array(
       jsonb_build_object(
         'id', 'frame',
         'type', 'frame',
         'z', 0,
         'box', jsonb_build_object('x', 0, 'y', 0, 'w', 1, 'h', 1),
         'fit', 'cover',
         'bind', jsonb_build_object('kind', 'frame')
       )
     )
   ),
   'tools/card-pipeline/samples/wb-173200.json',
   false)
on conflict (id) do nothing;

-- Сначала снять признак со старого универсального макета: индекс «универсальный один»
-- не терпит двух сразу.
update public.card_layouts
   set is_fallback = false
 where is_fallback and id <> 'school-shirt-girls-dark';

update public.card_layouts
   set is_fallback = true
 where id = 'school-shirt-girls-dark';

update public.card_layouts
   set edge_heavy = true
 where id in ('dress-summer', 'tires-formula-ice');
