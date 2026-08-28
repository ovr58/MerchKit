-- Веха M3, FR-19: 120 стартовых баллов за подтверждение email.
--
-- Ловится триггером на `auth.users`, а не вызовом из браузера: начисление обязано пережить
-- то, что человек закроет вкладку сразу после перехода по ссылке (NFR-05). Хука «email
-- подтверждён» у Supabase нет, а переход `email_confirmed_at` из NULL в дату — это и есть
-- подтверждение, внутри той же транзакции.

-- Нормализация адреса. Плюс-адресация Gmail (`ящик+любое@`) и игнорирование точек дают
-- одному почтовому ящику неограниченное число «разных» адресов, каждый со своими 120
-- баллами — проверено на живом стейдже 2026-08-28.
--
-- Точки и `+` вырезаются ТОЛЬКО у Gmail/Googlemail. У остальных провайдеров точка в
-- локальной части значима, а `+` — допустимый по RFC 5322 символ, который у кого-то
-- означает отдельный ящик: вырезать его везде значит отобрать стартовые баллы у живого
-- человека. Чего это не закрывает: несколько настоящих ящиков, одноразовую почту и
-- плюс-адресацию у других провайдеров — против них помогает только более дорогой признак
-- (телефон, оплата), и это отдельное решение.
--
-- Разделитель ищется по ПОСЛЕДНЕЙ `@`: в локальной части она допустима в кавычках.
create function app.normalize_email(address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when parts.mail_domain in ('gmail.com', 'googlemail.com')
      then replace(split_part(parts.local_part, '+', 1), '.', '') || '@gmail.com'
    else parts.local_part || '@' || parts.mail_domain
  end
  from (
    select lower(regexp_replace(address, '@[^@]*$', '')) as local_part,
           lower(regexp_replace(address, '^.*@', '')) as mail_domain
  ) as parts
$$;

comment on function app.normalize_email(text) is
  'Приводит почтовый адрес к виду, в котором один ящик — одна строка: нижний регистр, а у Gmail/Googlemail ещё и без точек и без хвоста от «+».';

-- Ключ начисления — отпечаток нормализованного адреса, а не сам адрес: строка журнала
-- переживает удаление аккаунта, и адрес в ней пережил бы отзыв согласия (ADR-0009).
-- `sha256` встроена в Postgres, расширения не требует.
create function app.signup_bonus_key(address text)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'signup:' || encode(sha256(convert_to(app.normalize_email(address), 'utf8')), 'hex')
$$;

comment on function app.signup_bonus_key(text) is
  'Ключ идемпотентности стартовых баллов: один почтовый ящик — один ключ — одно начисление за всю историю (NFR-03, ADR-0009).';

create function app.grant_signup_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Адрес может отсутствовать (вход по телефону выключен, но выключается он настройкой,
  -- а не схемой). Без адреса ключа не построить — и начислять не за что.
  if new.email is null then
    return new;
  end if;

  -- N = 120 утверждено пользователем 2026-08-27, docs/TZ.md §11. Число живёт здесь одно:
  -- клиент показывает фактический баланс, а не свою копию номинала.
  perform public.apply_credit_operation(
    new.id, 120, 'signup_bonus', app.signup_bonus_key(new.email)
  );

  return new;
end;
$$;

comment on function app.grant_signup_bonus() is
  'Начисляет стартовые баллы в транзакции подтверждения email (FR-19). Ошибку не глотает: потерянное начисление обнаружится только в претензии, упавшее подтверждение — сразу.';

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function app.grant_signup_bonus();

-- Второй путь к тому же состоянию: администратор заводит пользователя сразу подтверждённым
-- через Studio (ролей в проекте нет, администрирование идёт там — docs/SPEC.md §4). Тогда
-- `email_confirmed_at` появляется при INSERT и триггер выше не срабатывает.
--
-- Имя выбрано так, чтобы этот триггер шёл ПОСЛЕ `on_auth_user_created`: триггеры одного
-- события выполняются в алфавитном порядке, а начислять баллы в профиль, которого ещё нет,
-- нельзя.
create trigger on_auth_user_created_confirmed
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function app.grant_signup_bonus();

-- Кто подтвердил email до этой миграции, триггером уже не пройдёт и остался бы с нулём
-- навсегда. Догоняем разово; повтор безопасен — ключ тот же, что построит триггер.
do $$
declare
  confirmed record;
begin
  for confirmed in
    select id, email from auth.users
     where email_confirmed_at is not null and email is not null
  loop
    perform public.apply_credit_operation(
      confirmed.id, 120, 'signup_bonus', app.signup_bonus_key(confirmed.email)
    );
  end loop;
end;
$$;
