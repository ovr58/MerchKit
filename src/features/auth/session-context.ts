import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

/**
 * Контекст сессии и хук доступа к нему. Вынесены из `session.tsx` не ради красоты: файл,
 * который экспортирует и компонент, и что-то ещё, ломает горячую перезагрузку React.
 */

export type SessionState = {
  session: Session | null
  /** До первого ответа Supabase неизвестно, есть ли сессия: гварды обязаны подождать. */
  loading: boolean
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSession(): SessionState {
  const state = useContext(SessionContext)
  if (!state) {
    throw new Error('useSession вызван вне SessionProvider')
  }
  return state
}
