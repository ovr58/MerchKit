import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'

import { describeAuthError, MESSAGES, type AuthFailure } from './messages'

/**
 * Операции аккаунта. Единственное место в приложении, которое вызывает `supabase.auth`:
 * экраны получают уже разобранный результат и не знают ни кодов ошибок, ни устройства
 * сессии (docs/SPEC.md §3).
 */

export type AuthOutcome = { ok: true } | ({ ok: false } & AuthFailure)

const ok: AuthOutcome = { ok: true }

function fail(failure: AuthFailure): AuthOutcome {
  return { ok: false, ...failure }
}

/**
 * Куда возвращает ссылка из письма. Адреса перечислены в `additional_redirect_urls`
 * (`supabase/config.toml`) — Supabase пускает редирект только на точное совпадение.
 */
function returnUrl(path: string): string {
  return new URL(path, window.location.origin).toString()
}

export async function signUp(email: string, password: string): Promise<AuthOutcome> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: returnUrl('/auth/callback') },
  })

  if (error) {
    logger.warn('Регистрация отклонена', { reason: error.code })
    return fail(describeAuthError(error))
  }

  // Занятый адрес Supabase ошибкой не возвращает — он отдаёт пользователя с пустым
  // списком identity, чтобы посторонний не мог перебором узнать, кто зарегистрирован.
  // Это единственный признак, по которому занятый email отличим от нового, а показать
  // его требует критерий US-02.
  if (data.user && data.user.identities?.length === 0) {
    return fail({ message: MESSAGES.emailTaken, field: 'email' })
  }

  logger.info('Регистрация принята, отправлено письмо подтверждения')
  return ok
}

export async function signIn(email: string, password: string): Promise<AuthOutcome> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    logger.info('Вход отклонён', { reason: error.code })
    return fail(describeAuthError(error))
  }

  logger.info('Вход выполнен')
  return ok
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  logger.info('Выход выполнен')
}

/**
 * Повторная отправка письма подтверждения. Идёт по адресу, а не по текущему пользователю:
 * до подтверждения сессии не существует (ADR-0008).
 */
export async function resendConfirmation(email: string): Promise<AuthOutcome> {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: returnUrl('/auth/callback') },
  })

  if (error) {
    logger.warn('Повторное письмо не отправлено', { reason: error.code })
    return fail(describeAuthError(error))
  }

  return ok
}

/**
 * Запрос восстановления пароля.
 *
 * **Всегда завершается одинаково** — US-E7: ответ не должен отличаться в зависимости от
 * того, есть ли такой аккаунт. Разный ответ — это способ проверить чужой email на
 * регистрацию, поэтому наружу не уходит даже «слишком часто»: реальная причина остаётся
 * в логе. Единственный видимый исход — экран «письмо отправлено».
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: returnUrl('/reset/new'),
  })

  if (error) {
    logger.warn('Письмо восстановления не ушло; пользователю показан нейтральный ответ', {
      reason: error.code,
    })
  }
}

export async function updatePassword(password: string): Promise<AuthOutcome> {
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    logger.warn('Смена пароля отклонена', { reason: error.code })
    return fail(describeAuthError(error))
  }

  logger.info('Пароль изменён')
  return ok
}
