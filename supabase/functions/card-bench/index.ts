/**
 * Оснастка замера в изоляте — шаг B4.0.
 *
 * **Это инструмент, а не часть продукта.** Он не деплоится: наружу его не зовёт никто, а
 * пускает он только вызывающего с service-role. Живёт рядом с функциями, потому что мерить
 * надо ровно там, где работает сборка, — в рантайме функций, а не в Node. Числа фазы A,
 * снятые в Node, для изолята не годились (B0.1), и повторять эту ошибку незачем.
 *
 * **Почему инструмент коммитится.** Смоук B0.1 был разовым скриптом, в репозиторий не попал —
 * и два вопроса к его же таблице переспросить оказалось нечем (уточнение плана 2026-09-03):
 * эффект явного `free()` у объектов `resvg` и природа «внешняя память до 81 МБ». Оснастка у
 * них одна с замером раннера выреза, поэтому пишется один раз и остаётся.
 *
 * **Один замер — один запрос.** Супервизор рантайма даёт мягкий предел около секунды и
 * жёсткий около двух; пачка сборок в одном запросе была бы убита на середине. Изолят при
 * `policy = "per_worker"` живёт между запросами, поэтому накопление памяти видно по
 * последовательности ответов, а не внутри одного.
 *
 * Запуск — драйвером `npm run cards:bench` (`tools/card-pipeline/bench.mts`).
 */

import { Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'

import {
  CORS_HEADERS,
  downloadFile,
  failure,
  isServiceRoleCaller,
  json,
  selectFromDatabase,
} from '../_shared/edge.ts'
import { previewFilling } from '../_shared/card-layout/preview.ts'
import { renderCard, rendererFonts } from '../_shared/card-layout/render.ts'
import { overflowsOf, textProbes } from '../_shared/card-layout/svg.ts'
import type { FontFamilies } from '../_shared/card-layout/svg.ts'
import type { CardContent, CardLayout, FontRole } from '../_shared/card-layout/types.ts'

type LayoutRow = { id: string; layout: CardLayout; is_fallback: boolean }
type FontRoleRow = { role: FontRole; family: string }

type Memory = { rss: number; heapTotal: number; heapUsed: number; external: number }

/**
 * Возраст изолята в запросах. Накопление памяти отличается от пика одной сборки только по
 * последовательности, а последовательность рвётся, когда супервизор поднимает нового воркера:
 * счётчик, начавшийся заново, — признак того, что предыдущие числа к этому изоляту не
 * относятся.
 */
let served = 0
const bootedAt = Date.now()

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== 'POST') return failure('Метод не поддерживается', 405)
  if (!isServiceRoleCaller(request)) return failure('Оснастка замера доступна только серверу', 403)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const probe = typeof body?.probe === 'string' ? body.probe : ''

  served += 1
  const isolate = { served, ageMs: Date.now() - bootedAt }

  try {
    const before = memory()
    const started = performance.now()
    const { ms, detail } = await run(probe, body ?? {})

    return json({ probe, isolate, ms, totalMs: performance.now() - started, before, after: memory(), detail })
  } catch (error: unknown) {
    console.error(`Замер «${probe}» не выполнен`, error)
    return failure(error instanceof Error ? error.message : 'Замер не выполнен', 500)
  }
})

/**
 * Замеряемое время у каждого зонда своё, а не от начала запроса.
 *
 * Иначе первый прогон в изоляте нёс бы в себе холодный старт растеризатора — а изолят
 * поднимается заново каждый раз, когда супервизор убивает предыдущий за перебор
 * процессорного времени, то есть посреди любого длинного ряда. Полное время запроса тоже
 * возвращается (`totalMs`), чтобы разница была видна, а не скрыта.
 */
type Measured = { ms: number; detail: Record<string, unknown> }

async function run(probe: string, body: Record<string, unknown>): Promise<Measured> {
  switch (probe) {
    // Холостой заход: показывает, куда память садится сама по себе между нагрузками.
    case 'idle':
      return { ms: 0, detail: {} }

    // Холодный старт растеризатора отдельным замером — иначе он лёг бы на первую же сборку.
    case 'warmup': {
      const started = performance.now()
      const fonts = await rendererFonts()
      return { ms: performance.now() - started, detail: { fonts: fonts.length } }
    }

    case 'render':
      return await renderProbe(body)

    case 'overflow':
      return await overflowProbe(body)

    case 'cutout-load':
      return await cutoutLoadProbe(body)

    case 'cutout':
      return await cutoutProbe(body)

    default:
      throw new Error(`Неизвестный замер «${probe}». Есть: idle, warmup, render, overflow, cutout-load, cutout`)
  }
}

/**
 * Раннер выреза в изоляте — ради этого шаг B4.0 и заведён (ADR-0014).
 *
 * **Ресурсы берутся из приватного бакета, а не из бандла и не из сети** — тем же приёмом, что
 * и `resvg` на B0.1: и сам файл модели, и wasm рантайма ONNX. Иначе замер мерил бы скорость
 * чужого CDN, а продуктовый путь так работать всё равно не будет.
 *
 * **Бакет у замера свой, `card-bench`.** Класть модель в `card-render-assets` было бы
 * преждевременно: тот бакет описан миграцией, у него потолок в 5 МБ и белый список типов —
 * менять его до того, как замер выбрал модель и место запуска, значит решать миграцией
 * вопрос, ответ на который ещё не получен. Локальный бакет заводит драйвер, и `db reset`
 * его уносит.
 */
const BENCH_BUCKET = 'card-bench'

/**
 * Версия рантайма ONNX выбрана не по свежести.
 *
 * С 1.18 в пакете остались только сборки с потоками, а их wasm объявляет разделяемую память —
 * изолят такую не создаёт («Creating a shared memory is not supported»), и `numThreads = 1`
 * этого не отменяет: ограничение в самом модуле, а не в обвязке. 1.17.3 — последняя версия,
 * где рядом лежит однопоточная сборка `ort-wasm-simd.wasm`. Для браузера это не ограничение,
 * там доступны обе, — и разница между половинами замера начинается уже здесь.
 */
const ORT_VERSION = '1.17.3'
const ORT_WASM = 'ort/ort-wasm-simd.wasm'

let ortModule: Promise<typeof import('npm:onnxruntime-web@1.17.3')> | undefined
const sessions = new Map<string, Promise<{ session: unknown; loadMs: number; bytes: number }>>()

async function loadOrt(): Promise<typeof import('npm:onnxruntime-web@1.17.3')> {
  if (ortModule === undefined) {
    ortModule = (async () => {
      const ort = await import(`npm:onnxruntime-web@${ORT_VERSION}`)
      // Потоков в изоляте нет, и просить их — верный способ получить отказ на старте.
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.wasm.simd = true
      ort.env.wasm.wasmBinary = (await downloadFile(BENCH_BUCKET, ORT_WASM)).buffer
      return ort
    })().catch((error: unknown) => {
      ortModule = undefined
      throw error
    })
  }
  return ortModule
}

function loadSession(model: string): Promise<{ session: unknown; loadMs: number; bytes: number }> {
  const cached = sessions.get(model)
  if (cached !== undefined) return cached

  const created = (async () => {
    const ort = await loadOrt()
    const bytes = await downloadFile(BENCH_BUCKET, `cutout/${model}.onnx`)
    const started = performance.now()
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
    return { session, loadMs: performance.now() - started, bytes: bytes.length }
  })().catch((error: unknown) => {
    sessions.delete(model)
    throw error
  })

  sessions.set(model, created)
  return created
}

/** Поднять модель отдельным замером: это холодный старт, и в цену кадра он не входит. */
async function cutoutLoadProbe(body: Record<string, unknown>): Promise<Measured> {
  const model = modelName(body)
  const { session, loadMs, bytes } = await loadSession(model)
  const typed = session as { inputNames: string[]; outputNames: string[] }

  return {
    ms: loadMs,
    detail: { model, bytes, inputs: typed.inputNames, outputs: typed.outputNames },
  }
}

/**
 * Один прогон модели. Пиксели синтетические намеренно: время инференса задаёт размер входа, а
 * не содержимое кадра, — качество кромки меряется отдельно и на настоящих кадрах, потому что
 * его в миллисекундах не выразить.
 */
async function cutoutProbe(body: Record<string, unknown>): Promise<Measured> {
  const ort = await loadOrt()
  const model = modelName(body)
  const { session } = await loadSession(model)
  const typed = session as {
    inputNames: string[]
    outputNames: string[]
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { dims: number[] }>>
  }

  const side = Number.isInteger(body.side) && (body.side as number) > 0 ? (body.side as number) : 320
  const pixels = new Float32Array(3 * side * side)
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index % 255) / 255

  const input = new ort.Tensor('float32', pixels, [1, 3, side, side])

  const started = performance.now()
  const output = await typed.run({ [typed.inputNames[0]]: input })
  const ms = performance.now() - started

  return { ms, detail: { model, side, output: output[typed.outputNames[0]].dims } }
}

function modelName(body: Record<string, unknown>): string {
  const model = typeof body.model === 'string' ? body.model : ''
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(model)) throw new Error('Не задано имя модели выреза')
  return model
}

/** Сборка кадра продуктовым путём: ровно то, что делает воркер и превью. */
async function renderProbe(body: Record<string, unknown>): Promise<Measured> {
  const { layout, size, fonts } = await subject(body)
  const filling = previewFilling(layout, {
    productTitle: 'Наименование товара',
    properties: benchProperties(),
    hasLogo: true,
  })
  const content = body.frame === 'raster' ? withRasterFrames(filling.content) : filling.content

  await rendererFonts()
  const started = performance.now()
  const rendered = await renderCard(layout, content, size, fonts)
  const ms = performance.now() - started

  return {
    ms,
    detail: {
      layoutId: body.layoutId,
      size,
      frame: body.frame === 'raster' ? 'raster' : 'stub',
      bytes: rendered.bytes.length,
      dropped: rendered.dropped.length,
    },
  }
}

/**
 * Кадр растром вместо штриховки превью.
 *
 * Заглушка `preview.ts` — это SVG с узором: `resvg` пересчитывает его на каждый пиксель кадра,
 * и на площади во весь холст это стоит дороже самой композиции. Настоящий кадр приезжает от
 * вендора растром, поэтому цена сборки на превью и цена сборки на платном пути — разные числа,
 * и мерить их надо порознь. Ровно этого различения не хватило таблице B0.1.
 *
 * Растр здесь — минимальный валидный PNG (один непрозрачный пиксель), растянутый на гнездо:
 * декодирование такого файла не стоит ничего, поэтому в замер попадает только цена
 * масштабирования, а не цена разбора чужого JPEG.
 */
const RASTER_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function withRasterFrames(content: CardContent): CardContent {
  const raster = { dataUri: RASTER_PIXEL, width: 1, height: 1 }
  return {
    ...content,
    frames: content.frames.map(() => raster),
    cutout: content.cutout === undefined ? undefined : raster,
  }
}

/**
 * Обмер строк — то самое место, где `free()` вообще может что-то значить: объект `resvg`
 * создаётся НА КАЖДУЮ строку, а не один на сборку.
 *
 * Продуктовый путь (`renderPreview`) освобождает всегда и переключателя не имеет — он и не
 * должен: «не освобождать» это не режим работы, а вопрос замера. Поэтому здесь тот же обмер
 * собран из тех же общих кусков (`textProbes` + `overflowsOf`), но с переключателем.
 */
async function overflowProbe(body: Record<string, unknown>): Promise<Measured> {
  const { layout, size, fonts } = await subject(body)
  const free = body.free !== false
  const filling = previewFilling(layout, {
    productTitle: 'Наименование товара',
    properties: benchProperties(),
    hasLogo: true,
  })

  const buffers = await rendererFonts()
  const probes = textProbes(layout, filling.content, size, fonts)

  // Строк у макета всего десяток-полтора, и на таком счёте разница между «освободили» и «нет»
  // тонет в шуме. Повтор набора внутри одного запроса поднимает счёт объектов на порядок,
  // ничего не меняя в том, что именно делается: это те же вызовы, только их больше.
  const repeat = Number.isInteger(body.repeat) && (body.repeat as number) > 0 ? (body.repeat as number) : 1

  const started = performance.now()
  let overflows = 0
  for (let round = 0; round < repeat; round += 1) {
    overflows = overflowsOf(probes, (svg) =>
      withResvg(svg, buffers, free, (resvg) => resvg.getBBox()?.width ?? 0),
    ).length
  }
  const ms = performance.now() - started

  return {
    ms,
    detail: {
      layoutId: body.layoutId,
      size,
      free,
      repeat,
      probes: probes.length,
      objects: probes.length * repeat,
      overflows,
    },
  }
}

function withResvg<T>(svg: string, fonts: Uint8Array[], free: boolean, use: (resvg: Resvg) => T): T {
  const resvg = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false } })
  try {
    return use(resvg)
  } finally {
    if (free) resvg.free()
  }
}

/**
 * Свойства-нагрузка. Ёмкость макета режет список сама (`previewFilling`), поэтому список
 * заведомо длиннее любого гнезда: замер не должен зависеть от того, сколько модулей у макета.
 */
function benchProperties(): { label: string; value: string }[] {
  return Array.from({ length: 12 }, (_, index) => ({
    label: `Характеристика ${index + 1}`,
    value: `Значение ${index + 1}`,
  }))
}

type Subject = { layout: CardLayout; size: { width: number; height: number }; fonts: FontFamilies }

async function subject(body: Record<string, unknown>): Promise<Subject> {
  const layoutId = typeof body.layoutId === 'string' ? body.layoutId : ''
  if (layoutId === '') throw new Error('Не задан layoutId')

  const width = Number(body.width)
  const height = Number(body.height)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Не заданы размеры кадра')
  }

  return { layout: await readLayout(layoutId), size: { width, height }, fonts: await readFonts() }
}

/**
 * Макеты и карта шрифтов кэшируются на изолят: их чтение — сеть, и в замере сборки ей делать
 * нечего. Первый запрос драйвера прогревает кэш и в таблицы не попадает.
 */
const layouts = new Map<string, CardLayout>()
let fontMap: FontFamilies | undefined

async function readLayout(id: string): Promise<CardLayout> {
  const cached = layouts.get(id)
  if (cached !== undefined) return cached

  const [row] = (await selectFromDatabase(
    `card_layouts?id=eq.${encodeURIComponent(id)}&select=id,layout,is_fallback`,
  )) as LayoutRow[]
  if (row === undefined) throw new Error(`Макета «${id}» нет в библиотеке`)

  layouts.set(id, row.layout)
  return row.layout
}

async function readFonts(): Promise<FontFamilies> {
  if (fontMap === undefined) {
    const rows = (await selectFromDatabase('card_font_roles?select=role,family')) as FontRoleRow[]
    fontMap = Object.fromEntries(rows.map((row) => [row.role, row.family])) as FontFamilies
  }
  return fontMap
}

/** Рантайм функций может не отдать эти числа — тогда честнее пустота, чем выдуманный ноль. */
function memory(): Memory | null {
  try {
    return Deno.memoryUsage()
  } catch {
    return null
  }
}
