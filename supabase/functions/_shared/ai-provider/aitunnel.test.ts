import { describe, expect, it } from 'vitest'

import { GatewayError, imageSizeParam, isContentRefusal } from './aitunnel.ts'
import type { OutputProfile } from './types.ts'

/**
 * Две чистые функции адаптера, от которых зависит смена модели (ADR-0011): выбор формы
 * запроса и распознавание отказа по содержанию. Остальное в `aitunnel.ts` — сетевые вызовы,
 * они проверяются прогоном через боевой конвейер, а не здесь.
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
