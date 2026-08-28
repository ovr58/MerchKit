/**
 * Пополнение баланса пакетом баллов (FR-23, US-05).
 *
 * Зачем функция, если зачисление всё равно делает база: ключ service-role в браузер не
 * попадает, а право двигать баланс есть только у него (NFR-05). Здесь же выясняется, **кто**
 * пришёл — по токену, а не по тому, что клиент написал в теле запроса.
 *
 * Номинал пакета берёт `public.topup_balance` из справочника по идентификатору. В тело
 * запроса не входит и не может входить ничего, что влияет на сумму зачисления.
 *
 * Проверить локально:
 *   supabase functions serve topup
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/topup \
 *     -H "Authorization: Bearer <токен пользователя>" -H 'Content-Type: application/json' \
 *     -d '{"packageId":"start","idempotencyKey":"<uuid>"}'
 */

import { callDatabase, callerId, CORS_HEADERS, DatabaseError, failure, json } from '../_shared/edge.ts'

/** Ключ относится к попытке пополнения: два клика по одной кнопке несут один ключ. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  const owner = await callerId(request)
  if (owner === null) {
    return failure('Требуется вход', 401)
  }

  const body: unknown = await request.json().catch(() => null)
  const packageId = (body as { packageId?: unknown } | null)?.packageId
  const idempotencyKey = (body as { idempotencyKey?: unknown } | null)?.idempotencyKey

  if (typeof packageId !== 'string' || packageId === '') {
    return failure('Не указан пакет пополнения', 400)
  }

  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) {
    return failure('Не указан ключ попытки пополнения', 400)
  }

  try {
    const balance = await callDatabase('topup_balance', {
      owner_id: owner,
      package_id: packageId,
      operation_key: idempotencyKey,
    })

    return json({ balance })
  } catch (error: unknown) {
    if (error instanceof DatabaseError) {
      // Отказ базы — это «нет такого пакета», а не сбой: показывать можно как есть.
      console.error('Пополнение отклонено базой', error.message)
      return failure('Пополнение не выполнено: пакет не найден', 400)
    }

    console.error('Пополнение не дошло до базы', error)
    return failure('Пополнение временно недоступно, попробуйте ещё раз', 503)
  }
})
