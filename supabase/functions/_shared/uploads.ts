/**
 * Пределы входных фото (FR-02, US-E1).
 *
 * **Лежит рядом с `pricing.ts` и по той же причине:** значение обязано совпадать у клиента
 * и у сервера, а две копии одной цифры расходятся — вопрос времени. Клиент подключает файл
 * алиасом `@shared` и проверяет файл до отправки, чтобы человек узнал о проблеме сразу, а
 * не после десяти мегабайт аплоада. Бакет `uploads` держит те же пределы последним рубежом
 * (миграция `20260829120000_storage.sql`) — мимо интерфейса его не обойти.
 *
 * Цифры взяты **от требований маркетплейсов**, а не выдуманы: 10 МБ — общий предел всех
 * трёх площадок, набор форматов — их пересечение. Решение пользователя 2026-08-29
 * (docs/TZ.md §11); обоснование и источники — `planning/reference/MARKETPLACE_IMAGE_REQUIREMENTS.md`.
 * Принимать файл, который заведомо не пройдёт ни на одной площадке, смысла нет.
 */

/** До четырёх фото с разных сторон (FR-02). Ограничение на ВХОД, не на выход. */
export const MAX_PHOTOS = 4

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const

/** Как форматы называются человеку — в подписи под зоной загрузки и в тексте отказа. */
export const ACCEPTED_FORMATS_HUMAN = 'JPG, PNG, WebP или HEIC'

export const MAX_PHOTO_HUMAN = '10 МБ'

export type RejectedPhoto = { name: string; reason: string }

/**
 * Почему файл не подошёл — текстом для человека, а не кодом ошибки (US-E1: «назвать
 * допустимые форматы и предельный размер»). `null` — файл принят.
 */
export function rejectPhoto(file: { name: string; type: string; size: number }): string | null {
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return `такой формат не принимаем. Подойдут ${ACCEPTED_FORMATS_HUMAN}`
  }

  if (file.size > MAX_PHOTO_BYTES) {
    const megabytes = Math.round((file.size / 1024 / 1024) * 10) / 10
    return `${megabytes} МБ, это больше предела в ${MAX_PHOTO_HUMAN}. Уменьшите файл и попробуйте снова`
  }

  return null
}
