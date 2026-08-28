import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useRef } from 'react'

import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'

/**
 * Пакеты пополнения (FR-23, US-05). Справочник живёт в базе и правится миграцией: ролей в
 * проекте нет, админки тоже (docs/SPEC.md §4). Клиент его только читает.
 */

export type CreditPackage = {
  id: string
  title: string
  credits: number
  priceRub: number
  isFeatured: boolean
}

type CreditPackageRow = {
  id: string
  title: string
  credits: number
  price_rub: number
  is_featured: boolean
}

export function useCreditPackages(): UseQueryResult<CreditPackage[]> {
  return useQuery({
    queryKey: ['credit-packages'],
    // Справочник за сессию не меняется: перечитывать его на каждый фокус окна незачем.
    staleTime: Infinity,
    queryFn: async (): Promise<CreditPackage[]> => {
      const { data, error } = await supabase
        .from('credit_packages')
        .select('id, title, credits, price_rub, is_featured')
        .order('sort_order')
        .returns<CreditPackageRow[]>()

      if (error) throw new Error(error.message)

      return data.map((row) => ({
        id: row.id,
        title: row.title,
        credits: row.credits,
        priceRub: row.price_rub,
        isFeatured: row.is_featured,
      }))
    },
  })
}

/**
 * Пополнение. Зачисляет Edge Function с service-role — клиент в баланс не пишет (NFR-05),
 * и номинал он тоже не называет: сервер берёт его из справочника по идентификатору пакета.
 *
 * Ключ идемпотентности заводится **на попытку**, а не на вызов, и держится до успеха: сколько
 * бы раз человек ни нажал кнопку, сервер увидит один ключ и зачислит один раз (NFR-03).
 * Опираться на то, что кнопка успеет стать неактивной, для денег недостаточно.
 */
export function useTopUp(userId: string | undefined): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()
  const attempts = useRef(new Map<string, string>())

  return useMutation({
    mutationFn: async (packageId: string): Promise<void> => {
      let idempotencyKey = attempts.current.get(packageId)
      if (idempotencyKey === undefined) {
        idempotencyKey = crypto.randomUUID()
        attempts.current.set(packageId, idempotencyKey)
      }

      const { error } = await supabase.functions.invoke('topup', {
        body: { packageId, idempotencyKey },
      })

      if (error) {
        logger.warn('Пополнение отклонено', { reason: error.message })
        throw new Error('Не удалось пополнить баланс. Попробуйте ещё раз')
      }

      attempts.current.delete(packageId)
      logger.info('Баланс пополнен')
    },
    onSuccess: async () => {
      // Баланс и история после зачисления другие — обе выборки перечитываются.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['balance', userId] }),
        queryClient.invalidateQueries({ queryKey: ['ledger', userId] }),
      ])
    },
  })
}
