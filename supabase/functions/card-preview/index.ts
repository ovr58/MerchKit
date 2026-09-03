/**
 * Бесплатное превью карточки до оплаты — шаг B6, коррекция K-1.
 *
 * **Ни баллов, ни вендора.** Функция подбирает макет тем же кодом, что и воркер, наполняет
 * его заглушками (`preview.ts`) и рисует своим растеризатором. Платного здесь нет ничего,
 * поэтому превью можно пересчитывать после каждой правки списка свойств — ради этого шаг и
 * существует.
 *
 * **Кадр уменьшен, и это не экономия на качестве.** Превью смотрят в браузере, а процессорное
 * время изолята — единственный ограничитель сборки: замер 2026-09-03 на всех 34 макетах
 * библиотеки дал в размере профиля площадки медиану 694 мс при жёстком пределе супервизора в
 * две секунды, а один макет не уложился в него вовсе. В превью-размере худший макет — 686 мс.
 *
 * Проверить локально:
 *   supabase functions serve card-preview
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/card-preview -H "Authorization: Bearer <jwt>"
 */

import { callerId, CORS_HEADERS, failure, json, selectFromDatabase } from '../_shared/edge.ts'
import { previewFilling, type PreviewProperty } from '../_shared/card-layout/preview.ts'
import { renderPreview } from '../_shared/card-layout/render.ts'
import {
  selectCardLayout,
  type LayoutCandidate,
  type LayoutSelectionInput,
} from '../_shared/card-layout/selection.ts'
import type { FontFamilies } from '../_shared/card-layout/svg.ts'
import type { CardLayout, FontRole } from '../_shared/card-layout/types.ts'

type LayoutRow = {
  id: string
  title: string
  layout: CardLayout
  category_id: string | null
  marketplace_id: string | null
  preset_id: string | null
  is_fallback: boolean
}

type ProfileRow = { width: number; height: number; aspect_w: number; aspect_h: number }
type FontRoleRow = { role: FontRole; family: string }

/**
 * Длинная сторона превью. Пропорцию задаёт профиль площадки, а уменьшение ничего не искажает:
 * вся геометрия макета записана долями холста, поэтому строка, влезающая в уменьшенный кадр,
 * влезает и в полноразмерный.
 */
const PREVIEW_LONG_SIDE = 960

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return failure('Метод не поддерживается', 405)

  const userId = await callerId(request)
  if (userId === null) return failure('Требуется вход', 401)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const categoryId = text(body?.categoryId)
  const marketplaceId = text(body?.marketplaceId)

  if (categoryId === '' || marketplaceId === '') {
    return failure('Не заданы категория и площадка', 400)
  }

  try {
    const [profile, fonts] = await Promise.all([readProfile(marketplaceId, categoryId), readFonts()])

    if (profile === null) {
      return failure('Для этой пары «площадка × категория» нет профиля вывода', 400)
    }

    const properties = readProperties(body?.properties)
    const hasLogo = body?.hasLogo === true
    const selected = await selectLayout({
      categoryId,
      marketplaceId,
      presetId: text(body?.presetId) === '' ? null : text(body?.presetId),
      hasLogo,
      propertyCount: properties.length,
      targetAspectW: profile.aspect_w,
      targetAspectH: profile.aspect_h,
    })

    const filling = previewFilling(selected.layout, {
      productTitle: text(body?.productTitle),
      properties,
      hasLogo,
    })

    const size = previewSize(profile)
    const rendered = await renderPreview(selected.layout, filling.content, size, fonts)

    return json({
      layout: { id: selected.id, title: selected.title, isFallback: selected.isFallback },
      size,
      capacity: filling.capacity,
      cut: filling.cut,
      stubbed: filling.stubbed,
      dropped: rendered.dropped,
      overflows: rendered.overflows,
      png: `data:image/png;base64,${base64(rendered.bytes)}`,
    })
  } catch (error: unknown) {
    console.error('Превью карточки не собрано', error)
    return failure('Не удалось собрать превью. Попробуйте ещё раз', 503)
  }
})

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Список свойств приезжает из браузера — граница недоверенная, как и ответ модели у B1. */
function readProperties(value: unknown): PreviewProperty[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return []
    const { label, value: propertyValue } = entry as { label?: unknown; value?: unknown }
    const property = { label: text(label), value: text(propertyValue) }
    return property.label === '' && property.value === '' ? [] : [property]
  })
}

async function readProfile(marketplaceId: string, categoryId: string): Promise<ProfileRow | null> {
  const [row] = (await selectFromDatabase(
    `marketplace_output_profiles?marketplace_id=eq.${encodeURIComponent(marketplaceId)}` +
      `&category_id=eq.${encodeURIComponent(categoryId)}&select=width,height,aspect_w,aspect_h`,
  )) as ProfileRow[]

  return row ?? null
}

async function readFonts(): Promise<FontFamilies> {
  const rows = (await selectFromDatabase('card_font_roles?select=role,family')) as FontRoleRow[]
  return Object.fromEntries(rows.map((row) => [row.role, row.family])) as FontFamilies
}

/**
 * Тот же подбор, что у воркера (шаг B2), и намеренно с тем же вводом: макет, показанный до
 * оплаты, обязан совпасть с тем, который соберётся после неё.
 */
async function selectLayout(input: LayoutSelectionInput): Promise<LayoutCandidate & { title: string }> {
  const columns = 'select=id,title,layout,category_id,marketplace_id,preset_id,is_fallback'
  const [layouts, fallbacks] = await Promise.all([
    selectFromDatabase(`card_layouts?category_id=eq.${encodeURIComponent(input.categoryId)}&${columns}`),
    selectFromDatabase(`card_layouts?is_fallback=is.true&${columns}&order=id&limit=1`),
  ])

  const fallback = (fallbacks as LayoutRow[])[0]
  if (fallback === undefined) throw new Error('В библиотеке нет универсального макета')

  const titles = new Map([...(layouts as LayoutRow[]), fallback].map((row) => [row.id, row.title]))
  const selected = selectCardLayout((layouts as LayoutRow[]).map(toCandidate), toCandidate(fallback), input)

  return { ...selected, title: titles.get(selected.id) ?? selected.id }
}

function toCandidate(row: LayoutRow): LayoutCandidate {
  return {
    id: row.id,
    layout: row.layout,
    categoryId: row.category_id,
    marketplaceId: row.marketplace_id,
    presetId: row.preset_id,
    isFallback: row.is_fallback,
  }
}

function previewSize(profile: ProfileRow): { width: number; height: number } {
  const scale = PREVIEW_LONG_SIDE / Math.max(profile.width, profile.height)
  return scale >= 1
    ? { width: profile.width, height: profile.height }
    : { width: Math.round(profile.width * scale), height: Math.round(profile.height * scale) }
}

/** Растр через spread уронил бы стек: мегабайтная строка кодируется кусками. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 8192
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}
