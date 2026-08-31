/**
 * Проверка макета до рендера и снятие слоёв, которым не хватило содержимого.
 *
 * **Два разных вопроса, поэтому две функции.** `validateLayout` спрашивает «этот макет вообще
 * записан по правилам?» — ответ не зависит от товара и считается один раз, когда макет
 * заводится в библиотеку. `resolveLayout` спрашивает «что из него рисуется вот на этом
 * товаре?» — ответ свой на каждой сборке. Смешать их значило бы перепроверять форму записи на
 * каждой генерации и при этом не иметь ответа на вопрос «почему в кадре нет логотипа».
 *
 * **Правило K-3: отсутствующий ассет снимает свой слой, а не роняет макет.** Не загрузили
 * логотип — нет слоя логотипа; нет иконки в базе — модуль рисуется текстом без иконки; нет
 * самой характеристики — модуль не рисуется вовсе. Композиция обязана остаться корректной во
 * всех трёх случаях, потому что чинить её пользователю нечем: редактор вынесен из вехи
 * (решение 11 от 2026-08-31).
 *
 * Диагностика — строками по-русски, как в `output-profile.ts`: она идёт в наши логи и в
 * `failure_reason`, а наружу пользователю показывается предупреждение о снятом слое, а не
 * устройство макета.
 */

import {
  BLEND_MODES,
  EFFECT_KINDS,
  FONT_ROLES,
  LAYER_TYPES,
  TEXT_ALIGNS,
  TEXT_SLOTS,
  TEXT_TRANSFORMS,
  TEXT_VALIGNS,
} from './types.ts'
import type {
  Binding,
  CardContent,
  CardLayout,
  Effect,
  Layer,
  Paint,
} from './types.ts'

/** Насколько слою позволено вылезти за холст. Вылет за обрез — приём вёрстки (слово-подложка
 *  уходит за правый край), но слой, целиком лежащий за кадром, — опечатка в долях. */
const MAX_BLEED = 0.5

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Возвращает список нарушений формы записи. Пустой список — макет можно рендерить.
 *
 * Проверяем именно то, что молча испортит кадр: неизвестное слово из-за пределов словаря,
 * доли, вылетевшие из холста, дубль идентификатора. «Невозможные» ветки не обкладываем.
 */
export function validateLayout(layout: CardLayout): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()

  if (layout.canvas.aspectW <= 0 || layout.canvas.aspectH <= 0) {
    problems.push('пропорция холста должна быть положительной')
  }

  checkPaint(layout.canvas.background, 'фон холста', problems)

  if (layout.layers.length === 0) {
    problems.push('в макете нет ни одного слоя')
  }

  walk(layout.layers, '', (layer, path) => {
    if (seenIds.has(layer.id)) {
      problems.push(`идентификатор слоя «${layer.id}» встречается дважды`)
    }
    seenIds.add(layer.id)

    if (!(LAYER_TYPES as readonly string[]).includes(layer.type)) {
      problems.push(`${path}: тип слоя «${layer.type}» не входит в словарь`)
    }

    checkBox(layer, path, problems)

    if (layer.opacity !== undefined && (layer.opacity < 0 || layer.opacity > 1)) {
      problems.push(`${path}: прозрачность ${layer.opacity} вне диапазона 0…1`)
    }

    if (layer.blend !== undefined && !(BLEND_MODES as readonly string[]).includes(layer.blend)) {
      problems.push(`${path}: режим наложения «${layer.blend}» не входит в словарь`)
    }

    for (const effect of layer.effects ?? []) {
      checkEffect(effect, path, problems)
    }

    if (layer.bind !== undefined) {
      checkBinding(layer.bind, path, problems)
    }

    checkByType(layer, path, problems)
  })

  return problems
}

function checkByType(layer: Layer, path: string, problems: string[]): void {
  if (layer.type === 'shape') {
    if (layer.fill !== undefined) {
      checkPaint(layer.fill, path, problems)
    }
    if (layer.shape.form === 'line' && layer.shape.thickness <= 0) {
      problems.push(`${path}: толщина линии должна быть положительной`)
    }
    return
  }

  if (layer.type === 'text') {
    const style = layer.style
    if (!(FONT_ROLES as readonly string[]).includes(style.role)) {
      problems.push(`${path}: роль шрифта «${style.role}» не входит в словарь`)
    }
    if (style.size <= 0) {
      problems.push(`${path}: кегль должен быть положительным`)
    }
    if (style.weight < 100 || style.weight > 900) {
      problems.push(`${path}: насыщенность ${style.weight} вне диапазона 100…900`)
    }
    if (!HEX.test(style.color)) {
      problems.push(`${path}: цвет «${style.color}» записан не как #rrggbb`)
    }
    if (!(TEXT_ALIGNS as readonly string[]).includes(style.align)) {
      problems.push(`${path}: выключка «${style.align}» не входит в словарь`)
    }
    if (!(TEXT_VALIGNS as readonly string[]).includes(style.valign)) {
      problems.push(`${path}: вертикальная привязка «${style.valign}» не входит в словарь`)
    }
    if (
      style.transform !== undefined &&
      !(TEXT_TRANSFORMS as readonly string[]).includes(style.transform)
    ) {
      problems.push(`${path}: преобразование «${style.transform}» не входит в словарь`)
    }
    if (style.lineHeight <= 0) {
      problems.push(`${path}: интерлиньяж должен быть положительным`)
    }
    // Текст без привязки обязан нести строки сам, иначе слой пуст и рисовать нечего.
    if (layer.bind === undefined && (layer.lines === undefined || layer.lines.length === 0)) {
      problems.push(`${path}: у текста без привязки нет строк`)
    }
    return
  }

  if (layer.type === 'group' && layer.children.length === 0) {
    problems.push(`${path}: группа без вложенных слоёв`)
  }
}

function checkBox(layer: Layer, path: string, problems: string[]): void {
  const { x, y, w, h } = layer.box

  if (w <= 0 || h <= 0) {
    problems.push(`${path}: размер бокса ${w} × ${h} должен быть положительным`)
    return
  }

  if (x < -MAX_BLEED || y < -MAX_BLEED || x + w > 1 + MAX_BLEED || y + h > 1 + MAX_BLEED) {
    problems.push(
      `${path}: бокс ${fmt(x)},${fmt(y)} ${fmt(w)}×${fmt(h)} уходит за холст дальше ` +
        `допустимого вылета ${MAX_BLEED}`,
    )
  }

  if (x >= 1 || y >= 1 || x + w <= 0 || y + h <= 0) {
    problems.push(`${path}: бокс не пересекается с холстом — слой невидим`)
  }
}

function checkEffect(effect: Effect, path: string, problems: string[]): void {
  if (!(EFFECT_KINDS as readonly string[]).includes(effect.kind)) {
    problems.push(`${path}: эффект «${effect.kind}» не входит в словарь`)
    return
  }

  if (effect.kind === 'shadow') {
    if (!HEX.test(effect.color)) {
      problems.push(`${path}: цвет тени «${effect.color}» записан не как #rrggbb`)
    }
    if (effect.opacity < 0 || effect.opacity > 1) {
      problems.push(`${path}: прозрачность тени ${effect.opacity} вне диапазона 0…1`)
    }
    if (effect.blur < 0) {
      problems.push(`${path}: размытие тени не может быть отрицательным`)
    }
    return
  }

  if (effect.kind === 'blur') {
    if (effect.radius <= 0) {
      problems.push(`${path}: радиус размытия должен быть положительным`)
    }
    return
  }

  if (!HEX.test(effect.color)) {
    problems.push(`${path}: цвет обводки «${effect.color}» записан не как #rrggbb`)
  }
  if (effect.thickness <= 0) {
    problems.push(`${path}: толщина обводки должна быть положительной`)
  }
  if (effect.opacity !== undefined && (effect.opacity < 0 || effect.opacity > 1)) {
    problems.push(`${path}: прозрачность обводки ${effect.opacity} вне диапазона 0…1`)
  }
}

function checkPaint(paint: Paint, path: string, problems: string[]): void {
  if (paint.kind === 'solid') {
    if (!HEX.test(paint.color)) {
      problems.push(`${path}: цвет «${paint.color}» записан не как #rrggbb`)
    }
    return
  }

  if (paint.kind === 'radial' && paint.radius <= 0) {
    problems.push(`${path}: радиус градиента должен быть положительным`)
  }

  if (paint.stops.length < 2) {
    problems.push(`${path}: у градиента меньше двух точек`)
  }

  for (const stop of paint.stops) {
    if (!HEX.test(stop.color)) {
      problems.push(`${path}: цвет точки градиента «${stop.color}» записан не как #rrggbb`)
    }
    if (stop.at < 0 || stop.at > 1) {
      problems.push(`${path}: точка градиента ${stop.at} вне диапазона 0…1`)
    }
  }
}

function checkBinding(bind: Binding, path: string, problems: string[]): void {
  if (bind.kind === 'text' && !(TEXT_SLOTS as readonly string[]).includes(bind.slot)) {
    problems.push(`${path}: текстовое гнездо «${bind.slot}» не входит в словарь`)
    return
  }

  if ((bind.kind === 'prop' || bind.kind === 'swatch') && !Number.isInteger(bind.index)) {
    problems.push(`${path}: номер «${bind.index}» в привязке должен быть целым`)
    return
  }

  if ((bind.kind === 'prop' || bind.kind === 'swatch') && bind.index < 0) {
    problems.push(`${path}: номер в привязке не может быть отрицательным`)
  }
}

/** Слой, снятый правилом K-3, и причина — её показывает интерфейс до запуска генерации. */
export type DroppedLayer = { id: string; reason: string }

export type ResolvedLayout = {
  /** Плоский список: группы раскрыты, координаты детей пересчитаны в доли холста, порядок —
   *  по возрастанию z. Сборщику остаётся рисовать подряд. */
  layers: PlacedLayer[]
  dropped: DroppedLayer[]
}

/** Слой с абсолютным боксом и уже подставленным содержимым. */
export type PlacedLayer = {
  layer: Layer
  /** Бокс в долях холста — у вложенных слоёв уже пересчитан из долей группы. */
  box: { x: number; y: number; w: number; h: number }
  z: number
  /** Строки для `text` после подстановки содержимого. */
  lines?: string[]
  /** Картинка для `frame`, `cutout`, `asset` после подстановки. */
  image?: { dataUri: string; width: number; height: number }
  /** Цвет для образца-плашки, заданного цветом, а не картинкой. */
  color?: string
}

/**
 * Наполняет макет содержимым и снимает слои, которым содержимого не досталось (K-3).
 *
 * Группы раскрываются здесь же: у сборщика не должно быть второго места, где считаются
 * координаты, — иначе доли группы и доли холста разъедутся ровно так, как расходятся две
 * копии одной формулы.
 */
export function resolveLayout(layout: CardLayout, content: CardContent): ResolvedLayout {
  const layers: PlacedLayer[] = []
  const dropped: DroppedLayer[] = []

  place(layout.layers, { x: 0, y: 0, w: 1, h: 1 }, 0, layers, dropped, content)
  layers.sort((a, b) => a.z - b.z)

  return { layers, dropped }
}

function place(
  children: Layer[],
  parent: { x: number; y: number; w: number; h: number },
  zBase: number,
  out: PlacedLayer[],
  dropped: DroppedLayer[],
  content: CardContent,
): number {
  let placed = 0

  for (const layer of children) {
    const box = {
      x: parent.x + layer.box.x * parent.w,
      y: parent.y + layer.box.y * parent.h,
      w: layer.box.w * parent.w,
      h: layer.box.h * parent.h,
    }
    const z = zBase + layer.z

    if (layer.type === 'group') {
      // Привязка группы решает судьбу модуля целиком: нет характеристики — нет модуля.
      const missing = layer.bind === undefined ? null : describeMissing(layer.bind, content)
      if (missing !== null) {
        dropped.push({ id: layer.id, reason: missing })
        continue
      }

      const inner: PlacedLayer[] = []
      const drawn = place(layer.children, box, z, inner, dropped, content)

      // Пустая группа — дырка в композиции, а не «модуль без содержимого»: снимаем целиком.
      if (drawn === 0) {
        dropped.push({ id: layer.id, reason: 'ни один слой модуля не получил содержимого' })
        continue
      }

      out.push(...inner)
      placed += drawn
      continue
    }

    const filled = fill(layer, box, z, content)
    if ('reason' in filled) {
      dropped.push({ id: layer.id, reason: filled.reason })
      continue
    }

    out.push(filled)
    placed += 1
  }

  return placed
}

function fill(
  layer: Layer,
  box: { x: number; y: number; w: number; h: number },
  z: number,
  content: CardContent,
): PlacedLayer | { reason: string } {
  const bind = layer.bind

  if (bind === undefined) {
    // Декоративный слой: содержимое записано в самом макете, снимать нечего.
    return layer.type === 'text' ? { layer, box, z, lines: layer.lines ?? [] } : { layer, box, z }
  }

  const missing = describeMissing(bind, content)
  if (missing !== null) {
    return { reason: missing }
  }

  if (layer.type === 'text') {
    return { layer, box, z, lines: textFor(bind, content) }
  }

  if (bind.kind === 'swatch') {
    const swatch = content.swatches[bind.index]
    return 'color' in swatch ? { layer, box, z, color: swatch.color } : { layer, box, z, image: swatch }
  }

  return { layer, box, z, image: imageFor(bind, content) }
}

/** Чего не хватило. `null` — содержимое есть, слой рисуется. */
function describeMissing(bind: Binding, content: CardContent): string | null {
  if (bind.kind === 'frame') {
    return content.frame === undefined ? 'кадр вендора не передан' : null
  }

  if (bind.kind === 'cutout') {
    return content.cutout === undefined ? 'вырез товара не готов' : null
  }

  if (bind.kind === 'logo') {
    return content.logo === undefined ? 'логотип не загружен' : null
  }

  if (bind.kind === 'text') {
    const lines = content.texts[bind.slot]
    return lines === undefined || lines.length === 0 ? `текст «${bind.slot}» не задан` : null
  }

  if (bind.kind === 'swatch') {
    return content.swatches[bind.index] === undefined
      ? `образца цвета №${bind.index + 1} нет`
      : null
  }

  const prop = content.props[bind.index]
  if (prop === undefined) {
    return `характеристики №${bind.index + 1} нет`
  }

  if (bind.part === 'icon') {
    return prop.icon === undefined ? `иконки характеристики №${bind.index + 1} нет в базе` : null
  }

  if (bind.part === 'label') {
    return prop.label === undefined ? `у характеристики №${bind.index + 1} нет названия` : null
  }

  if (bind.part === 'value') {
    return prop.value === undefined ? `у характеристики №${bind.index + 1} нет значения` : null
  }

  return null
}

function textFor(bind: Binding, content: CardContent): string[] {
  if (bind.kind === 'text') {
    return content.texts[bind.slot] ?? []
  }

  if (bind.kind === 'prop') {
    const prop = content.props[bind.index]
    // Перенос в значении характеристики задаёт тот, кто её пишет: сборщик строки не
    // подбирает, но и не склеивает заданные.
    return ((bind.part === 'value' ? prop.value : prop.label) ?? '').split('\n')
  }

  return []
}

function imageFor(
  bind: Binding,
  content: CardContent,
): { dataUri: string; width: number; height: number } | undefined {
  if (bind.kind === 'frame') return content.frame
  if (bind.kind === 'cutout') return content.cutout
  if (bind.kind === 'logo') return content.logo
  if (bind.kind === 'prop' && bind.part === 'icon') return content.props[bind.index].icon
  return undefined
}

function walk(layers: Layer[], prefix: string, visit: (layer: Layer, path: string) => void): void {
  for (const layer of layers) {
    const path = prefix === '' ? layer.id : `${prefix} → ${layer.id}`
    visit(layer, path)
    if (layer.type === 'group') {
      walk(layer.children, path, visit)
    }
  }
}

function fmt(value: number): string {
  return value.toFixed(3)
}
