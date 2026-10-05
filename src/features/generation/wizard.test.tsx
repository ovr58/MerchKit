import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProductPropertiesOutcome } from './api'

const extractProductProperties = vi.fn()
const launchGeneration = vi.fn()

vi.mock('./api', () => ({
  extractProductProperties: (...args: unknown[]) => extractProductProperties(...args),
  launchGeneration: (...args: unknown[]) => launchGeneration(...args),
  recognizePhotos: vi.fn(),
  useInvalidateAfterLaunch: () => async () => {},
}))

vi.mock('./draft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./draft')>()),
  clearDraft: vi.fn(),
  readDraft: vi.fn().mockResolvedValue(null),
  writeDraft: vi.fn(),
}))

// Экрану мастера нужны сессия, баланс и справочник: их источник — Supabase, здесь его нет.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/features/auth', () => ({ useSession: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('@/features/billing', () => ({ useBalance: () => ({ data: 500, isSuccess: true }) }))
vi.mock('@/features/taxonomy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/taxonomy')>()),
  useTaxonomy: () => ({
    data: {
      categories: [{ id: 'clothing', title: 'Одежда' }],
      presets: [{ id: 'on-model', categoryId: 'clothing', title: 'На модели', description: '' }],
      marketplaces: [{ id: 'wildberries', title: 'Wildberries', note: '' }],
      profiles: [],
    },
  }),
}))

const { useWizard } = await import('./wizard')
const { EMPTY_DRAFT, LAST_STEP, readDraft } = await import('./draft')
const { default: Wizard } = await import('@/screens/Wizard')

describe('Извлечение свойств товара', () => {
  beforeEach(() => {
    extractProductProperties.mockReset()
  })

  it('не перезаписывает ручную правку ответом на уже неактуальный запрос', async () => {
    let resolve!: (outcome: ProductPropertiesOutcome) => void
    extractProductProperties.mockReturnValue(new Promise<ProductPropertiesOutcome>((done) => { resolve = done }))

    const { result } = renderHook(() => useWizard())
    await waitFor(() => expect(result.current.restored).toBe(true))

    act(() => result.current.update({ productDescription: 'Материал: хлопок' }))
    act(() => result.current.extractProperties())
    act(() => result.current.update({ productProperties: [{ id: 'ручная', label: 'Цвет', value: 'Хаки' }] }))

    await act(async () => {
      resolve({
        properties: [{ id: 'от-модели', label: 'Материал', value: 'Хлопок' }],
        limitReached: false,
        failed: false,
      })
    })

    expect(result.current.draft.productProperties).toEqual([{ id: 'ручная', label: 'Цвет', value: 'Хаки' }])
    expect(result.current.extractingProperties).toBe(false)
  })
})

/**
 * Знак продавца (B3). Проверяется граница мастера, а не сам разбор PNG — он проверен в
 * `supabase/functions/_shared/logo.test.ts`: негодный файл не должен молча оказаться в
 * черновике, потому что дальше он уедет в бакет и в оплаченную карточку.
 */
describe('Логотип в черновике', () => {
  /** PNG настолько настоящий, насколько его читает проверка: подпись, IHDR и пустой IDAT. */
  function pngFile(width: number, colorType: number): File {
    const bytes = new Uint8Array(45)
    const view = new DataView(bytes.buffer)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    view.setUint32(8, 13)
    bytes.set([0x49, 0x48, 0x44, 0x52], 12)
    view.setUint32(16, width)
    view.setUint32(20, width)
    bytes[24] = 8
    bytes[25] = colorType
    bytes.set([0x49, 0x44, 0x41, 0x54], 37)
    return new File([bytes], 'brand.png', { type: 'image/png' })
  }

  it('принимает прозрачный PNG подходящего размера', async () => {
    const { result } = renderHook(() => useWizard())
    await waitFor(() => expect(result.current.restored).toBe(true))

    act(() => result.current.setLogo(pngFile(800, 6)))

    await waitFor(() => expect(result.current.draft.logo?.name).toBe('brand.png'))
    expect(result.current.logoRejected).toBeNull()
  })

  it('непрозрачный PNG в черновик не попадает, а причина называется человеку', async () => {
    const { result } = renderHook(() => useWizard())
    await waitFor(() => expect(result.current.restored).toBe(true))

    act(() => result.current.setLogo(pngFile(800, 2)))

    await waitFor(() => expect(result.current.logoRejected).toContain('непрозрачный фон'))
    expect(result.current.draft.logo).toBeNull()
  })

  it('снимает уже принятый знак', async () => {
    const { result } = renderHook(() => useWizard())
    await waitFor(() => expect(result.current.restored).toBe(true))

    act(() => result.current.setLogo(pngFile(800, 6)))
    await waitFor(() => expect(result.current.draft.logo).not.toBeNull())

    act(() => result.current.setLogo(null))

    expect(result.current.draft.logo).toBeNull()
  })
})

/**
 * Превью до оплаты убрано во всех флоу (Q-H4 плана `html-layout-authoring_2026-10-05.md`):
 * жалоба на вид оплаченной карточки решается возвратом баллов, а не сборкой до оплаты.
 * Шаг запуска проверяется экраном: обещание превью — это подпись и кнопка, а не поле хука.
 */
describe('Шаг запуска без превью (Q-H4)', () => {
  beforeEach(() => {
    launchGeneration.mockReset()
    launchGeneration.mockResolvedValue({ ok: true, generationId: 'g1' })
  })

  it('не предлагает собрать превью, а запуск уходит сразу', async () => {
    vi.mocked(readDraft).mockResolvedValueOnce({
      ...EMPTY_DRAFT,
      step: LAST_STEP,
      kind: 'card',
      productTitle: 'Куртка',
      categoryId: 'clothing',
      marketplaceId: 'wildberries',
      presetId: 'on-model',
      productProperties: [{ id: 'p1', label: 'Сезон', value: 'Зима' }],
    })

    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/generate']}>
          <Routes>
            <Route element={<Wizard />} path="/generate" />
            <Route element={<h1>Генерация запущена</h1>} path="/generation/:id" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Проверьте и запускайте')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /превью/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/превью|Как ляжет вёрстка/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Запустить' }))

    expect(await screen.findByRole('heading', { name: 'Генерация запущена' })).toBeInTheDocument()
    expect(launchGeneration).toHaveBeenCalledTimes(1)
  })
})
