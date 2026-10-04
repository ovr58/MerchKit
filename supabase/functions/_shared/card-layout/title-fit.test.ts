import { describe, expect, it } from 'vitest'

import { fitTitle, titleCharLimit, titleFits, titleWidthOf } from './title-fit.ts'
import type { FontFamilies } from './svg.ts'
import type { CardLayout, Layer } from './types.ts'

/**
 * Короткий заголовок под бокс макета (шаг B7.8, решение Q-4).
 *
 * Обмерщик здесь поддельный: десять пикселей на знак. Настоящий — растеризатор — проверяется на
 * живом стенде; тест о другом: правильно ли из ширины бокса получается предел в знаках и как
 * заголовок режется по словам.
 */

const FONTS: FontFamilies = {
  display: 'Montserrat',
  heading: 'Montserrat',
  body: 'Montserrat',
  label: 'Montserrat',
  accent: 'Marck Script',
}

const SIZE = { width: 300, height: 400 }

const style = {
  role: 'heading' as const,
  size: 0.05,
  weight: 700,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}

const PX_PER_CHAR = 10

/** Ширина строки — число знаков на десять пикселей: обмер обязан быть предсказуемым. */
const byLength = (svg: string): number => (svg.match(/>([^<]*)<\/text>/)?.[1].length ?? 0) * PX_PER_CHAR

function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

/** Бокс заголовка на `chars` знаков: 10 px на знак, холст шириной 300 px. */
function layoutWithTitleFor(chars: number): CardLayout {
  return layoutOf([
    {
      id: 'title',
      type: 'text',
      z: 1,
      box: { x: 0, y: 0, w: (chars * PX_PER_CHAR) / SIZE.width, h: 0.2 },
      style,
      bind: { kind: 'text', slot: 'title' },
    },
    // Декоративная надпись шире своего бокса: на заголовок она влиять не должна.
    {
      id: 'deco',
      type: 'text',
      z: 2,
      box: { x: 0, y: 0.5, w: 0.1, h: 0.2 },
      style,
      lines: ['декоративная надпись длиннее любого заголовка'],
    },
  ])
}

const WITHOUT_TITLE = layoutOf([
  { id: 'body', type: 'text', z: 1, box: { x: 0, y: 0, w: 0.9, h: 0.2 }, style, bind: { kind: 'text', slot: 'body' } },
])

describe('Предел заголовка в знаках', () => {
  it('у бокса на 12 знаков предел — 12', () => {
    expect(titleCharLimit(layoutWithTitleFor(12), SIZE, FONTS, byLength)).toBe(12)
  })

  it('округляет вниз: 12 знаков с хвостом места — всё равно 12', () => {
    // Бокс 125 px при 10 px на знак.
    const layout = layoutOf([
      { id: 'title', type: 'text', z: 1, box: { x: 0, y: 0, w: 125 / SIZE.width, h: 0.2 }, style, bind: { kind: 'text', slot: 'title' } },
    ])

    expect(titleCharLimit(layout, SIZE, FONTS, byLength)).toBe(12)
  })

  it('не меньше одного знака, даже когда бокс уже знака', () => {
    expect(titleCharLimit(layoutWithTitleFor(0.2), SIZE, FONTS, byLength)).toBe(1)
  })

  it('у макета без гнезда заголовка предела нет', () => {
    expect(titleCharLimit(WITHOUT_TITLE, SIZE, FONTS, byLength)).toBeNull()
  })
})

describe('Ширина строки заголовка', () => {
  it('отдаёт обмер строки заголовка, а не соседних слоёв', () => {
    expect(titleWidthOf(layoutWithTitleFor(30), SIZE, FONTS, byLength, 'Куртка')).toBe(60)
  })

  it('у макета без гнезда заголовка — null', () => {
    expect(titleWidthOf(WITHOUT_TITLE, SIZE, FONTS, byLength, 'Куртка')).toBeNull()
  })
})

describe('Влезает ли заголовок в бокс', () => {
  it('влезает ровно по ширине бокса и не влезает на знак длиннее', () => {
    const fits = titleFits(layoutWithTitleFor(6), SIZE, FONTS, byLength)

    expect(fits('Куртка')).toBe(true)
    expect(fits('Куртки')).toBe(true)
    expect(fits('Куртка!')).toBe(false)
  })

  it('чужой переполненный слой заголовок не браковал', () => {
    // Бокс надписи на 3 знака, а надпись — 44: переполнение есть, но не у заголовка.
    expect(titleFits(layoutWithTitleFor(30), SIZE, FONTS, byLength)('Куртка')).toBe(true)
  })

  it('у макета без гнезда заголовка заголовок влезает всегда', () => {
    expect(titleFits(WITHOUT_TITLE, SIZE, FONTS, byLength)('очень длинный заголовок без места под него')).toBe(true)
  })
})

describe('Обрезка заголовка по словам', () => {
  const byChars = (limit: number) => (text: string) => text.length <= limit

  it('влезающий заголовок не меняет', () => {
    expect(fitTitle('Куртка мужская', byChars(20))).toBe('Куртка мужская')
  })

  it('схлопывает лишние пробелы, даже когда обрезать нечего', () => {
    expect(fitTitle('  Куртка   мужская ', byChars(20))).toBe('Куртка мужская')
  })

  it('режет по слову и снимает запятую на конце', () => {
    expect(fitTitle('Термокружка стальная, 450 мл', byChars(20))).toBe('Термокружка стальная')
  })

  it('снимает и тире с пробелами на конце', () => {
    expect(fitTitle('Чайник электрический — 1,7 л', byChars(22))).toBe('Чайник электрический')
  })

  it('не обрывает слово посередине', () => {
    expect(fitTitle('Куртка мужская зимняя', byChars(17))).toBe('Куртка мужская')
  })

  it('одно длинное слово остаётся целым', () => {
    expect(fitTitle('Электрочайникпрофессиональный', byChars(10))).toBe('Электрочайникпрофессиональный')
  })

  it('не влезает и первое слово — остаётся первое слово', () => {
    expect(fitTitle('Электрочайникпрофессиональный 2 л', byChars(10))).toBe('Электрочайникпрофессиональный')
  })
})
