import { describe, expect, it } from 'vitest'

import {
  affordableObjects,
  CARD_SURCHARGE,
  generationPrice,
  MAX_OBJECTS_PER_GENERATION,
  OBJECT_PRICE,
} from './pricing.ts'

/**
 * Набор кейсов, по которому сверяются обе стороны — клиент и сервер. Сверять их
 * построчно не требуется: реализация одна на двоих (см. шапку `pricing.ts`), поэтому
 * тест закрепляет сами числа из docs/TZ.md §11, а не совпадение двух копий формулы.
 */
describe('Цена генерации (docs/TZ.md §11)', () => {
  it('объект стоит 50 баллов, карточка с сочинением — 130 (Q-H3)', () => {
    expect(generationPrice('photo', 1)).toBe(50)
    expect(generationPrice('card', 1)).toBe(130)
  })

  it('числа прайса не разъезжаются с формулой', () => {
    expect(OBJECT_PRICE).toBe(50)
    expect(CARD_SURCHARGE).toBe(80)
    expect(generationPrice('card', 1) - generationPrice('photo', 1)).toBe(CARD_SURCHARGE)
  })

  it('отказывается считать больше потолка в один объект', () => {
    expect(MAX_OBJECTS_PER_GENERATION).toBe(1)
    expect(() => generationPrice('photo', 2)).toThrow(/Недопустимое число объектов/)
  })

  it('отказывается считать нулевое, отрицательное и дробное количество', () => {
    expect(() => generationPrice('photo', 0)).toThrow()
    expect(() => generationPrice('photo', -1)).toThrow()
    expect(() => generationPrice('photo', 1.5)).toThrow()
  })
})

describe('Подсказка «хватит на N объектов»', () => {
  it('считает по базовой цене объекта и округляет вниз', () => {
    // 300 стартовых баллов — ровно тот случай, что стоит на артборде D1 «Профиль».
    expect(affordableObjects(300)).toBe(6)
    expect(affordableObjects(100)).toBe(2)
    expect(affordableObjects(49)).toBe(0)
    expect(affordableObjects(0)).toBe(0)
  })
})
