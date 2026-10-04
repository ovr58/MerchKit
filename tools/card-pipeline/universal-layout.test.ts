import { readdirSync, readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CardContent, CardLayout, ImageRef } from '../../supabase/functions/_shared/card-layout/types.ts'
import { resolveLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'

/**
 * Универсальный макет библиотеки и список тяжёлых (шаг B7.7, решения Q-1 и Q-3).
 *
 * Источник правды — `card_layouts`, а рабочая копия `samples/` несёт то же решение для
 * `cards:layouts push` после `db reset`: без этого локальный стенд молча теряет признаки.
 */

type Sample = {
  layout: CardLayout
  isFallback?: boolean
  edgeHeavy?: boolean
  content: { texts: CardContent['texts']; props: { label?: string; value?: string }[] }
}

// Путь от корня запуска: `import.meta.url` в jsdom-окружении не годится для файловых API.
const DIR = resolvePath(process.cwd(), 'tools/card-pipeline/samples')
const samples: Sample[] = readdirSync(DIR)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(resolvePath(DIR, name), 'utf8')) as Sample)

const ICON: ImageRef = { dataUri: 'data:image/png;base64,AA==', width: 24, height: 24 }

function universal(): Sample {
  return samples.find((sample) => sample.isFallback === true)!
}

function resolve(withIcons: boolean) {
  const { texts, props } = universal().content
  return resolveLayout(universal().layout, {
    texts,
    props: props.map((prop) => ({ ...prop, icon: withIcons ? ICON : undefined })),
    swatches: [],
  })
}

describe('универсальный макет', () => {
  it('в рабочей копии он один: school-shirt-girls-dark', () => {
    const fallbacks = samples.filter((sample) => sample.isFallback === true)

    expect(fallbacks.map((sample) => sample.layout.id)).toEqual(['school-shirt-girls-dark'])
  })

  it('не несёт вшитой плашки с назначением товара', () => {
    const texts = JSON.stringify(universal().layout).toLowerCase()

    expect(texts).not.toContain('для школы')
  })

  it('рисует круг-подложку иконки, пока иконка есть', () => {
    const ids = resolve(true).layers.map((placed) => placed.layer.id)

    expect(ids).toContain('prop-0-disc')
    expect(ids).toContain('prop-0-icon')
  })

  it('без иконки снимает круг-подложку вместе с ней (правило O-7)', () => {
    const { layers, dropped } = resolve(false)
    const ids = layers.map((placed) => placed.layer.id)

    expect(ids.filter((id) => id.endsWith('-disc'))).toEqual([])
    expect(dropped.map((layer) => layer.id)).toEqual(
      expect.arrayContaining(['prop-0-badge', 'prop-1-badge', 'prop-2-badge']),
    )
    // Подпись и значение модуля остаются: без иконки модуль не пропадает.
    expect(ids).toContain('prop-0-label')
  })
})

describe('тяжёлые макеты', () => {
  it('рабочая копия помечает dress-summer и tires-formula-ice, как миграция', () => {
    const heavy = samples.filter((sample) => sample.edgeHeavy === true).map((sample) => sample.layout.id)

    expect(heavy.sort()).toEqual(['dress-summer', 'tires-formula-ice'])
  })

  it('универсальный макет не тяжёлый', () => {
    expect(universal().edgeHeavy).toBeUndefined()
  })
})
