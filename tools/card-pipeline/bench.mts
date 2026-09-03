/**
 * Драйвер замера в рантайме функций — шаг B4.0.
 *
 * Пара к `supabase/functions/card-bench/index.ts`: тот считает внутри изолята, этот гоняет
 * его по последовательности и печатает таблицы. Разделение не косметическое — супервизор
 * рантайма убивает запрос примерно на двух секундах, поэтому нагрузка обязана раскладываться
 * на много коротких запросов, а склеивать их в ряд некому, кроме внешнего драйвера.
 *
 * **Зачем инструмент, а не разовый скрипт.** Смоук B0.1 был разовым и не сохранился — два
 * вопроса к его собственной таблице переспросить оказалось нечем. Здесь они и закрываются:
 *
 *   npm run cards:bench assemble   сборка 34 макетов: время и память по каждому прогону
 *   npm run cards:bench free       эффект явного free() у объектов resvg
 *   npm run cards:bench cutout     раннер выреза в изоляте (шаг B4.0, гейт ADR-0014)
 *
 * Требуется поднятый локальный рантайм функций:
 *
 *   npx supabase functions serve
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Memory = { rss: number; heapTotal: number; heapUsed: number; external: number }

type ProbeReply = {
  probe: string
  isolate: { served: number; ageMs: number }
  ms: number
  totalMs: number
  before: Memory | null
  after: Memory | null
  detail: Record<string, unknown>
}

/** Прогон, который супервизор убил: не результат, но и не сбой оснастки. */
type Killed = { killed: true; status: number; ms: number }

type Run = { label: string; reply: ProbeReply | Killed }

const PROFILE_SIZE = { width: 1440, height: 1920 }
const PREVIEW_SIZE = { width: 720, height: 960 }

const MODELS = fileURLToPath(new URL('models/', import.meta.url))

/**
 * Однопоточная сборка wasm для рантайма ONNX.
 *
 * Берётся не из `node_modules`: там стоит свежий `onnxruntime-web`, а с 1.18 в пакете остались
 * только сборки с потоками — их wasm объявляет разделяемую память, которой в изоляте нет.
 * 1.17.3 — последняя версия с однопоточным файлом. Скачивается в тот же игнорируемый каталог,
 * что и модели: это чужой бинарник, а не наш исходник.
 */
const ORT_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort-wasm-simd.wasm'
const ORT_WASM_FILE = 'ort-wasm-simd.wasm'

function localEnv(): Record<string, string> {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_0-9]+)="(.*)"$/)
    if (match) env[match[1]] = match[2]
  }
  if (env.API_URL === undefined) throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  return env
}

const env = localEnv()
const REST = `${env.API_URL}/rest/v1`
const BENCH = `${env.API_URL}/functions/v1/card-bench`
const SECRET = env.SERVICE_ROLE_KEY

/**
 * Локальный бакет замера. Модель выреза и wasm рантайма ONNX не кладутся в
 * `card-render-assets`: у того бакета потолок 5 МБ и белый список типов, заданные миграцией, а
 * менять продуктовую схему до того, как замер выбрал модель, значит отвечать миграцией на
 * ещё не заданный вопрос. Этот бакет заводится на месте и уносится ближайшим `db reset`.
 */
const BENCH_BUCKET = 'card-bench'

async function storage(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${env.API_URL}/storage/v1/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...(init.headers ?? {}) },
  })
}

async function ensureBucket(): Promise<void> {
  const response = await storage('bucket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BENCH_BUCKET, name: BENCH_BUCKET, public: false }),
  })
  if (response.ok) return

  // Бакет уже есть — это не ошибка, а обычное второе включение оснастки. Признак приходит
  // телом, а не кодом: Storage отвечает на это HTTP 400 с `statusCode: "409"` внутри.
  const text = await response.text()
  if (!text.includes('BucketAlreadyExists')) {
    throw new Error(`Бакет замера не заведён: HTTP ${response.status}: ${text.slice(0, 200)}`)
  }
}

/** Возвращает размер загруженного файла: он же идёт в отчёт, второй раз читать нечего. */
async function putAsset(path: string, file: string): Promise<number> {
  const bytes = await readFile(file)
  const response = await storage(`object/${BENCH_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
    body: bytes,
  })
  if (!response.ok) {
    throw new Error(`${path} не загружен: HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }
  return bytes.length
}

async function layoutIds(): Promise<string[]> {
  const response = await fetch(`${REST}/card_layouts?select=id&order=id`, {
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
  if (!response.ok) throw new Error(`Библиотека макетов не читается: HTTP ${response.status}`)
  return ((await response.json()) as { id: string }[]).map((row) => row.id)
}

/**
 * Один замер — один запрос. Отказ супервизора возвращается как результат, а не как исключение:
 * «этот макет не уложился в отведённое процессорное время» — это и есть число замера.
 *
 * Кодов у отказа несколько, и полагаться на один нельзя: смоук B0.1 видел `546`, этот прогон
 * получил и `503` (запрос отменён супервизором, тело пустое), и `546` (`WORKER_LIMIT`, тело
 * JSON-ом) — на разных макетах. Путаницы с ответом самого обработчика не возникает: тот
 * отвечает только `400`, `403`, `405` и `500`.
 */
const KILL_CODES = new Set([503, 504, 546])

async function probe(body: Record<string, unknown>): Promise<ProbeReply | Killed> {
  const started = Date.now()
  const response = await fetch(BENCH, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    if (KILL_CODES.has(response.status)) {
      return { killed: true, status: response.status, ms: Date.now() - started }
    }
    throw new Error(`Замер ${JSON.stringify(body)} отвечает HTTP ${response.status}: ${text.slice(0, 300)}`)
  }

  return (await response.json()) as ProbeReply
}

/**
 * Прогон с восстановлением изолята. Убитый воркер уносит с собой и загруженный растеризатор,
 * поэтому следующий запрос платил бы за холодный старт; прогрев возвращает изолят в то же
 * состояние, в каком его застал предыдущий замер.
 */
async function measured(body: Record<string, unknown>): Promise<ProbeReply | Killed> {
  const reply = await probe(body)
  if ('killed' in reply) await probe({ probe: 'warmup' }).catch(() => null)
  return reply
}

async function waitForRuntime(): Promise<void> {
  const deadline = Date.now() + 90_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const reply = await probe({ probe: 'idle' })
      if (!('killed' in reply)) return
    } catch (error: unknown) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`Рантайм функций не поднялся. Запустите \`npx supabase functions serve\`.\n${last}`)
}

const MB = 1024 * 1024

function mb(bytes: number): string {
  return (bytes / MB).toFixed(1)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Сборка всей библиотеки в заданном размере. Память снимается вокруг КАЖДОГО прогона — ровно
 * этого не хватило смоуку B0.1, чтобы отличить пик одной сборки от накопления за 34.
 */
async function assemble(size: { width: number; height: number }, ids: string[]): Promise<Run[]> {
  const runs: Run[] = []
  for (const id of ids) {
    runs.push({ label: id, reply: await measured({ probe: 'render', layoutId: id, ...size }) })
  }
  return runs
}

function reportAssemble(title: string, runs: Run[]): void {
  const done = runs.filter((run) => !('killed' in run.reply)) as { label: string; reply: ProbeReply }[]
  const killed = runs.filter((run) => 'killed' in run.reply)
  const times = done.map((run) => run.reply.ms)

  console.log(`\n## ${title}`)
  console.log(`Собралось: ${done.length} из ${runs.length}`)
  if (times.length > 0) {
    const worst = done.reduce((a, b) => (a.reply.ms > b.reply.ms ? a : b))
    console.log(`Медиана: ${Math.round(median(times))} мс`)
    console.log(`Худший: ${Math.round(worst.reply.ms)} мс (${worst.label})`)
  }
  for (const run of killed) {
    console.log(`Отказ: ${run.label} — HTTP ${(run.reply as Killed).status}, ${(run.reply as Killed).ms} мс`)
  }

  reportMemory(done)
}

type Done = { label: string; reply: ProbeReply }

/**
 * Разрезать ряд по перезапускам изолята. Уровень памяти после перезапуска начинается заново,
 * и сравнивать «финиш» одного изолята со «стартом» другого значило бы вычитать несравнимое.
 * Признак — счётчик обслуженных запросов, который у нового воркера пошёл сначала.
 */
function segments(done: Done[]): Done[][] {
  const parts: Done[][] = []
  let current: Done[] = []
  let previous = 0

  for (const run of done) {
    if (run.reply.isolate.served <= previous) {
      if (current.length > 0) parts.push(current)
      current = []
    }
    previous = run.reply.isolate.served
    current.push(run)
  }

  if (current.length > 0) parts.push(current)
  return parts
}

/**
 * Пик одной сборки против накопления по ряду. Различает их только сопоставление двух чисел:
 * самого большого прироста ВНУТРИ прогона и сдвига уровня по самому длинному непрерывному
 * куску ряда — тому, где изолят не переподнимался.
 */
function reportMemory(done: Done[]): void {
  const withMemory = done.filter((run) => run.reply.before !== null && run.reply.after !== null)
  if (withMemory.length === 0) {
    console.log('Память: рантайм не отдал Deno.memoryUsage()')
    return
  }

  const peak = withMemory.reduce((worst, run) => {
    const value = (run.reply.after as Memory).external
    return value > worst.value ? { value, label: run.label } : worst
  }, { value: 0, label: '' })
  const jump = withMemory.reduce((worst, run) => {
    const value = (run.reply.after as Memory).external - (run.reply.before as Memory).external
    return value > worst.value ? { value, label: run.label } : worst
  }, { value: 0, label: '' })

  console.log(
    `Внешняя память: пик ${mb(peak.value)} МБ (${peak.label}); ` +
      `наибольший прирост за один прогон ${mb(jump.value)} МБ (${jump.label})`,
  )

  const parts = segments(withMemory)
  const longest = parts.reduce((a, b) => (a.length >= b.length ? a : b))
  const first = longest[0].reply.before as Memory
  const last = longest[longest.length - 1].reply.after as Memory
  console.log(
    `Изолятов за ряд: ${parts.length}; самый длинный — ${longest.length} прогонов, ` +
      `внешняя память ${mb(first.external)} → ${mb(last.external)} МБ, ` +
      `куча ${mb(first.heapUsed)} → ${mb(last.heapUsed)} МБ`,
  )
}

/**
 * Эффект `free()`. Блоки идут в одном изоляте подряд, и сравниваются не уровни, а наклоны:
 * остаток предыдущего блока смещает уровень, но не наклон следующего.
 */
async function freeEffect(layoutId: string, rounds: number, repeat: number): Promise<void> {
  const arms: boolean[] = [true, false, true]
  console.log(`\n## Эффект free() — макет ${layoutId}, ${rounds} прогонов на блок`)

  for (const free of arms) {
    const runs: Done[] = []
    for (let round = 0; round < rounds; round += 1) {
      const reply = await measured({ probe: 'overflow', layoutId, ...PREVIEW_SIZE, free, repeat })
      if ('killed' in reply) {
        console.log(`  free=${free}: прогон ${round + 1} убит супервизором`)
        continue
      }
      runs.push({ label: `${round + 1}`, reply })
    }

    if (runs.length === 0) continue
    const times = runs.map((run) => run.reply.ms)
    const probes = runs[0].reply.detail.probes as number
    console.log(`\nБлок free=${free}: строк на прогон ${probes}, медиана ${Math.round(median(times))} мс`)

    for (const part of segments(runs)) {
      const first = part[0].reply.before
      const last = part[part.length - 1].reply.after
      if (first === null || last === null) continue
      console.log(
        `  Изолят на ${part.length} прогонов: внешняя память ${mb(first.external)} → ${mb(last.external)} МБ ` +
          `(${mb((last.external - first.external) / part.length)} МБ на прогон), ` +
          `куча ${mb(first.heapUsed)} → ${mb(last.heapUsed)} МБ`,
      )
    }
  }
}

async function cached(name: string, url: string): Promise<string> {
  await mkdir(MODELS, { recursive: true })
  const file = join(MODELS, name)

  try {
    await stat(file)
    return file
  } catch {
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`${name} не скачан: HTTP ${response.status}`)
    await writeFile(file, new Uint8Array(await response.arrayBuffer()))
    return file
  }
}

/**
 * Раннер выреза в изоляте — гейт шага B4.0 (ADR-0014, пункт 3).
 *
 * Поднятие сессии и сам инференс меряются порознь: первое — холодный старт, в цену кадра он
 * не входит, второе — то, что платится за каждый кадр. Отказ супервизора здесь такой же
 * результат, как число: «не влезает» — это и есть ответ на вопрос о месте запуска.
 */
async function cutoutIsolate(model: string, rounds: number): Promise<void> {
  const modelFile = join(MODELS, `${model}.onnx`)
  try {
    await stat(modelFile)
  } catch {
    throw new Error(`Файла модели нет. Сначала \`npm run cards:cutout fetch ${model}\``)
  }

  await ensureBucket()
  const wasmBytes = await putAsset(`ort/${ORT_WASM_FILE}`, await cached(ORT_WASM_FILE, ORT_WASM_URL))
  const modelBytes = await putAsset(`cutout/${model}.onnx`, modelFile)

  console.log(`
## Вырез в изоляте — модель ${model}`)
  console.log(`Ресурсы в бакете замера: модель ${mb(modelBytes)} МБ, wasm рантайма ${mb(wasmBytes)} МБ`)

  const load = await probe({ probe: 'cutout-load', model })
  if ('killed' in load) {
    console.log(`Сессия не поднялась: супервизор снял запрос, HTTP ${load.status}, ${load.ms} мс`)
  } else {
    const after = load.after
    console.log(
      `Сессия: ${Math.round(load.ms)} мс` +
        (after === null ? '' : `, внешняя память ${mb(load.before?.external ?? 0)} → ${mb(after.external)} МБ`),
    )
    console.log(`Входы ${JSON.stringify(load.detail.inputs)}, выходов ${(load.detail.outputs as string[]).length}`)
  }

  let killed = 0
  const times: number[] = []
  for (let round = 0; round < rounds; round += 1) {
    const reply = await probe({ probe: 'cutout', model })
    if ('killed' in reply) {
      killed += 1
      continue
    }
    times.push(reply.ms)
  }

  if (times.length > 0) {
    console.log(`Инференс: медиана ${Math.round(median(times))} мс на ${times.length} прогонах`)
  }
  if (killed > 0) {
    console.log(
      `Снято супервизором: ${killed} из ${rounds}. ` +
        'Изолят не переживает поднятие сессии и инференс в одном запросе, а между запросами ' +
        'сессия не доживает: воркер снимается по процессорному времени и поднимается заново.',
    )
  }
}

async function main(): Promise<void> {
  const [mode = 'assemble', ...rest] = process.argv.slice(2)
  const out = rest.includes('--out') ? rest[rest.indexOf('--out') + 1] : null

  await waitForRuntime()
  await probe({ probe: 'warmup' })

  const record: Record<string, unknown> = {}

  if (mode === 'assemble') {
    const ids = await layoutIds()
    if (ids.length === 0) throw new Error('Библиотека макетов пуста. Сначала `npm run cards:layouts push`.')

    const profile = await assemble(PROFILE_SIZE, ids)
    reportAssemble(`Профиль площадки ${PROFILE_SIZE.width}×${PROFILE_SIZE.height}`, profile)

    const preview = await assemble(PREVIEW_SIZE, ids)
    reportAssemble(`Размер превью ${PREVIEW_SIZE.width}×${PREVIEW_SIZE.height}`, preview)

    record.profile = profile
    record.preview = preview
  } else if (mode === 'free') {
    const layoutId = rest.find((arg) => !arg.startsWith('--')) ?? (await layoutIds())[0]
    const rounds = Number(rest.includes('--rounds') ? rest[rest.indexOf('--rounds') + 1] : 20)
    const repeat = Number(rest.includes('--repeat') ? rest[rest.indexOf('--repeat') + 1] : 1)
    await freeEffect(layoutId, rounds, repeat)
  } else if (mode === 'cutout') {
    const model = rest.find((arg) => !arg.startsWith('--')) ?? 'u2netp'
    const rounds = Number(rest.includes('--rounds') ? rest[rest.indexOf('--rounds') + 1] : 5)
    await cutoutIsolate(model, rounds)
  } else {
    throw new Error(`Неизвестный режим «${mode}». Есть: assemble, free, cutout`)
  }

  if (out !== null) {
    await writeFile(out, JSON.stringify(record, null, 2), 'utf8')
    console.log(`\nСырые числа: ${out}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
