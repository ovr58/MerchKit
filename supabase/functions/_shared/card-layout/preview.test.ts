import { describe, expect, it } from 'vitest'

import { previewFilling } from './preview.ts'
import type { CardLayout, Layer } from './types.ts'

/**
 * Наполнение бесплатного превью (шаг B6, коррекция K-1).
 *
 * Главное здесь — отсечение по ёмкости: макет показывает столько характеристик, сколько у
 * него модулей, а остаток обязан быть НАЗВАН, а не потерян. Второе — заглушки ставятся ровно
 * туда, куда макет умеет их положить: лишняя ничего не нарисует, недостающая сняла бы слой
 * правилом K-3, и превью соврало бы про пустое место.
 */

const style = {
  role: 'body' as const,
  size: 0.05,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}

const box = { x: 0, y: 0, w: 0.5, h: 0.1 }

function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

function propModule(index: number): Layer {
  return {
    id: `prop-${index}`,
    type: 'group',
    z: index + 1,
    box,
    bind: { kind: 'prop', index },
    children: [
      { id: `prop-${index}-label`, type: 'text', z: 1, box, style, bind: { kind: 'prop', index, part: 'label' } },
      { id: `prop-${index}-value`, type: 'text', z: 2, box, style, bind: { kind: 'prop', index, part: 'value' } },
    ],
  }
}

const PROPERTIES = [
  { label: 'Материал', value: 'Мембрана' },
  { label: 'Утеплитель', value: 'Синтепон' },
  { label: 'Сезон', value: 'Зима' },
]

describe('Наполнение превью карточки (M7 B6)', () => {
  it('оставляет столько характеристик, сколько у макета модулей, и называет отсечённые', () => {
    const filling = previewFilling(layoutOf([propModule(0), propModule(1)]), {
      productTitle: 'Куртка',
      properties: PROPERTIES,
      hasLogo: false,
    })

    expect(filling.capacity).toBe(2)
    expect(filling.content.props).toHaveLength(2)
    expect(filling.cut).toEqual([{ label: 'Сезон', value: 'Зима' }])
  })

  it('считает модуль, а не привязанные слои: у одной характеристики их три', () => {
    // Модуль ниже — иконка, подпись и значение с одним и тем же номером.
    const filling = previewFilling(layoutOf([propModule(0)]), {
      productTitle: '',
      properties: PROPERTIES,
      hasLogo: false,
    })

    expect(filling.capacity).toBe(1)
    expect(filling.cut).toHaveLength(2)
  })

  it('в заголовок кладёт наименование продавца, остальные гнёзда — рыба и названы рыбой', () => {
    const layout = layoutOf([
      { id: 'title', type: 'text', z: 1, box, style, bind: { kind: 'text', slot: 'title' } },
      { id: 'sizes', type: 'text', z: 2, box, style, bind: { kind: 'text', slot: 'sizes' } },
    ])

    const filling = previewFilling(layout, { productTitle: 'Куртка', properties: [], hasLogo: false })

    expect(filling.content.texts.title).toEqual(['Куртка'])
    expect(filling.stubbed).toEqual(['sizes'])
    expect(filling.content.texts.sizes?.[0]).toBeTruthy()
  })

  it('пустое наименование тоже становится рыбой: в кадре не должно зиять место', () => {
    const layout = layoutOf([{ id: 'title', type: 'text', z: 1, box, style, bind: { kind: 'text', slot: 'title' } }])

    const filling = previewFilling(layout, { productTitle: '   ', properties: [], hasLogo: false })

    expect(filling.stubbed).toEqual(['title'])
    expect(filling.content.texts.title?.[0]).toBeTruthy()
  })

  it('гнёзда, которых в макете нет, не наполняются вовсе', () => {
    const layout = layoutOf([{ id: 'title', type: 'text', z: 1, box, style, bind: { kind: 'text', slot: 'title' } }])

    const filling = previewFilling(layout, { productTitle: 'Куртка', properties: [], hasLogo: false })

    expect(Object.keys(filling.content.texts)).toEqual(['title'])
  })

  it('кадров-заглушек ровно столько, сколько адресует макет', () => {
    const layout = layoutOf([
      { id: 'frame', type: 'frame', z: 1, box, fit: 'cover', bind: { kind: 'frame' } },
      { id: 'detail', type: 'frame', z: 2, box, fit: 'cover', bind: { kind: 'frame', index: 1 } },
    ])

    const filling = previewFilling(layout, { productTitle: 'Куртка', properties: [], hasLogo: false })

    expect(filling.content.frames).toHaveLength(2)
  })

  it('знак-заглушка появляется только там, где макет умеет его положить', () => {
    const withLogo = layoutOf([
      { id: 'logo', type: 'asset', z: 1, box, fit: 'contain', bind: { kind: 'logo' } },
    ])
    const withoutLogo = layoutOf([{ id: 'frame', type: 'frame', z: 1, box, fit: 'cover', bind: { kind: 'frame' } }])

    expect(previewFilling(withLogo, { productTitle: '', properties: [], hasLogo: true }).content.logo).toBeDefined()
    expect(previewFilling(withLogo, { productTitle: '', properties: [], hasLogo: false }).content.logo).toBeUndefined()
    expect(previewFilling(withoutLogo, { productTitle: '', properties: [], hasLogo: true }).content.logo).toBeUndefined()
  })

  it('пустые строки списка не занимают модуль и не попадают в отсечённые', () => {
    const filling = previewFilling(layoutOf([propModule(0)]), {
      productTitle: 'Куртка',
      properties: [{ label: '  ', value: '' }, { label: 'Сезон', value: 'Зима' }],
      hasLogo: false,
    })

    expect(filling.content.props).toEqual([{ label: 'Сезон', value: 'Зима' }])
    expect(filling.cut).toEqual([])
  })
})
