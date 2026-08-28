import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

/**
 * История операций из журнала `ledger` (US-05: «операция видна в истории баланса»).
 *
 * Журнал — учётный регистр, а не лента для показа (CONTEXT.md «Журнал операций»): экран
 * читает его как есть и ничего не досчитывает. Баланс после операции хранится в самой
 * строке, поэтому колонка «Баланс» остаётся верной при любой выборке.
 */

export type LedgerKind = 'signup_bonus' | 'topup' | 'charge' | 'refund'

export type LedgerEntry = {
  id: number
  createdAt: string
  kind: LedgerKind
  delta: number
  balanceAfter: number
  packageId?: string
}

type LedgerRow = {
  id: number
  created_at: string
  kind: LedgerKind
  delta: number
  balance_after: number
  context: { package_id?: string } | null
}

/** Сколько операций показываем. Постраничность заведём, когда история дорастёт. */
const HISTORY_LIMIT = 50

export function useLedger(userId: string | undefined): UseQueryResult<LedgerEntry[]> {
  return useQuery({
    queryKey: ['ledger', userId],
    enabled: userId !== undefined,
    queryFn: async (): Promise<LedgerEntry[]> => {
      // Фильтра по владельцу здесь нет намеренно: чужие строки отсекает политика
      // `ledger_select_own`, а не запрос (NFR-04).
      const { data, error } = await supabase
        .from('ledger')
        .select('id, created_at, kind, delta, balance_after, context')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT)
        .returns<LedgerRow[]>()

      if (error) throw new Error(error.message)

      return data.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        kind: row.kind,
        delta: row.delta,
        balanceAfter: row.balance_after,
        packageId: row.context?.package_id,
      }))
    },
  })
}
