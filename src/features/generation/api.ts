import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { GenerationKind } from '@shared/pricing.ts'
import { useEffect } from 'react'

import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'

import { LAST_STEP, writeDraft, type DraftPhoto, type WizardDraft } from './draft'

/**
 * Модуль `generation-wizard` со стороны данных: распознавание, загрузка фото, запуск
 * заявки и чтение статуса.
 *
 * **Провайдера здесь нет и быть не может.** Браузер ходит только в Edge Functions
 * (docs/SPEC.md §3): ключи провайдера в бандл не попадают ни при каких условиях.
 */

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'

export type Generation = {
  id: string
  status: GenerationStatus
  kind: GenerationKind
  marketplaceId: string
  categoryId: string
  presetId: string | null
  productTitle: string
  productDescription: string
  wishes: string
  price: number
  title: string | null
  cardTitle: string | null
  cardDescription: string | null
  failureReason: string | null
  sourcePaths: string[]
  createdAt: string
  assets: { storagePath: string; width: number; height: number; format: string }[]
}

const SELECT =
  'id, status, kind, marketplace_id, category_id, preset_id, product_title, product_description,' +
  ' wishes, price, title, card_title, card_description, failure_reason, source_paths, created_at,' +
  ' generation_assets(storage_path, width, height, format)'

type Row = Record<string, unknown> & {
  generation_assets: { storage_path: string; width: number; height: number; format: string }[]
}

function toGeneration(row: Row): Generation {
  return {
    id: row.id as string,
    status: row.status as GenerationStatus,
    kind: row.kind as GenerationKind,
    marketplaceId: row.marketplace_id as string,
    categoryId: row.category_id as string,
    presetId: (row.preset_id as string | null) ?? null,
    productTitle: row.product_title as string,
    productDescription: row.product_description as string,
    wishes: row.wishes as string,
    price: row.price as number,
    title: (row.title as string | null) ?? null,
    cardTitle: (row.card_title as string | null) ?? null,
    cardDescription: (row.card_description as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    sourcePaths: (row.source_paths as string[] | null) ?? [],
    createdAt: row.created_at as string,
    assets: (row.generation_assets ?? []).map((asset) => ({
      storagePath: asset.storage_path,
      width: asset.width,
      height: asset.height,
      format: asset.format,
    })),
  }
}

/* ------------------------------------------------------- распознавание (FR-03, FR-04) */

export type Recognized = { categoryId: string | null; productTitle: string | null }

/**
 * Исход распознавания. `limitReached` отделяет «кончилось» от «не смогли»: для сценария оба
 * ведут в US-E2 — поля заполняются руками, — но человеку это разные новости, и во втором
 * случае ему есть что сделать (войти).
 */
export type RecognizeOutcome = Recognized & { limitReached: boolean }

/**
 * Лимит бесплатных распознаваний исчерпан? `supabase-js` отдаёт неуспешный HTTP отдельным
 * типом ошибки и прячет тело ответа в `context`. Без разбора тела «кончилось» неотличимо от
 * «сломалось» — а различие тут и есть весь смысл.
 */
async function failureBody(error: unknown): Promise<{ code?: string; message?: string }> {
  const response = (error as { context?: unknown } | null)?.context
  if (!(response instanceof Response)) return {}

  const body: unknown = await response.clone().json().catch(() => null)
  const code = (body as { code?: unknown } | null)?.code
  const message = (body as { error?: unknown } | null)?.error

  return {
    code: typeof code === 'string' ? code : undefined,
    message: typeof message === 'string' ? message : undefined,
  }
}

async function isLimitReached(error: unknown): Promise<boolean> {
  return (await failureBody(error)).code === 'recognize_limit'
}

/**
 * Распознаёт товар по фото. Фото уезжают телом запроса, а не путями в бакете: у гостя
 * своей папки в `uploads` нет, а мастер он проходит наравне со всеми (FR-12).
 *
 * Отказ провайдера не роняет шаг: пустой ответ — штатный исход US-E2.
 */
export async function recognizePhotos(photos: DraftPhoto[]): Promise<RecognizeOutcome> {
  const form = new FormData()
  for (const photo of photos) form.append('photo', photo.blob, photo.name)

  const { data, error } = await supabase.functions.invoke<Recognized>('recognize', { body: form })

  if (error || !data) {
    const limitReached = await isLimitReached(error)

    // Исчерпанный лимит — не сбой, и в предупреждения ему незачем: иначе журнал забьётся
    // штатным исходом, и в нём потеряются настоящие отказы провайдера.
    if (!limitReached) logger.warn('Распознавание не удалось', { reason: error?.message })

    return { categoryId: null, productTitle: null, limitReached }
  }

  return { ...data, limitReached: false }
}

/* --------------------------------------------------------------- запуск заявки (US-01) */

export type LaunchInput = {
  userId: string
  photos: DraftPhoto[]
  kind: GenerationKind
  marketplaceId: string
  categoryId: string
  presetId: string | null
  productTitle: string
  productDescription: string
  wishes: string
}

export type LaunchOutcome =
  | { ok: true; generationId: string }
  | { ok: false; code: 'insufficient_credits' | 'failed'; message: string }

/**
 * Кладёт фото в приватный бакет и подаёт заявку.
 *
 * Файлы уходят прямо из браузера, минуя Edge Function: гонять десять мегабайт через
 * функцию незачем, а изоляцию обеспечивает политика бакета — путь начинается с
 * идентификатора владельца (NFR-04).
 */
export async function launchGeneration(input: LaunchInput): Promise<LaunchOutcome> {
  const stamp = Date.now()
  const photoPaths: string[] = []

  for (const [index, photo] of input.photos.entries()) {
    const path = `${input.userId}/${stamp}-${index + 1}-${photo.id}`
    const { error } = await supabase.storage
      .from('uploads')
      .upload(path, photo.blob, { contentType: photo.type, upsert: true })

    if (error) {
      logger.warn('Фото не загрузилось', { reason: error.message })
      return { ok: false, code: 'failed', message: 'Не удалось загрузить фото. Попробуйте ещё раз' }
    }

    photoPaths.push(path)
  }

  const { data, error } = await supabase.functions.invoke<{ generationId: string }>('generate', {
    body: {
      kind: input.kind,
      marketplaceId: input.marketplaceId,
      categoryId: input.categoryId,
      presetId: input.presetId,
      productTitle: input.productTitle,
      productDescription: input.productDescription,
      wishes: input.wishes,
      photoPaths,
    },
  })

  if (error) {
    // Разбираем ТЕЛО отказа, а не только статус. 409 сервер отдаёт на два разных исхода —
    // нехватку баллов и отказ модерации (`generate/index.ts`), и по форме они намеренно
    // одинаковы (US-E3). Различает их поле `code`, а показывать «не хватает баллов»
    // человеку, у которого баллы есть, — врать в лицо: он уйдёт пополнять баланс и
    // получит тот же отказ.
    const status = (error as { context?: { status?: number } }).context?.status
    const failure = await failureBody(error)

    // 409 — единственный отказ, который клиент обязан отличать: баллов не хватило (US-E3),
    // и человека надо увести на пополнение, а не показывать «попробуйте ещё раз».
    if (status === 409 && failure.code !== 'moderation_rejected') {
      return {
        ok: false,
        code: 'insufficient_credits',
        message: failure.message ?? 'Не хватает баллов для запуска генерации',
      }
    }

    // Код ответа — в журнал: без него отказ на чужом устройстве неотличим от обрыва сети,
    // а консоли мобильного браузера у нас нет.
    logger.warn('Заявка отклонена', { status, code: failure.code, reason: error.message })
    return {
      ok: false,
      code: 'failed',
      message: failure.message ?? 'Не удалось запустить генерацию. Попробуйте ещё раз',
    }
  }

  if (!data) {
    return { ok: false, code: 'failed', message: 'Не удалось запустить генерацию. Попробуйте ещё раз' }
  }

  logger.info('Генерация запущена', { generationId: data.generationId })
  return { ok: true, generationId: data.generationId }
}

/* ------------------------------------------------------------- статус и результат (V-07) */

/** Пока идёт работа — переспрашиваем базу. Реже раза в две секунды человек не замечает. */
const RUNNING_POLL_MS = 2000

/**
 * Одна генерация со всеми результатами.
 *
 * Статус читается **из базы**, а не хранится в состоянии вкладки (NFR-02): F5 во время
 * генерации возвращает тот же экран с той же стадией, а закрытая вкладка не отменяет
 * работу — воркер живёт в своём вызове.
 */
export function useGeneration(id: string | undefined): UseQueryResult<Generation> {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['generation', id],
    enabled: id !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'running' ? RUNNING_POLL_MS : false
    },
    queryFn: async (): Promise<Generation> => {
      const { data, error } = await supabase
        .from('generations')
        .select(SELECT)
        .eq('id', id!)
        .single()

      if (error) throw new Error(error.message)
      return toGeneration(data as unknown as Row)
    },
  })

  // Генерация дошла до конца — и каталог, и баланс стали другими: в каталоге появилась
  // запись (FR-01), а при неуспехе вернулись баллы (FR-13). Перечитываем здесь, а не в
  // каждом экране: иначе человек, ушедший в каталог сразу после генерации, увидит список
  // без неё и решит, что заплатил зря.
  const settled = query.data?.status === 'done' || query.data?.status === 'failed'

  useEffect(() => {
    if (!settled) return
    void queryClient.invalidateQueries({ queryKey: ['catalog'] })
    void queryClient.invalidateQueries({ queryKey: ['balance'] })
  }, [settled, queryClient])

  return query
}

/** Каталог генераций (FR-01): только завершённые — неуспешные его не засоряют (US-E4). */
export function useCatalog(userId: string | undefined): UseQueryResult<Generation[]> {
  return useQuery({
    queryKey: ['catalog', userId],
    enabled: userId !== undefined,
    queryFn: async (): Promise<Generation[]> => {
      const { data, error } = await supabase
        .from('generations')
        .select(SELECT)
        .eq('status', 'done')
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)
      return (data as unknown as Row[]).map(toGeneration)
    },
  })
}

/**
 * Подписанная ссылка на файл результата.
 *
 * Бакет приватный, прямого адреса у файла нет (docs/SPEC.md §4). Ссылка живёт минуту —
 * этого хватает и показать превью, и скачать; повторное скачивание из каталога просто
 * просит новую и **баллов не списывает** (FR-17): списывать тут нечего.
 */
export async function signedResultUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('results').createSignedUrl(storagePath, 60)

  if (error || !data) {
    logger.warn('Ссылка на результат не получена', { reason: error?.message })
    return null
  }

  return data.signedUrl
}

/** Скачивание в полном разрешении (FR-14, FR-15): файл, а не превью. */
export async function downloadResult(storagePath: string, fileName: string): Promise<boolean> {
  const { data, error } = await supabase.storage.from('results').download(storagePath)

  if (error || !data) {
    logger.warn('Файл не скачался', { reason: error?.message })
    return false
  }

  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
  return true
}

/**
 * Возвращает мастер к параметрам неуспешной генерации (US-E4: «предложить повторить
 * генерацию **с теми же параметрами**»).
 *
 * Фото приходится выкачивать обратно из `uploads`: черновик очищается при запуске, иначе
 * человек рисковал бы случайно оплатить ту же генерацию второй раз. Внутри срока хранения
 * файлы лежат в его же папке бакета и читаются под RLS.
 *
 * **За сроком хранения фото не будет, и это штатный исход, а не сбой** (веха M5, шаг 6):
 * `UPLOAD_RETENTION_DAYS` дня спустя уборка их удаляет, о чём человеку сказано на экране
 * загрузки. Поэтому пропажа не пишется в `logger.warn` наравне с настоящими отказами и
 * возвращается вызывающему числом: мастер обязан сказать «параметры восстановлены, фото
 * загрузите заново», а не подсунуть пустую загрузку под кнопку «Запустить».
 */
export type DraftRestore = {
  /** Сколько фото исходной заявки вернулось в черновик. */
  restored: number
  /** Сколько не вернулось из-за срока хранения — их и называем человеку. */
  expired: number
}

export async function restoreDraftFrom(generation: Generation): Promise<DraftRestore> {
  const photos: DraftPhoto[] = []
  let expired = 0

  for (const path of generation.sourcePaths) {
    const { data, error } = await supabase.storage.from('uploads').download(path)

    if (error || !data) {
      // 404 — файл убран по сроку хранения; всё остальное (сеть, права, сбой Storage) —
      // настоящий отказ, и он по-прежнему попадает в лог.
      if (isMissingFile(error)) {
        expired += 1
      } else {
        logger.warn('Фото исходной заявки не восстановлено', { reason: error?.message })
      }

      continue
    }

    photos.push({
      id: crypto.randomUUID(),
      name: path.split('/').pop() ?? 'photo.jpg',
      type: data.type === '' ? 'image/jpeg' : data.type,
      size: data.size,
      blob: data,
    })
  }

  const draft: WizardDraft = {
    // Человек уже всё выбрал: возвращаем его на шаг запуска, а не в начало мастера.
    // Кроме случая, когда фото не пережили срок хранения: возвращаем на «Фото» и при
    // частичной пропаже тоже. Иначе человек оказался бы перед кнопкой «Запустить» с
    // неполным набором и заплатил за генерацию по одному фото вместо четырёх, ничего об
    // этом не узнав. Остальные параметры при этом остаются — распознавание их не
    // перетрёт, оно заполняет только пустое.
    step: expired > 0 ? 0 : LAST_STEP,
    photos,
    productTitle: generation.productTitle,
    productDescription: generation.productDescription,
    categoryId: generation.categoryId,
    marketplaceId: generation.marketplaceId,
    kind: generation.kind,
    presetId: generation.presetId,
    wishes: generation.wishes,
    recognized: true,
  }

  await writeDraft(draft)

  return { restored: photos.length, expired }
}

/**
 * Файла нет — против «не смогли его прочитать».
 *
 * Storage отвечает на пропажу 404, и `StorageApiError` несёт код и статусом (`status`), и
 * строкой (`statusCode`) — в разных версиях клиента по-разному, поэтому смотрим оба, а не
 * разбираем текст сообщения.
 */
function isMissingFile(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false

  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown }
  return status === 404 || statusCode === '404' || statusCode === 404
}

/** После запуска баланс и каталог другие — обе выборки перечитываются. */
export function useInvalidateAfterLaunch(userId: string | undefined): () => Promise<void> {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['balance', userId] }),
      queryClient.invalidateQueries({ queryKey: ['catalog', userId] }),
    ])
  }
}
