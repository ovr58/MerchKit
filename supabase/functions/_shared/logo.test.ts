import { describe, expect, it } from 'vitest'

import { MAX_LOGO_BYTES, rejectLogo, rejectLogoSize } from './logo.ts'

/**
 * Проверка логотипа (шаг B3). Проверяется то, ради чего она заведена: в кадр не должен
 * попасть файл, который выглядит там браком, — и наоборот, годный знак не должен быть
 * отвергнут из-за формы, которая у знаков нормальна (широкая надпись, палитровый PNG).
 */

/** PNG ровно настолько настоящий, насколько его читает `rejectLogo`: подпись, IHDR и
 *  перечисленные чанки. Контрольные суммы не считаются — их читатель и не смотрит. */
function png(options: {
  width: number
  height: number
  colorType: number
  chunks?: string[]
  padding?: number
}): Uint8Array {
  const chunks = options.chunks ?? []
  const padding = options.padding ?? 0
  const size = 8 + 25 + chunks.length * 12 + 12 + padding
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)

  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, options.width)
  view.setUint32(20, options.height)
  bytes[24] = 8
  bytes[25] = options.colorType

  let offset = 33
  for (const name of [...chunks, 'IDAT']) {
    view.setUint32(offset, 0)
    for (let index = 0; index < 4; index += 1) bytes[offset + 4 + index] = name.charCodeAt(index)
    offset += 12
  }

  return bytes
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0])

describe('Проверка логотипа', () => {
  it('принимает PNG с альфа-каналом', () => {
    expect(rejectLogo(png({ width: 800, height: 800, colorType: 6 }))).toBeNull()
  })

  it('принимает широкую надпись: длинной стороны достаточно', () => {
    // Знак-надпись 900×110 — обычная форма логотипа. Требуй мы 400 px по каждой стороне,
    // отказ получил бы совершенно годный файл.
    expect(rejectLogo(png({ width: 900, height: 110, colorType: 6 }))).toBeNull()
  })

  it('принимает палитровый PNG с чанком tRNS', () => {
    expect(rejectLogo(png({ width: 600, height: 600, colorType: 3, chunks: ['PLTE', 'tRNS'] }))).toBeNull()
  })

  it('отвергает PNG без прозрачности — это главный случай, ради которого проверка заведена', () => {
    const reason = rejectLogo(png({ width: 800, height: 800, colorType: 2 }))

    expect(reason).toContain('непрозрачный фон')
  })

  it('не считает прозрачным PNG, у которого tRNS стоял бы после пиксельных данных', () => {
    // Проход по чанкам обязан останавливаться на IDAT: иначе случайная последовательность
    // байт внутри сжатых данных выдала бы себя за объявление прозрачности.
    const reason = rejectLogo(png({ width: 800, height: 800, colorType: 2, chunks: [] }))

    expect(reason).toContain('непрозрачный фон')
  })

  it('отвергает не-PNG раньше остальных проверок', () => {
    expect(rejectLogo(JPEG)).toContain('нужен PNG')
  })

  it('отвергает мелкий знак: в гнезде макета он растянется в мыло', () => {
    const reason = rejectLogo(png({ width: 200, height: 200, colorType: 6 }))

    expect(reason).toContain('200×200')
  })

  it('отвергает файл сверх предела до чтения содержимого', () => {
    expect(rejectLogoSize(MAX_LOGO_BYTES + 1)).toContain('больше предела')
    expect(rejectLogoSize(MAX_LOGO_BYTES)).toBeNull()
  })

  it('к великанскому файлу претензия по размеру, а не по формату', () => {
    const huge = png({ width: 800, height: 800, colorType: 6, padding: MAX_LOGO_BYTES })

    expect(rejectLogo(huge)).toContain('больше предела')
  })
})
