/**
 * Чем наполняется макет в бесплатном превью до оплаты (шаг B6, коррекция K-1).
 *
 * **Превью показывает вёрстку, а не результат.** Кадра вендора ещё нет — его рисует платный
 * вызов, — поэтому на его месте стоит заглушка. Настоящее в превью ровно то, что продавец
 * уже задал сам: наименование товара и характеристики из B1. Всё остальное — подписи-рыба,
 * и превью обязано сказать об этом словами, иначе продавец примет заглушку за обещание.
 *
 * **Отсечённые свойства — главное, ради чего шаг существует.** Потолок списка — ёмкость
 * выбранного макета (решение по O-5 от 2026-09-01), лишнее отбрасывается с хвоста. Молчаливая
 * пропажа характеристики и есть тот брак, который K-1 ловит: продавец узнал бы о ней уже по
 * оплаченному кадру.
 */

import {
  boundTextSlots,
  frameCount,
  propertyCapacity,
  swatchCount,
  usesCutout,
  usesLogo,
} from './features.ts'
import type { CardContent, CardLayout, CardProp, ImageRef, TextSlot } from './types.ts'

export type PreviewProperty = { label: string; value: string }

export type PreviewInput = {
  /** Наименование товара от продавца: единственный окончательный текст в превью. */
  productTitle: string
  properties: PreviewProperty[]
  /** Знак загружен. Байты сюда не едут: на превью хватает заглушки нужной формы. */
  hasLogo: boolean
}

export type PreviewFilling = {
  content: CardContent
  /** Сколько характеристик макет умеет показать. */
  capacity: number
  /** Хвост списка сверх ёмкости — то, чего в кадре не будет. */
  cut: PreviewProperty[]
  /** Гнёзда, заполненные рыбой: превью называет их человеку, чтобы не выдать за настоящее. */
  stubbed: TextSlot[]
}

/**
 * Подписи-рыба короткие намеренно: длинная рыба вылезала бы за свой бокс и попадала в список
 * переполнений наравне с текстом продавца, а чинить её ему нечем.
 */
const STUB_TEXTS: Record<Exclude<TextSlot, 'title'>, string> = {
  subtitle: 'Подзаголовок',
  kicker: 'Плашка',
  body: 'Описание',
  sizes: 'S M L XL',
  brand: 'Бренд',
}

const STUB_TITLE = 'Наименование товара'

/** Нейтральные цвета образцов: чем товар красится на самом деле, заявка ещё не знает. */
const STUB_SWATCHES = ['#2f3640', '#8d99ae', '#c9ada7', '#3d5a80', '#8a5a44', '#606c38']

/** Косая штриховка вместо картинки: серое пятно читалось бы как часть дизайна. */
const STUB_IMAGE = svgRef(
  '<defs><pattern id="s" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
    '<rect width="24" height="24" fill="#e6e9ed"/><rect width="12" height="24" fill="#d5dae0"/></pattern></defs>' +
    '<rect width="240" height="320" fill="url(#s)"/>',
  240,
  320,
)

/** Заглушка знака: та же штриховка сплошным тоном, чтобы не спорить с кадром. */
const STUB_LOGO = svgRef('<rect width="240" height="80" rx="12" fill="#9aa3ad"/>', 240, 80)

export function previewFilling(layout: CardLayout, input: PreviewInput): PreviewFilling {
  const capacity = propertyCapacity(layout)
  const properties = input.properties.filter(
    (property) => property.label.trim() !== '' || property.value.trim() !== '',
  )

  const title = input.productTitle.trim()
  const stubbed: TextSlot[] = []
  const texts: Partial<Record<TextSlot, string[]>> = {}

  // Наполняются только гнёзда, которые макет адресует: остальные не нарисуются всё равно, а
  // в списке «здесь рыба» превратились бы в обещание того, чего в кадре не будет.
  for (const slot of boundTextSlots(layout)) {
    if (slot === 'title' && title !== '') {
      texts.title = [title]
      continue
    }

    texts[slot] = [slot === 'title' ? STUB_TITLE : STUB_TEXTS[slot]]
    stubbed.push(slot)
  }

  const content: CardContent = {
    // Кадров ровно столько, сколько адресует макет: лишняя заглушка ничего не нарисует, а
    // недостающая сняла бы слой правилом K-3 и превью соврало бы про пустое место.
    frames: Array.from({ length: frameCount(layout) }, () => STUB_IMAGE),
    cutout: usesCutout(layout) ? STUB_IMAGE : undefined,
    logo: input.hasLogo && usesLogo(layout) ? STUB_LOGO : undefined,
    texts,
    props: properties.slice(0, capacity).map(toProp),
    swatches: Array.from({ length: swatchCount(layout) }, (_, index) => ({
      color: STUB_SWATCHES[index % STUB_SWATCHES.length],
    })),
  }

  return { content, capacity, cut: properties.slice(capacity), stubbed }
}

/** Иконок в превью нет: базу иконок разбирает арт-директор (B5), и до него их выбирать некому. */
function toProp(property: PreviewProperty): CardProp {
  return {
    label: property.label.trim() === '' ? undefined : property.label.trim(),
    value: property.value.trim() === '' ? undefined : property.value.trim(),
  }
}

function svgRef(body: string, width: number, height: number): ImageRef {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`
  return { dataUri: `data:image/svg+xml;base64,${btoa(svg)}`, width, height }
}
