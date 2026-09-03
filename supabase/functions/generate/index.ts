/**
 * `generation-service` (docs/SPEC.md §3): приём заявки на генерацию.
 *
 * `POST /generate` → `{ generationId }`. Отвечает, не дожидаясь, пока провайдер что-либо
 * нарисует: генерация — долгая операция, и держать на ней http-запрос значит потерять
 * результат вместе со вкладкой (NFR-02). Статус живёт в базе, воркер работает в своём
 * вызове.
 *
 * «Не дожидаясь» — не «мгновенно»: с M5 внутрь запроса встала модерация, а это скачивание
 * фото и вызов вендора (до 20 с по таймауту `aitunnel.ts`). Отсюда же следствие, которое
 * стоит держать в голове: недоступность вендора теперь роняет ПРИЁМ заявки, а не только
 * работу воркера.
 *
 * **Цену считает сервер.** Клиентская цена справочная (docs/SPEC.md §3): она показывается
 * человеку до запуска (FR-11), но списывается посчитанная здесь. Расхождение — ошибка, а
 * не «клиент прав», поэтому цена из тела запроса не принимается вовсе.
 *
 * **Модерация — здесь, а не на распознавании** (решение шага 0 вехи M5). Мимо `generate`
 * не проходит ни одна заявка: повесь проверку только на `recognize`, её обойдёт любой, кто
 * не нажмёт «распознать» и заполнит поля руками. Отказ — до `create_generation`, баллы не
 * списываются, ответ неотличим по форме от нехватки баллов (US-E3): пользователю не нужно
 * знать, что сработала именно модерация.
 *
 * Проверить локально:
 *   supabase functions serve
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/generate \
 *     -H "Authorization: Bearer <токен пользователя>" -H 'Content-Type: application/json' \
 *     -d '{"kind":"card","marketplaceId":"ozon","categoryId":"clothing",
 *          "presetId":"clothing-model","productTitle":"Куртка-бомбер","photoPaths":[]}'
 */

import { createProvider, type ProductProperty, type ProviderUsage } from '../_shared/ai-provider/index.ts'
import {
  afterResponse,
  callDatabase,
  callerId,
  CORS_HEADERS,
  DatabaseError,
  downloadFile,
  failure,
  json,
  selectFromDatabase,
} from '../_shared/edge.ts'
import { rejectLogo } from '../_shared/logo.ts'
import { generationPrice, MAX_OBJECTS_PER_GENERATION, type GenerationKind } from '../_shared/pricing.ts'
import { MAX_PHOTOS } from '../_shared/uploads.ts'

type Request_ = {
  kind?: unknown
  marketplaceId?: unknown
  categoryId?: unknown
  presetId?: unknown
  productTitle?: unknown
  productDescription?: unknown
  wishes?: unknown
  productProperties?: unknown
  photoPaths?: unknown
  logoPath?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Браузер можно обойти, поэтому подтверждённые свойства чистятся и здесь. */
function productProperties(value: unknown): ProductProperty[] | null {
  // Старый открытый клиент ещё может не передавать новое поле. Это означает пустой список,
  // а не нарушение формы; заданное значение всегда проверяется строго.
  if (value === undefined) return []
  if (!Array.isArray(value)) return null

  const normalized: ProductProperty[] = []

  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null

    const { label, value: propertyValue } = entry as { label?: unknown; value?: unknown }
    if (typeof label !== 'string' || typeof propertyValue !== 'string') return null

    const property = { label: label.trim(), value: propertyValue.trim() }
    if (property.label !== '' || property.value !== '') normalized.push(property)
  }

  return normalized
}

/** Нехватка баллов приходит из базы как нарушение check-ограничения (US-E3). */
const INSUFFICIENT_CREDITS = '23514'

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  // FR-12: генерация только для авторизованного. Гостю интерфейс предлагает регистрацию,
  // но полагаться на интерфейс здесь нельзя — запрос приходит и мимо него.
  const owner = await callerId(request)
  if (owner === null) {
    return failure('Требуется вход', 401)
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Request_

  const kind = body.kind
  if (kind !== 'photo' && kind !== 'card') {
    return failure('Не указан тип генерации', 400)
  }

  const marketplaceId = text(body.marketplaceId)
  const categoryId = text(body.categoryId)
  const productTitle = text(body.productTitle)

  if (marketplaceId === '' || categoryId === '') {
    return failure('Не выбраны площадка и категория', 400)
  }

  if (productTitle === '') {
    return failure('Не указано наименование товара', 400)
  }

  const confirmedProperties = productProperties(body.productProperties)
  if (confirmedProperties === null) {
    return failure('Свойства товара переданы в неверном формате', 400)
  }

  const photoPaths = Array.isArray(body.photoPaths)
    ? body.photoPaths.filter((path): path is string => typeof path === 'string')
    : []

  if (photoPaths.length > MAX_PHOTOS) {
    return failure(`За одну генерацию принимаем не больше ${MAX_PHOTOS} фото`, 400)
  }

  const logoPath = text(body.logoPath) === '' ? null : text(body.logoPath)

  // Знак — только у карточки: у генерации типа `photo` макета нет, ставить его некуда.
  // То же правило стоит в схеме, здесь оно отсекает заявку до платной модерации.
  if (logoPath !== null && kind !== 'card') {
    return failure('Логотип применим только к карточке', 400)
  }

  // Чужие файлы в свою заявку не подставить: путь начинается с идентификатора владельца,
  // и это то же условие, по которому их пускает Storage (NFR-04). Знак проверяется тем же
  // правилом, что и фото: он приезжает в том же бакете и той же дорогой.
  if ([...photoPaths, ...(logoPath === null ? [] : [logoPath])].some((path) => !path.startsWith(`${owner}/`))) {
    return failure('В заявке чужие файлы', 403)
  }

  const price = generationPrice(kind as GenerationKind, MAX_OBJECTS_PER_GENERATION)

  try {
    // Баллы сверяются ДО модерации, потому что модерация — платный вызов вендора.
    //
    // Это не проверка перед списанием: ею остаётся `create_generation`, где чтение баланса
    // и списание идут одной транзакцией и потому переживают гонку двух заявок. Здесь —
    // только отсечка заведомо неоплатной заявки, чтобы вендору за неё не платили мы:
    // `moderate` стоит денег на каждом вызове, а `generate` до сих пор дёргал его вообще
    // без защиты. У `recognize` ту же задачу решает суточный лимит (миграция
    // 20260829130000) — здесь хватает баланса, потому что вызвать `generate` может только
    // вошедший, а у вошедшего баланс есть.
    //
    // Ответ тот же, что у гонки ниже: клиент не должен различать, кто отказал — предчек
    // или база (US-E3).
    const [account] = (await selectFromDatabase(
      `profiles?id=eq.${owner}&select=balance`,
    )) as { balance?: number }[]

    if (account === undefined || (account.balance ?? 0) < price) {
      return json({ error: 'Не хватает баллов для запуска генерации', code: 'insufficient_credits' }, 409)
    }

    // Модерация — до списания баллов (решение шага 0 вехи M5), не на шаге распознавания:
    // к моменту запуска фото могли поменяться, а списывается ровно этот набор. Отказ
    // тихий — тем же по форме ответом, что и нехватка баллов (US-E3): пользователь не
    // узнаёт, что сработала именно модерация.
    const usage: ProviderUsage[] = []
    const photos = await Promise.all(photoPaths.map((path) => downloadFile('uploads', path)))
    const logo = logoPath === null ? null : await downloadFile('uploads', logoPath)

    // Знак перепроверяется по БАЙТАМ, а не по расширению пути: клиент ту же проверку уже
    // сделал (`_shared/logo.ts`), но интерфейс можно обойти, а негодный файл ляжет в
    // карточку уже за деньги. Отказ здесь — до списания.
    if (logo !== null) {
      const reason = rejectLogo(logo)

      if (reason !== null) {
        return json({ error: `Логотип не подошёл: ${reason}`, code: 'logo_rejected' }, 400)
      }
    }

    // Неудача самой проверки — не «генерация временно недоступна»: человек стоит перед
    // кнопкой с готовой заявкой, и ему надо сказать, что именно не сработало. Провайдер
    // уже сходил к вендору дважды (`aitunnel.ts`, moderate) — здесь остаётся честный отказ.
    let moderation
    try {
      // Знак идёт в тот же вызов, а не в свой: он попадает в оплаченный кадр наравне с
      // фото, а отдельная проверка стоила бы второго обращения к вендору за ту же цену.
      // Системный промпт модерации фирменные знаки разрешает прямым текстом.
      moderation = await createProvider(undefined, (entry) => usage.push(entry))
        .moderate(logo === null ? photos : [...photos, logo])
    } catch (error: unknown) {
      console.error('Модерация не дала вердикта', error)
      return json(
        { error: 'Проверка фото не сработала. Попробуйте ещё раз', code: 'moderation_unavailable' },
        503,
      )
    }

    if (!moderation.allowed) {
      console.info('Заявка отклонена модерацией', moderation.reason)
      return json({ error: 'Заявка не принята: проверьте загруженные фото', code: 'moderation_rejected' }, 409)
    }

    const generationId = await callDatabase('create_generation', {
      owner_id: owner,
      generation_kind: kind,
      marketplace: marketplaceId,
      category: categoryId,
      preset: text(body.presetId) === '' ? null : text(body.presetId),
      title_of_product: productTitle,
      description_of_product: text(body.productDescription),
      free_wishes: text(body.wishes),
      photo_paths: photoPaths,
      charged_price: price,
      properties: confirmedProperties,
      logo: logoPath,
    })

    if (typeof generationId !== 'string') {
      throw new Error('База не вернула идентификатор генерации')
    }

    console.info('Генерация принята', generationId, 'списано', price)

    // Себестоимость модерации известна только теперь, когда generationId уже существует
    // (шаг 4 плана вехи M5) — писать её раньше некуда. Не блокирует ответ пользователю.
    if (usage.length > 0) {
      afterResponse(callDatabase('record_generation_costs', { target_generation: generationId, entries: usage }))
    }

    // Воркер запускается вдогонку: ответ уже ушёл, и вкладку можно закрывать (NFR-02).
    afterResponse(startWorker(generationId))

    return json({ generationId, price })
  } catch (error: unknown) {
    if (error instanceof DatabaseError) {
      if (error.message.includes(INSUFFICIENT_CREDITS) || error.message.includes('Недостаточно баллов')) {
        // US-E3: не запускать и не списывать. Сколько не хватает, клиент знает сам —
        // он показал цену до запуска (FR-11) и знает баланс.
        return json({ error: 'Не хватает баллов для запуска генерации', code: 'insufficient_credits' }, 409)
      }

      console.error('Заявка отклонена базой', error.message)
      return failure('Заявка не принята: проверьте выбранные параметры', 400)
    }

    console.error('Заявка не дошла до базы', error)
    return failure('Генерация временно недоступна, попробуйте ещё раз', 503)
  }
})

/**
 * Дёргает воркер по HTTP вместо прямого вызова функции.
 *
 * Не «лишний сетевой хоп»: у отдельного вызова свой бюджет времени, поэтому долгая работа
 * провайдера не съедает лимит приёмки заявки. Заодно воркера можно позвать руками по
 * `generationId` — тем и проверяется повторная доставка события (NFR-03).
 */
async function startWorker(generationId: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !secret) return

  await fetch(`${url}/functions/v1/generation-worker`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ generationId }),
  })
}
