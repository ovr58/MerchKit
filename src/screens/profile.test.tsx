import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

/**
 * Профиль — единственный экран вехи M3, и проверять на нём есть что: он собирает баланс,
 * справочник пакетов и журнал из трёх разных выборок. Тест держит соответствие артборду
 * D1 `Profile` по содержимому — надписи, состав секций, порядок пакетов.
 *
 * Чего он не заменяет: сверки раскладки с канвасом. Пиксели проверяются глазами в браузере,
 * а не в jsdom.
 */

const SESSION = {
  user: { id: 'user-1', email: 'seller@example.com', created_at: '2026-08-27T10:00:00Z' },
}

const ROWS: Record<string, unknown> = {
  profiles: { balance: 120 },
  credit_packages: [
    { id: 'start', title: 'Старт', credits: 300, price_rub: 390, is_featured: false },
    { id: 'standard', title: 'Стандарт', credits: 1000, price_rub: 1090, is_featured: true },
    { id: 'pro', title: 'Про', credits: 3000, price_rub: 2030, is_featured: false },
  ],
  ledger: [
    {
      id: 1,
      created_at: '2026-08-27T10:00:00Z',
      kind: 'signup_bonus',
      delta: 120,
      balance_after: 120,
      context: {},
    },
  ],
}

type Query = {
  select: () => Query
  eq: () => Query
  order: () => Query
  limit: () => Query
  returns: () => Query
  single: () => Promise<unknown>
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>
}

/** Заглушка построителя запросов supabase-js: цепочка методов и ожидаемый в конце результат. */
function queryFor(table: string): Query {
  const result = { data: ROWS[table], error: null }
  const query: Query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    returns: () => query,
    single: () => Promise.resolve(result),
    then: (resolve) => Promise.resolve(result).then(resolve),
  }
  return query
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: SESSION } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    from: (table: string) => queryFor(table),
    functions: { invoke: vi.fn() },
  },
}))

const { SessionProvider } = await import('@/features/auth')
const { default: Profile } = await import('@/screens/Profile')

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SessionProvider>
          <Profile />
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Профиль (US-05, артборд D1 Profile)', () => {
  it('показывает фактический баланс и на сколько объектов его хватит', async () => {
    renderProfile()

    // Ждём именно подсказку: плитка баланса есть на экране и до ответа выборки, с прочерком.
    expect(
      await screen.findByText('Хватит на 2 объекта — один объект стоит 50 баллов'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('balance')).toHaveTextContent('120')
  })

  it('показывает три пакета в порядке справочника с ценой за балл', async () => {
    renderProfile()

    expect(await screen.findByText('Старт')).toBeInTheDocument()
    expect(screen.getByText('Стандарт')).toBeInTheDocument()
    expect(screen.getByText('Про')).toBeInTheDocument()

    expect(screen.getByText(/390.+₽.+1,30.+₽ за балл/)).toBeInTheDocument()
    expect(screen.getByText(/2.030.+₽.+0,68.+₽ за балл/)).toBeInTheDocument()

    // «Выгоднее» стоит ровно на одном пакете — на том, что помечен в справочнике.
    expect(screen.getAllByText('Выгоднее')).toHaveLength(1)
    expect(
      screen.getByText('Баллы зачисляются сразу: оплата в этой версии не подключена'),
    ).toBeInTheDocument()
  })

  it('показывает операцию из журнала, а не заглушку', async () => {
    renderProfile()

    expect(
      await screen.findByText('Стартовые баллы за подтверждение email'),
    ).toBeInTheDocument()
    expect(screen.getByText('+120')).toBeInTheDocument()
    expect(screen.queryByText(/Раздел готовится/)).not.toBeInTheDocument()
  })

  it('предупреждает про стартовые баллы, прежде чем удалить аккаунт (ADR-0009)', async () => {
    const user = userEvent.setup()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: 'Удалить аккаунт' }))

    expect(screen.getByText(/Стартовые баллы при повторной регистрации/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить навсегда' })).toBeInTheDocument()
  })
})
