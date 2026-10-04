import { afterEach, describe, expect, it, vi } from 'vitest'

import { createStubProvider } from './stub.ts'
import type { ProviderUsage } from './types.ts'

/**
 * `authorCard` заглушки (ADR-0019, п. 3): местный прогон и тесты воркера получают HTML той же
 * формы, что скил-жанр требует от модели, — холст `#card`, кадр `img#frame`, надпись
 * продавца, — и строку затрат с нулевой ценой.
 */
describe('Заглушка: операция authorCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const input = {
    frame: new Uint8Array([1, 2, 3]),
    references: [],
    seller: { title: 'Куртка <бомбер> & шарф', description: '', properties: [], wishes: '' },
    marketplaceId: 'ozon',
    categoryId: 'clothing',
    canvas: { width: 900, height: 1200 },
  }

  it('отдаёт HTML с #card и img#frame размером холста и заголовком продавца', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })

    const { html } = await createStubProvider().authorCard(input)

    expect(html).toMatch(/<div id="card"[^>]*width:900px;height:1200px/)
    expect(html).toMatch(/<img id="frame" src="frame\.png"/)
    expect(html).toContain('Куртка &lt;бомбер&gt; &amp; шарф')
  })

  it('пишет вызов в затраты под именем authorCard', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const usages: ProviderUsage[] = []

    await createStubProvider((usage) => usages.push(usage)).authorCard(input)

    expect(usages).toEqual([{ operation: 'authorCard', vendor: 'stub', costRub: 0, durationMs: 0 }])
  })
})
