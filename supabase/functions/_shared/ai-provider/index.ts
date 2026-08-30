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

import { createAitunnelProvider } from './aitunnel.ts'
import { createStubProvider } from './stub.ts'
import type { AiProvider, ProviderProfile, ProviderUsage } from './types.ts'

export type {
  AiProvider,
  CardTexts,
  GeneratedImage,
  Moderated,
  OutputProfile,
  ProductBrief,
  ProviderProfile,
  ProviderUsage,
  Recognized,
} from './types.ts'

/** Заглушка — умолчание, а не запасной путь: пока вендора нет, это единственный вариант. */
const DEFAULT_PROVIDER = 'stub'

export function providerProfile(): ProviderProfile {
  return {
    // `||`, а не `??`: локальный стенд объявляет эти секреты подстановкой `env(...)` из
    // окружения, и незаданная переменная приезжает **пустой строкой**, а не `undefined`.
    // С `??` пустая строка прошла бы дальше и уронила `createProvider` на «неизвестный
    // провайдер» — то есть разработка без ключа перестала бы работать вовсе.
    name: Deno.env.get('AI_PROVIDER') || DEFAULT_PROVIDER,
    baseUrl: Deno.env.get('AI_PROVIDER_BASE_URL') ?? null,
    imageModel: Deno.env.get('AI_PROVIDER_IMAGE_MODEL') ?? null,
    imageModelFallback: Deno.env.get('AI_PROVIDER_IMAGE_MODEL_FALLBACK') || null,
    imageSizes: Deno.env.get('AI_PROVIDER_IMAGE_SIZES') || null,
    imageSizesFallback: Deno.env.get('AI_PROVIDER_IMAGE_SIZES_FALLBACK') || null,
    textModel: Deno.env.get('AI_PROVIDER_TEXT_MODEL') ?? null,
  }
}

/**
 * Реализация провайдера под текущий профиль.
 *
 * Неизвестное имя — это отказ, а не тихий откат на заглушку: незамеченная опечатка в
 * `AI_PROVIDER` на проде означала бы, что пользователи платят баллами за плейсхолдеры.
 *
 * **`onUsage`** — необязательный побочный канал себестоимости (шаг 4 плана вехи M5): вызовы
 * пяти операций контракта возвращают только домен (`Recognized`, `CardTexts`…), а не деньги
 * и не время, поэтому колбэк передаётся сюда, а не в саму операцию. Заглушка тоже его
 * вызывает — нулевой ценой, но той же формой записи, чтобы путь записи в БД проверялся на
 * local и в тестах, а не только на живом вендоре.
 */
export function createProvider(
  profile: ProviderProfile = providerProfile(),
  onUsage?: (usage: ProviderUsage) => void,
): AiProvider {
  if (profile.name === 'stub') return createStubProvider(onUsage)
  if (profile.name === 'aitunnel') return createAitunnelProvider(profile, onUsage)

  throw new Error(
    `Неизвестный AI-провайдер: ${profile.name}. Известны: stub, aitunnel`,
  )
}
