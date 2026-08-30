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
 * **Промпт — замороженная копия, а не импорт** из `supabase/functions/_shared/ai-provider/
 * aitunnel.ts`: тот модуль написан под Deno и тянет за собой `Deno.env`, чтение файлов и
 * сверку профиля. Копия оправдана целью: сравнение честно ровно тогда, когда все модели
 * получают побайтово одинаковый вход, а замороженная строка это гарантирует лучше, чем
 * живой конструктор. Расходится с боевым промптом — значит устарела; сверять при правке
 * `imagePrompt`.
 *
 * **Ключ.** Читается из окружения, при отсутствии — из корневого `.env`, и никуда не
 * печатается: ни в лог, ни в отчёт. В отчёт попадают только имя модели, цена, время и файл.
 *
 * Запуск:
 *   node bench/model-probe.mjs --models seedream-5-0-pro,qwen-image-3,gpt-image-2
 *   node bench/model-probe.mjs --models seedream-4.5 --repeat 3
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

// --- Замороженный вход: набор food-pepsi, профиль ozon × food ---------------------------
//
// Тексты карточки взяты из кадра r1 прогона cardtext-dictated-20260830T144441 — того самого,
// на котором наша нынешняя модель написала «для удобного хранего хранения», «с насыщенным
// вкусом / насыщенный вкусом» и «нотками французской / французской ванили». Вход выбран не
// случайный, а тот, на котором брак уже воспроизводился: чистый кадр здесь — это результат,
// а не везение.

const CARD_TITLE = 'Diet Pepsi Jazz Black Cherry French Vanilla, 12 банок по 355 мл'
const CARD_DESCRIPTION =
  'Газированный напиток Diet Pepsi Jazz с насыщенным вкусом черной вишни и нотками ' +
  'французской ванили. Формула без содержания сахара позволяет наслаждаться любимым ' +
  'сочетанием без лишних калорий. В упаковке 12 жестяных банок для удобного хранения и ' +
  'использования.'

const PROMPT = [
  'Товар: Газированный напиток Pepsi Jazz (категория «Еда и напитки»).',
  'Описание: Газированный напиток без сахара, вкус чёрной вишни и французской ванили, ' +
    'упаковка 12 банок.',
  'Сценарий показа: упаковка отдельно на однородном фоне, студийный свет, этикетка читается.',
  `В кадре, помимо товара, нужен аккуратный текстовый блок — рядом с товаром, не поверх ` +
    `него. Крупной строкой: «${CARD_TITLE}». Под ней, помельче: «${CARD_DESCRIPTION}». ` +
    'Воспроизвести эти две строки дословно, слово в слово, ничего не добавляя и не сокращая. ' +
    'Никакого другого текста в кадре: ни подписей к этим строкам, ни дополнительных полей и ' +
    'характеристик, ни логотипов, водяных знаков и названий магазинов, которых нет на фото ' +
    'товара.',
  'Тот же товар, что на приложенных референсных фото — не заменять другим предметом, ' +
    'сохранить форму, цвет, надписи и логотипы, число объектов не менять.',
  'Если на товаре несколько цветовых блоков или полос — это дизайн обивки, окраски или ' +
    'упаковки, а не государственный флаг, герб или чужой логотип: сохранить именно те ' +
    'оттенки, что на фото, не подгонять под канонические цвета флагов или брендов.',
  'Кадр строго 1:1, фон белый (#FFFFFF), товар не обрезан по краю кадра.',
].join(' ')

const PHOTO = join(ROOT, 'bench', 'samples', 'food-pepsi', 'photo-1.jpg')
const RESOLUTION = '1K'
const ASPECT = '1:1'
const TIMEOUT_MS = 120_000

/** Расширение по сигнатуре: формат выбирает модель, а не мы (шлюз возвращает и JPEG, и PNG). */
function extensionOf(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'webp'
  return 'bin'
}

async function probe(model, config, photoDataUri) {
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: PROMPT,
        resolution: RESOLUTION,
        aspect_ratio: ASPECT,
        input_references: [{ type: 'image_url', image_url: { url: photoDataUri } }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return { model, ok: false, ms: Date.now() - startedAt, error: String(error.message ?? error) }
  }

  const ms = Date.now() - startedAt
  const text = await response.text()

  if (!response.ok) {
    // Отказ шлюза — это ответ, а не сбой пробы: он и сообщает, что модель не приняла наше
    // тело запроса. Денег отказ не стоит.
    return { model, ok: false, ms, status: response.status, error: text.slice(0, 400) }
  }

  let result
  try {
    result = JSON.parse(text)
  } catch {
    return { model, ok: false, ms, error: `не JSON: ${text.slice(0, 200)}` }
  }

  const b64 = result?.data?.[0]?.b64_json
  const url = result?.data?.[0]?.url
  const cost = typeof result?.usage?.cost_rub === 'number' ? result.usage.cost_rub : null

  let bytes = null
  if (typeof b64 === 'string') bytes = Buffer.from(b64, 'base64')
  else if (typeof url === 'string') bytes = Buffer.from(await (await fetch(url)).arrayBuffer())

  if (bytes === null) {
    return { model, ok: false, ms, cost, error: `нет изображения в ответе: ${text.slice(0, 200)}` }
  }

  return { model, ok: true, ms, cost, bytes }
}

const config = { ...readEnvFile(), ...process.env }
const apiKey = config.AI_PROVIDER_API_KEY
const baseUrl = config.AI_PROVIDER_BASE_URL

if (!apiKey) throw new Error('Не задана AI_PROVIDER_API_KEY (ни в окружении, ни в .env)')
if (!baseUrl) throw new Error('Не задана AI_PROVIDER_BASE_URL (ни в окружении, ни в .env)')

const models = String(arg('models', '')).split(',').map((m) => m.trim()).filter(Boolean)
if (models.length === 0) throw new Error('Укажите --models через запятую')

const repeat = Number(arg('repeat', '1'))
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const outDir = join(ROOT, 'bench', 'runs', `model-probe-${stamp}`)
mkdirSync(outDir, { recursive: true })

const photoDataUri = `data:image/jpeg;base64,${readFileSync(PHOTO).toString('base64')}`
const summary = []
let spent = 0

console.log(`Проба ${models.length} моделей × ${repeat}, набор food-pepsi, профиль ozon × food`)
console.log(`Отчёт: ${outDir}\n`)

for (const model of models) {
  for (let n = 1; n <= repeat; n += 1) {
    const label = repeat === 1 ? model : `${model}#${n}`
    process.stdout.write(`  ${label} … `)
    const r = await probe(model, { apiKey, baseUrl }, photoDataUri)

    if (r.ok) {
      const file = `${label.replace(/[^\w.#-]/g, '_')}.${extensionOf(r.bytes)}`
      writeFileSync(join(outDir, file), r.bytes)
      spent += r.cost ?? 0
      summary.push({ model, n, ok: true, ms: r.ms, costRub: r.cost, file, bytes: r.bytes.length })
      console.log(`ок · ${(r.ms / 1000).toFixed(1)} с · ${r.cost ?? '?'} ₽ · ${file}`)
    } else {
      summary.push({ model, n, ok: false, ms: r.ms, status: r.status, error: r.error })
      console.log(`отказ · ${(r.ms / 1000).toFixed(1)} с · ${r.status ?? ''} ${r.error}`)
    }
  }
}

writeFileSync(
  join(outDir, 'probe.json'),
  JSON.stringify({ startedAt: stamp, prompt: PROMPT, resolution: RESOLUTION, aspect: ASPECT, summary }, null, 2),
)

console.log(`\nПотрачено: ${spent.toFixed(2)} ₽ · кадров: ${summary.filter((s) => s.ok).length} из ${summary.length}`)
