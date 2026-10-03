/**
 * Чем наполняется макет на настоящей сборке — шаг B7.2 плана
 * [`card-assembly-pipeline_2026-08-31.md`](../../../../planning/active/card-assembly-pipeline_2026-08-31.md).
 *
 * **Тот же разбор, что у превью, но без рыбы.** Превью (`preview.ts`) ставит заглушки на всё,
 * чего продавец ещё не задал; здесь заглушек нет вовсе. Гнездо, которому нечем наполниться,
 * просто отсутствует, и его слой снимается правилом K-3 на сборке. Подзаголовок, плашку,
 * размеры и бренд заполнит арт-директор (шаг B5); до него честнее пустое место, чем выдумка.
 *
 * **Картинки в базу не пишутся.** Кадр вендора в data-URI — мегабайты, а `jsonb` с ними —
 * мегабайты на каждую строку `generation_cards`. Поэтому у содержимого две формы: рабочая
 * (`CardContent`, картинки внутри) и хранимая (`StoredContent`, вместо картинок — адрес в
 * хранилище). Пересборка (B7.5) переводит хранимую обратно функцией скачивания, которую ей
 * передают, — тот же приём, что `DownloadFile` в `renderer-assets.ts`: модуль остаётся без
 * ввода-вывода и проверяется без хранилища.
 */

import { mimeOf, readImageInfo } from '../image.ts'
import { propertyCapacity, usesCutout, usesLogo } from './features.ts'
import type { DownloadFile } from './renderer-assets.ts'
import type { CardContent, CardLayout, CardProp, ImageRef } from './types.ts'

export type FillingInput = {
  /** Заголовок карточки из `composeCard` — тот же, что ляжет в `title_of_card`. */
  title: string
  description: string
  /** Характеристики из B1 в порядке важности, подтверждённом продавцом. */
  properties: { label: string; value: string }[]
  frame: ImageRef
  cutout: ImageRef | null
  logo: ImageRef | null
}

export type CardFilling = {
  content: CardContent
  /** Хвост списка сверх ёмкости макета — того, чего в кадре не будет. */
  cut: CardProp[]
}

/** Картинка в хранилище вместо самой картинки. Размер — справка для чтения из базы без
 *  скачивания (пересборка, B7.5); при восстановлении он берётся из самого файла. */
export type StoredImage = { bucket: string; path: string; width: number; height: number }

export type StoredContent = Omit<CardContent, 'frames' | 'cutout' | 'logo'> & {
  frames?: StoredImage[]
  cutout?: StoredImage
  logo?: StoredImage
}

/** Кадр и вырез лежат в результатах генерации, знак — в загрузках продавца. */
export type StoredPaths = { frames: string[]; cutout?: string; logo?: string }

const RESULTS_BUCKET = 'results'
const UPLOADS_BUCKET = 'uploads'

export function cardFilling(layout: CardLayout, input: FillingInput): CardFilling {
  const capacity = propertyCapacity(layout)
  const properties = input.properties
    .map(toProp)
    .filter((property) => property.label !== undefined || property.value !== undefined)

  return {
    content: {
      // Вендор отдаёт один кадр. Слои второго кадра снимаются правилом K-3 — это штатно,
      // а не потеря: детальный снимок появится, когда его будет кому заказать.
      frames: [input.frame],
      cutout: input.cutout !== null && usesCutout(layout) ? input.cutout : undefined,
      logo: input.logo !== null && usesLogo(layout) ? input.logo : undefined,
      texts: { title: [input.title], body: [input.description] },
      props: properties.slice(0, capacity),
      swatches: [],
    },
    cut: properties.slice(capacity),
  }
}

/**
 * Хранимая форма содержимого: картинки заменены адресами.
 *
 * Характеристики и образцы цвета пишутся как есть: иконок и картинок-образцов `cardFilling`
 * не ставит (их подберёт арт-директор B5). Появятся — у них появится и свой адрес здесь.
 */
export function storedContent(content: CardContent, paths: StoredPaths): StoredContent {
  const { frames, cutout, logo, ...rest } = content
  const stored: StoredContent = { ...rest }

  if (frames !== undefined) {
    stored.frames = frames.map((frame, index) =>
      storedImage(frame, RESULTS_BUCKET, paths.frames[index], `кадра ${index + 1}`)
    )
  }
  if (cutout !== undefined) stored.cutout = storedImage(cutout, RESULTS_BUCKET, paths.cutout, 'выреза')
  if (logo !== undefined) stored.logo = storedImage(logo, UPLOADS_BUCKET, paths.logo, 'знака')

  return stored
}

/** Обратный перевод для пересборки: адреса скачиваются и снова становятся картинками. */
export async function fromStored(stored: StoredContent, download: DownloadFile): Promise<CardContent> {
  const { frames, cutout, logo, ...rest } = stored
  // Размер берётся из самого файла, как и на сборке: запись в базе — справка, а не источник.
  const restore = async (image: StoredImage): Promise<ImageRef> =>
    imageRef(await download(image.bucket, image.path))

  const content: CardContent = { ...rest }
  if (frames !== undefined) content.frames = await Promise.all(frames.map(restore))
  if (cutout !== undefined) content.cutout = await restore(cutout)
  if (logo !== undefined) content.logo = await restore(logo)
  return content
}

/** Байты изображения → картинка для композиции. Формат и размер — по самому файлу. */
export function imageRef(bytes: Uint8Array): ImageRef {
  const info = readImageInfo(bytes)
  if (info === null) throw new Error('Изображение для сборки не распознано')

  // Кадр — сотни килобайт, а `String.fromCharCode` с таким числом аргументов переполняет
  // стек. Поэтому по кускам.
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }

  return { dataUri: `data:${mimeOf(info.format)};base64,${btoa(binary)}`, width: info.width, height: info.height }
}

/** Картинка → байты: вырез приходит из сервиса data-URI, а в хранилище ложится файлом. */
export function imageBytes(image: ImageRef): Uint8Array {
  const comma = image.dataUri.indexOf(',')
  if (!image.dataUri.startsWith('data:') || !image.dataUri.slice(0, comma).endsWith(';base64')) {
    throw new Error('Картинка не в форме base64 data-URI')
  }

  const binary = atob(image.dataUri.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function storedImage(image: ImageRef, bucket: string, path: string | undefined, what: string): StoredImage {
  if (path === undefined || path === '') throw new Error(`Не задан путь ${what} для записи содержимого`)
  return { bucket, path, width: image.width, height: image.height }
}

function toProp(property: { label: string; value: string }): CardProp {
  const label = property.label.trim()
  const value = property.value.trim()
  return { label: label === '' ? undefined : label, value: value === '' ? undefined : value }
}
