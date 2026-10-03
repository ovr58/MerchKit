/**
 * Правка арт-директора: форма патча, бесплатная предпроверка, постановка задачи, разбор
 * ответа и применение — шаг B5.4 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md),
 * решение — [ADR-0018](../../../../docs/adr/0018-art-director-layout-patch.md).
 *
 * **Всё здесь — чистые функции без ввода-вывода.** Вызов модели делает провайдер, обмер
 * строк — растеризатор; эти функции только решают, звать ли модель (`directionNeed`), что ей
 * сказать (`directorBrief`), какие части ответа формально годны (`parseDirection`) и как
 * правка ложится на макет (`applyDirection`, `directedContent`).
 *
 * **Здесь только проверки формы и слов продавца (1–2 ADR, п. 2).** Переполнение, налегание и
 * сборка итога по частям — `direction-check.ts` (B5.5): им нужен обмерщик и сочетание частей,
 * а разбор ответа от них не зависит.
 */

import type { OccupancyMap } from './occupancy.ts'
import { occupancyOfBox } from './occupancy.ts'
import { boundTextSlots, flattenLayers } from './features.ts'
import { resolveLayout } from './validate.ts'
import type { PlacedLayer } from './validate.ts'
import type {
  Binding,
  Box,
  CardContent,
  CardLayout,
  ImageRef,
  Layer,
  LayerType,
  TextSlot,
} from './types.ts'

/** Новые боксы, строки трёх гнёзд и иконки — весь круг полномочий арт-директора (ADR-0018, п. 1). */
export type CardDirection = {
  /** Новый бокс слоя верхнего уровня типа text | asset | group | shape. */
  boxes: { layerId: string; box: Box }[]
  /** Строки гнёзд, привязанных в макете. Других гнёзд здесь не бывает. */
  texts: Partial<Record<'subtitle' | 'kicker' | 'brand', string[]>>
  /** Иконка модуля свойства по имени из базы; null — оставить без иконки. */
  icons: { prop: number; icon: string | null }[]
}

/** Гнёзда, которые наполняет арт-директор: у наполнения B7.2 они пусты всегда. */
export const DIRECTED_SLOTS = ['subtitle', 'kicker', 'brand'] as const

/** Типы слоёв верхнего уровня, чей бокс арт-директору разрешено менять. `frame` и `cutout`
 *  нет: вырез обязан лечь на кадр пиксель в пиксель, а сцену двигать не задача вёрстки. */
export const EDITABLE_TYPES = ['text', 'asset', 'group', 'shape'] as const

/** Сколько бокса голого текста может лежать на товаре. Около одной ячейки карты. */
export const BARE_TEXT_LIMIT = 0.15

/** Какую долю бокса текста должна покрыть плашка, чтобы текст не считался голым. */
export const PLAQUE_COVER = 0.9

/** Строк в гнезде и знаков в строке (ADR-0018, п. 2, проверка 1). */
const MAX_LINES = 3
const MAX_LINE_LENGTH = 60

/** Бокс правится, а не сочиняется заново: от половины до полутора исходного размера. */
const MIN_SCALE = 0.5
const MAX_SCALE = 1.5

/** Слова короче этого числа букв не сверяются с источником: «для», «при», «без» продавец
 *  не писал, а убрать их из подзаголовка значит запретить ему грамматику. */
export const MIN_CHECKED_WORD = 4

/** Запас на плавающую точку при сравнении долей. */
const EPS = 1e-9

type Rect = { x: number; y: number; w: number; h: number }

/** Площадь пересечения двух прямоугольников; 0, если они не пересекаются. */
export function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** Номера свойств, у которых в макете есть слой иконки, — отсортированные и без повторов. */
export function iconProps(layout: CardLayout): number[] {
  const indices = flattenLayers(layout.layers).flatMap((layer) =>
    layer.bind?.kind === 'prop' && layer.bind.part === 'icon' ? [layer.bind.index] : [],
  )
  return [...new Set(indices)].sort((a, b) => a - b)
}

/**
 * Плашки под текстом: слои `shape` с меньшим `z`, покрывающие не меньше `PLAQUE_COVER` его
 * бокса. Одна и та же мерка у «голого» текста и у проверки «плашка уехала из-под текста».
 */
export function platesUnder(placed: PlacedLayer[], text: PlacedLayer): PlacedLayer[] {
  const area = text.box.w * text.box.h

  return placed.filter(
    (other) =>
      other.layer.type === 'shape' &&
      other.z < text.z &&
      intersectionArea(other.box, text.box) >= PLAQUE_COVER * area - EPS,
  )
}

/** Голые текстовые слои: размещённый текст, под которым нет плашки (`CONTEXT.md`). */
export function bareTextLayers(placed: PlacedLayer[]): PlacedLayer[] {
  return placed.filter((item) => item.layer.type === 'text' && platesUnder(placed, item).length === 0)
}

/** Текст стоит за вырезом по замыслу: в макете есть `cutout` выше него, и вырез есть. */
export function behindCutout(placed: PlacedLayer[], text: PlacedLayer, hasCutout: boolean): boolean {
  return hasCutout && placed.some((item) => item.layer.type === 'cutout' && item.z > text.z)
}

/**
 * `id` слоя верхнего уровня, внутри которого (или которым) лежит слой. Слоя нет в макете —
 * возвращается сам `layerId`: вызывающие берут идентификатор из самого макета, и молчаливый
 * возврат безопаснее исключения посреди проверки ответа модели.
 */
export function topLevelOf(layout: CardLayout, layerId: string): string {
  for (const top of layout.layers) {
    if (top.id === layerId) return top.id
    if (top.type === 'group' && flattenLayers(top.children).some((layer) => layer.id === layerId)) {
      return top.id
    }
  }
  return layerId
}

export type TextOnProduct = { layerId: string; topId: string; occupancy: number }

/** Голые тексты не за вырезом, у которых на товаре больше `BARE_TEXT_LIMIT` бокса. */
export function textsOnProduct(
  layout: CardLayout,
  content: CardContent,
  canvasMap: OccupancyMap,
  hasCutout: boolean,
): TextOnProduct[] {
  const { layers } = resolveLayout(layout, content)

  return bareTextLayers(layers)
    .filter((text) => !behindCutout(layers, text, hasCutout))
    .map((text) => ({
      layerId: text.layer.id,
      topId: topLevelOf(layout, text.layer.id),
      occupancy: occupancyOfBox(canvasMap, text.box),
    }))
    .filter((entry) => entry.occupancy > BARE_TEXT_LIMIT)
}

export type DirectionNeed = 'full' | 'content' | 'none'

/**
 * Бесплатная предпроверка (ADR-0018, п. 5): звать ли арт-директора и в каком объёме.
 * Вызовов не делает и растеризатор не поднимает.
 */
export function directionNeed(input: {
  layout: CardLayout
  content: CardContent
  canvasMap: OccupancyMap | null
  hasCutout: boolean
}): DirectionNeed {
  const { layout, content, canvasMap, hasCutout } = input

  if (canvasMap !== null && textsOnProduct(layout, content, canvasMap, hasCutout).length > 0) {
    return 'full'
  }

  const slots = boundTextSlots(layout) as readonly string[]
  if (DIRECTED_SLOTS.some((slot) => slots.includes(slot)) || iconProps(layout).length > 0) {
    return 'content'
  }

  return 'none'
}

export type DirectorLayerBrief = {
  id: string
  type: LayerType
  z: number
  box: Box
  bind?: Binding
  /** Можно ли менять бокс этого слоя. */
  editable: boolean
  role?: string
  size?: number
  lineCount?: number
  contains?: Binding[]
}

/** Вход арт-директора. Поля `canvas`, `layers`, `map` есть только у полной постановки. */
export type DirectorBrief = {
  mode: 'full' | 'content'
  texts: { title: string; body: string }
  properties: { label: string; value: string }[]
  wishes: string
  fillSlots: TextSlot[]
  iconProps: number[]
  icons: { name: string; description: string }[]
  complaints: string[]
  canvas?: { aspectW: number; aspectH: number }
  layers?: DirectorLayerBrief[]
  map?: OccupancyMap | null
}

export type DirectorBriefInput = {
  mode: 'full' | 'content'
  layout: CardLayout
  texts: { title: string; body: string }
  properties: { label: string; value: string }[]
  wishes: string
  canvasMap: OccupancyMap | null
  icons: { name: string; description: string }[]
  fillSlots: TextSlot[]
  iconPropsAsked: number[]
  complaints: string[]
}

/**
 * Постановка задачи арт-директору. Одна на любой вендор и для заглушки: её собирает наш код,
 * а не реализация провайдера. Лёгкая постановка слоёв и карты не несёт.
 */
export function directorBrief(input: DirectorBriefInput): DirectorBrief {
  const brief: DirectorBrief = {
    mode: input.mode,
    texts: input.texts,
    properties: input.properties,
    wishes: input.wishes,
    fillSlots: input.fillSlots,
    iconProps: input.iconPropsAsked,
    icons: input.icons,
    complaints: input.complaints,
  }

  if (input.mode === 'content') return brief

  brief.canvas = { aspectW: input.layout.canvas.aspectW, aspectH: input.layout.canvas.aspectH }
  brief.layers = input.layout.layers.map(layerBrief)
  brief.map = input.canvasMap

  return brief
}

function layerBrief(layer: Layer): DirectorLayerBrief {
  const brief: DirectorLayerBrief = {
    id: layer.id,
    type: layer.type,
    z: layer.z,
    box: layer.box,
    editable: (EDITABLE_TYPES as readonly string[]).includes(layer.type),
  }

  if (layer.bind !== undefined) brief.bind = layer.bind

  if (layer.type === 'text') {
    brief.role = layer.style.role
    brief.size = layer.style.size
    // Строк у привязанного слоя без шаблона заранее не знает никто: число зависит от текста.
    if (layer.lines !== undefined) brief.lineCount = layer.lines.length
  }

  if (layer.type === 'group') {
    brief.contains = flattenLayers(layer.children).flatMap((child) =>
      child.bind === undefined ? [] : [child.bind],
    )
  }

  return brief
}

export type DirectionContext = {
  layout: CardLayout
  mode: 'full' | 'content'
  /** Сколько свойств у товара: индекс иконки обязан в них попасть. */
  propertyCount: number
  iconNames: string[]
  /** Слова продавца: `title`, `body`, все `label` и `value`, пожелания. */
  source: string[]
}

export type ParsedDirection = { parts: CardDirection; complaints: string[] }

const ANSWER_KEYS = ['boxes', 'texts', 'icons']

/**
 * Разбор сырого ответа: в `parts` только части, прошедшие проверки формы и слов продавца
 * (ADR-0018, п. 2, проверки 1–2); на каждую отвергнутую часть — возражение по-русски с
 * адресом части. Годные части брак соседней не выбрасывает.
 */
export function parseDirection(raw: unknown, ctx: DirectionContext): ParsedDirection {
  const parts: CardDirection = { boxes: [], texts: {}, icons: [] }
  const complaints: string[] = []

  if (!isRecord(raw)) {
    complaints.push('ответ: ожидался объект с ключами boxes, texts, icons')
    return { parts, complaints }
  }

  for (const key of Object.keys(raw)) {
    if (!ANSWER_KEYS.includes(key)) complaints.push(`ключ «${key}»: в ответе бывают только boxes, texts, icons`)
  }

  parseBoxes(raw.boxes, ctx, parts, complaints)
  parseTexts(raw.texts, ctx, parts, complaints)
  parseIcons(raw.icons, ctx, parts, complaints)

  return { parts, complaints }
}

function parseBoxes(value: unknown, ctx: DirectionContext, parts: CardDirection, complaints: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    complaints.push('boxes: ожидался список')
    return
  }

  const counts = new Map<string, number>()
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.layerId === 'string') {
      counts.set(entry.layerId, (counts.get(entry.layerId) ?? 0) + 1)
    }
  }

  const reportedRepeats = new Set<string>()

  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.layerId !== 'string' || !isRecord(entry.box)) {
      complaints.push(`бокс №${index + 1}: нет layerId или box`)
      return
    }

    const id = entry.layerId

    // Повтор отвергает все боксы этого id, а жалоба на него — одна.
    if ((counts.get(id) ?? 0) > 1) {
      if (!reportedRepeats.has(id)) complaints.push(`бокс «${id}»: слой назван в ответе несколько раз`)
      reportedRepeats.add(id)
      return
    }

    const problem = boxProblem(id, entry.box, ctx)
    if (problem !== null) {
      complaints.push(`бокс «${id}»: ${problem}`)
      return
    }

    const { x, y, w, h } = entry.box as Box
    parts.boxes.push({ layerId: id, box: { x, y, w, h } })
  })
}

/** Первое нарушение формы бокса или `null`. */
function boxProblem(id: string, box: Record<string, unknown>, ctx: DirectionContext): string | null {
  if (ctx.mode !== 'full') return 'в лёгкой постановке боксы не принимаются'

  const layer = ctx.layout.layers.find((top) => top.id === id)
  if (layer === undefined) {
    const nested = flattenLayers(ctx.layout.layers).some((other) => other.id === id)
    return nested
      ? `слой вложенный, правится только его группа «${topLevelOf(ctx.layout, id)}»`
      : 'такого слоя нет в макете'
  }

  if (!(EDITABLE_TYPES as readonly string[]).includes(layer.type)) {
    return `слой типа ${layer.type} не правится`
  }

  const { x, y, w, h } = box
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return 'x, y, w, h должны быть конечными числами'
  }
  const [bx, by, bw, bh] = [x, y, w, h] as number[]

  if (bw <= 0 || bh <= 0) return `размер ${num(bw)} × ${num(bh)} должен быть положительным`
  if (bx < 0) return `выходит за левый край (x = ${num(bx)})`
  if (by < 0) return `выходит за верхний край (y = ${num(by)})`
  if (bx + bw > 1 + EPS) return `выходит за правый край (x + w = ${num(bx + bw)})`
  if (by + bh > 1 + EPS) return `выходит за нижний край (y + h = ${num(by + bh)})`

  const widthScale = layer.box.w > 0 ? bw / layer.box.w : null
  if (widthScale !== null && (widthScale < MIN_SCALE - EPS || widthScale > MAX_SCALE + EPS)) {
    return `ширина ×${num(widthScale)} от исходной, допустимо от ${MIN_SCALE} до ${MAX_SCALE}`
  }
  const heightScale = layer.box.h > 0 ? bh / layer.box.h : null
  if (heightScale !== null && (heightScale < MIN_SCALE - EPS || heightScale > MAX_SCALE + EPS)) {
    return `высота ×${num(heightScale)} от исходной, допустимо от ${MIN_SCALE} до ${MAX_SCALE}`
  }

  return null
}

function parseTexts(value: unknown, ctx: DirectionContext, parts: CardDirection, complaints: string[]): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    complaints.push('texts: ожидался объект «гнездо → строки»')
    return
  }

  const bound = boundTextSlots(ctx.layout) as string[]
  const source = sourceOf(ctx.source)

  for (const [slot, lines] of Object.entries(value)) {
    if (!(DIRECTED_SLOTS as readonly string[]).includes(slot)) {
      complaints.push(`гнездо «${slot}»: арт-директор наполняет только ${DIRECTED_SLOTS.join(', ')}`)
      continue
    }
    if (!bound.includes(slot)) {
      complaints.push(`гнездо «${slot}»: не привязано в макете`)
      continue
    }

    const problem = slotProblem(lines, source)
    if (problem !== null) {
      complaints.push(`гнездо «${slot}»: ${problem}`)
      continue
    }

    parts.texts[slot as (typeof DIRECTED_SLOTS)[number]] = (lines as string[]).map((line) => line.trim())
  }
}

function slotProblem(lines: unknown, source: SourceWords): string | null {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_LINES) {
    const count = Array.isArray(lines) ? lines.length : 'не список'
    return `строк: ${count}, нужно от 1 до ${MAX_LINES}`
  }

  const trimmed: string[] = []
  for (const line of lines) {
    if (typeof line !== 'string' || line.trim() === '') return 'строка пуста или не текст'
    trimmed.push(line.trim())
  }

  for (const line of trimmed) {
    if (line.length > MAX_LINE_LENGTH) {
      return `строка «${line}» длиннее ${MAX_LINE_LENGTH} знаков (${line.length})`
    }
  }

  for (const line of trimmed) {
    const missing = missingFrom(line, source)
    if (missing !== null) return `${missing} нет в описании`
  }

  return null
}

type SourceWords = { numbers: Set<string>; prefixes: Set<string> }

/** Слова источника: числа целиком, слова — первыми четырьмя буквами (окончания меняются). */
function sourceOf(texts: string[]): SourceWords {
  const normalized = normalize(texts.join(' '))

  return {
    numbers: new Set(normalized.match(/\d+/g) ?? []),
    prefixes: new Set((normalized.match(/\p{L}+/gu) ?? []).map((word) => word.slice(0, MIN_CHECKED_WORD))),
  }
}

/**
 * Первое число или слово строки, которого нет у продавца. Число — последовательность цифр
 * целиком: «10» из «100» — другое число. Слово — от `MIN_CHECKED_WORD` букв, по первым четырём.
 */
function missingFrom(line: string, source: SourceWords): string | null {
  const text = normalize(line)

  for (const number of text.match(/\d+/g) ?? []) {
    if (!source.numbers.has(number)) return `числа «${number}»`
  }

  for (const word of text.match(/\p{L}+/gu) ?? []) {
    if (word.length >= MIN_CHECKED_WORD && !source.prefixes.has(word.slice(0, MIN_CHECKED_WORD))) {
      return `слова «${word}»`
    }
  }

  return null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е')
}

function parseIcons(value: unknown, ctx: DirectionContext, parts: CardDirection, complaints: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    complaints.push('icons: ожидался список')
    return
  }

  const counts = new Map<number, number>()
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.prop === 'number') {
      counts.set(entry.prop, (counts.get(entry.prop) ?? 0) + 1)
    }
  }

  const withIcon = iconProps(ctx.layout)
  const reportedRepeats = new Set<number>()

  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.prop !== 'number' || !(entry.icon === null || typeof entry.icon === 'string')) {
      complaints.push(`иконка №${index + 1}: нужны prop (число) и icon (имя или null)`)
      return
    }

    const { prop, icon } = entry as { prop: number; icon: string | null }
    const address = `иконка свойства ${prop}`

    if ((counts.get(prop) ?? 0) > 1) {
      if (!reportedRepeats.has(prop)) complaints.push(`${address}: свойство названо в ответе несколько раз`)
      reportedRepeats.add(prop)
      return
    }
    if (!Number.isInteger(prop) || prop < 0 || prop >= ctx.propertyCount) {
      complaints.push(`${address}: у товара нет такого свойства`)
      return
    }
    if (!withIcon.includes(prop)) {
      complaints.push(`${address}: в макете у этого свойства нет слоя иконки`)
      return
    }
    if (icon !== null && !ctx.iconNames.includes(icon)) {
      complaints.push(`${address}: иконки «${icon}» нет в списке`)
      return
    }

    parts.icons.push({ prop, icon })
  })
}

/** Макет с новыми боксами слоёв верхнего уровня. Вход не мутирует. */
export function applyDirection(layout: CardLayout, direction: CardDirection): CardLayout {
  const boxes = new Map(direction.boxes.map(({ layerId, box }) => [layerId, box]))

  return {
    ...layout,
    layers: layout.layers.map((layer) => {
      const box = boxes.get(layer.id)
      return box === undefined ? layer : { ...layer, box: { ...box } }
    }),
  }
}

/** Содержимое с строками гнёзд и иконками свойств из правки. Вход не мутирует. */
export function directedContent(
  content: CardContent,
  direction: CardDirection,
  iconRefs: Record<string, ImageRef>,
): CardContent {
  const props = content.props.map((prop) => ({ ...prop }))

  for (const { prop, icon } of direction.icons) {
    if (icon !== null && props[prop] !== undefined && iconRefs[icon] !== undefined) {
      props[prop].icon = iconRefs[icon]
    }
  }

  return { ...content, texts: { ...content.texts, ...direction.texts }, props }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Число для возражения: до сотых, без хвоста нулей. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100)
}
