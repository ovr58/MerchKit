/**
 * Размер, в который собирается карточка (шаг B7.7, решение Q-2, 2026-10-04).
 *
 * Сборка идёт в изоляте Edge Function с жёстким пределом 2 с процессорного времени, а
 * растеризация растёт с площадью кадра: замер показал, что профиль 1792 × 2400 (Ozon
 * «Одежда», «Аксессуары») собирает 1–2 макета из 34, а 896 × 1200 — 32–33. Поэтому профиль
 * площадью больше 896 × 1200 собирается в порог площадки (`min_width` × `min_height`): файл
 * по-прежнему принимается площадкой, а изолят успевает.
 *
 * Лежит в `_shared/`, потому что размер читают двое: воркер собирает в него, а мастер
 * показывает его в блоке «Каким получится файл» (клиент подключает алиасом `@shared`).
 * Зависимостей нет: файл собирается и Vite, и Deno.
 *
 * Снять при переезде сборки на коробку (ADR-0015): тогда карточка снова собирается в
 * `width` × `height` профиля, а функция становится тождественной.
 */

/** Предел по площади, который изолят успевает собрать: размер профиля по умолчанию. */
const LIMIT_AREA = 896 * 1200

export type CardSizeProfile = {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export function cardAssemblySize(profile: CardSizeProfile): { width: number; height: number } {
  return profile.width * profile.height > LIMIT_AREA
    ? { width: profile.minWidth, height: profile.minHeight }
    : { width: profile.width, height: profile.height }
}
