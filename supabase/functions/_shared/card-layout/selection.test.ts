import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  layoutQueries,
  layoutSnapshot,
  selectCardLayout,
  type LayoutCandidate,
  type LayoutSelectionInput,
} from './selection.ts'

const LAYOUT = {
  canvas: {
    aspectW: 3,
    aspectH: 4,
    background: { kind: 'solid' as const, color: '#ffffff' },
  },
  layers: [],
}

function candidate(
  id: string,
  overrides: Partial<Omit<LayoutCandidate, 'id' | 'layout'>> & {
    propSlots?: number
    hasLogoLayer?: boolean
    aspectW?: number
    aspectH?: number
  } = {},
): LayoutCandidate {
  const { propSlots = 0, hasLogoLayer = false, aspectW = 3, aspectH = 4, ...tags } = overrides

  return {
    id,
    layout: {
      ...LAYOUT,
      id,
      title: id,
      canvas: { ...LAYOUT.canvas, aspectW, aspectH },
      layers: [
        ...Array.from({ length: propSlots }, (_unused, index) => ({
          id: `prop-${index}`,
          type: 'text' as const,
          z: index,
          box: { x: 0, y: 0, w: 1, h: 1 },
          bind: { kind: 'prop' as const, index },
          style: {
            role: 'body' as const,
            size: 0.1,
            weight: 400,
            color: '#111111',
            align: 'left' as const,
            valign: 'top' as const,
            lineHeight: 1,
          },
        })),
        ...(hasLogoLayer
          ? [{
              id: 'logo',
              type: 'asset' as const,
              z: 100,
              box: { x: 0, y: 0, w: 1, h: 1 },
              fit: 'contain' as const,
              bind: { kind: 'logo' as const },
            }]
          : []),
      ],
    },
    categoryId: 'clothing',
    marketplaceId: null,
    presetId: null,
    isFallback: false,
    ...tags,
  }
}

const INPUT: LayoutSelectionInput = {
  categoryId: 'clothing',
  marketplaceId: 'wildberries',
  presetId: 'clothing-model',
  hasLogo: false,
  propertyCount: 2,
  targetAspectW: 3,
  targetAspectH: 4,
}

describe('Server-side card-layout selection (M7 B2)', () => {
  it('hard-filters category and target-frame aspect ratio before scoring', () => {
    const selected = selectCardLayout(
      [
        candidate('wrong-category', { categoryId: 'food', presetId: INPUT.presetId, propSlots: 2 }),
        candidate('wrong-aspect', { aspectW: 1, aspectH: 1, presetId: INPUT.presetId, propSlots: 2 }),
        candidate('matching', { presetId: INPUT.presetId, propSlots: 2 }),
      ],
      candidate('fallback'),
      INPUT,
    )

    expect(selected.id).toBe('matching')
  })

  it('scores preset, property capacity, logo use, and marketplace independently', () => {
    const selected = selectCardLayout(
      [
        candidate('all-matches', {
          presetId: INPUT.presetId,
          marketplaceId: INPUT.marketplaceId,
          hasLogoLayer: true,
          propSlots: 2,
        }),
        candidate('preset-only', { presetId: INPUT.presetId, propSlots: 1 }),
        candidate('capacity-only', { propSlots: 2 }),
        candidate('logo-only', { hasLogoLayer: true, propSlots: 1 }),
        candidate('marketplace-only', { marketplaceId: INPUT.marketplaceId, propSlots: 1 }),
      ],
      candidate('fallback'),
      { ...INPUT, hasLogo: true },
    )

    expect(selected.id).toBe('all-matches')
    expect(selected.score).toBe(7)
  })

  it('assigns the specified weight to each matching scoring component', () => {
    expect(selectCardLayout(
      [candidate('preset', { presetId: INPUT.presetId, propSlots: 1 })],
      candidate('fallback'),
      INPUT,
    ).score).toBe(3)
    expect(selectCardLayout(
      [candidate('capacity', { propSlots: 2 })],
      candidate('fallback'),
      INPUT,
    ).score).toBe(2)
    expect(selectCardLayout(
      [candidate('logo', { hasLogoLayer: true, propSlots: 1 })],
      candidate('fallback'),
      { ...INPUT, hasLogo: true },
    ).score).toBe(1)
    expect(selectCardLayout(
      [candidate('marketplace', { marketplaceId: INPUT.marketplaceId, propSlots: 1 })],
      candidate('fallback'),
      INPUT,
    ).score).toBe(1)
  })

  it('does not award capacity when B1 properties exceed the layout slots', () => {
    const selected = selectCardLayout(
      [
        candidate('too-small', { propSlots: 1 }),
        candidate('fits', { propSlots: 2 }),
      ],
      candidate('fallback'),
      INPUT,
    )

    expect(selected.id).toBe('fits')
    expect(selected.score).toBe(2)
  })

  it('prefers a category-and-aspect match over the universal fallback even at zero score', () => {
    const fallback = candidate('universal-fallback', { isFallback: true })

    const selected = selectCardLayout([candidate('untagged')], fallback, INPUT)

    expect(selected).toMatchObject({ id: 'untagged', score: 0, isFallback: false })
  })

  it('resolves an equal top score from the selection input itself, not database order', () => {
    const first = candidate('a-layout', { propSlots: 2 })
    const second = candidate('b-layout', { propSlots: 2 })

    const fromFirstOrder = selectCardLayout([first, second], candidate('fallback'), INPUT)
    const fromSecondOrder = selectCardLayout([second, first], candidate('fallback'), INPUT)

    expect(fromSecondOrder.id).toBe(fromFirstOrder.id)
  })

  // The free preview (B6) must name the very layout the paid run will assemble: it is
  // computed before the generation row exists, so the tie-break may not depend on its id.
  it('gives the same layout to the same input, so the preview can promise it before payment', () => {
    const library = [candidate('a-layout', { propSlots: 2 }), candidate('b-layout', { propSlots: 2 })]

    const preview = selectCardLayout(library, candidate('fallback'), INPUT)
    const paidRun = selectCardLayout(library, candidate('fallback'), { ...INPUT })

    expect(paidRun.id).toBe(preview.id)
  })

  it('may pick another layout once the input changes, tie or not', () => {
    const library = [candidate('a-layout', { propSlots: 9 }), candidate('b-layout', { propSlots: 9 })]

    const keys = new Set(
      [0, 1, 2, 3, 4, 5].map(
        (propertyCount) => selectCardLayout(library, candidate('fallback'), { ...INPUT, propertyCount }).id,
      ),
    )

    expect(keys.size).toBe(2)
  })

  it('always returns the universal fallback when no candidate survives the hard filters', () => {
    const fallback = candidate('universal-fallback', { categoryId: null, aspectW: 1, aspectH: 1, isFallback: true })

    const selected = selectCardLayout(
      [candidate('wrong-category', { categoryId: 'food' })],
      fallback,
      INPUT,
    )

    expect(selected).toMatchObject({ id: 'universal-fallback', score: 0, isFallback: true })
  })

  it('returns only the selected layout identity and immutable layout for the generation snapshot', () => {
    const selected = selectCardLayout([candidate('chosen', { propSlots: 2 })], candidate('fallback'), INPUT)

    const generationId = '11111111-1111-4111-8111-111111111111'

    expect(layoutSnapshot(generationId, selected)).toEqual({
      generationId,
      layoutId: 'chosen',
      layout: expect.objectContaining({ id: 'chosen', title: 'chosen' }),
    })
  })
})

describe('Selection skips layouts whose title box cannot take the seller title (B32)', () => {
  const rejects = (...ids: string[]) => (layout: { id: string }) => !ids.includes(layout.id)

  it('drops a rejected layout even when it scores higher than the rest', () => {
    const library = [candidate('best-but-narrow', { propSlots: 2, presetId: INPUT.presetId }), candidate('plain')]

    expect(selectCardLayout(library, candidate('fallback'), INPUT).id).toBe('best-but-narrow')
    expect(selectCardLayout(library, candidate('fallback'), INPUT, rejects('best-but-narrow')).id).toBe('plain')
  })

  it('keeps selecting as before when every category-and-aspect match is rejected', () => {
    const library = [candidate('a-layout', { propSlots: 2 }), candidate('b-layout')]
    const everyone = () => false

    const withFilter = selectCardLayout(library, candidate('fallback', { isFallback: true }), INPUT, everyone)

    expect(withFilter).toEqual(selectCardLayout(library, candidate('fallback', { isFallback: true }), INPUT))
    expect(withFilter.isFallback).toBe(false)
  })

  it('does not ask about the universal fallback: it answers an empty hard filter, not a rejection', () => {
    const fallback = candidate('universal-fallback', { categoryId: null, isFallback: true })

    const selected = selectCardLayout([candidate('wrong-category', { categoryId: 'food' })], fallback, INPUT, () => false)

    expect(selected).toMatchObject({ id: 'universal-fallback', isFallback: true })
  })

  it('gives the preview and the paid run the same layout for the same filter', () => {
    const library = [candidate('a-layout', { propSlots: 2 }), candidate('b-layout', { propSlots: 2 })]
    const accepts = rejects('a-layout')

    expect(selectCardLayout(library, candidate('fallback'), INPUT, accepts).id).toBe('b-layout')
    expect(selectCardLayout([...library].reverse(), candidate('fallback'), INPUT, accepts).id).toBe('b-layout')
  })

  it('asks the same question in the worker and in the preview', () => {
    for (const file of ['../../generation-worker/index.ts', '../../card-preview/index.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).toContain('firstWordFits(')
    }
  })
})

describe('Selection queries keep heavy layouts out of the library read (M7 B7.7)', () => {
  it('filters edge-heavy layouts out of both the candidates and the fallback query', () => {
    const { candidates, fallback } = layoutQueries('clothing')

    expect(candidates).toContain('edge_heavy=is.false')
    expect(fallback).toContain('edge_heavy=is.false')
    expect(candidates).toContain('category_id=eq.clothing')
    expect(fallback).toContain('is_fallback=is.true')
  })

  it('leaves the worker and the preview no query of their own, so one filter governs both', () => {
    for (const file of ['../../generation-worker/index.ts', '../../card-preview/index.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toContain('card_layouts?')
      expect(source, file).toContain('layoutQueries(')
    }
  })
})
