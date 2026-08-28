import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Единственное, что в пополнении нельзя увидеть со стороны API: **какой ключ** клиент
 * прислал. Сервер честно отработает любой — и на двух разных ключах зачислит дважды.
 * Поэтому здесь проверяется ровно одно: ключ живёт от попытки, а не от вызова.
 */

const invoke = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}))

const { useTopUp } = await import('./packages')

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const keyOf = (call: number): string =>
  (invoke.mock.calls[call][1] as { body: { idempotencyKey: string } }).body.idempotencyKey

beforeEach(() => {
  invoke.mockReset()
})

describe('Ключ идемпотентности пополнения (NFR-03)', () => {
  it('повторное нажатие после отказа идёт с тем же ключом', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('сеть отвалилась') })

    const { result } = renderHook(() => useTopUp('user-1'), { wrapper })

    result.current.mutate('standard')
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    result.current.mutate('standard')
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(keyOf(1)).toBe(keyOf(0))
  })

  // Ключ ротируется после успеха — и это ровно та щель, через которую двойной клик
  // зачислял пакет дважды (найдено Playwright 2026-08-28). Закрыта она НЕ здесь, а окном
  // на сервере: любая клиентская схема, где клик может сменить ключ, ломается вторым
  // кликом. Тест закрепляет клиентское поведение, а не выдаёт его за защиту.
  it('после успешного зачисления следующая попытка получает новый ключ', async () => {
    invoke.mockResolvedValue({ data: { balance: 1120 }, error: null })

    const { result } = renderHook(() => useTopUp('user-1'), { wrapper })

    result.current.mutate('standard')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    result.current.mutate('standard')
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(keyOf(1)).not.toBe(keyOf(0))
  })

  it('разные пакеты не делят один ключ: это разные операции', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('сеть отвалилась') })

    const { result } = renderHook(() => useTopUp('user-1'), { wrapper })

    result.current.mutate('standard')
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))

    result.current.mutate('pro')
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))

    expect(keyOf(1)).not.toBe(keyOf(0))
  })
})
