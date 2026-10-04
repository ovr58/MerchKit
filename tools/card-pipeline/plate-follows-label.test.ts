import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import { platesUnder } from '../../supabase/functions/_shared/card-layout/direction.ts'
import type {
  CardContent,
  CardLayout,
  ImageRef,
} from '../../supabase/functions/_shared/card-layout/types.ts'
import { resolveLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'

/**
 * Плашка уходит вместе со своей надписью (B29, решение владельца 2026-10-04).
 *
 * Плашка под необязательной надписью или знаком — слой `shape` без привязки — оставалась пустым пятном,
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

/** Чего не хватает макету: текстового гнезда или логотипа. */
type Label = string

const LOGO: Label = 'logo'

function contentOf(sample: Sample, without?: Label): CardContent {
  const texts = { ...sample.content.texts }
  if (without !== undefined) delete texts[without as keyof typeof texts]

  return {
    texts,
    logo: without === LOGO ? undefined : ICON,
    props: sample.content.props.map((prop) => ({ ...prop, icon: prop.icon === undefined ? undefined : ICON })),
    swatches: [],
  }
}

type Pair = { layout: string; plate: string; label: Label }

/** Чем слой надписи называется в содержимом: гнездо текста или логотип; иначе `null`. */
function labelOf(layer: { bind?: { kind: string; slot?: string } }): Label | null {
  if (layer.bind?.kind === 'text') return layer.bind.slot ?? null
  return layer.bind?.kind === 'logo' ? LOGO : null
}

/** Плашки, которые несут ровно одну надпись из гнезда макета и ничего кроме неё. */
function labelPlates(): Pair[] {
  const pairs: Pair[] = []

  for (const sample of samples) {
    const { layers } = resolveLayout(sample.layout, contentOf(sample))
    // Надпись — текстовый слой (привязанный или вшитый) и логотип: плашка под ними одна беда.
    const carriers = layers.filter((placed) => placed.layer.type === 'text' || labelOf(placed.layer) === LOGO)

    for (const carrier of carriers) {
      const label = labelOf(carrier.layer)
      if (label === null) continue

      for (const plate of platesUnder(layers, carrier)) {
        const carried = carriers.filter((other) => platesUnder(layers, other).includes(plate))
        const small = plate.box.w * plate.box.h <= PLATE_RATIO * carrier.box.w * carrier.box.h

        if (carried.length === 1 && small) {
          pairs.push({ layout: sample.layout.id, plate: plate.layer.id, label })
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

  it.each(pairs)('$layout: плашка «$plate» уходит вместе с надписью «$label»', ({ layout, plate, label }) => {
    const sample = samples.find((item) => item.layout.id === layout)!
    const ids = (content: CardContent) =>
      resolveLayout(sample.layout, content).layers.map((placed) => placed.layer.id)

    expect(ids(contentOf(sample))).toContain(plate)
    expect(ids(contentOf(sample, label))).not.toContain(plate)
  })
})
