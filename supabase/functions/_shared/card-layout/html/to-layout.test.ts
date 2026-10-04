import { describe, expect, it } from 'vitest'

import scene from '../../../../../tools/card-pipeline/html-layout/fixtures/home-chair.scene.json'
import families from '../../../../../tools/card-pipeline/fonts/roles.json'
import type { FontFamilies } from '../svg.ts'
import type { Layer, ShapeLayer, TextLayer } from '../types.ts'
import { validateLayout } from '../validate.ts'
import type { HtmlScene, SceneElement } from './scene.ts'
import { toLayout } from './to-layout.ts'

const fixture = scene as HtmlScene
const canvas = { width: 896, height: 1200 }
const fonts = families as FontFamilies
const seller = {
  title: 'Кресло',
  body: 'Стильное кресло-крыло с акцентной обивкой из трех цветных блоков.',
  props: [
    { label: 'Тип товара', value: 'Кресло-крыло' },
    { label: 'Дизайн обивки', value: 'Разделена на три цветных блока' },
    { label: 'Материал опор', value: 'Дерево' },
  ],
}

const texts = (layers: Layer[]) => layers.filter((layer): layer is TextLayer => layer.type === 'text')
const byText = (layers: Layer[], text: string) =>
  texts(layers).find((layer) => layer.lines?.[0] === text)

/** Сцена из одного элемента поверх фикстуры: кадр и один проверяемый элемент. */
const sceneWith = (element: Partial<SceneElement> & Pick<SceneElement, 'kind'>): HtmlScene => {
  const base = fixture.elements[2]
  return {
    ...fixture,
    elements: [fixture.elements[0], { ...base, ...element, style: { ...base.style, ...element.style }, order: 1 }],
  }
}

describe('B3: сцена HTML → макет и содержимое', () => {
  it('фикстура переводится без проблем и проходит валидатор', () => {
    const { layout, content, problems } = toLayout(fixture, canvas, seller, fonts)

    expect(problems).toEqual([])
    expect(validateLayout(layout)).toEqual([])
    expect(texts(layout.layers)).toHaveLength(fixture.elements.filter((element) => element.kind === 'text').length)

    const title = texts(layout.layers).find((layer) => layer.bind?.kind === 'text' && layer.bind.slot === 'title')
    expect(title?.style.transform).toBe('upper')
    expect(title?.style.weight).toBe(900)
    expect(title?.style.align).toBe('center')
    expect(title?.lines).toBeUndefined()
    expect(content.texts.title).toEqual(['Кресло'])

    expect(layout.layers.find((layer) => layer.type === 'frame')?.bind).toEqual({ kind: 'frame' })
  })

  it('свойства: подпись и значение привязаны, часть значения — статические строки', () => {
    const { layout } = toLayout(fixture, canvas, seller, fonts)

    const label = texts(layout.layers).find((layer) => layer.bind?.kind === 'prop' && layer.bind.part === 'label' && layer.bind.index === 0)
    expect(label?.style.transform).toBe('upper')
    const value = texts(layout.layers).find((layer) => layer.bind?.kind === 'prop' && layer.bind.part === 'value' && layer.bind.index === 0)
    expect(value).toBeDefined()

    const partial = byText(layout.layers, 'Три цветных')
    expect(partial?.bind).toBeUndefined()
    expect(partial?.lines).toEqual(['Три цветных', 'блока'])
  })

  it('плашка с подписью — фигура под текстом тем же боксом, подпись по центру', () => {
    const { layout } = toLayout(fixture, canvas, seller, fonts)

    const kicker = byText(layout.layers, 'Кресло с ушами')
    const plate = layout.layers.find((layer): layer is ShapeLayer => layer.type === 'shape' && layer.z === (kicker?.z ?? 0) - 1)
    expect(plate?.fill).toEqual({ kind: 'solid', color: '#c8102e' })
    expect(plate?.shape).toEqual({ form: 'rect', radius: expect.closeTo(19 / 896, 4) })
    expect(plate?.box).toEqual(kicker?.box)
    expect(kicker?.style.align).toBe('center')
    expect(kicker?.style.valign).toBe('middle')

    const digit = byText(layout.layers, '1')
    expect(digit?.style.align).toBe('center')
    expect(digit?.style.valign).toBe('middle')
  })

  it('z — порядок сцены с шагом 10, id — вид и номер', () => {
    const { layout } = toLayout(fixture, canvas, seller, fonts)

    expect(layout.layers.find((layer) => layer.id === 'frame-0')?.z).toBe(0)
    expect(layout.layers.find((layer) => layer.id === 'text-2')?.z).toBe(20)
    expect(layout.layers.find((layer) => layer.id === 'shape-3')?.z).toBe(30)
  })

  it('прописные без text-transform при смешанном регистре продавца — transform upper', () => {
    const element = fixture.elements[2]
    const caps = sceneWith({
      kind: 'text',
      style: { ...element.style, textTransform: 'none' },
      lines: [{ ...element.lines![0], text: 'КРЕСЛО' }],
    })

    const { layout, content, problems } = toLayout(caps, canvas, seller, fonts)

    expect(problems).toEqual([])
    expect(texts(layout.layers)[0].style.transform).toBe('upper')
    expect(content.texts.title).toEqual(['Кресло'])
  })

  it('перенесённое описание привязано, строки содержимого — словами продавца по переносам', () => {
    const element = fixture.elements[2]
    const words = seller.body.split(' ')
    const wrapped = sceneWith({
      kind: 'text',
      lines: [
        { ...element.lines![0], text: words.slice(0, 4).join(' ').toLowerCase() },
        { rect: { ...element.lines![0].rect, y: element.lines![0].rect.y + 100 }, text: words.slice(4).join(' ') },
      ],
    })

    const { layout, content } = toLayout(wrapped, canvas, seller, fonts)

    expect(texts(layout.layers)[0].bind).toEqual({ kind: 'text', slot: 'body' })
    expect(content.texts.body).toEqual([words.slice(0, 4).join(' '), words.slice(4).join(' ')])
  })

  it('линейный градиент вниз — две точки в долях бокса', () => {
    const gradient = sceneWith({
      kind: 'shape',
      lines: undefined,
      style: { ...fixture.elements[3].style, backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0) 0%, rgb(0, 0, 0) 100%)' },
    })

    const { layout, problems } = toLayout(gradient, canvas, seller, fonts)

    expect(problems).toEqual([])
    expect((layout.layers[1] as ShapeLayer).fill).toEqual({
      kind: 'linear',
      from: { x: 0.5, y: 0 },
      to: { x: 0.5, y: 1 },
      stops: [
        { at: 0, color: '#000000', opacity: 0 },
        { at: 1, color: '#000000' },
      ],
    })
  })

  it('то, что не легло, — в problems', () => {
    const element = fixture.elements[2]
    const odd = sceneWith({ kind: 'text', style: { ...element.style, fontFamily: 'Arial', color: 'color(srgb 1 0 0)' } })
    const slanted = sceneWith({ kind: 'shape', lines: undefined, style: { ...fixture.elements[3].style, backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'linear-gradient(45deg, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)' } })
    const rejected = { ...fixture, rejected: [{ selector: 'svg#pic', reason: 'тег <svg>' }] }

    expect(toLayout(odd, canvas, seller, fonts).problems.join('\n')).toMatch(/Arial[\s\S]*color\(srgb/)
    expect(toLayout(slanted, canvas, seller, fonts).problems.join('\n')).toMatch(/45deg/)
    expect(toLayout(rejected, canvas, seller, fonts).problems.join('\n')).toMatch(/svg#pic/)
  })
})
