/**
 * Короткий заголовок под бокс макета — шаг B7.8, решение Q-4 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md),
 * перенос на вторую строку — запись B32 бэклога.
 *
 * Кегль макета не сжимается, поэтому заголовок либо влезает в бокс, либо режется. Бокс по
 * высоте вмещает одну строку или две (больше двух заголовок не занимает), и вторая строка
 * открывается только там, где высота бокса её позволяет. Модели говорят предел в знаках
 * (`titleCharLimit`, на все строки бокса), а ответ модели всё равно проверяется обмером
 * (`titleFits`) и при нужде режется по словам (`fitTitle`): предел по знакам — оценка на
 * средней букве, а ширину строки знает только растеризатор.
 *
 * Сборщик (`svg.ts`) строк не переносит — обмерщика у него нет. Перенос делается здесь, до
 * сборки: `withTitleLines` кладёт в гнездо `title` готовые строки, и сборщик рисует их как
 * пришли. Перенос по словам, слова не теряются, поэтому дословность (C1) не страдает.
 *
 * Без ввода-вывода: обмерщик приходит параметром, как у `overflowsOf`.
 */

import { OVERFLOW_TOLERANCE_PX, overflowsOf, textProbes } from './svg.ts'
import type { FontFamilies, TextProbe } from './svg.ts'
import type { CardContent, CardLayout } from './types.ts'

type Size = { width: number; height: number }
type Measure = (svg: string) => number

/** Знак для оценки ширины: гласная строчная, средняя по ширине для кириллицы. */
const SAMPLE = 'о'
const SAMPLE_COUNT = 10

/** Больше двух строк заголовок не занимает: решение владельца по B32, 2026-10-04. */
const MAX_TITLE_LINES = 2

/** Пробы только слоёв, привязанных к гнезду `title`: декоративные надписи макета не в счёт. */
function titleProbes(layout: CardLayout, size: Size, fonts: FontFamilies, title: string): TextProbe[] {
  const content = { texts: { title: [title] }, props: [], swatches: [] }

  return textProbes(layout, content, size, fonts).filter(
    (probe) => probe.bind?.kind === 'text' && probe.bind.slot === 'title',
  )
}

/** Ширина строки заголовка в пикселях кадра; `null` — в макете нет гнезда `title`. */
export function titleWidthOf(
  layout: CardLayout,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
  title: string,
): number | null {
  const probes = titleProbes(layout, size, fonts, title)

  return probes.length === 0 ? null : Math.max(...probes.map((probe) => measure(probe.svg)))
}

/**
 * Сколько строк заголовка вмещает бокс по высоте: одну или две. Высоту блока даёт
 * арифметика вёрстки (кегль × межстрочный), допуск на округление — тот же, что у
 * `overflowsOf`. `null` — в макете нет гнезда `title`.
 */
export function titleLineLimit(layout: CardLayout, size: Size, fonts: FontFamilies): number | null {
  const [probe] = titleProbes(layout, size, fonts, SAMPLE)
  if (probe === undefined) return null
  if (probe.blockHeight <= 0) return 1

  const fitting = Math.floor((probe.box.height + OVERFLOW_TOLERANCE_PX) / probe.blockHeight)

  return Math.min(MAX_TITLE_LINES, Math.max(1, fitting))
}

/**
 * Сколько знаков с пробелами модели можно писать в заголовок: ширина бокса, делённая на
 * среднюю ширину знака, на каждую строку, которую бокс вмещает по высоте (`titleLineLimit`).
 * Среднюю даёт один обмер пробы из десяти одинаковых знаков. Не меньше одного знака на
 * строку; `null` — в макете нет гнезда `title`, и предел не от чего считать. Потери на
 * переносе слов в предел не вычитаются: лишнее заголовок потеряет по словам (`fitTitle`).
 */
export function titleCharLimit(
  layout: CardLayout,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
): number | null {
  const [probe] = titleProbes(layout, size, fonts, SAMPLE.repeat(SAMPLE_COUNT))
  if (probe === undefined) return null

  const perChar = measure(probe.svg) / SAMPLE_COUNT
  if (perChar <= 0) return null

  const perLine = Math.max(1, Math.floor(probe.box.width / perChar))

  return perLine * (titleLineLimit(layout, size, fonts) ?? 1)
}

/**
 * Влезает ли одна строка в бокс по ширине — тем же правилом, что арифметика переполнения
 * (`overflowsOf`, с её допуском на округление). У макета без гнезда `title` влезает всегда:
 * резать не о что.
 */
function lineFits(layout: CardLayout, size: Size, fonts: FontFamilies, measure: Measure): (line: string) => boolean {
  return (line) =>
    overflowsOf(titleProbes(layout, size, fonts, line), measure).every((overflow) => overflow.kind !== 'width')
}

/**
 * Перенос по словам: каждая строка, кроме последней, набирается до предела, последняя
 * забирает остаток целиком. Слова не теряются и не рвутся: остаток, который не влез,
 * остаётся длиннее бокса, и это видно обмеру (`titleFits`, `overflowsOf`). Слово длиннее
 * строки стоит на строке одно. Пробелы схлопываются.
 */
export function wrapWords(title: string, fitsLine: (line: string) => boolean, maxLines: number): string[] {
  const words = title.split(/\s+/).filter((word) => word !== '')
  const lines: string[] = []

  for (let index = 0; index < words.length; ) {
    if (lines.length >= maxLines - 1) {
      lines.push(words.slice(index).join(' '))
      break
    }

    let line = words[index]
    index += 1
    while (index < words.length && fitsLine(`${line} ${words[index]}`)) {
      line = `${line} ${words[index]}`
      index += 1
    }
    lines.push(line)
  }

  return lines
}

/** Строки заголовка в боксе макета: по словам, на столько строк, сколько бокс вмещает. */
export function titleLines(
  layout: CardLayout,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
  title: string,
): string[] {
  return wrapWords(title, lineFits(layout, size, fonts, measure), titleLineLimit(layout, size, fonts) ?? 1)
}

/**
 * Влезает ли заголовок в бокс: после переноса по словам каждая строка помещается по ширине,
 * а строк не больше, чем бокс вмещает по высоте.
 */
export function titleFits(
  layout: CardLayout,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
): (title: string) => boolean {
  const fitsLine = lineFits(layout, size, fonts, measure)
  const maxLines = titleLineLimit(layout, size, fonts) ?? 1

  return (title) => wrapWords(title, fitsLine, maxLines).every(fitsLine)
}

/**
 * Содержимое с заголовком, разложенным на строки бокса: в гнезде `title` лежат строки
 * переноса вместо одной. Идемпотентна: строки склеиваются и переносятся заново, получаются
 * те же. Макет без гнезда `title` и пустой заголовок возвращаются как есть.
 */
export function withTitleLines(
  layout: CardLayout,
  content: CardContent,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
): CardContent {
  const title = (content.texts.title ?? []).join(' ')
  if (title.trim() === '' || titleLineLimit(layout, size, fonts) === null) return content

  return { ...content, texts: { ...content.texts, title: titleLines(layout, size, fonts, measure, title) } }
}

/** Знаки, которые не должны остаться висеть на конце обрезанного заголовка. */
const TRAILING = /[\s,;:—-]+$/

/**
 * Заголовок, который влезает: сам (после схлопывания пробелов) или самый длинный префикс по
 * словам. Не влезает и одно слово — первое слово целиком: обрывать слово посередине хуже, чем
 * дать ему выйти на край. «Влезает» решает `fits` — для карточки это `titleFits`, то есть
 * бокс целиком, а не одна строка.
 */
export function fitTitle(title: string, fits: (title: string) => boolean): string {
  const clean = title.split(/\s+/).filter((word) => word !== '').join(' ')
  if (fits(clean)) return clean

  const words = clean.split(' ')

  for (let count = words.length - 1; count >= 1; count -= 1) {
    const prefix = words.slice(0, count).join(' ').replace(TRAILING, '')
    if (prefix !== '' && fits(prefix)) return prefix
  }

  return words[0]
}
