import { describe, expect, it } from 'vitest'

import {
  addProductProperty,
  moveProductProperty,
  normalizeProductProperties,
  productPropertiesPayload,
  removeProductProperty,
  updateProductProperty,
  type ProductProperty,
} from './properties'

/** Ключ строки — дело клиента, поэтому сравниваем пары, а стабильность ключа проверяем прямо. */
function pairs(properties: ProductProperty[]): { label: string; value: string }[] {
  return properties.map(({ label, value }) => ({ label, value }))
}

describe('Свойства товара', () => {
  it('отбрасывает пустые строки, но сохраняет свойство с одной заполненной частью', () => {
    expect(
      pairs(normalizeProductProperties([
        { label: 'Материал', value: 'Хлопок' },
        { label: '  ', value: '  Хаки ' },
        { label: '', value: '' },
        { label: 42, value: 'не попадёт' },
      ])),
    ).toEqual([
      { label: 'Материал', value: 'Хлопок' },
      { label: '', value: 'Хаки' },
    ])
  })

  it('добавляет, правит, переставляет и удаляет свойство без мутации исходного списка', () => {
    const original = normalizeProductProperties([
      { label: 'Материал', value: 'Хлопок' },
      { label: 'Цвет', value: 'Хаки' },
    ])
    const added = addProductProperty(original)
    const edited = updateProductProperty(added, 2, { value: 'S–XXL' })

    expect(pairs(edited)).toEqual([
      { label: 'Материал', value: 'Хлопок' },
      { label: 'Цвет', value: 'Хаки' },
      { label: '', value: 'S–XXL' },
    ])
    expect(pairs(moveProductProperty(edited, 2, -1))).toEqual([
      { label: 'Материал', value: 'Хлопок' },
      { label: '', value: 'S–XXL' },
      { label: 'Цвет', value: 'Хаки' },
    ])
    expect(pairs(removeProductProperty(edited, 1))).toEqual([
      { label: 'Материал', value: 'Хлопок' },
      { label: '', value: 'S–XXL' },
    ])
    expect(original).toHaveLength(2)
  })

  it('держит ключ строки при правке и переносе, чтобы список не путал поля ввода', () => {
    const properties = addProductProperty(normalizeProductProperties([
      { label: 'Материал', value: 'Хлопок' },
      { label: 'Цвет', value: 'Хаки' },
    ]))
    const keys = properties.map((property) => property.id)

    expect(new Set(keys).size).toBe(3)
    expect(updateProductProperty(properties, 1, { value: 'Синий' }).map((property) => property.id)).toEqual(keys)
    expect(moveProductProperty(properties, 0, 1).map((property) => property.id))
      .toEqual([keys[1], keys[0], keys[2]])
    expect(removeProductProperty(properties, 0).map((property) => property.id)).toEqual([keys[1], keys[2]])
  })

  it('сохраняет ключ восстановленного черновика и не отдаёт его серверу', () => {
    const restored = normalizeProductProperties([{ id: 'из-черновика', label: 'Материал', value: 'Хлопок' }])

    expect(restored[0].id).toBe('из-черновика')
    expect(productPropertiesPayload(restored)).toEqual([{ label: 'Материал', value: 'Хлопок' }])
  })
})
