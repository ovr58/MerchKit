/**
 * Распознавание товара по фото (FR-03, FR-04) — операция `recognize` модуля `ai-provider`.
 *
 * **Работает и для гостя.** Мастер генерации проходится без входа целиком: перехват стоит
 * только на «Запустить генерацию» (FR-12). Значит распознавание обязано отвечать и по
 * анонимному ключу — иначе первый же шаг мастера требовал бы регистрации.
 *
 * **Фото приходят телом запроса, а не путями в бакете.** У гостя нет своей папки в
 * `uploads` (политики бакета стоят на `auth.uid()`), и заводить её ради шага, который
 * может не кончиться генерацией, незачем. Файлы уезжают в хранилище позже — при запуске,
 * когда пользователь уже вошёл.
 *
 * Не смог определить — это НЕ ошибка, а штатный ответ с пустыми полями: сценарий
 * продолжается, поля заполняются руками (US-E2).
 *
 * Проверить локально:
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/recognize \
 *     -H "Authorization: Bearer $ANON_KEY" -F 'photo=@куртка.jpg'
 */

import { createProvider } from '../_shared/ai-provider/index.ts'
import { CORS_HEADERS, failure, json } from '../_shared/edge.ts'
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from '../_shared/uploads.ts'

const MULTIPART_CORS = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Headers': `${CORS_HEADERS['Access-Control-Allow-Headers']}, x-supabase-api-version`,
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MULTIPART_CORS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  let photos: Uint8Array[]

  try {
    const form = await request.formData()
    const files = form.getAll('photo').filter((entry): entry is File => entry instanceof File)

    if (files.length === 0) {
      return failure('Не приложено ни одного фото', 400)
    }

    if (files.length > MAX_PHOTOS) {
      return failure(`За одну генерацию принимаем не больше ${MAX_PHOTOS} фото`, 400)
    }

    if (files.some((file) => file.size > MAX_PHOTO_BYTES)) {
      return failure('Файл больше допустимого размера', 413)
    }

    photos = await Promise.all(
      files.map(async (file) => new Uint8Array(await file.arrayBuffer())),
    )
  } catch (error: unknown) {
    console.error('Не удалось разобрать фото из запроса', error)
    return failure('Не удалось прочитать приложенные фото', 400)
  }

  try {
    const recognized = await createProvider().recognize(photos)
    return json(recognized)
  } catch (error: unknown) {
    // Провайдер отказал — сценарий всё равно продолжается, только вручную (US-E2). Ошибку
    // наружу не выносим: для мастера «не смог» и «не ответил» — одно и то же состояние.
    console.error('Распознавание не удалось', error)
    return json({ categoryId: null, productTitle: null })
  }
})
