import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'

/**
 * Куда приводит ссылка подтверждения из письма.
 *
 * Своей работы у экрана почти нет: токены из адресной строки разбирает сам Supabase SDK и
 * сообщает о новой сессии через `onAuthStateChange`. Экран нужен, чтобы человек видел
 * происходящее, пока это едет, и получил внятный ответ, если ссылка уже недействительна.
 */

/** Сколько ждём сессию, прежде чем считать ссылку негодной. */
const TIMEOUT_MS = 5000

export default function AuthCallback() {
  const { loading, session } = useSession()
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

  if (session) return <Navigate replace to="/profile" />

  if (!loading && timedOut) {
    return (
      <AuthLayout headerLink={{ label: 'Войти', to: '/signin' }} headerText="Уже подтвердили?">
        <AuthHeading
          description="Ссылка подтверждения недействительна или уже была использована."
          title="Не удалось подтвердить"
        />
        <Callout>
          Если аккаунт уже подтверждён — просто войдите. Если нет — зарегистрируйтесь заново,
          и письмо придёт снова.
        </Callout>
        <Button asChild className="w-full" size="lg">
          <Link to="/signin">Перейти ко входу</Link>
        </Button>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <AuthHeading description="Осталось несколько секунд." title="Подтверждаем email…" />
    </AuthLayout>
  )
}
