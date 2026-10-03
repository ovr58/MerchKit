import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCutoutRunner, createMaskRunner } from './cutout.ts'
import { occupancyOf } from './occupancy.ts'
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

describe('Раннер маски', () => {
  const endpoint = 'https://cutout.example.ru/mask'

  function maskResponse(width: number, height: number, bodyLength = width * height): Response {
    return new Response(new Uint8Array(bodyLength).fill(255), {
      status: 200,
      headers: { 'x-mask-width': String(width), 'x-mask-height': String(height) },
    })
  }

  it('отдаёт сэмплы корректного ответа 192×256 для кадра 1440×1920 и предъявляет секрет с кадром', async () => {
    const frame = frameOf(1440, 1920)
    const seen: { url: string; init: RequestInit }[] = []
    const runner = createMaskRunner({
      endpoint,
      secret: 'общий-секрет',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init: init as RequestInit })
        return maskResponse(192, 256)
      },
    })

    const result = await runner(frame)

    expect(result).not.toBeNull()
    expect(result?.width).toBe(192)
    expect(result?.height).toBe(256)
    expect(result?.alpha).toHaveLength(192 * 256)
    expect(() => occupancyOf(result!)).not.toThrow()
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe(endpoint)
    expect(seen[0].init.method).toBe('POST')
    const headers = seen[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer общий-секрет')
    expect(headers['content-type']).toBe('image/png')
    expect(new Uint8Array(seen[0].init.body as Uint8Array)).toEqual(pngOf(1440, 1920))
  })

  it('терпит округление короткой стороны: кадр 1000×1333 даёт те же 192×256', async () => {
    const runner = createMaskRunner({ endpoint, secret: 's', fetch: async () => maskResponse(192, 256) })

    expect(await runner(frameOf(1000, 1333))).not.toBeNull()
  })

  it('на 204 отдаёт null молча — товара на кадре нет, и это не отказ', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = createMaskRunner({
      endpoint,
      secret: 's',
      fetch: async () => new Response(null, { status: 204 }),
    })

    expect(await runner(frameOf(1440, 1920))).toBeNull()
    expect(logged).not.toHaveBeenCalled()
  })

  it.each([
    ['сервис ответил 500', async () => new Response('', { status: 500 }), 'ответил 500'],
    [
      'сервиса нет на месте',
      async () => { throw new TypeError('fetch failed') },
      'не ответил',
    ],
    ['тело короче заявленного', async () => maskResponse(192, 256, 192 * 256 - 1), 'тело'],
    ['длинная сторона не 256', async () => maskResponse(96, 128), 'длинная сторона'],
    ['пропорция не кадра', async () => maskResponse(256, 256), 'пропорции'],
    [
      'в заголовках нет размера',
      async () => new Response(new Uint8Array(192 * 256), { status: 200 }),
      'заголовках',
    ],
  ])('на отказе «%s» отдаёт null и пишет причину один раз', async (_name, fetch, reason) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const runner = createMaskRunner({
      endpoint,
      secret: 's',
      fetch: fetch as typeof globalThis.fetch,
    })

    expect(await runner(frameOf(1440, 1920))).toBeNull()
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0][0])).toMatch(/^Маска: /)
    expect(String(logged.mock.calls[0][0])).toContain(reason)
  })
})
