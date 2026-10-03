import { describe, expect, it } from 'vitest'

import {
  applyDirection,
  bareTextLayers,
  behindCutout,
  directedContent,
  directionNeed,
  directorBrief,
  iconProps,
  parseDirection,
  topLevelOf,
} from './direction.ts'
import type { CardDirection, DirectionContext } from './direction.ts'
import { CONTENT, ICON, baseLayers, layoutOf, moduleGroup, plate, productMap, text } from './direction.fixtures.ts'
import { resolveLayout } from './validate.ts'
import type { Layer } from './types.ts'

/**
 * Арт-директор, шаг B5.4: бесплатная предпроверка, постановка, разбор ответа и применение.
 * Всё чистое, поэтому проверяется на ручных макетах и картах — ни модели, ни растеризатора.
 */

const ON_PRODUCT = { x: 0.62, y: 0.05, w: 0.33, h: 0.1 }
const CUTOUT: Layer = {
  id: 'cutout',
  type: 'cutout',
  z: 9,
  box: { x: 0, y: 0, w: 1, h: 1 },
  fit: 'cover',
  bind: { kind: 'cutout' },
}

describe('Предпроверка directionNeed (ADR-0018, п. 5)', () => {
  const content = CONTENT

  it('«full»: голый заголовок лежит на занятой половине карты', () => {
    const layout = layoutOf(baseLayers(ON_PRODUCT))
    expect(directionNeed({ layout, content, canvasMap: productMap(), hasCutout: false })).toBe('full')
  })

  it('«content»: тот же макет без карты — полная постановка невозможна', () => {
    const layout = layoutOf(baseLayers(ON_PRODUCT))
    expect(directionNeed({ layout, content, canvasMap: null, hasCutout: false })).toBe('content')
  })

  it('«content»: заголовок на плашке в 90% и больше голым не считается', () => {
    const layout = layoutOf([...baseLayers(ON_PRODUCT), plate('plate', { x: 0.6, y: 0.03, w: 0.38, h: 0.14 }, 1)])
    expect(directionNeed({ layout, content, canvasMap: productMap(), hasCutout: false })).toBe('content')
  })

  it('«full»: плашка, покрывающая меньше 90% бокса текста, плашкой не считается', () => {
    // Плашка покрывает 80% ширины заголовка: 0,264 из 0,33.
    const layout = layoutOf([...baseLayers(ON_PRODUCT), plate('plate', { x: 0.62, y: 0.03, w: 0.264, h: 0.14 }, 1)])
    expect(directionNeed({ layout, content, canvasMap: productMap(), hasCutout: false })).toBe('full')
  })

  it('«content»: текст с z ниже выреза и вырез на сборке есть — текст за товаром по замыслу', () => {
    const layout = layoutOf([...baseLayers(ON_PRODUCT), CUTOUT])
    const withCutout = { ...content, cutout: ICON }

    expect(directionNeed({ layout, content: withCutout, canvasMap: productMap(), hasCutout: true })).toBe('content')
    // Выреза на этой сборке нет — исключение не действует.
    expect(directionNeed({ layout, content, canvasMap: productMap(), hasCutout: false })).toBe('full')
  })

  it('«none»: ни гнёзд, ни иконок и ни одного текста на товаре', () => {
    const layout = layoutOf([text('title', { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }, 'title')])
    expect(directionNeed({ layout, content, canvasMap: productMap(), hasCutout: false })).toBe('none')
  })

  it('«content» по одним иконкам, без гнёзд арт-директора', () => {
    const layout = layoutOf([text('title', { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }, 'title'), moduleGroup({ x: 0.05, y: 0.7, w: 0.3, h: 0.1 })])
    expect(directionNeed({ layout, content, canvasMap: null, hasCutout: false })).toBe('content')
  })
})

describe('Признаки макета', () => {
  it('iconProps: отсортированные уникальные номера свойств со слоем иконки, включая вложенные', () => {
    const layout = layoutOf([
      moduleGroup({ x: 0.5, y: 0.7, w: 0.3, h: 0.1 }, 3, 'mod-b'),
      moduleGroup({ x: 0.05, y: 0.7, w: 0.3, h: 0.1 }),
      moduleGroup({ x: 0.05, y: 0.8, w: 0.3, h: 0.1 }, 0, 'mod-c'),
    ])

    expect(iconProps(layout)).toEqual([0, 3])
  })

  it('topLevelOf: сам слой верхнего уровня и слой внутри группы', () => {
    const layout = layoutOf(baseLayers())
    expect(topLevelOf(layout, 'title')).toBe('title')
    expect(topLevelOf(layout, 'mod-label')).toBe('mod')
    expect(topLevelOf(layout, 'mod')).toBe('mod')
  })

  it('bareTextLayers: подпись внутри модуля стоит на плашке группы и голой не бывает', () => {
    const layout = layoutOf(baseLayers())
    const { layers } = resolveLayout(layout, CONTENT)

    expect(bareTextLayers(layers).map((item) => item.layer.id)).toEqual(['title'])
  })

  it('behindCutout: только при вырезе на сборке и только для текста ниже выреза по z', () => {
    const layout = layoutOf([...baseLayers(), CUTOUT])
    const { layers } = resolveLayout(layout, { ...CONTENT, cutout: ICON })
    const title = layers.find((item) => item.layer.id === 'title')!

    expect(behindCutout(layers, title, true)).toBe(true)
    expect(behindCutout(layers, title, false)).toBe(false)
    // Текст выше выреза за ним не стоит.
    expect(behindCutout(layers, { ...title, z: 10 }, true)).toBe(false)
  })
})

describe('directorBrief', () => {
  const input = {
    layout: layoutOf(baseLayers()),
    texts: { title: 'Куртка', body: 'Тёплая' },
    properties: [{ label: 'Ткань', value: 'Мембрана' }],
    wishes: 'без лишнего',
    canvasMap: productMap(),
    icons: [{ name: 'thermometer', description: 'градусник' }],
    fillSlots: ['subtitle' as const],
    iconPropsAsked: [0],
    complaints: ['бокс «title»: выходит за правый край'],
  }

  it('лёгкая постановка не содержит ни слоёв, ни карты, ни холста', () => {
    const brief = directorBrief({ ...input, mode: 'content' })

    expect(brief).not.toHaveProperty('layers')
    expect(brief).not.toHaveProperty('map')
    expect(brief).not.toHaveProperty('canvas')
    expect(brief).toMatchObject({
      mode: 'content',
      fillSlots: ['subtitle'],
      iconProps: [0],
      complaints: input.complaints,
      icons: input.icons,
    })
  })

  it('полная постановка несёт холст, слои верхнего уровня по порядку и карту', () => {
    const brief = directorBrief({ ...input, mode: 'full' })

    expect(brief.canvas).toEqual({ aspectW: 3, aspectH: 4 })
    expect(brief.map).toBe(input.canvasMap)
    expect(brief.layers?.map((layer) => layer.id)).toEqual(['frame', 'title', 'subtitle', 'kicker', 'mod'])

    const [frame, title, , , mod] = brief.layers!
    expect(frame).toMatchObject({ type: 'frame', editable: false })
    expect(title).toMatchObject({ editable: true, role: 'body', size: 0.04, bind: { kind: 'text', slot: 'title' } })
    // У привязанного слоя без шаблона число строк заранее неизвестно — поля нет.
    expect(title).not.toHaveProperty('lineCount')
    expect(mod.contains).toEqual([
      { kind: 'prop', index: 0, part: 'icon' },
      { kind: 'prop', index: 0, part: 'label' },
    ])
    expect(mod).not.toHaveProperty('role')
  })

  it('lineCount — число строк шаблона у слоя с жёсткими строками', () => {
    const layout = layoutOf([{ ...text('t', { x: 0, y: 0, w: 0.5, h: 0.1 }, 'title'), lines: ['а', 'б'] }])
    expect(directorBrief({ ...input, layout, mode: 'full' }).layers?.[0]).toMatchObject({ lineCount: 2 })
  })
})

describe('parseDirection (ADR-0018, п. 2, проверки 1–2)', () => {
  const layout = layoutOf(baseLayers())
  const ctx: DirectionContext = {
    layout,
    mode: 'full',
    propertyCount: 2,
    iconNames: ['thermometer'],
    source: ['Куртка мужской зимняя', 'Ткань', 'Мембрана', 'Вес', '1 кг', 'нужно 5 карманов'],
  }
  const titleBox = { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }

  function parse(raw: unknown, over: Partial<DirectionContext> = {}) {
    return parseDirection(raw, { ...ctx, ...over })
  }

  it('в одном ответе принимает годную иконку и гнездо и отвергает бокс frame', () => {
    const { parts, complaints } = parse({
      boxes: [{ layerId: 'frame', box: { x: 0, y: 0, w: 1, h: 1 } }],
      texts: { kicker: ['Куртка зимняя'] },
      icons: [{ prop: 0, icon: 'thermometer' }],
    })

    expect(parts).toEqual({ boxes: [], texts: { kicker: ['Куртка зимняя'] }, icons: [{ prop: 0, icon: 'thermometer' }] })
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('frame')
  })

  it('принимает годный бокс и оставляет в нём только четыре числа', () => {
    const { parts, complaints } = parse({ boxes: [{ layerId: 'title', box: { ...titleBox, x: 0.1, extra: 1 } }] })

    expect(complaints).toEqual([])
    expect(parts.boxes).toEqual([{ layerId: 'title', box: { x: 0.1, y: 0.05, w: 0.5, h: 0.1 } }])
  })

  it.each([
    ['бокс вложенного слоя', { boxes: [{ layerId: 'mod-label', box: titleBox }] }, {}, 'вложенный'],
    [
      'повтор id',
      {
        boxes: [
          { layerId: 'title', box: titleBox },
          { layerId: 'title', box: { ...titleBox, y: 0.1 } },
        ],
      },
      {},
      'несколько раз',
    ],
    ['выход за правый край холста', { boxes: [{ layerId: 'title', box: { ...titleBox, x: 0.6 } }] }, {}, 'правый край (x + w = 1.1)'],
    ['сжатие до 0,4 исходной ширины', { boxes: [{ layerId: 'title', box: { ...titleBox, w: 0.2 } }] }, {}, 'ширина ×0.4'],
    ['растяжение выше полутора', { boxes: [{ layerId: 'title', box: { ...titleBox, h: 0.16 } }] }, {}, 'высота ×1.6'],
    ['бокс в лёгкой постановке', { boxes: [{ layerId: 'title', box: titleBox }] }, { mode: 'content' as const }, 'лёгкой постановке'],
    ['слой, которого нет в макете', { boxes: [{ layerId: 'ghost', box: titleBox }] }, {}, 'нет в макете'],
    ['бокс не из чисел', { boxes: [{ layerId: 'title', box: { ...titleBox, w: '0.5' } }] }, {}, 'конечными числами'],
    ['нулевая ширина', { boxes: [{ layerId: 'title', box: { ...titleBox, w: 0 } }] }, {}, 'положительным'],
    ['гнездо, не привязанное в макете', { texts: { brand: ['Куртка'] } }, {}, 'не привязано'],
    ['чужое гнездо', { texts: { title: ['Куртка'] } }, {}, 'арт-директор наполняет только'],
    ['четвёртая строка', { texts: { subtitle: ['Куртка', 'Куртка', 'Куртка', 'Куртка'] } }, {}, 'нужно от 1 до 3'],
    ['пустой список строк', { texts: { subtitle: [] } }, {}, 'нужно от 1 до 3'],
    ['строка в 61 знак', { texts: { subtitle: ['а'.repeat(61)] } }, {}, 'длиннее 60'],
    ['число, которого нет в источнике', { texts: { kicker: ['Минус 40 градусов'] } }, {}, 'числа «40»'],
    ['число — другое, хоть и входит в чужое цифрами', { texts: { kicker: ['Нужно 15'] } }, {}, 'числа «15»'],
    ['слово без источника', { texts: { kicker: ['Хит продаж'] } }, {}, 'слова «продаж»'],
    ['иконка не из списка', { icons: [{ prop: 0, icon: 'rocket' }] }, {}, 'нет в списке'],
    ['индекс без слоя иконки', { icons: [{ prop: 1, icon: 'thermometer' }] }, {}, 'нет слоя иконки'],
    ['свойства нет у товара', { icons: [{ prop: 7, icon: null }] }, {}, 'нет такого свойства'],
    ['повтор свойства', { icons: [{ prop: 0, icon: null }, { prop: 0, icon: 'thermometer' }] }, {}, 'несколько раз'],
    ['лишний ключ ответа', { colors: [] }, {}, 'ключ «colors»'],
  ])('отвергает по отдельности: %s', (_name, raw, over, fragment) => {
    const { parts, complaints } = parse(raw, over)

    expect(parts).toEqual({ boxes: [], texts: {}, icons: [] })
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain(fragment)
  })

  it('возражение называет бокс адресом и числом: выход за правый край', () => {
    expect(parse({ boxes: [{ layerId: 'title', box: { ...titleBox, x: 0.6, w: 0.48 } }] }).complaints[0]).toBe(
      'бокс «title»: выходит за правый край (x + w = 1.08)',
    )
  })

  it('принимает «мужская» при источнике «мужской» и пустой ответ {}', () => {
    expect(parse({ texts: { kicker: ['Куртка мужская'] } }).parts.texts).toEqual({ kicker: ['Куртка мужская'] })
    expect(parse({})).toEqual({ parts: { boxes: [], texts: {}, icons: [] }, complaints: [] })
  })

  it('короткие слова не сверяются, а ё равна е', () => {
    expect(parse({ texts: { kicker: ['Для зимней куртки'] }, icons: [{ prop: 0, icon: null }] })).toMatchObject({
      parts: { texts: { kicker: ['Для зимней куртки'] }, icons: [{ prop: 0, icon: null }] },
      complaints: [],
    })
    expect(parse({ texts: { kicker: ['Ёлка'] } }, { source: ['Елка'] }).complaints).toEqual([])
  })

  it('ответ не объект — пустые части и одно возражение', () => {
    for (const raw of [null, 'текст', 42, ['boxes']]) {
      const { parts, complaints } = parse(raw)
      expect(parts).toEqual({ boxes: [], texts: {}, icons: [] })
      expect(complaints).toHaveLength(1)
    }
  })

  it('обрезает пробелы вокруг строк гнезда', () => {
    expect(parse({ texts: { kicker: ['  Куртка зимняя '] } }).parts.texts.kicker).toEqual(['Куртка зимняя'])
  })
})

describe('applyDirection и directedContent', () => {
  const direction: CardDirection = {
    boxes: [{ layerId: 'title', box: { x: 0.1, y: 0.2, w: 0.4, h: 0.1 } }],
    texts: { subtitle: ['Мужская'] },
    icons: [{ prop: 0, icon: 'thermometer' }, { prop: 1, icon: null }, { prop: 1, icon: 'missing' }],
  }

  it('applyDirection заменяет бокс слоя верхнего уровня и не мутирует вход', () => {
    const layout = layoutOf(baseLayers())
    const before = structuredClone(layout)

    const next = applyDirection(layout, direction)

    expect(layout).toEqual(before)
    expect(next).not.toBe(layout)
    expect(next.layers.find((layer) => layer.id === 'title')?.box).toEqual({ x: 0.1, y: 0.2, w: 0.4, h: 0.1 })
    expect(next.layers.find((layer) => layer.id === 'mod')).toBe(layout.layers.find((layer) => layer.id === 'mod'))
  })

  it('directedContent ставит иконку и строки гнёзд и не мутирует вход', () => {
    const before = structuredClone(CONTENT)

    const next = directedContent(CONTENT, direction, { thermometer: ICON })

    expect(CONTENT).toEqual(before)
    expect(next.texts).toEqual({ title: ['Куртка мужская'], subtitle: ['Мужская'] })
    expect(next.props[0]).toEqual({ label: 'Ткань', value: 'Мембрана', icon: ICON })
    // null и имя, которого нет среди готовых, иконку не ставят.
    expect(next.props[1]).toEqual(CONTENT.props[1])
  })
})
