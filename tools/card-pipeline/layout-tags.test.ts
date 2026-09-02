import { describe, expect, it } from 'vitest'

import { validateTagProposal } from './layout-tags-lib.ts'

const references = {
  categories: [{ id: 'clothing', title: 'Одежда и обувь' }],
  marketplaces: [{ id: 'wildberries', title: 'Wildberries' }],
  presets: [
    { id: 'clothing-model', category_id: 'clothing', title: 'На модели' },
    { id: 'beauty-studio', category_id: 'beauty', title: 'Каталог' },
  ],
}

describe('B2.0: предложения тегов макета', () => {
  it('принимает значения из справочников и сценарий своей категории', () => {
    expect(
      validateTagProposal(
        {
          categoryId: 'clothing',
          marketplaceId: 'wildberries',
          presetId: 'clothing-model',
          handsHidden: true,
        },
        references,
      ),
    ).toEqual([])
  })

  it('отклоняет отсутствующие идентификаторы и сценарий другой категории', () => {
    expect(
      validateTagProposal(
        {
          categoryId: 'clothing',
          marketplaceId: 'unknown-marketplace',
          presetId: 'beauty-studio',
          handsHidden: 'yes',
        },
        references,
      ),
    ).toEqual([
      'marketplaceId «unknown-marketplace» отсутствует в справочнике',
      'presetId «beauty-studio» относится к категории «beauty», а не «clothing»',
      'handsHidden должен быть boolean',
    ])
  })
})
