/**
 * Процедура заполнения баз иконок и шрифтов — административная часть шага A5 плана
 * `card-assembly-pipeline_2026-08-31.md`.
 *
 * **Источник правды — таблицы** (`card_icons`, `card_font_families`, `card_fonts`,
 * `card_font_roles`): там дедуп по имени и по содержимому держится ограничениями базы, а не
 * внимательностью человека. Папки `icons/` и `fonts/` рядом с этим файлом — рабочая копия
 * базы: из неё берёт файлы офлайн-сборщик, чтобы гейт A3 гонялся без поднятой базы.
 *
 * **Запись идёт в два приёма** (форма из витрины V-12): разбор образца заводит заявку —
 * имя, описание, происхождение; человек кладёт файл в папку и вкладывает его содержимое
 * командой `push`. До этого момента слой иконки снимается правилом K-3, а текст модуля
 * остаётся на месте.
 *
 * Команды:
 *   npm run cards:assets              — что в базах есть, чего не хватает, что разошлось
 *   npm run cards:assets push         — вложить содержимое из папок в базу
 *   npm run cards:assets pull         — выложить содержимое базы в папки
 *   npm run cards:assets request <имя> <описание> [из-образца]  — завести заявку на иконку
 *
 * Новая гарнитура заводится **миграцией**, а не отсюда: семья, роль и лицензия — решения,
 * они проходят ревью в диффе, а не появляются вызовом скрипта.
 *
 * Ключи берутся из `supabase status`; в репозитории их нет и быть не должно.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const ICONS = `${here}icons/`
const FONTS = `${here}fonts/`

type IconRow = {
  name: string
  description: string
  requested_by: string
  content: string | null
  content_hash: string | null
  status: string
}

type FontRow = {
  id: string
  family: string
  weight: number
  italic: boolean
  content: string | null
  content_hash: string | null
  status: string
}

type FamilyRow = {
  family: string
  license: string
  license_url: string
  license_text: string | null
}

type RoleRow = { role: string; family: string }

/* ------------------------------------------------------------------------ доступ к базе */

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
  if (env.API_URL === undefined) {
    throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  }
  return env
}

const env = localEnv()
const REST = `${env.API_URL}/rest/v1`
const SECRET = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

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
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`)
  }
  return text === '' ? null : JSON.parse(text)
}

/* ------------------------------------------------------------------- байты и имена файлов */

/** bytea уходит и приходит через PostgREST шестнадцатеричной строкой Postgres. */
const toBytea = (bytes: Buffer): string => `\\x${bytes.toString('hex')}`
const fromBytea = (value: string): Buffer => Buffer.from(value.slice(2), 'hex')
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** Имя файла = имя записи: рабочая копия называется так же, как база, и сверять их нечем. */
const slug = (family: string): string => family.toLowerCase().replace(/\s+/g, '-')

async function readIfExists(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------------------ чтение */

async function loadBase(): Promise<{
  icons: IconRow[]
  fonts: FontRow[]
  families: FamilyRow[]
  roles: RoleRow[]
}> {
  const [icons, fonts, families, roles] = (await Promise.all([
    rest('card_icons?select=name,description,requested_by,content,content_hash,status&order=name'),
    rest('card_fonts?select=id,family,weight,italic,content,content_hash,status&order=id'),
    rest('card_font_families?select=family,license,license_url,license_text&order=family'),
    rest('card_font_roles?select=role,family&order=role'),
  ])) as [IconRow[], FontRow[], FamilyRow[], RoleRow[]]

  return { icons, fonts, families, roles }
}

/* -------------------------------------------------------------------------------- list */

async function list(): Promise<void> {
  const { icons, fonts, families, roles } = await loadBase()
  const iconFiles = (await readdir(ICONS)).filter((name) => name.endsWith('.svg'))

  console.log(`\nИконки — записей ${icons.length}, из них заявок ${count(icons)}`)
  for (const row of icons) {
    const file = await readIfExists(`${ICONS}${row.name}.svg`)
    console.log(
      `  ${row.status === 'готово' ? '●' : '○'} ${row.name.padEnd(16)} ${row.status.padEnd(7)}` +
        ` ${diff(row.content_hash, file)}  ${row.description}`,
    )
  }
  for (const file of iconFiles) {
    const name = file.replace(/\.svg$/, '')
    if (!icons.some((row) => row.name === name)) {
      console.log(`  ! ${name.padEnd(16)} файл есть, записи нет — заведи заявку: request`)
    }
  }

  console.log(`\nШрифты — начертаний ${fonts.length}, из них заявок ${count(fonts)}`)
  for (const row of fonts) {
    const file = await readIfExists(`${FONTS}${row.id}.ttf`)
    console.log(
      `  ${row.status === 'готово' ? '●' : '○'} ${row.id.padEnd(20)} ${row.status.padEnd(7)}` +
        ` ${diff(row.content_hash, file)}  ${row.family} ${row.weight}${row.italic ? ' italic' : ''}`,
    )
  }

  console.log('\nГарнитуры и лицензии')
  for (const family of families) {
    const served = roles
      .filter((role) => role.family === family.family)
      .map((role) => role.role)
      .join(', ')
    const text = family.license_text === null ? 'ТЕКСТА ЛИЦЕНЗИИ НЕТ' : 'текст лицензии на месте'
    console.log(`  ${family.family} — ${family.license}, ${text}`)
    console.log(`      роли: ${served === '' ? 'ни одной' : served}`)
  }

  const uncovered = ['display', 'heading', 'body', 'label', 'accent'].filter(
    (role) => !roles.some((row) => row.role === role),
  )
  if (uncovered.length > 0) {
    console.log(`\n  ! роли без гарнитуры: ${uncovered.join(', ')}`)
  }
  console.log('')
}

const count = (rows: { status: string }[]): number =>
  rows.filter((row) => row.status === 'заявка').length

/** Совпадает ли рабочая копия с базой — единственное, что о ней стоит знать в списке. */
function diff(hash: string | null, file: Buffer | undefined): string {
  if (hash === null && file === undefined) return 'файла нет'
  if (hash === null) return 'файл есть, в базе пусто → push'
  if (file === undefined) return 'в базе есть, файла нет → pull'
  return sha256(file) === hash ? 'копия совпадает' : 'копия разошлась → push или pull'
}

/* -------------------------------------------------------------------------------- push */

async function push(): Promise<void> {
  const { icons, fonts, families } = await loadBase()

  for (const row of icons) {
    const file = await readIfExists(`${ICONS}${row.name}.svg`)
    if (file === undefined) {
      console.log(`○ ${row.name} — заявка без файла, класть нечего`)
      continue
    }
    await fill('card_icons', `name=eq.${row.name}`, row.name, row.content_hash, file)
  }

  const orphans = (await readdir(ICONS))
    .filter((name) => name.endsWith('.svg'))
    .map((name) => name.replace(/\.svg$/, ''))
    .filter((name) => !icons.some((row) => row.name === name))
  for (const name of orphans) {
    console.log(`! ${name} — файл есть, заявки нет. Заведи её: cards:assets request ${name} "…"`)
  }

  for (const row of fonts) {
    const file = await readIfExists(`${FONTS}${row.id}.ttf`)
    if (file === undefined) {
      console.log(`○ ${row.id} — заявка без файла, класть нечего`)
      continue
    }
    await fill('card_fonts', `id=eq.${row.id}`, row.id, row.content_hash, file)
  }

  for (const family of families) {
    const file = await readIfExists(`${FONTS}${slug(family.family)}.license.txt`)
    if (file === undefined) {
      console.log(`! ${family.family} — нет файла лицензии ${slug(family.family)}.license.txt`)
      continue
    }
    const text = file.toString('utf8')
    if (text === family.license_text) {
      console.log(`= ${family.family} — текст лицензии уже в базе`)
      continue
    }
    await rest(`card_font_families?family=eq.${encodeURIComponent(family.family)}`, {
      method: 'PATCH',
      body: JSON.stringify({ license_text: text }),
    })
    console.log(`✓ ${family.family} — текст лицензии вложен`)
  }
}

/**
 * Вложить содержимое в строку базы. Дедуп по содержимому ловит **база**, а не эта проверка:
 * скрипт только переводит её отказ на человеческий язык.
 */
async function fill(
  table: string,
  match: string,
  label: string,
  hash: string | null,
  file: Buffer,
): Promise<void> {
  if (hash === sha256(file)) {
    console.log(`= ${label} — содержимое уже в базе`)
    return
  }
  try {
    await rest(`${table}?${match}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: toBytea(file) }),
    })
    console.log(`✓ ${label} — ${hash === null ? 'заявка закрыта' : 'содержимое обновлено'}`)
  } catch (error) {
    const message = String(error)
    if (message.includes('content_idx')) {
      console.log(`! ${label} — ровно такое содержимое уже лежит в базе под другим именем`)
      return
    }
    throw error
  }
}

/* -------------------------------------------------------------------------------- pull */

async function pull(): Promise<void> {
  const { icons, fonts, families, roles } = await loadBase()

  for (const row of icons) {
    if (row.content === null) continue
    await writeFile(`${ICONS}${row.name}.svg`, fromBytea(row.content))
    console.log(`✓ icons/${row.name}.svg`)
  }

  for (const row of fonts) {
    if (row.content === null) continue
    await writeFile(`${FONTS}${row.id}.ttf`, fromBytea(row.content))
    console.log(`✓ fonts/${row.id}.ttf`)
  }

  for (const family of families) {
    if (family.license_text === null) continue
    await writeFile(`${FONTS}${slug(family.family)}.license.txt`, family.license_text)
    console.log(`✓ fonts/${slug(family.family)}.license.txt`)
  }

  // Отображение роли в гарнитуру тоже часть базы, а не догадка сборщика: офлайн-сборщик
  // читает его отсюда и потому рисует тем же, чем нарисует Edge Function.
  const map = Object.fromEntries(roles.map((row) => [row.role, row.family]))
  await writeFile(`${FONTS}roles.json`, `${JSON.stringify(map, null, 2)}\n`)
  console.log('✓ fonts/roles.json')
}

/* ----------------------------------------------------------------------------- request */

async function request(args: string[]): Promise<void> {
  const [name, description, from] = args
  if (name === undefined || description === undefined) {
    throw new Error('Нужны имя и описание: cards:assets request thermometer "Температурный режим"')
  }
  await rest('card_icons', {
    method: 'POST',
    body: JSON.stringify({ name, description, requested_by: from ?? 'manual' }),
  })
  console.log(`✓ заявка на иконку «${name}» заведена. Положи ${name}.svg в icons/ и запусти push`)
}

/**
 * Заводит заявки на все иконки, которые лежат в `icons/`, но записи в базе ещё не имеют.
 *
 * Описания берутся из `icons/DESCRIPTIONS.json` — иначе двадцать с лишним описаний пришлось бы
 * набирать в командной строке по одному, и они разошлись бы с рисунками при первой же правке.
 * Уже заведённые имена пропускаются: команда безопасна для повторного запуска.
 */
async function requestAll(): Promise<void> {
  const descriptions = JSON.parse(await readFile(`${ICONS}DESCRIPTIONS.json`, 'utf8')) as Record<
    string,
    string
  >
  const known = new Set(
    (await rest('card_icons?select=name')).map((row: { name: string }) => row.name),
  )

  const files = (await readdir(ICONS))
    .filter((name) => name.endsWith('.svg'))
    .map((name) => name.slice(0, -4))
    .filter((name) => !known.has(name))

  if (files.length === 0) {
    console.log('Заводить нечего: у каждого файла в icons/ уже есть запись')
    return
  }

  for (const name of files) {
    const description = descriptions[name]
    if (description === undefined) {
      console.log(`  ! ${name} — нет описания в DESCRIPTIONS.json, пропущен`)
      continue
    }
    await rest('card_icons', {
      method: 'POST',
      body: JSON.stringify({ name, description, requested_by: 'library-a6' }),
    })
    console.log(`✓ заявка «${name}»`)
  }

  console.log('\nдальше: cards:assets push — содержимое поедет в базу')
}

/* -------------------------------------------------------------------------------- ввод */

const [command, ...args] = process.argv.slice(2)

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
  case 'request':
    await request(args)
    break
  case 'request-all':
    await requestAll()
    break
  default:
    throw new Error(`Не знаю команды «${command}». Есть list, push, pull, request, request-all.`)
}
