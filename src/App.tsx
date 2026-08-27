import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'

type HealthResponse = { ok: boolean; service: string; ts: string }

async function fetchHealth(): Promise<HealthResponse> {
  const { data, error } = await supabase.functions.invoke<HealthResponse>('health')

  if (error) {
    logger.error('Edge Function health не ответила', { reason: error.message })
    throw new Error(error.message)
  }
  if (!data) {
    throw new Error('Пустой ответ функции health')
  }

  logger.info('Edge Function health ответила', { ts: data.ts })
  return data
}

/**
 * Экран вехи M1. Продуктовых экранов здесь нет — он показывает единственное, что M1
 * обязан доказать: фронтенд собран, тема и компоненты работают, а Edge Function
 * отвечает браузеру.
 */
export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false })

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">Merch Kit</h1>
        <p className="text-muted-foreground text-sm">
          Веха M1 — каркас. Продуктовых экранов пока нет: страница проверяет, что сборка,
          тема и связка с Edge Function живы.
        </p>
      </header>

      <section
        aria-live="polite"
        className="border-border rounded-lg border p-4 sm:p-6"
        data-testid="health-panel"
      >
        <h2 className="text-base font-medium">Связь с Edge Function</h2>
        <p className="mt-2 text-sm">
          {health.isPending && 'Проверяем…'}
          {health.isSuccess && (
            <span className="bg-success-surface text-success-foreground inline-block rounded-md px-2 py-1">
              Функция health ответила: {health.data.ts}
            </span>
          )}
          {health.isError && (
            <span className="bg-danger-surface text-danger-foreground inline-block rounded-md px-2 py-1">
              Не отвечает: {health.error.message}
            </span>
          )}
        </p>
        <Button
          className="mt-4"
          disabled={health.isFetching}
          onClick={() => void health.refetch()}
          type="button"
        >
          Проверить ещё раз
        </Button>
      </section>
    </main>
  )
}
