/**
 * Общее для Edge Functions: CORS, разбор вызывающего и обращения к Supabase с service-role.
 *
 * **Зависимостей нет намеренно.** Шаблонный импорт типов с `jsr.io` уронил рантайм с
 * `worker boot error` ещё до первой строки обработчика (B9 в `planning/BACKLOG.md`).
 * Всё, что здесь нужно, есть в платформе: `fetch`, `Response`, `AbortSignal`.
 *
 * Логгер проекта (`src/lib/logger.ts`) сюда не дотягивается — он часть клиентского бандла.
 * В Edge Functions поток логов платформы и есть `console`, поэтому отказы пишутся
 * `console.error`, и только они.
 */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Ответ наружу. Тело ошибки — только человеческий текст: устройство сервера не наше дело. */
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS })
}

export function failure(message: string, status: number): Response {
  return json({ error: message }, status)
}

const REQUEST_TIMEOUT_MS = 10_000

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Не задана переменная окружения ${name}`)
  return value
}

/**
 * Кто вызывает. Подпись токена проверяет сам GoTrue — своей проверки не пишем: это ровно
 * тот код, который нельзя написать «почти правильно».
 *
 * Возвращает `null`, если токена нет или он не принят. Причину наружу не выносим: для
 * вызывающего это одинаковый отказ.
 */
export async function callerId(request: Request): Promise<string | null> {
  const authorization = request.headers.get('Authorization')
  if (!authorization) return null

  const response = await fetch(`${requiredEnv('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: requiredEnv('SUPABASE_ANON_KEY'), Authorization: authorization },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) return null

  const user: unknown = await response.json()
  const id = (user as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/**
 * Вызов функции БД с service-role. Только так меняется баланс: ключ service-role живёт
 * в Edge Function и в браузер не попадает ни при каких условиях (NFR-05).
 */
export async function callDatabase(name: string, args: Record<string, unknown>): Promise<unknown> {
  const secret = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  const response = await fetch(`${requiredEnv('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null)
    const message = (detail as { message?: unknown } | null)?.message
    throw new DatabaseError(typeof message === 'string' ? message : `HTTP ${response.status}`)
  }

  return response.json()
}

/** Отказ пришёл из базы, а не из сети: сообщение писала наша же функция и его можно показать. */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseError'
  }
}

/** Вызов GoTrue от имени администратора — то, чего клиент про себя сделать не может. */
export async function callAdminApi(path: string, method: string): Promise<Response> {
  const secret = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  return fetch(`${requiredEnv('SUPABASE_URL')}/auth/v1/admin${path}`, {
    method,
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}
