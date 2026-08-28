/**
 * Тексты модуля `auth` и перевод ошибок Supabase на язык артбордов D1.
 *
 * Зачем отдельный файл: сообщения — часть утверждённого дизайна, а не деталь реализации.
 * Ошибки Supabase приходят англоязычными кодами (`invalid_credentials`,
 * `email_not_confirmed`), и показывать их человеку нельзя. Соответствие кода и текста
 * держится в одном месте, чтобы его можно было проверить тестом целиком.
 */

/** Поле формы, к которому относится ошибка. `null` — ошибка всей формы. */
export type AuthErrorField = 'email' | 'password' | 'passwordConfirm' | 'currentPassword' | null

export type AuthFailure = {
  message: string
  field: AuthErrorField
}

export const MESSAGES = {
  invalidCredentials:
    'Неверный email или пароль. Проверьте раскладку и регистр — или восстановите пароль.',
  emailNotConfirmed:
    'Email ещё не подтверждён. Перейдите по ссылке из письма — без этого вход недоступен.',
  emailTaken: 'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
  emailSendRateLimit:
    'Письмо уже отправлено. Следующее можно запросить через минуту — проверьте «Спам» и «Промоакции».',
  requestRateLimit: 'Слишком много попыток подряд. Подождите немного и попробуйте снова.',
  weakPassword: 'Пароль слишком короткий — нужно минимум 8 символов.',
  samePassword: 'Новый пароль совпадает с текущим. Придумайте другой.',
  currentPasswordWrong: 'Текущий пароль указан неверно',
  passwordChanged: 'Пароль изменён',
  passwordMismatch: 'Подтверждение не совпадает с паролем',
  emailRequired: 'Укажите email',
  emailMalformed: 'Похоже, в адресе опечатка',
  passwordRequired: 'Укажите пароль',
  passwordTooShort: 'Минимум 8 символов',
  accountDeleteFailed: 'Не удалось удалить аккаунт. Попробуйте ещё раз через минуту.',
  recoveryLinkExpired:
    'Ссылка недействительна или истекла. Запросите восстановление пароля заново.',
  unknown: 'Не получилось выполнить запрос. Попробуйте ещё раз через минуту.',
} as const

/**
 * Коды Supabase Auth, у которых есть осмысленный ответ для человека. Всё остальное
 * сваливается в `unknown`: показывать пользователю внутренний код бессмысленно, а гадать
 * по тексту ошибки — способ однажды показать ему английскую фразу из чужой библиотеки.
 */
const BY_CODE: Record<string, AuthFailure> = {
  invalid_credentials: { message: MESSAGES.invalidCredentials, field: null },
  email_not_confirmed: { message: MESSAGES.emailNotConfirmed, field: null },
  user_already_exists: { message: MESSAGES.emailTaken, field: 'email' },
  email_exists: { message: MESSAGES.emailTaken, field: 'email' },
  over_email_send_rate_limit: { message: MESSAGES.emailSendRateLimit, field: null },
  over_request_rate_limit: { message: MESSAGES.requestRateLimit, field: null },
  weak_password: { message: MESSAGES.weakPassword, field: 'password' },
  same_password: { message: MESSAGES.samePassword, field: 'password' },
}

export function describeAuthError(error: { code?: string } | null | undefined): AuthFailure {
  const known = error?.code ? BY_CODE[error.code] : undefined
  return known ?? { message: MESSAGES.unknown, field: null }
}

/** Минимум 8 символов — то же число, что стоит в `supabase/config.toml`. */
export const MIN_PASSWORD_LENGTH = 8

export function validateEmail(email: string): string | null {
  const value = email.trim()
  if (value === '') return MESSAGES.emailRequired
  // Проверка намеренно грубая: настоящую валидность адреса подтверждает только письмо,
  // а строгий шаблон отсекает живые адреса чаще, чем ловит опечатки.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return MESSAGES.emailMalformed
  return null
}

export function validatePassword(password: string): string | null {
  if (password === '') return MESSAGES.passwordRequired
  if (password.length < MIN_PASSWORD_LENGTH) return MESSAGES.passwordTooShort
  return null
}

export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  return password === confirmation ? null : MESSAGES.passwordMismatch
}
