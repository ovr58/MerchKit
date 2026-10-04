/**
 * Проба гипотезы «модель верстает карточку в HTML/CSS по кадру и референсам» — вход плана
 * `html-layout-authoring`. Берёт десять сырых кадров прогона B5.10 (`bench/runs/html-<дата>/<папка>/frame.png`
 * + `content.json`, скачаны со стейджа), шлёт их моделям шлюза AITunnel вместе со скилом-жанром
 * (`bench/html-probe/CARD_GENRE.md`) и четырьмя референсами из `bench/samples/wb-starter/`,
 * получает HTML, снимает его Chromium (Playwright) в размер холста и складывает рядом с
 * `library.png` / `directed.png` прогона B5.10. Продуктовый код не трогается.
 *
 * Платно. Цена — `usage.cost_rub` ответа шлюза, как в адаптере `ai-provider/aitunnel.ts`.
 * Потолок и стоп-условия — `STOP`. Запуск из корня MK:
 *   node --env-file=.env --experimental-strip-types <путь к этому файлу> --date 2026-10-05
 *   … --models claude-sonnet-5.5           # одна модель
 *   … --only home-chair.ozon               # одна карточка
 *   … --report-only                        # только страница из записанного
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

const ROOT = process.cwd()
const STOP = { totalRub: 200, failuresInRow: 3, timeoutMs: 180_000 }
const DEFAULT_MODELS = ['claude-sonnet-5.5', 'claude-opus-5.5']
const REFERENCES = [
  'женщинам/Верхняя одежда/Снимок экрана 2026-08-31 173733.jpg',
  'Автотовары/Шины и диски колесные/Шины/Снимок экрана 2026-08-31 182029.jpg',
  'Красота/Парфюмерия/Мужские ароматы/Зеленые/Снимок экрана 2026-08-31 180253.jpg',
  'Обувь/Мужская/Рабочая обувь/Снимок экрана 2026-08-31 175307.jpg',
]

function parseArgs(argv: string[]) {
  const parsed = { date: new Date().toISOString().slice(0, 10), only: null as Set<string> | null, models: DEFAULT_MODELS, reportOnly: false }
  for (let at = 0; at < argv.length; at++) {
    const key = argv[at].replace(/^--/, '')
    if (key === 'report-only') parsed.reportOnly = true
    else if (key === 'date') parsed.date = argv[++at]
    else if (key === 'only') parsed.only = new Set(argv[++at].split(',').map((id) => id.trim()))
    else if (key === 'models') parsed.models = argv[++at].split(',').map((id) => id.trim())
    else throw new Error(`Неизвестный аргумент: ${argv[at]}`)
  }
  return parsed
}

const options = parseArgs(process.argv.slice(2))
const runDir = join(ROOT, 'bench', 'runs', `html-${options.date}`)
const directorDir = join(ROOT, 'bench', 'runs', 'director-2026-10-04')
const statePath = join(runDir, 'state.json')

type Attempt = { model: string; costRub: number; durationMs: number; promptTokens?: number; completionTokens?: number; html: string; png: string; error?: string }
type Record_ = { caseId: string; folder: string; attempts: Attempt[] }
const state: { records: Record_[] } = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { records: [] }
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))

const dataUri = (path: string) => {
  const ext = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
  return `data:${ext};base64,${readFileSync(path).toString('base64')}`
}

const GENRE = readFileSync(join(ROOT, 'bench', 'html-probe', 'CARD_GENRE.md'), 'utf8')
const fontDir = join(ROOT, 'tools', 'card-pipeline', 'fonts')
const FONT_FACES = [
  ['montserrat-regular.ttf', 'Montserrat', 400],
  ['montserrat-semibold.ttf', 'Montserrat', 600],
  ['montserrat-bold.ttf', 'Montserrat', 700],
  ['montserrat-black.ttf', 'Montserrat', 900],
  ['marck-script.ttf', 'Marck Script', 400],
]
  .map(([file, family, weight]) => `@font-face{font-family:'${family}';font-weight:${weight};src:url('${pathToFileURL(join(fontDir, String(file))).href}') format('truetype')}`)
  .join('\n')

type Content = {
  caseId: string; marketplaceId: string; categoryId: string; canvas: { width: number; height: number }
  title: string; properties: { label: string; value: string }[]
  content: { texts: { title?: string[]; body?: string[] } } | null
}

function brief(content: Content): string {
  const texts = content.content?.texts ?? {}
  return [
    `Площадка: ${content.marketplaceId}. Категория: ${content.categoryId}. Холст: ${content.canvas.width}×${content.canvas.height} px (W×H).`,
    `Название товара (полное): ${content.title}`,
    `Короткий заголовок: ${(texts.title ?? []).join(' ') || '—'}`,
    `Описание продавца: ${(texts.body ?? []).join(' ') || '—'}`,
    `Свойства (по порядку важности): ${content.properties.map((p) => `${p.label} — ${p.value}`).join('; ') || '—'}`,
    'Первая картинка — кадр, который лежит фоном. Остальные — референсы жанра (другие товары, их тексты не копировать).',
    'Верни один блок ```html``` по форме скила.',
  ].join('\n')
}

async function callModel(model: string, content: Content, framePath: string): Promise<{ html: string; costRub: number; durationMs: number; usage: any }> {
  const base = process.env.AI_PROVIDER_BASE_URL
  const key = process.env.AI_PROVIDER_API_KEY
  if (!base || !key) throw new Error('Нет AI_PROVIDER_BASE_URL / AI_PROVIDER_API_KEY: запускайте через node --env-file=.env')
  const images = [framePath, ...REFERENCES.map((ref) => join(ROOT, 'bench', 'samples', 'wb-starter', ref))]
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STOP.timeoutMs)
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: GENRE },
        {
          role: 'user',
          content: [
            ...images.map((path) => ({ type: 'image_url', image_url: { url: dataUri(path) } })),
            { type: 'text', text: brief(content) },
          ],
        },
      ],
    }),
  }).finally(() => clearTimeout(timer))
  const durationMs = Date.now() - started
  if (!res.ok) throw new Error(`шлюз HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const result: any = await res.json()
  const text: string = result?.choices?.[0]?.message?.content ?? ''
  const match = text.match(/```html\s*([\s\S]*?)```/i)
  if (!match) throw new Error(`в ответе нет блока html (${text.slice(0, 200)})`)
  const costRub = Number(result?.usage?.cost_rub ?? 0)
  return { html: match[1].trim(), costRub: Number.isFinite(costRub) ? costRub : 0, durationMs, usage: result?.usage }
}

function withFonts(html: string): string {
  const style = `<style>${FONT_FACES}</style>`
  return html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : html.replace(/<html[^>]*>/i, (m) => `${m}<head>${style}</head>`)
}

async function screenshot(htmlPath: string, pngPath: string, canvas: { width: number; height: number }) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: canvas, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlPath).href)
    await page.evaluate(() => (document as any).fonts.ready)
    await page.waitForTimeout(300)
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, ...canvas } })
  } finally {
    await browser.close()
  }
}

const slug = (model: string) => model.replace(/[^a-z0-9]+/gi, '-')

async function run() {
  const folders = readdirSync(runDir).filter((name) => existsSync(join(runDir, name, 'frame.png'))).sort()
  let total = state.records.flatMap((r) => r.attempts).reduce((sum, a) => sum + a.costRub, 0)
  let failures = 0
  for (const folder of folders) {
    const content = JSON.parse(readFileSync(join(runDir, folder, 'content.json'), 'utf8')) as Content
    if (options.only && !options.only.has(content.caseId)) continue
    let record = state.records.find((r) => r.caseId === content.caseId)
    if (!record) { record = { caseId: content.caseId, folder, attempts: [] }; state.records.push(record) }
    for (const model of options.models) {
      if (record.attempts.some((a) => a.model === model && !a.error)) { console.log(content.caseId, model, 'есть'); continue }
      if (total >= STOP.totalRub) { console.log(`СТОП: потолок ${STOP.totalRub} ₽ достигнут (${total.toFixed(2)})`); save(); return }
      const htmlName = `${slug(model)}.html`
      const pngName = `${slug(model)}.png`
      try {
        const { html, costRub, durationMs, usage } = await callModel(model, content, join(runDir, folder, 'frame.png'))
        writeFileSync(join(runDir, folder, htmlName), withFonts(html))
        await screenshot(join(runDir, folder, htmlName), join(runDir, folder, pngName), content.canvas)
        record.attempts = record.attempts.filter((a) => a.model !== model)
        record.attempts.push({ model, costRub, durationMs, promptTokens: usage?.prompt_tokens, completionTokens: usage?.completion_tokens, html: htmlName, png: pngName })
        total += costRub
        failures = 0
        console.log(content.caseId, model, `${costRub.toFixed(2)} ₽`, `${durationMs} мс`, `вход ${usage?.prompt_tokens ?? '?'} выход ${usage?.completion_tokens ?? '?'}`, `итого ${total.toFixed(2)} ₽`)
      } catch (error) {
        failures++
        record.attempts.push({ model, costRub: 0, durationMs: 0, html: '', png: '', error: String(error) })
        console.log(content.caseId, model, 'ОШИБКА', String(error).slice(0, 200))
        if (failures >= STOP.failuresInRow) { console.log('СТОП: три ошибки подряд'); save(); return }
      }
      save()
    }
  }
}

function report() {
  const models = options.models
  const rows = state.records.map((record) => {
    const cells = [
      `<figure><img src="${resolve(directorDir, record.folder, 'library.png').replace(/\\/g, '/')}"><figcaption>библиотека (B5.10)</figcaption></figure>`,
      `<figure><img src="${resolve(directorDir, record.folder, 'directed.png').replace(/\\/g, '/')}"><figcaption>с правкой арт-директора (B5.10)</figcaption></figure>`,
      ...models.map((model) => {
        const attempt = record.attempts.find((a) => a.model === model && !a.error)
        if (!attempt) return `<figure><div class="none">нет</div><figcaption>${model}</figcaption></figure>`
        return `<figure><img src="${resolve(runDir, record.folder, attempt.png).replace(/\\/g, '/')}"><figcaption>${model} · ${attempt.costRub.toFixed(2)} ₽ · ${(attempt.durationMs / 1000).toFixed(0)} с</figcaption></figure>`
      }),
    ]
    return `<section><h2>${record.caseId}</h2><div class="row">${cells.join('')}</div></section>`
  })
  const total = state.records.flatMap((r) => r.attempts).reduce((sum, a) => sum + a.costRub, 0)
  const html = `<!doctype html><meta charset="utf-8"><title>HTML-проба ${options.date}</title>
<style>body{font:14px system-ui;margin:16px}.row{display:flex;gap:12px}figure{margin:0;width:${Math.floor(100 / (models.length + 2))}%}img{width:100%;border:1px solid #ccc}figcaption{font-size:12px;color:#555}.none{height:200px;background:#eee}</style>
<h1>HTML-проба ${options.date} — итого ${total.toFixed(2)} ₽</h1>${rows.join('')}`
  writeFileSync(join(runDir, 'report.html'), html)
  console.log('страница:', join(runDir, 'report.html'))
}

if (!options.reportOnly) await run()
report()
