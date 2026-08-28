/**
 * Удаление аккаунта. Требования в ТЗ нет, но по 152-ФЗ у пользователя есть право отозвать
 * согласие на обработку данных, и без кнопки это делается руками через Supabase Studio.
 *
 * Клиент удалить своего пользователя не может — Auth такого вызова не даёт, только
 * администраторский. Отсюда функция: она выясняет, кто пришёл, по токену, и удаляет
 * **только его самого**. Идентификатор из тела запроса не читается вообще.
 *
 * Что происходит с данными: `profiles` уезжает каскадом, строки `ledger` остаются
 * обезличенными — учётный регистр удаление переживает (ADR-0009). Побочное следствие:
 * стартовые баллы на тот же почтовый ящик второй раз не начислятся.
 *
 * Проверить локально:
 *   supabase functions serve delete-account
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/delete-account \
 *     -H "Authorization: Bearer <токен пользователя>"
 */

import { callAdminApi, callerId, CORS_HEADERS, failure, json } from '../_shared/edge.ts'

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

  try {
    const response = await callAdminApi(`/users/${owner}`, 'DELETE')

    if (!response.ok) {
      console.error('Auth отказался удалять пользователя', response.status)
      return failure('Не удалось удалить аккаунт, попробуйте ещё раз', 502)
    }

    return json({ deleted: true })
  } catch (error: unknown) {
    console.error('Удаление аккаунта не дошло до Auth', error)
    return failure('Удаление временно недоступно, попробуйте ещё раз', 503)
  }
})
