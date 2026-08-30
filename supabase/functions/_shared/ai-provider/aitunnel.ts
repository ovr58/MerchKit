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
 * **Риск бакетов — закрыт прогоном 2026-08-29.** Опасение из первой редакции файла
 * подтвердилось: шлюз принимает не пиксели, а *бакеты* разрешения (`512`/`1K`/`2K`/`4K`)
 * плюс соотношение сторон, и точного `width`×`height` не даст никакая его модель. Формат
 * он выбирает сам — на семи одинаковых запросах вернул JPEG трижды и PNG четырежды.
 * Решение принято не здесь, а в профиле площадки: он теперь описан порогом и допустимыми
 * форматами, как их формулируют сами площадки (миграция `20260829140000`), а сверка вынесена
 * в общий `output-profile.ts` — одно правило на провайдера и воркер.
 *
 * **Уточнено ADR-0011: бакеты — не свойство шлюза, а свойство модели.** Модели OpenAI на том
 * же шлюзе бакетов не принимают вовсе и требуют размер в пикселях (`size`); у `gpt-image-2`
 * в каталоге шлюза оба списка — `supported_resolutions` и `supported_aspect_ratios` — пусты.
 * Поэтому форма запроса выбирается по конфигурации модели (`AI_PROVIDER_IMAGE_SIZES`), а не
 * зашита одна на вендора. Наружу интерфейса `ai-provider` это не протекает: профиль площадки
 * по-прежнему говорит порогом и соотношением, а не пикселями.
 */

import { mimeOf, readImageInfo } from '../image.ts'
import { ASPECT_TOLERANCE, describeProfileMismatch } from '../output-profile.ts'
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
  ProviderUsage,
  Recognized,
} from './types.ts'

const VENDOR = 'aitunnel'

/** `usage.cost_rub` шлюза — если поле пропало или не число, 0, а не отказ вызова: себестоимость
 *  не должна ронять генерацию, ради которой уже потрачены деньги. */
function costRub(result: any): number {
  const value = result?.usage?.cost_rub
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const CHAT_TIMEOUT_MS = 20_000

/**
 * Потолок вызова изображения — выбран по замерам, а не круглым числом (B13, ADR-0011).
 *
 * Двенадцать вызовов `gpt-image-2` дали 17,9–51,9 с на проводе (`bench/model-probe.mjs`,
 * прогоны 2026-08-30), а боевой конвейер добавляет к вызову ещё около 32 с сверх провода —
 * это измерено контрольным экспериментом и **пока не исправлено** (B13). Худшая
 * наблюдённая сумма ≈ 84 с: прежние 60 с резали бы даже успешные генерации.
 *
 * 150 с — та же сумма с запасом на полтора. Число временное по своей природе: как только
 * B13 уберёт наши 32 с, потолок обязан вернуться к времени вендора, иначе неудача будет
 * доходить до пользователя вдвое дольше, чем нужно. Жёсткого обещания по времени генерации
 * в `docs/TZ.md` нет (NFR-02 требует видимого прогресса, а не срока), поэтому подъём не
 * ломает контракта.
 */
const IMAGE_TIMEOUT_MS = 150_000

/**
 * Модель изображений вместе с формой запроса, которую она принимает.
 *
 * `sizes` пуст — модель принимает бакеты (`resolution` + `aspect_ratio`), как Gemini.
 * Непустой — модель требует размер в пикселях (`size`), как модели OpenAI: у `gpt-image-2`
 * в каталоге шлюза оба списка (`supported_resolutions`, `supported_aspect_ratios`) пусты, и
 * бакетный запрос он отвергает с HTTP 400. Список приходит из окружения, а не из кода:
 * имён моделей в коде нет (`ai-provider/index.ts`, docs/SPEC.md §5).
 */
type ImageModelSpec = { model: string; sizes: string[] }

type Config = { apiKey: string; baseUrl: string; imageModels: ImageModelSpec[]; textModel: string }

/** Читается на каждый вызов, а не один раз при создании: секрет может обновиться без передеплоя. */
function requireConfig(profile: ProviderProfile): Config {
  const apiKey = Deno.env.get('AI_PROVIDER_API_KEY')
  if (!apiKey) throw new Error('Не задана переменная окружения AI_PROVIDER_API_KEY')
  if (!profile.baseUrl) throw new Error('Не задана переменная окружения AI_PROVIDER_BASE_URL')
  if (!profile.imageModel) throw new Error('Не задана переменная окружения AI_PROVIDER_IMAGE_MODEL')
  if (!profile.textModel) throw new Error('Не задана переменная окружения AI_PROVIDER_TEXT_MODEL')

  // Резервная модель — не запас на будущее, а закрытие дыры смены модели (ADR-0011):
  // основная отказывает по классу товара (лицензионный мерч), резервная этот класс рисует.
  // Не задана — список из одной модели, поведение прежнее.
  const imageModels: ImageModelSpec[] = [
    { model: profile.imageModel, sizes: parseSizes(profile.imageSizes) },
  ]

  if (profile.imageModelFallback) {
    imageModels.push({
      model: profile.imageModelFallback,
      sizes: parseSizes(profile.imageSizesFallback),
    })
  }

  return { apiKey, baseUrl: profile.baseUrl, imageModels, textModel: profile.textModel }
}

/** `1024x1024,1536x2048` → список. Пустая строка и незаданная переменная — пустой список,
 *  то есть бакетная форма запроса. */
function parseSizes(raw: string | null): string[] {
  return (raw ?? '').split(',').map((size) => size.trim()).filter((size) => size !== '')
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

/** Входные фото уже прошли проверку формата на загрузке (`uploads.ts`) — не распознали, значит
 *  редкий формат из того же принятого набора (HEIC/HEIF), а не мусор. JPEG как ярлык безопасен:
 *  это только подпись `data:`-URL, шлюз читает содержимое сам. */
function inputDataUri(photo: Uint8Array): string {
  const info = readImageInfo(photo)
  return `data:${info === null ? 'image/jpeg' : mimeOf(info.format)};base64,${toBase64(photo)}`
}

function imageContentParts(photos: Uint8Array[]): unknown[] {
  return photos.map((photo) => ({ type: 'image_url', image_url: { url: inputDataUri(photo) } }))
}

/**
 * Референсные карточки (`docs/assets/cardsforsysprompt/`) — эксперимент шага 2 плана вехи M5,
 * до сих пор не проверенный: даёт ли модели картинку-пример дизайна лучший результат, чем
 * словесное описание в `imagePrompt`. Выключено по умолчанию — карточка без них уже стоит
 * денег, а эффект не подтверждён; включается `AI_PROVIDER_CARD_REFERENCES=true` вручную на
 * время сравнения, не автоматикой самого стенда.
 *
 * Путь — модуль-относительный (`import.meta.url`), не от рабочей директории процесса: у
 * `Deno.readFile` со строкой это была бы CWD, а она не гарантирована при разных способах
 * запуска функции. Каталог лежит вне `supabase/functions/` — для локального
 * `functions serve` это нормально (полный доступ к репозиторию), в реальный деплой эти файлы
 * сейчас не попадают: решение, копировать ли их в границу деплоя, — только если эксперимент
 * подтвердит эффект (шаг 2), не раньше.
 */
const CARD_REFERENCE_DIR = new URL('../../../../docs/assets/cardsforsysprompt/', import.meta.url)

let cardReferenceCache: unknown[] | null = null

async function cardReferenceParts(): Promise<unknown[]> {
  if (Deno.env.get('AI_PROVIDER_CARD_REFERENCES') !== 'true') return []
  if (cardReferenceCache !== null) return cardReferenceCache

  const parts: unknown[] = []

  try {
    for await (const entry of Deno.readDir(CARD_REFERENCE_DIR)) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.png')) continue
      const bytes = await Deno.readFile(new URL(entry.name, CARD_REFERENCE_DIR))
      parts.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${toBase64(bytes)}` } })
    }
  } catch (error) {
    // Не найдены — едем без них, а не роняем генерацию: это необязательный эксперимент,
    // а не часть контракта.
    console.error('AITunnel: референсные карточки не прочитаны', error)
    return []
  }

  cardReferenceCache = parts
  return parts
}

/** Модель иногда оборачивает JSON в ```-заборы, несмотря на `response_format`. */
function parseJsonObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const parsed: unknown = JSON.parse(stripped)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('ответ не является JSON-объектом')
  return parsed as Record<string, unknown>
}

/**
 * Ошибка шлюза с сохранённым статусом и телом ответа.
 *
 * Класс, а не строка: по телу ответа надо отличать отказ **по содержанию** (его лечит
 * резервная модель) от всех прочих 400 — например от «не поддерживается разрешение», где
 * повтор на другой модели ничего не даст. Разбор строки сообщения был бы тем же разбором,
 * только хрупким.
 */
export class GatewayError extends Error {
  constructor(readonly status: number, readonly payload: string) {
    super(`AITunnel HTTP ${status}: ${payload.slice(0, 500)}`)
    this.name = 'GatewayError'
  }
}

/**
 * Отказ провайдера по содержанию запроса — то есть «это я рисовать не буду», а не «я не
 * смог». Такой отказ бесплатен, воспроизводим и не лечится ни повтором, ни промптом:
 * `gpt-image-2` так отвергает коллекционную фигурку с лицензионным персонажем (замер
 * 2026-08-30, набор `other-bobblehead`). Единственное лечение — другая модель.
 */
export function isContentRefusal(error: unknown): boolean {
  if (!(error instanceof GatewayError) || error.status !== 400) return false

  return /safety|moderation|content[_ ]?policy|flagged|violat/i.test(error.payload)
}

/**
 * Размер кадра в пикселях для моделей, не принимающих бакеты, или `null` — если модель
 * бакетная и форму запроса менять не надо.
 *
 * Выбирается **самый дешёвый подходящий**: у моделей OpenAI цена кадра растёт с площадью,
 * а профиль площадки требует не конкретного размера, а порога и соотношения (FR-25,
 * `output-profile.ts`). Список размеров — из окружения; ошибку в нём лучше поймать здесь и
 * с внятным текстом, чем получить от шлюза 400 на каждой генерации.
 */
export function imageSizeParam(profile: OutputProfile, sizes: string[]): string | null {
  if (sizes.length === 0) return null

  const parsed = sizes.map((size) => {
    const match = /^(\d+)x(\d+)$/.exec(size)

    if (match === null) {
      throw new Error(
        `AI_PROVIDER_IMAGE_SIZES: «${size}» — не размер вида 1024x1024`,
      )
    }

    return { size, width: Number(match[1]), height: Number(match[2]) }
  })

  const wanted = profile.aspectW / profile.aspectH
  const sameAspect = parsed.filter(
    (candidate) => Math.abs(candidate.width / candidate.height - wanted) / wanted <= ASPECT_TOLERANCE,
  )

  if (sameAspect.length === 0) {
    throw new Error(
      `AI_PROVIDER_IMAGE_SIZES: ни один размер (${sizes.join(', ')}) не даёт соотношения ` +
        `${profile.aspectLabel}, которого требует площадка`,
    )
  }

  const fits = sameAspect.filter(
    (candidate) => candidate.width >= profile.minWidth && candidate.height >= profile.minHeight,
  )

  if (fits.length === 0) {
    throw new Error(
      `AI_PROVIDER_IMAGE_SIZES: все размеры соотношения ${profile.aspectLabel} ниже порога ` +
        `площадки ${profile.minWidth} × ${profile.minHeight}`,
    )
  }

  return fits.reduce((cheapest, candidate) =>
    candidate.width * candidate.height < cheapest.width * cheapest.height ? candidate : cheapest
  ).size
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
    throw new GatewayError(response.status, payload)
  }

  try {
    return JSON.parse(payload)
  } catch {
    throw new Error(`AITunnel вернул не JSON: ${payload.slice(0, 200)}`)
  }
}

/**
 * Один вызов `chat/completions` с требованием строгого JSON-объекта в ответе.
 *
 * `record` — необязательный: `recognize` его не передаёт (шаг мастера без генерации,
 * себестоимость сюда не пишется — см. миграцию `20260830000000_generation_costs.sql`),
 * остальные три текстовые операции контракта передают своё имя и общий колбэк `onUsage`.
 */
async function chatJson(
  config: Config,
  systemPrompt: string,
  userContent: string | unknown[],
  record?: { operation: ProviderUsage['operation']; onUsage?: (usage: ProviderUsage) => void },
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

  const durationMs = Date.now() - started
  const text = result?.choices?.[0]?.message?.content

  console.info('AITunnel', config.textModel, durationMs, 'мс', 'cost_rub', costRub(result))

  if (record !== undefined) {
    record.onUsage?.({ operation: record.operation, vendor: VENDOR, costRub: costRub(result), durationMs })
  }

  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('AITunnel: текстовая модель вернула пустой ответ')
  }

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

/**
 * Соотношение сторон для шлюза: компактный `"3:4"` из его перечня `supported_aspect_ratios`
 * (`profile.aspectLabel` — та же величина для человека, с пробелами).
 *
 * Берётся из объявленного соотношения профиля, а **не** сокращением целевых пикселей.
 * Первая редакция делила `width` на `height` и на кадре 1792 × 2400 получала `56:75` —
 * шлюз отвечал `HTTP 400: не поддерживается соотношение сторон "56:75"` (поймано первым же
 * прогоном боевого пути 2026-08-29). Пиксели подобраны под бакет вендора и ровному
 * отношению не обязаны.
 */
function aspectRatioParam(profile: OutputProfile): string {
  return `${profile.aspectW}:${profile.aspectH}`
}

/**
 * Бакет разрешения под целевой кадр профиля.
 *
 * Пиксели бакетов **замерены вызовами**, а не взяты из каталога: каталог публикует только
 * имена (`512`/`1K`/`2K`/`4K`). На 3 : 4 бакет `1K` даёт 896 × 1200, `2K` — 1792 × 2400;
 * на 1 : 1 `1K` даёт 1024 × 1024. Целевые кадры в `marketplace_profiles` записаны ровно
 * этими числами, поэтому выбор сводится к длинной стороне и не требует таблицы соответствий.
 *
 * Порог сравнения — длинная сторона **целевого кадра**, а не порога площадки: профиль уже
 * выбрал самый дешёвый бакет, проходящий порог (см. миграцию `20260829140000`, случай
 * Ozon с одеждой и аксессуарами, где 1K не дотягивает до 900 × 1200 четырёх пикселей).
 */
function resolutionParam(profile: OutputProfile): string {
  const longEdge = Math.max(profile.width, profile.height)
  if (longEdge <= 600) return '512'
  if (longEdge <= 1200) return '1K'
  if (longEdge <= 2400) return '2K'
  return '4K'
}

/**
 * Задание на текстовый блок карточки.
 *
 * Слова «карточка маркетплейса» и «обложка карточки товара» убраны намеренно: по ним модель
 * доставала из обучающих данных не «текстовый блок вообще», а чужую карточку целиком — с её
 * лейблами полей («PRODUCT:», «Категория: …»), оборванными подстановками и чужим водяным
 * знаком.
 *
 * Слова «название» и «краткое описание» убраны следом и по той же причине: убрав чужой
 * шаблон, промпт стал сам себе шаблоном — модель приняла эти слова за подписи полей и
 * нарисовала «Название:» и «Краткое описание:» прямо в кадре (перезамер 2026-08-30, 2 кадра
 * из 10). Поэтому строки диктуются готовыми, а не заказываются по имени.
 */
function cardLayoutLine(product: ProductBrief, card: CardTexts | null): string {
  if (card === null) {
    // Тексты не пришли — просить их у модели изображений всё равно нечем, кроме описания
    // задачи. Ветка остаётся ради контракта: `card` объявлен nullable, а рисовать при
    // kind === 'card' кадр вовсе без блока нельзя (FR-07).
    return `На изображении, помимо товара, нужен аккуратный текстовый блок с заголовком ` +
      `«${product.title}» — рядом с товаром, не поверх него. Никакого другого текста в ` +
      'кадре: ни дополнительных полей и характеристик, ни подписей в квадратных скобках, ни ' +
      'шаблонных заготовок, которые надо заполнять. Никаких логотипов, водяных знаков и ' +
      'названий магазинов, которых нет на фото товара. Весь текст блока — на русском языке, ' +
      'даже если сам товар и надписи на упаковке англоязычные.'
  }

  // Описание в кадр НЕ диктуется — решение шага 5 (ADR-0011), и оно измерено, а не выбрано
  // на вкус: у `gpt-image-2` весь брак пришёлся на длинную строку описания, тогда как
  // заголовок вышел дословным 13 раз из 13. Описание остаётся в БД (`card_description`) и
  // показывается рядом с изображением. Оговорки про русский язык здесь нет намеренно: строка
  // диктуется готовой, сочинять модели нечего — именно в таком виде она и замерена.
  return `В кадре, помимо товара, нужен аккуратный текстовый блок — рядом с товаром, не ` +
    `поверх него. Одной крупной строкой: «${card.title}». Воспроизвести её дословно, слово ` +
    'в слово, ничего не добавляя и не сокращая. Никакого другого текста в кадре: ни описания, ' +
    'ни подписей к строке, ни дополнительных полей и характеристик, ни логотипов, водяных ' +
    'знаков и названий магазинов, которых нет на фото товара.'
}

function imagePrompt(
  product: ProductBrief,
  profile: OutputProfile,
  kind: GenerationKind,
  card: CardTexts | null,
  referenceCount: number,
): string {
  const scenario = product.presetPrompt ?? product.wishes.trim()
  const scenarioLine = scenario === ''
    ? 'Сцена показа — на усмотрение, товар должен быть виден полностью и чётко.'
    : `Сценарий показа: ${scenario}.`

  const layoutLine = kind === 'card'
    ? cardLayoutLine(product, card)
    : 'Это витринное фото без текста и вёрстки — ничего, кроме товара на фоне, не рисовать.'

  // Без этой оговорки риск в том, что модель перенесёт с референса не оформление, а сам товар,
  // человека или бренд — референсные PNG в docs/assets/cardsforsysprompt/ это готовые
  // лайфстайл-карточки, не пустые шаблоны.
  const referenceLine = referenceCount === 0
    ? ''
    : `Первые изображения — фото вашего товара, сохранить точно. Последние ${referenceCount} — ` +
      'только референс СТИЛЯ оформления карточки: цветовые акценты, типографика, расположение ' +
      'текстового блока. Товар, человека и бренд с этих референсов не копировать и не ' +
      'использовать — они не про то, что нарисовать, а про то, как оформить текст.'

  return [
    `Товар: ${product.title} (категория «${product.categoryTitle}»).`,
    product.description.trim() === '' ? '' : `Описание: ${product.description.trim()}.`,
    scenarioLine,
    layoutLine,
    'Тот же товар, что на приложенных референсных фото — не заменять другим предметом, ' +
      'сохранить форму, цвет, надписи и логотипы, число объектов не менять.',
    // Найдено на прогоне шага 2 (home-chair): вендор прочитал три цветных блока обивки как
    // государственный флаг и подогнал оттенки под канонические цвета флага. Оговорка общая,
    // не привязана к одному товару — любой товар с несколькими цветными блоками рискует тем
    // же чтением. Три повтора с этой строкой дали три разных, но неканонических результата.
    'Если на товаре несколько цветовых блоков или полос — это дизайн обивки, окраски или ' +
      'упаковки, а не государственный флаг, герб или чужой логотип: сохранить именно те ' +
      'оттенки, что на фото, не подгонять под канонические цвета флагов или брендов.',
    `Кадр строго ${aspectRatioParam(profile)}, фон ${profile.backgroundTitle} ` +
      `(${profile.backgroundHex}), товар не обрезан по краю кадра.`,
    referenceLine,
  ].filter((line) => line !== '').join(' ')
}

export function createAitunnelProvider(
  providerProfile: ProviderProfile,
  onUsage?: (usage: ProviderUsage) => void,
): AiProvider {
  return {
    async moderate(photos: Uint8Array[]): Promise<Moderated> {
      // Контракт (types.ts): пустой список проходит тривиально — проверять нечего.
      if (photos.length === 0) return { allowed: true }

      const config = requireConfig(providerProfile)
      const verdict = await chatJson(config, MODERATION_SYSTEM_PROMPT, [
        { type: 'text', text: 'Проверь приложенные фотографии.' },
        ...imageContentParts(photos),
      ], { operation: 'moderate', onUsage })

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

    async generateImages({ photos, product, profile, kind, card, objects }): Promise<GeneratedImage[]> {
      const config = requireConfig(providerProfile)
      const images: GeneratedImage[] = []

      // Только для карточки: витринному фото ("photo") дизайн-референс не про что применять —
      // там самого текстового блока нет (шаг 3 плана, ветка kind === 'photo' в imagePrompt).
      const references = kind === 'card' ? await cardReferenceParts() : []

      const prompt = imagePrompt(product, profile, kind, card, references.length)
      const inputReferences = [...imageContentParts(photos), ...references]

      for (let index = 0; index < objects; index++) {
        let result: any = null
        let model = ''
        let durationMs = 0

        // Отказ по содержанию — единственный повод перейти на резервную модель (ADR-0011).
        // Всё остальное (таймаут, сбой шлюза, ошибка конфигурации) выбрасывается сразу:
        // повторять на другой модели то, что не связано с содержанием, — жечь деньги и время.
        for (const spec of config.imageModels) {
          const started = Date.now()
          const size = imageSizeParam(profile, spec.sizes)

          try {
            result = await callGateway(`${config.baseUrl}/images/generations`, config.apiKey, {
              model: spec.model,
              prompt,
              input_references: inputReferences,
              ...(size === null
                ? { resolution: resolutionParam(profile), aspect_ratio: aspectRatioParam(profile) }
                : { size }),
              response_format: 'b64_json',
            }, IMAGE_TIMEOUT_MS)

            durationMs = Date.now() - started
            model = spec.model
            break
          } catch (error) {
            const isLast = spec === config.imageModels[config.imageModels.length - 1]

            if (!isContentRefusal(error) || isLast) throw error

            // Отказ бесплатен, поэтому в себестоимость не пишется; в лог — обязательно,
            // иначе переход на резерв незаметен, а он меняет и цену кадра, и его качество.
            console.warn(
              'AITunnel', spec.model, 'отказ по содержанию за', Date.now() - started, 'мс',
              '— повтор на резервной модели',
            )
          }
        }

        onUsage?.({ operation: 'generateImages', vendor: VENDOR, costRub: costRub(result), durationMs })

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
        const info = readImageInfo(bytes)

        console.info(
          'AITunnel', model, durationMs, 'мс',
          'cost_rub', costRub(result),
          'запрошено', `${profile.width}×${profile.height}`,
          'получено', info === null ? '?' : `${info.width}×${info.height} ${info.format}`,
        )

        // Правило одно на провайдера и воркер (`output-profile.ts`): здесь оно срабатывает
        // раньше и с именем вендора в сообщении, чтобы в логах было видно, чей выход не подошёл.
        const mismatch = describeProfileMismatch(bytes, profile)

        if (mismatch !== null || info === null) {
          throw new Error(`AITunnel: ${mismatch ?? 'формат готового файла не распознан'}`)
        }

        images.push({
          bytes,
          contentType: mimeOf(info.format),
          width: info.width,
          height: info.height,
        })
      }

      return images
    },

    async composeCard({ product, profile }): Promise<CardTexts> {
      const config = requireConfig(providerProfile)
      const parsed = await chatJson(
        config,
        COMPOSE_CARD_SYSTEM_PROMPT,
        composeCardPrompt(product, profile),
        { operation: 'composeCard', onUsage },
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
        { operation: 'nameGeneration', onUsage },
      )

      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      if (title === '') throw new Error('AITunnel: название генерации не получено')

      return title
    },
  }
}
