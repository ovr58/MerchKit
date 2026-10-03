/**
 * Общие фикстуры тестов арт-директора (B5.4, B5.5, B5.11): макет, карта занятости и
 * обмерщик, подобранные так, чтобы каждое число в тестах считалось в уме.
 *
 * Холст 300 × 400 px. Товар на карте занимает правую часть кадра (столбцы от `fromCol` из
 * десяти), слева — свободная зона. Текст в 0,1 высоты холста — 40 px, кегль 0,04 — 16 px.
 */

import type { FontFamilies } from './svg.ts'
import type { OccupancyMap } from './occupancy.ts'
import type { Box, CardContent, CardLayout, ImageRef, Layer, TextLayer } from './types.ts'

export const FONTS: FontFamilies = {
  display: 'Montserrat',
  heading: 'Montserrat',
  body: 'Montserrat',
  label: 'Montserrat',
  accent: 'Marck Script',
}

export const SIZE = { width: 300, height: 400 }

/** Ширина строки — число знаков на десять пикселей: обмер обязан быть предсказуемым. */
export const byLength = (svg: string): number => (svg.match(/>([^<]*)<\/text>/)?.[1].length ?? 0) * 10

export const ICON: ImageRef = { dataUri: 'data:image/png;base64,AAAA', width: 8, height: 8 }

const style = {
  role: 'body' as const,
  size: 0.04,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}

export function layoutOf(layers: Layer[]): CardLayout {
  return {
    id: 'fixture',
    title: 'Фикстура',
    canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
    layers,
  }
}

export const frame: Layer = {
  id: 'frame',
  type: 'frame',
  z: 0,
  box: { x: 0, y: 0, w: 1, h: 1 },
  fit: 'cover',
  bind: { kind: 'frame' },
}

export function text(id: string, box: Box, slot: 'title' | 'subtitle' | 'kicker' | 'body' | 'brand', z = 5): TextLayer {
  return { id, type: 'text', z, box, style, bind: { kind: 'text', slot } }
}

export function plate(id: string, box: Box, z: number): Layer {
  return { id, type: 'shape', z, box, shape: { form: 'rect' }, fill: { kind: 'solid', color: '#222222' } }
}

/** Модуль свойства `index`: плашка, иконка и подпись; координаты детей — доли группы. */
export function moduleGroup(box: Box, index = 0, id = 'mod'): Layer {
  return {
    id,
    type: 'group',
    z: 4,
    box,
    children: [
      plate(`${id}-plate`, { x: 0, y: 0, w: 1, h: 1 }, 0),
      {
        id: `${id}-icon`,
        type: 'asset',
        z: 1,
        box: { x: 0.05, y: 0.1, w: 0.2, h: 0.8 },
        fit: 'contain',
        bind: { kind: 'prop', index, part: 'icon' },
      },
      {
        id: `${id}-label`,
        type: 'text',
        z: 1,
        box: { x: 0.3, y: 0.1, w: 0.65, h: 0.8 },
        style,
        bind: { kind: 'prop', index, part: 'label' },
      },
    ],
  }
}

/** Базовый макет: кадр, заголовок слева (вне товара), гнёзда подзаголовка и плашки, модуль. */
export function baseLayers(titleBox: Box = { x: 0.05, y: 0.05, w: 0.5, h: 0.1 }): Layer[] {
  return [
    frame,
    text('title', titleBox, 'title'),
    text('subtitle', { x: 0.05, y: 0.2, w: 0.3, h: 0.05 }, 'subtitle'),
    text('kicker', { x: 0.05, y: 0.3, w: 0.3, h: 0.05 }, 'kicker'),
    moduleGroup({ x: 0.05, y: 0.7, w: 0.3, h: 0.1 }),
  ]
}

export const CONTENT: CardContent = {
  texts: { title: ['Куртка мужская'] },
  props: [{ label: 'Ткань', value: 'Мембрана' }, { label: 'Вес', value: '1 кг' }],
  swatches: [],
}

/** Карта 10 × 10: товар занимает столбцы от `fromCol` до правого края, слева — зона `free`. */
export function productMap(fromCol = 6, free?: Box[]): OccupancyMap {
  const cells: number[] = []
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) cells.push(col >= fromCol ? 1 : 0)
  }

  return {
    cols: 10,
    rows: 10,
    cells,
    bounds: { x: fromCol / 10, y: 0, w: 1 - fromCol / 10, h: 1 },
    coverage: (10 - fromCol) / 10,
    free: free ?? [{ x: 0, y: 0, w: fromCol / 10, h: 1 }],
  }
}
