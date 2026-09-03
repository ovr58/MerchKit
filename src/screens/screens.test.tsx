import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Проверки на экранах — только для того, что нельзя увидеть в API: реакция формы на ввод.
 * Сами сценарии US-02 / US-03 проверяются против живого Supabase, а не моков.
 */

const signUp = vi.fn()
const resetPasswordForEmail = vi.fn()
const getSession = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: (...args: unknown[]) => signUp(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  },
}))

const { default: ResetRequest } = await import('@/screens/ResetRequest')
const { default: SignUp } = await import('@/screens/SignUp')
const { default: App } = await import('@/App')
const { default: AuthCallback } = await import('@/screens/AuthCallback')
const { SessionProvider } = await import('@/features/auth')

function renderScreen(element: ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  signUp.mockReset()
  resetPasswordForEmail.mockReset()
  getSession.mockReset()
  getSession.mockResolvedValue({ data: { session: null } })
})

describe('Регистрация (US-02)', () => {
  it('не отправляет форму, если подтверждение не совпадает с паролем', async () => {
    const user = userEvent.setup()
    renderScreen(<SignUp />)

    await user.type(screen.getByLabelText('Email'), 'seller@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'password123')
    await user.type(screen.getByLabelText('Подтверждение пароля'), 'password124')
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    expect(await screen.findByText('Подтверждение не совпадает с паролем')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('показывает занятый email у поля, а не общей ошибкой формы', async () => {
    // Supabase не отвечает ошибкой на занятый адрес — он отдаёт пользователя без identity.
    signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null })

    const user = userEvent.setup()
    renderScreen(<SignUp />)

    await user.type(screen.getByLabelText('Email'), 'seller@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'password123')
    await user.type(screen.getByLabelText('Подтверждение пароля'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Создать аккаунт' }))

    const message = await screen.findByText(/уже зарегистрирован/)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(message).toBeInTheDocument()
  })
})

describe('Восстановление пароля (US-E7)', () => {
  it('отвечает одинаково и когда Supabase молчит, и когда он вернул ошибку', async () => {
    const user = userEvent.setup()

    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    const known = renderScreen(<ResetRequest />)
    await user.type(screen.getByLabelText('Email'), 'seller@example.com')
    await user.click(screen.getByRole('button', { name: 'Отправить ссылку' }))
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Проверьте почту'))
    const forKnown = known.container.textContent
    known.unmount()

    // Несуществующий адрес: Supabase вернул ошибку, но человек обязан увидеть то же самое.
    resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'user_not_found' } })
    const unknown = renderScreen(<ResetRequest />)
    await user.type(screen.getByLabelText('Email'), 'seller@example.com')
    await user.click(screen.getByRole('button', { name: 'Отправить ссылку' }))
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent('Проверьте почту'))

    expect(unknown.container.textContent).toBe(forKnown)
  })
})

/**
 * Дверь в мастер (FR-12, решение пользователя 2026-09-01). До этого гость проходил мастер
 * целиком и упирался в перехват только на запуске — успевая потратить платное распознавание.
 * Проверка здесь, а не в e2e: это свойство карты маршрутов, и ломается оно одной строкой.
 */
describe('Мастер закрыт от гостя (FR-12)', () => {
  it('гостя с адреса мастера встречает регистрация, а не мастер', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/generate']}>
            <App />
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Создать аккаунт' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Создать генерацию' })).not.toBeInTheDocument()
  })
})

/**
 * Куда ведёт ссылка подтверждения из письма (ТЗ, сценарий уточнён 2026-09-03). Развилки на
 * этом экране больше нет, и цель редиректа записана в ТЗ приёмочным сценарием — значит она
 * проверяется, а не держится на комментарии.
 */
describe("Подтверждение почты ведёт в мастер", () => {
  it("с готовой сессией уводит с /auth/callback на /generate", async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/auth/callback']}>
            <Routes>
              <Route element={<AuthCallback />} path="/auth/callback" />
              <Route element={<h1>Создать генерацию</h1>} path="/generate" />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Создать генерацию' })).toBeInTheDocument()
  })
})
