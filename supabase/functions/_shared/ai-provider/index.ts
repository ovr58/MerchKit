/**
 * Точка входа модуля `ai-provider`: выбор реализации по профилю из конфигурации.
 *
 * **Ни базового URL, ни имён моделей в коде** (требование шага 4 плана вехи M4 и
 * docs/SPEC.md §5). Здесь есть только имена переменных окружения; что в них лежит — дело
 * окружения. На M5, когда вендор выберут, меняется профиль и добавляется один файл рядом
 * со `stub.ts` — этот выбор и всё, что выше по стеку, не трогается.
 *
 * Ключ провайдера читается **только** внутри Edge Function и никогда не бывает
 * `VITE_*`-переменной: всё с этим префиксом попадает в браузерный бандл.
 */

import { createStubProvider } from './stub.ts'
import type { AiProvider, ProviderProfile } from './types.ts'

export type {
  AiProvider,
  CardTexts,
  GeneratedImage,
  OutputProfile,
  ProductBrief,
  ProviderProfile,
  Recognized,
} from './types.ts'

/** Заглушка — умолчание, а не запасной путь: пока вендора нет, это единственный вариант. */
const DEFAULT_PROVIDER = 'stub'

export function providerProfile(): ProviderProfile {
  return {
    name: Deno.env.get('AI_PROVIDER') ?? DEFAULT_PROVIDER,
    baseUrl: Deno.env.get('AI_PROVIDER_BASE_URL') ?? null,
    imageModel: Deno.env.get('AI_PROVIDER_IMAGE_MODEL') ?? null,
    textModel: Deno.env.get('AI_PROVIDER_TEXT_MODEL') ?? null,
  }
}

/**
 * Реализация провайдера под текущий профиль.
 *
 * Неизвестное имя — это отказ, а не тихий откат на заглушку: незамеченная опечатка в
 * `AI_PROVIDER` на проде означала бы, что пользователи платят баллами за плейсхолдеры.
 */
export function createProvider(profile: ProviderProfile = providerProfile()): AiProvider {
  if (profile.name === 'stub') return createStubProvider()

  throw new Error(
    `Неизвестный AI-провайдер: ${profile.name}. Реализация подставляется на вехе M5 (ADR-0005)`,
  )
}
