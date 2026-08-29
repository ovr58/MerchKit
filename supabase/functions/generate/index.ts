/**
 * `generation-service` (docs/SPEC.md §3): приём заявки на генерацию.
 *
 * `POST /generate` → `{ generationId }`. Отвечает СРАЗУ, до того как провайдер что-либо
 * нарисовал: генерация — долгая операция, и держать на ней http-запрос значит потерять
 * результат вместе со вкладкой (NFR-02). Статус живёт в базе, воркер работает в своём
 * вызове.
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

import { createProvider, type ProviderUsage } from '../_shared/ai-provider/index.ts'
import {
  afterResponse,
  callDatabase,
  callerId,
  CORS_HEADERS,
  DatabaseError,
  downloadFile,
  failure,
  json,
} from '../_shared/edge.ts'
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
  photoPaths?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

  const photoPaths = Array.isArray(body.photoPaths)
    ? body.photoPaths.filter((path): path is string => typeof path === 'string')
    : []

  if (photoPaths.length > MAX_PHOTOS) {
    return failure(`За одну генерацию принимаем не больше ${MAX_PHOTOS} фото`, 400)
  }

  // Чужие файлы в свою заявку не подставить: путь начинается с идентификатора владельца,
  // и это то же условие, по которому их пускает Storage (NFR-04).
  if (photoPaths.some((path) => !path.startsWith(`${owner}/`))) {
    return failure('В заявке чужие файлы', 403)
  }

  const price = generationPrice(kind as GenerationKind, MAX_OBJECTS_PER_GENERATION)

  try {
    // Модерация — до списания баллов (решение шага 0 вехи M5), не на шаге распознавания:
    // к моменту запуска фото могли поменяться, а списывается ровно этот набор. Отказ
    // тихий — тем же по форме ответом, что и нехватка баллов (US-E3): пользователь не
    // узнаёт, что сработала именно модерация.
    const usage: ProviderUsage[] = []
    const photos = await Promise.all(photoPaths.map((path) => downloadFile('uploads', path)))
    const moderation = await createProvider(undefined, (entry) => usage.push(entry)).moderate(photos)

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
