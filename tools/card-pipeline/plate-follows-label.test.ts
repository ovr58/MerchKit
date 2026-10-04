import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import { platesUnder } from '../../supabase/functions/_shared/card-layout/direction.ts'
import type {
  CardContent,
  CardLayout,
  ImageRef,
  TextSlot,
} from '../../supabase/functions/_shared/card-layout/types.ts'
import { resolveLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'

/**
 * Плашка уходит вместе со своей надписью (B29, решение владельца 2026-10-04).
 *
 * Плашка под необязательной надписью — слой `shape` без привязки — оставалась пустым пятном,
 * когда надпись снималась правилом K-3: у `crocs-flipflops-features` чёрный овал `kicker-plate`
 * лёг поверх заголовка. Тест не знает списка плашек: он находит их по геометрии на самой
 * библиотеке, поэтому новый макет с плашкой без привязки упадёт здесь же, а не на странице
 * владельца.
 */

type Sample = {
  layout: CardLayout
  content: {
    texts: CardContent['texts']
    props: { label?: string; value?: string; icon?: string }[]
  }
}

const DIR = resolvePath(process.cwd(), 'tools/card-pipeline/samples')
const samples: Sample[] = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(resolvePath(DIR, name), 'utf8')) as Sample)

const ICON: ImageRef = { dataUri: 'data:image/png;base64,AA==', width: 24, height: 24 }

/** Плашка больше надписи не втрое — подложка надписи; крупнее — панель или фон кадра. */
const PLATE_RATIO = 3

function contentOf(sample: Sample, without?: TextSlot): CardContent {
  const texts = { ...sample.content.texts }
  if (without !== undefined) delete texts[without]

  return {
    texts,
    props: sample.content.props.map((prop) => ({ ...prop, icon: prop.icon === undefined ? undefined : ICON })),
    swatches: [],
  }
}

type Pair = { layout: string; plate: string; slot: TextSlot }

/** Плашки, которые несут ровно одну надпись из гнезда макета и ничего кроме неё. */
function labelPlates(): Pair[] {
  const pairs: Pair[] = []

  for (const sample of samples) {
    const { layers } = resolveLayout(sample.layout, contentOf(sample))
    const texts = layers.filter((placed) => placed.layer.type === 'text')

    for (const text of texts) {
      const bind = text.layer.bind
      if (bind?.kind !== 'text') continue

      for (const plate of platesUnder(layers, text)) {
        const carried = texts.filter((other) => platesUnder(layers, other).includes(plate))
        const small = plate.box.w * plate.box.h <= PLATE_RATIO * text.box.w * text.box.h

        if (carried.length === 1 && small) {
          pairs.push({ layout: sample.layout.id, plate: plate.layer.id, slot: bind.slot })
        }
      }
    }
  }

  return pairs
}

describe('плашка надписи (B29)', () => {
  const pairs = labelPlates()

  it('в библиотеке такие плашки есть: тест не пуст', () => {
    expect(pairs.length).toBeGreaterThan(5)
  })

  it.each(pairs)('$layout: плашка «$plate» уходит вместе с надписью «$slot»', ({ layout, plate, slot }) => {
    const sample = samples.find((item) => item.layout.id === layout)!
    const ids = (content: CardContent) =>
      resolveLayout(sample.layout, content).layers.map((placed) => placed.layer.id)

    expect(ids(contentOf(sample))).toContain(plate)
    expect(ids(contentOf(sample, slot))).not.toContain(plate)
  })
})
