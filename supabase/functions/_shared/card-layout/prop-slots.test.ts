import { describe, expect, it } from 'vitest'

import { arrangeProps, fitsMeaning, propSlots } from './prop-slots.ts'
import type { CardLayout, Layer } from './types.ts'

/**
 * Раскладка характеристик по гнёздам макета (B28, решение владельца «гнездо по смыслу»).
 *
 * Гнездо со смыслом берёт свойство по подписи, а не по номеру; гнездо без подходящего свойства
 * остаётся пустым, и правило K-3 снимает его слой. Гнёзда без смысла наполняются по-старому —
 * по порядку важности, тем, что не заняли гнёзда со смыслом.
 */

const style = {
  role: 'body' as const,
  size: 0.05,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}
const box = { x: 0, y: 0, w: 0.5, h: 0.1 }

function slot(index: number, meaning?: string[]): Layer {
  return {
    id: `slot-${index}`,
    type: 'text',
    z: index + 1,
    box,
    style,
    bind: { kind: 'prop', index, part: 'value', ...(meaning === undefined ? {} : { meaning }) },
  }
}

function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

const MEMORY = { label: 'Объём встроенной памяти', value: '256 ГБ' }
const WEIGHT = { label: 'Вес', value: '45 г' }
const WARRANTY = { label: 'Гарантийный срок', value: '12 месяцев' }
const COLOR = { label: 'Цвет', value: 'Чёрный' }

describe('propSlots', () => {
  it('перечисляет гнёзда по номеру, смысл берёт у любого слоя гнезда', () => {
    const layout = layoutOf([
      slot(1, ['памят']),
      {
        id: 'module-0',
        type: 'group',
        z: 5,
        box,
        bind: { kind: 'prop', index: 0 },
        children: [slot(0, ['гаранти'])],
      },
    ])

    expect(propSlots(layout)).toEqual([
      { index: 0, meaning: ['гаранти'] },
      { index: 1, meaning: ['памят'] },
    ])
  })

  it('смысл, записанный не списком непустых слов, не считается смыслом', () => {
    const broken = { kind: 'prop', index: 0, part: 'value', meaning: [' ', ''] } as const
    const notList = { kind: 'prop', index: 1, part: 'value', meaning: 'памят' } as unknown as typeof broken
    const layout = layoutOf([
      { id: 'a', type: 'text', z: 1, box, style, bind: broken },
      { id: 'b', type: 'text', z: 2, box, style, bind: notList },
    ])

    expect(propSlots(layout)).toEqual([
      { index: 0, meaning: undefined },
      { index: 1, meaning: undefined },
    ])
  })
})

describe('fitsMeaning', () => {
  it('ищет слово смысла в подписи и значении без учёта регистра и ё/е', () => {
    expect(fitsMeaning(['чёрн'], { label: 'Цвет', value: 'ЧЕРНЫЙ' })).toBe(true)
  })

  it('слово от четырёх знаков — по началу слова: окончания меняются', () => {
    expect(fitsMeaning(['гаранти'], { label: 'Гарантия', value: '1 год' })).toBe(true)
    expect(fitsMeaning(['гаранти'], { label: 'Гарантийный срок', value: '1 год' })).toBe(true)
    expect(fitsMeaning(['гаранти'], { label: 'Вес', value: '45 г' })).toBe(false)
  })

  it('слово короче четырёх знаков — только целиком: «ва» не ловит «вариант»', () => {
    expect(fitsMeaning(['ва'], { label: 'Вариант', value: 'А' })).toBe(false)
    expect(fitsMeaning(['ва'], { label: 'Мощность', value: '750 ВА' })).toBe(true)
  })

  it('слова одного варианта нужны все, варианты — любой', () => {
    const power = { label: 'Мощность', value: '480 Вт' }

    expect(fitsMeaning(['мощн ва'], power)).toBe(false)
    expect(fitsMeaning(['мощн вт'], power)).toBe(true)
    expect(fitsMeaning(['мощн ва', 'мощн вт'], power)).toBe(true)
  })
})

describe('arrangeProps', () => {
  it('без смыслов раскладывает по порядку, а лишнее называет хвостом', () => {
    const layout = layoutOf([slot(0), slot(1)])

    const { placed, cut } = arrangeProps(layout, [WEIGHT, MEMORY, COLOR])

    expect(placed).toEqual([WEIGHT, MEMORY])
    expect(cut).toEqual([COLOR])
  })

  it('кладёт свойство в гнездо своего смысла, а не в то, что по номеру', () => {
    const layout = layoutOf([slot(0, ['гаранти']), slot(1, ['памят'])])

    const { placed, cut } = arrangeProps(layout, [MEMORY, WEIGHT, WARRANTY])

    expect(placed).toEqual([WARRANTY, MEMORY])
    expect(cut).toEqual([WEIGHT])
  })

  it('гнездо без подходящего свойства остаётся пустым, не беря чужое', () => {
    const layout = layoutOf([slot(0, ['гаранти']), slot(1)])

    const { placed, cut } = arrangeProps(layout, [WEIGHT, COLOR])

    expect(placed).toEqual([undefined, WEIGHT])
    expect(cut).toEqual([COLOR])
  })

  it('свойство смысла не достаётся безымянному гнезду, стоящему раньше по номеру', () => {
    const layout = layoutOf([slot(0), slot(1, ['памят'])])

    const { placed } = arrangeProps(layout, [MEMORY, WEIGHT])

    expect(placed).toEqual([WEIGHT, MEMORY])
  })

  it('два гнезда одного смысла берут два разных свойства', () => {
    const layout = layoutOf([slot(0, ['памят']), slot(1, ['памят'])])
    const ram = { label: 'Оперативная память', value: '16 ГБ' }

    const { placed, cut } = arrangeProps(layout, [MEMORY, ram, WEIGHT])

    expect(placed).toEqual([MEMORY, ram])
    expect(cut).toEqual([WEIGHT])
  })

  it('хвост из пустых гнёзд обрезается, пустое гнездо посередине остаётся', () => {
    const layout = layoutOf([slot(0, ['гаранти']), slot(1), slot(2, ['памят'])])

    expect(arrangeProps(layout, [WEIGHT]).placed).toEqual([undefined, WEIGHT])
    expect(arrangeProps(layout, [WEIGHT, MEMORY]).placed).toEqual([undefined, WEIGHT, MEMORY])
  })

  it('нет свойств — нечего класть', () => {
    expect(arrangeProps(layoutOf([slot(0, ['памят'])]), [])).toEqual({ placed: [], cut: [] })
  })
})
