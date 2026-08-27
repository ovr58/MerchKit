import { useEffect, useState, type ReactNode } from 'react'

import { supabase } from '@/lib/supabase'

import { SessionContext, type SessionState } from './session-context'

/**
 * Текущая сессия — единственное, что модуль `auth` показывает наружу из своего состояния
 * (docs/SPEC.md §3). Где она хранится и как обновляется токен, знает только Supabase SDK.
 *
 * Сессия здесь означает больше, чем «пользователь вошёл»: до подтверждения email вход
 * отклоняется самим Auth (ADR-0008), поэтому наличие сессии = подтверждённый аккаунт.
 * Отдельная проверка «подтверждён ли email» в интерфейсе не нужна и не заводится.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true })

  useEffect(() => {
    let alive = true

    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setState({ session: data.session, loading: false })
    })

    // Ловит и вход, и выход, и переход по ссылке из письма: SDK разбирает токены из
    // адресной строки сам и сообщает о новой сессии этим же событием.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ session, loading: false })
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
