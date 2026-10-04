import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import { propSlots } from '../../supabase/functions/_shared/card-layout/prop-slots.ts'
import type { CardLayout, Layer } from '../../supabase/functions/_shared/card-layout/types.ts'

/**
 * Смысл гнёзд свойств в библиотеке макетов (B28, решение владельца «гнездо по смыслу»).
 *
 * Гнездо свойства, в котором макет несёт вшитый текст («мес», «Вт», «Dual », «ГОДА»), получает
 * смысл: без него вшитое встало бы рядом с любым свойством, какое окажется N-м («5.3 мес» у
 * Bluetooth). Валидатор макета этот инвариант не держит: смысл — необязательное поле, и макет без
 * него законен. Держит библиотека — этим тестом.
 */

type Sample = { layout: CardLayout }

const DIR = resolvePath(process.cwd(), 'tools/card-pipeline/samples')
const samples: Sample[] = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(resolvePath(DIR, name), 'utf8')) as Sample)

const LETTER = /\p{L}/u

/** Вшитый текст с буквами в гнезде свойства: адрес — «макет → слой», номер гнезда — значение. */
function embeddedTexts(layers: Layer[], slot: number | null, found: Map<string, number>, id: string): void {
  for (const layer of layers) {
    const own = layer.bind?.kind === 'prop' ? layer.bind.index : slot

    if (layer.type === 'text' && own !== null) {
      const staticLetters = (layer.lines ?? []).flatMap((line) =>
        typeof line === 'string' ? [line] : line.flatMap((run) => (run.text === undefined ? [] : [run.text])),
      )
      if (staticLetters.some((text) => LETTER.test(text))) found.set(`${id} → ${layer.id}`, own)
    }

    if (layer.type === 'group') embeddedTexts(layer.children, own, found, id)
  }
}

describe('смысл гнёзд свойств в библиотеке', () => {
  it('у каждого гнезда с вшитым текстом есть смысл', () => {
    const missing: string[] = []

    for (const { layout } of samples) {
      const found = new Map<string, number>()
      embeddedTexts(layout.layers, null, found, layout.id)

      const meanings = new Map(propSlots(layout).map((slot) => [slot.index, slot.meaning]))
      for (const [address, index] of found) {
        if (meanings.get(index) === undefined) missing.push(`${address} (гнездо ${index})`)
      }
    }

    expect(missing).toEqual([])
  })

  it('смысл — список слов, и у гнезда он один на все слои', () => {
    const problems: string[] = []

    for (const { layout } of samples) {
      const seen = new Map<number, string>()
      const visit = (layers: Layer[]): void => {
        for (const layer of layers) {
          const bind = layer.bind
          if (bind?.kind === 'prop' && 'meaning' in bind) {
            const list = bind.meaning
            const valid =
              Array.isArray(list) &&
              list.length > 0 &&
              list.every((variant) => typeof variant === 'string' && LETTER.test(variant))
            if (!valid) problems.push(`${layout.id} → ${layer.id}: смысл не список слов`)

            const written = JSON.stringify(list)
            const before = seen.get(bind.index)
            if (before !== undefined && before !== written) {
              problems.push(`${layout.id} → ${layer.id}: у гнезда ${bind.index} два разных смысла`)
            }
            seen.set(bind.index, written)
          }
          if (layer.type === 'group') visit(layer.children)
        }
      }
      visit(layout.layers)
    }

    expect(problems).toEqual([])
  })
})
