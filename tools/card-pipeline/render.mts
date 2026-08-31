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

export async function png(path: string): Promise<ImageRef> {
  const bytes = await readFile(path)
  return {
    dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
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
