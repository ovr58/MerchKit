/**
 * Раскладка характеристик по гнёздам макета (B28, решение владельца «гнездо по смыслу»).
 *
 * **Было:** N-е свойство продавца ложилось в гнездо с номером N, каким бы оно ни было, а
 * вшитый в макет текст («мес», «Вт», «Dual ») оставался рядом: Bluetooth 5.3 выходил «5.3 мес».
 * **Стало:** гнездо со смыслом (`Binding.meaning`) берёт свойство по подписи; не нашлось — гнездо
 * остаётся пустым и слой снимает K-3 (`resolveLayout`). Гнёзда без смысла наполняются по-старому,
 * по порядку важности, но только тем, что не заняли гнёзда со смыслом, — иначе первое свойство
 * продавца уходило бы в безымянное гнездо, стоящее раньше по номеру, а его собственному гнезду не
 * оставалось ничего.
 *
 * Модуль без ввода-вывода: его зовут и сборка (`cardFilling`), и бесплатное превью
 * (`previewFilling`), чтобы продавец видел то же, что получит.
 */

import { flattenLayers } from './features.ts'
import type { CardLayout } from './types.ts'

export type PropSlot = {
  index: number
  /** `undefined` — гнездо без смысла: берёт любое свойство по порядку. */
  meaning: string[] | undefined
}

/** Слово смысла от этого числа знаков сверяется по началу слова — окончания меняются
 *  («гарантия» / «гарантийный»); короче — только целиком, иначе «ва» ловило бы «вариант». */
const STEM_FROM = 4

/**
 * Гнёзда макета по номеру. Смысл — первый записанный у любого слоя гнезда; записанный не списком
 * слов (чужая рука, модель разбора) за смысл не считается: гнездо остаётся без него и берёт
 * свойство по порядку, а не теряет все свойства из-за опечатки.
 */
export function propSlots(layout: CardLayout): PropSlot[] {
  const slots = new Map<number, string[] | undefined>()

  for (const layer of flattenLayers(layout.layers)) {
    if (layer.bind?.kind !== 'prop') continue
    slots.set(layer.bind.index, slots.get(layer.bind.index) ?? readMeaning(layer.bind.meaning))
  }

  return [...slots].map(([index, meaning]) => ({ index, meaning })).sort((a, b) => a.index - b.index)
}

function readMeaning(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const variants = value.filter((variant): variant is string => typeof variant === 'string' && words(variant).length > 0)
  return variants.length === 0 ? undefined : variants
}

/** Подходит ли свойство смыслу: хотя бы один вариант, у которого в подписи и значении есть все слова. */
export function fitsMeaning(meaning: string[], property: { label?: string; value?: string }): boolean {
  const have = words(`${property.label ?? ''} ${property.value ?? ''}`)

  return meaning.some((variant) =>
    words(variant).every((want) =>
      have.some((word) => (want.length >= STEM_FROM ? word.startsWith(want) : word === want)),
    ),
  )
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Свойства продавца (в порядке важности) по гнёздам макета.
 *
 * `placed[i]` — свойство гнезда i; `undefined` — гнезду нечем наполниться. Хвост из пустых гнёзд
 * обрезан: у слоя без характеристики и так нет содержимого. `cut` — свойства, которых в кадре не
 * будет, в порядке продавца.
 */
export function arrangeProps<T extends { label?: string; value?: string }>(
  layout: CardLayout,
  properties: T[],
): { placed: (T | undefined)[]; cut: T[] } {
  const slots = propSlots(layout)
  const taken = new Set<number>()
  const bySlot = new Map<number, T>()

  for (const { index, meaning } of slots) {
    if (meaning === undefined) continue
    const at = properties.findIndex((property, order) => !taken.has(order) && fitsMeaning(meaning, property))
    if (at < 0) continue
    taken.add(at)
    bySlot.set(index, properties[at])
  }

  let next = 0
  for (const { index, meaning } of slots) {
    if (meaning !== undefined) continue
    while (taken.has(next)) next += 1
    if (next >= properties.length) break
    taken.add(next)
    bySlot.set(index, properties[next])
  }

  const length = Math.max(-1, ...bySlot.keys()) + 1
  return {
    placed: Array.from({ length }, (_, index) => bySlot.get(index)),
    cut: properties.filter((_, order) => !taken.has(order)),
  }
}
