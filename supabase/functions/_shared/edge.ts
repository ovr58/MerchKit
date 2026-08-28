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

  // Функция, возвращающая `void`, отвечает 204 без тела — разбирать там нечего. Переходы
  // статуса генерации именно такие, и `response.json()` на них падал бы разбором пустоты.
  const payload = await response.text()
  return payload === '' ? null : JSON.parse(payload)
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

/**
 * Чтение таблицы или представления с service-role.
 *
 * Нужно воркеру и приёмке заявки: они читают чужие по смыслу строки (генерацию, профиль
 * площадки) от имени сервера, а не пользователя. Клиентские чтения сюда не заезжают — там
 * работает RLS и обычный запрос из браузера.
 */
export async function selectFromDatabase(query: string): Promise<unknown[]> {
  const secret = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  const response = await fetch(`${requiredEnv('SUPABASE_URL')}/rest/v1/${query}`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new DatabaseError(`Чтение ${query} вернуло HTTP ${response.status}`)
  }

  return response.json()
}

const STORAGE_TIMEOUT_MS = 30_000

/** Скачать файл из приватного бакета. Подписанные ссылки тут не нужны: это сервер. */
export async function downloadFile(bucket: string, path: string): Promise<Uint8Array> {
  const secret = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  const response = await fetch(
    `${requiredEnv('SUPABASE_URL')}/storage/v1/object/${bucket}/${path}`,
    {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    throw new Error(`Файл ${bucket}/${path} не читается: HTTP ${response.status}`)
  }

  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Положить файл в приватный бакет от имени сервера.
 *
 * Результат генерации пишет только эта дорога: политики бакета `results` дают клиенту
 * чтение и ничего больше (NFR-05). `x-upsert` — ради повторной доставки события: второй
 * заход воркера кладёт тот же файл на то же место, а не падает на конфликте (NFR-03).
 */
export async function uploadFile(
  bucket: string,
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const secret = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')

  const response = await fetch(
    `${requiredEnv('SUPABASE_URL')}/storage/v1/object/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: bytes,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    },
  )

  if (!response.ok) {
    throw new Error(`Файл ${bucket}/${path} не сохранён: HTTP ${response.status}`)
  }
}

/** Пришёл ли запрос от нашего же сервера, а не от пользователя с валидным токеном. */
export function isServiceRoleCaller(request: Request): boolean {
  const authorization = request.headers.get('Authorization') ?? ''
  return authorization === `Bearer ${requiredEnv('SUPABASE_SERVICE_ROLE_KEY')}`
}

/**
 * Работа, которая продолжается после ответа клиенту.
 *
 * Так генерация переживает уход со страницы (NFR-02): заявка отвечает `generationId`
 * сразу, а воркер дёргается вдогонку и живёт в собственном вызове со своим бюджетом
 * времени. `EdgeRuntime` есть в рантайме Supabase, но не в любом окружении — поэтому
 * проверка, а не предположение.
 */
export function afterResponse(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void } })
    .EdgeRuntime

  const swallowed = work.catch((error: unknown) => {
    console.error('Фоновая задача завершилась отказом', error)
  })

  if (typeof runtime?.waitUntil === 'function') {
    runtime.waitUntil(swallowed)
  }
}
