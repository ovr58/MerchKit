/**
 * Код, исполняемый **внутри страницы** Chromium при снятии сцены HTML (шаги B2, C2 плана
 * `html-layout-authoring_2026-10-05.md`).
 *
 * Каждая функция самодостаточна — ни одной ссылки на модуль: Playwright сериализует её текст в
 * браузер (`page.evaluate(fn, arg)`). Две среды исполняют один и тот же текст:
 * - офлайн-инструмент `tools/card-pipeline/html-layout/extract.mts` — импортом;
 * - коробка выреза (`POST /layout`, репозиторий `cutout_runner`) — копией
 *   `assets/layout/extract-browser.js`, снятой с этого файла командой из README сервиса.
 *   Правка здесь без пересъёмки копии разводит офлайн-сцену и сцену рантайма.
 *
 * Что снимается и что отклоняется — `tools/card-pipeline/html-layout/SUBSET.md`.
 */

import type { HtmlScene } from './scene.ts'

/**
 * Свои шрифты страницы: файл · семейство · насыщенность. Те же файлы, что у сборки по слоям
 * (`tools/card-pipeline/fonts/`); на коробке — их копия в `assets/fonts/`. Данные, а не код
 * страницы, но живут здесь, чтобы список уезжал на коробку той же копией.
 */
export const FONT_FACES: [file: string, family: string, weight: number][] = [
  ['montserrat-regular.ttf', 'Montserrat', 400],
  ['montserrat-semibold.ttf', 'Montserrat', 600],
  ['montserrat-bold.ttf', 'Montserrat', 700],
  ['montserrat-black.ttf', 'Montserrat', 900],
  ['marck-script.ttf', 'Marck Script', 400],
]

/**
 * Шрифты — только наши: чужой `@font-face` страницы (модель его писать не должна, а записи
 * пробы ссылаются на снятое дерево) снимается до подключения своего.
 */
export function dropForeignFontFaces(): void {
  for (const sheet of Array.from(document.styleSheets)) {
    for (let at = sheet.cssRules.length - 1; at >= 0; at--) {
      if (sheet.cssRules[at] instanceof CSSFontFaceRule) sheet.deleteRule(at)
    }
  }
}

/** Ждёт загрузки своих шрифтов; возвращает файлы тех, что так и не загрузились. */
export async function missingFonts(faces: [file: string, family: string, weight: number][]): Promise<string[]> {
  await Promise.all(faces.map(([, family, weight]) => document.fonts.load(`${weight} 16px '${family}'`)))
  await document.fonts.ready
  return faces
    .filter(([, family, weight]) => !document.fonts.check(`${weight} 16px '${family}'`))
    .map(([file]) => file)
}

/**
 * Обход DOM внутри страницы. Самодостаточна: ни одной ссылки на модуль — её текст
 * сериализуется в браузер.
 */
export function sceneInPage(canvas: { width: number; height: number }): HtmlScene {
  type Rect = { x: number; y: number; w: number; h: number }
  type Line = { text: string; rect: Rect }

  const card = document.getElementById('card')
  if (card === null) {
    return { canvas, background: '', elements: [], rejected: [{ selector: '#card', reason: 'нет элемента #card' }] }
  }

  const origin = card.getBoundingClientRect()
  const rel = (r: DOMRect): Rect => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height })

  const selectorOf = (el: Element): string => {
    const tag = el.tagName.toLowerCase()
    if (el.id) return `${tag}#${el.id}`
    const parts: string[] = []
    let node: Element | null = el
    while (node && node !== card) {
      const parent: Element | null = node.parentElement
      const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1
      const cls = node.classList.length > 0 ? `.${Array.from(node.classList).join('.')}` : ''
      parts.unshift(`${node.tagName.toLowerCase()}${cls}:nth-child(${index})`)
      node = parent
    }
    return `#card > ${parts.join(' > ')}`
  }

  const FORBIDDEN_TAGS = new Set(['svg', 'canvas', 'video', 'iframe', 'object', 'embed', 'script', 'picture', 'audio'])
  const topLevel = (s: string): string[] => {
    // Запятые внутри скобок `rgb(…)` не делят список.
    const out: string[] = []
    let depth = 0
    let from = 0
    for (let at = 0; at < s.length; at++) {
      if (s[at] === '(') depth++
      else if (s[at] === ')') depth--
      else if (s[at] === ',' && depth === 0) {
        out.push(s.slice(from, at).trim())
        from = at + 1
      }
    }
    out.push(s.slice(from).trim())
    return out
  }
  const transparent = (color: string) => color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color)

  const rejected: { selector: string; reason: string }[] = []
  const found: { el: Element; kind: 'frame' | 'shape' | 'text'; rect: Rect; style: HtmlScene['elements'][number]['style']; lines?: Line[]; z: number; dom: number }[] = []

  const reasonsOf = (el: Element, cs: CSSStyleDeclaration, depth: number): string[] => {
    const reasons: string[] = []
    if (cs.transform !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none' || cs.translate !== 'none') reasons.push('transform')
    if (cs.filter !== 'none' || cs.backdropFilter !== 'none') reasons.push('filter')
    if (cs.mixBlendMode !== 'normal') reasons.push('mix-blend-mode')
    if (cs.clipPath !== 'none' || (cs.maskImage && cs.maskImage !== 'none')) reasons.push('clip-path/mask')
    if (cs.writingMode !== 'horizontal-tb') reasons.push('writing-mode')
    if (cs.textDecorationLine !== 'none') reasons.push('text-decoration')
    if (parseFloat(cs.webkitTextStrokeWidth || '0') > 0) reasons.push('-webkit-text-stroke')
    if (depth > 1 && cs.zIndex !== 'auto') reasons.push('z-index глубже детей #card')
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(el, pseudo).content
      if (content !== 'none' && content !== 'normal') reasons.push(`псевдоэлемент ${pseudo}`)
    }
    if (cs.backgroundImage !== 'none') {
      const layers = topLevel(cs.backgroundImage)
      if (layers.length > 1) reasons.push('несколько фонов')
      if (layers.some((layer) => !layer.startsWith('linear-gradient('))) reasons.push(`фон ${layers[0].slice(0, 40)}`)
    }
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const
    const widths = sides.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-width`))
    const styles = sides.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-style`))
    const colors = sides.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
    if (parseFloat(widths[0]) > 0 || widths.some((w) => parseFloat(w) > 0)) {
      if (new Set(widths).size > 1 || new Set(styles).size > 1 || new Set(colors).size > 1) reasons.push('рамка разная по сторонам')
      else if (styles[0] !== 'solid') reasons.push(`рамка ${styles[0]}`)
    }
    const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
    if (new Set(corners).size > 1) reasons.push('углы скругления разные')
    else if (corners[0].trim().includes(' ')) reasons.push('эллиптическое скругление')
    for (const [name, value] of [['box-shadow', cs.boxShadow], ['text-shadow', cs.textShadow]] as const) {
      if (value === 'none') continue
      if (topLevel(value).length > 1) reasons.push(`${name}: несколько теней`)
      if (/\binset\b/.test(value)) reasons.push(`${name}: inset`)
    }
    return reasons
  }

  const radiusOf = (cs: CSSStyleDeclaration, rect: Rect): number | string => {
    const value = cs.borderTopLeftRadius
    let px: number
    if (value.endsWith('%')) {
      if (Math.abs(rect.w - rect.h) > 1 && parseFloat(value) > 0) return 'скругление в % у неквадратного бокса'
      px = (parseFloat(value) / 100) * rect.w
    } else px = parseFloat(value) || 0
    return Math.min(px, Math.min(rect.w, rect.h) / 2)
  }

  const linesOf = (el: Element): Line[] => {
    const lines: { text: string; top: number; bottom: number; left: number; right: number }[] = []
    let pendingSpace = false
    const range = document.createRange()
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) {
        pendingSpace = true
        continue
      }
      const data = node.textContent ?? ''
      for (let at = 0; at < data.length; at++) {
        const char = data[at]
        if (/\s/.test(char)) {
          pendingSpace = true
          continue
        }
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const r = range.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        const mid = (r.top + r.bottom) / 2
        const current = lines[lines.length - 1]
        if (current && mid > current.top && mid < current.bottom) {
          current.text += (pendingSpace ? ' ' : '') + char
          current.left = Math.min(current.left, r.left)
          current.right = Math.max(current.right, r.right)
          current.top = Math.min(current.top, r.top)
          current.bottom = Math.max(current.bottom, r.bottom)
        } else lines.push({ text: char, top: r.top, bottom: r.bottom, left: r.left, right: r.right })
        pendingSpace = false
      }
    }
    return lines.map((line) => ({
      text: line.text,
      rect: { x: line.left - origin.left, y: line.top - origin.top, w: line.right - line.left, h: line.bottom - line.top },
    }))
  }

  let dom = 0
  const walk = (parent: Element, depth: number, z: number, opacity: number): void => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      const selector = selectorOf(el)
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      if (FORBIDDEN_TAGS.has(tag)) {
        rejected.push({ selector, reason: `тег <${tag}>` })
        continue
      }
      const ownZ = depth === 1 ? (cs.zIndex === 'auto' ? 0 : Number(cs.zIndex)) : z
      const ownOpacity = opacity * Number(cs.opacity)
      const reasons = reasonsOf(el, cs, depth)
      if (reasons.length > 0) {
        rejected.push({ selector, reason: reasons.join('; ') })
        continue
      }
      const rect = rel(el.getBoundingClientRect())
      const invisible = cs.visibility !== 'visible' || ownOpacity === 0 || rect.w === 0 || rect.h === 0

      if (tag === 'img') {
        if (el.getAttribute('src') !== 'frame.png') rejected.push({ selector, reason: 'картинка кроме frame.png' })
        else if (!invisible) {
          const radius = radiusOf(cs, rect)
          if (typeof radius === 'string') rejected.push({ selector, reason: radius })
          else
            found.push({
              el, kind: 'frame', rect, z: ownZ, dom: dom++,
              style: {
                opacity: ownOpacity, backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage,
                borderWidth: parseFloat(cs.borderTopWidth) || 0, borderColor: cs.borderTopColor, borderRadius: radius,
                boxShadow: cs.boxShadow, objectFit: cs.objectFit, objectPosition: cs.objectPosition,
              },
            })
        }
        continue
      }

      const ownText = Array.from(el.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
      const mixed = ownText && Array.from(el.children).some((child) => child.tagName.toLowerCase() !== 'br')
      if (mixed) {
        rejected.push({ selector, reason: 'текст вперемешку с вложенными элементами' })
        continue
      }
      const borderWidth = parseFloat(cs.borderTopWidth) || 0
      const visual = !transparent(cs.backgroundColor) || cs.backgroundImage !== 'none' || borderWidth > 0 || cs.boxShadow !== 'none'

      if (!invisible && (ownText || visual)) {
        const radius = radiusOf(cs, rect)
        if (typeof radius === 'string') {
          rejected.push({ selector, reason: radius })
          continue
        }
        const style: HtmlScene['elements'][number]['style'] = {
          opacity: ownOpacity, backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage,
          borderWidth, borderColor: cs.borderTopColor, borderRadius: radius, boxShadow: cs.boxShadow,
        }
        if (ownText) {
          Object.assign(style, {
            fontFamily: cs.fontFamily, fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight),
            fontStyle: cs.fontStyle, color: cs.color, textAlign: cs.textAlign, lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, textShadow: cs.textShadow,
          })
          found.push({ el, kind: 'text', rect, style, lines: linesOf(el), z: ownZ, dom: dom++ })
        } else found.push({ el, kind: 'shape', rect, style, z: ownZ, dom: dom++ })
      }
      if (!ownText) walk(el, depth + 1, ownZ, ownOpacity)
    }
  }

  walk(card, 1, 0, 1)
  found.sort((a, b) => a.z - b.z || a.dom - b.dom)

  return {
    canvas,
    background: getComputedStyle(card).backgroundColor,
    elements: found.map(({ el, kind, rect, style, lines }, order) => ({
      kind, rect, style, ...(lines ? { lines } : {}), order, selector: selectorOf(el),
    })),
    rejected,
  }
}
