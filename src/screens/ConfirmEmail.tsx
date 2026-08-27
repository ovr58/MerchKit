import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'

import { AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { MailIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { resendConfirmation } from '@/features/auth'

/**
 * Артборд D1 «Подтвердите email».
 *
 * Экран работает **без сессии**: до подтверждения Supabase её не выдаёт (ADR-0008).
 * Отсюда две особенности — адрес приезжает состоянием маршрута с формы регистрации, а
 * повторная отправка идёт по адресу, а не по текущему пользователю.
 */

/** Столько же, сколько `max_frequency` в `supabase/config.toml`: раньше письмо не уйдёт. */
const RESEND_COOLDOWN_SECONDS = 60

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function ConfirmEmail() {
  const location = useLocation()
  const email = (location.state as { email?: string } | null)?.email

  // Письмо ушло при регистрации — отсчёт начинается сразу, а не с первого нажатия.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentAgain, setSentAgain] = useState(false)

  useEffect(() => {
    if (cooldown === 0) return
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // Перезагрузили страницу — адреса в состоянии маршрута больше нет, и слать нечего.
  // Отправлять на вход честнее, чем показывать экран с неработающей кнопкой.
  if (!email) return <Navigate replace to="/signin" />

  async function handleResend() {
    if (!email) return
    setBusy(true)
    setError(null)
    const result = await resendConfirmation(email)
    setBusy(false)

    if (!result.ok) {
      setError(result.message)
      return
    }
    setSentAgain(true)
    setCooldown(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Не тот адрес?">
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="bg-success-surface border-success-border text-success-foreground flex size-14 items-center justify-center rounded-full border">
          <MailIcon className="size-6" />
        </span>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Подтвердите email</h1>
          <p className="text-muted-foreground text-sm leading-5">
            Мы отправили письмо на <span className="text-foreground font-medium">{email}</span>.
            Перейдите по ссылке из него — и на баланс придут 120 стартовых баллов.
          </p>
        </div>

        {error && <Callout>{error}</Callout>}

        <div className="flex w-full flex-col gap-2.5">
          <Button
            className="w-full"
            disabled={busy || cooldown > 0}
            onClick={() => void handleResend()}
            size="lg"
            type="button"
            variant="outline"
          >
            {busy ? 'Отправляем…' : 'Отправить письмо повторно'}
          </Button>
          <p aria-live="polite" className="text-muted-foreground text-[13px]">
            {cooldown > 0
              ? `Повторная отправка будет доступна через ${formatCountdown(cooldown)}`
              : sentAgain
                ? 'Письмо отправлено ещё раз'
                : 'Письмо можно запросить повторно'}
          </p>
        </div>

        <hr className="border-border w-full" />

        <p className="text-muted-foreground text-[13px] leading-[18px]">
          Письма нет во «Входящих» — проверьте «Спам» и «Промоакции». Аккаунт уже создан:
          регистрироваться заново не нужно, но до перехода по ссылке вход недоступен.
        </p>

        <p className="text-muted-foreground text-[13px]">
          Ошиблись адресом?{' '}
          <Link className="text-primary font-medium hover:underline" to="/signup">
            Зарегистрируйтесь заново
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}
