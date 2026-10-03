/**
 * Замер раннера выреза вне изолята — вторая половина оснастки шага B4.0.
 *
 * Пара к `bench.mts`: тот гоняет модель в рантайме функций, этот — в Node и в браузере.
 * Половины разные не по прихоти: в изоляте нет ни потоков, ни WebGPU, и число оттуда отвечает
 * на вопрос «влезает ли», а не «сколько стоит вырез вообще». ADR-0014 требует обоих.
 *
 *   npm run cards:cutout fetch              скачать файлы моделей (в git не идут)
 *   npm run cards:cutout node               время инференса, wasm в один поток
 *   npm run cards:cutout native             то же нативным ORT + кромка на настоящих кадрах
 *   npm run cards:cutout browser            то же в Chromium + маски на настоящих кадрах
 *   npm run cards:cutout occupancy          карта занятости по маскам прошлого прогона
 *
 * **Лицензия проверяется по первоисточнику и живёт рядом с файлом модели** — правило ADR-0014,
 * пункт 4, и тот же приём, что у гарнитур в `card_font_families`. Поэтому таблица кандидатов
 * ниже несёт ссылку на первоисточник лицензии, а не пересказ чужого README: у моделей этого
 * класса код и веса лицензируются порознь, и разница решает, можно ли моделью пользоваться.
 */

import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readImageInfo } from '../../supabase/functions/_shared/image.ts'
import { occupancyOf } from '../../supabase/functions/_shared/card-layout/occupancy.ts'
import type { OccupancyMap } from '../../supabase/functions/_shared/card-layout/occupancy.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const MODELS = join(here, 'models')
const ORT_DIST = fileURLToPath(new URL('../../node_modules/onnxruntime-web/dist/', import.meta.url))

/**
 * Нормализация входа. У всех кандидатов этого класса она одна — ImageNet, — и записана здесь
 * явно, потому что молча унаследованная константа это ровно тот сорт «работает и ладно»,
 * который потом объясняет плохую кромку.
 */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

type Candidate = {
  /** Ссылка на файл ONNX. */
  url: string
  /** Длина стороны входа, которую ждёт модель. */
  side: number
  /** Лицензия так, как её называет первоисточник. */
  license: string
  /** Где эта лицензия написана — проверять по ней, а не по пересказу. */
  licenseUrl: string
  /** Что с лицензией не так, если не так. */
  note: string
  /**
   * Чем выход превращается в маску. `minmax` — растяжка по крайним значениям, как это делает
   * семейство U²-Net; `sigmoid` — поэлементная сигмоида, как требует BiRefNet, чей выход это
   * логиты. Перепутать их нельзя молча: на логитах min-max сажает фон около 0,2, и мера
   * мягкости кромки показывает 99,9% полутона на маске, которая на глаз чистая.
   */
  activation?: 'minmax' | 'sigmoid'
}

const CANDIDATES: Record<string, Candidate> = {
  u2netp: {
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    side: 320,
    license: 'код — Apache-2.0; веса — предварительное согласие авторов (2026-09-06)',
    licenseUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
    note:
      'LICENSE в репозитории покрывает код. Веса лежат на Google Drive вне репозитория, и ' +
      'README отправляет за разрешением к авторам письмом. Владелец написал и получил ' +
      'ПРЕДВАРИТЕЛЬНОЕ согласие на коммерческое использование; детали оговариваются при ' +
      'коммерческом запуске. Этого хватило, чтобы выбрать модель (решение 2026-09-06), но ' +
      'риск отложен, а не закрыт: до коммерческого запуска лицензию надо урегулировать — ' +
      'условие висит на записи B7 в planning/BACKLOG.md и на ADR-0017.',
  },
  silueta: {
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx',
    side: 320,
    license: 'производная U²-Net; веса — лицензия не объявлена',
    licenseUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
    note: 'Уменьшенная сборка U²-Net, наследует ровно ту же неопределённость с весами.',
  },
  ormbg: {
    url: 'https://huggingface.co/schirrmacher/ormbg/resolve/main/ormbg.onnx',
    side: 1024,
    license: 'Apache-2.0 — и код, и веса',
    licenseUrl: 'https://huggingface.co/schirrmacher/ormbg',
    note:
      'Заведена как ответ на ровно эту проблему: обучена на своих синтетических данных, ' +
      'поэтому лицензия распространяется и на веса. Обучена на людях — товар без человека ' +
      'для неё чужой, и это проверяется качеством кромки, а не лицензией.',
  },
  'birefnet-general-lite': {
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    side: 1024,
    license: 'MIT',
    licenseUrl: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE',
    note: 'MIT и в репозитории кода, и в карточке модели на Hugging Face.',
    activation: 'sigmoid',
  },
  'birefnet-general-lite-int8': {
    // Готового int8-экспорта BiRefNet нет ни на Hugging Face, ни в релизах rembg — там только
    // fp32 и fp16, а fp16 на x86 ORT разворачивает обратно в fp32 и времени не экономит.
    // Поэтому файл делается локально и качать его неоткуда.
    url: '',
    side: 1024,
    license: 'MIT — производная от MIT-весов',
    licenseUrl: 'https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE',
    note:
      'Динамическое квантование `birefnet-general-lite` в два шага. Сначала свернуть узлы ' +
      '`Identity` над инициализаторами: в этом экспорте у 28 `MatMul` вес приходит через ' +
      '`Identity`, а `quantize_dynamic` берёт только те, у кого вес — инициализатор, и молча ' +
      'пропускает остальные (файл худеет на 10% вместо 4×). Затем ' +
      '`quantize_dynamic(weight_type=QInt8, reduce_range=True)`. `reduce_range` обязателен: ' +
      'цель — Zen 3 (EPYC 7763) без VNNI, где u8s8-ядра насыщаются на полном диапазоне весов. ' +
      'Штатный `onnxruntime.quantization.preprocess` тот же результат даёт только с ' +
      '`--auto_merge`, а он разруливает конфликты форм «мягким слиянием» — для сравнения ' +
      'качества кромки это лишняя неопределённость, поэтому взят минимальный путь.',
    activation: 'sigmoid',
  },
}

/**
 * Отвергнуты до замера, и причина записана: без этих строк вопрос «а почему не самая точная?»
 * вернётся на следующем шаге. Обе — с прямым запретом коммерческого использования весов,
 * прочитанным по первоисточнику, а не предположенным.
 */
const REJECTED = {
  'isnet-general-use': {
    license: 'код — Apache-2.0; данные DIS5K — НЕкоммерческие, запрет распространён на производные',
    licenseUrl: 'https://github.com/xuebinqin/DIS/blob/main/DIS5K-Dataset-Terms-of-Use.pdf',
    note:
      'DIS5K Terms of Use, пункт 2 дословно: «The Dataset is available for non-commercial use ' +
      'in research or educational purpose. Without permission from the original authors, ' +
      'commercial use of this dataset is prohibited even after copying, editing, processing ' +
      'or any operations of this database». Пункт 4 запрещает и распространение производных. ' +
      'Apache-2.0 в README покрывает только «code and evaluation metric»; весам лицензия не ' +
      'назначена, а обучены они на этих данных. Прочитано по PDF 2026-09-06 — это не ' +
      '«условия неизвестны», а прямой запрет.',
  },
  'bria-rmbg': {
    license: 'bria-rmbg — некоммерческая; коммерция по платному договору',
    licenseUrl: 'https://huggingface.co/briaai/RMBG-1.4',
    note:
      'Карточка модели дословно: «The model is released under a Creative Commons license ' +
      'for non-commercial use. Commercial use is subject to a commercial agreement with BRIA». ' +
      'Правило ADR-0014 закрывает дорогу: только свободная коммерческая лицензия.',
  },
}

/** Ключи с параметром: их значение — не имя кандидата, и в список моделей попасть не должно. */
const VALUED_FLAGS = new Set(['--runs', '--frames', '--frame-limit', '--threads'])

function ids(argv: string[]): string[] {
  const asked = argv.filter(
    (arg, index) => !arg.startsWith('--') && !VALUED_FLAGS.has(argv[index - 1] ?? ''),
  )
  if (asked.length === 0) return Object.keys(CANDIDATES)

  for (const id of asked) {
    if (CANDIDATES[id] === undefined) throw new Error(`Нет кандидата «${id}». Есть: ${Object.keys(CANDIDATES).join(', ')}`)
  }
  return asked
}

function modelFile(id: string): string {
  return join(MODELS, `${id}.onnx`)
}

async function exists(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

/** Файлы моделей — десятки мегабайт чужих весов; в git идут ссылка и лицензия, не байты. */
async function fetchModels(list: string[]): Promise<void> {
  await mkdir(MODELS, { recursive: true })

  for (const id of list) {
    const file = modelFile(id)
    const already = await exists(file)
    if (already !== null) {
      console.log(`${id}: уже есть, ${(already / 1048576).toFixed(1)} МБ`)
      continue
    }

    // Пустой `url` — не забытое поле, а «этот файл делается локально». Без явного отказа
    // сюда прилетел бы `fetch('')`, и молча положить чужие байты под чужим именем — худшее,
    // что может сделать стенд, чьё единственное назначение — сравнивать модели честно.
    if (CANDIDATES[id].url === '') {
      throw new Error(`${id}: качать неоткуда, файл делается локально — ${CANDIDATES[id].note}`)
    }

    const response = await fetch(CANDIDATES[id].url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`${id} не скачан: HTTP ${response.status}`)

    const bytes = new Uint8Array(await response.arrayBuffer())
    await writeFile(file, bytes)
    console.log(`${id}: скачан, ${(bytes.length / 1048576).toFixed(1)} МБ`)
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * Время инференса в Node на том же однопоточном wasm, что и в изоляте.
 *
 * Нужно именно ради изолята: там супервизор убивает запрос раньше, чем модель отвечает, и
 * «не влезло» — это весь ответ, какой оттуда можно получить. Насколько не влезло, видно
 * только там, где никто не убивает.
 *
 * Пиксели синтетические: время задаёт размер входа, а не содержимое кадра. Кромку смотрим в
 * браузере и на настоящих кадрах — её в миллисекундах не выразишь.
 */
async function benchNode(list: string[], runs: number): Promise<void> {
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false

  console.log('\n## Инференс в Node, wasm в один поток')

  for (const id of list) {
    const file = modelFile(id)
    const size = await exists(file)
    if (size === null) {
      console.log(`${id}: файла нет — сначала \`npm run cards:cutout fetch ${id}\``)
      continue
    }

    const { side } = CANDIDATES[id]
    const loadStarted = performance.now()
    const session = await ort.InferenceSession.create(await readFile(file), { executionProviders: ['wasm'] })
    const loadMs = performance.now() - loadStarted

    const pixels = new Float32Array(3 * side * side)
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = ((index % 255) / 255 - MEAN[index % 3]) / STD[index % 3]
    }

    const times: number[] = []
    for (let run = 0; run < runs; run += 1) {
      const started = performance.now()
      await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', pixels, [1, 3, side, side]) })
      times.push(performance.now() - started)
    }

    console.log(
      `${id}: файл ${(size / 1048576).toFixed(1)} МБ, вход ${side}×${side}, ` +
        `сессия ${loadMs.toFixed(0)} мс, инференс ${median(times).toFixed(0)} мс ` +
        `(мин ${Math.min(...times).toFixed(0)}, макс ${Math.max(...times).toFixed(0)}), ` +
        `RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} МБ`,
    )
  }
}

/** Приставка каталога с выходами этой оснастки — по ней же они исключаются из поиска кадров. */
const RUN_PREFIX = 'cutout-'

/** Кадры для проверки кромки — то, что реально возвращает вендор, а не студийное фото. */
async function frameFiles(root: string, limit: number): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string): Promise<void> {
    if (found.length >= limit) return
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (found.length >= limit) return
      const path = join(dir, entry.name)
      // Свои же выходы обходим стороной: маски прошлого прогона лежат под тем же корнем и
      // на втором запуске подменили бы кадры сами собой, без единого сообщения об ошибке.
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(RUN_PREFIX)) await walk(path)
      }
      else if (['.png', '.jpg', '.jpeg'].includes(extname(entry.name).toLowerCase())) found.push(path)
    }
  }

  await walk(root)
  return found
}

const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/**
 * Статика для браузерной половины.
 *
 * Файлы отдаются по HTTP, а не вкладываются в страницу: так `onnxruntime-web` грузит свой wasm
 * ровно тем путём, каким будет грузить в проде, а модель на десятки мегабайт не едет через
 * протокол отладки. Сервер локальный, живёт на время прогона и слушает только петлю.
 */
function serveFiles(routes: Record<string, string>): Promise<{ port: number; close: () => void }> {
  const server = createServer(async (request, response) => {
    const file = routes[(request.url ?? '').split('?')[0]]
    if (file === undefined) {
      response.writeHead(404).end()
      return
    }
    try {
      const bytes = await readFile(file)
      response.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        // Без изоляции источника Chromium не даст SharedArrayBuffer, а без него не поднимется
        // многопоточная сборка ORT — то есть браузер мерился бы в одну нитку без причины.
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      })
      response.end(bytes)
    } catch {
      response.writeHead(500).end()
    }
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ port, close: () => server.close() })
    })
  })
}

/**
 * Страница замера. Живёт строкой здесь, а не отдельным файлом, потому что читать её надо
 * вместе с тем, что она меряет: препроцессинг обязан совпадать с половиной в Node до
 * константы, иначе половины меряют разные вещи и сравнивать их нельзя.
 */
function benchPage(): string {
  return `<!doctype html><meta charset="utf-8"><body><script type="module">
import * as ort from './ort/ort.mjs'

globalThis.runBench = async ({ model, side, runs, frames, threads }) => {
  ort.env.wasm.numThreads = threads
  ort.env.wasm.proxy = false

  const loadStarted = performance.now()
  const session = await ort.InferenceSession.create('./models/' + model + '.onnx', { executionProviders: ['wasm'] })
  const loadMs = performance.now() - loadStarted

  const MEAN = ${JSON.stringify(MEAN)}
  const STD = ${JSON.stringify(STD)}
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d', { willReadFrequently: true })

  const toTensor = (source) => {
    context.drawImage(source, 0, 0, side, side)
    const { data } = context.getImageData(0, 0, side, side)
    const pixels = new Float32Array(3 * side * side)
    const plane = side * side
    for (let index = 0; index < plane; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[channel * plane + index] = (data[index * 4 + channel] / 255 - MEAN[channel]) / STD[channel]
      }
    }
    return new ort.Tensor('float32', pixels, [1, 3, side, side])
  }

  // Синтетический вход — ровно тот же, что в Node: только так две половины сравнимы.
  const synthetic = new Float32Array(3 * side * side)
  for (let index = 0; index < synthetic.length; index += 1) {
    synthetic[index] = ((index % 255) / 255 - MEAN[index % 3]) / STD[index % 3]
  }

  const times = []
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', synthetic, [1, 3, side, side]) })
    times.push(performance.now() - started)
  }

  // Маски на настоящих кадрах: кромку в миллисекундах не выразишь, её надо увидеть.
  const masks = []
  for (const frame of frames) {
    const image = new Image()
    image.src = './frames/' + frame
    await image.decode()

    const output = await session.run({ [session.inputNames[0]]: toTensor(image) })
    const raw = output[session.outputNames[0]].data

    let low = Infinity
    let high = -Infinity
    for (const value of raw) {
      if (value < low) low = value
      if (value > high) high = value
    }

    const out = document.createElement('canvas')
    out.width = side
    out.height = side
    const outContext = out.getContext('2d')
    const picture = outContext.createImageData(side, side)
    // Доля пикселей, попавших между «точно фон» и «точно товар», — это и есть мягкость
    // кромки, выраженная числом. Резкая маска даёт единицы процентов, рыхлая — десятки.
    let soft = 0
    for (let index = 0; index < side * side; index += 1) {
      const value = (raw[index] - low) / (high - low || 1)
      if (value > 0.05 && value < 0.95) soft += 1
      const channel = Math.round(value * 255)
      picture.data[index * 4] = channel
      picture.data[index * 4 + 1] = channel
      picture.data[index * 4 + 2] = channel
      picture.data[index * 4 + 3] = 255
    }
    outContext.putImageData(picture, 0, 0)

    masks.push({ frame, png: out.toDataURL('image/png'), softShare: soft / (side * side) })
  }

  return { loadMs, times, masks, threads: ort.env.wasm.numThreads }
}
</script></body>`
}

/**
 * Та же нагрузка в Chromium. Требование ADR-0014: место первой реализации выбирает замер, и
 * браузер — второй кандидат на это место наравне с изолятом.
 */
async function benchBrowser(
  list: string[],
  runs: number,
  framesRoot: string,
  frameLimit: number,
  threads: number,
): Promise<void> {
  const { chromium } = await import('playwright')

  const frames = await frameFiles(framesRoot, frameLimit)
  if (frames.length === 0) console.log(`Кадров в ${framesRoot} не нашлось — кромку смотреть не на чем`)

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const outDir = join(here, '..', '..', 'bench', 'runs', `${RUN_PREFIX}${stamp}`)
  await mkdir(outDir, { recursive: true })

  const routes: Record<string, string> = {}
  for (const name of await readdir(ORT_DIST)) routes[`/ort/${name}`] = join(ORT_DIST, name)
  for (const id of list) routes[`/models/${id}.onnx`] = modelFile(id)
  frames.forEach((file, index) => {
    routes[`/frames/frame-${index}${extname(file)}`] = file
  })

  const served = await serveFiles(routes)
  const browser = await chromium.launch()
  const page = await browser.newPage()

  await page.route(`http://127.0.0.1:${served.port}/`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
      body: benchPage(),
    }),
  )
  page.on('pageerror', (error) => console.log(`  страница: ${error.message}`))
  await page.goto(`http://127.0.0.1:${served.port}/`)

  console.log('\n## Инференс в Chromium, wasm')

  for (const id of list) {
    if ((await exists(modelFile(id))) === null) {
      console.log(`${id}: файла нет — сначала \`npm run cards:cutout fetch ${id}\``)
      continue
    }

    const frameNames = frames.map((file, index) => `frame-${index}${extname(file)}`)
    const result = (await page.evaluate(
      (input) => (globalThis as unknown as { runBench: (arg: unknown) => Promise<unknown> }).runBench(input),
      { model: id, side: CANDIDATES[id].side, runs, frames: frameNames, threads },
    )) as {
      loadMs: number
      times: number[]
      threads: number
      masks: { frame: string; png: string; softShare: number }[]
    }

    console.log(
      `${id}: потоков ${result.threads}, сессия ${result.loadMs.toFixed(0)} мс, ` +
        `инференс ${median(result.times).toFixed(0)} мс ` +
        `(мин ${Math.min(...result.times).toFixed(0)}, макс ${Math.max(...result.times).toFixed(0)})`,
    )

    for (const mask of result.masks) {
      const file = join(outDir, `${id}--${mask.frame.replace(/\.[a-z]+$/i, '')}.png`)
      await writeFile(file, Buffer.from(mask.png.split(',')[1], 'base64'))
      console.log(`  кромка ${mask.frame}: полутон на ${(mask.softShare * 100).toFixed(1)}% пикселей`)
    }
  }

  await browser.close()
  served.close()
  if (frames.length > 0) console.log(`\nМаски: ${outDir}`)
}

/**
 * Выход модели → серая маска и доля полутона. Живёт одной функцией, потому что мера мягкости
 * кромки имеет смысл только пока она у всех кандидатов считается одинаково.
 */
function toMask(raw: Float32Array, activation: Candidate['activation']): { gray: Uint8Array; softShare: number } {
  const gray = new Uint8Array(raw.length)
  let soft = 0

  let low = Infinity
  let high = -Infinity
  if (activation !== 'sigmoid') {
    for (const value of raw) {
      if (value < low) low = value
      if (value > high) high = value
    }
  }

  for (let index = 0; index < raw.length; index += 1) {
    const value =
      activation === 'sigmoid'
        ? 1 / (1 + Math.exp(-raw[index]))
        : (raw[index] - low) / (high - low || 1)
    if (value > 0.05 && value < 0.95) soft += 1
    gray[index] = Math.round(value * 255)
  }

  return { gray, softShare: soft / raw.length }
}

/**
 * Растеризация кадра в RGBA нужного размера **чужим декодером, а не своим**: PNG и JPEG в Node
 * не декодирует ничто стандартное, а `resvg` в проекте уже стоит и растр внутри SVG умеет.
 * Заводить ради этого пакет-декодер — тащить зависимость туда, где она уже есть.
 *
 * `preserveAspectRatio="none"` — не небрежность, а требование сравнимости: браузерная половина
 * растягивает кадр до квадрата вызовом `drawImage(source, 0, 0, side, side)`, и нативная обязана
 * делать ровно то же, иначе на вход модели идут разные картинки.
 */
let resvgReady: Promise<unknown> | undefined

async function framePixels(file: string, side: number): Promise<Uint8Array> {
  const { initWasm, Resvg } = await import('@resvg/resvg-wasm')
  resvgReady ??= initWasm(
    await readFile(new URL('../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)),
  )
  await resvgReady

  const mime = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
  const data = (await readFile(file)).toString('base64')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
    `<image href="data:${mime};base64,${data}" width="${side}" height="${side}" preserveAspectRatio="none"/>` +
    `</svg>`

  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels
}

/** Таблица CRC32 для PNG — та самая из спецификации формата, считается один раз. */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Buffer): number {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(tagged))
  return Buffer.concat([length, tagged, crc])
}

/**
 * Маска — серый квадрат, а не картинка общего вида, поэтому PNG для неё пишется здесь на
 * `node:zlib`: восемь бит на пиксель, фильтр 0 на строку. Три чанка и таблица CRC дешевле,
 * чем зависимость-энкодер ради одного диагностического выхода.
 */
function grayPng(gray: Uint8Array, side: number): Buffer {
  const raw = Buffer.alloc((side + 1) * side)
  for (let row = 0; row < side; row += 1) {
    raw[row * (side + 1)] = 0 // тип фильтра строки
    Buffer.from(gray.subarray(row * side, (row + 1) * side)).copy(raw, row * (side + 1) + 1)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(side, 0)
  header.writeUInt32BE(side, 4)
  header[8] = 8 // бит на канал
  header[9] = 0 // серый без альфы

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * Инференс нативным ONNX Runtime — тем самым, который ADR-0015 выбрал местом первой реализации
 * раннера выреза.
 *
 * Отдельно от режима `node` он существует потому, что меряет другое. Тот гоняет wasm в один
 * поток и отвечает на вопрос изолята «влезает ли». Этот отвечает на вопрос шага B4 «годится ли
 * кромка»: в wasm32 `birefnet-general-lite` не помещается вовсе и падает `bad_alloc`, то есть
 * единственную модель, назначенную ADR-0015 по умолчанию, прежними половинами оснастки было
 * не измерить ни в Node, ни в браузере.
 *
 * Кадры настоящие, а не синтетические: время задаёт размер входа, а кромку — содержимое.
 */
async function benchNative(
  list: string[],
  runs: number,
  framesRoot: string,
  frameLimit: number,
): Promise<void> {
  const ort = await import('onnxruntime-node')

  const frames = await frameFiles(framesRoot, frameLimit)
  if (frames.length === 0) console.log(`Кадров в ${framesRoot} не нашлось — кромку смотреть не на чем`)

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const outDir = join(here, '..', '..', 'bench', 'runs', `${RUN_PREFIX}native-${stamp}`)
  await mkdir(outDir, { recursive: true })

  console.log('\n## Инференс нативным ONNX Runtime')

  for (const id of list) {
    const file = modelFile(id)
    const size = await exists(file)
    if (size === null) {
      console.log(`${id}: файла нет — сначала \`npm run cards:cutout fetch ${id}\``)
      continue
    }

    const { side } = CANDIDATES[id]
    const loadStarted = performance.now()
    const session = await ort.InferenceSession.create(file)
    const loadMs = performance.now() - loadStarted

    // Синтетический вход — тот же, что у обеих прежних половин: только так числа сравнимы.
    const synthetic = new Float32Array(3 * side * side)
    for (let index = 0; index < synthetic.length; index += 1) {
      synthetic[index] = ((index % 255) / 255 - MEAN[index % 3]) / STD[index % 3]
    }

    const times: number[] = []
    for (let run = 0; run < runs; run += 1) {
      const started = performance.now()
      await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', synthetic, [1, 3, side, side]) })
      times.push(performance.now() - started)
    }

    console.log(
      `${id}: файл ${(size / 1048576).toFixed(1)} МБ, вход ${side}×${side}, ` +
        `сессия ${loadMs.toFixed(0)} мс, инференс ${median(times).toFixed(0)} мс ` +
        `(мин ${Math.min(...times).toFixed(0)}, макс ${Math.max(...times).toFixed(0)}), ` +
        `RSS ${(process.memoryUsage().rss / 1048576).toFixed(0)} МБ`,
    )

    const plane = side * side
    for (const frame of frames) {
      const rgba = await framePixels(frame, side)
      const pixels = new Float32Array(3 * plane)
      for (let index = 0; index < plane; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[channel * plane + index] = (rgba[index * 4 + channel] / 255 - MEAN[channel]) / STD[channel]
        }
      }

      const output = await session.run({
        [session.inputNames[0]]: new ort.Tensor('float32', pixels, [1, 3, side, side]),
      })
      const raw = output[session.outputNames[0]].data as Float32Array
      const { gray, softShare } = toMask(raw, CANDIDATES[id].activation)

      // Имя каталога входит в стебель не для красоты: в `bench/samples/` каждый набор зовёт
      // свой снимок `photo-1.jpg`, и по одному имени файла семь масок легли бы друг на друга,
      // оставив от прогона одну последнюю.
      const parts = frame.split(/[\\/]/)
      const leaf = parts.at(-1)?.replace(/\.[a-z]+$/i, '') ?? 'frame'
      const stem = parts.length > 1 ? `${parts.at(-2)}--${leaf}` : leaf
      await writeFile(join(outDir, `${id}__${stem}.png`), grayPng(gray, side))
      // Два знака, а не один: у кандидатов этого класса полутон живёт в десятых долях
      // процента, и на одном знаке 0,24% и 0,35% сливаются в неразличимые «0,2» и «0,4».
      console.log(`  кромка ${stem}: полутон на ${(softShare * 100).toFixed(2)}% пикселей`)
    }
  }

  if (frames.length > 0) console.log(`\nМаски: ${outDir}`)
}

/**
 * Карта занятости на настоящих масках — проверка того обещания шага B4, ради которого карта и
 * считается по долям кадра, а не по пикселям: **смена модели выреза не должна переделывать B5.**
 *
 * Инференса здесь нет и не нужно: маски прошлого прогона `native` уже лежат на диске, и по
 * одним и тем же кадрам их считали разные модели. Прогон бесплатный и берёт секунды.
 *
 *   npm run cards:cutout occupancy -- --masks bench/runs/cutout-native-… [--grid]
 *
 * Последняя строка на кадр и есть замер: сколько ячеек разошлось вердиктом «занято» между
 * моделями. Разойдётся много — форма карты зависит от модели, и это брак проектирования, а не
 * повод подкрутить порог.
 */
async function reportOccupancy(rest: string[], showGrid: boolean): Promise<void> {
  const dir = rest.includes('--masks')
    ? rest[rest.indexOf('--masks') + 1]
    : await latestMaskRun()

  const byFrame = new Map<string, { model: string; map: OccupancyMap }[]>()

  for (const name of (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.png')).sort()) {
    const path = join(dir, name)
    const info = readImageInfo(new Uint8Array(await readFile(path)))
    if (info === null) {
      console.log(`${name}: не распознано как изображение — пропуск`)
      continue
    }

    // Растеризатор оснастки тянет картинку к квадрату (`preserveAspectRatio="none"`), поэтому
    // не-квадратную маску он молча исказил бы, а карта отчиталась бы о чужой геометрии.
    if (info.width !== info.height) {
      console.log(`${name}: маска ${info.width}×${info.height} не квадратная — пропуск`)
      continue
    }

    const rgba = await framePixels(path, info.width)
    // Маска серая: её яркость и есть непрозрачность, поэтому хватает одного канала.
    const alpha = new Uint8Array(info.width * info.height)
    for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4]

    const [model, stem] = splitMaskName(name)
    byFrame.set(stem, [
      ...(byFrame.get(stem) ?? []),
      { model, map: occupancyOf({ width: info.width, height: info.height, alpha }) },
    ])
  }

  console.log(`\n## Карта занятости — ${dir}`)

  for (const [stem, taken] of [...byFrame].sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`\n${stem}`)

    for (const { model, map } of taken) {
      const places = map.free.slice(0, 2).map(boxText).join(' · ')
      console.log(
        `  ${model.padEnd(30)} занято ${map.coverage.toFixed(2)}  ` +
          `габарит ${boxText(map.bounds)}  места ${places === '' ? '—' : places}`,
      )
      if (showGrid) for (const row of gridRows(map)) console.log(`    ${row}`)
    }

    for (let index = 1; index < taken.length; index += 1) {
      const first = taken[0]
      const other = taken[index]
      const apart = cellsApart(first.map, other.map)
      const sameZone = boxText(first.map.free[0] ?? null) === boxText(other.map.free[0] ?? null)
      console.log(
        `  ${first.model} ↔ ${other.model}: вердиктом врозь ${apart.verdicts} ячеек из ` +
          `${first.map.cells.length}, максимум расхождения ${apart.max.toFixed(2)}, ` +
          `лучшее место ${sameZone ? 'то же' : 'другое'}`,
      )
    }
  }
}

async function latestMaskRun(): Promise<string> {
  const root = join(here, '..', '..', 'bench', 'runs')
  const runs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${RUN_PREFIX}native-`))
    .map((entry) => entry.name)
    .sort()

  if (runs.length === 0) throw new Error('Масок на диске нет — сначала `npm run cards:cutout native`')
  return join(root, runs[runs.length - 1])
}

/** Имена масок пишет `native`: `модель__набор--кадр.png`. У прогонов до 2026-09-05 разделитель
 *  был один и тот же (`--`), поэтому разбор пробует оба, а не падает на старом каталоге. */
function splitMaskName(name: string): [string, string] {
  const stem = name.replace(/\.png$/i, '')
  const at = stem.includes('__') ? stem.indexOf('__') : stem.indexOf('--')
  return at === -1 ? ['?', stem] : [stem.slice(0, at), stem.slice(at + 2)]
}

/** Расхождение двух карт: сколько ячеек разошлись вердиктом «занято» и насколько далеко
 *  разошлась сама доля. Первое решает, разъедется ли вёрстка; второе — насколько близко. */
function cellsApart(left: OccupancyMap, right: OccupancyMap): { verdicts: number; max: number } {
  if (left.cols !== right.cols || left.rows !== right.rows) {
    return { verdicts: left.cells.length, max: 1 }
  }

  let verdicts = 0
  let max = 0
  for (let index = 0; index < left.cells.length; index += 1) {
    const a = left.cells[index]
    const b = right.cells[index]
    if ((a >= 0.5) !== (b >= 0.5)) verdicts += 1
    max = Math.max(max, Math.abs(a - b))
  }

  return { verdicts, max }
}

function boxText(box: { x: number; y: number; w: number; h: number } | null): string {
  return box === null
    ? 'нет'
    : `${box.x.toFixed(2)},${box.y.toFixed(2)} ${box.w.toFixed(2)}×${box.h.toFixed(2)}`
}

/** Сетка глазами: цифра на ячейку, 0 — фон, 9 — товар. */
function gridRows(map: OccupancyMap): string[] {
  const rows: string[] = []
  for (let row = 0; row < map.rows; row += 1) {
    const cells = map.cells.slice(row * map.cols, (row + 1) * map.cols)
    rows.push(cells.map((share) => Math.round(share * 9)).join(''))
  }
  return rows
}

function licenceTable(): void {
  console.log('\n## Лицензии кандидатов — по первоисточникам')
  for (const [id, candidate] of Object.entries(CANDIDATES)) {
    console.log(`\n${id}\n  лицензия: ${candidate.license}\n  первоисточник: ${candidate.licenseUrl}\n  ${candidate.note}`)
  }
  for (const [id, candidate] of Object.entries(REJECTED)) {
    console.log(
      `\n${id} — ОТВЕРГНУТ\n  лицензия: ${candidate.license}\n  первоисточник: ${candidate.licenseUrl}\n  ${candidate.note}`,
    )
  }
}

async function main(): Promise<void> {
  const [mode = 'licenses', ...rest] = process.argv.slice(2)
  const runs = Number(rest.includes('--runs') ? rest[rest.indexOf('--runs') + 1] : 5)
  const framesRoot = rest.includes('--frames')
    ? rest[rest.indexOf('--frames') + 1]
    : join(here, '..', '..', 'bench', 'runs')
  const frameLimit = Number(rest.includes('--frame-limit') ? rest[rest.indexOf('--frame-limit') + 1] : 3)
  // Потоки — то, чего у изолята нет: браузерная половина обязана уметь показать эту разницу.
  const threads = Number(rest.includes('--threads') ? rest[rest.indexOf('--threads') + 1] : 1)

  if (mode === 'licenses') licenceTable()
  else if (mode === 'fetch') await fetchModels(ids(rest))
  else if (mode === 'node') await benchNode(ids(rest), runs)
  else if (mode === 'native') await benchNative(ids(rest), runs, framesRoot, frameLimit)
  else if (mode === 'browser') await benchBrowser(ids(rest), runs, framesRoot, frameLimit, threads)
  else if (mode === 'occupancy') await reportOccupancy(rest, rest.includes('--grid'))
  else {
    throw new Error(
      `Неизвестный режим «${mode}». Есть: licenses, fetch, node, native, browser, occupancy`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exitCode = 1
})
