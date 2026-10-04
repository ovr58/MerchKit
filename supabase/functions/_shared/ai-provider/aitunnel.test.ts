import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createAitunnelProvider,
  GatewayError,
  imageSizeParam,
  isContentRefusal,
  readModerationVerdict,
} from './aitunnel.ts'
import type { OutputProfile, ProviderProfile, ProviderUsage } from './types.ts'

/**
 * Чистые функции адаптера, от которых зависит смена модели (ADR-0011): выбор формы
 * запроса, распознавание отказа по содержанию и разбор вердикта модерации. Остальное в
 * `aitunnel.ts` — сетевые вызовы, они проверяются прогоном через боевой конвейер, а не здесь.
 */

const clothing: OutputProfile = {
  marketplaceId: 'ozon',
  marketplaceTitle: 'Ozon',
  categoryId: 'clothing',
  width: 1792,
  height: 2400,
  minWidth: 900,
  minHeight: 1200,
  aspectW: 3,
  aspectH: 4,
  aspectLabel: '3:4',
  formats: ['jpeg', 'png'],
  maxBytes: 10 * 1024 * 1024,
}

const food: OutputProfile = {
  ...clothing,
  categoryId: 'food',
  width: 1024,
  height: 1024,
  minWidth: 200,
  minHeight: 200,
  aspectW: 1,
  aspectH: 1,
  aspectLabel: '1:1',
}

describe('Форма запроса: пиксели вместо бакетов (ADR-0011)', () => {
  it('без списка размеров форма остаётся бакетной', () => {
    expect(imageSizeParam(clothing, [])).toBeNull()
  })

  it('берёт размер своего соотношения, а не первый подходящий по порогу', () => {
    expect(imageSizeParam(clothing, ['1024x1024', '1536x2048'])).toBe('1536x2048')
    expect(imageSizeParam(food, ['1024x1024', '1536x2048'])).toBe('1024x1024')
  })

  it('из нескольких подходящих берёт самый дешёвый — наименьший по площади', () => {
    expect(imageSizeParam(clothing, ['3072x4096', '1536x2048'])).toBe('1536x2048')
  })

  it('не отдаёт размер ниже порога площадки: такой файл площадка не примет (FR-25)', () => {
    expect(() => imageSizeParam(clothing, ['768x1024'])).toThrow(/порог/)
  })

  it('падает внятно, если ни один размер не подходит по соотношению', () => {
    expect(() => imageSizeParam(clothing, ['2048x2048'])).toThrow(/3:4/)
  })

  it('не принимает мусор в списке размеров молча', () => {
    expect(() => imageSizeParam(clothing, ['большой'])).toThrow(/AI_PROVIDER_IMAGE_SIZES/)
  })
})

describe('Отказ по содержанию отличается от прочих ошибок шлюза (ADR-0011)', () => {
  const safety = new GatewayError(
    400,
    '{"error":{"message":"Your request was rejected by the safety system.","code":400,' +
      '"metadata":{"provider_name":"OpenAI"}}}',
  )

  it('узнаёт отказ системы безопасности провайдера', () => {
    expect(isContentRefusal(safety)).toBe(true)
  })

  it('не путает с отказом по неподдерживаемому разрешению', () => {
    const resolution = new GatewayError(
      400,
      '{"error":{"message":"Для модели \\"gpt-image-2\\" не поддерживается разрешение \\"1K\\".","code":400}}',
    )

    expect(isContentRefusal(resolution)).toBe(false)
  })

  it('не считает отказом по содержанию сбой шлюза и таймаут', () => {
    expect(isContentRefusal(new GatewayError(500, 'internal error'))).toBe(false)
    expect(isContentRefusal(new Error('Signal timed out.'))).toBe(false)
    expect(isContentRefusal(null)).toBe(false)
  })
})

/**
 * Разбор вердикта модерации. Массив «по вердикту на фото» — не выдуманный случай: ровно так
 * ответил `gemini-3.1-flash-lite` на двух фотографиях 2026-09-01, и три заявки подряд не
 * были приняты, хотя фотографии он разрешил.
 */
describe('Вердикт модерации', () => {
  it('читает объект, как просит промпт', () => {
    expect(readModerationVerdict({ allowed: true, reason: '' })).toEqual({
      allowed: true,
      reason: undefined,
    })
    expect(readModerationVerdict({ allowed: false, reason: 'оружие' })).toEqual({
      allowed: false,
      reason: 'оружие',
    })
  })

  it('читает массив «по вердикту на фото»', () => {
    expect(
      readModerationVerdict([
        { allowed: true, reason: '' },
        { allowed: true, reason: '' },
      ]),
    ).toEqual({ allowed: true })
  })

  it('запрет одной фотографии запрещает заявку целиком', () => {
    expect(
      readModerationVerdict([
        { allowed: true, reason: '' },
        { allowed: false, reason: 'оружие' },
      ]),
    ).toEqual({ allowed: false, reason: 'оружие' })
  })

  it('не выдаёт вердикт там, где его нет', () => {
    expect(readModerationVerdict({ verdict: 'ok' })).toBeNull()
    expect(readModerationVerdict({ allowed: 'true' })).toBeNull()
    expect(readModerationVerdict([])).toBeNull()
    expect(readModerationVerdict([{ allowed: true }, { note: 'непонятно' }])).toBeNull()
  })
})

/**
 * `directCard` (ADR-0018, п. 1): текстовая операция на подменном `fetch`, вендор не вызывается.
 * Проверяется то, что провайдер обязан сделать сам: какая модель, какой формат ответа, что
 * уходит пользовательским телом и что записывается в затраты. Ответ модели провайдер не
 * разбирает — разбор живёт в `parseDirection`, поэтому возвращается сырой объект.
 */
describe('Операция directCard', () => {
  const profile: ProviderProfile = {
    name: 'aitunnel',
    baseUrl: 'https://gateway.test/v1',
    imageModel: 'image-model',
    imageModelFallback: null,
    imageSizes: null,
    imageSizesFallback: null,
    textModel: 'text-model',
  }

  // Бриф собирает `directorBrief` (card-layout/direction.ts); провайдеру важно лишь, что он
  // уходит в запрос дословно, поэтому форма здесь минимальная.
  const brief = { mode: 'content', texts: { title: 'Куртка', body: '' }, complaints: [] } as never

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubGateway(reply: unknown) {
    vi.stubGlobal('Deno', { env: { get: () => 'test-key' } })
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(reply) } }],
          usage: { cost_rub: 0.0123 },
        }),
        { status: 200 },
      ))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('идёт на текстовую модель, просит JSON-объект и отдаёт бриф телом пользователя', async () => {
    const fetchMock = stubGateway({ texts: { kicker: ['Куртка'] } })

    const raw = await createAitunnelProvider(profile).directCard({ brief })

    expect(raw).toEqual({ texts: { kicker: ['Куртка'] } })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gateway.test/v1/chat/completions')

    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('text-model')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1]).toEqual({ role: 'user', content: JSON.stringify(brief) })
  })

  it('пишет вызов в затраты под именем directCard', async () => {
    stubGateway({})
    const usages: ProviderUsage[] = []

    await createAitunnelProvider(profile, (usage) => usages.push(usage)).directCard({ brief })

    expect(usages).toHaveLength(1)
    expect(usages[0]).toMatchObject({ operation: 'directCard', vendor: 'aitunnel', costRub: 0.0123 })
  })

  it('не разбирает ответ: форма не по контракту доходит до parseDirection как есть', async () => {
    stubGateway({ boxes: 'не массив' })

    await expect(createAitunnelProvider(profile).directCard({ brief })).resolves.toEqual({
      boxes: 'не массив',
    })
  })
})

/**
 * `composeCard` и предел заголовка (шаг B7.8, решение Q-4): модель пишет заголовок под бокс
 * макета, а не «до 100 символов». Проверяется то, что уходит пользовательским телом запроса.
 */
describe('Операция composeCard: предел заголовка', () => {
  const profile: ProviderProfile = {
    name: 'aitunnel',
    baseUrl: 'https://gateway.test/v1',
    imageModel: 'image-model',
    imageModelFallback: null,
    imageSizes: null,
    imageSizesFallback: null,
    textModel: 'text-model',
  }

  const product = {
    title: 'Термокружка',
    description: '',
    categoryTitle: 'Посуда',
    presetPrompt: null,
    presetTitle: null,
    wishes: '',
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function composeWith(titleLimit: number | null): Promise<{ system: string; user: string }> {
    vi.stubGlobal('Deno', { env: { get: () => 'test-key' } })
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ title: 'Термокружка', description: 'Держит тепло.' }) } }],
          usage: { cost_rub: 0.01 },
        }),
        { status: 200 },
      ))
    vi.stubGlobal('fetch', fetchMock)

    await createAitunnelProvider(profile).composeCard({ product, profile: clothing, titleLimit })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const { messages } = JSON.parse(init.body as string)
    return { system: messages[0].content, user: messages[1].content }
  }

  it('называет предел макета в знаках с пробелами', async () => {
    const { user } = await composeWith(12)

    expect(user).toContain('не длиннее 12 символов')
  })

  it('без предела — прежние «до 100 символов»', async () => {
    const { user } = await composeWith(null)

    expect(user).toContain('до 100')
    expect(user).not.toContain('не длиннее')
  })

  it('общей фразы «до 100 символов» в системной постановке больше нет: она спорила бы с пределом', async () => {
    const { system } = await composeWith(12)

    expect(system).not.toContain('100')
  })
})
