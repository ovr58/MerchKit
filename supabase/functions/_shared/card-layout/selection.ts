import type { CardLayout, Layer } from './types.ts'

export type LayoutCandidate = {
  id: string
  layout: CardLayout
  categoryId: string | null
  marketplaceId: string | null
  presetId: string | null
  isFallback: boolean
}

export type LayoutSelectionInput = {
  generationId: string
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

  return leaders[hash(input.generationId) % leaders.length]
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

function score(candidate: LayoutCandidate, input: LayoutSelectionInput): number {
  let total = 0
  if (input.presetId !== null && candidate.presetId === input.presetId) total += 3
  if (propertyCapacity(candidate.layout) >= input.propertyCount) total += 2
  if (input.hasLogo && hasLogoLayer(candidate.layout.layers)) total += 1
  if (candidate.marketplaceId === input.marketplaceId) total += 1
  return total
}

function hasMatchingAspect(layout: CardLayout, targetW: number, targetH: number): boolean {
  const expected = targetW / targetH
  const actual = layout.canvas.aspectW / layout.canvas.aspectH
  return Math.abs(actual - expected) / expected <= ASPECT_TOLERANCE
}

function propertyCapacity(layout: CardLayout): number {
  return new Set(flatten(layout.layers)
    .filter((layer) => layer.bind?.kind === 'prop')
    .map((layer) => layer.bind!.index)).size
}

function hasLogoLayer(layers: Layer[]): boolean {
  return flatten(layers).some((layer) => layer.bind?.kind === 'logo')
}

function flatten(layers: Layer[]): Layer[] {
  return layers.flatMap((layer) => layer.type === 'group' ? [layer, ...flatten(layer.children)] : [layer])
}

function hash(value: string): number {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}
