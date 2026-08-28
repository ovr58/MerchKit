import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase'

/**
 * Баланс баллов. Модуль `billing` — единственный владелец таблицы `profiles` со стороны
 * интерфейса (docs/SPEC.md §3): экраны спрашивают баланс здесь, а не запросом в таблицу.
 *
 * Чтение идёт под RLS и возвращает строку **только своего** пользователя — фильтр по `id`
 * тут не защита, а способ получить один объект вместо списка. Защита живёт в политике
 * `profiles_select_own` (NFR-04).
 *
 * Значение производно от журнала `ledger` и меняется только вместе с записью в нём —
 * ни клиент, ни этот модуль его не двигают (NFR-05).
 */
export function useBalance(userId: string | undefined): UseQueryResult<number> {
  return useQuery({
    queryKey: ['balance', userId],
    enabled: userId !== undefined,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('balance')
        .eq('id', userId!)
        .single<{ balance: number }>()

      if (error) throw new Error(error.message)
      return data.balance
    },
  })
}
