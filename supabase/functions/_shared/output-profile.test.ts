import { describe, expect, it } from 'vitest'

import { describeProfileMismatch } from './output-profile.ts'
import type { OutputProfile } from './ai-provider/types.ts'

/**
 * Сверка готового файла с профилем площадки (FR-25, долг ADR-0012 закрыт шагом B7.3).
 *
 * Карточку собираем мы и в пикселях профиля, поэтому размер сверяется на равенство: пиксель
 * в сторону — уже не тот кадр, который мы обещали площадке.
 */

const PROFILE: OutputProfile = {
  marketplaceId: 'ozon',
  marketplaceTitle: 'Ozon',
  categoryId: 'clothing',
  width: 1440,
  height: 1920,
  minWidth: 900,
  minHeight: 1200,
  aspectW: 3,
  aspectH: 4,
  aspectLabel: '3 : 4',
  formats: ['jpeg', 'png'],
  maxBytes: 10_485_760,
  colorSpace: 'sRGB',
  backgroundHex: '#ffffff',
  backgroundTitle: 'белый',
}

/** Заголовок PNG нужного размера: проверка читает только подпись и IHDR. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('Сверка файла с профилем площадки', () => {
  it('принимает файл ровно в размер профиля', () => {
    expect(describeProfileMismatch(pngHeader(1440, 1920), PROFILE)).toBeNull()
  })

  it('отвергает файл на пиксель больше профиля', () => {
    expect(describeProfileMismatch(pngHeader(1440, 1921), PROFILE)).toMatch(/1440 × 1921 не совпадает/)
  })

  it('отвергает файл той же пропорции, но другого размера', () => {
    expect(describeProfileMismatch(pngHeader(1800, 2400), PROFILE)).toMatch(/не совпадает с профилем/)
  })

  it('отвергает формат, которого площадка не принимает', () => {
    expect(describeProfileMismatch(pngHeader(1440, 1920), { ...PROFILE, formats: ['jpeg'] })).toMatch(/формат png/)
  })

  it('отвергает файл тяжелее предела площадки', () => {
    expect(describeProfileMismatch(pngHeader(1440, 1920), { ...PROFILE, maxBytes: 10 })).toMatch(/превышает предел/)
  })
})
