-- Форма кадра у нового профиля объявляется, а не достаётся по умолчанию.
--
-- Миграция 20260829140000 добавляла `aspect_w`/`aspect_h`/`formats` к таблице, где строки
-- уже лежали, — без `default` этого было не сделать. Дефолты она сняла с `min_width` и
-- `min_height`, а с этих трёх нет: недосмотр, найденный ревью Sonnet-хвоста вехи M5.
--
-- Почему это не придирка. Дефолт здесь — `3 : 4` и `{jpeg}`, то есть «вертикальный кадр,
-- только JPEG». Профиль, заведённый без этих колонок (следующая площадка, квадратная
-- категория), молча объявит себя таким и разойдётся с действительностью не в базе, а в
-- рантайме: `describeProfileMismatch` отвергнет уже сгенерированный файл — ПОСЛЕ оплаты
-- вызова вендору. Ровно тот класс ошибки, который 20260829140000 и чинила.
--
-- `max_bytes` дефолт сохраняет намеренно: 10 МБ — не догадка про конкретную площадку, а
-- одно и то же число у всех трёх (planning/reference/MARKETPLACE_IMAGE_REQUIREMENTS.md),
-- и ошибиться им нельзя так, как ошибаются соотношением сторон.

alter table public.marketplace_profiles alter column aspect_w drop default;
alter table public.marketplace_profiles alter column aspect_h drop default;
alter table public.marketplace_profiles alter column formats drop default;

comment on column public.marketplace_profiles.aspect_w is
  'Числитель соотношения сторон, которого требует площадка. Задаётся явно у каждого профиля: без default, чтобы новая пара не унаследовала молча 3 : 4.';
comment on column public.marketplace_profiles.aspect_h is
  'Знаменатель соотношения сторон. См. aspect_w — задаётся явно по той же причине.';
