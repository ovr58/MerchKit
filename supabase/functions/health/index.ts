/**
 * Пустая функция вехи M1: доменной логики в ней нет и не появится.
 * Её задача — доказать, что связка «фронтенд → Edge Function» собрана и работает.
 *
 * Импортов нет намеренно. Шаблонный импорт типов с `jsr.io` уронил рантайм с
 * `worker boot error` ещё до первой строки обработчика (Kong отдавал 504). Воспроизвести
 * сбой позже не удалось — см. B9 в `planning/BACKLOG.md`. Проверке живости внешние пакеты
 * не нужны в любом случае, поэтому зависимостей здесь нет.
 *
 * Проверить локально:
 *   supabase start
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/health
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

Deno.serve((request: Request): Response => {
  // Браузер шлёт предполётный OPTIONS: у вызова из supabase-js есть свои заголовки.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  return Response.json(
    { ok: true, service: 'health', ts: new Date().toISOString() },
    { headers: CORS_HEADERS },
  )
})
