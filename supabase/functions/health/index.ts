// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from '@supabase/server'

/**
 * Пустая функция вехи M1: доменной логики в ней нет и не появится.
 * Её задача — доказать, что связка «фронтенд → Edge Function» собрана и работает:
 * браузер зовёт её публикуемым ключом и получает осмысленный ответ.
 *
 * Проверить локально:
 *   supabase start && supabase functions serve health
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/health -H "apiKey: <publishable>"
 */
export default {
  fetch: withSupabase({ auth: ['publishable', 'secret'] }, () =>
    Response.json({ ok: true, service: 'health', ts: new Date().toISOString() }),
  ),
}
