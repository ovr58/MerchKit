import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { AuthHeading, AuthLayout } from '@/components/AuthLayout'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { hasPendingDraft } from '@/features/generation'

/**
 * Куда приводит ссылка подтверждения из письма.
 *
 * Своей работы у экрана почти нет: токены из адресной строки разбирает сам Supabase SDK и
 * сообщает о новой сессии через `onAuthStateChange`. Экран нужен, чтобы человек видел
 * происходящее, пока это едет, и получил внятный ответ, если ссылка уже недействительна.
 *
 * Одно исключение — возврат в мастер. Человек, упёршийся на входе в мастер в регистрацию
 * (FR-12), обязан вернуться к своим настройкам, а не на пустой профиль: «фото, товар и
 * сценарий останутся на месте» — обещание артборда.
 */

/** Сколько ждём сессию, прежде чем считать ссылку негодной. */
const TIMEOUT_MS = 5000

export default function AuthCallback() {
  const { loading, session } = useSession()
  const [timedOut, setTimedOut] = useState(false)
  const [returnTo, setReturnTo] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), TIMEOUT_MS)
    void hasPendingDraft().then((pending) => setReturnTo(pending ? '/generate' : '/profile'))
    return () => clearTimeout(timer)
  }, [])

  // Ждём не только сессию, но и ответ хранилища: уйти на профиль, а через миг прыгнуть
  // в мастер — хуже, чем показать «подтверждаем» лишние полсекунды.
  if (session && returnTo !== null) return <Navigate replace to={returnTo} />

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
