import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Возврат мастера к параметрам неуспешной генерации (US-E4) на границе срока хранения
 * фото (веха M5, шаг 6).
 *
 * Проверяется ровно то, из-за чего шаг заводился: за три дня фото убирает уборка, и это
 * **штатный** исход, а не сбой. Мастер обязан вернуть человека на шаг «Фото» с целыми
 * остальными параметрами, а не поставить его перед кнопкой «Запустить» с пустой загрузкой.
 */

const download = vi.fn()
const warn = vi.fn()
const writeDraft = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ download: (path: string) => download(path) }) } },
}))

vi.mock('@/lib/logger', () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }))

vi.mock('./draft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./draft')>()),
  writeDraft: (...args: unknown[]) => writeDraft(...args),
}))

const { restoreDraftFrom } = await import('./api')
const { LAST_STEP } = await import('./draft')

const FAILED = {
  id: 'ec8f7d0e-0000-4000-8000-000000000001',
  status: 'failed' as const,
  kind: 'card' as const,
  marketplaceId: 'ozon',
  categoryId: 'clothing',
  presetId: 'clothing-model',
  productTitle: 'Куртка-бомбер',
  productDescription: 'Хлопок, цвет хаки',
  wishes: '',
  price: 55,
  title: null,
  cardTitle: null,
  cardDescription: null,
  failureReason: 'vendor_unavailable',
  sourcePaths: ['user-1/gen-1/photo-1.jpg', 'user-1/gen-1/photo-2.jpg'],
  createdAt: '2026-08-27T10:00:00.000Z',
  assets: [],
}

function missing(status: number) {
  return { data: null, error: Object.assign(new Error('Object not found'), { status }) }
}

beforeEach(() => {
  download.mockReset()
  warn.mockReset()
  writeDraft.mockReset()
})

describe('Возврат к параметрам неуспешной генерации', () => {
  it('фото на месте: человек возвращается сразу на шаг запуска', async () => {
    download.mockResolvedValue({ data: new Blob(['jpeg'], { type: 'image/jpeg' }), error: null })

    const restore = await restoreDraftFrom(FAILED)

    expect(restore).toEqual({ restored: 2, expired: 0 })
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ step: LAST_STEP }))
  })

  it('срок хранения истёк: шаг «Фото», параметры целы, в лог это не пишется', async () => {
    download.mockResolvedValue(missing(404))

    const restore = await restoreDraftFrom(FAILED)

    expect(restore).toEqual({ restored: 0, expired: 2 })
    expect(warn).not.toHaveBeenCalled()
    expect(writeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 0,
        photos: [],
        productTitle: 'Куртка-бомбер',
        categoryId: 'clothing',
        marketplaceId: 'ozon',
        presetId: 'clothing-model',
      }),
    )
  })

  it('пропало одно фото из двух: мастер всё равно возвращает на «Фото»', async () => {
    download
      .mockResolvedValueOnce({ data: new Blob(['jpeg'], { type: 'image/jpeg' }), error: null })
      .mockResolvedValueOnce(missing(404))

    const restore = await restoreDraftFrom(FAILED)

    // Оставь мы человека на шаге запуска — он заплатил бы за генерацию по одному фото
    // вместо двух и узнал бы об этом только по результату.
    expect(restore).toEqual({ restored: 1, expired: 1 })
    expect(writeDraft).toHaveBeenCalledWith(expect.objectContaining({ step: 0 }))
  })

  it('настоящий отказ хранилища срок хранения не изображает: он остаётся в логе', async () => {
    download.mockResolvedValue({ data: null, error: Object.assign(new Error('нет связи'), { status: 500 }) })

    const restore = await restoreDraftFrom(FAILED)

    // Ни одно фото не вернулось, но списать это на срок хранения нельзя: скажи мы человеку
    // «фото удалены по сроку», он бы не стал повторять попытку, хотя файлы на месте.
    expect(restore).toEqual({ restored: 0, expired: 0 })
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
