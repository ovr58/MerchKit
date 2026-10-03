import { describe, expect, it } from 'vitest'

import { cardFilling, fromStored, imageBytes, imageRef, storedContent } from './filling.ts'
import type { CardLayout, Layer } from './types.ts'

/**
 * Наполнение макета на настоящей сборке (шаг B7.2).
 *
 * Проверяется то, что отличает сборку от превью: рыбы нет, ненаполненное гнездо отсутствует,
 * хвост сверх ёмкости назван, и хранимая форма без картинок восстанавливается в ту же
 * рабочую — иначе пересборка (B7.5) собрала бы другую карточку.
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

function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

function propModule(index: number): Layer {
  return { id: `prop-${index}`, type: 'text', z: index + 10, box, style, bind: { kind: 'prop', index } }
}

const frameLayer: Layer = { id: 'frame', type: 'frame', z: 0, box, fit: 'cover', bind: { kind: 'frame' } }
const cutoutLayer: Layer = { id: 'cutout', type: 'cutout', z: 2, box, fit: 'cover', bind: { kind: 'cutout' } }
const logoLayer: Layer = { id: 'logo', type: 'asset', z: 3, box, fit: 'contain', bind: { kind: 'logo' } }
const titleLayer: Layer = { id: 'title', type: 'text', z: 4, box, style, bind: { kind: 'text', slot: 'title' } }
const subtitleLayer: Layer = {
  id: 'subtitle',
  type: 'text',
  z: 5,
  box,
  style,
  bind: { kind: 'text', slot: 'subtitle' },
}

/** Настоящий PNG 1×1: `imageRef` читает формат и размер из байтов, как на сборке. */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  ),
  (char) => char.charCodeAt(0),
)

const IMAGE = imageRef(PNG)

const INPUT = {
  title: 'Джинсы прямого кроя',
  description: 'Плотный деним, не садятся после стирки',
  properties: [
    { label: 'Материал', value: 'Хлопок' },
    { label: '  ', value: '' },
    { label: 'Посадка', value: 'Средняя' },
    { label: 'Сезон', value: 'Всесезон' },
  ],
  frame: IMAGE,
  cutout: IMAGE,
  logo: IMAGE,
}

describe('Наполнение макета на сборке (M7 B7.2)', () => {
  it('режет характеристики по ёмкости с хвоста и отдаёт хвост в cut, пустые отброшены', () => {
    const filling = cardFilling(layoutOf([frameLayer, propModule(0), propModule(1)]), INPUT)

    expect(filling.content.props).toEqual([
      { label: 'Материал', value: 'Хлопок' },
      { label: 'Посадка', value: 'Средняя' },
    ])
    expect(filling.cut).toEqual([{ label: 'Сезон', value: 'Всесезон' }])
  })

  it('не кладёт знак и вырез в макет, который их не использует', () => {
    const filling = cardFilling(layoutOf([frameLayer, titleLayer]), INPUT)

    expect(filling.content.logo).toBeUndefined()
    expect(filling.content.cutout).toBeUndefined()
  })

  it('кладёт знак и вырез, когда макет их использует и они есть', () => {
    const filling = cardFilling(layoutOf([frameLayer, cutoutLayer, logoLayer]), INPUT)

    expect(filling.content.logo).toBe(IMAGE)
    expect(filling.content.cutout).toBe(IMAGE)
    expect(cardFilling(layoutOf([logoLayer]), { ...INPUT, logo: null }).content.logo).toBeUndefined()
  })

  it('наполняет только заголовок и описание: остальные гнёзда отсутствуют, рыбы нет', () => {
    const filling = cardFilling(layoutOf([frameLayer, titleLayer, subtitleLayer]), INPUT)

    expect(filling.content.texts).toEqual({ title: [INPUT.title], body: [INPUT.description] })
    expect(filling.content.frames).toEqual([IMAGE])
    expect(filling.content.swatches).toEqual([])
  })

  it('хранимая форма без картинок восстанавливается в исходное содержимое', async () => {
    const { content } = cardFilling(layoutOf([frameLayer, cutoutLayer, logoLayer, propModule(0)]), INPUT)
    const paths = { frames: ['u/g/frame-1.png'], cutout: 'u/g/cutout-1.png', logo: 'u/1-logo.png' }

    const stored = storedContent(content, paths)
    expect(JSON.stringify(stored)).not.toContain('data:')
    expect(stored.logo).toEqual({ bucket: 'uploads', path: 'u/1-logo.png', width: 1, height: 1 })
    expect(stored.frames).toEqual([{ bucket: 'results', path: 'u/g/frame-1.png', width: 1, height: 1 }])

    const requested: string[] = []
    const restored = await fromStored(JSON.parse(JSON.stringify(stored)), async (bucket, path) => {
      requested.push(`${bucket}/${path}`)
      return PNG
    })

    expect(restored).toEqual(content)
    expect(requested.sort()).toEqual(['results/u/g/cutout-1.png', 'results/u/g/frame-1.png', 'uploads/u/1-logo.png'])
  })

  it('без пути для картинки хранимую форму не пишет', () => {
    const { content } = cardFilling(layoutOf([frameLayer]), INPUT)
    expect(() => storedContent(content, { frames: [] })).toThrow(/кадра 1/)
  })

  it('картинка и байты переводятся друг в друга без потерь', () => {
    expect(imageBytes(IMAGE)).toEqual(PNG)
    expect(IMAGE).toMatchObject({ width: 1, height: 1 })
    expect(IMAGE.dataUri.startsWith('data:image/png;base64,')).toBe(true)
  })
})
