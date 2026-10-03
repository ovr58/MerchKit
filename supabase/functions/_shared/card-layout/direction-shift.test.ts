import { describe, expect, it } from 'vitest'

import { SHIFT_LIMIT, shiftBareText } from './direction-shift.ts'
import type { ShiftInput } from './direction-shift.ts'
import { CONTENT, frame, layoutOf, moduleGroup, productMap, text } from './direction.fixtures.ts'
import type { Box, CardContent, Layer } from './types.ts'

/**
 * Сдвиг без ИИ (B5.11): голый текст на товаре уезжает в ближайшую годную свободную зону.
 * Товар на карте — справа от столбца `fromCol` из десяти; зоны `free` задаются в каждом тесте.
 */

const CONTENT_BODY: CardContent = { ...CONTENT, texts: { title: ['Куртка'], body: ['Тёплая'] } }

function shift(layers: Layer[], free: Box[], over: Partial<ShiftInput> = {}, fromCol = 7) {
  const layout = layoutOf(layers)
  return shiftBareText({
    library: layout,
    layout,
    content: CONTENT_BODY,
    canvasMap: productMap(fromCol, free),
    hasCutout: false,
    ...over,
  })
}

describe('shiftBareText (ADR-0018, п. 3)', () => {
  it('заголовок на товаре со свободной зоной рядом сдвигается в ближайшую точку зоны', () => {
    // Заголовок 0,6–0,9 по x: на товаре (от 0,7) — две трети бокса. Зона — слева, до 0,6.
    const title = { x: 0.5, y: 0.05, w: 0.3, h: 0.1 }
    const result = shift([frame, text('title', title, 'title')], [{ x: 0, y: 0, w: 0.6, h: 1 }])

    // Бокс прижимается к правому краю зоны: 0,6 − 0,3 = 0,3; по y он уже внутри зоны.
    expect(result).toEqual({ boxes: [{ layerId: 'title', box: { x: 0.3, y: 0.05, w: 0.3, h: 0.1 } }] })
  })

  it('сдвиг не меняет размер бокса', () => {
    const title = { x: 0.5, y: 0.05, w: 0.3, h: 0.1 }
    const [{ box }] = shift([frame, text('title', title, 'title')], [{ x: 0, y: 0, w: 0.6, h: 1 }]).boxes

    expect([box.w, box.h]).toEqual([0.3, 0.1])
  })

  it('зона, до которой дальше 0,25, не используется', () => {
    // Заголовок 0,65–0,9 на товаре; до зоны (правый край 0,3) сдвиг 0,6 — больше предела.
    const title = { x: 0.65, y: 0.05, w: 0.25, h: 0.1 }
    const result = shift([frame, text('title', title, 'title')], [{ x: 0, y: 0, w: 0.3, h: 1 }])

    expect(SHIFT_LIMIT).toBe(0.25)
    expect(result).toEqual({ boxes: [] })
  })

  it('зона уже бокса не используется', () => {
    // Бокс 0,3 в зоне 0,25: прижать его к краю зоны можно, но он из зоны вылезет.
    const title = { x: 0.45, y: 0.05, w: 0.3, h: 0.1 }
    const result = shift([frame, text('title', title, 'title')], [{ x: 0.3, y: 0, w: 0.25, h: 1 }])

    expect(result).toEqual({ boxes: [] })
  })

  it('зона ниже бокса по высоте не используется', () => {
    const title = { x: 0.55, y: 0.05, w: 0.2, h: 0.1 }
    const result = shift([frame, text('title', title, 'title')], [{ x: 0, y: 0.05, w: 0.6, h: 0.08 }])

    expect(result).toEqual({ boxes: [] })
  })

  it('место, где бокс после сдвига всё ещё лежит на товаре, не годится', () => {
    // Зона, которую карта называет свободной, но в которой ячейки заняты, — недоверие к ней.
    const title = { x: 0.72, y: 0.05, w: 0.2, h: 0.1 }
    const result = shift([frame, text('title', title, 'title')], [{ x: 0.4, y: 0, w: 0.5, h: 1 }])

    expect(result).toEqual({ boxes: [] })
  })

  it('сдвиг, наезжающий на модуль, не выбирается — берётся следующая зона', () => {
    // Модуль занимает 0,1–0,6 по x на высоте 0,4–0,5; заголовок — справа на товаре.
    const layers = [
      frame,
      text('title', { x: 0.6, y: 0.4, w: 0.2, h: 0.1 }, 'title'),
      moduleGroup({ x: 0.1, y: 0.4, w: 0.5, h: 0.1 }),
    ]
    const near = { x: 0, y: 0.35, w: 0.7, h: 0.3 } // ближайшая: сядет на модуль
    const far = { x: 0.3, y: 0.2, w: 0.4, h: 0.2 } // свободная от модуля, смещение 0,2

    expect(shift(layers, [near, far])).toEqual({
      boxes: [{ layerId: 'title', box: { x: 0.5, y: 0.3, w: 0.2, h: 0.1 } }],
    })
    // Без второй зоны годного места нет: слой остаётся.
    expect(shift(layers, [near])).toEqual({ boxes: [] })
  })

  it('из годных зон берётся с наименьшим смещением', () => {
    // Заголовок 0,5–0,8 на высоте 0,5–0,6: товар справа от 0,7. Обе зоны годны; в первой по
    // порядку придётся сместиться ещё и по y, во второй — только по x.
    const layers = [frame, text('title', { x: 0.5, y: 0.5, w: 0.3, h: 0.1 }, 'title')]
    const farther = { x: 0, y: 0.45, w: 0.6, h: 0.12 }
    const closer = { x: 0, y: 0.4, w: 0.6, h: 0.3 }

    expect(shift(layers, [farther, closer]).boxes[0].box).toEqual({ x: 0.3, y: 0.5, w: 0.3, h: 0.1 })
  })

  it('при равном смещении берётся первая зона по порядку free', () => {
    // Заголовок на товаре (от 0,6); верхняя и нижняя зоны — по 0,05 по y от него.
    const layers = [frame, text('title', { x: 0.6, y: 0.5, w: 0.1, h: 0.1 }, 'title')]
    const upper = { x: 0, y: 0.4, w: 0.6, h: 0.15 }
    const lower = { x: 0, y: 0.55, w: 0.6, h: 0.15 }

    expect(shift(layers, [upper, lower], {}, 6).boxes[0].box.y).toBe(0.45)
    expect(shift(layers, [lower, upper], {}, 6).boxes[0].box.y).toBe(0.55)
  })

  it('два слоя на товаре: второй учитывает новое положение первого', () => {
    // Оба — на товаре справа (от 0,7); единственная зона слева. Второй по смещению влез бы
    // в зону, но на новое место первого — наезжает, а на старое не наезжал.
    const layers = [
      frame,
      text('title', { x: 0.72, y: 0.1, w: 0.1, h: 0.15 }, 'title'),
      text('body', { x: 0.72, y: 0.3, w: 0.1, h: 0.1 }, 'body'),
    ]
    const zone = { x: 0.3, y: 0.1, w: 0.4, h: 0.2 }

    const result = shift(layers, [zone])

    expect(result.boxes).toEqual([{ layerId: 'title', box: { x: 0.6, y: 0.1, w: 0.1, h: 0.15 } }])
  })

  it('слои сдвигаются в порядке макета, а не в порядке z текстов', () => {
    const layers = [
      frame,
      text('title', { x: 0.72, y: 0.1, w: 0.1, h: 0.15 }, 'title', 8),
      text('body', { x: 0.72, y: 0.3, w: 0.1, h: 0.1 }, 'body', 3),
    ]

    const result = shift(layers, [{ x: 0.3, y: 0.1, w: 0.4, h: 0.2 }])

    expect(result.boxes.map((entry) => entry.layerId)).toEqual(['title'])
  })

  it('без карты — пусто', () => {
    const title = { x: 0.5, y: 0.05, w: 0.3, h: 0.1 }
    expect(shift([frame, text('title', title, 'title')], [], { canvasMap: null })).toEqual({ boxes: [] })
  })

  it('текст не на товаре не сдвигается', () => {
    const title = { x: 0.05, y: 0.05, w: 0.3, h: 0.1 }
    expect(shift([frame, text('title', title, 'title')], [{ x: 0, y: 0.5, w: 0.6, h: 0.5 }])).toEqual({ boxes: [] })
  })

  it('налегание, которое было в библиотеке, не мешает сдвигу', () => {
    // Модуль и заголовок налегают друг на друга уже в библиотеке (на всю площадь заголовка);
    // сдвиг в зону, где они налегают так же, допустим.
    const library = layoutOf([
      frame,
      text('title', { x: 0.1, y: 0.4, w: 0.2, h: 0.1 }, 'title'),
      moduleGroup({ x: 0.1, y: 0.4, w: 0.5, h: 0.1 }),
    ])
    const current = layoutOf([
      frame,
      text('title', { x: 0.6, y: 0.4, w: 0.2, h: 0.1 }, 'title'),
      moduleGroup({ x: 0.1, y: 0.4, w: 0.5, h: 0.1 }),
    ])

    const result = shift([], [{ x: 0, y: 0.35, w: 0.7, h: 0.3 }], { library, layout: current })

    expect(result.boxes).toHaveLength(1)
    expect(result.boxes[0].box).toEqual({ x: 0.5, y: 0.4, w: 0.2, h: 0.1 })
  })
})
