import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProductPropertiesOutcome } from './api'

const extractProductProperties = vi.fn()

vi.mock('./api', () => ({
  extractProductProperties: (...args: unknown[]) => extractProductProperties(...args),
  recognizePhotos: vi.fn(),
}))

vi.mock('./draft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./draft')>()),
  clearDraft: vi.fn(),
  readDraft: vi.fn().mockResolvedValue(null),
  writeDraft: vi.fn(),
}))

const { useWizard } = await import('./wizard')

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
