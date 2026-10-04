/**
 * Каталог референсов сочинения карточки — петля улучшения (ADR-0019, п. 7; шаг C4 плана
 * `html-layout-authoring_2026-10-05.md`).
 *
 * **Источник правды — таблица `card_references` и приватный бакет `references`.** Папки — вход:
 *   - `bench/samples/references/<площадка>/<категория>/…/<файл>` — куда владелец кладёт новые
 *     образцы; площадка и категория — id справочников (`ozon`, `home`), README рядом;
 *   - `bench/samples/wb-starter/<раздел WB>/…/<файл>` — стартовое наполнение: площадка
 *     `wildberries`, категория — по разделу WB (`WB_STARTER_CATEGORIES`).
 * Теги — имена папок, а не распознавание: модель здесь не вызывается.
 *
 * Путь в бакете — `<площадка>/<категория>/<sha256>.<расширение>`: хеш содержимого держит дедуп
 * (тот же файл второй раз не заводится, уникальность пути — в базе), а имя файла без кириллицы
 * проходит ключом Storage.
 *
 * Команды:
 *   npm run cards:references               — что в каталоге
 *   npm run cards:references -- push       — загрузить новые файлы и завести строки
 *   npm run cards:references -- pull       — выложить каталог в bench/samples/references/
 *   … --target staging                     — то же на стейдже (`node --env-file=.env`)
 *
 * Ключи берутся из `supabase status`; в репозитории их нет и быть не должно.
 */

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { connect } from './target.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REFERENCES_DIR = join(ROOT, 'bench', 'samples', 'references')
const WB_STARTER_DIR = join(ROOT, 'bench', 'samples', 'wb-starter')
const BUCKET = 'references'
/** Тот же предел, что `file_size_limit` бакета: отказ здесь — с подсказкой, а не HTTP 413. */
const MAX_BYTES = 2 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/** Разделы стартового набора WB → категории справочника (`public.categories`). */
const WB_STARTER_CATEGORIES: Record<string, string> = {
  'Автотовары': 'other',
  'женщинам': 'clothing',
  'Здоровье': 'other',
  'Красота': 'beauty',
  'Обувь': 'clothing',
  'Спорт': 'other',
  'Электроника': 'tech',
  'Ювелирные изделия': 'accessories',
}

type Row = {
  id: string
  storage_path: string
  marketplace_id: string
  category_id: string
  tags: string[]
  status: string
}

type Candidate = { file: string; marketplaceId: string; categoryId: string; tags: string[] }

/* ------------------------------------------------------------------------ доступ к базе */

const { url, secret: SECRET, args: argv } = connect()

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${url}/${path}`, {
    ...init,
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, ...init.headers },
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`)
  }
  return response
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(`rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await response.text()
  return (text === '' ? null : JSON.parse(text)) as T
}

const loadRows = () =>
  rest<Row[]>('card_references?select=id,storage_path,marketplace_id,category_id,tags,status&order=storage_path')

/* ------------------------------------------------------------------------------ файлы */

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return Promise.resolve(CONTENT_TYPES[extname(entry.name).toLowerCase()] ? [path] : [])
  }))
  return nested.flat()
}

/** Сегменты папок между корнем источника и файлом. */
const folders = (root: string, file: string): string[] => relative(root, dirname(file)).split(sep).filter(Boolean)

async function candidates(): Promise<{ found: Candidate[]; skipped: string[] }> {
  const found: Candidate[] = []
  const skipped: string[] = []

  for (const file of await walk(REFERENCES_DIR)) {
    const [marketplaceId, categoryId, ...tags] = folders(REFERENCES_DIR, file)
    if (marketplaceId === undefined || categoryId === undefined) {
      skipped.push(`${relative(ROOT, file)} — не в папке <площадка>/<категория>/`)
      continue
    }
    found.push({ file, marketplaceId, categoryId, tags })
  }

  for (const file of await walk(WB_STARTER_DIR)) {
    const tags = folders(WB_STARTER_DIR, file)
    const categoryId = WB_STARTER_CATEGORIES[tags[0] ?? '']
    if (categoryId === undefined) {
      skipped.push(`${relative(ROOT, file)} — раздел «${tags[0] ?? ''}» не сопоставлен категории (WB_STARTER_CATEGORIES)`)
      continue
    }
    found.push({ file, marketplaceId: 'wildberries', categoryId, tags })
  }

  return { found, skipped }
}

/* ---------------------------------------------------------------------------- команды */

async function list(): Promise<void> {
  const rows = await loadRows()
  for (const row of rows) {
    console.log(`${row.status === 'active' ? '✓' : '○'} ${row.marketplace_id}/${row.category_id}  ${row.storage_path}  [${row.tags.join(' › ')}]`)
  }
  const active = rows.filter((row) => row.status === 'active').length
  console.log(`\nвсего ${rows.length}, в выборе ${active}`)
}

async function push(): Promise<void> {
  const [rows, marketplaces, categories] = await Promise.all([
    loadRows(),
    rest<{ id: string }[]>('marketplaces?select=id'),
    rest<{ id: string }[]>('categories?select=id'),
  ])
  const known = new Set(rows.map((row) => row.storage_path))
  const marketplaceIds = new Set(marketplaces.map((row) => row.id))
  const categoryIds = new Set(categories.map((row) => row.id))
  const { found, skipped } = await candidates()
  let added = 0

  for (const candidate of found) {
    const name = relative(ROOT, candidate.file)
    if (!marketplaceIds.has(candidate.marketplaceId) || !categoryIds.has(candidate.categoryId)) {
      skipped.push(`${name} — нет площадки «${candidate.marketplaceId}» или категории «${candidate.categoryId}» в справочниках`)
      continue
    }
    if ((await stat(candidate.file)).size > MAX_BYTES) {
      skipped.push(`${name} — больше 2 МБ: ужми (JPEG, длинная сторона ≤ 1600 px) и запусти push снова`)
      continue
    }

    const bytes = await readFile(candidate.file)
    const ext = extname(candidate.file).toLowerCase()
    const hash = createHash('sha256').update(bytes).digest('hex')
    const storagePath = `${candidate.marketplaceId}/${candidate.categoryId}/${hash}${ext === '.jpeg' ? '.jpg' : ext}`
    if (known.has(storagePath)) {
      console.log(`= ${name}`)
      continue
    }

    await request(`storage/v1/object/${BUCKET}/${storagePath}`, {
      method: 'POST',
      headers: { 'Content-Type': CONTENT_TYPES[ext], 'x-upsert': 'true' },
      body: bytes,
    })
    await rest('card_references', {
      method: 'POST',
      body: JSON.stringify({
        storage_path: storagePath,
        marketplace_id: candidate.marketplaceId,
        category_id: candidate.categoryId,
        tags: candidate.tags,
      }),
    })
    known.add(storagePath)
    added++
    console.log(`✓ ${name} → ${storagePath}`)
  }

  for (const line of skipped) console.log(`! ${line}`)
  console.log(`\nзаведено ${added}, пропущено ${skipped.length}, всего в каталоге ${known.size}`)
}

async function pull(): Promise<void> {
  let written = 0
  for (const row of await loadRows()) {
    const target = join(REFERENCES_DIR, ...row.storage_path.split('/'))
    if (await stat(target).then(() => true, () => false)) continue
    const response = await request(`storage/v1/object/${BUCKET}/${row.storage_path}`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, new Uint8Array(await response.arrayBuffer()))
    written++
    console.log(`✓ ${row.storage_path}`)
  }
  console.log(`\nвыложено ${written} в ${relative(ROOT, REFERENCES_DIR)}`)
}

/* -------------------------------------------------------------------------------- ввод */

const [command] = argv

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
