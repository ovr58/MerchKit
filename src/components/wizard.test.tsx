import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { OutputProfile } from '@/features/taxonomy'

import { OutputParams } from './wizard'

// Блок разметки не ходит в базу, но модули мастера на импорте поднимают клиент Supabase.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

/**
 * Блок «Каким получится файл» обещает продавцу размер до списания баллов (FR-25). Пока
 * сборка карточки в изоляте, большой профиль собирается в порог площадки (шаг B7.7, решение
 * Q-2) — и обещать надо тот размер, в который файл собирается на деле.
 */

const OZON_CLOTHING: OutputProfile = {
  marketplaceId: 'ozon',
  categoryId: 'clothing',
  width: 1792,
  height: 2400,
  minWidth: 900,
  minHeight: 1200,
  aspectLabel: '3 : 4',
  formats: ['jpeg', 'png'],
  colorSpace: 'sRGB',
  backgroundHex: '#ffffff',
  backgroundTitle: 'белый',
}

describe('OutputParams', () => {
  it('для карточки показывает размер сборки: порог профиля, а не целевой кадр', () => {
    render(<OutputParams kind="card" profile={OZON_CLOTHING} />)

    expect(screen.getByText('900 × 1200')).toBeTruthy()
    expect(screen.queryByText('1792 × 2400')).toBeNull()
  })

  it('для фото показывает целевой кадр профиля', () => {
    render(<OutputParams kind="photo" profile={OZON_CLOTHING} />)

    expect(screen.getByText('1792 × 2400')).toBeTruthy()
  })

  it('профиль по умолчанию не меняется', () => {
    render(<OutputParams kind="card" profile={{ ...OZON_CLOTHING, width: 896, height: 1200, minWidth: 700, minHeight: 900 }} />)

    expect(screen.getByText('896 × 1200')).toBeTruthy()
  })
})
