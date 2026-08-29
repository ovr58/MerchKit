import { describe, expect, it } from 'vitest'

import { ACCEPTED_FORMATS_HUMAN, MAX_PHOTO_BYTES, rejectPhoto } from './uploads.ts'

/**
 * US-E1 требует не просто отклонить файл, а **назвать допустимые форматы и предельный
 * размер**. Поэтому проверяется не булево «подошёл/не подошёл», а сам текст отказа: он
 * уходит человеку под зону загрузки.
 */
describe('rejectPhoto', () => {
  const photo = (patch: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: 'куртка.jpg',
    type: 'image/jpeg',
    size: 1024,
    ...patch,
  })

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])(
    'принимает формат, который принимают все три площадки: %s',
    (type) => {
      expect(rejectPhoto(photo({ type }))).toBeNull()
    },
  )

  it('называет допустимые форматы, а не просто отказывает', () => {
    const reason = rejectPhoto(photo({ name: 'scan.tiff', type: 'image/tiff' }))

    expect(reason).toContain(ACCEPTED_FORMATS_HUMAN)
  })

  it('называет предельный размер и фактический, чтобы было понятно насколько промах', () => {
    const reason = rejectPhoto(photo({ size: MAX_PHOTO_BYTES + 1 }))

    expect(reason).toContain('10 МБ')
    expect(reason).toContain('10.1 МБ')
  })

  it('файл ровно в предел проходит: граница включительная', () => {
    expect(rejectPhoto(photo({ size: MAX_PHOTO_BYTES }))).toBeNull()
  })

  it('формат проверяется раньше размера: назвать обе причины сразу человеку бесполезно', () => {
    const reason = rejectPhoto(photo({ type: 'application/pdf', size: MAX_PHOTO_BYTES * 3 }))

    expect(reason).toContain(ACCEPTED_FORMATS_HUMAN)
  })
})
