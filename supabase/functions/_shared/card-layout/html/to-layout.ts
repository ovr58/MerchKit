/**
 * Транспилятор HTML → слои: сцена Chromium (`HtmlScene`) → макет и содержимое (шаг B3 плана
 * `html-layout-authoring_2026-10-05.md`, ADR-0019).
 *
 * **Чистая функция.** Ни браузера, ни растеризатора, ни сети: сцену снимает Chromium (офлайн —
 * `tools/card-pipeline/html-layout/extract.mts`, в рантайме — коробка выреза), а здесь только
 * арифметика перевода. Поэтому один код служит и воркеру, и инструментам.
 *
 * **Всё, что не легло, — в `problems`, а не молчаливое приближение.** Непустой список значит
 * «эту карточку сочинения не собирать» — воркер откатывается на макет библиотеки (ADR-0019
 * п. 6). Правила перевода — `tools/card-pipeline/html-layout/SUBSET.md`.
 */

import type { FontFamilies } from '../svg.ts'
import { FONT_ROLES } from '../types.ts'
import type {
  Binding,
  Box,
  CardContent,
  CardLayout,
  Effect,
  FontRole,
  FrameLayer,
  Layer,
  Paint,
  PaintStop,
  ShapeLayer,
  TextAlign,
  TextLayer,
  TextValign,
} from '../types.ts'
import { validateLayout } from '../validate.ts'
import type { HtmlScene, SceneElement, SceneRect } from './scene.ts'

/** Тексты продавца, к которым привязываются строки сцены. */
export type SellerTexts = {
  /** Короткий заголовок. */
  title: string
  body: string
  props: { label?: string; value?: string }[]
}

export type ToLayoutResult = { layout: CardLayout; content: CardContent; problems: string[] }

/** Допуск выключки, px: строка «стоит ровно» в боксе, если её край или центр ближе этого. */
const ALIGN_TOLERANCE = 1.5

export function toLayout(
  scene: HtmlScene,
  canvas: { width: number; height: number },
  seller: SellerTexts,
  families: FontFamilies,
): ToLayoutResult {
  const problems: string[] = scene.rejected.map(({ selector, reason }) => `${selector}: вне подмножества — ${reason}`)
  if (scene.canvas.width !== canvas.width || scene.canvas.height !== canvas.height) {
    problems.push(`сцена снята в ${scene.canvas.width}×${scene.canvas.height}, а холст ${canvas.width}×${canvas.height}`)
  }

  const unit = Math.min(canvas.width, canvas.height)
  const box = (rect: SceneRect): Box => ({
    x: frac(rect.x / canvas.width),
    y: frac(rect.y / canvas.height),
    w: frac(rect.w / canvas.width),
    h: frac(rect.h / canvas.height),
  })

  const content: CardContent = {
    texts: {},
    props: seller.props.map((prop) => ({ ...prop })),
    swatches: [],
  }
  const layers: Layer[] = []

  for (const element of scene.elements) {
    const where = element.selector
    const note = (message: string) => problems.push(`${where}: ${message}`)

    if (element.kind === 'frame') {
      layers.push(frameLayer(element, box(element.rect), note))
      continue
    }

    const plate = element.kind === 'shape' || hasPlate(element)
    if (plate) {
      layers.push(shapeLayer(element, box, unit, note))
    }
    if (element.kind === 'text') {
      layers.push(textLayer(element, canvas, unit, box, seller, families, content, note))
    }
  }

  const layout: CardLayout = {
    id: 'html-author',
    title: 'Сочинение карточки (HTML)',
    canvas: {
      aspectW: canvas.width / gcd(canvas.width, canvas.height),
      aspectH: canvas.height / gcd(canvas.width, canvas.height),
      background: background(scene.background, (message) => problems.push(`#card: ${message}`)),
    },
    layers,
  }

  problems.push(...validateLayout(layout))

  return { layout, content, problems }
}

function frameLayer(element: SceneElement, layerBox: Box, note: (m: string) => void): FrameLayer {
  const { objectFit, objectPosition, borderRadius, opacity } = element.style
  // `fill` — значение по умолчанию у `<img>`: кадр приходит уже размером холста, так что
  // растяжение совпадает с `cover`.
  const fit = objectFit === 'contain' ? 'contain' : 'cover'
  if (objectFit !== undefined && !['cover', 'contain', 'fill'].includes(objectFit)) {
    note(`object-fit «${objectFit}» не переводится`)
  }
  if (objectPosition !== undefined && objectPosition !== '50% 50%') {
    note(`object-position «${objectPosition}» не по центру`)
  }
  const side = Math.min(element.rect.w, element.rect.h)
  return {
    id: `frame-${element.order}`,
    type: 'frame',
    z: element.order * 10,
    box: layerBox,
    fit,
    bind: { kind: 'frame' },
    ...(borderRadius > 0 && side > 0 ? { radius: frac(borderRadius / side) } : {}),
    ...(opacity < 1 ? { opacity: frac(opacity) } : {}),
  }
}

/** У текста своя плашка, если у элемента есть фон, рамка или тень. */
function hasPlate(element: SceneElement): boolean {
  const { backgroundColor, backgroundImage, borderWidth, boxShadow } = element.style
  const color = parseColor(backgroundColor)
  return (color !== null && color.alpha > 0) || backgroundImage !== 'none' || borderWidth > 0 || boxShadow !== 'none'
}

function shapeLayer(
  element: SceneElement,
  box: (rect: SceneRect) => Box,
  unit: number,
  note: (m: string) => void,
): ShapeLayer {
  const { backgroundColor, backgroundImage, borderWidth, borderColor, borderRadius, boxShadow, opacity } = element.style
  const effects: Effect[] = []

  let fill: Paint | undefined
  const solid = parseColor(backgroundColor)
  if (solid === null) note(`цвет фона «${backgroundColor}» не rgb()`)
  if (backgroundImage !== 'none') {
    if (solid !== null && solid.alpha > 0) note('одновременно background-color и градиент')
    fill = linearGradient(backgroundImage, note)
  } else if (solid !== null && solid.alpha > 0) {
    fill = { kind: 'solid', color: solid.hex, ...(solid.alpha < 1 ? { opacity: frac(solid.alpha) } : {}) }
  }

  // Обводка SVG идёт по оси контура, рамка CSS — внутри бокса: контур сужается на полрамки.
  let rect = element.rect
  if (borderWidth > 0) {
    const stroke = parseColor(borderColor)
    if (stroke === null) note(`цвет рамки «${borderColor}» не rgb()`)
    else {
      effects.push({
        kind: 'stroke',
        color: stroke.hex,
        thickness: frac(borderWidth / unit),
        ...(stroke.alpha < 1 ? { opacity: frac(stroke.alpha) } : {}),
      })
    }
    const half = borderWidth / 2
    rect = { x: rect.x + half, y: rect.y + half, w: rect.w - borderWidth, h: rect.h - borderWidth }
  }

  const shadow = shadowEffect(boxShadow, unit, 'box-shadow', note)
  if (shadow !== null) effects.push(shadow)

  return {
    id: `shape-${element.order}`,
    type: 'shape',
    z: element.order * 10,
    box: box(rect),
    shape: { form: 'rect', ...(borderRadius > 0 ? { radius: frac(borderRadius / unit) } : {}) },
    ...(fill === undefined ? {} : { fill }),
    ...(effects.length > 0 ? { effects } : {}),
    ...(opacity < 1 ? { opacity: frac(opacity) } : {}),
  }
}

function textLayer(
  element: SceneElement,
  canvas: { width: number; height: number },
  unit: number,
  box: (rect: SceneRect) => Box,
  seller: SellerTexts,
  families: FontFamilies,
  content: CardContent,
  note: (m: string) => void,
): TextLayer {
  const style = element.style
  const lines = element.lines ?? []
  const fontSize = style.fontSize ?? 0
  if (lines.length === 0) note('у текста нет строк')

  const family = (style.fontFamily ?? '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  const role = roleOf(family, style.fontWeight ?? 400, families)
  if (role === null) note(`гарнитура «${family}» не из roles.json`)

  const color = parseColor(style.color ?? '')
  if (color === null) note(`цвет текста «${style.color}» не rgb()`)

  const lineBox = style.lineHeight === undefined || style.lineHeight === 'normal'
    ? (lines[0]?.rect.h ?? fontSize)
    : Number.parseFloat(style.lineHeight)

  let transform: 'upper' | undefined
  if (style.textTransform === 'uppercase') transform = 'upper'
  else if (style.textTransform !== undefined && style.textTransform !== 'none') {
    note(`text-transform «${style.textTransform}» не переводится`)
  }

  const tracking = style.letterSpacing === undefined || style.letterSpacing === 'normal'
    ? 0
    : Number.parseFloat(style.letterSpacing)

  const placement = place(element.rect, lines.map((line) => line.rect), lineBox, cssAlign(style.textAlign), hasPlate(element))

  const effects: Effect[] = []
  const shadow = shadowEffect(style.textShadow ?? 'none', unit, 'text-shadow', note)
  if (shadow !== null) effects.push(shadow)

  const domLines = lines.map((line) => line.text)
  const binding = bindingOf(domLines.join(' '), seller)
  if (binding !== null) {
    const sellerText = binding.text
    const domText = domLines.join(' ')
    // Модель набрала прописными без `text-transform`, а у продавца регистр смешанный: на
    // сборке по словам продавца карточка вышла бы строчными.
    if (transform === undefined && domText === domText.toLocaleUpperCase('ru-RU') && sellerText !== sellerText.toLocaleUpperCase('ru-RU')) {
      transform = 'upper'
    }
    fill(content, binding.bind, splitLike(sellerText, domLines))
  }

  const opacity = style.opacity * (color?.alpha ?? 1)

  return {
    id: `text-${element.order}`,
    type: 'text',
    z: element.order * 10 + (hasPlate(element) ? 1 : 0),
    box: box(placement.rect),
    style: {
      role: role ?? 'body',
      size: frac(fontSize / canvas.height),
      weight: style.fontWeight ?? 400,
      ...(style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? { italic: true } : {}),
      color: color?.hex ?? '#000000',
      align: placement.align,
      valign: placement.valign,
      lineHeight: frac(fontSize > 0 ? lineBox / fontSize : 1),
      ...(tracking !== 0 && fontSize > 0 ? { tracking: frac(tracking / fontSize) } : {}),
      ...(transform === undefined ? {} : { transform }),
    },
    ...(binding === null ? { lines: domLines } : { bind: binding.bind }),
    ...(effects.length > 0 ? { effects } : {}),
    ...(opacity < 1 ? { opacity: frac(opacity) } : {}),
  }
}

/**
 * Бокс и выключка текста по геометрии строк (SUBSET.md, «Бокс и выключка текста»): сборщик
 * ставит строку в середину интерлиньяжа, Chromium — тоже, поэтому совпасть достаточно блоком
 * строк. Выключка ищется та, при которой строки стоят в боксе элемента ровно; не нашлась —
 * бокс по этой оси сжимается до строк.
 */
function place(
  rect: SceneRect,
  lines: SceneRect[],
  lineBox: number,
  preferred: TextAlign,
  plate: boolean,
): { rect: SceneRect; align: TextAlign; valign: TextValign } {
  if (lines.length === 0) return { rect, align: preferred, valign: 'top' }

  const near = (a: number, b: number) => Math.abs(a - b) <= ALIGN_TOLERANCE
  const left = Math.min(...lines.map((line) => line.x))
  const right = Math.max(...lines.map((line) => line.x + line.w))
  const top = lines[0].y + lines[0].h / 2 - lineBox / 2
  const height = lines.length * lineBox

  const horizontal: Record<TextAlign, boolean> = {
    left: lines.every((line) => near(line.x, rect.x)),
    center: lines.every((line) => near(line.x + line.w / 2, rect.x + rect.w / 2)),
    right: lines.every((line) => near(line.x + line.w, rect.x + rect.w)),
  }
  const vertical: Record<TextValign, boolean> = {
    top: near(top, rect.y),
    middle: near(top + height / 2, rect.y + rect.h / 2),
    bottom: near(top + height, rect.y + rect.h),
  }

  const align = ([preferred, 'left', 'center', 'right'] as TextAlign[]).find((candidate) => horizontal[candidate])
  // Подпись плашки при равных условиях — по центру: так она и останется в плашке после правки.
  const valign = ((plate ? ['middle', 'top', 'bottom'] : ['top', 'middle', 'bottom']) as TextValign[]).find((candidate) => vertical[candidate])

  return {
    rect: {
      x: align === undefined ? left : rect.x,
      w: align === undefined ? right - left : rect.w,
      y: valign === undefined ? top : rect.y,
      h: valign === undefined ? height : rect.h,
    },
    align: align ?? preferred,
    valign: valign ?? 'top',
  }
}

function cssAlign(value: string | undefined): TextAlign {
  if (value === 'center') return 'center'
  if (value === 'right' || value === 'end') return 'right'
  return 'left'
}

/** Роль по гарнитуре: из ролей с этой гарнитурой — по насыщенности (SUBSET.md, строка 11). */
function roleOf(family: string, weight: number, families: FontFamilies): FontRole | null {
  const candidates = FONT_ROLES.filter((role) => families[role].toLowerCase() === family.toLowerCase())
  if (candidates.length === 0) return null
  const preferred: FontRole = weight >= 800 ? 'display' : weight >= 700 ? 'heading' : weight >= 600 ? 'label' : 'body'
  return candidates.includes(preferred) ? preferred : candidates[0]
}

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** Текст элемента, совпавший с текстом продавца целиком (без учёта регистра и пробелов). */
function bindingOf(text: string, seller: SellerTexts): { bind: Binding; text: string } | null {
  const target = normalize(text)
  if (target === '') return null
  const candidates: { bind: Binding; text: string | undefined }[] = [
    { bind: { kind: 'text', slot: 'title' }, text: seller.title },
    { bind: { kind: 'text', slot: 'body' }, text: seller.body },
    ...seller.props.flatMap((prop, index) => [
      { bind: { kind: 'prop', index, part: 'label' } as Binding, text: prop.label },
      { bind: { kind: 'prop', index, part: 'value' } as Binding, text: prop.value },
    ]),
  ]
  const found = candidates.find((candidate) => candidate.text !== undefined && normalize(candidate.text) === target)
  return found === undefined ? null : { bind: found.bind, text: found.text!.replace(/\s+/g, ' ').trim() }
}

/** Слова продавца, разбитые на строки так, как Chromium перенёс текст сцены. */
function splitLike(sellerText: string, domLines: string[]): string[] {
  const words = sellerText.split(' ')
  const out: string[] = []
  let at = 0
  for (const line of domLines) {
    const count = line.split(/\s+/).filter((word) => word !== '').length
    out.push(words.slice(at, at + count).join(' '))
    at += count
  }
  return out
}

function fill(content: CardContent, bind: Binding, lines: string[]): void {
  if (bind.kind === 'text') {
    content.texts[bind.slot] = lines
    return
  }
  if (bind.kind === 'prop' && (bind.part === 'label' || bind.part === 'value')) {
    content.props[bind.index] = { ...content.props[bind.index], [bind.part]: lines.join('\n') }
  }
}

/** `rgb(…)`/`rgba(…)`, как их отдаёт `getComputedStyle`, → `#rrggbb` и альфа. */
function parseColor(value: string): { hex: string; alpha: number } | null {
  if (value === 'transparent') return { hex: '#000000', alpha: 0 }
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(value.trim())
  if (match === null) return null
  const hex = '#' + [match[1], match[2], match[3]]
    .map((channel) => Math.round(Number(channel)).toString(16).padStart(2, '0'))
    .join('')
  const alpha = match[4] === undefined ? 1 : Number(match[4]) / (match[5] === '%' ? 100 : 1)
  return { hex, alpha }
}

function background(value: string, note: (m: string) => void): Paint {
  const color = parseColor(value)
  if (color === null) {
    note(`цвет фона «${value}» не rgb()`)
    return { kind: 'solid', color: '#ffffff' }
  }
  // Прозрачный `#card` Chromium снимает на белом.
  return color.alpha === 0 ? { kind: 'solid', color: '#ffffff' } : { kind: 'solid', color: color.hex }
}

const DIRECTIONS: Record<string, { from: { x: number; y: number }; to: { x: number; y: number } }> = {
  'to top': { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
  '0deg': { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
  'to right': { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
  '90deg': { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
  'to bottom': { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } },
  '180deg': { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } },
  'to left': { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } },
  '270deg': { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } },
}

function linearGradient(value: string, note: (m: string) => void): Paint | undefined {
  const inner = /^linear-gradient\((.*)\)$/.exec(value.trim())?.[1]
  if (inner === undefined) {
    note(`фон «${value.slice(0, 60)}» не линейный градиент`)
    return undefined
  }
  const parts = splitTopLevel(inner)
  let direction = 'to bottom'
  if (/^(to |-?[\d.]+deg$)/.test(parts[0])) direction = parts.shift()!
  const geometry = DIRECTIONS[direction]
  if (geometry === undefined) note(`направление градиента «${direction}» — только 0/90/180/270`)
  if (parts.length < 2 || parts.length > 5) note(`у градиента ${parts.length} точек, нужно 2–5`)

  const stops: PaintStop[] = []
  parts.forEach((part, index) => {
    const colorText = /rgba?\([^)]*\)|transparent/.exec(part)?.[0] ?? part
    const rest = part.replace(colorText, '').trim()
    const color = parseColor(colorText)
    if (color === null) {
      note(`цвет точки градиента «${colorText}» не rgb()`)
      return
    }
    let at = parts.length === 1 ? 0 : index / (parts.length - 1)
    if (rest !== '') {
      if (!/^[\d.]+%$/.test(rest)) note(`позиция точки градиента «${rest}» не в %`)
      else at = Number.parseFloat(rest) / 100
    }
    stops.push({ at: frac(at), color: color.hex, ...(color.alpha < 1 ? { opacity: frac(color.alpha) } : {}) })
  })

  return geometry === undefined ? undefined : { kind: 'linear', from: geometry.from, to: geometry.to, stops }
}

/** Одна внешняя тень: `<цвет> dx dy blur [spread]`, как её отдаёт `getComputedStyle`. */
function shadowEffect(value: string, unit: number, name: string, note: (m: string) => void): Effect | null {
  if (value === 'none') return null
  const colorText = /rgba?\([^)]*\)/.exec(value)?.[0]
  const color = colorText === undefined ? null : parseColor(colorText)
  const lengths = value.replace(colorText ?? '', '').trim().split(/\s+/).map((token) => Number.parseFloat(token))
  if (color === null || lengths.length < 2 || lengths.some((length) => Number.isNaN(length))) {
    note(`${name} «${value}» не разобрана`)
    return null
  }
  const [dx, dy, blur = 0, spread = 0] = lengths
  if (spread !== 0) note(`${name}: spread ${spread}px не переводится`)
  return {
    kind: 'shadow',
    dx: frac(dx / unit),
    dy: frac(dy / unit),
    // Радиус размытия CSS — это 2σ гаусса, а сборщик ждёт σ.
    blur: frac(blur / 2 / unit),
    color: color.hex,
    opacity: frac(color.alpha),
  }
}

function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let at = 0; at < value.length; at++) {
    if (value[at] === '(') depth++
    else if (value[at] === ')') depth--
    else if (value[at] === ',' && depth === 0) {
      out.push(value.slice(from, at).trim())
      from = at + 1
    }
  }
  out.push(value.slice(from).trim())
  return out
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Доли — пять знаков: точнее пикселя на любом профиле площадки и читаемо в JSON. */
function frac(value: number): number {
  return Math.round(value * 1e5) / 1e5
}
