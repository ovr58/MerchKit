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
 *
 * **Отсюда всегда ведёт в мастер, и развилки нет.** На этот экран приходит ровно один
 * человек — только что подтвердивший регистрацию: оба письма с `emailRedirectTo` сюда
 * (первое и повторное) означают одно событие, а восстановление пароля идёт своим адресом
 * `/reset/new`. Ему нужен мастер: в профиле у новичка только стартовые баллы и пустая
 * история, а на входе в мастер его и развернуло (FR-12).
 *
 * Раньше здесь стоял признак «есть ли черновик с фото», и редирект ждал ответа IndexedDB.
 * Признак не работал по построению: гвард не пускает гостя в мастер, поэтому отложить фото
 * до регистрации он не мог, и ветка всегда вела на профиль. Заменять её признаком, который
 * переживёт письмо, значило бы хранить состояние ради случая, где оно всё равно теряется —
 * письмо часто открывают в другом браузере или с телефона. Ничего не храним: без хранилища
 * нечему не сработать, и поведение одинаково в приватном окне и на чужом устройстве.
 * Черновик, если он есть, подхватит сам мастер — это его работа, а не редиректа.
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

  if (session) return <Navigate replace to="/generate" />

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
