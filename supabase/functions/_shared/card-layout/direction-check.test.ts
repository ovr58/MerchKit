import { describe, expect, it } from 'vitest'

import { OVERLAP_SLACK, combineDirection, overlapShare } from './direction-check.ts'
import type { CombineInput } from './direction-check.ts'
import type { CardDirection } from './direction.ts'
import {
  CONTENT,
  FONTS,
  ICON,
  SIZE,
  baseLayers,
  byLength,
  layoutOf,
  plate,
  productMap,
  text,
} from './direction.fixtures.ts'
import type { Box, CardContent, Layer } from './types.ts'

/**
 * Сборка итога правки (B5.5): каждая часть принимается или отвергается сама по себе.
 * Обмерщик подменный (ширина = число знаков × 10 px), карта — ручная: товар справа от 0,6.
 */

const EMPTY: CardDirection = { boxes: [], texts: {}, icons: [] }
const TITLE: Box = { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }
const MOD: Box = { x: 0.05, y: 0.7, w: 0.3, h: 0.1 }
const ON_PRODUCT: Box = { x: 0.5, y: 0.05, w: 0.5, h: 0.1 }
const CUTOUT: Layer = {
  id: 'cutout',
  type: 'cutout',
  z: 9,
  box: { x: 0, y: 0, w: 1, h: 1 },
  fit: 'cover',
  bind: { kind: 'cutout' },
}

function combine(parts: Partial<CardDirection>, over: Partial<CombineInput> = {}) {
  return combineDirection({
    library: layoutOf(baseLayers()),
    libraryContent: CONTENT,
    parts: { ...EMPTY, ...parts },
    size: SIZE,
    fonts: FONTS,
    measure: byLength,
    canvasMap: productMap(),
    hasCutout: false,
    iconRefs: { thermometer: ICON },
    ...over,
  })
}

const FILL: Partial<CardDirection> = {
  texts: { subtitle: ['Мужская'], kicker: ['Зимняя'] },
  icons: [{ prop: 0, icon: 'thermometer' }],
}

describe('overlapShare', () => {
  it('делит пересечение на площадь меньшего бокса', () => {
    const big = { x: 0, y: 0, w: 0.5, h: 0.5 }
    expect(overlapShare(big, { x: 0.4, y: 0, w: 0.2, h: 0.2 })).toBeCloseTo(0.5)
    expect(overlapShare(big, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBe(1)
    expect(overlapShare(big, { x: 0.6, y: 0, w: 0.2, h: 0.2 })).toBe(0)
    expect(OVERLAP_SLACK).toBe(0.05)
  })

  it('плоский бокс (линия) ни на что не налегает', () => {
    expect(overlapShare({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.1, y: 0.2, w: 0.3, h: 0 })).toBe(0)
  })
})

describe('combineDirection (ADR-0018, п. 2, проверки 3–6)', () => {
  it('ответ без изменений: в rejected пусто, всё принято', () => {
    const parts = { ...FILL, boxes: [{ layerId: 'title', box: TITLE }] }
    const { direction, rejected } = combine(parts)

    expect(rejected).toEqual([])
    expect(direction).toEqual({ ...EMPTY, ...parts })
  })

  it('сужение бокса до переполнения отвергает только этот бокс; иконка и гнездо остаются', () => {
    // «Куртка мужская» — 140 px; бокс 0,3 × 300 = 90 px.
    // Высота 20 px — одна строка: переносить некуда.
    const narrow = { ...TITLE, w: 0.3, h: 0.05 }
    const { direction, rejected } = combine({ ...FILL, boxes: [{ layerId: 'title', box: narrow }] })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('бокс «title»')
    expect(rejected[0].reason).toMatch(/^строка «Куртка мужская» шире бокса на 56%/)
    expect(direction.boxes).toEqual([])
    expect(direction.texts).toEqual(FILL.texts)
    expect(direction.icons).toEqual(FILL.icons)
  })

  it('перенос заголовка учтён: бокс на две строки сужается по ширине без отказа', () => {
    // «Куртка мужская» — 140 px; бокс 0,3 × 300 = 90 px, высота 40 px вмещает две строки по
    // 19,2 px: «Куртка» / «мужская» — 80 px, влезает. Без переноса сверка отвергла бы годную правку.
    const narrow = { ...TITLE, w: 0.3 }
    const { direction, rejected } = combine({ boxes: [{ layerId: 'title', box: narrow }] })

    expect(rejected).toEqual([])
    expect(direction.boxes).toEqual([{ layerId: 'title', box: narrow }])
  })

  it('перенос заголовка учтён: бокс, потерявший вторую строку, отвергается, хотя ширина прежняя', () => {
    // Библиотека — бокс 90 × 40 px: две строки, заголовок переносится и влезает. Правка срезает
    // высоту до 20 px — одна строка, «Куртка мужская» 140 px вылезает на 56%. Без переноса
    // обе стороны дали бы одно и то же переполнение по ширине, и правку приняли бы.
    const library = layoutOf(baseLayers({ ...TITLE, w: 0.3 }))
    const flat = { ...TITLE, w: 0.3, h: 0.05 }

    const { direction, rejected } = combine({ boxes: [{ layerId: 'title', box: flat }] }, { library })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('бокс «title»')
    expect(rejected[0].reason).toMatch(/^строка «Куртка мужская» шире бокса на 56%/)
    expect(direction.boxes).toEqual([])
  })

  it('высота: блок строк выше бокса отвергает бокс', () => {
    const layers = baseLayers()
    layers[1] = { ...text('title', TITLE, 'title'), lines: ['А', 'Б', 'В'] }
    // Три строки по 19,2 px — 57,6 px; бокс 0,1 × 400 = 40 px — библиотека уже переполнена на 44%.
    // Растянуть бокс — не хуже; сжать до 0,07 — хуже.
    const library = layoutOf(layers)

    const worse = combine({ boxes: [{ layerId: 'title', box: { ...TITLE, h: 0.07 } }] }, { library })
    expect(worse.rejected[0].reason).toMatch(/^блок выше бокса на /)

    const better = combine({ boxes: [{ layerId: 'title', box: { ...TITLE, h: 0.15 } }] }, { library })
    expect(better.rejected).toEqual([])
  })

  it('переполнение, которое было и у библиотеки, не отвергается', () => {
    // Подпись модуля — 58,5 px; «Материал» — 80 px: у библиотеки то же переполнение.
    const content: CardContent = { ...CONTENT, props: [{ label: 'Материал', value: 'x' }] }
    const moved = { ...MOD, y: 0.75 }

    const { direction, rejected } = combine({ boxes: [{ layerId: 'mod', box: moved }] }, { libraryContent: content })

    expect(rejected).toEqual([])
    expect(direction.boxes).toEqual([{ layerId: 'mod', box: moved }])
  })

  it('но ухудшить переполнение библиотеки нельзя: сжатый модуль отвергается', () => {
    const content: CardContent = { ...CONTENT, props: [{ label: 'Материал', value: 'x' }] }

    const { rejected } = combine({ boxes: [{ layerId: 'mod', box: { ...MOD, w: 0.2 } }] }, { libraryContent: content })

    expect(rejected.map((entry) => entry.part)).toEqual(['бокс «mod»'])
  })

  it('не влезающее гнездо отвергает строки гнезда, остальное остаётся', () => {
    const { direction, rejected } = combine({
      ...FILL,
      texts: { subtitle: ['Мужская зимняя куртка'], kicker: ['Зимняя'] },
    })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('гнездо «subtitle»')
    expect(direction.texts).toEqual({ kicker: ['Зимняя'] })
    expect(direction.icons).toEqual(FILL.icons)
  })

  it('голый заголовок, перенесённый на товар, отвергается, а сдвиг модуля в том же ответе принят', () => {
    const moved = { ...MOD, y: 0.8 }
    const { direction, rejected } = combine({
      boxes: [
        { layerId: 'title', box: ON_PRODUCT },
        { layerId: 'mod', box: moved },
      ],
    })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('бокс «title»')
    expect(rejected[0].reason).toMatch(/^текст «Куртка мужская» лежит на товаре на \d+% \(допустимо 15%\)$/)
    expect(direction.boxes).toEqual([{ layerId: 'mod', box: moved }])
  })

  it('заголовок, который в библиотеке уже на товаре, не хуже библиотеки — не отвергается', () => {
    const library = layoutOf(baseLayers(ON_PRODUCT))
    // Тот же бокс чуть ниже: занятость та же, что у библиотеки.
    const { rejected } = combine({ boxes: [{ layerId: 'title', box: { ...ON_PRODUCT, y: 0.06 } }] }, { library })

    expect(rejected).toEqual([])
  })

  it('уезжающая из-под заголовка плашка, после которой заголовок голый на товаре, отвергается', () => {
    const library = layoutOf([...baseLayers(ON_PRODUCT), plate('plate', { x: 0.45, y: 0.03, w: 0.55, h: 0.14 }, 1)])
    const away = { x: 0.05, y: 0.03, w: 0.4, h: 0.14 }

    const { direction, rejected } = combine(
      { ...FILL, boxes: [{ layerId: 'plate', box: away }] },
      { library },
    )

    expect(rejected.map((entry) => entry.part)).toEqual(['бокс «plate»'])
    expect(rejected[0].reason).toContain('лежит на товаре')
    expect(direction.boxes).toEqual([])
    expect(direction.icons).toEqual(FILL.icons)
  })

  it('заголовок, наехавший на модуль, отвергается по налеганию', () => {
    // Заголовок вне товара, но лежит на модуле свойств.
    const { direction, rejected } = combine({ boxes: [{ layerId: 'title', box: { ...TITLE, y: 0.68 } }] })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('бокс «title»')
    expect(rejected[0].reason).toMatch(/^«title» налегает на «mod» на \d+% \(в библиотеке 0%\)$/)
    expect(direction.boxes).toEqual([])
  })

  it('налегание не хуже библиотеки допускается: слои, налегавшие и раньше', () => {
    const library = layoutOf([...baseLayers(), plate('under', { x: 0.04, y: 0.04, w: 0.52, h: 0.12 }, 1)])
    // Плашка под заголовком налегает на него целиком и в библиотеке; сдвиг обоих на сотую — тот же 100%.
    const { rejected } = combine(
      {
        boxes: [
          { layerId: 'title', box: { ...TITLE, y: 0.06 } },
          { layerId: 'under', box: { x: 0.04, y: 0.05, w: 0.52, h: 0.12 } },
        ],
      },
      { library },
    )

    expect(rejected).toEqual([])
  })

  it('оба принятых бокса пары, налегших друг на друга, отвергаются', () => {
    const { direction, rejected } = combine({
      boxes: [
        { layerId: 'title', box: { ...TITLE, y: 0.68 } },
        { layerId: 'mod', box: { ...MOD, y: 0.65 } },
      ],
    })

    expect(rejected.map((entry) => entry.part)).toEqual(['бокс «title»', 'бокс «mod»'])
    expect(direction.boxes).toEqual([])
  })

  it('отвергнутый бокс возвращает слой на место: следующие пары судятся уже по новому положению', () => {
    // Заголовок наезжает на подзаголовок и отвергается; ушедший вверх заголовок кикера уже не
    // задевает, поэтому принятый бокс кикера остаётся.
    const kicker = { x: 0.05, y: 0.28, w: 0.3, h: 0.05 }
    const { direction, rejected } = combine({
      boxes: [
        { layerId: 'title', box: { x: 0.05, y: 0.2, w: 0.5, h: 0.1 } },
        { layerId: 'kicker', box: kicker },
      ],
    })

    expect(rejected.map((entry) => entry.part)).toEqual(['бокс «title»'])
    expect(direction.boxes).toEqual([{ layerId: 'kicker', box: kicker }])
  })

  it('кадр и вырез блоками не считаются: налегание на них не проверяется', () => {
    const cutout: Layer = { ...CUTOUT, box: { x: 0.4, y: 0, w: 0.6, h: 1 } }
    const content = { ...CONTENT, cutout: ICON }
    const library = layoutOf([...baseLayers(), cutout])
    const onCutout = { boxes: [{ layerId: 'title', box: { ...TITLE, x: 0.45 } }] }

    // Заголовок ляжет на вырез (за ним по z, при вырезе на сборке) — налегание не в счёт.
    expect(combine(onCutout, { library, libraryContent: content, hasCutout: true, canvasMap: null }).rejected).toEqual([])

    const partialFrame: Layer = { ...baseLayers()[0], box: { x: 0, y: 0, w: 1, h: 0.6 } }
    const lower = layoutOf([partialFrame, ...baseLayers().slice(1)].map((l) => (l.id === 'title' ? { ...l, box: { ...TITLE, y: 0.65 } } : l)))
    // Заголовок из-под кадра уходит на кадр — налегание на кадр не в счёт.
    expect(combine({ boxes: [{ layerId: 'title', box: { ...TITLE, y: 0.5 } }] }, { library: lower }).rejected).toEqual([])
  })

  it('текст с z ниже выреза при hasCutout на товар не проверяется', () => {
    const library = layoutOf([...baseLayers(), CUTOUT])
    const content = { ...CONTENT, cutout: ICON }
    const parts = { boxes: [{ layerId: 'title', box: ON_PRODUCT }] }

    const behind = combine(parts, { library, libraryContent: content, hasCutout: true })
    expect(behind.rejected).toEqual([])
    expect(behind.direction.boxes).toHaveLength(1)

    const open = combine(parts, { library, libraryContent: content, hasCutout: false })
    expect(open.rejected).toHaveLength(1)
  })

  it('без карты занятость не проверяется', () => {
    const { direction, rejected } = combine({ boxes: [{ layerId: 'title', box: ON_PRODUCT }] }, { canvasMap: null })

    expect(rejected).toEqual([])
    expect(direction.boxes).toHaveLength(1)
  })

  it('валидатор: бокс, с которым макет не собирается, отвергается, соседний принят', () => {
    const bad = { x: -0.9, y: 0.05, w: 0.5, h: 0.1 }
    const moved = { ...MOD, y: 0.8 }

    const { direction, rejected } = combine({
      boxes: [
        { layerId: 'title', box: bad },
        { layerId: 'mod', box: moved },
      ],
    })

    expect(rejected).toHaveLength(1)
    expect(rejected[0].part).toBe('бокс «title»')
    expect(rejected[0].reason).toMatch(/^валидатор: /)
    expect(direction.boxes).toEqual([{ layerId: 'mod', box: moved }])
  })

  it('не мутирует входные части', () => {
    const parts = { ...FILL, boxes: [{ layerId: 'title', box: { ...TITLE, w: 0.3 } }] }
    const before = structuredClone(parts)

    combine(parts)

    expect({ ...EMPTY, ...parts }).toEqual({ ...EMPTY, ...before })
  })
})
