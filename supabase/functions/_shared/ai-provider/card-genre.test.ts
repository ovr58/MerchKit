import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CARD_GENRE } from './card-genre.ts'

/**
 * Скил-жанр живёт константой кода (ADR-0019, п. 8), а рабочий черновик — в
 * `bench/html-probe/CARD_GENRE.md`. Две копии одного текста расходятся молча; этот тест
 * краснеет при первой правке любой из них и требует ресинка — намеренно: форма ответа
 * скила — контракт с подмножеством транспилятора, и править его в одном месте нельзя.
 */
describe('Скил-жанр в коде равен черновику', () => {
  it('константа совпадает с bench/html-probe/CARD_GENRE.md', () => {
    // Корень репозитория — рабочий каталог vitest: под jsdom `import.meta.url` не `file:`.
    const draft = readFileSync(join(process.cwd(), 'bench', 'html-probe', 'CARD_GENRE.md'), 'utf8').replace(/\r\n/g, '\n')

    expect(CARD_GENRE).toBe(draft)
  })
})
