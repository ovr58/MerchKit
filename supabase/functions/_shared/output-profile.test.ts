import { describe, expect, it } from 'vitest'

import { describeProfileMismatch } from './output-profile.ts'
import type { OutputProfile } from './ai-provider/types.ts'

/**
 * Сверка готового файла с профилем площадки (FR-25).
 *
 * Два режима. Кадр вендора (фото) — порогом и допуском по соотношению: точный размер вендору
 * недостижим (миграция 20260829140000). Собранная карточка — точным размером профиля: её
 * рисует наш сборщик (ADR-0012, шаг B7.3).
 */

const PROFILE: OutputProfile = {
  marketplaceId: 'wildberries',
  marketplaceTitle: 'Wildberries',
  categoryId: 'clothing',
  width: 896,
  height: 1200,
  minWidth: 700,
  minHeight: 900,
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

describe('Сверка кадра вендора (фото): порог и допуск', () => {
  it('принимает кадр 1536×2048 при профиле 896×1200 — выше порога, та же пропорция', () => {
    expect(describeProfileMismatch(pngHeader(1536, 2048), PROFILE)).toBeNull()
  })

  it('отвергает кадр ниже порога площадки', () => {
    expect(describeProfileMismatch(pngHeader(600, 800), PROFILE)).toMatch(/ниже порога/)
  })

  it('отвергает кадр другой пропорции', () => {
    expect(describeProfileMismatch(pngHeader(1024, 1024), PROFILE)).toMatch(/соотношение сторон/)
  })

  it('отвергает формат, которого площадка не принимает', () => {
    expect(describeProfileMismatch(pngHeader(896, 1200), { ...PROFILE, formats: ['jpeg'] })).toMatch(/формат png/)
  })

  it('отвергает файл тяжелее предела площадки', () => {
    expect(describeProfileMismatch(pngHeader(896, 1200), { ...PROFILE, maxBytes: 10 })).toMatch(/превышает предел/)
  })
})

describe('Сверка собранной карточки: точный размер профиля', () => {
  it('принимает карточку ровно в размер профиля', () => {
    expect(describeProfileMismatch(pngHeader(896, 1200), PROFILE, { exact: true })).toBeNull()
  })

  it('отвергает карточку на пиксель выше профиля', () => {
    expect(describeProfileMismatch(pngHeader(896, 1201), PROFILE, { exact: true })).toMatch(/896 × 1201 не совпадает/)
  })

  it('отвергает карточку на пиксель шире профиля', () => {
    expect(describeProfileMismatch(pngHeader(897, 1200), PROFILE, { exact: true })).toMatch(/не совпадает с профилем/)
  })
})
