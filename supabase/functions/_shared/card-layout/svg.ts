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
import type { DroppedLayer, PlacedLayer, PlacedRun } from './validate.ts'
import type {
  Binding,
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
 * Строка композиции, вынутая для арифметики переполнения (K-1, шаг B6).
 *
 * **Ширину строки здесь никто не считает.** Средняя ширина знака врёт на любой гарнитуре, а
 * на карточке это цена ошибки в кадре: строка молча вылезает за плашку. Поэтому наружу
 * отдаётся готовая проба — самодостаточный SVG с этой же строкой в этом же начертании, —
 * и обмеряет её тот же растеризатор, который потом рисует. Замер 2026-09-03: обмер строки
 * стоит 1–3 мс в изоляте.
 *
 * Высота обмера не требует: разбивку на строки задаёт макет, а не сборщик, поэтому высота
 * блока — арифметика вёрстки, и она посчитана здесь.
 */
export type TextProbe = {
  layerId: string
  /** Чем слой наполнен. Превью по ней отличает окончательный текст от заглушки. */
  bind?: Binding
  /** Номер строки в слое, с нуля. */
  line: number
  /** Что написано — этим же текстом превью называет переполнение человеку. */
  text: string
  /** Самодостаточный SVG с одной строкой: `x=0`, начертание слоя, обмер по `getBBox`. */
  svg: string
  /** Бокс слоя в пикселях кадра. */
  box: { width: number; height: number }
  /** Высота текстового блока по арифметике вёрстки, в пикселях. */
  blockHeight: number
}

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

/**
 * Пробы всех строк композиции — вход арифметики переполнения (B6).
 *
 * Отдельным проходом, а не полем `ComposeResult`: сборке (B7) пробы не нужны, а превью не
 * нужен растр в тот же момент. Оба прохода читают один и тот же `resolveLayout`, поэтому
 * разойтись с нарисованным пробы не могут.
 */
export function textProbes(
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
  fonts: FontFamilies,
): TextProbe[] {
  const probes: TextProbe[] = []

  for (const placed of resolveLayout(layout, content).layers) {
    const { layer } = placed
    if (layer.type !== 'text' || placed.lines === undefined || placed.lines.length === 0) continue

    const fontSize = layer.style.size * size.height
    const box = { width: placed.box.w * size.width, height: placed.box.h * size.height }
    const blockHeight = placed.lines.length * layer.style.lineHeight * fontSize
    // Якорь всегда `start`: проба стоит на x=0, а `text-anchor` двигает строку, но её
    // ширину не меняет. Обводка в пробу не едет, и сегодня это ничего не искажает — в
    // библиотеке из 34 макетов нет ни одного текстового слоя с эффектом `stroke`. Появится —
    // обмер начнёт занижать ширину на её толщину, и обводку придётся добавить сюда.
    const common = textAttrs(layer.style, size, fonts, 'start', '')

    placed.lines.forEach((runs, line) => {
      // Холст пробы заведомо шире любой мыслимой строки: `getBBox` меряет дерево, а не то,
      // что попало в кадр, но обрезанная строка сбивала бы с толку при отладке.
      const canvas = Math.max(size.width, size.height) * 4

      probes.push({
        layerId: layer.id,
        bind: layer.bind,
        line,
        text: runs.map((run) => run.text).join(''),
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="${round(canvas)}" height="${round(fontSize * 4)}">` +
          `<text x="0" y="${round(fontSize * 2)}" ${common}>${lineBody(runs, layer.style, size)}</text></svg>`,
        box,
        blockHeight,
      })
    })
  }

  return probes
}

/** Что не поместилось в свой бокс. Пустой список — вёрстка сходится. */
export type Overflow = {
  layerId: string
  bind?: Binding
  /** Строка шире бокса или блок строк выше бокса. */
  kind: 'width' | 'height'
  text: string
  /** Насколько вылезло долей бокса: 0.18 — строка на 18% длиннее места под неё. Долей, а
   *  не пикселями: превью уменьшено, и пиксели превью человеку ничего не скажут. */
  over: number
}

/** Меньшее превышение — след округлений, а не брак вёрстки. */
const OVERFLOW_TOLERANCE_PX = 1

/**
 * Арифметика переполнения (K-1): какие строки не влезают в свои боксы.
 *
 * Ширину спрашивает у обмерщика (в изоляте это `resvg`), высоту считает сама. Функция
 * чистая — обмерщик приходит параметром, иначе половина сборщика знала бы про рантайм.
 */
export function overflowsOf(probes: TextProbe[], measure: (svg: string) => number): Overflow[] {
  const wide: Overflow[] = []
  const tall = new Map<string, Overflow>()

  for (const probe of probes) {
    const width = measure(probe.svg)
    if (width - probe.box.width > OVERFLOW_TOLERANCE_PX) {
      wide.push({
        layerId: probe.layerId,
        bind: probe.bind,
        kind: 'width',
        text: probe.text,
        over: (width - probe.box.width) / probe.box.width,
      })
    }

    // Высота — свойство слоя целиком, а не строки: докладывается одной записью на слой, и
    // текстом в ней стоит весь блок, иначе человек чинил бы первую строку вместо переноса.
    if (probe.blockHeight - probe.box.height > OVERFLOW_TOLERANCE_PX) {
      const already = tall.get(probe.layerId)
      if (already === undefined) {
        tall.set(probe.layerId, {
          layerId: probe.layerId,
          bind: probe.bind,
          kind: 'height',
          text: probe.text,
          over: (probe.blockHeight - probe.box.height) / probe.box.height,
        })
      } else {
        already.text = `${already.text} / ${probe.text}`
      }
    }
  }

  return [...wide, ...tall.values()]
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
    // Поворот вокруг центра бокса, а не вокруг начала координат: иначе слой уезжает из кадра.
    layer.rotate === undefined || layer.rotate === 0
      ? ''
      : `transform="rotate(${round(layer.rotate)} ${round(rect.x + rect.w / 2)} ${round(rect.y + rect.h / 2)})"`,
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
    const drawn = image(
      layer.type === 'asset' ? inked(placed.image.dataUri, layer.ink) : placed.image.dataUri,
      rect,
      layer.fit,
      layer.type === 'asset' ? undefined : layer.focus,
    )

    if (layer.radius === undefined || layer.radius === 0) {
      return drawn
    }

    // Радиус — доля меньшей стороны: одинаковое скругление на кадре любой пропорции.
    const clipId = `r-${slug(layer.id)}-${defs.length}`
    const rx = layer.radius * Math.min(rect.w, rect.h)
    defs.push(
      `<clipPath id="${clipId}"><rect x="${round(rect.x)}" y="${round(rect.y)}" ` +
        `width="${round(rect.w)}" height="${round(rect.h)}" ` +
        `rx="${round(rx)}" ry="${round(rx)}"/></clipPath>`,
    )
    return `<g clip-path="url(#${clipId})">${drawn}</g>`
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

/** Тёмная краска по умолчанию: на белой плашке читается, на тёмной поймает валидатор. */
const DEFAULT_INK = '#1c1c1c'

/**
 * Подставляет краску слоя в исходник иконки.
 *
 * Иконки базы рисуются `currentColor` и цвета не несут — он приходит из макета (шаг A8).
 * Подстановка идёт здесь, а не при сборке содержимого, потому что только здесь известны обе
 * половины: исходник из базы и краска из слоя. Растровые ассеты проходят мимо — в PNG красить
 * нечего.
 */
function inked(dataUri: string, ink: string | undefined): string {
  const prefix = 'data:image/svg+xml;base64,'
  if (!dataUri.startsWith(prefix)) {
    return dataUri
  }

  const source = atob(dataUri.slice(prefix.length))
  if (!source.includes('currentColor')) {
    return dataUri
  }

  return prefix + btoa(source.replaceAll('currentColor', ink ?? DEFAULT_INK))
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

  // Линия идёт по середине бокса: разделитель задаётся боксом, а не парой точек. Куда она
  // ляжет, решает сам бокс — высокий и узкий даёт вертикальную. Раньше линия была всегда
  // горизонтальной, и вертикальный разделитель коллажа выродился бы в невидимую точку.
  const stroke = fill.replace('fill=', 'stroke=')
  const vertical = rect.h > rect.w
  const [x1, y1, x2, y2] = vertical
    ? [rect.x + rect.w / 2, rect.y, rect.x + rect.w / 2, rect.y + rect.h]
    : [rect.x, rect.y + rect.h / 2, rect.x + rect.w, rect.y + rect.h / 2]

  return (
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" ` +
    `${stroke} stroke-width="${round(form.thickness * size.height)}" stroke-linecap="round"/>`
  )
}

function text(
  lines: PlacedRun[][],
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

  const common = textAttrs(style, size, fonts, anchor, stroke)

  return lines
    .map((runs, index) => {
      const baseline = top + index * lineBox + lineBox / 2 + fontSize * BASELINE_IN_LINE
      const open = `<text x="${round(anchorX)}" y="${round(baseline)}" ${common}>`

      return `${open}${lineBody(runs, style, size)}</text>`
    })
    .join('')
}

/** Начертание строки одной записью: рисование и обмер (B6) обязаны спрашивать одно и то же. */
function textAttrs(
  style: TextStyle,
  size: { width: number; height: number },
  fonts: FontFamilies,
  anchor: string,
  stroke: string,
): string {
  const fontSize = style.size * size.height

  return attrs([
    `font-family="${escapeXml(fonts[style.role])}"`,
    `font-size="${round(fontSize)}"`,
    `font-weight="${style.weight}"`,
    style.italic === true ? 'font-style="italic"' : '',
    `fill="${style.color}"`,
    `text-anchor="${anchor}"`,
    style.tracking === undefined ? '' : `letter-spacing="${round(style.tracking * fontSize)}"`,
    stroke,
  ])
}

/** Содержимое одного `<text>`: цельная строка или прогоны разного начертания. */
function lineBody(runs: PlacedRun[], style: TextStyle, size: { width: number; height: number }): string {
  const cased = (value: string): string =>
    style.transform === 'upper' ? value.toLocaleUpperCase('ru-RU') : value

  // Цельная строка остаётся одним <text> без вложений: прогоны появляются только там, где
  // внутри фразы действительно меняется начертание.
  return runs.length === 1 && isPlain(runs[0])
    ? escapeXml(cased(runs[0].text))
    : runs.map((run) => `<tspan ${runAttrs(run, size)}>${escapeXml(cased(run.text))}</tspan>`).join('')
}

/** Прогон без собственных отличий рисуется стилем слоя — оборачивать его не во что. */
function isPlain(run: PlacedRun): boolean {
  return run.weight === undefined && run.size === undefined && run.color === undefined
}

function runAttrs(run: PlacedRun, size: { width: number; height: number }): string {
  return attrs([
    run.weight === undefined ? '' : `font-weight="${run.weight}"`,
    run.size === undefined ? '' : `font-size="${round(run.size * size.height)}"`,
    run.color === undefined ? '' : `fill="${run.color}"`,
  ])
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
