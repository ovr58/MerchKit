/**
 * Пересчёт «доли кадра → доли холста» — шаг B5.1 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * **Зачем.** Карта занятости (`occupancy.ts`) знает только кадр: всё в ней — доли кадра. Макет
 * же задаёт места текста в долях **холста**, а кадр ложится в него слоем `frame` с боксом,
 * режимом `fit` и точкой интереса `focus`. Если бокс не во весь холст или пропорции расходятся,
 * `cover` часть кадра срезает, `contain` оставляет поля. Арт-директору (B5) нужна карта в тех
 * координатах, в которых он выбирает место: срезанный товар места не занимает, поля свободны.
 *
 * **Арифметика — та же, что у сборщика, а не похожая.** Картинку в бокс слоя кладёт SVG
 * (`preserveAspectRatio` из `svg.ts`): `cover` ↔ `slice`, `contain` ↔ `meet`, `focus` — к
 * ближайшей из девяти точек привязки. Здесь это повторено числами; расхождение дало бы карту,
 * на которой текст «свободен» там, где в кадре на самом деле товар. Совпадение закреплено
 * тестом, который читает `preserveAspectRatio` из настоящего вывода `composeSvg`.
 *
 * **Пропорция самого кадра — отдельный вход.** В карте её нет: ячейки округлены до сетки, и
 * по `cols × rows` пропорцию исходного снимка не восстановить. Её знает `ImageRef` (размер
 * исходного изображения) — именно из него SVG и берёт пропорцию.
 *
 * **Что не учитывается.** Скругление углов слоя (`radius`) и поворот (`rotate`): оба съедают
 * доли процента площади по углам кадра и в карту с ячейкой в 6% стороны не попадают.
 */

import { GRID_LONG_SIDE, occupancyOf } from './occupancy.ts'
import type { OccupancyMap } from './occupancy.ts'
import type { Box, FrameLayer } from './types.ts'

/** Размер в пикселях — холста профиля площадки или исходного изображения кадра. Важна только
 *  пропорция, но тип совпадает с `size` сборщика и с `ImageRef`, чтобы передавать их как есть. */
export type PixelSize = { width: number; height: number }

/**
 * Куда в холсте ложится кадр и что от него видно: бокс кадра целиком (может выходить за бокс
 * слоя при `cover`) в долях холста. Обрезку по боксу слоя делает вызывающий.
 */
function drawnBox(
  layer: Pick<FrameLayer, 'box' | 'fit' | 'focus'>,
  canvas: PixelSize,
  frame: PixelSize,
): Box {
  assertSize(canvas, 'холст')
  assertSize(frame, 'кадр')

  const boxW = layer.box.w * canvas.width
  const boxH = layer.box.h * canvas.height
  const fit = layer.fit === 'cover' ? Math.max : Math.min
  const scale = fit(boxW / frame.width, boxH / frame.height)
  const drawnW = frame.width * scale
  const drawnH = frame.height * scale

  return {
    x: layer.box.x + ((boxW - drawnW) * alignOf(layer.focus?.x)) / canvas.width,
    y: layer.box.y + ((boxH - drawnH) * alignOf(layer.focus?.y)) / canvas.height,
    w: drawnW / canvas.width,
    h: drawnH / canvas.height,
  }
}

/** Доля свободного места, которая остаётся «до» кадра. Три точки привязки SVG, а не плавное
 *  значение: порог — тот же `1/3 · 2/3`, что в `alignOf` из `svg.ts`. */
function alignOf(focus: number | undefined): number {
  if (focus === undefined) return 0.5
  return focus < 1 / 3 ? 0 : focus < 2 / 3 ? 0.5 : 1
}

/** Бокс в долях кадра → тот же бокс в долях холста. Прямое направление пересчёта; обратное —
 *  `canvasBoxToFrame`. */
export function frameBoxToCanvas(
  box: Box,
  frameLayer: Pick<FrameLayer, 'box' | 'fit' | 'focus'>,
  canvas: PixelSize,
  frame: PixelSize,
): Box {
  const drawn = drawnBox(frameLayer, canvas, frame)
  return {
    x: drawn.x + box.x * drawn.w,
    y: drawn.y + box.y * drawn.h,
    w: box.w * drawn.w,
    h: box.h * drawn.h,
  }
}

/**
 * Бокс в долях холста → тот же бокс в долях кадра: чистая геометрия, обратная
 * `frameBoxToCanvas`.
 *
 * **Обрезку по боксу слоя не делает.** При `cover` часть кадра, выступающая за бокс слоя, на
 * холсте не видна, а здесь она останется «кадром»; значит, для бокса, вылезающего за бокс слоя,
 * `occupancyOfBox` по результату увидит скрытый товар. Для точного ответа про бокс на холсте
 * надёжнее `occupancyOfBox(frameToCanvas(...), box)` — срез там уже сделан.
 */
export function canvasBoxToFrame(
  box: Box,
  frameLayer: Pick<FrameLayer, 'box' | 'fit' | 'focus'>,
  canvas: PixelSize,
  frame: PixelSize,
): Box {
  const drawn = drawnBox(frameLayer, canvas, frame)
  if (drawn.w <= 0 || drawn.h <= 0) {
    throw new Error('Пересчёт в доли кадра: бокс слоя кадра пуст, кадр на холсте не виден')
  }
  return {
    x: (box.x - drawn.x) / drawn.w,
    y: (box.y - drawn.y) / drawn.h,
    w: box.w / drawn.w,
    h: box.h / drawn.h,
  }
}

/**
 * Карта занятости кадра → карта занятости холста.
 *
 * Сетка берётся под пропорцию холста (ячейки близки к квадратным, как и у карты кадра), а
 * значение ячейки — доля её площади, лежащая на товаре: ячейки кадра берутся с весом
 * перекрытия, а то, что за видимой частью кадра (срезано `cover`, поле `contain`, вне бокса
 * слоя), — нулём. Так срезанные ячейки исчезают, а поля свободны.
 *
 * `bounds`, `coverage` и `free` не пересчитываются отдельным кодом: полученные ячейки
 * прогоняются через `occupancyOf` как маска «один пиксель = одна ячейка». Правила порога,
 * запертых внутри контура ячеек и поиска свободных зон остаются в одном месте и не могут
 * разойтись с картой кадра.
 */
export function frameToCanvas(
  map: OccupancyMap,
  frameLayer: Pick<FrameLayer, 'box' | 'fit' | 'focus'>,
  canvas: PixelSize,
  frame: PixelSize,
): OccupancyMap {
  const drawn = drawnBox(frameLayer, canvas, frame)

  // Видимая часть кадра: нарисованный кадр, обрезанный боксом слоя и холстом.
  const visible = intersect(intersect(drawn, frameLayer.box), { x: 0, y: 0, w: 1, h: 1 })

  const scale = GRID_LONG_SIDE / Math.max(canvas.width, canvas.height)
  const cols = Math.max(1, Math.round(canvas.width * scale))
  const rows = Math.max(1, Math.round(canvas.height * scale))

  const alpha: number[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell: Box = { x: col / cols, y: row / rows, w: 1 / cols, h: 1 / rows }
      const share = shareOnProduct(map, drawn, intersect(cell, visible)) / (cell.w * cell.h)
      // Шум плавающей запятой на пороге ячейки: 0.5 + 1e-16 и 0.5 − 1e-16 — разные ячейки.
      alpha.push(Math.round(share * 1e6) / 1e6 * 255)
    }
  }

  // `occupancyOf` строит сетку по размеру маски; при длинной стороне в `GRID_LONG_SIDE` ячеек
  // маска «ячейка = пиксель» даёт ту же сетку.
  return occupancyOf({ width: cols, height: rows, alpha })
}

/** Площадь области `region` (в долях холста), лежащая на товаре кадра `drawn`. */
function shareOnProduct(map: OccupancyMap, drawn: Box, region: Box): number {
  if (region.w <= 0 || region.h <= 0) return 0

  let area = 0
  for (let row = 0; row < map.rows; row += 1) {
    for (let col = 0; col < map.cols; col += 1) {
      const value = map.cells[row * map.cols + col]
      if (value === 0) continue

      const frameCell: Box = {
        x: drawn.x + (col / map.cols) * drawn.w,
        y: drawn.y + (row / map.rows) * drawn.h,
        w: drawn.w / map.cols,
        h: drawn.h / map.rows,
      }
      const common = intersect(frameCell, region)
      area += common.w * common.h * value
    }
  }
  return area
}

/** Пересечение двух боксов; непересекающиеся дают бокс нулевого размера. */
function intersect(a: Box, b: Box): Box {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.w, b.x + b.w)
  const bottom = Math.min(a.y + a.h, b.y + b.h)
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) }
}

function assertSize(size: PixelSize, what: string): void {
  if (!(size.width > 0) || !(size.height > 0)) {
    throw new Error(`Пересчёт кадра в холст: размер (${what}) ${size.width}×${size.height} не положителен`)
  }
}
