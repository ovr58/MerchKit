/**
 * Заглушка провайдера для local (веха M4).
 *
 * **Зачем она вообще есть.** Вендор не выбран ([ADR-0005](../../../../docs/adr/0005-ai-provider-abstraction.md)),
 * а весь сценарий US-01 — от загрузки фото до скачивания — должен работать целиком уже
 * сейчас. К моменту выбора остаётся подставить реализацию интерфейса, а не строить сценарий.
 *
 * **Три свойства, без которых заглушка бесполезна:**
 *
 * 1. *Детерминированность.* Один и тот же товар даёт один и тот же результат — иначе
 *    воспроизвести отчёт об ошибке невозможно.
 * 2. *Управляемая задержка* (`AI_STUB_DELAY_MS`). Без неё экран «идёт генерация» и
 *    восстановление статуса после F5 (NFR-02) нечем проверить: всё успевает до отрисовки.
 * 3. *Управляемый отказ.* Без него не воспроизвести ни US-E4, ни отдельный случай
 *    «изображение получено, текстов карточки нет», а он — приёмочный критерий вехи.
 *
 * **Как заказать отказ или неудачное распознавание.** Глобально — переменной окружения
 * `AI_STUB_FAILURE` (`images` · `card` · `all` · `moderation`). Точечно, на одну генерацию, —
 * префиксом в наименовании товара; так сценарий проходится руками и скриптом, не
 * перезапуская функции:
 *
 *   | Наименование товара начинается с | Что делает заглушка              | Сценарий |
 *   | -------------------------------- | -------------------------------- | -------- |
 *   | `СБОЙ-ТЕКСТЫ`                    | изображение есть, текстов нет    | US-E4    |
 *   | `СБОЙ`                           | провайдер не отвечает вовсе      | US-E4    |
 *
 * `moderate` вызывается ДО того, как заявка становится `ProductBrief` (решение шага 0 вехи
 * M5: отказ до списания в `generate`), и заголовка товара у него ещё нет — префиксом не
 * закажешь. Точечный крючок другой: первый байт любого фото — `0x00`. Ни один настоящий
 * JPEG/PNG/WebP так не начинается (JPEG — `0xFFD8`, PNG — `0x89504E47…`), так что подмена
 * безопасна и не пересекается с другими проверками.
 *
 * Распознавание не узнаёт товар (US-E2), если ни одно фото не дотягивает до 4 КБ: у
 * настоящего провайдера крошечная картинка — самая частая причина такого исхода, так что
 * правило заодно похоже на правду.
 *
 * Эти крючки живут **только здесь**. Сама заглушка с M5 не уезжает — она остаётся
 * умолчанием `local` (шаг 7 вехи): разработка не должна жечь бюджет живого вендора.
 *
 * **Изображение синтезируется по профилю, а не берётся из фикстур** (решение шага 0 вехи).
 * Кадр, разрешение и фон приходят из справочника прямо в кодировщик, поэтому файл попадает
 * в профиль FR-25 по построению — включая исключения Ozon: серый `#F2F3F5` для одежды и
 * квадрат для еды. Набор фикстур пришлось бы держать под каждую пару, и критерий «файл
 * соответствует параметрам пары» проверял бы не параметры, а то, что мы взяли нужный файл.
 */

import { blockCount, encodeBlockJpeg, type Rgb } from '../jpeg.ts'
import { CATEGORY_IDS } from './categories.ts'
import type {
  AiProvider,
  CardTexts,
  GeneratedImage,
  Moderated,
  OutputProfile,
  ProductBrief,
  ProductProperty,
  ProviderUsage,
  Recognized,
} from './types.ts'

const DEFAULT_DELAY_MS = 1200

const GUESSES: Record<string, string> = {
  clothing: 'Куртка-бомбер',
  accessories: 'Сумка через плечо',
  food: 'Кофе в зёрнах',
  beauty: 'Крем для рук',
  tech: 'Наушники накладные',
  home: 'Настольная лампа',
  other: 'Товар',
}

/** FNV-1a: короткая устойчивая хеш-функция, чтобы «случайное» было воспроизводимым. */
function hash(input: string): number {
  let value = 0x811c9dc5
  for (let at = 0; at < input.length; at++) {
    value ^= input.charCodeAt(at)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

function parseHex(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ]
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Failure = 'none' | 'images' | 'card' | 'all'

function requestedFailure(product: ProductBrief): Failure {
  const title = product.title.trim().toUpperCase()
  if (title.startsWith('СБОЙ-ТЕКСТЫ')) return 'card'
  if (title.startsWith('СБОЙ')) return 'all'

  const configured = Deno.env.get('AI_STUB_FAILURE')
  return configured === 'images' || configured === 'card' || configured === 'all'
    ? configured
    : 'none'
}

/**
 * `moderate` вызывается раньше, чем заявка становится `ProductBrief` — заголовка товара
 * ещё нет, крючком-префиксом не воспользоваться. Точечно — первый байт фото `0x00`
 * (см. шапку файла), глобально — тот же `AI_STUB_FAILURE`, но со значением `moderation`.
 */
function moderationRejected(photos: Uint8Array[]): boolean {
  if (photos.some((photo) => photo[0] === 0x00)) return true
  return Deno.env.get('AI_STUB_FAILURE') === 'moderation'
}

/** Детерминированный local-эквивалент: заглушка не знает фактов о товаре и ничего не сочиняет. */
function propertiesFromText(description: string, wishes: string): ProductProperty[] {
  const source = [description, wishes].filter((value) => value.trim() !== '').join(', ')

  return source
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [label, ...rest] = part.split(/[:—-]/, 2)
      const value = rest.join('').trim()
      return value === '' ? { label: '', value: label.trim() } : { label: label.trim(), value }
    })
}

/**
 * Рисует плейсхолдер: фон профиля, силуэт товара и — для карточки — вёрстку поверх фото,
 * как на референсах V-10. Координаты нормированы, поэтому одна и та же композиция ложится
 * и на вертикальный кадр 3 : 4, и на квадрат Ozon Fresh.
 */
function paint(profile: OutputProfile, seed: number, withLayout: boolean): Uint8Array {
  const background = parseHex(profile.backgroundHex)
  const ink: Rgb = [24, 24, 27]
  // Цвет товара — от наименования: разные товары обязаны выглядеть по-разному, иначе
  // на экране результата не видно, что заглушка вообще прочитала заявку.
  const product: Rgb = [
    80 + (seed & 0x5f),
    70 + ((seed >> 8) & 0x6f),
    70 + ((seed >> 16) & 0x6f),
  ]

  const wide = blockCount(profile.width)
  const high = blockCount(profile.height)

  return encodeBlockJpeg(profile.width, profile.height, (bx, by) => {
    const u = bx / wide
    const v = by / high

    // Вёрстка карточки: левая колонка с заголовком, выносами и размерным рядом.
    if (withLayout && u < 0.52) {
      if (v > 0.06 && v < 0.14 && u > 0.06 && u < 0.46) return ink
      if (v > 0.16 && v < 0.20 && u > 0.06 && u < 0.34) return mix(ink, background, 0.45)
      for (const line of [0.30, 0.38, 0.46]) {
        if (v > line && v < line + 0.03 && u > 0.06 && u < 0.40) return mix(ink, background, 0.25)
      }
      if (v > 0.86 && v < 0.92 && u > 0.06 && u < 0.42) return mix(ink, background, 0.6)
    }

    // Силуэт товара: скруглённый прямоугольник в правой половине кадра.
    const insideX = u > 0.40 && u < 0.86
    const insideY = v > 0.24 && v < 0.84
    if (insideX && insideY) {
      const corner = Math.min(u - 0.40, 0.86 - u) * 3 + Math.min(v - 0.24, 0.84 - v) * 3
      if (corner > 0.06) {
        // Лёгкий градиент сверху вниз: плоская заливка выглядит как сбой рендера.
        return mix(product, [255, 255, 255], 0.28 * (1 - (v - 0.24) / 0.60))
      }
    }

    // Мягкая тень под товаром — иначе объект висит в пустоте и кадр читается как ошибка.
    const shadow = (u - 0.55) ** 2 * 6 + (v - 0.90) ** 2 * 60
    if (shadow < 1) return mix(background, ink, 0.10 * (1 - shadow))

    return background
  })
}

/** Заглушка не тратит рубли, но пишет ту же форму записи — местный прогон упражняет
 *  весь путь `record_generation_costs`, не только живой вендор (шаг 4 плана вехи M5). */
function recordZeroCost(
  onUsage: ((usage: ProviderUsage) => void) | undefined,
  operation: ProviderUsage['operation'],
  durationMs: number,
): void {
  onUsage?.({ operation, vendor: 'stub', costRub: 0, durationMs })
}

export function createStubProvider(onUsage?: (usage: ProviderUsage) => void): AiProvider {
  const delay = Number(Deno.env.get('AI_STUB_DELAY_MS') ?? DEFAULT_DELAY_MS)

  return {
    async moderate(photos: Uint8Array[]): Promise<Moderated> {
      const started = Date.now()
      await wait(Math.min(delay, 300))
      recordZeroCost(onUsage, 'moderate', Date.now() - started)

      if (moderationRejected(photos)) {
        return { allowed: false, reason: 'заглушка: первый байт фото 0x00 либо AI_STUB_FAILURE=moderation' }
      }

      return { allowed: true }
    },

    async recognize(photos: Uint8Array[]): Promise<Recognized> {
      await wait(Math.min(delay, 900))

      // US-E2: разобрать нечего. Сценарий на этом не кончается — мастер просто попросит
      // указать категорию и наименование руками.
      const largest = Math.max(0, ...photos.map((photo) => photo.byteLength))
      if (largest < 4096) return { categoryId: null, productTitle: null }

      const seed = hash(`${photos.length}:${largest}`)
      const categoryId = CATEGORY_IDS[seed % CATEGORY_IDS.length]
      return { categoryId, productTitle: GUESSES[categoryId] }
    },

    async extractProductProperties({ description, wishes }): Promise<ProductProperty[]> {
      await wait(Math.min(delay, 300))
      return propertiesFromText(description, wishes)
    },

    async generateImages({ product, profile, kind, objects }): Promise<GeneratedImage[]> {
      const failure = requestedFailure(product)
      const seed = hash(`${product.title}|${product.presetPrompt ?? product.wishes}`)

      const images: GeneratedImage[] = []
      for (let index = 0; index < objects; index++) {
        const started = Date.now()
        await wait(delay)

        if (failure === 'images' || failure === 'all') {
          recordZeroCost(onUsage, 'generateImages', Date.now() - started)
          throw new Error('Заглушка провайдера: изображение не получено')
        }

        recordZeroCost(onUsage, 'generateImages', Date.now() - started)
        images.push({
          bytes: paint(profile, seed + index * 7919, kind === 'card'),
          contentType: 'image/jpeg',
          width: profile.width,
          height: profile.height,
        })
      }

      return images
    },

    async composeCard({ product, profile }): Promise<CardTexts> {
      const started = Date.now()
      await wait(Math.min(delay, 600))
      recordZeroCost(onUsage, 'composeCard', Date.now() - started)

      const failure = requestedFailure(product)
      if (failure === 'card' || failure === 'all') {
        throw new Error('Заглушка провайдера: тексты карточки не получены')
      }

      const detail = product.description.trim()

      return {
        title: `${product.title} — ${product.categoryTitle.toLowerCase()}`,
        description: detail === ''
          ? `${product.title}. Сценарий «${product.presetTitle ?? 'по вашим пожеланиям'}», кадр ${profile.aspectLabel} под требования площадки ${profile.marketplaceTitle}.`
          : detail,
      }
    },

    async nameGeneration({ product }): Promise<string> {
      const started = Date.now()
      await wait(Math.min(delay, 300))
      recordZeroCost(onUsage, 'nameGeneration', Date.now() - started)

      const failure = requestedFailure(product)
      if (failure === 'all') {
        throw new Error('Заглушка провайдера: название не получено')
      }

      return product.presetTitle === null
        ? product.title
        : `${product.title}, ${product.presetTitle.toLowerCase()}`
    },
  }
}
