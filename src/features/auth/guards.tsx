import { Navigate, Outlet, useLocation } from 'react-router'

import { useSession } from './session-context'

/**
 * Гварды маршрутов.
 *
 * **Это навигация, а не защита данных.** Данные защищает RLS в Postgres: `anon`-ключ
 * Supabase публичен by design, и обратиться к API можно мимо любого интерфейса. Гвард
 * избавляет человека от пустого экрана, на который он всё равно не получил бы данных.
 */

function Waiting() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="text-muted-foreground flex min-h-svh items-center justify-center text-sm"
    >
      Проверяем сессию…
    </div>
  )
}

/** Пускает только авторизованного. Гостя отправляет на вход, запомнив, куда он шёл. */
export function RequireAuth() {
  const { session, loading } = useSession()
  const location = useLocation()

  if (loading) return <Waiting />
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Пускает только гостя: авторизованному нечего делать на входе и регистрации. */
export function RequireAnon() {
  const { session, loading } = useSession()

  if (loading) return <Waiting />
  if (session) return <Navigate to="/profile" replace />
  return <Outlet />
}
