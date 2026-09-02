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
const upload = vi.fn()
const invoke = vi.fn()
const warn = vi.fn()
const writeDraft = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        download: (path: string) => download(path),
        upload: (path: string, blob: Blob, options: unknown) => upload(path, blob, options),
      }),
    },
    functions: { invoke: (name: string, options: unknown) => invoke(name, options) },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...args: unknown[]) => warn(...args) },
}))

vi.mock('./draft', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./draft')>()),
  writeDraft: (...args: unknown[]) => writeDraft(...args),
}))

const { launchGeneration, restoreDraftFrom } = await import('./api')
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
  productProperties: [],
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
  upload.mockReset()
  invoke.mockReset()
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

/**
 * Отказ на запуске: 409 приходит на два разных исхода, и клиент обязан показать тот, что
 * назвал сервер. Пока он выбирал текст по статусу, отказ модерации выглядел как нехватка
 * баллов — человек с полным балансом шёл пополнять баланс (найдено на живом сбое 2026-09-01).
 */
describe('Отказ на запуске генерации', () => {
  const INPUT = {
    userId: 'user-1',
    photos: [],
    logo: null,
    kind: 'card' as const,
    marketplaceId: 'ozon',
    categoryId: 'clothing',
    presetId: 'clothing-model',
    productTitle: 'Куртка-бомбер',
    productDescription: '',
    wishes: '',
    productProperties: [],
  }

  function refusal(status: number, body: Record<string, string>) {
    return {
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify(body), { status }),
      }),
    }
  }

  it('на отказ модерации показывает причину сервера, а не нехватку баллов', async () => {
    invoke.mockResolvedValue(
      refusal(409, {
        error: 'Заявка не принята: проверьте загруженные фото',
        code: 'moderation_rejected',
      }),
    )

    const outcome = await launchGeneration(INPUT)

    expect(outcome.ok).toBe(false)
    expect(outcome).toMatchObject({
      code: 'failed',
      message: 'Заявка не принята: проверьте загруженные фото',
    })
  })

  it('на нехватку баллов уводит на пополнение', async () => {
    invoke.mockResolvedValue(
      refusal(409, {
        error: 'Не хватает баллов для запуска генерации',
        code: 'insufficient_credits',
      }),
    )

    expect(await launchGeneration(INPUT)).toMatchObject({ code: 'insufficient_credits' })
  })

  it('на серверный сбой берёт текст сервера и пишет код ответа в журнал', async () => {
    invoke.mockResolvedValue(
      refusal(503, { error: 'Генерация временно недоступна, попробуйте ещё раз' }),
    )

    const outcome = await launchGeneration(INPUT)

    expect(outcome).toMatchObject({
      code: 'failed',
      message: 'Генерация временно недоступна, попробуйте ещё раз',
    })
    expect(warn).toHaveBeenCalledWith('Заявка отклонена', expect.objectContaining({ status: 503 }))
  })
})

/**
 * Знак продавца (B3) уезжает в бакет отдельным файлом, а в заявку — отдельным полем.
 *
 * Проверяется именно разделение: попади знак в `photoPaths`, вендор получил бы его как
 * пятое фото товара, а повтор неуспешной генерации (US-E4) вернул бы его в мастер
 * миниатюрой фото.
 */
describe('Знак продавца в заявке', () => {
  const WITH_LOGO = {
    userId: 'user-1',
    photos: [],
    logo: { name: 'brand.png', size: 4, blob: new Blob(['png'], { type: 'image/png' }) },
    kind: 'card' as const,
    marketplaceId: 'ozon',
    categoryId: 'clothing',
    presetId: 'clothing-model',
    productTitle: 'Куртка-бомбер',
    productDescription: '',
    wishes: '',
    productProperties: [],
  }

  it('кладёт знак в бакет и передаёт его путь отдельным полем', async () => {
    upload.mockResolvedValue({ error: null })
    invoke.mockResolvedValue({ data: { generationId: 'gen-1' }, error: null })

    expect(await launchGeneration(WITH_LOGO)).toMatchObject({ ok: true })

    const [path, , options] = upload.mock.calls[0]
    expect(path).toMatch(/^user-1\/\d+-logo\.png$/)
    expect(options).toMatchObject({ contentType: 'image/png' })

    const body = (invoke.mock.calls[0][1] as { body: { logoPath: string; photoPaths: string[] } }).body
    expect(body.logoPath).toBe(path)
    expect(body.photoPaths).toEqual([])
  })

  it('без знака ничего не грузит и передаёт пустое поле', async () => {
    invoke.mockResolvedValue({ data: { generationId: 'gen-1' }, error: null })

    expect(await launchGeneration({ ...WITH_LOGO, logo: null })).toMatchObject({ ok: true })

    expect(upload).not.toHaveBeenCalled()
    expect((invoke.mock.calls[0][1] as { body: { logoPath: null } }).body.logoPath).toBeNull()
  })

  it('не удалось загрузить знак — заявка не подаётся вовсе', async () => {
    // Иначе человек заплатил бы за карточку без знака, попросив карточку со знаком.
    upload.mockResolvedValue({ error: new Error('нет связи') })

    expect(await launchGeneration(WITH_LOGO)).toMatchObject({ code: 'failed' })
    expect(invoke).not.toHaveBeenCalled()
  })
})
