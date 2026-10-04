import { describe, expect, it } from 'vitest'

import { textMismatches } from './text-check.ts'
import {
  firstWordFits,
  fitTitle,
  titleCharLimit,
  titleFits,
  titleLineLimit,
  titleLines,
  titleWidthOf,
  withTitleLines,
  wrapWords,
} from './title-fit.ts'
import type { FontFamilies } from './svg.ts'
import type { CardContent, CardLayout, Layer } from './types.ts'

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

/** Высота одной строки заголовка: кегль 0,05 от 400 px, межстрочный 1,2. */
const LINE_PX = 24

/** Бокс заголовка на `chars` знаков: 10 px на знак, холст шириной 300 px; по высоте — на
 *  `lines` строк (по умолчанию одна: решение B32 пускает вторую строку только в высокий бокс). */
function layoutWithTitleFor(chars: number, lines = 1): CardLayout {
  return layoutOf([
    {
      id: 'title',
      type: 'text',
      z: 1,
      box: { x: 0, y: 0, w: (chars * PX_PER_CHAR) / SIZE.width, h: (lines * LINE_PX) / SIZE.height },
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
      { id: 'title', type: 'text', z: 1, box: { x: 0, y: 0, w: 125 / SIZE.width, h: LINE_PX / SIZE.height }, style, bind: { kind: 'text', slot: 'title' } },
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

describe('Сколько строк позволяет бокс заголовка', () => {
  it('бокс на одну строку по высоте — одна', () => {
    expect(titleLineLimit(layoutWithTitleFor(12, 1), SIZE, FONTS)).toBe(1)
  })

  it('бокс на две строки по высоте — две', () => {
    expect(titleLineLimit(layoutWithTitleFor(12, 2), SIZE, FONTS)).toBe(2)
  })

  it('бокс на три строки всё равно даёт две: больше двух заголовок не занимает', () => {
    expect(titleLineLimit(layoutWithTitleFor(12, 3), SIZE, FONTS)).toBe(2)
  })

  it('недобор высоты в пиксель — след округления, строка помещается', () => {
    const layout = (heightPx: number): CardLayout =>
      layoutOf([
        { id: 'title', type: 'text', z: 1, box: { x: 0, y: 0, w: 0.5, h: heightPx / SIZE.height }, style, bind: { kind: 'text', slot: 'title' } },
      ])

    expect(titleLineLimit(layout(2 * LINE_PX - 1), SIZE, FONTS)).toBe(2)
    expect(titleLineLimit(layout(2 * LINE_PX - 2), SIZE, FONTS)).toBe(1)
  })

  it('у макета без гнезда заголовка строк нет', () => {
    expect(titleLineLimit(WITHOUT_TITLE, SIZE, FONTS)).toBeNull()
  })
})

describe('Предел знаков на две строки', () => {
  it('у бокса на 12 знаков в две строки предел — 24', () => {
    expect(titleCharLimit(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength)).toBe(24)
  })

  it('у бокса в одну строку предел прежний — 12', () => {
    expect(titleCharLimit(layoutWithTitleFor(12, 1), SIZE, FONTS, byLength)).toBe(12)
  })

  it('высокий бокс на три строки считается на две — 24', () => {
    expect(titleCharLimit(layoutWithTitleFor(12, 3), SIZE, FONTS, byLength)).toBe(24)
  })
})

describe('Перенос по словам', () => {
  const byChars = (limit: number) => (text: string) => text.length <= limit

  it('влезающий заголовок остаётся одной строкой', () => {
    expect(wrapWords('Куртка мужская', byChars(20), 2)).toEqual(['Куртка мужская'])
  })

  it('переносит на границе слова: первая строка заполняется до предела', () => {
    expect(wrapWords('Термокружка стальная вакуумная', byChars(22), 2)).toEqual(['Термокружка стальная', 'вакуумная'])
  })

  it('на одной строке всё остаётся одной строкой, даже когда не влезает', () => {
    expect(wrapWords('Термокружка стальная вакуумная', byChars(22), 1)).toEqual(['Термокружка стальная вакуумная'])
  })

  it('вторая строка забирает остаток целиком: слова не теряются, переполнение видно обмеру', () => {
    expect(wrapWords('Куртка мужская зимняя тёплая длинная', byChars(14), 2)).toEqual([
      'Куртка мужская',
      'зимняя тёплая длинная',
    ])
  })

  it('слово длиннее строки стоит на строке одно и не рвётся', () => {
    expect(wrapWords('Электрочайникпрофессиональный 2 л', byChars(10), 2)).toEqual([
      'Электрочайникпрофессиональный',
      '2 л',
    ])
  })

  it('схлопывает лишние пробелы', () => {
    expect(wrapWords('  Куртка   мужская ', byChars(20), 2)).toEqual(['Куртка мужская'])
  })
})

describe('Строки заголовка в боксе', () => {
  it('в боксе на две строки длинный заголовок идёт двумя', () => {
    expect(titleLines(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength, 'Куртка мужская')).toEqual(['Куртка', 'мужская'])
  })

  it('в боксе на одну строку остаётся одной: переносить некуда', () => {
    expect(titleLines(layoutWithTitleFor(12, 1), SIZE, FONTS, byLength, 'Куртка мужская')).toEqual(['Куртка мужская'])
  })

  it('короткий заголовок в высоком боксе — одна строка', () => {
    expect(titleLines(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength, 'Куртка')).toEqual(['Куртка'])
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

describe('Влезает ли заголовок в бокс на две строки', () => {
  it('две строки в высоком боксе влезают, а в низком того же размера — нет', () => {
    expect(titleFits(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength)('Куртка мужская')).toBe(true)
    expect(titleFits(layoutWithTitleFor(12, 1), SIZE, FONTS, byLength)('Куртка мужская')).toBe(false)
  })

  it('не влезает, когда вторая строка длиннее бокса', () => {
    expect(titleFits(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength)('Куртка мужская зимняя')).toBe(false)
  })

  it('обрезка по словам оставляет то, что влезает в бокс: в две строки или в одну', () => {
    const title = 'Термокружка стальная вакуумная'

    expect(fitTitle(title, titleFits(layoutWithTitleFor(12, 2), SIZE, FONTS, byLength))).toBe('Термокружка стальная')
    expect(fitTitle(title, titleFits(layoutWithTitleFor(12, 1), SIZE, FONTS, byLength))).toBe('Термокружка')
  })
})

describe('Влезает ли первое слово заголовка в бокс', () => {
  const fits = (layout: CardLayout, title: string) => firstWordFits(layout, SIZE, FONTS, byLength, title)

  it('влезает: слово не шире бокса, остальной заголовок не важен', () => {
    expect(fits(layoutWithTitleFor(12), 'Куртка мужская зимняя тёплая очень длинная')).toBe(true)
  })

  it('влезает ровно по ширине бокса и не влезает на знак длиннее', () => {
    expect(fits(layoutWithTitleFor(6), 'Куртка')).toBe(true)
    expect(fits(layoutWithTitleFor(6), 'Куртки!')).toBe(false)
  })

  it('не влезает: первое слово шире бокса, даже если бокс на две строки', () => {
    expect(fits(layoutWithTitleFor(10, 2), 'Электрочайникпрофессиональный 2 л')).toBe(false)
  })

  it('смотрит только на первое слово, а не на самое длинное', () => {
    expect(fits(layoutWithTitleFor(10), 'Куртка Электрочайникпрофессиональный')).toBe(true)
  })

  it('у макета без гнезда заголовка и у пустого заголовка влезает всегда', () => {
    expect(fits(WITHOUT_TITLE, 'Электрочайникпрофессиональный')).toBe(true)
    expect(fits(layoutWithTitleFor(6), '   ')).toBe(true)
  })
})

describe('Содержимое с готовыми строками заголовка', () => {
  const content = (title: string[] | undefined): CardContent => ({
    texts: { title, body: ['Описание'] },
    props: [],
    swatches: [],
  })

  it('кладёт в гнездо заголовка строки переноса и не трогает остальные гнёзда', () => {
    const wrapped = withTitleLines(layoutWithTitleFor(12, 2), content(['Куртка мужская']), SIZE, FONTS, byLength)

    expect(wrapped.texts.title).toEqual(['Куртка', 'мужская'])
    expect(wrapped.texts.body).toEqual(['Описание'])
  })

  it('повторный перенос ничего не меняет', () => {
    const layout = layoutWithTitleFor(12, 2)
    const once = withTitleLines(layout, content(['Куртка мужская']), SIZE, FONTS, byLength)

    expect(withTitleLines(layout, once, SIZE, FONTS, byLength)).toEqual(once)
  })

  it('слова в кадре те же, что ввели: дословность C1 не нарушена переносом', () => {
    const layout = layoutWithTitleFor(12, 2)
    const wrapped = withTitleLines(layout, content(['Куртка мужская']), SIZE, FONTS, byLength)

    expect(textMismatches(layout, wrapped, { title: ['Куртка мужская'] })).toEqual([])
  })

  it('пустой заголовок возвращается как есть: нечего переносить, гнездо остаётся как было', () => {
    const blank = content(['  '])

    expect(withTitleLines(layoutWithTitleFor(12, 2), blank, SIZE, FONTS, byLength)).toBe(blank)
  })

  it('макет без гнезда заголовка и содержимое без заголовка возвращаются как есть', () => {
    const plain = content(['Куртка мужская'])

    expect(withTitleLines(WITHOUT_TITLE, plain, SIZE, FONTS, byLength)).toBe(plain)

    const noTitle = content(undefined)
    expect(withTitleLines(layoutWithTitleFor(12, 2), noTitle, SIZE, FONTS, byLength)).toBe(noTitle)
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
