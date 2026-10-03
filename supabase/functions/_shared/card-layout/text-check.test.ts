import { describe, expect, it } from 'vitest'

import { cardFilling } from './filling.ts'
import { textMismatches } from './text-check.ts'
import type { CardContent, CardLayout, Layer, TextSlot, TextStyle } from './types.ts'

const STYLE: TextStyle = {
  role: 'body',
  size: 0.04,
  weight: 400,
  color: '#111111',
  align: 'left',
  valign: 'top',
  lineHeight: 1.2,
}

const slotLayer = (slot: TextSlot, patch: Partial<Layer> = {}): Layer =>
  ({
    id: `slot-${slot}`,
    type: 'text',
    z: 1,
    box: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 },
    style: STYLE,
    bind: { kind: 'text', slot },
    ...patch,
  }) as Layer

const layoutOf = (layers: Layer[]): CardLayout => ({
  id: 'test',
  title: 'Тестовый макет',
  canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
  layers,
})

const contentOf = (texts: CardContent['texts']): CardContent => ({ texts, props: [], swatches: [] })

describe('Дословность заголовка и описания', () => {
  const layout = layoutOf([slotLayer('title'), slotLayer('body', { id: 'body-layer', z: 2 })])

  it('тексты легли как есть — расхождений нет', () => {
    const content = contentOf({ title: ['Куртка пуховая'], body: ['Тёплая куртка на зиму'] })

    expect(textMismatches(layout, content)).toEqual([])
  })

  it('перенос и двойные пробелы — не расхождение: сверка по схлопнутым пробелам', () => {
    const content = contentOf({ title: ['Куртка  пуховая\n'], body: ['Тёплая куртка', 'на зиму'] })

    expect(textMismatches(layout, content, { title: ['Куртка пуховая'], body: ['Тёплая куртка на зиму'] })).toEqual([])
  })

  it('у заголовка отрезан последний символ до сборки — гнездо в списке', () => {
    const source = { title: ['Куртка пуховая'], body: ['Тёплая куртка на зиму'] }
    const cut = contentOf({ title: ['Куртка пуховая'.slice(0, -1)], body: source.body })

    expect(textMismatches(layout, cut, source)).toEqual(['title'])
  })

  it('оба гнезда испорчены — оба в списке, порядок title, body', () => {
    const source = { title: ['Куртка'], body: ['Описание'] }
    const content = contentOf({ title: ['Куртк'], body: ['Описани'] })

    expect(textMismatches(layout, content, source)).toEqual(['title', 'body'])
  })

  it('без исходника сверяется сам content: подмена после наполнения невидима, это предел', () => {
    expect(textMismatches(layout, contentOf({ title: ['Куртк'], body: ['Описание'] }))).toEqual([])
  })

  it('макет без слоя под гнездо не проверяет его', () => {
    const titleOnly = layoutOf([slotLayer('title')])
    const content = contentOf({ title: ['Куртка'], body: ['Описание'] })

    expect(textMismatches(titleOnly, content, { title: ['Куртка'], body: ['Другое'] })).toEqual([])
  })

  it('статический хвост шаблона не считается текстом заявки', () => {
    const templated = layoutOf([
      slotLayer('title', { lines: [[{}, { text: ' — новинка', weight: 700 }]] } as Partial<Layer>),
    ])
    const content = contentOf({ title: ['Куртка'] })

    expect(textMismatches(templated, content, { title: ['Куртка'] })).toEqual([])
    expect(textMismatches(templated, content, { title: ['Куртка зимняя'] })).toEqual(['title'])
  })

  it('слой, снятый правилом K-3 (гнездо пустое), не ловится как расхождение', () => {
    const content = contentOf({ title: ['Куртка'] })

    expect(textMismatches(layout, content, { title: ['Куртка'], body: [] })).toEqual([])
  })

  it('наполнение содержимого (cardFilling) не теряет ни символа от заголовка и описания', () => {
    const frame = { dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 }
    const title = 'Куртка пуховая зимняя'
    const description = 'Тёплая куртка на зиму, с капюшоном.'
    const { content } = cardFilling(layout, {
      title,
      description,
      properties: [],
      frame,
      cutout: null,
      logo: null,
    })

    expect(textMismatches(layout, content, { title: [title], body: [description] })).toEqual([])
  })
})
