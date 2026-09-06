import { describe, expect, it } from 'vitest'

import { OCCUPIED_AT, occupancyOf, occupancyOfBox } from './occupancy.ts'
import type { MaskSamples } from './occupancy.ts'

/** Маска строится формулой, а не моделью: карту проверяем на геометрии, которую сами задали,
 *  иначе тест мерил бы вырез, а не карту. Весов и коробки здесь не нужно (шаг B4). */
function maskOf(
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number,
): MaskSamples {
  const alpha = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = alphaAt(x, y)
  }
  return { width, height, alpha }
}

/** Товар — прямоугольник в долях кадра. Границы кладём по границам ячеек: тест про карту, а
 *  не про то, куда попал край сетки. */
function solidRect(size: number, box: { x: number; y: number; w: number; h: number }) {
  return (x: number, y: number): number => {
    const inside =
      x >= box.x * size && x < (box.x + box.w) * size &&
      y >= box.y * size && y < (box.y + box.h) * size
    return inside ? 255 : 0
  }
}

const CENTER = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }

describe('Карта занятости кадра', () => {
  it('на пустой маске говорит «товара нет», а не «занято ноль»', () => {
    const map = occupancyOf(maskOf(320, 320, () => 0))

    expect(map.bounds).toBeNull()
    expect(map.coverage).toBe(0)
    expect(map.free).toEqual([{ x: 0, y: 0, w: 1, h: 1 }])
  })

  it('на кадре, целиком занятом товаром, не предлагает мест', () => {
    const map = occupancyOf(maskOf(320, 320, () => 255))

    expect(map.coverage).toBe(1)
    expect(map.bounds).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(map.free).toEqual([])
  })

  it('даёт габарит товара, долю кадра и места под текст', () => {
    const map = occupancyOf(maskOf(320, 320, solidRect(320, CENTER)))

    expect(map.bounds).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
    expect(map.coverage).toBe(0.25)
    // Полосы над товаром и под ним — по четыре ряда ячеек во всю ширину.
    expect(map.free).toContainEqual({ x: 0, y: 0, w: 1, h: 0.25 })
    expect(map.free).toContainEqual({ x: 0, y: 0.75, w: 1, h: 0.25 })
    // И колонки слева и справа от него — во всю высоту.
    expect(map.free).toContainEqual({ x: 0, y: 0, w: 0.25, h: 1 })
    expect(map.free).toContainEqual({ x: 0.75, y: 0, w: 0.25, h: 1 })
  })

  it('одинакова на маске 320 и на маске 1024 — размер маски это свойство модели', () => {
    const small = occupancyOf(maskOf(320, 320, solidRect(320, CENTER)))
    const large = occupancyOf(maskOf(1024, 1024, solidRect(1024, CENTER)))

    expect(large).toEqual(small)
  })

  it('не сдвигается от мягкой кромки: полутон усредняется, а не переключает ячейку', () => {
    const hard = occupancyOf(maskOf(320, 320, solidRect(320, CENTER)))
    const soft = occupancyOf(
      maskOf(320, 320, (x, y) => {
        // Кайма в шесть пикселей внутрь контура — вдвое шире того, что дают настоящие модели.
        const toEdge = Math.min(x - 80, 239 - x, y - 80, 239 - y)
        if (toEdge < 0) return 0
        return toEdge >= 6 ? 255 : Math.round((toEdge / 6) * 255)
      }),
    )

    expect(soft.bounds).toEqual(hard.bounds)
    expect(soft.free).toEqual(hard.free)
    expect(Math.abs(soft.coverage - hard.coverage)).toBeLessThanOrEqual(0.02)
  })

  it('считает занятой дыру внутри контура — просвет не место под текст', () => {
    const holed = occupancyOf(
      maskOf(320, 320, (x, y) => {
        const inHole = x >= 140 && x < 180 && y >= 140 && y < 180
        return !inHole && solidRect(320, CENTER)(x, y) === 255 ? 255 : 0
      }),
    )
    const whole = occupancyOf(maskOf(320, 320, solidRect(320, CENTER)))

    // Дыра 2×2 ячейки прошла бы в места под текст, если бы карта просто уменьшала маску.
    expect(holed.cells[7 * 16 + 7]).toBe(1)
    expect(holed.free).toEqual(whole.free)
    expect(holed.coverage).toBe(whole.coverage)
  })

  it('не съедает фон между двумя предметами: заперто по строке — ещё не внутренность', () => {
    // Пара предметов: две колонки ячеек 2–5 и 10–13, во всю высоту кадра.
    const map = occupancyOf(
      maskOf(320, 320, (x) => ((x >= 40 && x < 120) || (x >= 200 && x < 280) ? 255 : 0)),
    )

    expect(map.cells[8 * 16 + 7]).toBe(0)
    expect(map.free).toContainEqual({ x: 0.38, y: 0, w: 0.25, h: 1 })
  })

  it('свободные зоны идут от крупной к мелкой и не вкладываются друг в друга', () => {
    // Товар в правом нижнем углу: слева широкая колонка, сверху — полоса пониже.
    const map = occupancyOf(maskOf(320, 320, solidRect(320, { x: 0.5, y: 0.75, w: 0.5, h: 0.25 })))

    const areas = map.free.map((zone) => zone.w * zone.h)
    expect(areas).toEqual([...areas].sort((left, right) => right - left))
    expect(map.free[0]).toEqual({ x: 0, y: 0, w: 1, h: 0.75 })
  })

  it('ячейки сетки близки к квадратным на кадре не-квадратной пропорции', () => {
    const map = occupancyOf(maskOf(1024, 1536, () => 0))

    expect({ cols: map.cols, rows: map.rows }).toEqual({ cols: 11, rows: 16 })
  })

  it('не принимает маску, не сходящуюся с заявленным размером', () => {
    expect(() => occupancyOf({ width: 4, height: 4, alpha: new Uint8Array(8) })).toThrow(
      /не сходится/,
    )
  })
})

describe('Занятость предложенного бокса', () => {
  const map = occupancyOf(maskOf(320, 320, solidRect(320, CENTER)))

  it('отвечает 0 на фоне и 1 на товаре', () => {
    expect(occupancyOfBox(map, { x: 0, y: 0, w: 0.25, h: 0.25 })).toBe(0)
    expect(occupancyOfBox(map, CENTER)).toBe(1)
  })

  it('считает долю бокса, а не факт пересечения — на этом держится приём «текст за товаром»', () => {
    expect(occupancyOfBox(map, { x: 0.25, y: 0, w: 0.5, h: 0.5 })).toBe(0.5)
    expect(occupancyOfBox(map, { x: 0.25, y: 0, w: 0.5, h: 1 })).toBe(0.5)
  })

  it('взвешивает ячейки перекрытием: бокс не обязан ложиться по сетке', () => {
    // Половина ряда ячеек по высоте: четверть бокса на товаре.
    expect(occupancyOfBox(map, { x: 0.25, y: 0.1875, w: 0.5, h: 0.125 })).toBe(0.5)
    expect(occupancyOfBox(map, { x: 0.25, y: 0.21875, w: 0.5, h: 0.0625 })).toBe(0.5)
  })

  it('обрезает вылет за обрез и не считает пустой бокс', () => {
    expect(occupancyOfBox(map, { x: -0.5, y: 0.25, w: 0.75, h: 0.5 })).toBe(0)
    // Доля берётся от видимой части бокса: за краем кадра товара нет ни у кого, и считать её
    // фоном значило бы занижать занятость тем сильнее, чем дальше слой уехал за обрез.
    expect(occupancyOfBox(map, { x: -0.5, y: 0.25, w: 1.25, h: 0.5 })).toBe(0.67)
    expect(occupancyOfBox(map, { x: 1.2, y: 0, w: 0.3, h: 0.3 })).toBe(0)
    expect(occupancyOfBox(map, { x: 0.25, y: 0.25, w: 0, h: 0.5 })).toBe(0)
  })

  it('порог занятой ячейки — половина: карта отвечает про товар, а не про кромку', () => {
    expect(OCCUPIED_AT).toBe(0.5)
  })
})
