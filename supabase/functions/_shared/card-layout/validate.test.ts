import { describe, expect, it } from 'vitest'

import { resolveLayout, validateLayout } from './validate.ts'
import type { CardContent, CardLayout, Layer } from './types.ts'

/**
 * Закрепляются два правила, на которых держится вся сборка: словарь закрыт (макет, сочинённый
 * моделью, отбраковывается ДО рендера) и отсутствующий ассет снимает свой слой, а не роняет
 * макет (K-3 плана `card-assembly-pipeline_2026-08-31.md`).
 */

const IMAGE = { dataUri: 'data:image/png;base64,AA==', width: 10, height: 10 }

function layout(layers: Layer[]): CardLayout {
  return {
    id: 'test',
    title: 'Тестовый макет',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

function content(patch: Partial<CardContent> = {}): CardContent {
  return { texts: {}, props: [], swatches: [], ...patch }
}

const frame: Layer = {
  id: 'frame',
  type: 'frame',
  z: 0,
  box: { x: 0, y: 0, w: 1, h: 1 },
  fit: 'cover',
  bind: { kind: 'frame' },
}

const title: Layer = {
  id: 'title',
  type: 'text',
  z: 10,
  box: { x: 0.05, y: 0.2, w: 0.5, h: 0.1 },
  bind: { kind: 'text', slot: 'title' },
  style: {
    role: 'display',
    size: 0.07,
    weight: 900,
    color: '#111111',
    align: 'left',
    valign: 'top',
    lineHeight: 1.1,
  },
}

describe('Валидатор макета: закрытые словари', () => {
  it('пропускает корректный макет', () => {
    expect(validateLayout(layout([frame, title]))).toEqual([])
  })

  it('отбраковывает тип слоя вне словаря', () => {
    const alien = { ...frame, type: 'hologram' } as unknown as Layer
    expect(validateLayout(layout([alien])).join(' ')).toContain('не входит в словарь')
  })

  it('отбраковывает эффект вне словаря', () => {
    const glow = {
      ...frame,
      effects: [{ kind: 'glow', radius: 0.01 }],
    } as unknown as Layer
    expect(validateLayout(layout([glow])).join(' ')).toContain('эффект «glow» не входит в словарь')
  })

  it('отбраковывает роль шрифта вне словаря', () => {
    const wrong = { ...title, style: { ...title.style, role: 'serif' } } as unknown as Layer
    expect(validateLayout(layout([frame, wrong])).join(' ')).toContain('роль шрифта')
  })

  it('ловит слой, целиком уехавший за холст', () => {
    const gone: Layer = { ...frame, id: 'gone', box: { x: 1.2, y: 0, w: 0.2, h: 0.2 } }
    expect(validateLayout(layout([frame, gone])).join(' ')).toContain('не пересекается с холстом')
  })

  it('ловит дубль идентификатора', () => {
    expect(validateLayout(layout([frame, { ...title, id: 'frame' }])).join(' ')).toContain(
      'встречается дважды',
    )
  })

  it('принимает радиальную заливку и ловит нулевой радиус', () => {
    const lens = (radius: number): Layer => ({
      id: 'lens',
      type: 'shape',
      z: 5,
      box: { x: 0.1, y: 0.3, w: 0.2, h: 0.2 },
      shape: { form: 'rect', radius: 0.03 },
      fill: {
        kind: 'radial',
        center: { x: 0.42, y: 0.34 },
        radius,
        stops: [
          { at: 0, color: '#fdfdfc' },
          { at: 1, color: '#d3cfca' },
        ],
      },
    })

    expect(validateLayout(layout([frame, lens(0.78)]))).toEqual([])
    expect(validateLayout(layout([frame, lens(0)])).join(' ')).toContain('радиус градиента')
  })

  it('ловит обводку нулевой толщины', () => {
    const outlined: Layer = {
      ...frame,
      id: 'outlined',
      effects: [{ kind: 'stroke', color: '#e6e2dc', thickness: 0 }],
    }
    expect(validateLayout(layout([frame, outlined])).join(' ')).toContain('толщина обводки')
  })

  it('ловит текст без привязки и без строк', () => {
    const empty: Layer = { ...title, id: 'empty', bind: undefined }
    expect(validateLayout(layout([frame, empty])).join(' ')).toContain('нет строк')
  })
})

describe('K-3: отсутствующий ассет снимает свой слой, а не роняет макет', () => {
  const logo: Layer = {
    id: 'logo',
    type: 'asset',
    z: 20,
    box: { x: 0.4, y: 0.02, w: 0.2, h: 0.06 },
    fit: 'contain',
    bind: { kind: 'logo' },
  }

  it('без логотипа снимается только слой логотипа', () => {
    const resolved = resolveLayout(
      layout([frame, title, logo]),
      content({ frame: IMAGE, texts: { title: ['КУРТКА'] } }),
    )

    expect(resolved.layers.map((placed) => placed.layer.id)).toEqual(['frame', 'title'])
    expect(resolved.dropped).toEqual([{ id: 'logo', reason: 'логотип не загружен' }])
  })

  it('модуль без иконки рисуется текстом: снимается иконка, не модуль', () => {
    const module: Layer = {
      id: 'prop-0',
      type: 'group',
      z: 30,
      box: { x: 0.05, y: 0.5, w: 0.5, h: 0.1 },
      bind: { kind: 'prop', index: 0 },
      children: [
        {
          id: 'prop-0-icon',
          type: 'asset',
          z: 1,
          box: { x: 0, y: 0, w: 0.2, h: 1 },
          fit: 'contain',
          bind: { kind: 'prop', index: 0, part: 'icon' },
        },
        {
          ...title,
          id: 'prop-0-label',
          z: 2,
          box: { x: 0.25, y: 0, w: 0.75, h: 1 },
          bind: { kind: 'prop', index: 0, part: 'label' },
        },
      ],
    }

    const resolved = resolveLayout(
      layout([frame, module]),
      content({ frame: IMAGE, props: [{ label: 'Пропитка' }] }),
    )

    expect(resolved.layers.map((placed) => placed.layer.id)).toEqual(['frame', 'prop-0-label'])
    expect(resolved.dropped.map((drop) => drop.id)).toEqual(['prop-0-icon'])
  })

  it('нет самой характеристики — модуль не рисуется вовсе', () => {
    const module: Layer = {
      id: 'prop-1',
      type: 'group',
      z: 30,
      box: { x: 0.05, y: 0.5, w: 0.5, h: 0.1 },
      bind: { kind: 'prop', index: 1 },
      children: [{ ...title, id: 'prop-1-label', bind: { kind: 'prop', index: 1, part: 'label' } }],
    }

    const resolved = resolveLayout(
      layout([frame, module]),
      content({ frame: IMAGE, props: [{ label: 'Пропитка' }] }),
    )

    expect(resolved.layers.map((placed) => placed.layer.id)).toEqual(['frame'])
    expect(resolved.dropped).toEqual([{ id: 'prop-1', reason: 'характеристики №2 нет' }])
  })
})

describe('Плашка — леса, а не содержимое', () => {
  /** Общий случай образца «куртка»: в плашке может быть картинка, может быть текст, может
   *  быть и то и другое. Сама плашка привязок не имеет и держится на своих слоях. */
  function markPlate(): Layer {
    return {
      id: 'mark',
      type: 'group',
      z: 40,
      box: { x: 0.05, y: 0.6, w: 0.4, h: 0.06 },
      children: [
        {
          id: 'mark-plate',
          type: 'shape',
          z: 1,
          box: { x: 0, y: 0, w: 1, h: 1 },
          shape: { form: 'rect', radius: 0.01 },
          fill: { kind: 'solid', color: '#ffffff' },
        },
        {
          ...title,
          id: 'mark-text',
          z: 2,
          box: { x: 0.1, y: 0, w: 0.6, h: 1 },
          bind: { kind: 'prop', index: 0, part: 'value' },
        },
        {
          id: 'mark-icon',
          type: 'asset',
          z: 3,
          box: { x: 0.8, y: 0.2, w: 0.1, h: 0.6 },
          fit: 'contain',
          bind: { kind: 'prop', index: 0, part: 'icon' },
        },
      ],
    }
  }

  const ids = (layers: { layer: Layer }[]) => layers.map((placed) => placed.layer.id)

  it('есть и картинка, и текст — рисуется всё', () => {
    const resolved = resolveLayout(
      layout([markPlate()]),
      content({ props: [{ value: '+Add Shield', icon: IMAGE }] }),
    )
    expect(ids(resolved.layers)).toEqual(['mark-plate', 'mark-text', 'mark-icon'])
  })

  it('есть только картинка — плашка остаётся под ней', () => {
    const resolved = resolveLayout(layout([markPlate()]), content({ props: [{ icon: IMAGE }] }))
    expect(ids(resolved.layers)).toEqual(['mark-plate', 'mark-icon'])
  })

  it('нет ни картинки, ни текста — плашка уходит вместе с ними, пустой коробки не остаётся', () => {
    const resolved = resolveLayout(layout([markPlate()]), content({ props: [{ label: 'Пропитка' }] }))
    expect(ids(resolved.layers)).toEqual([])
    expect(resolved.dropped.map((drop) => drop.id)).toContain('mark')
  })
})

describe('Раскрытие групп и z-порядок', () => {
  it('координаты вложенного слоя пересчитываются в доли холста', () => {
    const module: Layer = {
      id: 'module',
      type: 'group',
      z: 10,
      box: { x: 0.2, y: 0.4, w: 0.4, h: 0.2 },
      children: [
        {
          id: 'plate',
          type: 'shape',
          z: 1,
          box: { x: 0.5, y: 0, w: 0.5, h: 1 },
          shape: { form: 'rect' },
          fill: { kind: 'solid', color: '#ffffff' },
        },
      ],
    }

    const [placed] = resolveLayout(layout([module]), content()).layers

    expect(placed.box).toEqual({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
    expect(placed.z).toBe(11)
  })

  it('слои выдаются по возрастанию z, а не по порядку записи', () => {
    const back: Layer = { ...title, id: 'back', z: 50, bind: undefined, lines: ['зад'] }
    const front: Layer = { ...title, id: 'front', z: 5, bind: undefined, lines: ['перед'] }

    const resolved = resolveLayout(layout([back, front]), content())

    expect(resolved.layers.map((placed) => placed.layer.id)).toEqual(['front', 'back'])
  })
})
