/**
 * Рабочая копия библиотеки макетов — административная часть M7 B0.
 *
 * Источник правды — `card_layouts`; JSON-разборы в samples/ нужны офлайн-разбору и гейту A3.
 * Команды синхронизируют только поля, которыми владеет рабочая копия: сам макет, заголовок,
 * источник, универсальный макет и признак «тяжёлый» (B7.7: после `db reset` миграция знает
 * только макеты, которые в ней записаны, остальные получают признак отсюда). Теги B2.0 не
 * затираются при `push`.
 *
 *   npm run cards:layouts       — сверить базу и рабочую копию
 *   npm run cards:layouts push  — залить разборы в базу
 *   npm run cards:layouts pull  — забрать макеты базы в существующие разборы
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { connect } from './target.ts'
import { validateLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'
import type { CardLayout } from '../../supabase/functions/_shared/card-layout/types.ts'

const SAMPLES = fileURLToPath(new URL('samples/', import.meta.url))

type Sample = {
  file: string
  source: string
  layout: CardLayout
  content: unknown
  notes: unknown
  isFallback?: boolean
  edgeHeavy?: boolean
}

type LayoutRow = {
  id: string
  title: string
  layout: CardLayout
  source: string
  is_fallback: boolean
  edge_heavy: boolean
}

const { url, secret: SECRET, args } = connect()
const REST = `${url}/rest/v1`

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${REST}/${path}`, {
    ...init,
    headers: {
      apikey: SECRET,
      Authorization: `Bearer ${SECRET}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`)
  return text === '' ? null : JSON.parse(text)
}

async function samples(): Promise<Map<string, Sample>> {
  const files = (await readdir(SAMPLES)).filter((name) => name.endsWith('.json')).sort()
  const result = new Map<string, Sample>()

  for (const file of files) {
    const sample = {
      ...(JSON.parse(await readFile(`${SAMPLES}${file}`, 'utf8')) as Omit<Sample, 'file'>),
      file,
    }
    const problems = validateLayout(sample.layout)
    if (problems.length > 0) {
      throw new Error(`макет «${sample.layout.id}» не проходит валидатор:\n  ${problems.join('\n  ')}`)
    }
    if (result.has(sample.layout.id)) throw new Error(`два разбора с id «${sample.layout.id}»`)
    result.set(sample.layout.id, sample)
  }

  return result
}

async function base(): Promise<LayoutRow[]> {
  return (await rest(
    'card_layouts?select=id,title,layout,source,is_fallback,edge_heavy&order=id',
  )) as LayoutRow[]
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sameWorkingCopyFields(sample: Sample, row: LayoutRow): boolean {
  return (
    sample.layout.title === row.title &&
    canonicalJson(sample.layout) === canonicalJson(row.layout) &&
    sample.source === row.source &&
    (sample.isFallback === true) === row.is_fallback &&
    (sample.edgeHeavy === true) === row.edge_heavy
  )
}

async function list(): Promise<void> {
  const [local, remote] = await Promise.all([samples(), base()])
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  let matches = 0

  for (const [id, sample] of local) {
    const row = remoteById.get(id)
    if (row === undefined) {
      console.log(`! ${id} — есть в samples/, нет в базе → push`)
    } else if (!sameWorkingCopyFields(sample, row)) {
      console.log(`! ${id} — рабочая копия отличается от базы → push или pull`)
    } else {
      matches += 1
    }
  }

  for (const row of remote) {
    if (!local.has(row.id)) console.log(`! ${row.id} — есть в базе, нет рабочей копии → pull`)
  }

  console.log(`Макеты: в базе ${remote.length}, в samples/ ${local.size}, совпадают ${matches}`)
}

async function push(): Promise<void> {
  const [local, remote] = await Promise.all([samples(), base()])
  const remoteById = new Map(remote.map((row) => [row.id, row]))

  for (const [id, sample] of local) {
    const body = {
      id,
      title: sample.layout.title,
      layout: sample.layout,
      source: sample.source,
      is_fallback: sample.isFallback === true,
      edge_heavy: sample.edgeHeavy === true,
    }
    if (remoteById.has(id)) {
      await rest(`card_layouts?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      console.log(`✓ ${id} — обновлён`)
    } else {
      await rest('card_layouts', { method: 'POST', body: JSON.stringify(body) })
      console.log(`✓ ${id} — добавлен`)
    }
  }
}

async function pull(): Promise<void> {
  const [local, remote] = await Promise.all([samples(), base()])

  for (const row of remote) {
    const sample = local.get(row.id)
    if (sample === undefined) {
      throw new Error(`макет «${row.id}» есть только в базе: сначала заведи его разбор в samples/`)
    }
    if (sameWorkingCopyFields(sample, row)) {
      console.log(`= samples/${sample.file} — уже совпадает`)
      continue
    }
    const updated = {
      ...sample,
      source: row.source,
      layout: row.layout,
      isFallback: row.is_fallback || undefined,
      edgeHeavy: row.edge_heavy || undefined,
    }
    delete updated.file
    await writeFile(`${SAMPLES}${sample.file}`, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    console.log(`✓ samples/${sample.file}`)
  }
}

const [command] = args

switch (command ?? 'list') {
  case 'list':
    await list()
    break
  case 'push':
    await push()
    break
  case 'pull':
    await pull()
    break
  default:
    throw new Error(`Не знаю команды «${command}». Есть list, push, pull.`)
}
