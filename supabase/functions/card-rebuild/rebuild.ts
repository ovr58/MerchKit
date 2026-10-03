/**
 * Логика `card-rebuild` — шаг B7.5 плана `card-assembly-pipeline_2026-08-31.md`.
 *
 * Лежит отдельно от `index.ts`, и дело не во вкусе: `index.ts` обязан вызывать `Deno.serve` и
 * тянет растеризатор с `npm:`-импортом, а обработчик, который нельзя запустить без них, нельзя
 * и проверить. Здесь всё внешнее — вызывающий, база, хранилище, квота, растеризатор — приходит
 * зависимостями, поэтому тест гоняет настоящий код с подставными выводом-вводом.
 *
 * **Бесплатно и без вендора.** Ни `ledger`, ни баланс, ни провайдер сюда не дотягиваются: у
 * зависимостей нет ни одного вызова в эту сторону. Пересборка берёт то, что сборка уже
 * сохранила (B7.4) — снимок макета, кадр, вырез и знак, — и кладёт поверх новые тексты.
 *
 * Два режима по телу запроса: чтение (`{ generationId }`) наполняет форму правки, пересборка
 * (`{ generationId, texts, properties, fontMap? }`) собирает карточку заново.
 */

import { CORS_HEADERS, failure, json } from '../_shared/edge.ts'
import { propertyCapacity } from '../_shared/card-layout/features.ts'
import { cardFilling, fromStored, storedContent, type StoredContent } from '../_shared/card-layout/filling.ts'
import type { DownloadFile } from '../_shared/card-layout/renderer-assets.ts'
import type { PreviewRenderResult } from '../_shared/card-layout/render.ts'
import type { FontFamilies } from '../_shared/card-layout/svg.ts'
import { textMismatches } from '../_shared/card-layout/text-check.ts'
import { FONT_ROLES, type CardLayout, type FontRole } from '../_shared/card-layout/types.ts'

export type RebuildDeps = {
  callerId: (request: Request) => Promise<string | null>
  /** Чтение таблицы с service-role (`selectFromDatabase`). */
  select: (query: string) => Promise<unknown[]>
  /** Один шаг счётчика суток: `true` — пускаем (`consume_daily_quota`). */
  consumeQuota: (key: string, limit: number) => Promise<boolean>
  download: DownloadFile
  upload: (bucket: string, path: string, bytes: Uint8Array, contentType: string) => Promise<void>
  /** `record_card_assembly`: содержимое и карта шрифтов в снимок. Снимок макета не трогает. */
  recordAssembly: (generationId: string, content: StoredContent, fontMap: FontFamilies) => Promise<void>
  /** Тексты и свойства генерации — тем же заходом, что и растр, чтобы экран и файл не разошлись. */
  updateGeneration: (
    generationId: string,
    userId: string,
    patch: { card_title: string; card_description: string; product_properties: Property[] },
  ) => Promise<void>
  render: (
    layout: CardLayout,
    content: ReturnType<typeof cardFilling>['content'],
    size: { width: number; height: number },
    fonts: FontFamilies,
  ) => Promise<PreviewRenderResult>
  /** Потолок пересборок на пользователя в сутки. */
  dailyLimit: number
}

type Property = { label: string; value: string }

type GenerationRow = {
  user_id: string
  status: string
  kind: string
  card_title: string | null
  card_description: string | null
  product_properties: unknown
}

type CardRow = { layout: CardLayout; content: StoredContent; font_map: Partial<FontFamilies> | null }
type AssetRow = { storage_path: string; width: number; height: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ошибка запроса с кодом ответа: ловится на границе обработчика и становится `failure`. */
class Reject extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function createRebuildHandler(deps: RebuildDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (request.method !== 'POST') return failure('Метод не поддерживается', 405)

    try {
      return await handle(deps, request)
    } catch (error: unknown) {
      if (error instanceof Reject) return failure(error.message, error.status)

      console.error('Пересборка карточки не выполнена', error)
      return failure('Не удалось пересобрать карточку. Попробуйте ещё раз', 503)
    }
  }
}

async function handle(deps: RebuildDeps, request: Request): Promise<Response> {
  const userId = await deps.callerId(request)
  if (userId === null) return failure('Требуется вход', 401)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const generationId = body?.generationId

  // Идентификатор уходит в фильтр запроса, поэтому проверяется его форма, а не только тип.
  if (typeof generationId !== 'string' || !UUID.test(generationId)) {
    return failure('Не указана генерация', 400)
  }

  const [generation] = (await deps.select(
    `generations?id=eq.${generationId}` +
      '&select=user_id,status,kind,card_title,card_description,product_properties',
  )) as GenerationRow[]

  // Чужая и несуществующая — один и тот же отказ: по разнице кодов чужие идентификаторы
  // можно было бы перебирать.
  if (generation === undefined || generation.user_id !== userId) {
    return failure('Это не ваша генерация', 403)
  }

  if (generation.kind !== 'card' || generation.status !== 'done') {
    return failure('Править можно только готовую карточку', 400)
  }

  const [card, fonts] = await Promise.all([readCard(deps, generationId), readFontBase(deps)])
  const { roleFonts, fontOptions } = fonts

  if (card === null) return failure('У карточки нет снимка макета: пересобрать её нельзя', 400)

  // Карта шрифтов собирается слоями: сегодняшние роли < сохранённая со сборки < выбор человека.
  // Нижний слой нужен снимку, записанному до того, как у ролей появилась карта.
  const storedFonts = { ...roleFonts, ...card.font_map } as FontFamilies

  if (body?.texts === undefined) {
    return json({
      rebuildable: isRebuildable(card.content),
      texts: { title: generation.card_title ?? '', description: generation.card_description ?? '' },
      properties: readProperties(generation.product_properties),
      layoutTitle: card.layout.title,
      capacity: propertyCapacity(card.layout),
      fontMap: storedFonts,
      fontOptions,
    })
  }

  const texts = readTexts(body.texts)
  const properties = readProperties(body.properties)
  const fontMap = chooseFonts(storedFonts, fontOptions, body.fontMap)

  if (!isRebuildable(card.content)) {
    return failure('Эта карточка собрана до появления правки: пересобрать её нельзя', 400)
  }

  // Не счётчик молчит — отказ, а не пропуск: открыть тяжёлую сборку ровно тогда, когда за ней
  // некому следить, хуже, чем отказать (так же, как у превью).
  let allowed: boolean
  try {
    allowed = await deps.consumeQuota(`rebuild:user:${userId}`, deps.dailyLimit)
  } catch (error: unknown) {
    console.error('Счётчик пересборок недоступен', error)
    return failure('Пересборка временно недоступна. Попробуйте позже', 503)
  }
  if (!allowed) return failure('Пересборки на сегодня закончились. Попробуйте завтра', 429)

  const [asset] = (await deps.select(
    `generation_assets?generation_id=eq.${generationId}&select=storage_path,width,height&order=id&limit=1`,
  )) as AssetRow[]
  if (asset === undefined) throw new Error(`У генерации ${generationId} нет файла результата`)

  const stored = card.content
  const restored = await fromStored(stored, deps.download)
  const filling = cardFilling(card.layout, {
    ...texts,
    properties,
    frame: restored.frames![0],
    cutout: restored.cutout ?? null,
    logo: restored.logo ?? null,
  })

  // Механическая приёмка (C1) на каждой сборке, и пересборка — сборка: заголовок и описание в
  // кадре — ровно те слова, что прислал человек. До любой записи: при расхождении файл, снимок
  // и тексты остаются прежними. Статус 500, а не 400: ввод был годным, слова потеряла наша
  // сборка, и повтор того же запроса этого не лечит. Квота уже списана — как у неудачного превью.
  const mismatched = textMismatches(card.layout, filling.content, {
    title: [texts.title],
    body: [texts.description],
  })
  if (mismatched.length > 0) {
    console.error('Пересборка', generationId, 'потеряла слова в гнёздах:', mismatched)
    throw new Reject('Карточка не собралась без потерь: текст в кадре расходится с введённым. Изменения не сохранены', 500)
  }

  // Размер — у файла, который заменяем: сборка обязана вернуть то же, что площадка уже приняла.
  const rendered = await deps.render(card.layout, filling.content, { width: asset.width, height: asset.height }, fontMap)

  // Порядок: файл → снимок → тексты. Обрыв на любом шаге лечится повтором того же запроса:
  // каждый шаг пишет одно и то же второй раз, а не прибавляет.
  await deps.upload('results', asset.storage_path, rendered.bytes, 'image/png')
  await deps.recordAssembly(
    generationId,
    storedContent(filling.content, {
      frames: stored.frames!.map((frame) => frame.path),
      cutout: stored.cutout?.path,
      logo: stored.logo?.path,
    }),
    fontMap,
  )
  await deps.updateGeneration(generationId, userId, {
    card_title: texts.title,
    card_description: texts.description,
    product_properties: properties,
  })

  return json({
    storagePath: asset.storage_path,
    layoutTitle: card.layout.title,
    capacity: propertyCapacity(card.layout),
    cut: filling.cut,
    dropped: rendered.dropped,
    overflows: rendered.overflows,
  })
}

/** Кадр есть среди сохранённого: карточка собрана после B7.4, иначе собирать не из чего. */
function isRebuildable(content: StoredContent): boolean {
  return Array.isArray(content?.frames) && content.frames.length > 0
}

async function readCard(deps: RebuildDeps, generationId: string): Promise<CardRow | null> {
  const [row] = (await deps.select(
    `generation_cards?generation_id=eq.${generationId}&select=layout,content,font_map`,
  )) as CardRow[]
  return row ?? null
}

/**
 * Шрифты базы одним заходом: сегодняшнее отображение «роль → гарнитура» (тем же запросом, что
 * у превью) и гарнитуры, из которых человек выбирает по каждой роли, — семьи базы × роли базы.
 */
async function readFontBase(
  deps: RebuildDeps,
): Promise<{ roleFonts: Partial<FontFamilies>; fontOptions: Record<string, string[]> }> {
  const [roles, families] = (await Promise.all([
    deps.select('card_font_roles?select=role,family&order=role'),
    deps.select('card_font_families?select=family&order=family'),
  ])) as [{ role: FontRole; family: string }[], { family: string }[]]

  const names = families.map((row) => row.family)
  return {
    roleFonts: Object.fromEntries(roles.map((row) => [row.role, row.family])),
    fontOptions: Object.fromEntries(roles.map((row) => [row.role, names])),
  }
}

/**
 * Карта шрифтов после выбора. Роль и гарнитура приходят из браузера — граница недоверенная,
 * поэтому неизвестная роль и гарнитура вне списка роли — отказ, а не тихая замена.
 */
function chooseFonts(
  stored: FontFamilies,
  options: Record<string, string[]>,
  requested: unknown,
): FontFamilies {
  if (requested === undefined || requested === null) return stored
  if (typeof requested !== 'object' || Array.isArray(requested)) throw new Reject('Карта шрифтов задана неверно', 400)

  const chosen = { ...stored }
  for (const [role, family] of Object.entries(requested)) {
    const allowed = (FONT_ROLES as readonly string[]).includes(role) ? options[role] : undefined
    if (allowed === undefined || typeof family !== 'string' || !allowed.includes(family)) {
      throw new Reject(`Гарнитура «${String(family)}» недоступна для роли «${role}»`, 400)
    }
    chosen[role as FontRole] = family
  }
  return chosen
}

function readTexts(value: unknown): { title: string; description: string } {
  const { title, description } = (value ?? {}) as { title?: unknown; description?: unknown }
  const texts = { title: text(title), description: text(description) }

  // Половину карточки не отдаём (US-E4): заголовок и описание не пустеют и при правке.
  if (texts.title === '' || texts.description === '') {
    throw new Reject('Заголовок и описание не могут быть пустыми', 400)
  }
  return texts
}

/** Свойства — недоверенная граница: и тело запроса, и `jsonb` генерации разбираются одним кодом. */
function readProperties(value: unknown): Property[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []
    const { label, value: propertyValue } = entry as { label?: unknown; value?: unknown }
    const property = { label: text(label), value: text(propertyValue) }
    return property.label === '' && property.value === '' ? [] : [property]
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
