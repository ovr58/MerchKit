/**
 * `purge-uploads` (веха M5, шаг 6): уборка входных фото, переживших срок хранения.
 *
 * **Обещание пользователю — на экране загрузки**: загруженные фото живём три дня
 * (`UPLOAD_RETENTION_DAYS`), результаты генераций — бессрочно. Обещание, которое некому
 * исполнять, хуже отсутствующего, поэтому уборка — отдельный вызов, а не хвост воркера:
 * возраст объекта не связан с тем, чем кончилась чья-то генерация. Файлы того, кто
 * загрузил фото и ушёл, не оставив генерации вовсе, иначе не удалил бы никто.
 *
 * **Кто дёргает.** Расписание живёт в развёрнутом окружении (Supabase Cron), а не в
 * миграции: адрес функции и ключ — конфигурация окружения, а не схема БД, и жёстко
 * прописанный в миграции job уехал бы с локального стека на стейдж вместе с чужим
 * адресом. Как заводится — `docs/SPEC.md` §8.
 *
 * **Ключ service-role обязателен.** Функция удаляет чужие файлы по всему бакету — это
 * ровно то, чего не должен уметь ни один вошедший пользователь (NFR-04, NFR-05).
 *
 * Проверить локально:
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/purge-uploads \
 *     -H "Authorization: Bearer $SERVICE_ROLE_KEY"
 */

import { callDatabase, CORS_HEADERS, failure, isServiceRoleCaller, json, removeFiles } from '../_shared/edge.ts'
import { UPLOAD_RETENTION_DAYS } from '../_shared/uploads.ts'

/**
 * Потолок одного прогона. Не «сколько всего можно удалить», а сколько путей уместится в
 * один запрос к Storage: очередь длиннее разберётся следующим прогоном по расписанию —
 * файл, проживший на несколько часов дольше срока, приемлем, а вызов, упавший по таймауту
 * на середине, не удаляет ничего.
 */
const BATCH = 500

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  if (!isServiceRoleCaller(request)) {
    return failure('Уборка запускается только сервером', 401)
  }

  try {
    const rows = await callDatabase('expired_upload_paths', {
      max_age: `${UPLOAD_RETENTION_DAYS} days`,
      batch_limit: BATCH,
    })

    const paths = Array.isArray(rows)
      ? rows
          .map((row: unknown) => (row as { path?: unknown }).path)
          .filter((path: unknown): path is string => typeof path === 'string')
      : []

    if (paths.length === 0) {
      return json({ removed: 0, pending: false })
    }

    await removeFiles('uploads', paths)

    // Число, а не пути: в логе платформы это чужой пользовательский контент, а счётчик
    // отвечает на единственный вопрос эксплуатации — работает ли уборка вообще.
    console.info('Убраны просроченные фото', paths.length)

    // `pending` — сигнал расписанию, что очередь не влезла в один прогон целиком.
    return json({ removed: paths.length, pending: paths.length === BATCH })
  } catch (error: unknown) {
    console.error('Уборка просроченных фото не прошла', error)
    return failure('Уборка не выполнена', 503)
  }
})
