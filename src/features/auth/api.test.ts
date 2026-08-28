import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Удаление аккаунта — единственная операция модуля, у которой порядок вызовов важнее
 * результата: пользователя на сервере уже нет, и обычный выход упирается в 403.
 */

const invoke = vi.fn()
const signOut = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signOut: (...args: unknown[]) => signOut(...args) },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}))

const { deleteAccount } = await import('./api')

beforeEach(() => {
  invoke.mockReset()
  signOut.mockReset()
  signOut.mockResolvedValue({ error: null })
})

describe('Удаление аккаунта', () => {
  it('гасит сессию локально: отзывать сессии несуществующего пользователя незачем', async () => {
    invoke.mockResolvedValue({ data: { deleted: true }, error: null })

    const outcome = await deleteAccount()

    expect(outcome.ok).toBe(true)
    // Сеть при этом всё равно задействуется и отвечает 403 — так устроен SDK, см.
    // комментарий в `api.ts`. Здесь закрепляется намерение, а не отсутствие запроса.
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('не гасит сессию, если удалить аккаунт не удалось', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('нет связи') })

    const outcome = await deleteAccount()

    expect(outcome.ok).toBe(false)
    expect(signOut).not.toHaveBeenCalled()
  })
})
