import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { FormField } from '@/components/FormField'
import { MailIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { requestPasswordReset, validateEmail } from '@/features/auth'

/**
 * Артборды D1 «Восстановление — запрос» и «Восстановление — ответ».
 *
 * Оба состояния живут на одном экране намеренно: US-E7 требует **одинакового** ответа
 * независимо от того, зарегистрирован адрес или нет. Отдельный маршрут для «письмо
 * отправлено» пришлось бы чем-то отличать, а любое отличие — это и есть способ проверить
 * чужой email на регистрацию.
 */
export default function ResetRequest() {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const problem = validateEmail(email)
    setEmailError(problem)
    if (problem) return

    const address = email.trim()
    setBusy(true)
    await requestPasswordReset(address)
    setBusy(false)
    setSentTo(address)
  }

  if (sentTo) {
    return (
      <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Вспомнили пароль?">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="bg-success-surface border-success-border text-success-foreground flex size-14 items-center justify-center rounded-full border">
            <MailIcon className="size-6" />
          </span>

          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Проверьте почту</h1>
            <p className="text-muted-foreground text-sm leading-5">
              Если аккаунт с адресом <span className="text-foreground font-medium">{sentTo}</span>{' '}
              существует, мы отправили на него ссылку для смены пароля. Ссылка действует 60 минут.
            </p>
          </div>

          <Link className="text-primary text-sm font-medium hover:underline" to="/signin">
            Вернуться ко входу
          </Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Вспомнили пароль?">
      <AuthHeading
        description="Введите email аккаунта — пришлём ссылку для смены пароля."
        title="Восстановление пароля"
      />

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

        <Button className="w-full" disabled={busy} size="lg" type="submit">
          {busy ? 'Отправляем…' : 'Отправить ссылку'}
        </Button>
      </form>

      <p className="text-center text-sm">
        <Link className="text-primary font-medium hover:underline" to="/signin">
          Вернуться ко входу
        </Link>
      </p>
    </AuthLayout>
  )
}
