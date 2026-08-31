/**
 * Растеризатор офлайн-конвейера: макет + содержимое → PNG (шаг A2 плана
 * `card-assembly-pipeline_2026-08-31.md`).
 *
 * **Единственное место, зависящее от рантайма.** Композицию считает общий код
 * `supabase/functions/_shared/card-layout/svg.ts` — тот же, что будет считать её в Edge
 * Function и в браузере. Здесь только две вещи, которых у общего кода быть не может: откуда
 * взять файлы шрифтов и чем перевести SVG в пиксели.
 *
 * Растеризатор — `resvg` (WebAssembly), один и тот же байт-в-байт в Node, Deno и браузере.
 * Проверено 2026-08-31: тот же модуль поднялся в локальном рантайме Edge Functions
 * (init 7 мс, кадр 896 px — 83 мс).
 *
 * Запуск: `node --experimental-strip-types tools/card-pipeline/roundtrip.mts`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { initWasm, Resvg } from '@resvg/resvg-wasm'

import { composeSvg } from '../../supabase/functions/_shared/card-layout/svg.ts'
import { validateLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'
import type { FontFamilies } from '../../supabase/functions/_shared/card-layout/svg.ts'
import type {
  CardContent,
  CardLayout,
  ImageRef,
} from '../../supabase/functions/_shared/card-layout/types.ts'

const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * База шрифтов в рабочей копии: всё, что выложил `assets.mts pull` (шаг A5). Списка файлов
 * и отображения ролей в коде нет намеренно — это содержимое базы, и вторая копия разошлась
 * бы с ней на первом же пополнении. Читаем папку целиком, роли берём из `roles.json`.
 */
async function fontBase(): Promise<{ files: Buffer[]; families: FontFamilies }> {
  const names = (await readdir(`${here}fonts`)).filter((name) => name.endsWith('.ttf'))
  const [files, roles] = await Promise.all([
    Promise.all(names.map((name) => readFile(`${here}fonts/${name}`))),
    readFile(`${here}fonts/roles.json`, 'utf8'),
  ])
  return { files, families: JSON.parse(roles) as FontFamilies }
}

let ready = false

async function ensureWasm(): Promise<void> {
  if (ready) return
  await initWasm(await readFile(new URL('../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)))
  ready = true
}

/** Иконка из базы. Отсутствующее имя возвращает `undefined` — и слой снимет правило K-3. */
export async function icon(name: string): Promise<ImageRef | undefined> {
  try {
    const svg = await readFile(`${here}icons/${name}.svg`, 'utf8')
    return { dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: 24, height: 24 }
  } catch {
    return undefined
  }
}

/**
 * Кадр-оригинал образца. PNG и JPEG, потому что набор A6 приехал скриншотами `.jpg`, а
 * образцы гейта A3 — `.png`. Размер берётся из самого файла: у PNG он лежит в IHDR по
 * фиксированному смещению, у JPEG — в маркере SOF, который приходится искать. Раньше здесь
 * читался только IHDR, и JPEG молча давал размер холста из случайных байт.
 */
export async function image(path: string): Promise<ImageRef> {
  const bytes = await readFile(path)
  const jpeg = /\.jpe?g$/i.test(path)

  return {
    dataUri: `data:image/${jpeg ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}`,
    ...(jpeg ? jpegSize(bytes) : { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }),
  }
}

/** Размер JPEG — из первого маркера SOF; сегменты до него пропускаются по длине. */
function jpegSize(bytes: Buffer): { width: number; height: number } {
  // SOF0…SOF15 несут размер; SOF4 (0xC4), SOF8 (0xCC) и рестарт-маркеры — не несут.
  const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }

    const marker = bytes[i + 1]
    if (SOF.has(marker)) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }

    i += 2 + bytes.readUInt16BE(i + 2)
  }

  throw new Error('в JPEG нет маркера SOF — размер кадра взять неоткуда')
}

export type RenderResult = { bytes: Uint8Array; dropped: string[] }

export async function render(
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
): Promise<RenderResult> {
  const problems = validateLayout(layout)
  if (problems.length > 0) {
    throw new Error(`макет «${layout.id}» не проходит валидатор:\n  ${problems.join('\n  ')}`)
  }

  await ensureWasm()
  const { files, families } = await fontBase()
  const { svg, dropped } = composeSvg(layout, content, size, families)

  const bytes = new Resvg(svg, { font: { fontBuffers: files, loadSystemFonts: false } })
    .render()
    .asPng()

  return { bytes, dropped: dropped.map((drop) => `${drop.id}: ${drop.reason}`) }
}
