import { describe, expect, it } from 'vitest'

import { blockCount, encodeBlockJpeg, readJpegSize } from './jpeg.ts'

/**
 * Кодировщик проверяется структурно: что это JPEG, что в заголовке стоят заданные размеры
 * и что поток заканчивается там, где должен. «Картинка выглядит правильно» здесь
 * недоказуемо — это проверялось разбором посторонними декодерами (см. план вехи M4).
 */
describe('encodeBlockJpeg', () => {
  const solid = () => [242, 243, 245] as const

  it('размечает файл маркерами начала и конца изображения', () => {
    const bytes = encodeBlockJpeg(1200, 1600, solid)

    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8])
    expect([bytes[bytes.length - 2], bytes[bytes.length - 1]]).toEqual([0xff, 0xd9])
  })

  it.each([
    ['вертикальный кадр площадок', 1200, 1600],
    ['квадрат Ozon Fresh', 1600, 1600],
    ['размер не кратный восьми', 301, 205],
  ])('пишет в заголовок ровно тот размер, что просили: %s', (_case, width, height) => {
    expect(readJpegSize(encodeBlockJpeg(width, height, solid))).toEqual({ width, height })
  })

  it('спрашивает цвет по одному разу на блок, а не на пиксель', () => {
    const asked = new Set<string>()
    encodeBlockJpeg(1200, 1600, (x, y) => {
      asked.add(`${x}:${y}`)
      return solid()
    })

    expect(asked.size).toBe(blockCount(1200) * blockCount(1600))
  })

  it('не оставляет 0xFF без байт-стаффинга: иначе декодер увидит чужой маркер', () => {
    // Плотный шум даёт длинные коды и максимум шансов родить 0xFF внутри данных.
    const bytes = encodeBlockJpeg(320, 320, (x, y) => [(x * 37) % 256, (y * 91) % 256, (x * y) % 256])
    const data = bytes.subarray(bytes.indexOf(0xda) + 12, bytes.length - 2)

    for (let at = 0; at < data.length - 1; at++) {
      if (data[at] === 0xff) expect(data[at + 1]).toBe(0x00)
    }
  })

  it('отказывается кодировать бессмысленный размер', () => {
    expect(() => encodeBlockJpeg(0, 100, solid)).toThrow(/Недопустимый размер/)
    expect(() => encodeBlockJpeg(100, 1.5, solid)).toThrow(/Недопустимый размер/)
  })
})

describe('readJpegSize', () => {
  it('не принимает за JPEG то, что им не является', () => {
    expect(readJpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(readJpegSize(new Uint8Array([]))).toBeNull()
  })

  it('переживает обрезанный файл, а не падает на нём', () => {
    expect(readJpegSize(encodeBlockJpeg(1200, 1600, () => [0, 0, 0]).subarray(0, 8))).toBeNull()
  })
})
