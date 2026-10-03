/**
 * `card-rebuild`: бесплатная правка готовой карточки — шаг B7.5 плана
 * `card-assembly-pipeline_2026-08-31.md`. Логика — в `rebuild.ts`, здесь только проводка к
 * платформе (почему так — в шапке того файла).
 *
 * **Ни баллов, ни вендора.** Правка текста не повод платить второй раз, а кадр и вырез уже
 * куплены и лежат в `results` рядом с карточкой.
 *
 * Проверить локально (стенд занят — замечание для того, кто будет проверять):
 *   supabase functions serve card-rebuild
 *   чтение:     curl -sX POST http://127.0.0.1:54321/functions/v1/card-rebuild \
 *                 -H "Authorization: Bearer <jwt>" -d '{"generationId":"<id>"}'
 *   пересборка: ... -d '{"generationId":"<id>","texts":{"title":"…","description":"…"},"properties":[]}'
 */

import {
  callDatabase,
  callerId,
  DatabaseError,
  downloadFile,
  selectFromDatabase,
  uploadFile,
} from '../_shared/edge.ts'
import { renderPreview } from '../_shared/card-layout/render.ts'
import { createRebuildHandler } from './rebuild.ts'

/**
 * Потолок пересборок на пользователя в сутки — тот же, что у превью. Дорого здесь не деньги,
 * а процессорное время изолята; счётчик общий (`consume_daily_quota`), счета разных операций
 * в нём раздельны префиксом ключа (`rebuild:user:<id>`).
 */
const REBUILD_DAILY_LIMIT = limitFromEnv('REBUILD_DAILY_LIMIT', 200)

function limitFromEnv(name: string, fallback: number): number {
  const configured = Number(Deno.env.get(name))
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

Deno.serve(
  createRebuildHandler({
    callerId,
    select: selectFromDatabase,
    consumeQuota: async (key, limit) =>
      (await callDatabase('consume_daily_quota', { caller_key: key, daily_limit: limit })) === true,
    download: downloadFile,
    upload: uploadFile,
    recordAssembly: async (generationId, content, fontMap) => {
      await callDatabase('record_card_assembly', {
        target_generation: generationId,
        assembled_content: content,
        assembled_font_map: fontMap,
      })
    },
    updateGeneration,
    render: renderPreview,
    dailyLimit: REBUILD_DAILY_LIMIT,
  }),
)

/**
 * Запись текстов в строку генерации с service-role. Отдельной функции БД под это нет, и
 * заводить её ради трёх колонок — миграция, которую не проверить без стенда; фильтр по
 * владельцу и статусу стоит здесь же, чтобы запись не зависела от того, что проверил вызывающий.
 */
async function updateGeneration(
  generationId: string,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  if (!secret || !url) throw new Error('Не заданы SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY')

  const response = await fetch(
    `${url}/rest/v1/generations?id=eq.${generationId}&user_id=eq.${userId}&status=eq.done`,
    {
      method: 'PATCH',
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(10_000),
    },
  )

  if (!response.ok) throw new DatabaseError(`Запись генерации вернула HTTP ${response.status}`)
}
