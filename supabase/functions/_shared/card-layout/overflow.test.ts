import { describe, expect, it } from 'vitest'

import { overflowsOf, textProbes } from './svg.ts'
import type { FontFamilies } from './svg.ts'
import type { CardContent, CardLayout, Layer } from './types.ts'

/**
 * Арифметика переполнения (K-1, шаг B6): что именно не влезает в свой бокс.
 *
 * Обмерщик здесь поддельный и намеренно предсказуемый — настоящий живёт в растеризаторе и
 * проверяется на живом стенде. Тест о другом: правильно ли считается превышение, один ли раз
 * докладывается высота и доходит ли до отчёта привязка, по которой превью отличает текст
 * продавца от подстановки.
 */

const FONTS: FontFamilies = {
  display: 'Montserrat',
  heading: 'Montserrat',
  body: 'Montserrat',
  label: 'Montserrat',
  accent: 'Marck Script',
}

const SIZE = { width: 300, height: 400 }

function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

const style = {
  role: 'body' as const,
  size: 0.05,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}

/** Ширина строки — число знаков на десять пикселей: обмер обязан быть предсказуемым. */
const byLength = (svg: string): number => (svg.match(/>([^<]*)<\/text>/)?.[1].length ?? 0) * 10

const CONTENT: CardContent = {
  texts: { title: ['Куртка'] },
  props: [{ label: 'Материал', value: 'Мембрана' }],
  swatches: [],
}

describe('Арифметика переполнения (K-1, шаг B6)', () => {
  it('называет строку, которая шире своего бокса, и превышение долей бокса', () => {
    // Бокс — 0.1 ширины холста, то есть 30 px; «Куртка» по поддельному обмеру — 60 px.
    const layout = layoutOf([
      { id: 'title', type: 'text', z: 1, box: { x: 0, y: 0, w: 0.1, h: 0.5 }, style, bind: { kind: 'text', slot: 'title' } },
    ])

    const [overflow, ...rest] = overflowsOf(textProbes(layout, CONTENT, SIZE, FONTS), byLength)

    expect(rest).toEqual([])
    expect(overflow).toMatchObject({ layerId: 'title', kind: 'width', text: 'Куртка' })
    // Шесть знаков — 60 px при боксе 30 px: вдвое длиннее места под него.
    expect(overflow.over).toBeCloseTo(1)
  })

  it('молчит, когда строка помещается', () => {
    const layout = layoutOf([
      { id: 'title', type: 'text', z: 1, box: { x: 0, y: 0, w: 0.9, h: 0.5 }, style, bind: { kind: 'text', slot: 'title' } },
    ])

    expect(overflowsOf(textProbes(layout, CONTENT, SIZE, FONTS), byLength)).toEqual([])
  })

  it('высоту докладывает один раз на слой, а не на каждой строке', () => {
    const layout = layoutOf([
      {
        id: 'lines',
        type: 'text',
        z: 1,
        // Три строки по 1.2 × 20 px = 72 px в боксе высотой 0.05 × 400 = 20 px.
        box: { x: 0, y: 0, w: 0.9, h: 0.05 },
        style,
        lines: ['раз', 'два', 'три'],
      },
    ])

    const found = overflowsOf(textProbes(layout, CONTENT, SIZE, FONTS), byLength)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ layerId: 'lines', kind: 'height' })
    expect(found[0].text).toBe('раз / два / три')
  })

  it('доносит привязку: по ней превью отличает текст продавца от рыбы', () => {
    const layout = layoutOf([
      {
        id: 'prop-value',
        type: 'text',
        z: 1,
        box: { x: 0, y: 0, w: 0.05, h: 0.5 },
        style,
        bind: { kind: 'prop', index: 0, part: 'value' },
      },
    ])

    const [overflow] = overflowsOf(textProbes(layout, CONTENT, SIZE, FONTS), byLength)

    expect(overflow.bind).toEqual({ kind: 'prop', index: 0, part: 'value' })
  })

  it('снятые правилом K-3 слои не обмеряются: их в кадре нет', () => {
    const layout = layoutOf([
      {
        id: 'sizes',
        type: 'text',
        z: 1,
        box: { x: 0, y: 0, w: 0.01, h: 0.5 },
        style,
        bind: { kind: 'text', slot: 'sizes' },
      },
    ])

    expect(overflowsOf(textProbes(layout, CONTENT, SIZE, FONTS), byLength)).toEqual([])
  })
})
