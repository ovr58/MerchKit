/**
 * Распознавание товара по фото (FR-03, FR-04) — операция `recognize` модуля `ai-provider`.
 *
 * **Только для вошедшего — с 2026-09-01** (решение пользователя, FR-12 переписан). Раньше
 * мастер проходился гостем целиком, и распознавание отвечало по анонимному ключу с суточным
 * лимитом на адрес. Лимит ограничивал расход, но не отменял его: каждый ответ гостю — деньги
 * вендору за того, кто ни разу не назвался. Гварда на маршруте мастера для этого мало —
 * `anon`-ключ публичен, и вызвать функцию можно мимо любого интерфейса.
 *
 * **Фото приходят телом запроса, а не путями в бакете.** Шаг распознавания может не
 * кончиться генерацией, и заводить ради него файлы в `uploads` незачем: они уезжают в
 * хранилище позже — при запуске.
 *
 * Не смог определить — это НЕ ошибка, а штатный ответ с пустыми полями: сценарий
 * продолжается, поля заполняются руками (US-E2).
 *
 * **Распознаваний в сутки — ограниченное число** (веха M5, шаг 5). На заглушке вызов ничего
 * не стоил; на живом вендоре каждый ответ — деньги с нашего счёта, и вход это не отменяет.
 * Исчерпанный лимит — единственный случай, когда шаг отвечает отказом, а не пустыми полями:
 * человек должен узнать, что распознавание не сломалось, а кончилось. Обоснование выбора
 * «лимит, а не плата» — в миграции `20260829130000_recognize_quota.sql`.
 *
 * Проверить локально:
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/recognize \
 *     -H "Authorization: Bearer <токен пользователя>" -F 'photo=@куртка.jpg'
 */

import { createProvider } from '../_shared/ai-provider/index.ts'
import { callDatabase, callerId, CORS_HEADERS, failure, json } from '../_shared/edge.ts'
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from '../_shared/uploads.ts'

const MULTIPART_CORS = {
  ...CORS_HEADERS,
  'Access-Control-Allow-Headers': `${CORS_HEADERS['Access-Control-Allow-Headers']}, x-supabase-api-version`,
}

/**
 * Сколько распознаваний в сутки достаётся вошедшему.
 *
 * Цифры — от ожидаемых объёмов (NFR-11: до 50 генераций в сутки на пике, решение
 * пользователя 2026-08-29). Сотня распознаваний за сутки — уже не «примерялся», а
 * злоупотребление, и оно именное.
 *
 * Это политика, а не техническое ограничение: правится значением, без миграции.
 *
 * **Переменной окружения — ради local, а не ради гибкости.** Из среды разработки все прогоны
 * идут одним пользователем и складываются в один счётчик: прод-лимит остановил бы пятый
 * запуск `npm run test:generation` за день. На local он поднят в `config.toml`; на проде
 * переменных нет, и действуют цифры отсюда.
 */
function limitFromEnv(name: string, fallback: number): number {
  const configured = Number(Deno.env.get(name))
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

const MEMBER_DAILY_LIMIT = limitFromEnv('RECOGNIZE_MEMBER_DAILY_LIMIT', 100)

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MULTIPART_CORS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  // Проверка стоит ДО чтения тела: анонимному вызывающему незачем даже загружать сюда
  // фотографии, а нам — тратить на них трафик и память.
  const userId = await callerId(request)
  if (userId === null) {
    return failure('Требуется вход', 401)
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
  //
  // В базу уходит не сам ключ, а его отпечаток: хеширование делает функция БД (ADR-0009).

  let allowed: boolean

  try {
    allowed = (await callDatabase('consume_recognize_quota', {
      caller_key: `user:${userId}`,
      daily_limit: MEMBER_DAILY_LIMIT,
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
        error: 'Распознавания на сегодня закончились. Заполните поля вручную или вернитесь завтра',
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
