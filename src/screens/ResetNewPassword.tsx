import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import {
  MESSAGES,
  updatePassword,
  useSession,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth'

/**
 * Артборд D1 «Новый пароль» — куда приводит ссылка из письма восстановления.
 *
 * Маршрут намеренно не под гвардом гостя: переход по ссылке уже создал сессию, и
 * `RequireAnon` развернул бы человека в профиль, не дав сменить пароль. Признак, что
 * ссылка рабочая, — как раз наличие сессии.
 */
export default function ResetNewPassword() {
  const navigate = useNavigate()
  const { loading, session } = useSession()

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const passwordProblem = validatePassword(password)
    const confirmationProblem = validatePasswordConfirmation(password, confirmation)
    setPasswordError(passwordProblem)
    setConfirmationError(confirmationProblem)
    setFormError(null)
    if (passwordProblem || confirmationProblem) return

    setBusy(true)
    const result = await updatePassword(password)
    setBusy(false)

    if (!result.ok) {
      if (result.field === 'password') setPasswordError(result.message)
      else setFormError(result.message)
      return
    }

    void navigate('/profile', { replace: true })
  }

  return (
    <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Вспомнили пароль?">
      <AuthHeading
        description="Придумайте новый пароль. Старый перестанет работать сразу после сохранения."
        title="Новый пароль"
      />

      {!loading && !session ? (
        <>
          <Callout>{MESSAGES.recoveryLinkExpired}</Callout>
          <Button asChild className="w-full" size="lg" variant="outline">
            <Link to="/reset">Запросить ссылку заново</Link>
          </Button>
        </>
      ) : (
        <>
          {formError && <Callout>{formError}</Callout>}

          <form
            className="flex flex-col gap-5"
            noValidate
            onSubmit={(event) => void handleSubmit(event)}
          >
            <FormField
              autoComplete="new-password"
              error={passwordError}
              label="Новый пароль"
              name="password"
              onChange={setPassword}
              placeholder="Минимум 8 символов"
              type="password"
              value={password}
            />

            <FormField
              autoComplete="new-password"
              error={confirmationError}
              label="Подтверждение пароля"
              name="passwordConfirm"
              onChange={setConfirmation}
              placeholder="Повторите пароль"
              type="password"
              value={confirmation}
            />

            <Button className="w-full" disabled={busy || loading} size="lg" type="submit">
              {busy ? 'Сохраняем…' : 'Сохранить пароль'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
