import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { AUTHORED_FIXTURE_HTML } from './author-fixture.ts'
import { createStubProvider } from './stub.ts'
import type { ProviderUsage } from './types.ts'

/**
 * `authorCard` заглушки (ADR-0019, п. 3): местный прогон и тесты воркера получают фикстуру B2 —
 * страницу той же формы, что скил-жанр требует от модели, — и строку затрат с нулевой ценой.
 */
describe('Заглушка: операция authorCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const input = {
    frame: new Uint8Array([1, 2, 3]),
    references: [],
    seller: { title: 'Кресло', description: '', properties: [], wishes: '' },
    marketplaceId: 'ozon',
    categoryId: 'home',
    canvas: { width: 896, height: 1200 },
  }

  it('отдаёт HTML с #card', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })

    const { html } = await createStubProvider().authorCard(input)

    expect(html).toContain('<div id="card"')
  })

  it('копия фикстуры совпадает с tools/card-pipeline/html-layout/fixtures/home-chair.html', () => {
    // Корень репозитория — рабочий каталог vitest: под jsdom `import.meta.url` не `file:`.
    const fixture = readFileSync(
      join(process.cwd(), 'tools', 'card-pipeline', 'html-layout', 'fixtures', 'home-chair.html'),
      'utf8',
    ).replace(/\r\n/g, '\n')

    expect(AUTHORED_FIXTURE_HTML).toBe(fixture)
  })

  it('пишет вызов в затраты под именем authorCard', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const usages: ProviderUsage[] = []

    await createStubProvider((usage) => usages.push(usage)).authorCard(input)

    expect(usages).toEqual([{ operation: 'authorCard', vendor: 'stub', costRub: 0, durationMs: 0 }])
  })
})
