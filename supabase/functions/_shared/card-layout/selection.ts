import { propertyCapacity, usesLogo } from './features.ts'
import type { CardLayout } from './types.ts'

export type LayoutCandidate = {
  id: string
  layout: CardLayout
  categoryId: string | null
  marketplaceId: string | null
  presetId: string | null
  isFallback: boolean
}

export type LayoutSelectionInput = {
  categoryId: string
  marketplaceId: string
  presetId: string | null
  hasLogo: boolean
  propertyCount: number
  targetAspectW: number
  targetAspectH: number
}

export type SelectedCardLayout = LayoutCandidate & { score: number }

const ASPECT_TOLERANCE = 0.02

/**
 * Selects from the server-owned layout library. Capacity, logo use, and aspect ratio are
 * deliberately calculated from the layout snapshot, never from duplicating database columns.
 */
export function selectCardLayout(
  candidates: LayoutCandidate[],
  fallback: LayoutCandidate,
  input: LayoutSelectionInput,
): SelectedCardLayout {
  const scored = candidates
    .filter((candidate) =>
      candidate.categoryId === input.categoryId &&
      hasMatchingAspect(candidate.layout, input.targetAspectW, input.targetAspectH),
    )
    .map((candidate) => ({ ...candidate, score: score(candidate, input) }))

  // The universal layout is the answer to an empty filter, not to a zero score: its own aspect
  // ratio is never checked, so any category-and-aspect match beats it even at zero.
  if (scored.length === 0) return { ...fallback, score: 0 }

  const highestScore = Math.max(...scored.map((candidate) => candidate.score))

  const leaders = scored
    .filter((candidate) => candidate.score === highestScore)
    .sort((left, right) => left.id.localeCompare(right.id))

  return leaders[hash(tieKey(input)) % leaders.length]
}

/** The minimum B2 persistence payload; B7 will replace the empty content and font map. */
export function layoutSnapshot(
  generationId: string,
  selected: SelectedCardLayout,
): {
  generationId: string
  layoutId: string
  layout: CardLayout
} {
  return {
    generationId,
    layoutId: selected.id,
    layout: selected.layout,
  }
}

/**
 * Ключ разрешения ничьей — сам ввод подбора, а не номер генерации.
 *
 * Номером было бы достаточно для повтора той же генерации, но не для превью (шаг B6): оно
 * считается ДО того, как генерация заведена, и обязано назвать тот самый макет, чью ёмкость
 * показало продавцу. Разошлись бы они — превью соврало бы ровно в том, ради чего его завели:
 * какие свойства не поместятся.
 */
function tieKey(input: LayoutSelectionInput): string {
  return [
    input.categoryId,
    input.marketplaceId,
    input.presetId ?? '',
    input.hasLogo ? 'logo' : '',
    input.propertyCount,
    input.targetAspectW,
    input.targetAspectH,
  ].join('|')
}

function score(candidate: LayoutCandidate, input: LayoutSelectionInput): number {
  let total = 0
  if (input.presetId !== null && candidate.presetId === input.presetId) total += 3
  if (propertyCapacity(candidate.layout) >= input.propertyCount) total += 2
  if (input.hasLogo && usesLogo(candidate.layout)) total += 1
  if (candidate.marketplaceId === input.marketplaceId) total += 1
  return total
}

function hasMatchingAspect(layout: CardLayout, targetW: number, targetH: number): boolean {
  const expected = targetW / targetH
  const actual = layout.canvas.aspectW / layout.canvas.aspectH
  return Math.abs(actual - expected) / expected <= ASPECT_TOLERANCE
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}
