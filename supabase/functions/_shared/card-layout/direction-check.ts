/**
 * Сборка итога правки арт-директора по частям — шаг B5.5 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md),
 * [ADR-0018](../../../../docs/adr/0018-art-director-layout-patch.md), п. 2 (проверки 3–6) и
 * «Сборка итога».
 *
 * **Правило одно: часть берётся, если не хуже макета библиотеки.** Брак одного бокса не
 * выбрасывает годные иконки и гнёзда, а худший исход — макет библиотеки как есть.
 *
 * **Растеризатора здесь нет — обмерщик приходит параметром**, как у `overflowsOf`: функция
 * остаётся чистой, а в изоляте за `measure` стоит `resvg`. Обмеров ровно два на весь ответ
 * (библиотека и правка): переполнение — свойство пары «бокс — текст» и от соседей не зависит.
 * Круг сочетания растеризатора не зовёт совсем — только арифметика боксов и карты.
 */

import type { OccupancyMap } from './occupancy.ts'
import { flattenLayers } from './features.ts'
import {
  BARE_TEXT_LIMIT,
  DIRECTED_SLOTS,
  applyDirection,
  directedContent,
  intersectionArea,
  platesUnder,
  textsOnProduct,
  topLevelOf,
} from './direction.ts'
import type { CardDirection } from './direction.ts'
import { overflowsOf, textProbes } from './svg.ts'
import type { FontFamilies } from './svg.ts'
import { resolveLayout, validateLayout } from './validate.ts'
import type { Box, CardContent, CardLayout, ImageRef, Layer } from './types.ts'

/** Налегание блоков, меньшее этого, — след округления боксов до сотых, а не брак. */
export const OVERLAP_SLACK = 0.05

const EPS = 1e-9

/** Налегание: площадь пересечения, делённая на площадь меньшего из двух боксов. */
export function overlapShare(a: Box, b: Box): number {
  const smaller = Math.min(a.w * a.h, b.w * b.h)
  return smaller > 0 ? intersectionArea(a, b) / smaller : 0
}

export type RejectedPart = { part: string; reason: string }

export type CombineInput = {
  library: CardLayout
  libraryContent: CardContent
  parts: CardDirection
  size: { width: number; height: number }
  fonts: FontFamilies
  /** Ширина строки по растеризатору; в тестах — подменная. */
  measure: (svg: string) => number
  canvasMap: OccupancyMap | null
  hasCutout: boolean
  iconRefs: Record<string, ImageRef>
}

/**
 * Итог правки из частей, прошедших формальные проверки (`parseDirection`): отвергает те, что
 * хуже библиотеки, и возвращает принятые вместе со списком отвергнутых.
 */
export function combineDirection(input: CombineInput): { direction: CardDirection; rejected: RejectedPart[] } {
  const { library, libraryContent, canvasMap, iconRefs } = input
  const rejected: RejectedPart[] = []
  const reject = (part: string, reason: string): void => {
    if (!rejected.some((entry) => entry.part === part)) rejected.push({ part, reason })
  }

  const boxes = new Map(input.parts.boxes.map(({ layerId, box }) => [layerId, box]))
  const texts: CardDirection['texts'] = { ...input.parts.texts }
  const snapshot = (): CardDirection => ({
    boxes: [...boxes].map(([layerId, box]) => ({ layerId, box })),
    texts,
    icons: input.parts.icons,
  })
  const rejectBox = (id: string, reason: string): boolean => {
    if (!boxes.has(id)) return false
    boxes.delete(id)
    reject(`бокс «${id}»`, reason)
    return true
  }

  // 3. Переполнение не хуже библиотеки. Один обмер библиотеки и один — правки.
  const before = overflowsOf(textProbes(library, libraryContent, input.size, input.fonts), input.measure)
  const edited = snapshot()
  const after = overflowsOf(
    textProbes(
      applyDirection(library, edited),
      directedContent(libraryContent, edited, iconRefs),
      input.size,
      input.fonts,
    ),
    input.measure,
  )
  const layersById = new Map(flattenLayers(library.layers).map((layer) => [layer.id, layer]))

  for (const overflow of after) {
    const known = before.some(
      (old) => old.layerId === overflow.layerId && old.kind === overflow.kind && old.over + EPS >= overflow.over,
    )
    if (known) continue

    const reason =
      overflow.kind === 'width'
        ? `строка «${overflow.text}» шире бокса на ${percent(overflow.over)}%`
        : `блок выше бокса на ${percent(overflow.over)}%`

    rejectBox(topLevelOf(library, overflow.layerId), reason)

    const slot = slotOf(layersById.get(overflow.layerId))
    if (slot !== null && texts[slot] !== undefined) {
      delete texts[slot]
      reject(`гнездо «${slot}»`, reason)
    }
  }

  // 4–5. Круг сочетания: каждый круг отвергает хотя бы один бокс, так что он конечен.
  const tops = library.layers.filter((layer) => layer.type !== 'frame' && layer.type !== 'cutout' && !isFullCanvas(layer))

  for (let changed = true; changed; ) {
    changed = false

    if (canvasMap !== null) {
      changed = rejectTextOnProduct(input, snapshot(), boxes, rejectBox)
    }

    let current = applyDirection(library, snapshot())
    for (let i = 0; i < tops.length; i += 1) {
      for (let j = i + 1; j < tops.length; j += 1) {
        const [a, b] = [tops[i], tops[j]]
        const now = overlapShare(boxOf(current, a.id), boxOf(current, b.id))
        const was = overlapShare(a.box, b.box)
        if (now <= Math.max(OVERLAP_SLACK, was) + EPS) continue

        const reason = `«${a.id}» налегает на «${b.id}» на ${percent(now)}% (в библиотеке ${percent(was)}%)`
        for (const id of [a.id, b.id]) changed = rejectBox(id, reason) || changed
        // Отвергнутый бокс вернул слой на место: следующие пары судятся по новому положению.
        current = applyDirection(library, snapshot())
      }
    }
  }

  // 6. Валидатор итогового макета.
  const problems = validateLayout(applyDirection(library, snapshot()))
  if (problems.length > 0) {
    for (const { layerId, box } of snapshot().boxes) {
      const alone = validateLayout(applyDirection(library, { boxes: [{ layerId, box }], texts: {}, icons: [] }))
      if (alone.length > 0) rejectBox(layerId, `валидатор: ${alone[0]}`)
    }

    const still = validateLayout(applyDirection(library, snapshot()))
    if (still.length > 0) {
      for (const { layerId } of snapshot().boxes) rejectBox(layerId, `валидатор: ${still[0]}`)
    }
  }

  return { direction: snapshot(), rejected }
}

/**
 * 4. Текст на товаре не хуже библиотеки. Нарушителю отвергаются принятые боксы его слоя
 * верхнего уровня и тех слоёв, что были под ним плашкой в библиотеке: текст мог стать голым
 * оттого, что уехала плашка. Возвращает, отвергнуто ли хоть что-то.
 */
function rejectTextOnProduct(
  input: CombineInput,
  direction: CardDirection,
  boxes: Map<string, Box>,
  rejectBox: (id: string, reason: string) => boolean,
): boolean {
  const { library, libraryContent, canvasMap, hasCutout, iconRefs } = input
  const content = directedContent(libraryContent, direction, iconRefs)
  const map = canvasMap as OccupancyMap

  const inLibrary = new Map(textsOnProduct(library, content, map, hasCutout).map((e) => [e.layerId, e.occupancy]))
  const placedLibrary = resolveLayout(library, content).layers
  const placedNow = resolveLayout(applyDirection(library, direction), content).layers
  let changed = false

  for (const entry of textsOnProduct(applyDirection(library, direction), content, map, hasCutout)) {
    const limit = Math.max(BARE_TEXT_LIMIT, inLibrary.get(entry.layerId) ?? 0)
    if (entry.occupancy <= limit + EPS) continue

    const text = placedNow.find((item) => item.layer.id === entry.layerId)
    const quoted = (text?.lines ?? []).map((runs) => runs.map((run) => run.text).join('')).join(' ')
    const reason = `текст «${quoted}» лежит на товаре на ${percent(entry.occupancy)}% (допустимо ${percent(limit)}%)`

    const libraryText = placedLibrary.find((item) => item.layer.id === entry.layerId)
    const plates = libraryText === undefined ? [] : platesUnder(placedLibrary, libraryText)
    const ids = new Set([entry.topId, ...plates.map((plate) => topLevelOf(library, plate.layer.id))])

    for (const id of ids) {
      if (boxes.has(id)) changed = rejectBox(id, reason) || changed
    }
  }

  return changed
}

/** Гнездо арт-директора, к которому привязан слой, иначе `null`. */
function slotOf(layer: Layer | undefined): (typeof DIRECTED_SLOTS)[number] | null {
  if (layer?.bind?.kind !== 'text') return null
  const slot = layer.bind.slot
  return (DIRECTED_SLOTS as readonly string[]).includes(slot) ? (slot as (typeof DIRECTED_SLOTS)[number]) : null
}

/** Слой во весь холст: подложка или скрим — под них налегание не считается. */
function isFullCanvas(layer: Layer): boolean {
  const { x, y, w, h } = layer.box
  return x === 0 && y === 0 && w === 1 && h === 1
}

function boxOf(layout: CardLayout, id: string): Box {
  return (layout.layers.find((layer) => layer.id === id) as Layer).box
}

function percent(share: number): number {
  return Math.round(share * 100)
}
