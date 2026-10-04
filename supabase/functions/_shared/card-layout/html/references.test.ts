import { describe, expect, it } from 'vitest'

import { pickReferences, type ReferenceRow } from './references.ts'

/**
 * Выбор референсов для сочинения (ADR-0019, п. 7): без модели, не больше четырёх, сначала
 * своя площадка и категория, затем своя категория, затем любые; ротация по `seed`
 * (идентификатор генерации) — соседние карточки получают разные наборы, повтор сборки — тот же.
 */

const row = (id: string, marketplace_id: string, category_id: string): ReferenceRow => ({
  id,
  storage_path: `${marketplace_id}/${category_id}/${id}.jpg`,
  marketplace_id,
  category_id,
})

const ozonHome = Array.from({ length: 9 }, (_, at) => row(`oh${at}`, 'ozon', 'home'))
const wbHome = Array.from({ length: 3 }, (_, at) => row(`wh${at}`, 'wildberries', 'home'))
const wbClothing = Array.from({ length: 5 }, (_, at) => row(`wc${at}`, 'wildberries', 'clothing'))

const ids = (rows: ReferenceRow[]) => rows.map((picked) => picked.id)

describe('pickReferences', () => {
  it('для ozon/home — не больше четырёх, все из своей площадки и категории, пока их хватает', () => {
    const picked = pickReferences([...wbClothing, ...wbHome, ...ozonHome], {
      marketplaceId: 'ozon',
      categoryId: 'home',
      seed: 'gen-1',
    })

    expect(picked).toHaveLength(4)
    expect(picked.every((ref) => ref.marketplace_id === 'ozon' && ref.category_id === 'home')).toBe(true)
  })

  it('один seed — один и тот же набор в том же порядке, как бы ни лежали строки', () => {
    const rows = [...wbClothing, ...wbHome, ...ozonHome]
    const query = { marketplaceId: 'ozon', categoryId: 'home', seed: 'gen-1' }

    expect(ids(pickReferences(rows, query))).toEqual(ids(pickReferences([...rows].reverse(), query)))
  })

  it('два разных seed при восьми и более кандидатах дают разные наборы', () => {
    const query = { marketplaceId: 'ozon', categoryId: 'home' }

    const first = ids(pickReferences(ozonHome, { ...query, seed: 'gen-1' })).sort()
    const second = ids(pickReferences(ozonHome, { ...query, seed: 'gen-2' })).sort()

    expect(first).not.toEqual(second)
  })

  it('своих не хватает — добор той же категорией, затем любыми', () => {
    const picked = pickReferences([...wbClothing, row('wh0', 'wildberries', 'home'), row('oh0', 'ozon', 'home')], {
      marketplaceId: 'ozon',
      categoryId: 'home',
      seed: 'gen-1',
    })

    expect(ids(picked).slice(0, 2)).toEqual(['oh0', 'wh0'])
    expect(picked.slice(2).every((ref) => ref.category_id === 'clothing')).toBe(true)
    expect(picked).toHaveLength(4)
  })

  it('пустой каталог — пустой выбор', () => {
    expect(pickReferences([], { marketplaceId: 'ozon', categoryId: 'home', seed: 'gen-1' })).toEqual([])
  })
})
