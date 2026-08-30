/**
 * Проба моделей изображений: один и тот же кадр на разных моделях шлюза.
 *
 * **Зачем отдельно от `bench/run.mjs`.** Модель выбирается переменной окружения
 * `AI_PROVIDER_IMAGE_MODEL`, а она подставляется в момент `supabase start` — сравнить пять
 * моделей штатным стендом значит пять раз править `.env` и пять раз перезапускать стек
 * целиком. Пробник бьёт в шлюз напрямую: одна команда, ноль перезапусков.
 *
 * **Чего он намеренно НЕ проверяет:** сверку профиля площадки, запись в БД, списание баллов —
 * весь путь вокруг вызова. Он отвечает ровно на два вопроса: принимает ли модель наше тело
 * запроса и что она рисует на нашем входе. Победитель после этого проверяется штатным
 * прогоном `bench/run.mjs`, а не выкатывается по одной пробе.
 *
 * **Попутно он оказался контрольным экспериментом для B13:** его секундомер сошёлся с
 * вендорским логом на пяти вызовах подряд, тогда как боевой конвейер на том же вызове
 * показывает втрое больше. Значит разрыв — внутри нашего стека, а не в проводе.
 *
 * **Справочники ниже — замороженная копия** таблиц `categories`, `presets` и
 * `marketplace_profiles` и промпта из `supabase/functions/_shared/ai-provider/aitunnel.ts`.
 * Импортировать нельзя: тот модуль под Deno и тянет `Deno.env`, чтение файлов и сверку
 * профиля, а таблицы живут в БД, которую пробник намеренно не поднимает. Копия оправдана
 * целью — сравнение честно ровно тогда, когда все модели получают побайтово одинаковый вход.
 * Расходится с боевым кодом — значит устарела; сверять при правке `imagePrompt` и миграций.
 *
 * **Ключ.** Читается из окружения, при отсутствии — из корневого `.env`, и никуда не
 * печатается: ни в лог, ни в отчёт. В отчёт попадают только имя модели, цена, время и файл.
 *
 * Запуск:
 *   node bench/model-probe.mjs --models gpt-image-2 --repeat 5 --size 1024x1024
 *   node bench/model-probe.mjs --models gpt-image-2 --samples all --title-only
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Значения из `.env` — только те два имени, что нужны вызову. Файл не печатается. */
function readEnvFile() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const at = line.indexOf('=')
    if (at <= 0 || line.trimStart().startsWith('#')) continue
    const name = line.slice(0, at).trim()
    if (name !== 'AI_PROVIDER_API_KEY' && name !== 'AI_PROVIDER_BASE_URL') continue
    out[name] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 || at === process.argv.length - 1 ? fallback : process.argv[at + 1]
}

// --- Справочники: копия миграций 20260829100000 и 20260829140000 -------------------------

const CATEGORY_TITLES = {
  clothing: 'Одежда и обувь',
  accessories: 'Аксессуары',
  food: 'Еда и напитки',
  beauty: 'Косметика и уход',
  tech: 'Гаджеты и техника',
  home: 'Дом и мебель',
  other: 'Прочее',
}

const PRESET_PROMPTS = {
  'accessories-inhand': 'товар в руках модели, по руке читается реальный размер, мягкий дневной свет',
  'accessories-studio': 'товар отдельно на однородном фоне, студийный свет, без реквизита',
  'beauty-studio': 'флакон или туба отдельно на однородном фоне, студийный свет, этикетка читается',
  'clothing-studio': 'товар отдельно на однородном фоне, студийный свет, без реквизита',
  'food-studio': 'упаковка отдельно на однородном фоне, студийный свет, этикетка читается',
  'home-studio': 'предмет отдельно на однородном фоне, студийный свет, без реквизита',
}

/** Профили площадок после обеих миграций. `default` — строка с `category_id is null`. */
const PROFILES = {
  'ozon×food': { w: 1024, h: 1024, aw: 1, ah: 1, bg: '#FFFFFF', bgTitle: 'белый' },
  'ozon×clothing': { w: 1792, h: 2400, aw: 3, ah: 4, bg: '#F2F3F5', bgTitle: 'серый #F2F3F5' },
  'ozon×accessories': { w: 1792, h: 2400, aw: 3, ah: 4, bg: '#F2F3F5', bgTitle: 'серый #F2F3F5' },
  'ozon×default': { w: 896, h: 1200, aw: 3, ah: 4, bg: '#FFFFFF', bgTitle: 'белый' },
}

function profileOf(sample) {
  return PROFILES[`${sample.marketplaceId}×${sample.categoryId}`]
    ?? PROFILES[`${sample.marketplaceId}×default`]
}

/** Бакет шлюза по длинной стороне — копия `resolutionParam`. */
function resolutionOf(profile) {
  const longEdge = Math.max(profile.w, profile.h)
  if (longEdge <= 600) return '512'
  if (longEdge <= 1200) return '1K'
  if (longEdge <= 2400) return '2K'
  return '4K'
}

/**
 * `size` в пикселях для OpenAI-совместимых моделей, которые не принимают бакет и соотношение.
 * Числа — не пиксели профиля, а ближайший кадр той же формы, проходящий порог площадки:
 * 1536 × 2048 проверено вызовом и покрывает порог 900 × 1200 у одежды и аксессуаров.
 */
function sizeOf(profile) {
  return profile.aw === profile.ah ? '1024x1024' : '1536x2048'
}

// --- Промпт ------------------------------------------------------------------------------

/**
 * Текстовый блок карточки.
 *
 * `titleOnly` — вариант «в кадр только заголовок, описание рядом с изображением». Замер
 * 2026-08-30 показал, что заголовок и описание ведут себя по-разному: все дефекты
 * `gpt-image-2` пришлись на длинное описание, заголовок был верен во всех семи кадрах.
 */
function cardLayoutLine(title, description, titleOnly) {
  if (titleOnly) {
    return `В кадре, помимо товара, нужен аккуратный текстовый блок — рядом с товаром, не ` +
      `поверх него. Одной крупной строкой: «${title}». Воспроизвести её дословно, слово в ` +
      'слово, ничего не добавляя и не сокращая. Никакого другого текста в кадре: ни описания, ' +
      'ни подписей к строке, ни дополнительных полей и характеристик, ни логотипов, водяных ' +
      'знаков и названий магазинов, которых нет на фото товара.'
  }

  return `В кадре, помимо товара, нужен аккуратный текстовый блок — рядом с товаром, не ` +
    `поверх него. Крупной строкой: «${title}». Под ней, помельче: «${description}». ` +
    'Воспроизвести эти две строки дословно, слово в слово, ничего не добавляя и не сокращая. ' +
    'Никакого другого текста в кадре: ни подписей к этим строкам, ни дополнительных полей и ' +
    'характеристик, ни логотипов, водяных знаков и названий магазинов, которых нет на фото ' +
    'товара.'
}

function buildPrompt({ title, categoryTitle, description, scenario, profile, cardTitle, cardDescription, titleOnly }) {
  return [
    `Товар: ${title} (категория «${categoryTitle}»).`,
    description.trim() === '' ? '' : `Описание: ${description.trim()}.`,
    scenario.trim() === ''
      ? 'Сцена показа — на усмотрение, товар должен быть виден полностью и чётко.'
      : `Сценарий показа: ${scenario}.`,
    cardLayoutLine(cardTitle, cardDescription, titleOnly),
    'Тот же товар, что на приложенных референсных фото — не заменять другим предметом, ' +
      'сохранить форму, цвет, надписи и логотипы, число объектов не менять.',
    'Если на товаре несколько цветовых блоков или полос — это дизайн обивки, окраски или ' +
      'упаковки, а не государственный флаг, герб или чужой логотип: сохранить именно те ' +
      'оттенки, что на фото, не подгонять под канонические цвета флагов или брендов.',
    `Кадр строго ${profile.aw}:${profile.ah}, фон ${profile.bgTitle} (${profile.bg}), ` +
      'товар не обрезан по краю кадра.',
  ].filter((line) => line !== '').join(' ')
}

// --- Замороженный вход набора food-pepsi для режима `--models` ---------------------------
//
// Тексты карточки взяты из кадра r1 прогона cardtext-dictated-20260830T144441 — того самого,
// на котором наша модель написала «для удобного хранего хранения». Вход выбран не случайный,
// а тот, на котором брак уже воспроизводился: чистый кадр здесь — результат, а не везение.

const PEPSI = {
  title: 'Газированный напиток Pepsi Jazz',
  categoryTitle: 'Еда и напитки',
  description: 'Газированный напиток без сахара, вкус чёрной вишни и французской ванили, упаковка 12 банок',
  scenario: PRESET_PROMPTS['food-studio'],
  profile: PROFILES['ozon×food'],
  cardTitle: 'Diet Pepsi Jazz Black Cherry French Vanilla, 12 банок по 355 мл',
  cardDescription:
    'Газированный напиток Diet Pepsi Jazz с насыщенным вкусом черной вишни и нотками ' +
    'французской ванили. Формула без содержания сахара позволяет наслаждаться любимым ' +
    'сочетанием без лишних калорий. В упаковке 12 жестяных банок для удобного хранения и ' +
    'использования.',
  titleOnly: false,
}

const TIMEOUT_MS = 120_000

/** Расширение по сигнатуре: формат выбирает модель, а не мы (шлюз возвращает и JPEG, и PNG). */
function extensionOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp'
  return 'bin'
}

async function probe(model, config, task) {
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: task.prompt,
        // Три формы запроса, а не одна: модели каталога делятся на принимающих бакет с
        // соотношением и на OpenAI-совместимых, ждущих `size` в пикселях. Боевой код умеет
        // только первую — это находка про наш код, а не только про модель.
        ...(task.size ? { size: task.size } : { resolution: task.resolution, aspect_ratio: task.aspect }),
        input_references: [{ type: 'image_url', image_url: { url: task.photo } }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, ms: Date.now() - startedAt, error: String(error.message ?? error) }
  }

  const ms = Date.now() - startedAt
  const text = await response.text()

  if (!response.ok) {
    // Отказ шлюза — это ответ, а не сбой пробы: он и сообщает, что модель не приняла наше
    // тело запроса. Денег отказ не стоит.
    return { ok: false, ms, status: response.status, error: text.slice(0, 400) }
  }

  let result
  try {
    result = JSON.parse(text)
  } catch {
    return { ok: false, ms, error: `не JSON: ${text.slice(0, 200)}` }
  }

  const b64 = result?.data?.[0]?.b64_json
  const url = result?.data?.[0]?.url
  const cost = typeof result?.usage?.cost_rub === 'number' ? result.usage.cost_rub : null

  let bytes = null
  if (typeof b64 === 'string') bytes = Buffer.from(b64, 'base64')
  else if (typeof url === 'string') bytes = Buffer.from(await (await fetch(url)).arrayBuffer())

  if (bytes === null) return { ok: false, ms, cost, error: `нет изображения: ${text.slice(0, 200)}` }

  return { ok: true, ms, cost, bytes }
}

function photoDataUri(dir) {
  const name = readdirSync(dir).find((f) => /\.(jpe?g|png)$/i.test(f))
  if (!name) throw new Error(`В наборе ${dir} нет фото`)
  const mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(join(dir, name)).toString('base64')}`
}

// --- Сборка заданий ----------------------------------------------------------------------

const config = { ...readEnvFile(), ...process.env }
if (!config.AI_PROVIDER_API_KEY) throw new Error('Не задана AI_PROVIDER_API_KEY (ни в окружении, ни в .env)')
if (!config.AI_PROVIDER_BASE_URL) throw new Error('Не задана AI_PROVIDER_BASE_URL (ни в окружении, ни в .env)')

const gateway = { apiKey: config.AI_PROVIDER_API_KEY, baseUrl: config.AI_PROVIDER_BASE_URL }

const models = String(arg('models', '')).split(',').map((m) => m.trim()).filter(Boolean)
if (models.length === 0) throw new Error('Укажите --models через запятую')

const repeat = Number(arg('repeat', '1'))
const titleOnly = process.argv.includes('--title-only')
const forcedSize = arg('size', '')
const samplesArg = arg('samples', '')

const tasks = []

if (samplesArg) {
  const dir = join(ROOT, 'bench', 'samples')
  const names = samplesArg === 'all'
    ? readdirSync(dir).filter((n) => existsSync(join(dir, n, 'sample.json')))
    : samplesArg.split(',').map((n) => n.trim()).filter(Boolean)

  for (const name of names) {
    const sample = JSON.parse(readFileSync(join(dir, name, 'sample.json'), 'utf8'))
    const profile = profileOf(sample)
    if (!profile) throw new Error(`Нет профиля для ${sample.marketplaceId} × ${sample.categoryId}`)

    tasks.push({
      id: name,
      photo: photoDataUri(join(dir, name)),
      resolution: resolutionOf(profile),
      aspect: `${profile.aw}:${profile.ah}`,
      size: forcedSize || sizeOf(profile),
      prompt: buildPrompt({
        title: sample.productTitle,
        categoryTitle: CATEGORY_TITLES[sample.categoryId] ?? sample.categoryId,
        description: sample.productDescription ?? '',
        scenario: PRESET_PROMPTS[sample.presetId] ?? sample.wishes ?? '',
        profile,
        cardTitle: sample.productTitle,
        cardDescription: sample.productDescription ?? '',
        titleOnly,
      }),
    })
  }
} else {
  tasks.push({
    id: 'food-pepsi',
    photo: photoDataUri(join(ROOT, 'bench', 'samples', 'food-pepsi')),
    resolution: resolutionOf(PEPSI.profile),
    aspect: `${PEPSI.profile.aw}:${PEPSI.profile.ah}`,
    size: forcedSize || null,
    prompt: buildPrompt({ ...PEPSI, titleOnly }),
  })
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const outDir = join(ROOT, 'bench', 'runs', `model-probe-${stamp}`)
mkdirSync(outDir, { recursive: true })

const summary = []
let spent = 0

console.log(`Проба: ${models.length} моделей × ${tasks.length} наборов × ${repeat}`)
console.log(`Блок: ${titleOnly ? 'только заголовок' : 'заголовок и описание'}`)
console.log(`Отчёт: ${outDir}\n`)

for (const model of models) {
  for (const task of tasks) {
    for (let n = 1; n <= repeat; n += 1) {
      const label = [model, tasks.length > 1 ? task.id : '', repeat > 1 ? `#${n}` : '']
        .filter(Boolean).join('_')
      process.stdout.write(`  ${label} … `)
      const r = await probe(model, gateway, task)

      if (r.ok) {
        const file = `${label.replace(/[^\w.#-]/g, '_')}.${extensionOf(r.bytes)}`
        writeFileSync(join(outDir, file), r.bytes)
        spent += r.cost ?? 0
        summary.push({ model, sample: task.id, n, ok: true, ms: r.ms, costRub: r.cost, file })
        console.log(`ок · ${(r.ms / 1000).toFixed(1)} с · ${r.cost ?? '?'} ₽ · ${file}`)
      } else {
        summary.push({ model, sample: task.id, n, ok: false, ms: r.ms, status: r.status, error: r.error })
        console.log(`отказ · ${(r.ms / 1000).toFixed(1)} с · ${r.status ?? ''} ${r.error}`)
      }
    }
  }
}

writeFileSync(
  join(outDir, 'probe.json'),
  JSON.stringify({ startedAt: stamp, titleOnly, tasks: tasks.map(({ photo, ...t }) => t), summary }, null, 2),
)

console.log(`\nПотрачено: ${spent.toFixed(2)} ₽ · кадров: ${summary.filter((s) => s.ok).length} из ${summary.length}`)
