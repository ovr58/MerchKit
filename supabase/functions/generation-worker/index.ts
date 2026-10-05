/**
 * `generation-worker` (docs/SPEC.md §3): вызов провайдера, сохранение результатов и
 * финализация статуса.
 *
 * Живёт отдельным вызовом, а не хвостом приёмки заявки: у него свой бюджет времени, и
 * пользователь к этому моменту уже получил `generationId` и может закрыть вкладку (NFR-02).
 *
 * **Правило вехи: либо всё, либо ничего** (решение пользователя 2026-08-29, V-07). Любой
 * неуспех — молчание провайдера, кадр не по профилю, отсутствующие тексты карточки —
 * приводит в одну точку: `fail_generation`, полный возврат баллов, ничего не отдано
 * (FR-13, US-E4). Половину карточки продавцу отдавать бессмысленно, а объяснять, за что
 * списано 50 из 55, дороже, чем вернуть всё.
 *
 * Проверить локально (он же способ воспроизвести повторную доставку события, NFR-03):
 *   curl -sX POST http://127.0.0.1:54321/functions/v1/generation-worker \
 *     -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
 *     -d '{"generationId":"<id>"}'
 */

import {
  createProvider,
  type AiProvider,
  type CardTexts,
  type OutputProfile,
  type ProductBrief,
  type ProviderUsage,
} from '../_shared/ai-provider/index.ts'
import {
  callDatabase,
  CORS_HEADERS,
  downloadFile,
  failure,
  isServiceRoleCaller,
  json,
  selectFromDatabase,
  uploadFile,
} from '../_shared/edge.ts'
import { mimeOf, readImageInfo } from '../_shared/image.ts'
import { cardAssemblySize } from '../_shared/card-size.ts'
import { describeProfileMismatch } from '../_shared/output-profile.ts'
import { createCutoutRunner, createLayoutRunner, createMaskRunner } from '../_shared/card-layout/cutout.ts'
import type { CardDirection } from '../_shared/card-layout/direction.ts'
import { directorLogLine, runDirector, type DirectorResult } from '../_shared/card-layout/director-run.ts'
import { usesCutout } from '../_shared/card-layout/features.ts'
import { cardFilling, imageBytes, imageRef, storedContent } from '../_shared/card-layout/filling.ts'
import { authorLayout } from '../_shared/card-layout/html/author.ts'
import { pickReferences, type ReferenceRow } from '../_shared/card-layout/html/references.ts'
import { readIcons } from '../_shared/card-layout/icons.ts'
import { occupancyOf, type MaskSamples } from '../_shared/card-layout/occupancy.ts'
import { measureText, renderCard } from '../_shared/card-layout/render.ts'
import { layoutQueries, layoutSnapshot, selectCardLayout, type LayoutCandidate } from '../_shared/card-layout/selection.ts'
import type { FontFamilies } from '../_shared/card-layout/svg.ts'
import { textMismatches } from '../_shared/card-layout/text-check.ts'
import { firstWordFits, fitTitle, titleCharLimit, titleFits } from '../_shared/card-layout/title-fit.ts'
import type { CardContent, CardLayout, FontRole, ImageRef } from '../_shared/card-layout/types.ts'
import type { GenerationKind } from '../_shared/pricing.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type GenerationRow = {
  id: string
  user_id: string
  status: string
  kind: GenerationKind
  marketplace_id: string
  category_id: string
  preset_id: string | null
  product_title: string
  product_description: string
  wishes: string
  product_properties: unknown[]
  objects_count: number
  source_paths: string[]
  logo_path: string | null
  categories: { title: string } | null
  marketplaces: { title: string } | null
  presets: { title: string; prompt: string } | null
}

type ProfileRow = {
  width: number
  height: number
  min_width: number
  min_height: number
  aspect_w: number
  aspect_h: number
  aspect_label: string
  formats: string[]
  max_bytes: number
  color_space: string
  background_hex: string
  background_title: string
}

type FontRoleRow = { role: FontRole; family: string }

type LayoutRow = {
  id: string
  layout: CardLayout
  category_id: string | null
  marketplace_id: string | null
  preset_id: string | null
  is_fallback: boolean
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return failure('Метод не поддерживается', 405)
  }

  // Воркер — внутренняя дорога. Пользователь с валидным токеном сюда не ходит: иначе он
  // мог бы гонять провайдера по чужим заявкам за наш счёт.
  if (!isServiceRoleCaller(request)) {
    return failure('Требуется вход', 401)
  }

  const body: unknown = await request.json().catch(() => null)
  const generationId = (body as { generationId?: unknown } | null)?.generationId

  // Идентификатор уходит в фильтр запроса, поэтому проверяется его форма, а не только тип.
  // Значение приходит от нашего же сервера — но «приходит от своих» не проверка.
  if (typeof generationId !== 'string' || !UUID.test(generationId)) {
    return failure('Не указана генерация', 400)
  }

  const [generation] = (await selectFromDatabase(
    `generations?id=eq.${generationId}` +
      '&select=*,categories(title),marketplaces(title),presets(title,prompt)',
  )) as GenerationRow[]

  if (generation === undefined) {
    return failure('Генерация не найдена', 404)
  }

  // Повторная доставка события: работа уже сделана или уже провалена. Ни того ни другого
  // переигрывать нельзя — иначе повтор события списал бы или вернул баллы второй раз.
  if (generation.status !== 'queued' && generation.status !== 'running') {
    console.info('Генерация', generationId, 'уже в состоянии', generation.status)
    return json({ status: generation.status })
  }

  await callDatabase('start_generation', { target_generation: generationId })

  // Собирается за весь прогон и пишется в БД на ОБОИХ исходах (шаг 4 плана вехи M5): вендор
  // мог быть оплачен до отказа (например, изображение получено, а тексты карточки — нет),
  // и эти рубли реальны независимо от того, что решит `fail_generation`.
  const usage: ProviderUsage[] = []

  try {
    const status = await run(generation, usage)
    await persistCosts(generationId, usage)
    return json({ status })
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'Провайдер не ответил'
    console.error('Генерация', generationId, 'не удалась:', reason)

    await persistCosts(generationId, usage)

    // Единственная точка неуспеха: статус и полный возврат — одной транзакцией.
    await callDatabase('fail_generation', {
      owner_id: generation.user_id,
      target_generation: generationId,
      reason: humanReason(reason),
    })

    return json({ status: 'failed' })
  }
})

/** Бухгалтерия себестоимости не должна ронять и не должна откатывать саму генерацию — отказ
 *  записи только логируется, а не превращает удавшуюся генерацию в неудавшуюся. */
async function persistCosts(generationId: string, usage: ProviderUsage[]): Promise<void> {
  if (usage.length === 0) return

  try {
    await callDatabase('record_generation_costs', { target_generation: generationId, entries: usage })
  } catch (error: unknown) {
    console.error('Генерация', generationId, 'себестоимость не записана:', error)
  }
}

/** Наружу уходит человеческий текст: устройство провайдера — не дело пользователя. */
function humanReason(reason: string): string {
  if (reason.includes('тексты карточки')) return 'Карточка не собралась целиком'
  if (reason.includes('профил')) return 'Изображение вернулось не в том формате, что нужен площадке'
  return 'Провайдер не смог выполнить генерацию'
}

async function run(generation: GenerationRow, usage: ProviderUsage[]): Promise<string> {
  const [profileRow] = (await selectFromDatabase(
    `marketplace_output_profiles?marketplace_id=eq.${generation.marketplace_id}` +
      `&category_id=eq.${generation.category_id}&select=*`,
  )) as ProfileRow[]

  if (profileRow === undefined) {
    throw new Error(`Нет профиля для пары ${generation.marketplace_id} × ${generation.category_id}`)
  }

  const profile: OutputProfile = {
    marketplaceId: generation.marketplace_id,
    marketplaceTitle: generation.marketplaces?.title ?? generation.marketplace_id,
    categoryId: generation.category_id,
    width: profileRow.width,
    height: profileRow.height,
    minWidth: profileRow.min_width,
    minHeight: profileRow.min_height,
    aspectW: profileRow.aspect_w,
    aspectH: profileRow.aspect_h,
    aspectLabel: profileRow.aspect_label,
    formats: profileRow.formats,
    maxBytes: profileRow.max_bytes,
    colorSpace: profileRow.color_space,
    backgroundHex: profileRow.background_hex,
    backgroundTitle: profileRow.background_title,
  }

  let layout: CardLayout | null = null

  // Размер собранной карточки — `cardAssemblySize`: пока сборка в изоляте, большой профиль
  // (Ozon «Одежда», «Аксессуары») собирается в порог площадки, а не в целевой кадр. Снять
  // при переезде сборки на коробку (ADR-0015), решение Q-2 шага B7.7. Нужен ещё до подбора
  // макета (B32: первое слово заголовка должно влезать в бокс) и до текстов: заголовок
  // пишется под бокс макета в этом размере (B7.8).
  const cardProfile: OutputProfile = { ...profile, ...cardAssemblySize(profile) }
  const fonts = generation.kind === 'card' ? await readFonts() : null

  if (generation.kind === 'card' && fonts !== null) {
    const measure = await measureText()
    const selection = await selectLayout(generation, profile, (candidate) =>
      firstWordFits(candidate, cardProfile, fonts, measure, generation.product_title))
    const snapshot = layoutSnapshot(generation.id, selection)
    await callDatabase('snapshot_generation_layout', {
      target_generation: snapshot.generationId,
      selected_layout: snapshot.layoutId,
      selected_snapshot: snapshot.layout,
    })
    layout = snapshot.layout
  }

  const product: ProductBrief = {
    title: generation.product_title,
    description: generation.product_description,
    categoryTitle: generation.categories?.title ?? generation.category_id,
    presetPrompt: generation.presets?.prompt ?? null,
    presetTitle: generation.presets?.title ?? null,
    wishes: generation.wishes,
  }

  const photos = await Promise.all(
    generation.source_paths.map((path) => downloadFile('uploads', path)),
  )

  const provider = createProvider(undefined, (entry) => usage.push(entry))

  // Тексты карточки — вторая независимая операция, и её отказ равносилен отказу целиком
  // (US-E4). Нужны дважды: в поля `title_of_card` / `description_of_card` (FR-07 требует их
  // и отдельно от изображения) и в гнёзда макета на сборке. Модели изображений они не
  // передаются — сцену она рисует без текста (ADR-0012). Идут ДО изображения, потому что их
  // отказ так не стоит уже оплаченного кадра.
  const card = layout !== null && fonts !== null
    ? await composeFittedCard({ generation, provider, product, profile, layout, size: cardProfile, fonts })
    : null

  const images = await provider.generateImages({
    photos,
    product,
    profile,
    kind: generation.kind,
    objects: generation.objects_count,
  })

  if (images.length === 0) {
    throw new Error('Провайдер не вернул ни одного изображения')
  }

  // У карточки пользователю уходит не кадр вендора, а собранный по макету файл; у фото —
  // кадр как есть. Сверка с профилем — по тому, что уходит.
  const assembly = layout !== null && card !== null && fonts !== null
    ? await assembleCard(generation, layout, card, images[0].bytes, cardProfile, fonts, provider)
    : null
  const results = assembly !== null ? [assembly.bytes] : images.map((image) => image.bytes)

  // Профиль уходил В запрос, но верить на слово нельзя: файл не по требованиям площадки —
  // это файл, за который пользователь заплатил зря (FR-25). Собранную карточку — на точный
  // размер сборки (её рисуем мы), кадр фото — порогом и допуском, как и до сборки.
  for (const bytes of results) {
    const mismatch = assembly !== null
      ? describeProfileMismatch(bytes, cardProfile, { exact: true })
      : describeProfileMismatch(bytes, profile)

    if (mismatch !== null) {
      throw new Error(`Изображение не подходит профилю площадки: ${mismatch}`)
    }
  }

  const title = await provider.nameGeneration({ product })

  const assets = await Promise.all(
    results.map(async (bytes, index) => {
      // Формат берётся из самого файла, а не из профиля: профиль перечисляет, что площадка
      // ПРИНИМАЕТ, а вендор выбирает из этого списка сам. Записать сюда `profile.formats[0]`
      // значило бы положить в каталог PNG под именем `.jpg` и с записью «jpeg» в базе.
      const info = readImageInfo(bytes)!
      const path = `${generation.user_id}/${generation.id}/result-${index + 1}.${info.format}`
      await uploadFile('results', path, bytes, mimeOf(info.format))
      return { storage_path: path, width: info.width, height: info.height, format: info.format }
    }),
  )

  if (assembly !== null && layout !== null) await storeAssembly(generation, layout, assembly)

  await callDatabase('finish_generation', {
    target_generation: generation.id,
    generated_title: title.trim() === '' ? generation.product_title : title,
    title_of_card: card?.title ?? null,
    description_of_card: card?.description ?? null,
    assets,
  })

  console.info('Генерация', generation.id, 'завершена')
  return 'done'
}

/**
 * Тексты карточки с заголовком под бокс макета (шаг B7.8, решение Q-4).
 *
 * Модели говорят предел в знаках, но верят ему не на слово: ответ проверяется обмером тем же
 * растеризатором, что рисует карточку, и при переполнении режется по словам. Карточку из-за
 * длины заголовка не отказываем, шрифт не сжимаем. Обрезанный заголовок идёт и в
 * `title_of_card`, и в гнездо макета — C1 сравнивает кадр именно с ним.
 */
async function composeFittedCard(args: {
  generation: GenerationRow
  provider: AiProvider
  product: ProductBrief
  profile: OutputProfile
  layout: CardLayout
  size: { width: number; height: number }
  fonts: FontFamilies
}): Promise<CardTexts> {
  const measure = await measureText()
  const titleLimit = titleCharLimit(args.layout, args.size, args.fonts, measure)

  const card = await args.provider.composeCard({ product: args.product, profile: args.profile, titleLimit })

  if (card.title.trim() === '' || card.description.trim() === '') {
    throw new Error('Провайдер не вернул тексты карточки')
  }

  const title = fitTitle(card.title, titleFits(args.layout, args.size, args.fonts, measure))

  if (title !== card.title.trim()) {
    console.info(`Заголовок: «${card.title}» → «${title}» (предел ${titleLimit ?? 'не задан'} зн.)`,
      '· генерация', args.generation.id)
  }

  return { ...card, title }
}

type Assembly = {
  /** Собранная карточка, PNG ровно в размер профиля. */
  bytes: Uint8Array
  /** Исходники пересборки (B7.5): кадр вендора и вырез, если он есть. */
  frame: Uint8Array
  cutout: Uint8Array | null
  /** Содержимое без правки арт-директора: пересборка (B5.9) накладывает правку на него. */
  content: CardContent
  fonts: FontFamilies
  /** Итоговый патч арт-директора и сдвига; `null` — ступень 4 или арт-директор выключен. */
  direction: CardDirection | null
  /** Транспилированный макет принятого сочинения (ADR-0019, п. 6); `null` — карточка по макету
   *  библиотеки: сочинение выключено или откатилось. */
  authored: CardLayout | null
}

/**
 * Сборка карточки по снимку макета (шаг B7.1): кадр вендора → вырез → содержимое →
 * арт-директор (B5.8) → растр.
 *
 * Сверка с профилем — у вызывающего, по собранным байтам: тем же правилом, что и у фото.
 */
async function assembleCard(
  generation: GenerationRow,
  layout: CardLayout,
  card: CardTexts,
  frameBytes: Uint8Array,
  profile: OutputProfile,
  fonts: FontFamilies,
  provider: AiProvider,
): Promise<Assembly> {
  // Вендор отдаёт один кадр; слои второго кадра снимаются правилом K-3.
  const frame = imageRef(frameBytes)

  // Вырез — только если макет его использует и сервис настроен. Секретов нет — карточка
  // собирается без выреза, слой снимается K-3; любой отказ сервиса раннер сам превращает в
  // `null` (ADR-0016), генерация из-за коробки не теряется.
  const endpoint = Deno.env.get('CUTOUT_ENDPOINT')
  const secret = Deno.env.get('CUTOUT_SECRET')

  // Сочинение карточки включается секретом `CARD_AUTHOR=on` (ADR-0019, п. 2), а не деплоем; при
  // нём арт-директор не зовётся — ни маски, ни `directCard`.
  const authorOn = Deno.env.get('CARD_AUTHOR') === 'on'

  // Арт-директор включается секретом `CARD_DIRECTOR=on` (ADR-0018, п. 3), а не деплоем. Выключен —
  // маски нет, вызова нет, сборка как раньше. Маска и вырез идут вместе: оба — по инференсу на
  // коробке, и ждать их друг за другом значило бы складывать время.
  const directorOn = !authorOn && Deno.env.get('CARD_DIRECTOR') === 'on'
  const maskEndpoint = Deno.env.get('CUTOUT_MASK_ENDPOINT')

  const [cutout, maskSamples] = await Promise.all([
    usesCutout(layout) && endpoint && secret ? createCutoutRunner({ endpoint, secret })(frame) : null,
    directorOn && maskEndpoint && secret ? createMaskRunner({ endpoint: maskEndpoint, secret })(frame) : null,
  ])

  const logo = generation.logo_path === null
    ? null
    : await downloadFile('uploads', generation.logo_path).then(imageRef)

  const properties = readProperties(generation.product_properties)
  const { content, cut } = cardFilling(layout, {
    title: card.title,
    description: card.description,
    properties,
    frame,
    cutout,
    logo,
  })

  const size = { width: profile.width, height: profile.height }

  const authored = authorOn
    ? await authorCard({ generation, card, properties, frame, size, fonts, provider })
    : null
  if (authored !== null) {
    return {
      bytes: authored.bytes,
      frame: frameBytes,
      cutout: cutout === null ? null : imageBytes(cutout),
      content: authored.content,
      fonts,
      direction: null,
      authored: authored.layout,
    }
  }

  const directed = directorOn
    ? await directCard({ generation, layout, content, card, properties, frame, cutout, maskSamples, size, fonts, provider })
    : null

  // Правка арт-директора — только на сборку: снимок макета и содержимое остаются библиотечными.
  const finalLayout = directed?.layout ?? layout
  const finalContent = directed?.content ?? content
  const rendered = await renderCard(finalLayout, finalContent, size, fonts)

  // Механическая приёмка (C1): заголовок и описание в кадре — те же слова, что вернул
  // провайдер. Сверка с `card`, а не с `content`: обрезка при наполнении иначе невидима.
  const mismatched = textMismatches(finalLayout, finalContent, { title: [card.title], body: [card.description] })
  if (mismatched.length > 0) {
    throw new Error(`В кадре не дословны тексты карточки: ${mismatched.join(', ')}`)
  }

  if (cut.length > 0 || rendered.dropped.length > 0) {
    console.info('Генерация', generation.id, 'макет', layout.id, 'не вместил свойств:', cut.length,
      'снятые слои:', rendered.dropped)
  }

  return {
    bytes: rendered.bytes,
    frame: frameBytes,
    cutout: cutout === null ? null : imageBytes(cutout),
    content,
    fonts,
    direction: directed?.direction ?? null,
    authored: null,
  }
}

/**
 * Сочинение карточки на сборке (шаг C3, ADR-0019): референсы → `authorCard` → сцена `/layout` →
 * слои → растр. Приём — целиком; **любой** отказ — `null` и причина строкой в журнал, и сборка
 * идёт по макету библиотеки, как без сочинения (п. 6): генерация из-за сочинения не падает.
 * Затраты вызова `authorCard` пишет провайдер в `usage` — на обоих исходах.
 */
async function authorCard(args: {
  generation: GenerationRow
  card: CardTexts
  properties: { label: string; value: string }[]
  frame: ImageRef
  size: { width: number; height: number }
  fonts: FontFamilies
  provider: AiProvider
}): Promise<{ layout: CardLayout; content: CardContent; bytes: Uint8Array } | null> {
  const fallback = (reason: string): null => {
    console.error('Сочинение: откат на макет библиотеки —', reason, '· генерация', args.generation.id)
    return null
  }

  // Адрес — своей переменной, по образцу `CUTOUT_MASK_ENDPOINT`; секрет — общий с вырезом.
  const endpoint = Deno.env.get('CUTOUT_LAYOUT_ENDPOINT')
  const secret = Deno.env.get('CUTOUT_SECRET')
  if (!endpoint || !secret) return fallback('не заданы CUTOUT_LAYOUT_ENDPOINT / CUTOUT_SECRET')

  try {
    const outcome = await authorLayout({
      frame: args.frame,
      references: await readReferences(args.generation),
      // Тексты — те же, что лягут в поля карточки (FR-07): короткий заголовок и описание, как в
      // пробе (`bench/html-probe.mts`); полное название — словами без привязки.
      seller: {
        title: args.card.title,
        description: args.card.description,
        properties: args.properties,
        wishes: args.generation.wishes,
      },
      extra: [args.generation.product_title],
      marketplaceId: args.generation.marketplace_id,
      categoryId: args.generation.category_id,
      canvas: args.size,
      families: args.fonts,
      author: (input) => args.provider.authorCard(input),
      scene: createLayoutRunner({ endpoint, secret }),
    })
    if (outcome.origin === 'library') return fallback(outcome.reason)

    // Дословность сочинения уже сверил `toLayout` (регистр — сцены, Q-H5); сверка C1 с `card`
    // отказала бы здесь на регистре, поэтому её нет.
    const rendered = await renderCard(outcome.layout, outcome.content, args.size, args.fonts)
    console.info('Сочинение принято · генерация', args.generation.id,
      rendered.dropped.length > 0 ? `· снятые слои: ${rendered.dropped.join(', ')}` : '')
    return { layout: outcome.layout, content: outcome.content, bytes: rendered.bytes }
  } catch (error: unknown) {
    return fallback(error instanceof Error ? error.message : String(error))
  }
}

/** До четырёх референсов каталога по площадке и категории, ротацией по генерации (C4). */
async function readReferences(generation: GenerationRow): Promise<Uint8Array[]> {
  const rows = (await selectFromDatabase(
    'card_references?select=id,storage_path,marketplace_id,category_id&status=eq.active',
  )) as ReferenceRow[]
  const picked = pickReferences(rows, {
    marketplaceId: generation.marketplace_id,
    categoryId: generation.category_id,
    seed: generation.id,
  })
  return Promise.all(picked.map((row) => downloadFile('references', row.storage_path)))
}

/**
 * Арт-директор на сборке (шаг B5.8): маска → карта → цикл по ступеням. Любой сбой вокруг цикла
 * (база иконок, карта) — карточка по макету библиотеки, а не упавшая генерация (ADR-0018, п. 3);
 * сам цикл ступень 4 возвращает без исключений. Затраты попыток пишет провайдер в `usage`.
 */
async function directCard(args: {
  generation: GenerationRow
  layout: CardLayout
  content: CardContent
  card: CardTexts
  properties: { label: string; value: string }[]
  frame: ImageRef
  cutout: ImageRef | null
  maskSamples: MaskSamples | null
  size: { width: number; height: number }
  fonts: FontFamilies
  provider: AiProvider
}): Promise<DirectorResult | null> {
  try {
    const icons = (await selectFromDatabase(
      `card_icons?select=name,description&status=eq.${encodeURIComponent('готово')}&order=name`,
    )) as { name: string; description: string }[]

    const result = await runDirector({
      layout: args.layout,
      content: args.content,
      texts: { title: args.card.title, body: args.card.description },
      properties: args.properties,
      wishes: args.generation.wishes,
      frameMask: args.maskSamples === null ? null : occupancyOf(args.maskSamples),
      frame: args.frame,
      size: args.size,
      hasCutout: args.cutout !== null,
      icons,
      loadIcons: readIcons,
      ask: (brief) => args.provider.directCard({ brief }),
      fonts: args.fonts,
      measure: await measureText(),
    })

    console.info(directorLogLine(result), '· генерация', args.generation.id)
    return result
  } catch (error: unknown) {
    console.error('Арт-директор: сбой вокруг цикла, карточка по макету библиотеки', error)
    return null
  }
}

/** Исходники пересборки — в `results` рядом с карточкой, содержимое — в снимок (B7.4). */
async function storeAssembly(generation: GenerationRow, layout: CardLayout, assembly: Assembly): Promise<void> {
  const folder = `${generation.user_id}/${generation.id}`
  const upload = async (name: string, bytes: Uint8Array): Promise<string> => {
    const info = readImageInfo(bytes)!
    const path = `${folder}/${name}.${info.format}`
    await uploadFile('results', path, bytes, mimeOf(info.format))
    return path
  }

  const [framePath, cutoutPath] = await Promise.all([
    upload('frame-1', assembly.frame),
    assembly.cutout === null ? undefined : upload('cutout-1', assembly.cutout),
  ])

  // Макет, по которому собрано, и его происхождение — той же записью, что содержимое (B40):
  // повтор доставки события переписывает снимок целиком, и сочинение с содержимым библиотеки
  // (или наоборот) в нём не сойдутся. Правка арт-директора в снимок не идёт — он библиотечный.
  await callDatabase('record_card_assembly', {
    target_generation: generation.id,
    assembled_layout: assembly.authored ?? layout,
    assembled_origin: assembly.authored !== null ? 'author' : 'library',
    assembled_content: storedContent(assembly.content, {
      frames: [framePath],
      cutout: cutoutPath,
      logo: generation.logo_path ?? undefined,
    }),
    assembled_font_map: assembly.fonts,
  })

  // Правка арт-директора — отдельной записью и только когда она есть: `null` в колонке и значит
  // «ступень 4». Снимок макета и содержимое она не трогает.
  if (assembly.direction !== null) {
    await callDatabase('record_card_direction', {
      target_generation: generation.id,
      card_direction: assembly.direction,
    })
  }
}

/** Карта «роль → гарнитура». */
async function readFonts(): Promise<FontFamilies> {
  const rows = (await selectFromDatabase('card_font_roles?select=role,family')) as FontRoleRow[]
  return Object.fromEntries(rows.map((row) => [row.role, row.family])) as FontFamilies
}

/** Свойства из B1 хранятся `jsonb`-массивом `{label, value}`; чужую форму не пускаем в макет. */
function readProperties(value: unknown[]): { label: string; value: string }[] {
  return value.flatMap((entry) => {
    const { label, value: propertyValue } = (entry ?? {}) as { label?: unknown; value?: unknown }
    return typeof label === 'string' && typeof propertyValue === 'string' ? [{ label, value: propertyValue }] : []
  })
}

async function selectLayout(
  generation: GenerationRow,
  profile: OutputProfile,
  accepts: (layout: CardLayout) => boolean,
) {
  const queries = layoutQueries(generation.category_id)
  const [layouts, fallbacks] = await Promise.all([
    selectFromDatabase(queries.candidates),
    selectFromDatabase(queries.fallback),
  ])

  const fallback = (fallbacks as LayoutRow[])[0]
  if (fallback === undefined) throw new Error('В библиотеке нет универсального макета')

  return selectCardLayout(
    (layouts as LayoutRow[]).map(toLayoutCandidate),
    toLayoutCandidate(fallback),
    {
      categoryId: generation.category_id,
      marketplaceId: generation.marketplace_id,
      presetId: generation.preset_id,
      // Знак загружен продавцом и проверен в `generate` до списания баллов (шаг B3).
      // Не загружен — это не мешает подбору: макет со знаком просто теряет свой балл, а
      // если он всё же победит, слой снимется правилом K-3 на сборке.
      hasLogo: generation.logo_path !== null,
      propertyCount: generation.product_properties.length,
      targetAspectW: profile.aspectW,
      targetAspectH: profile.aspectH,
    },
    accepts,
  )
}

function toLayoutCandidate(row: LayoutRow): LayoutCandidate {
  return {
    id: row.id,
    layout: row.layout,
    categoryId: row.category_id,
    marketplaceId: row.marketplace_id,
    presetId: row.preset_id,
    isFallback: row.is_fallback,
  }
}
