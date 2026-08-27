import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
// Длину пароля на входе не проверяем: у существующего аккаунта она может быть любой,
// и «минимум 8 символов» на форме входа только мешало бы человеку войти.
import { MESSAGES, signIn, validateEmail } from '@/features/auth'

/** Артборды D1 «Вход» и «Вход — неверная пара». */
export default function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const emailProblem = validateEmail(email)
    const passwordProblem = password === '' ? MESSAGES.passwordRequired : null
    setEmailError(emailProblem)
    setPasswordError(passwordProblem)
    setFormError(null)
    if (emailProblem || passwordProblem) return

    setBusy(true)
    const result = await signIn(email.trim(), password)
    setBusy(false)

    if (!result.ok) {
      setFormError(result.message)
      return
    }

    // Куда пользователь шёл до того, как его развернул гвард. Нет такого — в профиль.
    const from = (location.state as { from?: string } | null)?.from
    void navigate(from ?? '/profile', { replace: true })
  }

  return (
    <AuthLayout
      headerLink={{ label: 'Регистрация', to: '/signup' }}
      headerText="Нет аккаунта?"
    >
      <AuthHeading
        description="Войдите, чтобы вернуться к своему каталогу генераций и баллам."
        title="Вход"
      />

      {formError && (
        <Callout>
          {formError}{' '}
          <Link className="text-danger-foreground underline" to="/reset">
            Восстановить пароль
          </Link>
          .
        </Callout>
      )}

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
          autoComplete="current-password"
          error={passwordError}
          label="Пароль"
          labelAside={
            <Link className="text-primary text-[13px] font-medium hover:underline" to="/reset">
              Забыли пароль?
            </Link>
          }
          name="password"
          onChange={setPassword}
          type="password"
          value={password}
        />

        <Button className="w-full" disabled={busy} size="lg" type="submit">
          {busy ? 'Входим…' : 'Войти'}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Нет аккаунта?{' '}
        <Link className="text-primary font-medium hover:underline" to="/signup">
          Зарегистрироваться
        </Link>
      </p>
    </AuthLayout>
  )
}
