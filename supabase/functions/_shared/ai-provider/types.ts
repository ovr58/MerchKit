/**
 * Контракт модуля `ai-provider` (docs/SPEC.md §3, [ADR-0005](../../../../docs/adr/0005-ai-provider-abstraction.md)).
 *
 * **Вендор не выбран, и код о нём не знает.** Здесь описано только то, что нужно продукту:
 * четыре независимые операции. Ни базового URL, ни имён моделей, ни формата запроса в этих
 * типах нет и быть не должно — они приезжают профилем провайдера из конфигурации, чтобы на
 * M5 менялся профиль, а не файлы.
 *
 * Операции независимы намеренно: «получилось изображение, но не получились тексты карточки»
 * — реальный исход, и веха обязана его отработать полным возвратом (US-E4). Слепи мы их в
 * один вызов, этот случай стал бы неотличим от полного отказа и необрабатываемым.
 */

import type { GenerationKind } from '../pricing.ts'

/**
 * Параметры конечного изображения для пары «маркетплейс × категория» (FR-25, ТЗ §5.2).
 *
 * Уходит **в запрос** к провайдеру, а не применяется после него: фон рисуется вместе с
 * кадром, а не подкладывается постобработкой (решение шага 0 вехи M4).
 */
export type OutputProfile = {
  marketplaceId: string
  marketplaceTitle: string
  categoryId: string
  width: number
  height: number
  aspectLabel: string
  format: string
  colorSpace: string
  backgroundHex: string
  backgroundTitle: string
}

/** Что за товар и как его показать — всё, что мастер собрал за шесть шагов. */
export type ProductBrief = {
  title: string
  description: string
  categoryTitle: string
  /** Промпт выбранного сценария показа. NULL у категории «Прочее» (FR-08). */
  presetPrompt: string | null
  presetTitle: string | null
  /** Свободные пожелания (FR-09). Для «Прочего» — единственный способ задать сценарий. */
  wishes: string
}

export type GeneratedImage = {
  bytes: Uint8Array
  contentType: string
  width: number
  height: number
}

/** Результат распознавания. NULL в любом поле — штатный исход US-E2, а не ошибка. */
export type Recognized = {
  categoryId: string | null
  productTitle: string | null
}

export type CardTexts = {
  title: string
  description: string
}

export interface AiProvider {
  /** FR-03, FR-04: категория и наименование по фото. Не смог — вернуть NULL (US-E2). */
  recognize(photos: Uint8Array[]): Promise<Recognized>

  /** FR-25: изображения строго по профилю — кадр, разрешение, формат и фон. */
  generateImages(input: {
    photos: Uint8Array[]
    product: ProductBrief
    profile: OutputProfile
    /** «Карточка» — это изображение С ВЁРСТКОЙ поверх фото (FR-07), а не то же самое фото. */
    kind: GenerationKind
    objects: number
  }): Promise<GeneratedImage[]>

  /** FR-07: заголовок и описание карточки. Только для типа «карточка». */
  composeCard(input: { product: ProductBrief; profile: OutputProfile }): Promise<CardTexts>

  /** FR-16: название генерации для каталога — список из «Генерация №17» нечитаем. */
  nameGeneration(input: { product: ProductBrief }): Promise<string>
}

/**
 * Профиль провайдера — то, что отличает одного вендора от другого, вынесенное в
 * конфигурацию (docs/SPEC.md §5). В коде остаются только имена переменных окружения.
 */
export type ProviderProfile = {
  name: string
  baseUrl: string | null
  imageModel: string | null
  textModel: string | null
}
