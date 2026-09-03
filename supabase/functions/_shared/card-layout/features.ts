/**
 * Производные признаки макета: ёмкость модулей, число кадров, использование выреза, знака и
 * образцов цвета.
 *
 * **Вычисляются из макета, а не хранятся рядом с ним** (ADR-0013). У базы для этого есть
 * представление `card_layout_metadata`; здесь та же арифметика для кода, которому макет
 * приходит объектом, — подбору (B2) и превью (B6). Две копии формулы разошлись бы на первом
 * же расширении языка, поэтому копия ровно одна на сторону.
 */

import type { CardLayout, Layer, TextSlot } from './types.ts'

/** Плоский список слоёв: группы раскрыты, сами группы остаются — у них тоже бывает привязка. */
export function flattenLayers(layers: Layer[]): Layer[] {
  return layers.flatMap((layer) => (layer.type === 'group' ? [layer, ...flattenLayers(layer.children)] : [layer]))
}

/**
 * Ёмкость макета в характеристиках товара. Считаются РАЗНЫЕ номера, а не привязанные слои:
 * у модуля их обычно три (иконка, подпись, значение), и все они — одна характеристика.
 */
export function propertyCapacity(layout: CardLayout): number {
  return countIndices(layout, 'prop')
}

/** Сколько кадров вендора нужно макету: максимальный номер плюс один, ноль — кадров нет. */
export function frameCount(layout: CardLayout): number {
  const indices = flattenLayers(layout.layers)
    .filter((layer) => layer.bind?.kind === 'frame')
    .map((layer) => (layer.bind as { index?: number }).index ?? 0)

  return indices.length === 0 ? 0 : Math.max(...indices) + 1
}

/** Сколько образцов цвета макет умеет показать. */
export function swatchCount(layout: CardLayout): number {
  return countIndices(layout, 'swatch')
}

/** Какие текстовые гнёзда макет вообще адресует: остальные наполнять нечем и незачем. */
export function boundTextSlots(layout: CardLayout): TextSlot[] {
  return [
    ...new Set(
      flattenLayers(layout.layers)
        .filter((layer) => layer.bind?.kind === 'text')
        .map((layer) => (layer.bind as { slot: TextSlot }).slot),
    ),
  ]
}

export function usesLogo(layout: CardLayout): boolean {
  return flattenLayers(layout.layers).some((layer) => layer.bind?.kind === 'logo')
}

export function usesCutout(layout: CardLayout): boolean {
  return flattenLayers(layout.layers).some((layer) => layer.bind?.kind === 'cutout')
}

function countIndices(layout: CardLayout, kind: 'prop' | 'swatch'): number {
  return new Set(
    flattenLayers(layout.layers)
      .filter((layer) => layer.bind?.kind === kind)
      .map((layer) => (layer.bind as { index: number }).index),
  ).size
}
