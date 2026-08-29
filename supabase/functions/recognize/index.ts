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
 * **Бесплатных распознаваний в сутки — ограниченное число** (веха M5, шаг 5). На заглушке
 * открытый эндпоинт ничего не стоил; на живом вендоре каждый ответ гостю — деньги с нашего
 * счёта. Исчерпанный лимит — единственный случай, когда шаг отвечает отказом, а не пустыми
 * полями: человек должен узнать, что распознавание не сломалось, а кончилось, и что вход
 * его возвращает. Обоснование выбора «лимит, а не плата» — в миграции
 * `20260829130000_recognize_quota.sql`.
 *
 * Проверить локально:
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/recognize \
 *     -H "Authorization: Bearer $ANON_KEY" -F 'photo=@куртка.jpg'
 */

import { createProvider } from '../_shared/ai-provider/index.ts'
import { callDatabase, callerId, CORS_HEADERS, failure, json } from '../_shared/edge.ts'
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from '../_shared/uploads.ts'

const MULTIPART_CORS = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Headers': `${CORS_HEADERS['Access-Control-Allow-Headers']}, x-supabase-api-version`,
}

/**
 * Сколько распознаваний в сутки достаётся бесплатно.
 *
 * Цифры — от ожидаемых объёмов (NFR-11: до 50 генераций в сутки на пике, решение
 * пользователя 2026-08-29). Честному гостю на попытку хватает одного распознавания, десять
 * покрывают и сравнение вариантов, и повторные заходы. Вошедшему дано вдесятеро больше:
 * злоупотребление у него именное, а сотня распознаваний за сутки — уже не «примерялся».
 *
 * Это политика, а не техническое ограничение: правится значением, без миграции.
 *
 * **Переменной окружения — ради local, а не ради гибкости.** Из среды разработки все
 * прогоны приходят с одного адреса и складываются в один счётчик: прод-лимит остановил бы
 * пятый запуск `npm run test:generation` за день. На local он поднят в `config.toml`; на
 * проде переменных нет, и действуют цифры отсюда.
 */
function limitFromEnv(name: string, fallback: number): number {
  const configured = Number(Deno.env.get(name))
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

const GUEST_DAILY_LIMIT = limitFromEnv('RECOGNIZE_GUEST_DAILY_LIMIT', 10)
const MEMBER_DAILY_LIMIT = limitFromEnv('RECOGNIZE_MEMBER_DAILY_LIMIT', 100)

/**
 * Кого считаем. Вошедшего — по идентификатору, гостя — по адресу. В базу уходит не сам
 * ключ, а его отпечаток: хеширование делает функция БД (ADR-0009).
 *
 * Адрес не определился — считаем всех таких одним вызывающим. Это строже, чем надо, и
 * сделано намеренно: пропускать без счёта значит оставить ровно ту дыру, ради которой
 * лимит и заводился.
 */
function callerKey(request: Request, userId: string | null): { key: string; limit: number } {
  if (userId !== null) return { key: `user:${userId}`, limit: MEMBER_DAILY_LIMIT }

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address = forwarded !== undefined && forwarded !== ''
    ? forwarded
    : request.headers.get('x-real-ip')?.trim() ?? ''

  return { key: `addr:${address === '' ? 'unknown' : address}`, limit: GUEST_DAILY_LIMIT }
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

  // Счёт расходуется здесь, а не после ответа провайдера: платит вызов, а не удачный
  // результат. US-E2 — тоже потраченные деньги.
  const userId = await callerId(request)
  const { key, limit } = callerKey(request, userId)

  let allowed: boolean

  try {
    allowed = (await callDatabase('consume_recognize_quota', {
      caller_key: key,
      daily_limit: limit,
    })) === true
  } catch (error: unknown) {
    // Счётчик не ответил — не пускаем. Пропустить «на всякий случай» значит открыть
    // эндпоинт ровно в тот момент, когда за ним некому следить.
    console.error('Счётчик распознаваний недоступен', error)
    return failure('Распознавание временно недоступно, заполните поля вручную', 503)
  }

  if (!allowed) {
    return json(
      {
        error: userId === null
          ? 'Бесплатные распознавания на сегодня закончились. Войдите — и мы снова заполним поля за вас'
          : 'Распознавания на сегодня закончились. Заполните поля вручную или вернитесь завтра',
        code: 'recognize_limit',
      },
      429,
    )
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
