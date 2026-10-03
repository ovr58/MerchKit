/**
 * Сдвиг голого текста в свободную зону карты, без ИИ — шаг B5.11 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md),
 * [ADR-0018](../../../../docs/adr/0018-art-director-layout-patch.md), п. 3 («Сдвиг без ИИ»).
 *
 * **Ступень после ИИ, а не вместо него.** ИИ двигает композицию связно; сдвиг двигает один
 * блок и о соседях знает только «не налезть». Размер бокса не меняется — поэтому
 * переполнение не меняется и обмер строк не нужен, а растеризатора здесь нет вовсе.
 */

import type { OccupancyMap } from './occupancy.ts'
import { applyDirection, textsOnProduct } from './direction.ts'
import { OVERLAP_SLACK, overlapShare } from './direction-check.ts'
import type { Box, CardContent, CardLayout, Layer } from './types.ts'

/** Дальше этого (сумма модулей сдвига по осям, в долях стороны холста) блок не уезжает:
 *  иначе он оторвётся от своей колонки в другом конце карточки. */
export const SHIFT_LIMIT = 0.25

const EPS = 1e-9

export type ShiftInput = {
  /** Макет библиотеки: с ним сравнивается налегание («не хуже, чем было»). */
  library: CardLayout
  /** Макет после ступеней 1–2: его положение — исходное для сдвига. */
  layout: CardLayout
  content: CardContent
  canvasMap: OccupancyMap | null
  hasCutout: boolean
}

/**
 * Боксы слоёв верхнего уровня, сдвинутых из-под товара в ближайшую годную свободную зону.
 * Слой, которому годной зоны не нашлось, остаётся где был и в ответ не попадает.
 */
export function shiftBareText(input: ShiftInput): { boxes: { layerId: string; box: Box }[] } {
  const { content, canvasMap, hasCutout } = input
  if (canvasMap === null) return { boxes: [] }

  let layout = input.layout
  const onProduct = new Set(textsOnProduct(layout, content, canvasMap, hasCutout).map((entry) => entry.topId))
  const boxes: { layerId: string; box: Box }[] = []

  // Порядок слоёв макета, а не порядок обнаружения текстов: результат не зависит от того,
  // какой из текстов `resolveLayout` отсортировал первым по `z`. Сдвиг ложится на макет сразу,
  // чтобы следующий слой видел новое положение соседа.
  for (const top of input.layout.layers.filter((layer) => onProduct.has(layer.id))) {
    const box = nearestFit(input, layout, top.id, canvasMap)
    if (box === null) continue

    layout = applyDirection(layout, { boxes: [{ layerId: top.id, box }], texts: {}, icons: [] })
    boxes.push({ layerId: top.id, box })
  }

  return { boxes }
}

/** Бокс слоя в ближайшей годной зоне или `null`, если годной нет. */
function nearestFit(input: ShiftInput, layout: CardLayout, layerId: string, map: OccupancyMap): Box | null {
  const { library, content, hasCutout } = input
  const b = (layout.layers.find((layer) => layer.id === layerId) as Layer).box
  const libraryBox = (library.layers.find((layer) => layer.id === layerId) as Layer).box
  const neighbours = layout.layers.filter((layer) => layer.id !== layerId && countsForOverlap(layer))
  let best: { box: Box; distance: number } | null = null

  for (const zone of map.free) {
    if (zone.w + EPS < b.w || zone.h + EPS < b.h) continue

    const box = {
      x: clean(clamp(b.x, zone.x, zone.x + zone.w - b.w)),
      y: clean(clamp(b.y, zone.y, zone.y + zone.h - b.h)),
      w: b.w,
      h: b.h,
    }
    const distance = Math.abs(box.x - b.x) + Math.abs(box.y - b.y)
    if (distance > SHIFT_LIMIT + EPS) continue
    // Строго меньше: при равенстве остаётся первая зона по порядку `free`.
    if (best !== null && distance >= best.distance - EPS) continue

    const moved = applyDirection(layout, { boxes: [{ layerId, box }], texts: {}, icons: [] })
    if (textsOnProduct(moved, content, map, hasCutout).some((entry) => entry.topId === layerId)) continue

    const fits = neighbours.every((neighbour) => {
      const was = overlapShare(libraryBox, (library.layers.find((l) => l.id === neighbour.id) as Layer).box)
      return overlapShare(box, neighbour.box) <= Math.max(OVERLAP_SLACK, was) + EPS
    })
    if (fits) best = { box, distance }
  }

  return best === null ? null : best.box
}

/** Слои, с которыми налегание не считается: кадр, вырез и слои во весь холст. */
function countsForOverlap(layer: Layer): boolean {
  const { x, y, w, h } = layer.box
  const full = x === 0 && y === 0 && w === 1 && h === 1
  return layer.type !== 'frame' && layer.type !== 'cutout' && !full
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Шум плавающей точки (`0.55 - 0.3`) в хранимый патч не пускаем: микродоли, не сотые. */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
