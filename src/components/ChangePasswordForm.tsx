import { useState, type FormEvent } from 'react'

import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import {
  changePassword,
  MESSAGES,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth'

/**
 * Смена пароля прямо в профиле, без похода в почту.
 *
 * Раньше кнопка «Сменить пароль» вела в восстановление: работало, но гоняло уже вошедшего
 * человека через письмо. Форма живёт внутри панели «Аккаунт», а не на отдельном экране —
 * на артборде D1 там кнопка, и уводить с профиля ради трёх полей незачем.
 */
export function ChangePasswordForm({
  email,
  onCancel,
  onSuccess,
}: {
  email: string
  onCancel: () => void
  onSuccess: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentError, setCurrentError] = useState<string | null>(null)
  const [nextError, setNextError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const currentProblem = current === '' ? MESSAGES.passwordRequired : null
    const nextProblem = validatePassword(next)
    const confirmationProblem = validatePasswordConfirmation(next, confirmation)
    setCurrentError(currentProblem)
    setNextError(nextProblem)
    setConfirmationError(confirmationProblem)
    setFormError(null)
    if (currentProblem || nextProblem || confirmationProblem) return

    setBusy(true)
    const result = await changePassword(email, current, next)
    setBusy(false)

    if (!result.ok) {
      if (result.field === 'currentPassword') setCurrentError(result.message)
      else if (result.field === 'password') setNextError(result.message)
      else setFormError(result.message)
      return
    }

    onSuccess()
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void handleSubmit(event)}>
      {formError && <Callout>{formError}</Callout>}

      <FormField
        autoComplete="current-password"
        error={currentError}
        label="Текущий пароль"
        name="currentPassword"
        onChange={setCurrent}
        type="password"
        value={current}
      />

      <FormField
        autoComplete="new-password"
        error={nextError}
        label="Новый пароль"
        name="newPassword"
        onChange={setNext}
        placeholder="Минимум 8 символов"
        type="password"
        value={next}
      />

      <FormField
        autoComplete="new-password"
        error={confirmationError}
        label="Подтверждение пароля"
        name="newPasswordConfirm"
        onChange={setConfirmation}
        placeholder="Повторите пароль"
        type="password"
        value={confirmation}
      />

      <div className="flex flex-col gap-2">
        <Button disabled={busy} size="lg" type="submit">
          {busy ? 'Сохраняем…' : 'Сохранить пароль'}
        </Button>
        <Button disabled={busy} onClick={onCancel} size="lg" type="button" variant="ghost">
          Отмена
        </Button>
      </div>
    </form>
  )
}
