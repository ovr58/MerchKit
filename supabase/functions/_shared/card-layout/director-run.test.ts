import { describe, expect, it } from 'vitest'

import { DIRECTOR_ATTEMPTS, directorLogLine, runDirector } from './director-run.ts'
import type { DirectorInput } from './director-run.ts'
import type { DirectorBrief } from './direction.ts'
import {
  CONTENT,
  FONTS,
  ICON,
  SIZE,
  baseLayers,
  byLength,
  frame,
  layoutOf,
  productMap,
  text,
} from './direction.fixtures.ts'
import { frameToCanvas } from './frame-space.ts'
import type { FrameLayer, ImageRef, Layer } from './types.ts'

/**
 * Цикл арт-директора (B5.7). Модель, иконки и обмер — подменные; карта занятости — товар
 * справа от столбца 6 из 10, слева свободная зона. Заголовок «на товаре» стоит в правой
 * половине холста, годный бокс — слева.
 */

const FRAME_IMAGE: ImageRef = { dataUri: 'data:image/png;base64,AAAA', width: SIZE.width, height: SIZE.height }
const ON_PRODUCT = { x: 0.5, y: 0.05, w: 0.5, h: 0.1 }
const LEFT = { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }
const ICONS = [{ name: 'bag', description: 'сумка' }]

function asker(...answers: (Record<string, unknown> | Error)[]) {
  const briefs: DirectorBrief[] = []
  const ask = async (brief: DirectorBrief): Promise<Record<string, unknown>> => {
    briefs.push(brief)
    const answer = answers[briefs.length - 1] ?? {}
    if (answer instanceof Error) throw answer
    return answer
  }
  return { ask, briefs }
}

function loader() {
  const loaded: string[][] = []
  const loadIcons = async (names: string[]): Promise<Record<string, ImageRef>> => {
    loaded.push(names)
    return Object.fromEntries(names.map((name) => [name, ICON]))
  }
  return { loadIcons, loaded }
}

function input(over: Partial<DirectorInput> & { layers?: Layer[] } = {}): DirectorInput {
  const { layers, ...rest } = over
  return {
    layout: layoutOf(layers ?? baseLayers(ON_PRODUCT)),
    content: CONTENT,
    texts: { title: 'Куртка мужская', body: 'Тёплая' },
    properties: [{ label: 'Ткань', value: 'Мембрана' }, { label: 'Вес', value: '1 кг' }],
    wishes: '',
    frameMask: productMap(),
    frame: FRAME_IMAGE,
    size: SIZE,
    hasCutout: false,
    icons: ICONS,
    loadIcons: loader().loadIcons,
    ask: asker().ask,
    fonts: FONTS,
    measure: byLength,
    ...rest,
  }
}

const goodTitle = { layerId: 'title', box: LEFT }
// Бокс уходит за правый край холста: форму не проходит.
const badTitle = { layerId: 'title', box: { x: 0.7, y: 0.05, w: 0.5, h: 0.1 } }

describe('runDirector (ADR-0018, п. 3 и 5)', () => {
  it('предпроверка «ничего» — ни одного вызова, ступень 4, макет как есть', async () => {
    const { ask, briefs } = asker({ boxes: [goodTitle] })
    const layout = layoutOf([frame, text('title', LEFT, 'title')])

    const result = await runDirector(input({ layout, ask }))

    expect(briefs).toHaveLength(0)
    expect(result).toMatchObject({ stage: 4, mode: 'none', calls: 0, direction: null, rejected: [], shifted: 0 })
    expect(result.layout).toBe(layout)
  })

  it('годный ответ — один вызов, ступень 1, патч лёг на макет и содержимое', async () => {
    const { ask, briefs } = asker({ boxes: [goodTitle], texts: { subtitle: ['Мембрана'] } })

    const result = await runDirector(input({ ask }))

    expect(briefs).toHaveLength(1)
    expect(result).toMatchObject({ stage: 1, mode: 'full', calls: 1, rejected: [], shifted: 0 })
    expect(result.direction).toEqual({ boxes: [goodTitle], texts: { subtitle: ['Мембрана'] }, icons: [] })
    expect(result.layout.layers.find((layer) => layer.id === 'title')?.box).toEqual(LEFT)
    expect(result.content.texts.subtitle).toEqual(['Мембрана'])
  })

  it('первая постановка: гнёзда макета, иконки макета, возражений нет', async () => {
    const { ask, briefs } = asker({ boxes: [goodTitle] })

    await runDirector(input({ ask }))

    expect(briefs[0]).toMatchObject({
      mode: 'full',
      fillSlots: ['subtitle', 'kicker'],
      iconProps: [0],
      complaints: [],
      icons: ICONS,
    })
  })

  it('годная иконка и негодный бокс заголовка: повтор с возражениями, итог собран из двух ответов', async () => {
    const { ask, briefs } = asker({ boxes: [badTitle], icons: [{ prop: 0, icon: 'bag' }] }, { boxes: [goodTitle] })
    const { loadIcons, loaded } = loader()

    const result = await runDirector(input({ ask, loadIcons }))

    expect(briefs).toHaveLength(2)
    expect(briefs[1].complaints).toHaveLength(1)
    expect(briefs[1].complaints[0]).toContain('бокс «title»')
    // Текст на товаре остался — повтор полный; иконки повтор не переспрашивает.
    expect(briefs[1]).toMatchObject({ mode: 'full', iconProps: [], fillSlots: [] })
    expect(loaded).toEqual([['bag']])
    expect(result).toMatchObject({ stage: 1, calls: 2, rejected: [], shifted: 0 })
    expect(result.direction).toEqual({ boxes: [goodTitle], texts: {}, icons: [{ prop: 0, icon: 'bag' }] })
    expect(result.content.props[0].icon).toBe(ICON)
  })

  it('два негодных ответа по боксу: сдвиг находит зону — ступень 3, повторов не больше одного', async () => {
    const layout = layoutOf(baseLayers({ x: 0.5, y: 0.05, w: 0.3, h: 0.1 }))
    const { ask, briefs } = asker({ boxes: [badTitle] }, { boxes: [badTitle] }, { boxes: [goodTitle] })

    const result = await runDirector(input({ layout, ask }))

    expect(DIRECTOR_ATTEMPTS).toBe(2)
    expect(briefs).toHaveLength(2)
    expect(result).toMatchObject({ stage: 3, calls: 2, shifted: 1 })
    expect(result.rejected.map((entry) => entry.part)).toEqual(['бокс «title»'])
    expect(result.rejected[0].reason).toContain('правый край')
    expect(result.direction?.boxes).toHaveLength(1)
    expect(result.direction?.boxes[0].layerId).toBe('title')
    // Сдвинут влево, размер прежний.
    const moved = result.layout.layers.find((layer) => layer.id === 'title')!.box
    expect(moved.x).toBeLessThan(0.5)
    expect([moved.w, moved.h]).toEqual([0.3, 0.1])
  })

  it('ask бросает — один вызов, ступень 4 с причиной, макет и содержимое входные', async () => {
    // Заголовок такой ширины сдвиг унёс бы с товара: ступень 4 значит, что сдвига после сбоя нет.
    const { ask, briefs } = asker(new Error('таймаут'))
    const arg = input({ ask, layers: baseLayers({ x: 0.5, y: 0.05, w: 0.3, h: 0.1 }) })

    const result = await runDirector(arg)

    expect(briefs).toHaveLength(1)
    expect(result).toMatchObject({ stage: 4, mode: 'full', calls: 1, direction: null, shifted: 0 })
    expect(result.reason).toBe('провайдер: таймаут')
    expect(result.layout).toBe(arg.layout)
    expect(result.content).toBe(arg.content)
  })

  it('повтор упал — остаётся принятое из первой попытки, причина названа', async () => {
    const { ask } = asker({ boxes: [badTitle], icons: [{ prop: 0, icon: 'bag' }] }, new Error('сеть'))

    const result = await runDirector(input({ ask }))

    expect(result).toMatchObject({ stage: 2, calls: 2, reason: 'провайдер: сеть' })
    expect(result.direction?.icons).toEqual([{ prop: 0, icon: 'bag' }])
  })

  it('лёгкая постановка не повторяется из-за текста на товаре: подзаголовок лёг на товар — один вызов', async () => {
    const layers = [
      frame,
      text('title', LEFT, 'title'),
      text('subtitle', { x: 0.5, y: 0.3, w: 0.3, h: 0.05 }, 'subtitle'),
    ]
    const { ask, briefs } = asker({ texts: { subtitle: ['Мембрана'] } })

    const result = await runDirector(input({ ask, layers }))

    expect(briefs).toHaveLength(1)
    expect(result.mode).toBe('content')
  })

  it('принятый бокс и сдвиг другого блока — ступень 2, а не 1', async () => {
    const layers = [
      frame,
      text('title', ON_PRODUCT, 'title'),
      text('subtitle', { x: 0.5, y: 0.3, w: 0.3, h: 0.05 }, 'subtitle'),
    ]
    const { ask } = asker({ boxes: [goodTitle], texts: { subtitle: ['Мембрана'] } })

    const result = await runDirector(input({ ask, layers }))

    expect(result).toMatchObject({ stage: 2, shifted: 1, rejected: [] })
    expect(result.direction?.boxes.map((entry) => entry.layerId)).toEqual(['title', 'subtitle'])
  })

  it('кадр 1024×1024 в макете 3:4 с cover: в брифе карта холста, пересчитанная по размеру кадра', async () => {
    const square: ImageRef = { dataUri: FRAME_IMAGE.dataUri, width: 1024, height: 1024 }
    const { ask, briefs } = asker({ boxes: [goodTitle] })
    const arg = input({ ask, frame: square })
    const frameLayer = arg.layout.layers[0] as FrameLayer

    await runDirector(arg)

    const byFrame = frameToCanvas(productMap(), frameLayer, SIZE, { width: 1024, height: 1024 })
    const byCanvas = frameToCanvas(productMap(), frameLayer, SIZE, SIZE)
    expect(byFrame).not.toEqual(byCanvas)
    expect(briefs[0].map).toEqual(byFrame)
  })

  it('без маски: лёгкая постановка при гнёздах в макете, боксов и карты нет, сдвига нет', async () => {
    const { ask, briefs } = asker({ texts: { subtitle: ['Мембрана'] } })

    const result = await runDirector(input({ ask, frameMask: null }))

    expect(briefs).toHaveLength(1)
    expect(briefs[0].mode).toBe('content')
    expect(briefs[0].layers).toBeUndefined()
    expect(briefs[0].map).toBeUndefined()
    expect(result).toMatchObject({ stage: 1, mode: 'content', calls: 1, shifted: 0 })
    expect(result.direction).toEqual({ boxes: [], texts: { subtitle: ['Мембрана'] }, icons: [] })
  })

  it('пустой ответ (заглушка): один вызов, патч пуст — ступень 4, direction null', async () => {
    const { ask, briefs } = asker({})

    const result = await runDirector(input({ ask, frameMask: null }))

    expect(briefs).toHaveLength(1)
    expect(result).toMatchObject({ stage: 4, mode: 'content', calls: 1, direction: null, rejected: [], shifted: 0 })
    expect(result.reason).toBeUndefined()
  })

  it('отвергнутое гнездо — лёгкий повтор только по нему, с возражением', async () => {
    // «Гарантия» — слова нет у продавца.
    const { ask, briefs } = asker(
      { texts: { subtitle: ['Гарантия пожизненная'], kicker: ['Мембрана'] } },
      { texts: { subtitle: ['Тёплая'] } },
    )

    const result = await runDirector(input({ ask, frameMask: null }))

    expect(briefs).toHaveLength(2)
    expect(briefs[1]).toMatchObject({ mode: 'content', fillSlots: ['subtitle'], iconProps: [] })
    expect(briefs[1].complaints[0]).toContain('гнездо «subtitle»')
    expect(result).toMatchObject({ stage: 1, calls: 2, rejected: [] })
    expect(result.direction?.texts).toEqual({ kicker: ['Мембрана'], subtitle: ['Тёплая'] })
  })

  it('гнездо отвергнуто и на повторе — ступень 2, отвергнутое названо', async () => {
    const bad = { texts: { subtitle: ['Гарантия пожизненная'], kicker: ['Мембрана'] } }
    const { ask } = asker(bad, bad)

    const result = await runDirector(input({ ask, frameMask: null }))

    expect(result).toMatchObject({ stage: 2, calls: 2 })
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].part).toBe('гнездо «subtitle»')
  })

  it('иконка не загрузилась — часть отвергнута, генерация не падает', async () => {
    const { ask } = asker({ icons: [{ prop: 0, icon: 'bag' }], texts: { kicker: ['Мембрана'] } })
    const loadIcons = async (): Promise<Record<string, ImageRef>> => {
      throw new Error('нет файла')
    }

    const result = await runDirector(input({ ask, loadIcons, frameMask: null }))

    expect(result.stage).toBe(2)
    expect(result.rejected).toEqual([{ part: 'иконка свойства 0', reason: 'файл иконки «bag» не загрузился: нет файла' }])
    expect(result.direction?.icons).toEqual([])
    expect(result.content.props[0].icon).toBeUndefined()
  })
})

describe('directorLogLine', () => {
  it('одна строка: ступень, постановка, вызовы, счётчики, сдвиг, отвергнутое с причиной', async () => {
    const layout = layoutOf(baseLayers({ x: 0.5, y: 0.05, w: 0.3, h: 0.1 }))
    const { ask } = asker({ boxes: [badTitle] }, { boxes: [badTitle] })
    const result = await runDirector(input({ layout, ask }))

    expect(directorLogLine(result)).toBe(
      'Арт-директор: ступень 3 · постановка full · вызовов 2 · боксы 0/1 · гнёзда 0/0 · иконки 0/0 · ' +
        'сдвинуто 1 · отвергнуто: бокс «title» — выходит за правый край (x + w = 1.2)',
    )
  })

  it('без вызова — постановка «—», отвергнутого нет; причина провайдера дописана', async () => {
    const none = await runDirector(input({ layout: layoutOf([frame, text('title', LEFT, 'title')]) }))
    const failed = await runDirector(input({ ask: asker(new Error('таймаут')).ask }))

    expect(directorLogLine(none)).toBe(
      'Арт-директор: ступень 4 · постановка — · вызовов 0 · боксы 0/0 · гнёзда 0/0 · иконки 0/0 · сдвинуто 0 · отвергнуто: —',
    )
    expect(directorLogLine(failed)).toMatch(/вызовов 1 .* · провайдер: таймаут$/)
  })
})
