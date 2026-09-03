import { describe, expect, it } from 'vitest'

import { readProductProperties } from './aitunnel.ts'

describe('Разбор свойств товара из ответа текстовой модели', () => {
  it('оставляет только непустые строки label/value и сохраняет порядок важности', () => {
    expect(
      readProductProperties({
        properties: [
          { label: 'Материал', value: ' хлопок ' },
          { label: 'Цвет', value: 'хаки' },
          { label: '', value: '' },
          { label: 'Размеры', value: 42 },
        ],
      }),
    ).toEqual([
      { label: 'Материал', value: 'хлопок' },
      { label: 'Цвет', value: 'хаки' },
    ])
  })

  it('не принимает ответ без списка свойств', () => {
    expect(readProductProperties({ properties: 'Материал: хлопок' })).toBeNull()
  })
})
