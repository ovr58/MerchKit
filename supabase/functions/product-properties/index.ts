/**
 * B1: извлечение свойств товара из текста продавца.
 *
 * Это отдельный бесплатный шаг перед генерацией: список обязательно показывается продавцу для
 * правки и только его подтверждённый порядок уходит вместе с заявкой. Функция не создаёт
 * генерацию и не списывает баллы, но лимитирует вызовы, потому что текстовая модель платная.
 */

import { createProvider } from '../_shared/ai-provider/index.ts'
import { callDatabase, callerId, CORS_HEADERS, failure, json } from '../_shared/edge.ts'

const MEMBER_DAILY_LIMIT = limitFromEnv('PRODUCT_PROPERTIES_MEMBER_DAILY_LIMIT', 100)

function limitFromEnv(name: string, fallback: number): number {
  const configured = Number(Deno.env.get(name))
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return failure('Метод не поддерживается', 405)

  const userId = await callerId(request)
  if (userId === null) return failure('Требуется вход', 401)

  const body = await request.json().catch(() => null)
  const description = text((body as { description?: unknown } | null)?.description)
  const wishes = text((body as { wishes?: unknown } | null)?.wishes)

  if (description === '' && wishes === '') {
    return failure('Добавьте описание товара или пожелания', 400)
  }

  try {
    const allowed = (await callDatabase('consume_product_properties_quota', {
      caller_key: `user:${userId}`,
      daily_limit: MEMBER_DAILY_LIMIT,
    })) === true

    if (!allowed) {
      return json(
        { error: 'Подбор свойств на сегодня закончился. Добавьте свойства вручную или вернитесь завтра', code: 'properties_limit' },
        429,
      )
    }

    return json({ properties: await createProvider().extractProductProperties({ description, wishes }) })
  } catch (error: unknown) {
    console.error('Свойства товара не извлечены', error)
    return failure('Не удалось подобрать свойства. Добавьте их вручную или попробуйте ещё раз', 503)
  }
})
