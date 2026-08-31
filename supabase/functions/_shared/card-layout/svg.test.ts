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
        frames: [{ dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 }],
        texts: {},
        props: [],
        swatches: [],
      },
    )

    expect(svg).toContain('<feGaussianBlur')
    expect(svg).toContain('stdDeviation="3.6"')
  })
})

/**
 * Дыры, найденные разбросом A6 по шести образцам (2026-08-31). Три из них ломали сборку, а
 * не портили её: на смартфоне вертикальное название легло горизонтально поперёк кадра, у
 * плашки памяти единица «гб» повисала отдельно от привязанного числа, а карточка с детальным
 * снимком получала в угол саму себя вместо детали. Четвёртая — скруглённые углы — видна на
 * трёх образцах из шести.
 */
describe('Поворот слоя', () => {
  it('текст поворачивается вокруг центра своего бокса', () => {
    const svg = compose([
      {
        id: 'name',
        type: 'text',
        z: 1,
        box: { x: 0, y: 0.2, w: 0.2, h: 0.6 },
        rotate: -90,
        style: {
          role: 'display',
          size: 0.08,
          weight: 700,
          color: '#111111',
          align: 'center',
          valign: 'middle',
          lineHeight: 1.1,
        },
        lines: ['i17 Pro Max'],
      },
    ])

    // Центр бокса: x = 0.1 · 300 = 30, y = 0.5 · 400 = 200.
    expect(svg).toContain('rotate(-90 30 200)')
  })

  it('без поворота лишнего преобразования не появляется', () => {
    expect(compose([plate])).not.toContain('rotate(')
  })
})

describe('Прогоны внутри строки', () => {
  const dual = (): Layer => ({
    id: 'dual',
    type: 'text',
    z: 1,
    box: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 },
    bind: { kind: 'prop', index: 0, part: 'value' },
    style: {
      role: 'body',
      size: 0.05,
      weight: 300,
      color: '#ffffff',
      align: 'left',
      valign: 'middle',
      lineHeight: 1.2,
    },
    lines: [[{}, { text: ' SIM', weight: 700 }]],
  })

  it('привязанное значение и статический хвост живут в одной строке', () => {
    const svg = compose([dual()], {
      texts: {},
      props: [{ value: 'Dual' }],
      swatches: [],
    })

    expect(svg).toContain('>Dual<')
    expect(svg).toContain('font-weight="700"')
    // Одна строка — один <text>, хвост внутри него отдельным прогоном.
    expect(svg.match(/<text /g)).toHaveLength(1)
    expect(svg.match(/<tspan/g)).toHaveLength(2)
  })

  it('без привязанного значения уходит вся строка, а не только его половина', () => {
    const svg = compose([dual()], { texts: {}, props: [], swatches: [] })

    expect(svg).not.toContain('SIM')
  })
})

describe('Кадров может быть несколько', () => {
  const detail = (index: number): Layer => ({
    id: 'detail',
    type: 'frame',
    z: 1,
    box: { x: 0.6, y: 0.6, w: 0.4, h: 0.4 },
    fit: 'cover',
    bind: { kind: 'frame', index },
  })

  const frames = [
    { dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 },
    { dataUri: 'data:image/png;base64,BB==', width: 10, height: 10 },
  ]

  it('привязка с индексом берёт свой кадр, а не первый', () => {
    const svg = compose([detail(1)], { texts: {}, props: [], swatches: [], frames })

    expect(svg).toContain('base64,BB==')
    expect(svg).not.toContain('base64,AA==')
  })

  it('нет кадра под индексом — слой снимается правилом K-3', () => {
    const svg = compose([detail(1)], {
      texts: {},
      props: [],
      swatches: [],
      frames: [frames[0]],
    })

    expect(svg).not.toContain('<image')
  })
})

describe('Скруглённые углы у кадра', () => {
  it('радиус превращается в обрезку по скруглённому прямоугольнику', () => {
    const svg = compose(
      [
        {
          id: 'shot',
          type: 'frame',
          z: 1,
          box: { x: 0.02, y: 0.02, w: 0.96, h: 0.96 },
          fit: 'cover',
          radius: 0.02,
          bind: { kind: 'frame' },
        },
      ],
      {
        texts: {},
        props: [],
        swatches: [],
        frames: [{ dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 }],
      },
    )

    expect(svg).toContain('<clipPath')
    expect(svg).toContain('clip-path=')
    expect(svg).toContain('rx=')
  })
})
