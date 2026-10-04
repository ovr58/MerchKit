/**
 * Цикл арт-директора по ступеням — шаг B5.7 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md),
 * [ADR-0018](../../../../docs/adr/0018-art-director-layout-patch.md), п. 3 («Ступенчатый отказ»),
 * п. 5 («Когда зовётся»).
 *
 * **Чистая функция с внедрёнными зависимостями.** Вызов провайдера (`ask`), загрузка иконок
 * (`loadIcons`) и обмер строк (`measure`) приходят параметрами: ни сети, ни базы, ни
 * растеризатора здесь нет. Воркер подставляет настоящие, тесты — подменные.
 *
 * **Порядок:** предпроверка → попытка → не больше одного повтора → сдвиг без ИИ → ступень.
 * Правка принимается по частям (`parseDirection`, `combineDirection`), так что на любой ступени
 * итог не хуже макета библиотеки, а худший исход — этот макет как есть (ступень 4).
 */

import type { OccupancyMap } from './occupancy.ts'
import { boundTextSlots } from './features.ts'
import {
  DIRECTED_SLOTS,
  applyDirection,
  directedContent,
  directionNeed,
  directorBrief,
  iconProps,
  parseDirection,
  textsOnProduct,
} from './direction.ts'
import type { CardDirection, DirectorBrief } from './direction.ts'
import { combineDirection } from './direction-check.ts'
import type { RejectedPart } from './direction-check.ts'
import { shiftBareText } from './direction-shift.ts'
import { frameToCanvas } from './frame-space.ts'
import type { FontFamilies } from './svg.ts'
import type { CardContent, CardLayout, FrameLayer, ImageRef, TextSlot } from './types.ts'

/** Вызовов модели на карточку: попытка и один повтор (ADR-0018, п. 3). */
export const DIRECTOR_ATTEMPTS = 2

export type DirectorInput = {
  /** Макет библиотеки и содержимое, собранное без арт-директора (`cardFilling`). */
  layout: CardLayout
  content: CardContent
  /** Тексты продавца — источник слов для гнёзд и вход постановки. */
  texts: { title: string; body: string }
  properties: { label: string; value: string }[]
  wishes: string
  /** Карта занятости кадра вендора (доли кадра); `null` — маски нет. */
  frameMask: OccupancyMap | null
  frame: ImageRef
  /** Холст сборки в пикселях. */
  size: { width: number; height: number }
  hasCutout: boolean
  /** Готовые иконки базы. */
  icons: { name: string; description: string }[]
  loadIcons: (names: string[]) => Promise<Record<string, ImageRef>>
  /** Вызов провайдера: сырой ответ модели, разбор — наш. */
  ask: (brief: DirectorBrief) => Promise<Record<string, unknown>>
  fonts: FontFamilies
  measure: (svg: string) => number
}

export type DirectorResult = {
  stage: 1 | 2 | 3 | 4
  /** Постановка первой попытки; `'none'` — предпроверка не нашла, что править. */
  mode: 'full' | 'content' | 'none'
  calls: number
  /** Итоговый патч: принятые части плюс сдвинутые боксы. `null` — ступень 4. */
  direction: CardDirection | null
  layout: CardLayout
  content: CardContent
  rejected: RejectedPart[]
  shifted: number
  reason?: string
}

type Request = {
  mode: 'full' | 'content'
  fillSlots: TextSlot[]
  iconPropsAsked: number[]
  complaints: string[]
}

export async function runDirector(input: DirectorInput): Promise<DirectorResult> {
  const { layout, content, size, hasCutout } = input

  const frameLayer = layout.layers.find((layer): layer is FrameLayer => layer.type === 'frame')
  const canvasMap =
    input.frameMask !== null && frameLayer !== undefined
      ? frameToCanvas(input.frameMask, frameLayer, size, { width: input.frame.width, height: input.frame.height })
      : null

  const mode = directionNeed({ layout, content, canvasMap, hasCutout })
  const library = (calls: number, reason?: string): DirectorResult => ({
    stage: 4,
    mode,
    calls,
    direction: null,
    layout,
    content,
    rejected: [],
    shifted: 0,
    ...(reason === undefined ? {} : { reason }),
  })

  if (mode === 'none') return library(0)

  const bound = boundTextSlots(layout)
  const directedBound = DIRECTED_SLOTS.filter((slot) => bound.includes(slot))
  const source = [
    input.texts.title,
    input.texts.body,
    ...input.properties.flatMap((property) => [property.label, property.value]),
    input.wishes,
  ]

  let accepted: CardDirection = { boxes: [], texts: {}, icons: [] }
  let rejected: RejectedPart[] = []
  const iconRefs: Record<string, ImageRef> = {}
  let reason: string | undefined
  let calls = 0
  // Номера свойств в постановке — номера гнёзд макета, а значит, и `content.props`: гнёзда со
  // смыслом (B28) берут свойства по подписи, и порядок продавца с номерами гнёзд уже не совпадает.
  // Модель ответила бы «иконка свойства 1» про то свойство, которое видит под номером 1.
  const slotProperties = content.props.map((prop) => ({ label: prop.label ?? '', value: prop.value ?? '' }))
  // Пустому гнезду иконку не заказывают: слой модуля снят, подписывать нечего.
  const filledIconProps = iconProps(layout).filter((index) => {
    const prop = content.props[index]
    return prop !== undefined && (prop.label !== undefined || prop.value !== undefined)
  })
  let request: Request = { mode, fillSlots: directedBound, iconPropsAsked: filledIconProps, complaints: [] }

  for (let attempt = 1; attempt <= DIRECTOR_ATTEMPTS; attempt += 1) {
    calls += 1

    let raw: Record<string, unknown>
    try {
      raw = await input.ask(
        directorBrief({
          mode: request.mode,
          layout,
          texts: input.texts,
          properties: slotProperties,
          wishes: input.wishes,
          canvasMap,
          icons: input.icons,
          fillSlots: request.fillSlots,
          iconPropsAsked: request.iconPropsAsked,
          complaints: request.complaints,
        }),
      )
    } catch (error: unknown) {
      reason = `провайдер: ${error instanceof Error ? error.message : String(error)}`
      // Первая попытка упала — ступень 4 без повтора; упал повтор — остаётся принятое.
      if (attempt === 1) return library(calls, reason)
      break
    }

    const parsed = parseDirection(raw, {
      layout,
      mode: request.mode,
      propertyCount: content.props.length,
      iconNames: input.icons.map((icon) => icon.name),
      source,
    })

    const merged = mergeParts(accepted, parsed.parts)
    const loadFailure = await loadMissing(input, merged, iconRefs)
    const refused: RejectedPart[] = []
    merged.icons = merged.icons.filter(({ prop, icon }) => {
      if (icon === null || iconRefs[icon] !== undefined) return true
      refused.push({ part: `иконка свойства ${prop}`, reason: `файл иконки «${icon}» не загрузился${loadFailure}` })
      return false
    })

    const combined = combineDirection({
      library: layout,
      libraryContent: content,
      parts: merged,
      size,
      fonts: input.fonts,
      measure: input.measure,
      canvasMap,
      hasCutout,
      iconRefs,
    })

    accepted = combined.direction
    rejected = settle(rejected, [...parsed.complaints.map(toRejected), ...refused, ...combined.rejected], accepted)

    if (attempt === DIRECTOR_ATTEMPTS) break

    const next = retryRequest({ input, mode, canvasMap, accepted, rejected, iconRefs, directedBound })
    if (next === null) break
    request = next
  }

  const shifts =
    canvasMap === null
      ? []
      : shiftBareText({
          library: layout,
          layout: applyDirection(layout, accepted),
          content: directedContent(content, accepted, iconRefs),
          canvasMap,
          hasCutout,
        }).boxes

  // Сдвиг ложится после боксов арт-директора: у `applyDirection` последний бокс слоя главный.
  const direction: CardDirection = { ...accepted, boxes: [...accepted.boxes, ...shifts] }
  const failure = reason === undefined ? {} : { reason }

  if (isEmpty(direction)) return { ...library(calls), rejected, ...failure }

  const stage: 1 | 2 | 3 =
    shifts.length > 0 && accepted.boxes.length === 0 ? 3 : rejected.length === 0 && shifts.length === 0 ? 1 : 2

  return {
    stage,
    mode,
    calls,
    direction,
    layout: applyDirection(layout, direction),
    content: directedContent(content, direction, iconRefs),
    rejected,
    shifted: shifts.length,
    ...failure,
  }
}

/**
 * Постановка повтора или `null`, если повторять нечего (ADR-0018, п. 3): голый текст всё ещё на
 * товаре (только после полной постановки) либо отвергнуто гнездо. Полная — если на товаре остался
 * текст, иначе лёгкая; спрашиваются только отвергнутые гнёзда, иконки не переспрашиваются.
 */
function retryRequest(args: {
  input: DirectorInput
  mode: 'full' | 'content'
  canvasMap: OccupancyMap | null
  accepted: CardDirection
  rejected: RejectedPart[]
  iconRefs: Record<string, ImageRef>
  directedBound: readonly TextSlot[]
}): Request | null {
  const { input, canvasMap, accepted, rejected, iconRefs } = args

  const textOnProduct =
    args.mode === 'full' &&
    canvasMap !== null &&
    textsOnProduct(
      applyDirection(input.layout, accepted),
      directedContent(input.content, accepted, iconRefs),
      canvasMap,
      input.hasCutout,
    ).length > 0
  const fillSlots = args.directedBound.filter((slot) => rejected.some((entry) => entry.part === slotPart(slot)))

  if (!textOnProduct && fillSlots.length === 0) return null

  return {
    mode: textOnProduct ? 'full' : 'content',
    fillSlots,
    iconPropsAsked: [],
    complaints: rejected.map((entry) => `${entry.part}: ${entry.reason}`),
  }
}

/** Принятое прежде плюс принятое в этой попытке; на один слой, гнездо или свойство — последнее. */
function mergeParts(before: CardDirection, now: CardDirection): CardDirection {
  return {
    boxes: [...new Map([...before.boxes, ...now.boxes].map((entry) => [entry.layerId, entry])).values()],
    texts: { ...before.texts, ...now.texts },
    icons: [...new Map([...before.icons, ...now.icons].map((entry) => [entry.prop, entry])).values()],
  }
}

/** Скачивает иконки, которых ещё нет. Сбой не роняет цикл: такие иконки отвергаются частями.
 *  Возвращает хвост для текста возражения (пустой, если сбоя не было). */
async function loadMissing(
  input: DirectorInput,
  parts: CardDirection,
  iconRefs: Record<string, ImageRef>,
): Promise<string> {
  const missing = [
    ...new Set(parts.icons.flatMap(({ icon }) => (icon !== null && iconRefs[icon] === undefined ? [icon] : []))),
  ]
  if (missing.length === 0) return ''

  try {
    Object.assign(iconRefs, await input.loadIcons(missing))
    return ''
  } catch (error: unknown) {
    return `: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Возражение разбора «адрес: причина» → запись об отвергнутой части. */
function toRejected(complaint: string): RejectedPart {
  const at = complaint.indexOf(': ')
  return at === -1 ? { part: complaint, reason: '' } : { part: complaint.slice(0, at), reason: complaint.slice(at + 2) }
}

/** Прежние возражения без тех частей, что теперь приняты, плюс новые; на одну часть — последнее. */
function settle(before: RejectedPart[], fresh: RejectedPart[], accepted: CardDirection): RejectedPart[] {
  const taken = new Set([
    ...accepted.boxes.map(({ layerId }) => `бокс «${layerId}»`),
    ...Object.keys(accepted.texts).map((slot) => slotPart(slot)),
    ...accepted.icons.map(({ prop }) => `иконка свойства ${prop}`),
  ])
  const kept = before.filter((entry) => !taken.has(entry.part) && !fresh.some((now) => now.part === entry.part))

  return [...kept, ...fresh.filter((entry, index) => fresh.findIndex((other) => other.part === entry.part) === index)]
}

function slotPart(slot: string): string {
  return `гнездо «${slot}»`
}

function isEmpty(direction: CardDirection): boolean {
  return direction.boxes.length === 0 && Object.keys(direction.texts).length === 0 && direction.icons.length === 0
}

/**
 * Строка журнала на карточку (ADR-0018, п. 3), по образцу `Вырез: …`: ступень и постановка,
 * сколько раз звали модель, сколько частей принято из предложенных, сколько сдвинуто и что
 * отвергнуто с первым возражением. Пробный прогон читает ступени отсюда.
 */
export function directorLogLine(result: DirectorResult): string {
  const rejectedOf = (prefix: string): number => result.rejected.filter((entry) => entry.part.startsWith(prefix)).length
  const boxes = (result.direction?.boxes.length ?? 0) - result.shifted
  const slots = Object.keys(result.direction?.texts ?? {}).length
  const icons = result.direction?.icons.length ?? 0
  const rejected = result.rejected.map((entry) => `${entry.part} — ${entry.reason}`).join('; ')

  return [
    `Арт-директор: ступень ${result.stage}`,
    `постановка ${result.mode === 'none' ? '—' : result.mode}`,
    `вызовов ${result.calls}`,
    `боксы ${boxes}/${boxes + rejectedOf('бокс')}`,
    `гнёзда ${slots}/${slots + rejectedOf('гнездо')}`,
    `иконки ${icons}/${icons + rejectedOf('иконка')}`,
    `сдвинуто ${result.shifted}`,
    `отвергнуто: ${rejected === '' ? '—' : rejected}`,
    ...(result.reason === undefined ? [] : [result.reason]),
  ].join(' · ')
}
