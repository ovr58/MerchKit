import { describe, expect, it } from 'vitest'

import { canvasBoxToFrame, frameBoxToCanvas, frameToCanvas } from './frame-space.ts'
import { occupancyOf, occupancyOfBox } from './occupancy.ts'
import type { OccupancyMap } from './occupancy.ts'
import { composeSvg } from './svg.ts'
import type { FontFamilies } from './svg.ts'
import type { Box, FitMode, Focus } from './types.ts'

/** Карта кадра строится из маски «один пиксель = одна ячейка» (16 по длинной стороне): геометрию
 *  задаём сами, границы товара ложатся ровно на границы ячеек, модель и коробка не нужны. */
function frameMap(cols: number, rows: number, occupiedAt: (col: number, row: number) => boolean): OccupancyMap {
  const alpha = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) alpha[row * cols + col] = occupiedAt(col, row) ? 255 : 0
  }
  return occupancyOf({ width: cols, height: rows, alpha })
}

function layerOf(box: Box, fit: FitMode, focus?: Focus) {
  return { box, fit, focus }
}

const FULL: Box = { x: 0, y: 0, w: 1, h: 1 }
const SQUARE = { width: 1000, height: 1000 }

/** Ячейки строки `row` карты, округлённые до сотых — для сравнения глазами. */
function rowOf(map: OccupancyMap, row: number): number[] {
  return map.cells.slice(row * map.cols, (row + 1) * map.cols)
}

describe('Кадр во весь холст той же пропорции', () => {
  it('квадратный кадр на квадратном холсте — тождество', () => {
    const map = frameMap(16, 16, (col, row) => col >= 3 && col < 9 && row >= 5 && row < 14)

    expect(frameToCanvas(map, layerOf(FULL, 'cover'), SQUARE, SQUARE)).toEqual(map)
    expect(frameToCanvas(map, layerOf(FULL, 'contain'), SQUARE, SQUARE)).toEqual(map)
  })

  it('кадр 3:4 на холсте 3:4 другого размера — тождество', () => {
    const map = frameMap(12, 16, (col, row) => col >= 2 && col < 7 && row >= 3 && row < 12)

    // Пиксели другие, пропорция та же: карта от размера не зависит.
    const result = frameToCanvas(map, layerOf(FULL, 'cover'), { width: 1500, height: 2000 }, { width: 600, height: 800 })

    expect(result).toEqual(map)
  })
})

describe('Мягкая кромка', () => {
  it('полутон ячейки доезжает до холста как есть, а не округляется до товара', () => {
    const alpha = new Uint8Array(16 * 16)
    for (let row = 0; row < 16; row += 1) {
      alpha[row * 16 + 2] = 255
      alpha[row * 16 + 3] = 100
    }
    const map = occupancyOf({ width: 16, height: 16, alpha })

    const result = frameToCanvas(map, layerOf(FULL, 'cover'), SQUARE, SQUARE)

    expect(result.cells[3]).toBe(0.39)
    expect(result.bounds).toEqual({ x: 0.13, y: 0, w: 0.06, h: 1 })
  })
})

describe('cover на более узком холсте срезает края кадра', () => {
  // Кадр 1000×1000, холст 500×1000: кадр увеличен до высоты холста, влезает его половина по
  // ширине. Сетка холста 8×16, а видимые 8 ячеек кадра ложатся на неё один к одному.
  // Товар: края кадра (ячейки 0–3 и 12–15) плюс по две ячейки у центра (4–5 и 10–11).
  const edges = (col: number) => col < 6 || (col >= 10 && col <= 11) || col >= 12
  const map = frameMap(16, 16, (col) => edges(col))
  const NARROW = { width: 500, height: 1000 }

  it('при центральном focus срезает края симметрично', () => {
    const result = frameToCanvas(map, layerOf(FULL, 'cover', { x: 0.5, y: 0.5 }), NARROW, SQUARE)

    // Видны ячейки кадра 4–11; края 0–3 и 12–15 срезаны и в карту не попали.
    expect(rowOf(result, 0)).toEqual([1, 1, 0, 0, 0, 0, 1, 1])
    expect(result.cols).toBe(8)
    expect(result.rows).toBe(16)
    expect(result.free).toEqual([{ x: 0.25, y: 0, w: 0.5, h: 1 }])
  })

  it('при focus у левого края режет правую половину кадра', () => {
    const result = frameToCanvas(map, layerOf(FULL, 'cover', { x: 0, y: 0.5 }), NARROW, SQUARE)

    // Видны ячейки кадра 0–7: левый край и ячейки 4–5 товар, 6–7 фон.
    expect(rowOf(result, 0)).toEqual([1, 1, 1, 1, 1, 1, 0, 0])
    expect(result.bounds).toEqual({ x: 0, y: 0, w: 0.75, h: 1 })
  })

  it('при focus у правого края режет левую половину кадра', () => {
    const result = frameToCanvas(map, layerOf(FULL, 'cover', { x: 1, y: 0.5 }), NARROW, SQUARE)

    // Видны ячейки кадра 8–15.
    expect(rowOf(result, 0)).toEqual([0, 0, 1, 1, 1, 1, 1, 1])
    expect(result.bounds).toEqual({ x: 0.25, y: 0, w: 0.75, h: 1 })
  })

  it('товар только в срезанной части — на холсте его нет', () => {
    const onlyEdges = frameMap(16, 16, (col) => col < 4 || col >= 12)
    const result = frameToCanvas(onlyEdges, layerOf(FULL, 'cover'), NARROW, SQUARE)

    expect(result.bounds).toBeNull()
    expect(result.coverage).toBe(0)
  })
})

describe('contain оставляет поля, а бокс слоя сдвигает кадр', () => {
  const solid = frameMap(16, 16, () => true)
  const WIDE = { width: 2000, height: 1000 }

  it('поля вне кадра свободны и предлагаются как места', () => {
    const result = frameToCanvas(solid, layerOf(FULL, 'contain'), WIDE, SQUARE)

    // Кадр квадратный, холст 2:1: кадр занимает середину, по четверти холста слева и справа.
    expect(result.cols).toBe(16)
    expect(result.rows).toBe(8)
    expect(rowOf(result, 0)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0])
    expect(result.coverage).toBe(0.5)
    expect(result.free).toEqual([
      { x: 0, y: 0, w: 0.25, h: 1 },
      { x: 0.75, y: 0, w: 0.25, h: 1 },
    ])
    expect(occupancyOfBox(result, { x: 0, y: 0, w: 0.2, h: 1 })).toBe(0)
  })

  it('focus прижимает кадр к краю — поле остаётся с другой стороны', () => {
    const left = frameToCanvas(solid, layerOf(FULL, 'contain', { x: 0, y: 0.5 }), WIDE, SQUARE)
    const right = frameToCanvas(solid, layerOf(FULL, 'contain', { x: 1, y: 0.5 }), WIDE, SQUARE)

    expect(left.bounds).toEqual({ x: 0, y: 0, w: 0.5, h: 1 })
    expect(right.bounds).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
  })

  it('кадр в боксе слоя не во весь холст — вне бокса свободно, срез идёт по боксу', () => {
    // Бокс — правая половина квадратного холста; cover: кадр вдвое шире бокса, видна середина.
    const result = frameToCanvas(solid, layerOf({ x: 0.5, y: 0, w: 0.5, h: 1 }, 'cover'), SQUARE, SQUARE)

    expect(result.coverage).toBe(0.5)
    expect(result.bounds).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(result.free).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }])
  })
})

describe('Пересчёт бокса туда и обратно', () => {
  const cases: { name: string; layer: ReturnType<typeof layerOf>; canvas: { width: number; height: number }; frame: { width: number; height: number } }[] = [
    { name: 'cover, центр', layer: layerOf(FULL, 'cover'), canvas: { width: 500, height: 1000 }, frame: SQUARE },
    { name: 'cover, focus у края', layer: layerOf(FULL, 'cover', { x: 1, y: 0 }), canvas: { width: 1000, height: 600 }, frame: { width: 800, height: 1200 } },
    { name: 'contain, центр', layer: layerOf(FULL, 'contain'), canvas: { width: 2000, height: 1000 }, frame: SQUARE },
    { name: 'contain в боксе слоя', layer: layerOf({ x: 0.1, y: 0.2, w: 0.6, h: 0.5 }, 'contain', { x: 0.2, y: 0.9 }), canvas: { width: 900, height: 1200 }, frame: { width: 1600, height: 900 } },
  ]
  const boxes: Box[] = [
    { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
    { x: 0.5, y: 0.4, w: 0.45, h: 0.5 },
    { x: 0, y: 0, w: 1, h: 1 },
  ]

  for (const { name, layer, canvas, frame } of cases) {
    it(`${name}: кадр → холст → кадр возвращает тот же бокс`, () => {
      for (const box of boxes) {
        const onCanvas = frameBoxToCanvas(box, layer, canvas, frame)
        const back = canvasBoxToFrame(onCanvas, layer, canvas, frame)

        expect(back.x).toBeCloseTo(box.x, 2)
        expect(back.y).toBeCloseTo(box.y, 2)
        expect(back.w).toBeCloseTo(box.w, 2)
        expect(back.h).toBeCloseTo(box.h, 2)
      }
    })
  }

  it('кадр на весь холст той же пропорции: бокс не меняется', () => {
    const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 }

    expect(canvasBoxToFrame(box, layerOf(FULL, 'cover'), SQUARE, SQUARE)).toEqual(box)
  })

  it('бокс слоя нулевой ширины — явная ошибка, а не деление на ноль', () => {
    expect(() =>
      canvasBoxToFrame(FULL, layerOf({ x: 0, y: 0, w: 0, h: 1 }, 'contain'), SQUARE, SQUARE),
    ).toThrow(/не виден/)
  })
})

describe('Входные размеры', () => {
  it('нулевой размер кадра или холста — ошибка', () => {
    const map = frameMap(16, 16, () => true)

    expect(() => frameToCanvas(map, layerOf(FULL, 'cover'), SQUARE, { width: 0, height: 100 })).toThrow(/кадр/)
    expect(() => frameToCanvas(map, layerOf(FULL, 'cover'), { width: 100, height: 0 }, SQUARE)).toThrow(/холст/)
  })
})

describe('Арифметика совпадает со сборщиком', () => {
  const FONTS: FontFamilies = {
    display: 'X', heading: 'X', body: 'X', label: 'X', accent: 'X',
  }

  /** Привязка, которую `composeSvg` реально отдаёт растеризатору для слоя `frame`. */
  function alignInSvg(focus: Focus | undefined, fit: FitMode, canvas: { width: number; height: number }, frame: { width: number; height: number }): string {
    const layout = {
      id: 'parity',
      title: 'parity',
      canvas: { aspectW: canvas.width, aspectH: canvas.height, background: { kind: 'solid' as const, color: '#ffffff' } },
      layers: [
        { id: 'frame', type: 'frame' as const, z: 1, box: FULL, fit, focus, bind: { kind: 'frame' as const } },
      ],
    }
    const { svg } = composeSvg(
      layout,
      { frames: [{ dataUri: 'data:image/png;base64,AA', ...frame }], texts: {}, props: [], swatches: [] },
      canvas,
      FONTS,
    )
    return /preserveAspectRatio="(\w+) (?:slice|meet)"/.exec(svg)?.[1] ?? ''
  }

  /** Привязка, которую выдают наши числа: где кадр стоит относительно бокса слоя по каждой оси. */
  function alignInOurs(focus: Focus | undefined, fit: FitMode, canvas: { width: number; height: number }, frame: { width: number; height: number }, axisName: 'x' | 'y'): string {
    const drawn = frameBoxToCanvas(FULL, layerOf(FULL, fit, focus), canvas, frame)
    const axis = (start: number, size: number, min: string, mid: string, max: string): string => {
      if (Math.abs(start) < 1e-9) return min
      if (Math.abs(start + size - 1) < 1e-9) return max
      return mid
    }
    return axisName === 'x'
      ? axis(drawn.x, drawn.w, 'xMin', 'xMid', 'xMax')
      : axis(drawn.y, drawn.h, 'YMin', 'YMid', 'YMax')
  }

  /** Одна ось привязки из `preserveAspectRatio`: на оси без запаса картинка стоит впритык и
   *  привязка ничего не двигает, поэтому сравнивается только ось, где запас есть. */
  const axisOf = (align: string, axisName: 'x' | 'y'): string =>
    axisName === 'x' ? align.slice(0, 4) : align.slice(4)

  // Кадр 1000×1000 на холсте 500×1000: `cover` оставляет свободу по горизонтали, `contain`
  // на 500×1000 — по вертикали (кадр квадратный, поля остаются по длинной стороне бокса). Значения focus — по обе стороны порогов 1/3 и 2/3.
  const stops = [0, 0.32, 0.34, 0.5, 0.66, 0.67, 1]

  it('cover: горизонтальная привязка при любом focus.x', () => {
    for (const x of stops) {
      const focus = { x, y: 0.5 }
      expect(alignInOurs(focus, 'cover', { width: 500, height: 1000 }, SQUARE, 'x')).toBe(
        axisOf(alignInSvg(focus, 'cover', { width: 500, height: 1000 }, SQUARE), 'x'),
      )
    }
  })

  it('contain: вертикальная привязка при любом focus.y', () => {
    for (const y of stops) {
      const focus = { x: 0.5, y }
      expect(alignInOurs(focus, 'contain', { width: 500, height: 1000 }, SQUARE, 'y')).toBe(
        axisOf(alignInSvg(focus, 'contain', { width: 500, height: 1000 }, SQUARE), 'y'),
      )
    }
  })

  it('без focus — по центру', () => {
    expect(alignInOurs(undefined, 'cover', { width: 500, height: 1000 }, SQUARE, 'x')).toBe(
      axisOf(alignInSvg(undefined, 'cover', { width: 500, height: 1000 }, SQUARE), 'x'),
    )
  })
})
