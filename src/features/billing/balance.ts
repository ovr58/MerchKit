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
 * На вехе M2 значение всегда 0: начисление стартовых баллов требует журнала операций и
 * приезжает на M3 вместе с `ledger`.
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
