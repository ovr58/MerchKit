/**
 * Реализация `AiProvider` через шлюз AITunnel (docs/SPEC.md §5, решение шага 0 вехи M5).
 *
 * **OpenAI-совместимый HTTP.** Текстовые операции (`moderate`, `recognize`, `composeCard`,
 * `nameGeneration`) идут на `POST {baseUrl}/chat/completions` дешёвой моделью
 * `AI_PROVIDER_TEXT_MODEL`; изображения — на `POST {baseUrl}/images/generations` моделью
 * `AI_PROVIDER_IMAGE_MODEL`. Контракт сверен по сырому JSON публичного каталога шлюза
 * 2026-08-29 (план вехи M5, шаг 0): референсные фото — полем `input_references` с
 * `data:`-URL, а не отдельной загрузкой файла; ключ — заголовком `Authorization: Bearer`.
 *
 * **Пять операций контракта — пять независимых вызовов шлюза**, не один составной запрос:
 * это то же решение ADR-0005, что и у заглушки — частичный неуспех (изображение получено,
 * тексты нет) обязан остаться различимым, а не потеряться внутри одного ответа.
 *
 * **Незакрытый риск, найденный при написании этого файла.** У `generateImages` каталог
 * шлюза даёт только *бакеты* разрешения (`512`/`1K`/`2K`/`4K`) и соотношение сторон — не
 * произвольные пиксели. Профиль площадки (FR-25) требует **точный** `width`×`height`
 * (1200×1600 или 1600×1600), и `generation-worker` уже сверяет это равенством без допуска
 * (`readJpegSize`, M4). Совпадёт ли бакет+аспект с нужными пикселями 1-в-1 — неизвестно без
 * реального вызова: это первое, что покажет шаг 2 (прогон на живом вендоре). Если не
 * совпадёт, `generateImages` бросает диагностическую ошибку с фактическими и ожидаемыми
 * размерами вместо тихой подгонки — решать (донастройка параметров запроса, или отдельный
 * шаг ресэмплинга, которого в проекте сейчас нет) предстоит по факту первого прогона, не
 * здесь.
 */

import { readJpegSize } from '../jpeg.ts'
import type { GenerationKind } from '../pricing.ts'
import { CATEGORY_IDS, CATEGORY_TITLES } from './categories.ts'
import type {
  AiProvider,
  CardTexts,
  GeneratedImage,
  Moderated,
  OutputProfile,
  ProductBrief,
  ProviderProfile,
  Recognized,
} from './types.ts'

const CHAT_TIMEOUT_MS = 20_000
const IMAGE_TIMEOUT_MS = 60_000

type Config = { apiKey: string; baseUrl: string; imageModel: string; textModel: string }

/** Читается на каждый вызов, а не один раз при создании: секрет может обновиться без передеплоя. */
function requireConfig(profile: ProviderProfile): Config {
  const apiKey = Deno.env.get('AI_PROVIDER_API_KEY')
  if (!apiKey) throw new Error('Не задана переменная окружения AI_PROVIDER_API_KEY')
  if (!profile.baseUrl) throw new Error('Не задана переменная окружения AI_PROVIDER_BASE_URL')
  if (!profile.imageModel) throw new Error('Не задана переменная окружения AI_PROVIDER_IMAGE_MODEL')
  if (!profile.textModel) throw new Error('Не задана переменная окружения AI_PROVIDER_TEXT_MODEL')

  return { apiKey, baseUrl: profile.baseUrl, imageModel: profile.imageModel, textModel: profile.textModel }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000 // выше — падает на call stack size exceeded на спреде в String.fromCharCode.
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, Math.min(at + chunk, bytes.length)))
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
  return bytes
}

/** По магическим байтам, не по расширению — файл пришёл как поток байт без имени. */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** Входные фото уже прошли проверку формата на загрузке (`uploads.ts`) — не распознали, значит
 *  редкий формат из того же принятого набора (HEIC/HEIF), а не мусор. JPEG как ярлык безопасен:
 *  это только подпись `data:`-URL, шлюз читает содержимое сам. */
function inputDataUri(photo: Uint8Array): string {
  return `data:${sniffImageType(photo) ?? 'image/jpeg'};base64,${toBase64(photo)}`
}

function imageContentParts(photos: Uint8Array[]): unknown[] {
  return photos.map((photo) => ({ type: 'image_url', image_url: { url: inputDataUri(photo) } }))
}

/** Модель иногда оборачивает JSON в ```-заборы, несмотря на `response_format`. */
function parseJsonObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed: unknown = JSON.parse(stripped)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('ответ не является JSON-объектом')
  return parsed as Record<string, unknown>
}

async function callGateway(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const payload = await response.text()

  if (!response.ok) {
    throw new Error(`AITunnel HTTP ${response.status}: ${payload.slice(0, 500)}`)
  }

  try {
    return JSON.parse(payload)
  } catch {
    throw new Error(`AITunnel вернул не JSON: ${payload.slice(0, 200)}`)
  }
}

/** Один вызов `chat/completions` с требованием строгого JSON-объекта в ответе. */
async function chatJson(
  config: Config,
  systemPrompt: string,
  userContent: string | unknown[],
): Promise<Record<string, unknown>> {
  const started = Date.now()

  const result = await callGateway(`${config.baseUrl}/chat/completions`, config.apiKey, {
    model: config.textModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  }, CHAT_TIMEOUT_MS)

  const text = result?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('AITunnel: текстовая модель вернула пустой ответ')
  }

  console.info(
    'AITunnel', config.textModel, Date.now() - started, 'мс',
    'cost_rub', result?.usage?.cost_rub ?? '?',
  )

  return parseJsonObject(text)
}

const MODERATION_SYSTEM_PROMPT =
  'Ты модерируешь фотографии, которые продавцы загружают для генерации карточек товара ' +
  'интернет-магазина. Отклоняй, только если на фото есть откровенно сексуальный контент, ' +
  'крайнее насилие или жестокость, страдающие люди или животные, оружие в угрожающем ' +
  'контексте, символика терроризма или экстремизма, материалы сексуальной эксплуатации ' +
  'несовершеннолетних, либо явно нелегальные товары (наркотики, оружие вне легального ' +
  'оборота). Обычное фото товара — одежда, техника, еда, косметика, мебель, аксессуары — ' +
  'всегда разрешено, включая фирменные логотипы и упаковку на товаре: это не проверка на ' +
  'контрафакт. Ответь строго JSON без пояснений: ' +
  '{"allowed": true|false, "reason": "кратко почему, если false"}.'

const RECOGNIZE_SYSTEM_PROMPT =
  'Ты помогаешь продавцу маркетплейса оформить карточку товара по фото. Определи категорию ' +
  'товара строго из перечня ниже (в ответе — id слева, не название): ' +
  Object.entries(CATEGORY_TITLES).map(([id, title]) => `${id} — ${title}`).join('; ') +
  '. Если по фото нельзя уверенно определить товар — верни null в обоих полях, это ожидаемый ' +
  'исход, не ошибка. productTitle — короткое наименование на русском для карточки (2–5 слов), ' +
  'не описание. Ответь строго JSON: {"categoryId": "<id из перечня или null>", "productTitle": ' +
  '"<наименование или null>"}.'

const NAME_GENERATION_SYSTEM_PROMPT =
  'Придумай короткое название генерации для каталога пользователя — по нему человек должен ' +
  'узнать генерацию в списке, не открывая её. 3–6 слов, без кавычек и точки в конце. Ответь ' +
  'строго JSON: {"title": "..."}.'

const COMPOSE_CARD_SYSTEM_PROMPT =
  'Ты пишешь заголовок и описание карточки товара для маркетплейса. Заголовок — до 100 ' +
  'символов, точный и по делу, без капслока и лишних восклицаний. Описание — 2–4 предложения: ' +
  'что за товар и чем полезен, без воды и без придуманных характеристик, которых не было в ' +
  'исходных данных от продавца. Ответь строго JSON: {"title": "...", "description": "..."}.'

function composeCardPrompt(product: ProductBrief, profile: OutputProfile): string {
  return [
    `Площадка: ${profile.marketplaceTitle}.`,
    `Товар: ${product.title}, категория «${product.categoryTitle}».`,
    product.description.trim() === '' ? '' : `Что известно от продавца: ${product.description.trim()}.`,
    product.presetTitle === null ? '' : `Сценарий показа: ${product.presetTitle}.`,
    product.wishes.trim() === '' ? '' : `Пожелания продавца: ${product.wishes.trim()}.`,
  ].filter((line) => line !== '').join(' ')
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** `profile.aspectLabel` — для человека, формат `"3 : 4"` с пробелами (миграция таксономии).
 *  Шлюзу нужен компактный `"3:4"` из собственного перечня `supported_aspect_ratios`. */
function aspectRatioParam(profile: OutputProfile): string {
  const divisor = gcd(profile.width, profile.height)
  return `${profile.width / divisor}:${profile.height / divisor}`
}

/** Каталог шлюза даёт только бакеты, не пиксели — см. риск в шапке файла. Берём бакет не
 *  меньше длинной стороны профиля, чтобы не апскейлить с потерей резкости. */
function resolutionParam(profile: OutputProfile): string {
  const longEdge = Math.max(profile.width, profile.height)
  if (longEdge <= 512) return '512'
  if (longEdge <= 1024) return '1K'
  if (longEdge <= 2048) return '2K'
  return '4K'
}

function imagePrompt(product: ProductBrief, profile: OutputProfile, kind: GenerationKind): string {
  const scenario = product.presetPrompt ?? product.wishes.trim()
  const scenarioLine = scenario === ''
    ? 'Сцена показа — на усмотрение, товар должен быть виден полностью и чётко.'
    : `Сценарий показа: ${scenario}.`

  const layoutLine = kind === 'card'
    ? `Это карточка маркетплейса: помимо товара на изображении нужен аккуратный текстовый ` +
      `блок с названием «${product.title}» и кратким описанием, оформленный как обложка ` +
      'карточки товара — не поверх самого товара.'
    : 'Это витринное фото без текста и вёрстки — ничего, кроме товара на фоне, не рисовать.'

  return [
    `Товар: ${product.title} (категория «${product.categoryTitle}»).`,
    product.description.trim() === '' ? '' : `Описание: ${product.description.trim()}.`,
    scenarioLine,
    layoutLine,
    'Тот же товар, что на приложенных референсных фото — не заменять другим предметом, ' +
      'сохранить форму, цвет, надписи и логотипы, число объектов не менять.',
    `Кадр строго ${aspectRatioParam(profile)}, фон ${profile.backgroundTitle} ` +
      `(${profile.backgroundHex}), товар не обрезан по краю кадра.`,
  ].filter((line) => line !== '').join(' ')
}

export function createAitunnelProvider(providerProfile: ProviderProfile): AiProvider {
  return {
    async moderate(photos: Uint8Array[]): Promise<Moderated> {
      // Контракт (types.ts): пустой список проходит тривиально — проверять нечего.
      if (photos.length === 0) return { allowed: true }

      const config = requireConfig(providerProfile)
      const verdict = await chatJson(config, MODERATION_SYSTEM_PROMPT, [
        { type: 'text', text: 'Проверь приложенные фотографии.' },
        ...imageContentParts(photos),
      ])

      if (typeof verdict.allowed !== 'boolean') {
        throw new Error('AITunnel: модерация вернула ответ неожиданного формата')
      }

      return {
        allowed: verdict.allowed,
        reason: typeof verdict.reason === 'string' ? verdict.reason : undefined,
      }
    },

    async recognize(photos: Uint8Array[]): Promise<Recognized> {
      const config = requireConfig(providerProfile)
      const parsed = await chatJson(config, RECOGNIZE_SYSTEM_PROMPT, [
        { type: 'text', text: 'Определи товар по приложенным фото.' },
        ...imageContentParts(photos),
      ])

      // Категория вне перечня — NULL, а не значение наружу (шаг 3 плана вехи M5, US-E2).
      const categoryId = typeof parsed.categoryId === 'string' && CATEGORY_IDS.includes(parsed.categoryId)
        ? parsed.categoryId
        : null

      const productTitle = typeof parsed.productTitle === 'string' ? parsed.productTitle.trim() : ''

      return { categoryId, productTitle: productTitle === '' ? null : productTitle }
    },

    async generateImages({ photos, product, profile, kind, objects }): Promise<GeneratedImage[]> {
      const config = requireConfig(providerProfile)
      const images: GeneratedImage[] = []

      for (let index = 0; index < objects; index++) {
        const started = Date.now()

        const result = await callGateway(`${config.baseUrl}/images/generations`, config.apiKey, {
          model: config.imageModel,
          prompt: imagePrompt(product, profile, kind),
          input_references: imageContentParts(photos),
          resolution: resolutionParam(profile),
          aspect_ratio: aspectRatioParam(profile),
          response_format: 'b64_json',
        }, IMAGE_TIMEOUT_MS)

        const item = result?.data?.[0]
        const encoded: string | null =
          typeof item?.b64_json === 'string'
            ? item.b64_json
            : typeof item?.url === 'string' && item.url.startsWith('data:')
              ? item.url.slice(item.url.indexOf(',') + 1)
              : null

        if (encoded === null) {
          throw new Error('AITunnel: изображение не получено')
        }

        const bytes = fromBase64(encoded)
        const contentType = sniffImageType(bytes)

        console.info(
          'AITunnel', config.imageModel, Date.now() - started, 'мс',
          'cost_rub', result?.usage?.cost_rub ?? '?',
          'запрошено', `${profile.width}×${profile.height}`,
        )

        if (contentType !== 'image/jpeg') {
          throw new Error(
            `AITunnel вернул ${contentType ?? 'нераспознанный формат'} вместо JPEG — профиль ` +
              'площадки требует JPEG (FR-25)',
          )
        }

        const size = readJpegSize(bytes)

        if (size === null || size.width !== profile.width || size.height !== profile.height) {
          throw new Error(
            `AITunnel вернул изображение ${size?.width ?? '?'}×${size?.height ?? '?'} вместо ` +
              `${profile.width}×${profile.height} — см. риск в шапке aitunnel.ts`,
          )
        }

        images.push({ bytes, contentType, width: size.width, height: size.height })
      }

      return images
    },

    async composeCard({ product, profile }): Promise<CardTexts> {
      const config = requireConfig(providerProfile)
      const parsed = await chatJson(
        config,
        COMPOSE_CARD_SYSTEM_PROMPT,
        composeCardPrompt(product, profile),
      )

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''

      if (title === '' || description === '') {
        throw new Error('AITunnel: тексты карточки не получены')
      }

      return { title, description }
    },

    async nameGeneration({ product }): Promise<string> {
      const config = requireConfig(providerProfile)
      const scenario = product.presetTitle === null ? '' : `, сценарий: ${product.presetTitle}`
      const parsed = await chatJson(
        config,
        NAME_GENERATION_SYSTEM_PROMPT,
        `Товар: ${product.title}${scenario}.`,
      )

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      if (title === '') throw new Error('AITunnel: название генерации не получено')

      return title
    },
  }
}
