import { describe, expect, it } from 'vitest'

import { CARD_RENDER_ASSETS_BUCKET, createRendererAssets } from './renderer-assets.ts'

const encoder = new TextEncoder()

describe('Ресурсы растеризатора', () => {
  it('скачиваются один раз на холодный старт, включая параллельную инициализацию', async () => {
    const files = new Map<string, Uint8Array>([
      ['resvg/index_bg.wasm', new Uint8Array([0, 97, 115, 109])],
      ['fonts/manifest.json', encoder.encode(JSON.stringify({ fonts: ['fonts/heading.ttf', 'fonts/body.ttf'] }))],
      ['fonts/heading.ttf', new Uint8Array([1])],
      ['fonts/body.ttf', new Uint8Array([2])],
    ])
    const calls: string[] = []
    const load = createRendererAssets(async (bucket, path) => {
      calls.push(`${bucket}/${path}`)
      return files.get(path)!
    })

    const [first, second] = await Promise.all([load(), load()])

    expect(first).toBe(second)
    expect(first.wasm).toEqual(new Uint8Array([0, 97, 115, 109]))
    expect(first.fonts).toEqual([new Uint8Array([1]), new Uint8Array([2])])
    expect(calls).toEqual([
      `${CARD_RENDER_ASSETS_BUCKET}/resvg/index_bg.wasm`,
      `${CARD_RENDER_ASSETS_BUCKET}/fonts/manifest.json`,
      `${CARD_RENDER_ASSETS_BUCKET}/fonts/heading.ttf`,
      `${CARD_RENDER_ASSETS_BUCKET}/fonts/body.ttf`,
    ])

    await load()
    expect(calls).toHaveLength(4)
  })

  it('does not retain a failed cold-start download', async () => {
    let attempts = 0
    const load = createRendererAssets(async (_bucket, path) => {
      attempts += 1
      if (attempts === 1) throw new Error('Storage unavailable')
      if (path === 'resvg/index_bg.wasm') return new Uint8Array([0, 97, 115, 109])
      if (path === 'fonts/manifest.json') return encoder.encode(JSON.stringify({ fonts: [] }))
      throw new Error(`Unexpected file ${path}`)
    })

    await expect(load()).rejects.toThrow('Storage unavailable')
    await expect(load()).resolves.toEqual({ wasm: new Uint8Array([0, 97, 115, 109]), fonts: [] })
  })
})
