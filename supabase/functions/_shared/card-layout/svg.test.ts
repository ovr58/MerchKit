import { describe, expect, it } from 'vitest'

import { composeSvg } from './svg.ts'
import type { FontFamilies } from './svg.ts'
import type { CardContent, CardLayout, Layer } from './types.ts'

/**
 * Закрепляются те слова словаря, которых сборщик однажды **не умел**, хотя они были объявлены,
 * и те, которых не было вовсе, — обе дыры нашёл гейт A3 (2026-08-31) на образцах «куртка» и
 * «платье». Тест не о красоте кадра: он о том, что объявленное действительно доезжает до SVG.
 */

const FONTS: FontFamilies = {
  display: 'Montserrat',
  heading: 'Montserrat',
  body: 'Montserrat',
  label: 'Montserrat',
  accent: 'Marck Script',
}

const SIZE = { width: 300, height: 400 }

function compose(layers: Layer[], content: CardContent = { texts: {}, props: [], swatches: [] }) {
  const layout: CardLayout = {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
  return composeSvg(layout, content, SIZE, FONTS).svg
}

const plate: Layer = {
  id: 'plate',
  type: 'shape',
  z: 1,
  box: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
  shape: { form: 'rect', radius: 0.02 },
  fill: { kind: 'solid', color: '#141210', opacity: 0.42 },
}

describe('Обводка доезжает до фигуры и до текста', () => {
  it('фигура получает stroke и stroke-width', () => {
    const svg = compose([
      { ...plate, effects: [{ kind: 'stroke', color: '#e6e2dc', thickness: 0.01, opacity: 0.75 }] },
    ])

    expect(svg).toContain('stroke="#e6e2dc"')
    // Толщина — доля меньшей стороны холста: 0.01 × 300.
    expect(svg).toContain('stroke-width="3"')
    expect(svg).toContain('stroke-opacity="0.75"')
  })

  it('у текста обводка идёт с paint-order, иначе она съедает штрих глифа', () => {
    const svg = compose([
      {
        id: 'label',
        type: 'text',
        z: 2,
        box: { x: 0.1, y: 0.4, w: 0.8, h: 0.1 },
        lines: ['Для походов'],
        effects: [{ kind: 'stroke', color: '#ffffff', thickness: 0.004 }],
        style: {
          role: 'heading',
          size: 0.03,
          weight: 700,
          color: '#111111',
          align: 'left',
          valign: 'middle',
          lineHeight: 1,
        },
      },
    ])

    expect(svg).toContain('paint-order="stroke"')
    expect(svg).toContain('stroke="#ffffff"')
  })

  it('обводка не превращается в фильтр — тень и размытие остаются фильтром, она нет', () => {
    const svg = compose([
      { ...plate, effects: [{ kind: 'stroke', color: '#e6e2dc', thickness: 0.01 }] },
    ])

    expect(svg).not.toContain('<filter')
  })
})

describe('Радиальная заливка', () => {
  it('объявляется радиальным градиентом в единицах бокса', () => {
    const svg = compose([
      {
        ...plate,
        fill: {
          kind: 'radial',
          center: { x: 0.42, y: 0.34 },
          radius: 0.78,
          stops: [
            { at: 0, color: '#fdfdfc' },
            { at: 1, color: '#d3cfca' },
          ],
        },
      },
    ])

    expect(svg).toContain('<radialGradient')
    expect(svg).toContain('cx="0.42"')
    expect(svg).toContain('r="0.78"')
    expect(svg).toContain('stop-color="#d3cfca"')
  })
})

describe('Размытие остаётся фильтром', () => {
  it('слой с размытием получает feGaussianBlur', () => {
    const svg = compose(
      [
        {
          id: 'column-photo',
          type: 'frame',
          z: 1,
          box: { x: 0, y: 0, w: 0.4, h: 1 },
          fit: 'cover',
          effects: [{ kind: 'blur', radius: 0.012 }],
          bind: { kind: 'frame' },
        },
      ],
      {
        frame: { dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 },
        texts: {},
        props: [],
        swatches: [],
      },
    )

    expect(svg).toContain('<feGaussianBlur')
    expect(svg).toContain('stdDeviation="3.6"')
  })
})
