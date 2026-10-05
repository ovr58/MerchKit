/**
 * Пробный прогон сочинения карточки на стейдже — шаг C6 плана `html-layout-authoring_2026-10-05.md`.
 *
 * Боевой путь стейджа с `CARD_AUTHOR=on`: заявка `generate` → воркер → сочинение (`authorCard` →
 * `/layout` → слои) или откат на макет библиотеки → `generation_cards.origin`. По каждой карточке
 * пишется `origin`, цена и время `authorCard` из `generation_costs`, время заявки и PNG карточки.
 * Наборы — те же десять, что у `bench/director-probe.mts` и `bench/html-probe.mts`; рядом на
 * странице — `library.png` прогона B5.10 (`bench/runs/director-2026-10-04/`), как в HTML-пробе.
 * Продуктовый код не трогается.
 *
 * **Строго последовательно.** Шлюз AITunnel резервирует цену запроса по `max_tokens` (Sonnet 5.5 с
 * картинками — 200 ₽) и при балансе ниже резерва отвечает 402. Поэтому карточки идут одна за другой,
 * следующая — только когда предыдущая генерация закончилась, и перед каждой сверяется баланс шлюза
 * (`GET {AI_PROVIDER_BASE_URL}/aitunnel/balance`, бесплатно): ниже `STOP.gatewayRub` — стоп и доклад.
 *
 * Ключи стейджа — `supabase projects api-keys --reveal` (токен `SUPABASE_ACCESS_TOKEN` из окружения),
 * ключ шлюза — `AI_PROVIDER_API_KEY`; только в памяти процесса: ни в вывод, ни в файл.
 *
 * Запуск (платно; перед ним — логи шлюза включены, баланс ≥ 250 ₽):
 *   node --env-file=.env --experimental-strip-types bench/author-probe.mts --date 2026-10-05
 *   … --only home-chair.ozon,food-pepsi.ozon     # отдельные карточки
 *   … --dry-run                                  # без сети: план прогона и проверка файлов
 *   … --report-only                              # пересобрать страницу из записанного
 */

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REF = 'uqybgbudlnlbyarkgcwk'
const URL_BASE = `https://${REF}.supabase.co`

/**
 * Стоп-условия шага C6: баланс шлюза перед каждой карточкой не ниже 250 ₽ (резерв Sonnet — 200 ₽
 * плюс запас на кадр и тексты той же генерации); три провала подряд; генерация дольше пяти минут.
 */
const STOP = { gatewayRub: 250, failuresInRow: 3, settleMs: 300_000 }

/** Секреты воркера, без которых сочинение не идёт (C3): проверяются по имени, значения не читаются. */
const REQUIRED_SECRETS = ['CARD_AUTHOR', 'CUTOUT_LAYOUT_ENDPOINT', 'CUTOUT_SECRET']

/** Те же десять карточек, что у `director-probe.mts`: номер в списке — номер папки прогона B5.10. */
const CASES: { sample: string; marketplaceId: string }[] = [
  { sample: 'beauty-cream', marketplaceId: 'ozon' },
  { sample: 'accessories-sunglasses', marketplaceId: 'ozon' },
  { sample: 'home-chair', marketplaceId: 'ozon' },
  { sample: 'accessories-watch', marketplaceId: 'ozon' },
  { sample: 'clothing-shoes', marketplaceId: 'ozon' },
  { sample: 'beauty-cream', marketplaceId: 'wildberries' },
  { sample: 'home-chair', marketplaceId: 'wildberries' },
  { sample: 'accessories-sunglasses', marketplaceId: 'yandex' },
  { sample: 'food-pepsi', marketplaceId: 'ozon' },
  { sample: 'other-bobblehead', marketplaceId: 'ozon' },
]

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

/* ------------------------------------------------------------------------- аргументы */

function parseArgs(argv: string[]) {
  const parsed = {
    date: new Date().toISOString().slice(0, 10),
    only: null as Set<string> | null,
    reportOnly: false,
    dryRun: false,
    libraryRun: 'director-2026-10-04',
  }
  for (let at = 0; at < argv.length; at++) {
    const key = argv[at].replace(/^--/, '')
    if (key === 'report-only') parsed.reportOnly = true
    else if (key === 'dry-run') parsed.dryRun = true
    else if (key === 'date') parsed.date = argv[++at]
    else if (key === 'library-run') parsed.libraryRun = argv[++at]
    else if (key === 'only') parsed.only = new Set(argv[++at].split(',').map((id) => id.trim()))
    else throw new Error(`Неизвестный аргумент: ${argv[at]}`)
  }
  return parsed
}

const options = parseArgs(process.argv.slice(2))
const outDir = join(ROOT, 'bench', 'runs', `author-${options.date}`)
const libraryDir = join(ROOT, 'bench', 'runs', options.libraryRun)
const statePath = join(outDir, 'state.json')

type CaseRecord = Record<string, unknown> & { caseId: string }
type State = { user?: { id: string; email: string; password: string }; records: CaseRecord[] }
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { records: [] }
const save = () => {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

const caseId = (entry: { sample: string; marketplaceId: string }) => `${entry.sample}.${entry.marketplaceId}`
const folderOf = (index: number, id: string) => `${String(index + 1).padStart(2, '0')}-${id}`

/* ------------------------------------------------------------------------- шлюз */

/** Баланс шлюза, ₽: остаток счёта, а при бюджете ключа — меньшее из двух (резерв идёт из обоих). */
async function gatewayBalance(): Promise<number> {
  const base = process.env.AI_PROVIDER_BASE_URL
  const key = process.env.AI_PROVIDER_API_KEY
  if (!base || !key) throw new Error('Нет AI_PROVIDER_BASE_URL / AI_PROVIDER_API_KEY: запускайте через `node --env-file=.env`')
  const res = await fetch(`${base.replace(/\/$/, '')}/aitunnel/balance`, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) throw new Error(`Баланс шлюза: HTTP ${res.status}`)
  const body = (await res.json()) as { balance?: unknown; budget?: unknown }
  const balance = Number(body.balance)
  if (!Number.isFinite(balance)) throw new Error('Баланс шлюза: в ответе нет числа balance')
  const budget = Number(body.budget)
  return body.budget === undefined || !Number.isFinite(budget) ? balance : Math.min(balance, budget)
}

/* ------------------------------------------------------------------------- стейдж */

function cli(args: string[]): string {
  return execFileSync('npx', ['supabase', ...args], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] })
}

let SERVICE = ''
let ANON = ''

async function connect(): Promise<void> {
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Нет SUPABASE_ACCESS_TOKEN: запускайте через `node --env-file=.env`')
  const names = (JSON.parse(cli(['secrets', 'list', '--project-ref', REF, '-o', 'json'])) as { name: string }[]).map((s) => s.name)
  const missing = REQUIRED_SECRETS.filter((name) => !names.includes(name))
  if (missing.length > 0) throw new Error(`В стейдже нет секретов ${missing.join(', ')} — стоп, доклад владельцу`)
  const keys = JSON.parse(cli(['projects', 'api-keys', '--project-ref', REF, '--reveal', '-o', 'json'])) as { name: string; api_key: string }[]
  SERVICE = keys.find((key) => key.name === 'service_role')?.api_key ?? ''
  ANON = keys.find((key) => key.name === 'anon')?.api_key ?? ''
  if (!SERVICE || !ANON) throw new Error('api-keys не вернул service_role/anon')
  console.log(`стейдж ${REF}: секреты ${REQUIRED_SECRETS.join(', ')} в списке есть (значения не видны — CARD_AUTHOR=on подтверждает владелец), ключи получены`)
}

const asService = (extra: Record<string, string> = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...extra })

async function rest(query: string): Promise<unknown[]> {
  const res = await fetch(`${URL_BASE}/rest/v1/${query}`, { headers: asService() })
  if (!res.ok) throw new Error(`REST ${query.split('?')[0]}: HTTP ${res.status}`)
  return (await res.json()) as unknown[]
}

async function download(bucket: string, path: string): Promise<Uint8Array> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: asService() })
  if (!res.ok) throw new Error(`Storage ${bucket}/${path}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function ensureUser(): Promise<{ id: string; token: string }> {
  if (!state.user) {
    const email = `author-probe.${Date.now()}@example.com`
    const password = randomBytes(12).toString('hex')
    const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: asService({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    if (!res.ok) throw new Error(`Тестовый пользователь не создан: HTTP ${res.status}`)
    state.user = { id: ((await res.json()) as { id: string }).id, email, password }
    save()
    console.log(`тестовый пользователь ${email} (${state.user.id})`)
  }

  const signed = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: state.user.email, password: state.user.password }),
  })
  if (!signed.ok) throw new Error(`Вход тестового пользователя: HTTP ${signed.status}`)
  return { id: state.user.id, token: ((await signed.json()) as { access_token: string }).access_token }
}

const userFetch = (token: string, path: string, body: unknown) =>
  fetch(`${URL_BASE}/functions/v1/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

async function pointsOf(userId: string): Promise<number> {
  const [row] = (await rest(`profiles?id=eq.${userId}&select=balance`)) as { balance: number }[]
  return row?.balance ?? 0
}

/* -------------------------------------------------------------------------- прогон */

type Cost = { operation: string; vendor: string; cost_rub: string; duration_ms: number; created_at: string }

function summarise(costs: Cost[]) {
  const sum = (operation: string) => costs.filter((cost) => cost.operation === operation).reduce((total, cost) => total + Number(cost.cost_rub), 0)
  const calls = costs.filter((cost) => cost.operation === 'authorCard')
  return {
    authorCalls: calls.length,
    authorRub: sum('authorCard'),
    authorMs: calls.reduce((total, cost) => total + cost.duration_ms, 0),
    imageRub: sum('generateImages'),
    otherRub: sum('moderate') + sum('composeCard') + sum('nameGeneration') + sum('directCard'),
  }
}

async function runCase(entry: { sample: string; marketplaceId: string; index: number; caseId: string }, user: { id: string; token: string }): Promise<CaseRecord> {
  const dir = join(ROOT, 'bench', 'samples', entry.sample)
  const manifest = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'))
  const photos = readdirSync(dir).filter((name) => MIME[extname(name).toLowerCase()]).sort()
  const folder = join(outDir, folderOf(entry.index, entry.caseId))
  mkdirSync(folder, { recursive: true })
  const record: CaseRecord = { caseId: entry.caseId, sample: entry.sample, marketplaceId: entry.marketplaceId, categoryId: manifest.categoryId, folder: basename(folder) }

  const photoPaths: string[] = []
  for (const name of photos) {
    const path = `${user.id}/author-${entry.caseId}-${name}`
    const res = await fetch(`${URL_BASE}/storage/v1/object/uploads/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: asService({ 'Content-Type': MIME[extname(name).toLowerCase()], 'x-upsert': 'true' }),
      body: readFileSync(join(dir, name)),
    })
    if (!res.ok) throw new Error(`Фото ${name} не загрузилось: HTTP ${res.status}`)
    photoPaths.push(path)
  }

  // Свойства — шаг B1 продукта: сочинение пишет их в гнёзда, без них модели нечего ставить.
  const propsRes = await userFetch(user.token, 'product-properties', { description: manifest.productDescription ?? '', wishes: manifest.wishes ?? '' })
  const properties = propsRes.ok ? (((await propsRes.json()) as { properties?: unknown }).properties ?? []) : []
  record.properties = properties

  const started = Date.now()
  const generate = await userFetch(user.token, 'generate', {
    kind: 'card',
    marketplaceId: entry.marketplaceId,
    categoryId: manifest.categoryId,
    presetId: manifest.presetId ?? null,
    productTitle: manifest.productTitle,
    productDescription: manifest.productDescription ?? '',
    wishes: manifest.wishes ?? '',
    productProperties: properties,
    photoPaths,
  })
  const accepted = (await generate.json().catch(() => ({}))) as { generationId?: string }
  if (typeof accepted.generationId !== 'string') {
    record.status = 'rejected'
    record.error = `заявка не принята: HTTP ${generate.status}`
    return record
  }
  record.generationId = accepted.generationId

  // Ждём конца генерации: следующая карточка не стартует, пока эта держит резерв шлюза.
  let row: Record<string, unknown> | undefined
  while (Date.now() - started < STOP.settleMs) {
    ;[row] = (await rest(`generations?id=eq.${accepted.generationId}&select=status,failure_reason,title`)) as Record<string, unknown>[]
    if (row && row.status !== 'queued' && row.status !== 'running') break
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  record.wallMs = Date.now() - started
  record.status = row?.status ?? 'timeout'
  record.failureReason = row?.failure_reason ?? null
  record.title = row?.title ?? null

  const costs = (await rest(`generation_costs?generation_id=eq.${accepted.generationId}&select=operation,vendor,cost_rub,duration_ms,created_at&order=id`)) as Cost[]
  record.costs = costs
  Object.assign(record, summarise(costs))
  if (record.status !== 'done') return record

  const [card] = (await rest(`generation_cards?generation_id=eq.${accepted.generationId}&select=layout_id,origin,layout`)) as {
    layout_id: string
    origin: string
    layout: unknown
  }[]
  const [asset] = (await rest(`generation_assets?generation_id=eq.${accepted.generationId}&select=storage_path,width,height&order=id&limit=1`)) as {
    storage_path: string
    width: number
    height: number
  }[]
  if (!card || !asset) {
    record.status = 'no-snapshot'
    return record
  }

  record.layoutId = card.layout_id
  record.origin = card.origin
  record.canvas = { width: asset.width, height: asset.height }
  // Причина отката живёт только в журнале функции (API логов — 410 с 2026-10-04): здесь — по затратам.
  if (card.origin === 'library') record.fallback = Number(record.authorCalls) === 0 ? 'сочинение не звали' : 'откат после вызова'
  writeFileSync(join(folder, 'card.png'), await download('results', asset.storage_path))
  writeFileSync(join(folder, 'layout.json'), JSON.stringify(card.layout, null, 2))
  return record
}

/** Сухой прогон: без сети — что пойдёт в прогон, есть ли наборы и картинки библиотеки для страницы. */
function dryRun(planned: { sample: string; caseId: string; index: number }[]): void {
  for (const entry of planned) {
    const dir = join(ROOT, 'bench', 'samples', entry.sample)
    const manifest = existsSync(join(dir, 'sample.json')) ? JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8')) : null
    const photos = existsSync(dir) ? readdirSync(dir).filter((name) => MIME[extname(name).toLowerCase()]).length : 0
    const library = existsSync(join(libraryDir, folderOf(entry.index, entry.caseId), 'library.png'))
    console.log(
      `${folderOf(entry.index, entry.caseId)} · ${manifest ? `${manifest.categoryId} · «${manifest.productTitle}»` : 'НЕТ sample.json'} · фото ${photos} · library.png ${library ? 'есть' : 'нет'}`,
    )
  }
  console.log(`\nсухой прогон: ${planned.length} карточек, сеть не тронута; стоп при балансе шлюза < ${STOP.gatewayRub} ₽`)
}

async function main(): Promise<void> {
  const planned = CASES.map((entry, index) => ({ ...entry, index, caseId: caseId(entry) }))
    .filter((entry) => (options.only ? options.only.has(entry.caseId) : true))
    .filter((entry) => !state.records.some((record) => record.caseId === entry.caseId && record.status === 'done'))

  if (options.dryRun) return dryRun(planned)

  if (!options.reportOnly) {
    await connect()
    const user = await ensureUser()

    const points = await pointsOf(user.id)
    if (points < 55 * planned.length) {
      const res = await userFetch(user.token, 'topup', { packageId: 'pro', idempotencyKey: crypto.randomUUID() })
      if (!res.ok) throw new Error(`Баллов ${points} < ${55 * planned.length}, пополнение не прошло: HTTP ${res.status}`)
      console.log(`баллов было ${points}, пополнено пакетом pro`)
    }

    let failuresInRow = 0
    for (const entry of planned) {
      const gateway = await gatewayBalance()
      if (gateway < STOP.gatewayRub) {
        console.log(`СТОП: баланс шлюза ${gateway.toFixed(2)} ₽ < ${STOP.gatewayRub} ₽ — доклад владельцу`)
        break
      }

      console.log(`— ${entry.caseId} (шлюз ${gateway.toFixed(2)} ₽)`)
      const record = await runCase(entry, user)
      record.gatewayBeforeRub = gateway
      state.records = state.records.filter((old) => old.caseId !== entry.caseId).concat(record)
      save()

      console.log(
        `  ${record.status} · origin ${record.origin ?? '—'}${record.fallback ? ` (${record.fallback})` : ''} · макет ${record.layoutId ?? '—'} · ` +
          `authorCard ${Number(record.authorRub ?? 0).toFixed(2)} ₽ / ${Math.round(Number(record.authorMs ?? 0) / 1000)} с · ` +
          `кадр ${Number(record.imageRub ?? 0).toFixed(2)} ₽ · заявка ${Math.round(Number(record.wallMs ?? 0) / 1000)} с` +
          (record.failureReason ? ` · ${record.failureReason}` : ''),
      )

      // Стейдж на заглушке (`AI_PROVIDER=stub`): все затраты нулевые — прогон ничего не измерит.
      if ((record.costs as Cost[] | undefined)?.some((cost) => cost.vendor === 'stub')) {
        console.log('СТОП: в строках generation_costs vendor = stub — стейдж на заглушке, а не на живом вендоре')
        break
      }

      failuresInRow = record.status === 'done' ? 0 : failuresInRow + 1
      if (failuresInRow >= STOP.failuresInRow) {
        console.log(`СТОП: ${STOP.failuresInRow} провала подряд`)
        break
      }
    }
  }

  writeReport()
}

/* --------------------------------------------------------------------------- отчёт */

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
const rub = (value: unknown) => Number(value ?? 0).toFixed(2)
const sec = (ms: unknown) => (Number(ms ?? 0) / 1000).toFixed(0)

function writeReport(): void {
  mkdirSync(outDir, { recursive: true })
  const order = new Map(CASES.map((entry, index) => [caseId(entry), index]))
  const records = [...state.records].sort((a, b) => (order.get(a.caseId) ?? 99) - (order.get(b.caseId) ?? 99))
  const done = records.filter((record) => record.status === 'done')
  const authored = done.filter((record) => record.origin === 'author')
  const called = done.filter((record) => Number(record.authorCalls) > 0)
  const authorRub = records.reduce((total, record) => total + Number(record.authorRub ?? 0), 0)

  const stats = {
    cards: records.length,
    done: done.length,
    authored: authored.length,
    /** Доля `origin = 'author'` среди готовых карточек. */
    authorShare: done.length === 0 ? null : authored.length / done.length,
    /** `p` откатов: доля `library` среди готовых карточек, где `authorCard` звали. */
    fallbackShare: called.length === 0 ? null : called.filter((record) => record.origin !== 'author').length / called.length,
    authorRub,
    authorRubPerCall: called.length === 0 ? null : called.reduce((total, record) => total + Number(record.authorRub ?? 0), 0) / called.length,
    authorSecPerCall: called.length === 0 ? null : called.reduce((total, record) => total + Number(record.authorMs ?? 0), 0) / called.length / 1000,
  }
  const pct = (share: number | null) => (share === null ? '—' : `${(share * 100).toFixed(0)}%`)

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ stats, records }, null, 2))
  writeFileSync(
    join(outDir, 'report.md'),
    [
      `# Пробный прогон сочинения — ${options.date}`,
      '',
      `Карточек: ${stats.cards} · готово: ${stats.done} · origin = author: ${stats.authored} (${pct(stats.authorShare)}) · p откатов: ${pct(stats.fallbackShare)}`,
      `authorCard: всего ${rub(authorRub)} ₽ · в среднем ${stats.authorRubPerCall === null ? '—' : rub(stats.authorRubPerCall)} ₽ и ${stats.authorSecPerCall === null ? '—' : stats.authorSecPerCall.toFixed(0)} с на вызов`,
      '',
      '| карточка | origin | ₽ | с | вердикт |',
      '| --- | --- | --- | --- | --- |',
      ...records.map((record) => `| ${record.caseId} | ${record.origin ?? record.status} | ${rub(record.authorRub)} | ${sec(record.authorMs)} |  |`),
    ].join('\n'),
  )

  const sections = records
    .map((record) => {
      const libraryPng = join(libraryDir, String(record.folder), 'library.png')
      const library = existsSync(libraryPng)
        ? `<figure><figcaption>Библиотека (прогон ${esc(options.libraryRun)}, другой кадр)</figcaption><img src="${esc(libraryPng.replace(/\\/g, '/'))}"></figure>`
        : '<figure><figcaption>Библиотека</figcaption><div class="none">нет картинки</div></figure>'
      const result =
        record.status === 'done'
          ? `<figure><figcaption>${record.origin === 'author' ? 'Сочинение' : `Откат на библиотеку (${esc(record.fallback ?? '')})`}</figcaption><img src="${esc(record.folder)}/card.png"></figure>`
          : `<p class="fail">карточки нет: ${esc(record.status)} ${esc(record.failureReason ?? record.error ?? '')}</p>`
      return `<section class="card" data-id="${esc(record.caseId)}">
<h2>${esc(record.caseId)} <small>${esc(record.categoryId)} · origin ${esc(record.origin ?? '—')} · макет ${esc(record.layoutId ?? '—')}</small></h2>
<p class="meta">authorCard ${rub(record.authorRub)} ₽ · ${sec(record.authorMs)} с · заявка ${sec(record.wallMs)} с · шлюз перед карточкой ${rub(record.gatewayBeforeRub)} ₽</p>
<div class="pair">${library}${result}</div>
<div class="verdict">
<label><input type="radio" name="v-${esc(record.caseId)}" value="сочинение лучше"> сочинение лучше</label>
<label><input type="radio" name="v-${esc(record.caseId)}" value="одинаково"> одинаково</label>
<label><input type="radio" name="v-${esc(record.caseId)}" value="библиотека лучше"> библиотека лучше</label>
<input type="text" name="n-${esc(record.caseId)}" placeholder="что не так" size="48">
</div></section>`
    })
    .join('\n')

  writeFileSync(
    join(outDir, 'report.html'),
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Сочинение — прогон ${esc(options.date)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#18181b}
table{border-collapse:collapse;margin:12px 0 24px;font-size:13px} td,th{border:1px solid #e4e4e7;padding:4px 8px;text-align:left}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:16px 20px;margin-bottom:16px}
.pair{display:flex;gap:16px;flex-wrap:wrap} figure{margin:0;flex:1 1 320px;max-width:560px} figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-bottom:6px}
img{max-width:100%;border:1px solid #e4e4e7;border-radius:6px} small{color:#71717a;font-weight:400} .meta{color:#52525b;margin:0 0 10px} .fail{color:#b91c1c} .none{height:200px;background:#eee}
.verdict{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center} textarea{width:100%;min-height:120px;font:13px ui-monospace,monospace}
</style>
<h1>Библиотека · сочинение — прогон ${esc(options.date)}</h1>
<p>Стейдж, ${stats.cards} карточек · origin = author: ${stats.authored} из ${stats.done} (${pct(stats.authorShare)}) · p откатов ${pct(stats.fallbackShare)} · authorCard ${stats.authorRubPerCall === null ? '—' : rub(stats.authorRubPerCall)} ₽ на вызов · всего ${rub(authorRub)} ₽</p>
<table><tr><th>карточка</th><th>origin</th><th>₽</th><th>с</th></tr>
${records.map((record) => `<tr><td>${esc(record.caseId)}</td><td>${esc(record.origin ?? record.status)}</td><td>${rub(record.authorRub)}</td><td>${sec(record.authorMs)}</td></tr>`).join('')}</table>
${sections}
<h2>Вердикты</h2><button id="collect">Собрать</button><textarea id="out"></textarea>
<script>
const KEY='author-probe:${esc(options.date)}';let state={};try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
for(const el of document.querySelectorAll('.verdict input')){const s=state[el.name];if(s!==undefined){if(el.type==='radio')el.checked=el.value===s;else el.value=s}
el.addEventListener('input',()=>{state[el.name]=el.value;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}})}
document.getElementById('collect').addEventListener('click',()=>{document.getElementById('out').value=JSON.stringify([...document.querySelectorAll('section.card')].map(s=>({id:s.dataset.id,verdict:s.querySelector('input[type=radio]:checked')?.value??null,note:s.querySelector('input[type=text]').value})),null,2)})
</script></html>`,
  )
  console.log(`\nОтчёт: bench/runs/author-${options.date}/report.html · report.md · summary.json`)
}

await main()
