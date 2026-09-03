import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCutoutRunner } from './cutout.ts'
import type { ImageRef } from './types.ts'

/** PNG ровно настолько настоящий, насколько его читает `readImageInfo`: подпись плюс IHDR с
 *  размером. Пиксели никого здесь не интересуют — проверяется шов, а не растеризация. */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}

function frameOf(width: number, height: number): ImageRef {
  const bytes = pngOf(width, height)
  const binary = String.fromCharCode(...bytes)
  return { dataUri: `data:image/png;base64,${btoa(binary)}`, width, height }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Шов раннера выреза', () => {
  it('отдаёт вырез и предъявляет секрет тем самым кадром, что получил', async () => {
    const frame = frameOf(1440, 1920)
    const cut = pngOf(1440, 1920)
    const seen: { url: string; init: RequestInit }[] = []
    const runner = createCutoutRunner({
      endpoint: 'https://cutout.example.ru/cutout',
      secret: 'общий-секрет',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init as RequestInit })
        return new Response(cut, { status: 200 })
      },
    })

    const result = await runner(frame)

    expect(result).toEqual({ dataUri: frame.dataUri, width: 1440, height: 1920 })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://cutout.example.ru/cutout')
    expect(seen[0].init.method).toBe('POST')
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
      'Bearer общий-секрет',
    )
    expect(new Uint8Array(seen[0].init.body as Uint8Array)).toEqual(pngOf(1440, 1920))
  })

  it('на 204 отдаёт null молча — товара на кадре нет, и это не отказ', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = createCutoutRunner({
      endpoint: 'https://cutout.example.ru/cutout',
      secret: 's',
      fetch: async () => new Response(null, { status: 204 }),
    })

    expect(await runner(frameOf(800, 800))).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it.each([
    ['сервис отвергает секрет', async () => new Response('', { status: 401 })],
    ['сервиса нет на месте', async () => { throw new TypeError('fetch failed') }],
  ])('на отказе «%s» отдаёт null и пишет причину — сборка идёт по K-3', async (_name, fetch) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = createCutoutRunner({
      endpoint: 'https://cutout.example.ru/cutout',
      secret: 's',
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(await runner(frameOf(800, 800))).toBeNull()
    expect(logged).toHaveBeenCalledTimes(1)
  })

  it('отвергает вырез не того размера: слой ложится на кадр пиксель в пиксель', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = createCutoutRunner({
      endpoint: 'https://cutout.example.ru/cutout',
      secret: 's',
      fetch: async () => new Response(pngOf(1024, 1024), { status: 200 }),
    })

    expect(await runner(frameOf(1440, 1920))).toBeNull()
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('1440×1920'))
  })
})
