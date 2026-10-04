/**
 * Короткий заголовок под бокс макета — шаг B7.8, решение Q-4 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * Заголовок карточки стоит в макете одной строкой, кегль макета не сжимается. Поэтому модели
 * говорят предел в знаках (`titleCharLimit`), а ответ модели всё равно проверяется обмером
 * (`titleFits`) и при нужде режется по словам (`fitTitle`): предел по знакам — оценка на
 * средней букве, а ширину строки знает только растеризатор.
 *
 * Без ввода-вывода: обмерщик приходит параметром, как у `overflowsOf`.
 */

import { overflowsOf, textProbes } from './svg.ts'
import type { FontFamilies, TextProbe } from './svg.ts'
import type { CardLayout } from './types.ts'

type Size = { width: number; height: number }
type Measure = (svg: string) => number

/** Знак для оценки ширины: гласная строчная, средняя по ширине для кириллицы. */
const SAMPLE = 'о'
const SAMPLE_COUNT = 10

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
 * Сколько знаков с пробелами модели можно писать в заголовок: ширина бокса, делённая на
 * среднюю ширину знака. Среднюю даёт один обмер пробы из десяти одинаковых знаков. Не меньше 1;
 * `null` — в макете нет гнезда `title`, и предел не от чего считать.
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

  return Math.max(1, Math.floor(probe.box.width / perChar))
}

/**
 * Влезает ли заголовок в бокс по ширине — тем же правилом, что арифметика переполнения
 * (`overflowsOf`, с её допуском на округление). У макета без гнезда `title` влезает всегда:
 * резать не о что.
 */
export function titleFits(
  layout: CardLayout,
  size: Size,
  fonts: FontFamilies,
  measure: Measure,
): (title: string) => boolean {
  return (title) =>
    overflowsOf(titleProbes(layout, size, fonts, title), measure).every((overflow) => overflow.kind !== 'width')
}

/** Знаки, которые не должны остаться висеть на конце обрезанного заголовка. */
const TRAILING = /[\s,;:—-]+$/

/**
 * Заголовок, который влезает: сам (после схлопывания пробелов) или самый длинный префикс по
 * словам. Не влезает и одно слово — первое слово целиком: обрывать слово посередине хуже, чем
 * дать ему выйти на край.
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
