import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import {
  signUp,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '@/features/auth'

/** Артборды D1 «Регистрация» и «Регистрация — ошибки полей». */
export default function SignUp() {
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const emailProblem = validateEmail(email)
    const passwordProblem = validatePassword(password)
    const confirmationProblem = validatePasswordConfirmation(password, confirmation)
    setEmailError(emailProblem)
    setPasswordError(passwordProblem)
    setConfirmationError(confirmationProblem)
    setFormError(null)
    if (emailProblem || passwordProblem || confirmationProblem) return

    setBusy(true)
    const result = await signUp(email.trim(), password)
    setBusy(false)

    if (!result.ok) {
      if (result.field === 'email') setEmailError(result.message)
      else if (result.field === 'password') setPasswordError(result.message)
      else setFormError(result.message)
      return
    }

    // Сессии после регистрации нет — вход открывает только ссылка из письма (ADR-0008).
    // Адрес несём в состоянии маршрута: повторная отправка пойдёт по нему.
    void navigate('/confirm-email', { replace: true, state: { email: email.trim() } })
  }

  return (
    <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Уже есть аккаунт?">
      <AuthHeading
        description="После подтверждения email на баланс придут 120 стартовых баллов — это две пробные генерации."
        title="Регистрация"
      />

      {formError && <Callout>{formError}</Callout>}

      <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <FormField
          autoComplete="email"
          error={emailError}
          label="Email"
          name="email"
          onChange={setEmail}
          placeholder="you@example.com"
          type="email"
          value={email}
        />

        <FormField
          autoComplete="new-password"
          error={passwordError}
          label="Пароль"
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

        <Button className="w-full" disabled={busy} size="lg" type="submit">
          {busy ? 'Создаём…' : 'Создать аккаунт'}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-[13px] leading-[18px]">
        Мы отправим письмо со ссылкой подтверждения. До перехода по ней вход в приложение
        недоступен.
      </p>

      <p className="text-muted-foreground text-center text-sm sm:hidden">
        Уже есть аккаунт?{' '}
        <Link className="text-primary font-medium hover:underline" to="/signin">
          Войти
        </Link>
      </p>
    </AuthLayout>
  )
}
