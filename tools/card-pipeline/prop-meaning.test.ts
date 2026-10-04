import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CardLayout, Layer } from '../../supabase/functions/_shared/card-layout/types.ts'

/**
 * Гнёзда свойств в библиотеке макетов (B28: «гнездо по смыслу», вариант А владельца).
 *
 * Гнездо свойства берёт свойство по подписи (`meaning`), а значение выводит так, как его написал
 * продавец: единицы («гб», «мес», «Вт»), предлоги («от», «до», «по», «Dual ») и надписи рядом со
 * значением в макете не вшиваются — иначе они дублируют слова продавца («256 ГБ гб») или встают
 * рядом с чужим значением. Валидатор макета этого не держит: вшитый текст для языка законен
 * (подписи-надписи, декор). Держит библиотека — этим тестом.
 */

type Sample = { layout: CardLayout }

const DIR = resolvePath(process.cwd(), 'tools/card-pipeline/samples')
const samples: Sample[] = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(resolvePath(DIR, name), 'utf8')) as Sample)

const LETTER = /\p{L}/u

/** Надписи-подписи модуля, не относящиеся к значению: стоят отдельным слоем и остаются. */
const CAPTIONS = new Set(['gost-cert', 'warranty-ribbon-text'])

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

describe('гнёзда свойств в библиотеке', () => {
  it('рядом со значением гнезда нет вшитого текста — ни в строках слоя, ни отдельным слоем', () => {
    const embedded: string[] = []

    for (const { layout } of samples) {
      const found = new Map<string, number>()
      embeddedTexts(layout.layers, null, found, layout.id)

      for (const [address, index] of found) {
        if (!CAPTIONS.has(address.split(' → ')[1])) embedded.push(`${address} (гнездо ${index})`)
      }
    }

    expect(embedded).toEqual([])
  })

  it('у ИБП подпись слота гарантии не лежит единицей рядом с числом', () => {
    const layout = samples.find((sample) => sample.layout.id === 'ups-rucelf-upi750')!.layout
    const ids = new Set<string>()
    const collect = (layers: Layer[]): void => {
      for (const layer of layers) {
        ids.add(layer.id)
        if (layer.type === 'group') collect(layer.children)
      }
    }
    collect(layout.layers)

    expect(ids.has('warranty-number')).toBe(true)
    expect(ids.has('warranty-unit')).toBe(false)
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
