/**
 * Формат и размер готового изображения — по содержимому файла, а не по тому, что о нём
 * сказал отправитель.
 *
 * **Зачем понадобилось на M5.** До живого вендора выход был всегда наш собственный JPEG из
 * `jpeg.ts`, и одного `readJpegSize` хватало. Настоящий вендор отдаёт формат на своё
 * усмотрение: на семи одинаковых запросах шлюз AITunnel вернул JPEG трижды и PNG четырежды
 * (`supported_output_formats` у моделей Gemini пуст — выбора он не даёт). Проверять файл
 * против требований площадки (FR-25) можно, только сначала узнав, что это за файл.
 *
 * **Читаем сами, а не библиотекой.** Зависимостей в Edge Functions нет намеренно — см.
 * шапку `jpeg.ts` и запись B9 в `planning/BACKLOG.md`. Здесь и не нужно: размер лежит в
 * заголовке, распаковывать пиксели незачем.
 */

import { readJpegSize } from './jpeg.ts'

/** Формат в тех же словах, что и `marketplace_profiles.formats`, а не как MIME-тип:
 *  сравнивать предстоит именно со справочником площадки. */
export type ImageFormat = 'jpeg' | 'png' | 'webp'

export type ImageInfo = { format: ImageFormat; width: number; height: number }

const MIME: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export function mimeOf(format: ImageFormat): string {
  return MIME[format]
}

/** Размер PNG лежит в IHDR — он обязан идти первым чанком сразу за подписью. */
function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Размер WebP формы VP8X: у простых VP8/VP8L раскладка другая, и её здесь нет намеренно —
 *  вендор WebP не отдаёт, а гадать про формат, которого мы не видели, значит писать
 *  непроверенный код. Не распознали — честный `null`, и вызывающий отвергает файл. */
function readWebpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || bytes[12] !== 0x56 || bytes[13] !== 0x50 || bytes[14] !== 0x38 ||
      bytes[15] !== 0x58) {
    return null
  }

  // Ширина и высота записаны как «минус один» в трёх байтах, младшим вперёд.
  const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
  const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
  return { width, height }
}

/** Формат по магическим байтам. Расширению файла и заголовку `Content-Type` здесь верить
 *  нельзя: изображение приходит потоком байт из чужого API. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'png'
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp'
  }

  return null
}

/** Формат и размер разом. `null` — файл не распознан или заголовок битый; для вызывающего
 *  это отказ, а не повод подставить умолчание. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  const format = sniffImageFormat(bytes)
  if (format === null) return null

  const size = format === 'jpeg'
    ? readJpegSize(bytes)
    : format === 'png'
      ? readPngSize(bytes)
      : readWebpSize(bytes)

  return size === null ? null : { format, width: size.width, height: size.height }
}
