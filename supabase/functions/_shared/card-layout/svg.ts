/**
 * Сборщик: макет + содержимое → SVG точного размера профиля площадки (шаг A2 плана
 * `card-assembly-pipeline_2026-08-31.md`).
 *
 * **Почему SVG, а не рисование по пикселям.** Композиция описана декларативно, поэтому один и
 * тот же текст файла проверяем глазами, сравниваем строкой и растеризуем чем угодно. Кадр
 * вендора вкладывается сюда как `<image>` с data-URI: сборка обязана быть самодостаточной —
 * во время рендера ничего не скачивается.
 *
 * **Растеризация здесь не делается намеренно.** Из SVG в PNG переводит `resvg` (WebAssembly),
 * и он свой у каждого рантайма: Edge Function, браузер, офлайн-скрипт. Разделение оставляет
 * растеризатор единственным местом, зависящим от рантайма, — а сама композиция считается
 * одним кодом везде. См. [ADR-0012](../../../../docs/adr/0012-card-layout-is-ours-not-vendors.md).
 *
 * **Разбивку на строки сборщик не делает.** Строки приходят готовыми — из макета (декор) или
 * из содержимого. Автоперенос требует метрик шрифта, а решение о переносе принимает вёрстка,
 * а не сборщик. Арифметика переполнения (K-1) встаёт сюда же на шаге B6, когда появится
 * бесплатное превью, — до тех пор мерить нечего.
 */

import { resolveLayout } from './validate.ts'
import type { DroppedLayer, PlacedLayer } from './validate.ts'
import type {
  CardContent,
  CardLayout,
  Effect,
  Focus,
  FontRole,
  Paint,
  TextStyle,
} from './types.ts'

/** Какой гарнитурой рисуется каждая роль. Приезжает из базы шрифтов (шаг A5), а не зашита в
 *  сборщик: роль — это то, что распознаётся по образцу, гарнитура — то, что у нас есть. */
export type FontFamilies = Record<FontRole, string>

export type ComposeResult = { svg: string; dropped: DroppedLayer[] }

/**
 * Доля кегля от верха строки до базовой линии. Не метрика шрифта, а соглашение вёрстки:
 * строки должны стоять предсказуемо при любой гарнитуре, а точные метрики понадобятся только
 * арифметике переполнения (B6).
 */
const BASELINE_IN_LINE = 0.35

export function composeSvg(
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
  fonts: FontFamilies,
): ComposeResult {
  const { layers, dropped } = resolveLayout(layout, content)
  const defs: string[] = []
  const body: string[] = []

  const background = paintOf(layout.canvas.background, 'bg', { x: 0, y: 0, w: 1, h: 1 }, size, defs)
  body.push(
    `<rect x="0" y="0" width="${size.width}" height="${size.height}" ${background}/>`,
  )

  for (const placed of layers) {
    body.push(renderLayer(placed, size, fonts, defs))
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}">` +
    (defs.length === 0 ? '' : `<defs>${defs.join('')}</defs>`) +
    body.join('') +
    `</svg>`

  return { svg, dropped }
}

function renderLayer(
  placed: PlacedLayer,
  size: { width: number; height: number },
  fonts: FontFamilies,
  defs: string[],
): string {
  const { layer } = placed
  const rect = {
    x: placed.box.x * size.width,
    y: placed.box.y * size.height,
    w: placed.box.w * size.width,
    h: placed.box.h * size.height,
  }

  const wrap = attrs([
    layer.opacity === undefined ? '' : `opacity="${round(layer.opacity)}"`,
    layer.blend === undefined || layer.blend === 'normal'
      ? ''
      : `style="mix-blend-mode:${layer.blend}"`,
    filterOf(layer.effects, layer.id, size, defs),
  ])

  const inner = drawByType(placed, rect, size, fonts, defs)

  return wrap === '' ? inner : `<g ${wrap}>${inner}</g>`
}

function drawByType(
  placed: PlacedLayer,
  rect: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
  fonts: FontFamilies,
  defs: string[],
): string {
  const { layer } = placed

  if (layer.type === 'frame' || layer.type === 'cutout' || layer.type === 'asset') {
    if (placed.image === undefined) {
      // Декоративная картинка без привязки — рисовать нечего; привязанную снял бы K-3.
      return ''
    }
    return image(
      placed.image.dataUri,
      rect,
      layer.fit,
      layer.type === 'asset' ? undefined : layer.focus,
    )
  }

  if (layer.type === 'shape') {
    // Образец цвета приходит содержимым, а не макетом: цвета товара знает заявка, не
    // библиотека. Образцом может быть и принт — тогда в ту же форму кладётся картинка.
    if (placed.image !== undefined) {
      return clipped(layer.shape, rect, placed.image.dataUri, layer.id, size, defs)
    }
    const fill =
      placed.color !== undefined
        ? `fill="${placed.color}"`
        : paintOf(layer.fill, layer.id, placed.box, size, defs)
    return shape(layer.shape, rect, attrs([fill, strokeOf(layer.effects, size, false)]), size)
  }

  if (layer.type === 'text') {
    return text(placed.lines ?? [], layer.style, rect, size, fonts, strokeOf(layer.effects, size, true))
  }

  return ''
}

/** Картинка, обрезанная формой слоя: так образец цвета и образец принта задаются одним и
 *  тем же кругом в макете, а различаются только содержимым. */
function clipped(
  form: { form: 'rect'; radius?: number } | { form: 'ellipse' } | { form: 'line'; thickness: number },
  rect: { x: number; y: number; w: number; h: number },
  dataUri: string,
  id: string,
  size: { width: number; height: number },
  defs: string[],
): string {
  const clipId = `c-${slug(id)}-${defs.length}`
  defs.push(`<clipPath id="${clipId}">${shape(form, rect, 'fill="#000000"', size)}</clipPath>`)
  return `<g clip-path="url(#${clipId})">${image(dataUri, rect, 'cover', undefined)}</g>`
}

function image(
  dataUri: string,
  rect: { x: number; y: number; w: number; h: number },
  fit: 'cover' | 'contain',
  focus: Focus | undefined,
): string {
  const align = alignOf(focus)
  const preserve = fit === 'cover' ? `${align} slice` : `${align} meet`

  return (
    `<image x="${round(rect.x)}" y="${round(rect.y)}" ` +
    `width="${round(rect.w)}" height="${round(rect.h)}" ` +
    `preserveAspectRatio="${preserve}" href="${dataUri}"/>`
  )
}

/** SVG знает девять точек привязки, а не произвольную; берём ближайшую к точке интереса. */
function alignOf(focus: Focus | undefined): string {
  if (focus === undefined) {
    return 'xMidYMid'
  }
  const x = focus.x < 1 / 3 ? 'xMin' : focus.x < 2 / 3 ? 'xMid' : 'xMax'
  const y = focus.y < 1 / 3 ? 'YMin' : focus.y < 2 / 3 ? 'YMid' : 'YMax'
  return `${x}${y}`
}

function shape(
  form: { form: 'rect'; radius?: number } | { form: 'ellipse' } | { form: 'line'; thickness: number },
  rect: { x: number; y: number; w: number; h: number },
  fill: string,
  size: { width: number; height: number },
): string {
  if (form.form === 'rect') {
    // Радиус — доля холста по меньшей стороне: скруглённый угол обязан остаться круглым.
    const r = form.radius === undefined ? 0 : form.radius * Math.min(size.width, size.height)
    return (
      `<rect x="${round(rect.x)}" y="${round(rect.y)}" ` +
      `width="${round(rect.w)}" height="${round(rect.h)}" ` +
      (r > 0 ? `rx="${round(r)}" ry="${round(r)}" ` : '') +
      `${fill}/>`
    )
  }

  if (form.form === 'ellipse') {
    return (
      `<ellipse cx="${round(rect.x + rect.w / 2)}" cy="${round(rect.y + rect.h / 2)}" ` +
      `rx="${round(rect.w / 2)}" ry="${round(rect.h / 2)}" ${fill}/>`
    )
  }

  // Линия идёт по середине бокса: разделитель задаётся боксом, а не парой точек.
  const y = rect.y + rect.h / 2
  const stroke = fill.replace('fill=', 'stroke=')
  return (
    `<line x1="${round(rect.x)}" y1="${round(y)}" x2="${round(rect.x + rect.w)}" y2="${round(y)}" ` +
    `${stroke} stroke-width="${round(form.thickness * size.height)}" stroke-linecap="round"/>`
  )
}

function text(
  lines: string[],
  style: TextStyle,
  rect: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
  fonts: FontFamilies,
  stroke: string,
): string {
  if (lines.length === 0) {
    return ''
  }

  const fontSize = style.size * size.height
  const lineBox = style.lineHeight * fontSize
  const blockHeight = lines.length * lineBox

  const top =
    style.valign === 'top'
      ? rect.y
      : style.valign === 'middle'
        ? rect.y + (rect.h - blockHeight) / 2
        : rect.y + rect.h - blockHeight

  const anchorX =
    style.align === 'left' ? rect.x : style.align === 'center' ? rect.x + rect.w / 2 : rect.x + rect.w
  const anchor = style.align === 'left' ? 'start' : style.align === 'center' ? 'middle' : 'end'

  const common = attrs([
    `font-family="${escapeXml(fonts[style.role])}"`,
    `font-size="${round(fontSize)}"`,
    `font-weight="${style.weight}"`,
    style.italic === true ? 'font-style="italic"' : '',
    `fill="${style.color}"`,
    `text-anchor="${anchor}"`,
    style.tracking === undefined ? '' : `letter-spacing="${round(style.tracking * fontSize)}"`,
    stroke,
  ])

  return lines
    .map((line, index) => {
      const content = style.transform === 'upper' ? line.toLocaleUpperCase('ru-RU') : line
      const baseline = top + index * lineBox + lineBox / 2 + fontSize * BASELINE_IN_LINE
      return (
        `<text x="${round(anchorX)}" y="${round(baseline)}" ${common}>${escapeXml(content)}</text>`
      )
    })
    .join('')
}

function paintOf(
  paint: Paint | undefined,
  id: string,
  box: { x: number; y: number; w: number; h: number },
  size: { width: number; height: number },
  defs: string[],
): string {
  if (paint === undefined) {
    return 'fill="none"'
  }

  if (paint.kind === 'solid') {
    const opacity = paint.opacity === undefined ? '' : ` fill-opacity="${round(paint.opacity)}"`
    return `fill="${paint.color}"${opacity}`
  }

  const gradientId = `g-${slug(id)}-${defs.length}`
  const stops = paint.stops
    .map(
      (stop) =>
        `<stop offset="${round(stop.at)}" stop-color="${stop.color}"` +
        (stop.opacity === undefined ? '' : ` stop-opacity="${round(stop.opacity)}"`) +
        `/>`,
    )
    .join('')

  if (paint.kind === 'radial') {
    // Единицы бокса, а не холста: пятно обязано растянуться вместе с плашкой, иначе на
    // вытянутой карточке падение к краям останется круглым и прочтётся как пятно света.
    defs.push(
      `<radialGradient id="${gradientId}" cx="${round(paint.center.x)}" ` +
        `cy="${round(paint.center.y)}" r="${round(paint.radius)}">${stops}</radialGradient>`,
    )
    return `fill="url(#${gradientId})"`
  }

  // Линейный градиент задан в долях бокса, а объявляется в координатах холста: так одна и та
  // же запись даёт один и тот же наклон независимо от того, где лежит слой.
  const point = (p: Focus) => ({
    x: (box.x + p.x * box.w) * size.width,
    y: (box.y + p.y * box.h) * size.height,
  })
  const from = point(paint.from)
  const to = point(paint.to)

  defs.push(
    `<linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" ` +
      `x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}">` +
      `${stops}</linearGradient>`,
  )

  return `fill="url(#${gradientId})"`
}

function filterOf(
  effects: Effect[] | undefined,
  id: string,
  size: { width: number; height: number },
  defs: string[],
): string {
  // Обводка — не фильтр, а атрибуты самой фигуры: см. `strokeOf`.
  const filters = (effects ?? []).filter((effect) => effect.kind !== 'stroke')
  if (filters.length === 0) {
    return ''
  }

  const filterId = `f-${slug(id)}-${defs.length}`
  const unit = Math.min(size.width, size.height)
  const parts = filters
    .map((effect) => {
      if (effect.kind === 'blur') {
        return `<feGaussianBlur stdDeviation="${round(effect.radius * unit)}"/>`
      }
      if (effect.kind === 'shadow') {
        return (
          `<feDropShadow dx="${round(effect.dx * unit)}" dy="${round(effect.dy * unit)}" ` +
          `stdDeviation="${round(effect.blur * unit)}" ` +
          `flood-color="${effect.color}" flood-opacity="${round(effect.opacity)}"/>`
        )
      }
      return ''
    })
    .join('')

  // Тень выходит за бокс слоя — область фильтра расширяем, иначе она обрежется.
  defs.push(
    `<filter id="${filterId}" x="-30%" y="-30%" width="160%" height="160%">${parts}</filter>`,
  )

  return `filter="url(#${filterId})"`
}

/**
 * Обводка фигуры или текста. Толщина — доля меньшей стороны холста, как и радиус скругления:
 * волосяная линия на 1200 px обязана остаться волосяной и на 2400 px.
 *
 * `paint-order="stroke"` у текста обязателен: без него обводка съедает половину штриха глифа
 * изнутри, и светлая линия по тёмному тексту превращает буквы в кашу.
 */
function strokeOf(
  effects: Effect[] | undefined,
  size: { width: number; height: number },
  isText: boolean,
): string {
  const stroke = (effects ?? []).find((effect) => effect.kind === 'stroke')
  if (stroke === undefined || stroke.kind !== 'stroke') {
    return ''
  }

  return attrs([
    `stroke="${stroke.color}"`,
    `stroke-width="${round(stroke.thickness * Math.min(size.width, size.height))}"`,
    stroke.opacity === undefined ? '' : `stroke-opacity="${round(stroke.opacity)}"`,
    isText ? 'paint-order="stroke"' : '',
  ])
}

function attrs(parts: string[]): string {
  return parts.filter((part) => part !== '').join(' ')
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}

function slug(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
