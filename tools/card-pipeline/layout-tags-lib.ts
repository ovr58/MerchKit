export type Category = { id: string; title: string }
export type Marketplace = { id: string; title: string }
export type Preset = { id: string; category_id: string; title: string }

export type TagReferences = {
  categories: Category[]
  marketplaces: Marketplace[]
  presets: Preset[]
}

export type TagProposal = {
  categoryId: unknown
  marketplaceId: unknown
  presetId: unknown
  handsHidden: unknown
}

/** Checks untrusted Batch output against the same lookup IDs that constrain card_layouts. */
export function validateTagProposal(proposal: TagProposal, references: TagReferences): string[] {
  const problems: string[] = []
  const categoryId = proposal.categoryId
  const marketplaceId = proposal.marketplaceId
  const presetId = proposal.presetId

  if (typeof categoryId !== 'string' || !references.categories.some((category) => category.id === categoryId)) {
    problems.push(`categoryId «${String(categoryId)}» отсутствует в справочнике`)
  }
  if (
    marketplaceId !== null &&
    (typeof marketplaceId !== 'string' || !references.marketplaces.some((marketplace) => marketplace.id === marketplaceId))
  ) {
    problems.push(`marketplaceId «${String(marketplaceId)}» отсутствует в справочнике`)
  }
  if (presetId !== null) {
    const preset = typeof presetId === 'string'
      ? references.presets.find((candidate) => candidate.id === presetId)
      : undefined
    if (preset === undefined) {
      problems.push(`presetId «${String(presetId)}» отсутствует в справочнике`)
    } else if (typeof categoryId === 'string' && preset.category_id !== categoryId) {
      problems.push(`presetId «${preset.id}» относится к категории «${preset.category_id}», а не «${categoryId}»`)
    }
  }
  if (typeof proposal.handsHidden !== 'boolean') problems.push('handsHidden должен быть boolean')

  return problems
}
