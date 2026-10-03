/**
 * Соответствие готового файла требованиям площадки (FR-25).
 *
 * **Правило живёт в одном файле, потому что применяют его двое.** Провайдер проверяет свой
 * же выход, чтобы упасть сразу и с внятной диагностикой, а `generation-worker` — потому что
 * верить на слово нельзя: файл не по требованиям площадки это файл, за который пользователь
 * заплатил зря. Две копии одного правила разъезжаются — ровно эту ошибку `pricing.ts` обходит
 * одним файлом на клиента и сервер.
 *
 * **Размер — точное совпадение с целевым кадром профиля.** Карточку собирает наш сборщик в
 * пикселях профиля ([ADR-0012](../../../docs/adr/0012-card-layout-is-ours-not-vendors.md)),
 * поэтому порог «не ниже» и допуск по соотношению сторон больше не оправданы: размер задаём
 * мы. Целевой кадр профиля подобран под бакет вендора (миграция 20260829140000), поэтому и
 * кадр вендора обязан прийти ровно в нём.
 */

import { readImageInfo } from './image.ts'
import type { OutputProfile } from './ai-provider/types.ts'

/**
 * Возвращает описание несоответствия или `null`, если файл площадке подходит.
 *
 * Строка предназначена нашим логам и `failure_reason`, а не пользователю: наружу US-E4
 * показывает возврат баллов, а не устройство вендора.
 */
export function describeProfileMismatch(bytes: Uint8Array, profile: OutputProfile): string | null {
  const info = readImageInfo(bytes)

  if (info === null) {
    return 'формат готового файла не распознан'
  }

  if (!profile.formats.includes(info.format)) {
    return `формат ${info.format} не принимается площадкой ${profile.marketplaceTitle} ` +
      `(принимаются: ${profile.formats.join(', ')})`
  }

  if (info.width !== profile.width || info.height !== profile.height) {
    return `размер ${info.width} × ${info.height} не совпадает с профилем ` +
      `${profile.width} × ${profile.height}`
  }

  if (bytes.length > profile.maxBytes) {
    return `файл ${(bytes.length / 1048576).toFixed(1)} МБ превышает предел площадки ` +
      `${(profile.maxBytes / 1048576).toFixed(0)} МБ`
  }

  return null
}
