/**
 * Пробный прогон арт-директора на стейдже — шаг B5.10 плана `card-assembly-pipeline_2026-08-31.md`.
 *
 * **Отдельная оснастка, а не режим `bench/run.mjs`:** тот ходит в локальный Supabase и не знает
 * ни про ступени арт-директора, ни про `generation_costs`. Здесь — боевой путь стейджа (заявка
 * `generate` → воркер → `generation_cards`), а потом по каждой карточке две сборки одного кадра:
 * с правкой (`direction`) и без неё (`direction = null`, макет библиотеки). Продуктовый код не
 * трогается: всё, что нужно, берётся из снимка `generation_cards` и общего кода `card-layout`.
 *
 * Ключи стейджа — `supabase projects api-keys --reveal` (токен `SUPABASE_ACCESS_TOKEN` из
 * окружения процесса), только в памяти процесса: ни в вывод, ни в файл. Коробку выреза скрипт
 * не зовёт — её зовёт воркер стейджа.
 *
 * Запуск (платно, потолок и стоп-условия — в `STOP` ниже):
 *   node --env-file=.env --experimental-strip-types bench/director-probe.mts --date 2026-10-04
 *   … --only beauty-cream.ozon,home-chair.ozon   # отдельные карточки
 *   … --report-only                              # пересобрать страницу из записанного
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { initWasm, Resvg } from '@resvg/resvg-wasm'

import { applyDirection, directedContent } from '../supabase/functions/_shared/card-layout/direction.ts'
import type { CardDirection } from '../supabase/functions/_shared/card-layout/direction.ts'
import { fromStored } from '../supabase/functions/_shared/card-layout/filling.ts'
import type { StoredContent } from '../supabase/functions/_shared/card-layout/filling.ts'
import { composeSvg } from '../supabase/functions/_shared/card-layout/svg.ts'
import type { FontFamilies } from '../supabase/functions/_shared/card-layout/svg.ts'
import { validateLayout } from '../supabase/functions/_shared/card-layout/validate.ts'
import type { CardContent, CardLayout, ImageRef } from '../supabase/functions/_shared/card-layout/types.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REF = 'uqybgbudlnlbyarkgcwk'
const URL_BASE = `https://${REF}.supabase.co`

/**
 * Стоп-условия владельца (промпт M7-7f). Платная часть арт-директора — только `directCard`.
 * Порог 9,3 ₽, а не 10: потолок одной карточки — две полные попытки ≈ 0,7 ₽ (ADR-0018, п. 5),
 * и следующая карточка не должна перешагнуть 10.
 */
const STOP = { directorRub: 9.3, failuresInRow: 3, settleMs: 300_000 }

/** Десять карточек: семь наборов выборки на Ozon + три из них на других площадках (другой кадр профиля). */
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
  const parsed = { date: new Date().toISOString().slice(0, 10), only: null as Set<string> | null, reportOnly: false }
  for (let at = 0; at < argv.length; at++) {
    const key = argv[at].replace(/^--/, '')
    if (key === 'report-only') parsed.reportOnly = true
    else if (key === 'date') parsed.date = argv[++at]
    else if (key === 'only') parsed.only = new Set(argv[++at].split(',').map((id) => id.trim()))
    else throw new Error(`Неизвестный аргумент: ${argv[at]}`)
  }
  return parsed
}

const options = parseArgs(process.argv.slice(2))
const outDir = join(ROOT, 'bench', 'runs', `director-${options.date}`)
mkdirSync(outDir, { recursive: true })
const statePath = join(outDir, 'state.json')

type CaseRecord = Record<string, unknown> & { caseId: string }
type State = { user?: { id: string; email: string; password: string }; records: CaseRecord[] }
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { records: [] }
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2))

/* ------------------------------------------------------------------------- стейдж */

function cli(args: string[]): string {
  return execFileSync('npx', ['supabase', ...args], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] })
}

let SERVICE = ''
let ANON = ''

async function connect(): Promise<void> {
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Нет SUPABASE_ACCESS_TOKEN: запускайте через `node --env-file=.env`')
  const names = (JSON.parse(cli(['secrets', 'list', '--project-ref', REF, '-o', 'json'])) as { name: string }[]).map((s) => s.name)
  if (!names.includes('CARD_DIRECTOR')) throw new Error('В стейдже нет секрета CARD_DIRECTOR — стоп, доклад владельцу (промпт M7-7f)')
  const keys = JSON.parse(cli(['projects', 'api-keys', '--project-ref', REF, '--reveal', '-o', 'json'])) as { name: string; api_key: string }[]
  SERVICE = keys.find((key) => key.name === 'service_role')?.api_key ?? ''
  ANON = keys.find((key) => key.name === 'anon')?.api_key ?? ''
  if (!SERVICE || !ANON) throw new Error('api-keys не вернул service_role/anon')
  console.log(`стейдж ${REF}: CARD_DIRECTOR в списке секретов есть, ключи получены`)
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
    const email = `director-probe.${Date.now()}@example.com`
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

async function balanceOf(userId: string): Promise<number> {
  const [row] = (await rest(`profiles?id=eq.${userId}&select=balance`)) as { balance: number }[]
  return row?.balance ?? 0
}

/* -------------------------------------------------------------------------- сборка */

let wasmReady = false
const fontDir = join(ROOT, 'tools', 'card-pipeline', 'fonts')

async function renderPng(layout: CardLayout, content: CardContent, size: { width: number; height: number }, fonts: FontFamilies) {
  const problems = validateLayout(layout)
  if (problems.length > 0) throw new Error(`макет «${layout.id}» не проходит валидатор: ${problems.join('; ')}`)
  if (!wasmReady) {
    await initWasm(readFileSync(join(ROOT, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')))
    wasmReady = true
  }
  const fontBuffers = readdirSync(fontDir).filter((name) => name.endsWith('.ttf')).map((name) => readFileSync(join(fontDir, name)))
  const { svg } = composeSvg(layout, content, size, fonts)
  return new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false } }).render().asPng()
}

/** Иконки по именам — тем же приёмом, что `card-layout/icons.ts`: исходник в `bytea`, hex от PostgREST. */
async function loadIcons(names: string[]): Promise<Record<string, ImageRef>> {
  if (names.length === 0) return {}
  const rows = (await rest(
    `card_icons?select=name,content&name=in.(${names.map(encodeURIComponent).join(',')})&status=eq.${encodeURIComponent('готово')}`,
  )) as { name: string; content: string }[]
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      { dataUri: `data:image/svg+xml;base64,${Buffer.from(row.content.slice(2), 'hex').toString('base64')}`, width: 24, height: 24 },
    ]),
  )
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 12)

/* -------------------------------------------------------------------------- прогон */

type Cost = { operation: string; cost_rub: string; duration_ms: number; created_at: string }

function summarise(costs: Cost[]) {
  const sum = (operation: string) => costs.filter((cost) => cost.operation === operation).reduce((total, cost) => total + Number(cost.cost_rub), 0)
  const calls = costs.filter((cost) => cost.operation === 'directCard')
  return {
    directorCalls: calls.length,
    directorRub: sum('directCard'),
    directorCallRub: calls.map((cost) => Number(cost.cost_rub)),
    directorCallMs: calls.map((cost) => cost.duration_ms),
    directorAt: calls.map((cost) => cost.created_at),
    imageRub: sum('generateImages'),
    otherRub: sum('moderate') + sum('composeCard') + sum('nameGeneration'),
  }
}

/**
 * Постановка первой попытки по тому, что осталось в базе. Журнал функции (`Арт-директор: ступень N · постановка …`)
 * через API недоступен (`logs.all` — 410, новый `logs` не знает `function_logs`, 2026-10-04), поэтому: боксы в патче
 * бывают только у полной постановки; иначе — по цене вызова (полная ≈ 0,32 ₽, лёгкая ≈ 0,08 ₽, ADR-0018 п. 5).
 */
function modeGuess(calls: number, firstCallRub: number | undefined, direction: CardDirection | null): string {
  if (calls === 0) return '— (не звали)'
  if ((direction?.boxes.length ?? 0) > 0) return 'full'
  if (firstCallRub === 0) return '? (вызов стоил 0 ₽ — заглушка)'
  return (firstCallRub ?? 0) >= 0.2 ? 'full' : 'content'
}

async function runCase(caseId: string, sample: string, marketplaceId: string, index: number, user: { id: string; token: string }): Promise<CaseRecord> {
  const dir = join(ROOT, 'bench', 'samples', sample)
  const manifest = JSON.parse(readFileSync(join(dir, 'sample.json'), 'utf8'))
  const photos = readdirSync(dir).filter((name) => MIME[extname(name).toLowerCase()]).sort()
  const folder = join(outDir, `${String(index + 1).padStart(2, '0')}-${caseId}`)
  mkdirSync(folder, { recursive: true })
  const record: CaseRecord = { caseId, sample, marketplaceId, categoryId: manifest.categoryId, folder: basename(folder) }

  const photoPaths: string[] = []
  for (const name of photos) {
    const path = `${user.id}/probe-${caseId}-${name}`
    const res = await fetch(`${URL_BASE}/storage/v1/object/uploads/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: asService({ 'Content-Type': MIME[extname(name).toLowerCase()], 'x-upsert': 'true' }),
      body: readFileSync(join(dir, name)),
    })
    if (!res.ok) throw new Error(`Фото ${name} не загрузилось: HTTP ${res.status}`)
    photoPaths.push(path)
  }

  // Свойства — шаг B1 продукта: бесплатен по баллам, текстовая модель (~0,05 ₽); без них гнёзда и иконки нечем наполнять.
  const propsRes = await userFetch(user.token, 'product-properties', { description: manifest.productDescription ?? '', wishes: manifest.wishes ?? '' })
  const properties = propsRes.ok ? (((await propsRes.json()) as { properties?: unknown }).properties ?? []) : []
  record.properties = properties

  const started = Date.now()
  const generate = await userFetch(user.token, 'generate', {
    kind: 'card',
    marketplaceId,
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

  let row: Record<string, unknown> | undefined
  while (Date.now() - started < STOP.settleMs) {
    ;[row] = (await rest(`generations?id=eq.${accepted.generationId}&select=*`)) as Record<string, unknown>[]
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

  const [card] = (await rest(`generation_cards?generation_id=eq.${accepted.generationId}&select=layout_id,layout,content,font_map,direction`)) as {
    layout_id: string
    layout: CardLayout
    content: StoredContent
    font_map: FontFamilies
    direction: CardDirection | null
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
  record.layoutTitle = (card.layout as CardLayout & { title?: string }).title ?? null
  record.direction = card.direction
  record.canvas = { width: asset.width, height: asset.height }
  record.mode = modeGuess(Number(record.directorCalls), (record.directorCallRub as number[])[0], card.direction)
  record.stage = card.direction === null ? 4 : '1–3'
  record.patch = {
    boxes: card.direction?.boxes.length ?? 0,
    texts: Object.keys(card.direction?.texts ?? {}).length,
    icons: card.direction?.icons.length ?? 0,
  }

  const product = await download('results', asset.storage_path)
  writeFileSync(join(folder, 'directed.png'), product)

  const restored = await fromStored(card.content, download)
  const size = { width: asset.width, height: asset.height }
  const library = await renderPng(card.layout, restored, size, card.font_map)
  writeFileSync(join(folder, 'library.png'), library)

  if (card.direction !== null) {
    const iconNames = [...new Set(card.direction.icons.flatMap(({ icon }) => (icon === null ? [] : [icon])))]
    const rebuilt = await renderPng(
      applyDirection(card.layout, card.direction),
      directedContent(restored, card.direction, await loadIcons(iconNames)),
      size,
      card.font_map,
    )
    writeFileSync(join(folder, 'directed-rebuilt.png'), rebuilt)
    record.rebuiltSameAsProduct = sha(rebuilt) === sha(product)
  }
  record.libraryEqualsDirected = sha(library) === sha(product)
  writeFileSync(join(folder, 'direction.json'), JSON.stringify(card.direction, null, 2))
  return record
}

async function main(): Promise<void> {
  if (!options.reportOnly) {
    await connect()
    const user = await ensureUser()
    const planned = CASES.map((entry, index) => ({ ...entry, index, caseId: `${entry.sample}.${entry.marketplaceId}` }))
      .filter((entry) => (options.only ? options.only.has(entry.caseId) : true))
      .filter((entry) => !state.records.some((record) => record.caseId === entry.caseId && record.status === 'done'))

    const balance = await balanceOf(user.id)
    if (balance < 55 * planned.length) {
      const res = await userFetch(user.token, 'topup', { packageId: 'pro', idempotencyKey: crypto.randomUUID() })
      if (!res.ok) throw new Error(`Баланс ${balance} < ${55 * planned.length}, пополнение не прошло: HTTP ${res.status}`)
      console.log(`баланс был ${balance}, пополнен пакетом pro`)
    }

    let failuresInRow = 0
    for (const entry of planned) {
      const spent = state.records.reduce((total, record) => total + Number(record.directorRub ?? 0), 0)
      if (spent >= STOP.directorRub) {
        console.log(`СТОП: арт-директор потратил ${spent.toFixed(2)} ₽ (порог ${STOP.directorRub} ₽)`)
        break
      }

      console.log(`— ${entry.caseId}`)
      const record = await runCase(entry.caseId, entry.sample, entry.marketplaceId, entry.index, user)
      state.records = state.records.filter((old) => old.caseId !== entry.caseId).concat(record)
      save()

      console.log(
        `  ${record.status} · ${record.layoutId ?? '—'} · постановка ${record.mode ?? '—'} · ступень ${record.stage ?? '—'} · ` +
          `вызовов ${record.directorCalls ?? '—'} · директор ${Number(record.directorRub ?? 0).toFixed(4)} ₽ · кадр ${Number(record.imageRub ?? 0).toFixed(2)} ₽ · ${Math.round(Number(record.wallMs) / 1000)} с` +
          (record.failureReason ? ` · ${record.failureReason}` : ''),
      )

      // Стейдж на заглушке (`AI_PROVIDER=stub`): все затраты нулевые, `directCard` пуст — прогон ничего не измерит.
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

function writeReport(): void {
  const order = new Map(CASES.map((entry, index) => [`${entry.sample}.${entry.marketplaceId}`, index]))
  const records = [...state.records].sort((a, b) => (order.get(a.caseId) ?? 99) - (order.get(b.caseId) ?? 99))
  const done = records.filter((record) => record.status === 'done')
  const directorRub = records.reduce((total, record) => total + Number(record.directorRub ?? 0), 0)
  const imageRub = records.reduce((total, record) => total + Number(record.imageRub ?? 0), 0)
  const full = done.filter((record) => record.mode === 'full').length
  const withCall = done.filter((record) => Number(record.directorCalls) > 0).length
  const retried = done.filter((record) => Number(record.directorCalls) > 1).length

  const rows = records.map((record) => {
    const patch = record.patch as { boxes: number; texts: number; icons: number } | undefined
    return `| ${record.caseId} | ${record.layoutId ?? '—'} | ${record.mode ?? '—'} | ${record.stage ?? '—'} | ${record.directorCalls ?? '—'} | ${Number(record.directorRub ?? 0).toFixed(4)} | ${patch ? `${patch.boxes}/${patch.texts}/${patch.icons}` : '—'} | ${record.status} |`
  })

  const stats = {
    cards: records.length,
    done: done.length,
    full,
    p: done.length === 0 ? null : full / done.length,
    retried,
    retryShare: withCall === 0 ? null : retried / withCall,
    directorRub,
    directorPerCard: done.length === 0 ? null : directorRub / done.length,
    imageRub,
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ stats, records }, null, 2))
  writeFileSync(
    join(outDir, 'report.md'),
    [
      `# Пробный прогон арт-директора — ${options.date}`,
      '',
      `Карточек: ${stats.cards} · готово: ${stats.done} · полная постановка: ${full} (p = ${stats.p === null ? '—' : (stats.p * 100).toFixed(0) + '%'})` +
        ` · с повтором: ${retried} из ${withCall} (${stats.retryShare === null ? '—' : (stats.retryShare * 100).toFixed(0) + '%'})`,
      `Арт-директор: ${directorRub.toFixed(4)} ₽ (${stats.directorPerCard === null ? '—' : stats.directorPerCard.toFixed(4)} ₽ на карточку) · кадры: ${imageRub.toFixed(2)} ₽`,
      '',
      '| карточка | макет | постановка | ступень | вызовов | ₽ директор | боксы/гнёзда/иконки | статус |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows,
    ].join('\n'),
  )

  const sections = records
    .map((record) => {
      const patch = record.patch as { boxes: number; texts: number; icons: number } | undefined
      const images =
        record.status === 'done'
          ? `<div class="pair"><figure><figcaption>Библиотека (direction = null)</figcaption><img src="${esc(record.folder)}/library.png"></figure>` +
            `<figure><figcaption>С правкой арт-директора</figcaption><img src="${esc(record.folder)}/directed.png"></figure></div>`
          : `<p class="fail">карточки нет: ${esc(record.status)} ${esc(record.failureReason ?? record.error ?? '')}</p>`
      return `<section class="card" data-id="${esc(record.caseId)}">
<h2>${esc(record.caseId)} <small>${esc(record.categoryId)} · макет ${esc(record.layoutId ?? '—')}</small></h2>
<p class="meta">постановка ${esc(record.mode ?? '—')} · ступень ${esc(record.stage ?? '—')} · вызовов ${esc(record.directorCalls ?? '—')} · ${Number(record.directorRub ?? 0).toFixed(4)} ₽ · боксы/гнёзда/иконки ${patch ? `${patch.boxes}/${patch.texts}/${patch.icons}` : '—'}</p>
${images}
<div class="verdict">
<label><input type="radio" name="v-${esc(record.caseId)}" value="с правкой лучше"> с правкой лучше</label>
<label><input type="radio" name="v-${esc(record.caseId)}" value="одинаково"> одинаково</label>
<label><input type="radio" name="v-${esc(record.caseId)}" value="библиотека лучше"> библиотека лучше</label>
<input type="text" name="n-${esc(record.caseId)}" placeholder="что не так" size="48">
</div></section>`
    })
    .join('\n')

  writeFileSync(
    join(outDir, 'report.html'),
    `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Арт-директор — прогон ${esc(options.date)}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#18181b}
table{border-collapse:collapse;margin:12px 0 24px;font-size:13px} td,th{border:1px solid #e4e4e7;padding:4px 8px;text-align:left}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:16px 20px;margin-bottom:16px}
.pair{display:flex;gap:16px;flex-wrap:wrap} figure{margin:0;flex:1 1 320px;max-width:560px} figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#71717a;margin-bottom:6px}
img{max-width:100%;border:1px solid #e4e4e7;border-radius:6px} small{color:#71717a;font-weight:400} .meta{color:#52525b;margin:0 0 10px} .fail{color:#b91c1c}
.verdict{margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;align-items:center} textarea{width:100%;min-height:120px;font:13px ui-monospace,monospace}
</style>
<h1>Пробный прогон арт-директора — ${esc(options.date)}</h1>
<p>Стейдж, ${stats.cards} карточек · полная постановка p = ${stats.p === null ? '—' : (stats.p * 100).toFixed(0) + '%'} (оценка ADR — 30–60%) · арт-директор ${stats.directorPerCard === null ? '—' : stats.directorPerCard.toFixed(2)} ₽ на карточку (оценка ADR — 0,19–0,29 ₽) · всего ${directorRub.toFixed(2)} ₽</p>
<table><tr><th>карточка</th><th>макет</th><th>постановка</th><th>ступень</th><th>вызовов</th><th>₽ директор</th></tr>
${records.map((record) => `<tr><td>${esc(record.caseId)}</td><td>${esc(record.layoutId ?? '—')}</td><td>${esc(record.mode ?? '—')}</td><td>${esc(record.stage ?? '—')}</td><td>${esc(record.directorCalls ?? '—')}</td><td>${Number(record.directorRub ?? 0).toFixed(4)}</td></tr>`).join('')}</table>
${sections}
<h2>Вердикты</h2><button id="collect">Собрать</button><textarea id="out"></textarea>
<script>
const KEY='director-probe:${esc(options.date)}';let state={};try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
for(const el of document.querySelectorAll('.verdict input')){const s=state[el.name];if(s!==undefined){if(el.type==='radio')el.checked=el.value===s;else el.value=s}
el.addEventListener('input',()=>{state[el.name]=el.value;try{localStorage.setItem(KEY,JSON.stringify(state))}catch{}})}
document.getElementById('collect').addEventListener('click',()=>{document.getElementById('out').value=JSON.stringify([...document.querySelectorAll('section.card')].map(s=>({id:s.dataset.id,verdict:s.querySelector('input[type=radio]:checked')?.value??null,note:s.querySelector('input[type=text]').value})),null,2)})
</script></html>`,
  )
  console.log(`\nОтчёт: bench/runs/director-${options.date}/report.html · report.md · summary.json`)
}

await main()
