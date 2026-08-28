/**
 * Публичный интерфейс модуля `auth` (docs/SPEC.md §3): операции аккаунта, текущая сессия
 * и гварды маршрутов. Всё остальное — работа с Supabase Auth, хранение сессии, коды
 * ошибок, адреса возврата из писем — остаётся внутри модуля.
 */

export {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signOut,
  signUp,
  updatePassword,
  type AuthOutcome,
} from './api'
export { RequireAnon, RequireAuth } from './guards'
export {
  MESSAGES,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from './messages'
export { SessionProvider } from './session'
export { useSession } from './session-context'
