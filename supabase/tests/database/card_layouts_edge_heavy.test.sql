-- Тяжёлые макеты вне подбора (веха M7, шаг B7.7, решение Q-1).
--
-- Признак по умолчанию выключен, а универсальный макет пометить тяжёлым нельзя: он последний
-- рубеж подбора, и фильтр тяжёлых в запросе не должен оставить подбор без ответа.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_column('public', 'card_layouts', 'edge_heavy', 'У макета есть признак «тяжёлый»');

insert into public.card_layouts (id, title, layout, source) values (
  'test-edge-heavy-layout',
  'Проверка признака тяжёлого макета',
  '{
    "id": "test-edge-heavy-layout",
    "title": "Проверка признака тяжёлого макета",
    "canvas": {"aspectW": 3, "aspectH": 4, "background": {"kind": "solid", "color": "#ffffff"}},
    "layers": []
  }'::jsonb,
  'test'
);

select is(
  (select edge_heavy from public.card_layouts where id = 'test-edge-heavy-layout'),
  false,
  'Новый макет не тяжёлый: в подбор он попадает, пока замер не скажет обратного'
);

select lives_ok(
  $$ update public.card_layouts set edge_heavy = true where id = 'test-edge-heavy-layout' $$,
  'Обычный макет можно пометить тяжёлым'
);

select ok(
  exists (select 1 from public.card_layouts where is_fallback),
  'В библиотеке есть универсальный макет, на котором проверяется ограничение'
);

select throws_ok(
  $$ update public.card_layouts set edge_heavy = true where is_fallback $$,
  '23514',
  null,
  'Универсальный макет не может быть тяжёлым: иначе у подбора нет безопасного ответа'
);

-- Решения B7.7 по замеру в размерах профилей (Q-1, Q-3): список тяжёлых и новый универсальный.

select is(
  (select array_agg(id order by id) from public.card_layouts where is_fallback),
  array['school-shirt-girls-dark'],
  'Универсальный макет — school-shirt-girls-dark, а не тяжёлый dress-summer'
);

select is(
  (select edge_heavy from public.card_layouts where id = 'dress-summer'),
  true,
  'dress-summer не успевает собраться в изоляте и вне подбора'
);

-- Строки tires-formula-ice до первого `cards:layouts push` на стенде нет; после него признак
-- приезжает из рабочей копии. Проверяем, что не обратное: такая строка не может быть лёгкой.
select is(
  (select count(*)::integer from public.card_layouts where id = 'tires-formula-ice' and not edge_heavy),
  0,
  'tires-formula-ice, если он есть в библиотеке, помечен тяжёлым'
);

select * from finish();

rollback;
