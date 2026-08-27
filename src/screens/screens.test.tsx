import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Проверки на экранах — только для того, что нельзя увидеть в API: реакция формы на ввод.
 * Сами сценарии US-02 / US-03 проверяются против живого Supabase, а не моков.
 */

const signUp = vi.fn()
const resetPasswordForEmail = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signUp: (...args: unknown[]) => signUp(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
    },
  },
}))

const { default: ResetRequest } = await import('@/screens/ResetRequest')
const { default: SignUp } = await import('@/screens/SignUp')

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
