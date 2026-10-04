/**
 * Сцена HTML (`HtmlScene`) — то, что Chromium снял со страницы сочинения карточки (шаг B2 плана
 * `html-layout-authoring_2026-10-05.md`). Вход транспилятора `toLayout` (B3).
 *
 * **Пиксели, а не доли.** Сцена — снимок браузера как есть: боксы относительно `#card` и
 * вычисленные стили строками, как их отдал `getComputedStyle`. Доли холста, hex-цвета и роли
 * шрифтов считает только транспилятор — так обход DOM остаётся тупым и одинаковым в офлайн-
 * инструменте (`tools/card-pipeline/html-layout/extract.mts`) и на коробке выреза (`POST
 * /layout`, шаг C2), а все решения перевода живут в одном месте.
 *
 * Что снимается и почему — `tools/card-pipeline/html-layout/SUBSET.md`.
 */

/** Прямоугольник в пикселях относительно левого верхнего угла `#card`. */
export type SceneRect = { x: number; y: number; w: number; h: number }

/** Строка текста, как её разложил Chromium: исходные буквы DOM (без `text-transform`). */
export type SceneLine = { text: string; rect: SceneRect }

/** Вычисленные стили элемента, нужные переводу. Строки — как в `getComputedStyle`. */
export type SceneStyle = {
  /** Произведение `opacity` элемента и всех его предков до `#card`. */
  opacity: number
  backgroundColor: string
  backgroundImage: string
  /** Рамка одинаковая со всех сторон (иначе элемент отклонён): ширина в px. */
  borderWidth: number
  borderColor: string
  /** Скругление в px, уже разрешённое из `%` и ограниченное половиной меньшей стороны. */
  borderRadius: number
  boxShadow: string
  /** Только у текста. */
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: string
  color?: string
  textAlign?: string
  /** `normal` или px строкой. */
  lineHeight?: string
  letterSpacing?: string
  textTransform?: string
  textShadow?: string
  /** Только у кадра. */
  objectFit?: string
  objectPosition?: string
}

export type SceneElement = {
  kind: 'frame' | 'shape' | 'text'
  rect: SceneRect
  style: SceneStyle
  /** Только у `text`, по строке на строку Chromium. */
  lines?: SceneLine[]
  /** Номер в порядке отрисовки, с нуля: сортировка по `z-index` детей `#card`, затем DOM. */
  order: number
  /** CSS-путь элемента — для сообщений. */
  selector: string
}

export type SceneRejection = { selector: string; reason: string }

export type HtmlScene = {
  canvas: { width: number; height: number }
  /** Вычисленный `background-color` `#card`. */
  background: string
  elements: SceneElement[]
  /** Элементы вне подмножества. Непустой — транспилировать нельзя. */
  rejected: SceneRejection[]
}
