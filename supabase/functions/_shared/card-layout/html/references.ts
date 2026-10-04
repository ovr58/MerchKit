/**
 * Выбор референсов для сочинения карточки ([ADR-0019](../../../../../docs/adr/0019-html-authoring-transpiled-to-layers.md),
 * п. 7) — чистая функция без модели и без ввода-вывода: строки каталога `card_references`
 * приносит вызывающий (только `status = 'active'`), здесь — только порядок.
 *
 * Кандидаты идут ярусами: та же площадка и категория → та же категория → любые. Внутри яруса —
 * детерминированная ротация по `seed` (идентификатор генерации): соседние карточки получают
 * разные наборы, повтор сборки — тот же. Первый выбранный — ведущий (ADR-0019, п. 3). Это и есть
 * петля улучшения: новый образец в каталоге — новая опора следующей карточке без правки кода.
 */

export type ReferenceRow = {
  id: string
  storage_path: string
  marketplace_id: string
  category_id: string
}

export const MAX_REFERENCES = 4

/** FNV-1a: тот же хеш, что у заглушки провайдера, — стабилен между рантаймами. */
function hash(input: string): number {
  let value = 0x811c9dc5
  for (let at = 0; at < input.length; at++) {
    value ^= input.charCodeAt(at)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

export function pickReferences<Row extends ReferenceRow>(
  rows: Row[],
  query: { marketplaceId: string; categoryId: string; seed: string },
): Row[] {
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const sameCategory = (row: Row) => row.category_id === query.categoryId
  const tiers = [
    sorted.filter((row) => sameCategory(row) && row.marketplace_id === query.marketplaceId),
    sorted.filter((row) => sameCategory(row) && row.marketplace_id !== query.marketplaceId),
    sorted.filter((row) => !sameCategory(row)),
  ]

  const offset = hash(query.seed)
  const picked: Row[] = []
  for (const tier of tiers) {
    for (let at = 0; at < tier.length && picked.length < MAX_REFERENCES; at++) {
      picked.push(tier[(offset + at) % tier.length])
    }
  }

  return picked
}
