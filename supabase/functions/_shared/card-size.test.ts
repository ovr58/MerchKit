import { describe, expect, it } from 'vitest'

import { cardAssemblySize } from './card-size.ts'

/**
 * Размер собранной карточки (шаг B7.7, решение Q-2): пока сборка в изоляте Edge Function,
 * профиль площадью больше 896 × 1200 собирается в порог своего профиля.
 */

const OZON_CLOTHING = { width: 1792, height: 2400, minWidth: 900, minHeight: 1200 }
const DEFAULT = { width: 896, height: 1200, minWidth: 700, minHeight: 900 }
const OZON_FOOD = { width: 1024, height: 1024, minWidth: 200, minHeight: 200 }

describe('cardAssemblySize', () => {
  it('профиль больше 896 × 1200 собирается в порог своего профиля', () => {
    expect(cardAssemblySize(OZON_CLOTHING)).toEqual({ width: 900, height: 1200 })
  })

  it('профиль ровно 896 × 1200 остаётся как есть', () => {
    expect(cardAssemblySize(DEFAULT)).toEqual({ width: 896, height: 1200 })
  })

  it('квадрат 1024 × 1024 меньше предела по площади и остаётся как есть', () => {
    expect(cardAssemblySize(OZON_FOOD)).toEqual({ width: 1024, height: 1024 })
  })
})
