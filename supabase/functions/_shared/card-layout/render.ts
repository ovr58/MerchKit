/**
 * Растеризация SVG-композиции в Edge Function (M7 B0.1).
 *
 * Композиция остаётся общей в `svg.ts`; этот модуль знает только Edge Runtime и приватные
 * ресурсы `resvg`. После холодного старта функция рендера не делает сетевых запросов.
 */

import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'

import { downloadFile } from '../edge.ts'
import { composeSvg } from './svg.ts'
import { validateLayout } from './validate.ts'
import { createRendererAssets } from './renderer-assets.ts'
import type { FontFamilies } from './svg.ts'
import type { CardContent, CardLayout } from './types.ts'

const loadAssets = createRendererAssets(downloadFile)
let wasmReady: Promise<void> | undefined

export type RenderResult = { bytes: Uint8Array; dropped: string[] }

export async function renderCard(
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
  fonts: FontFamilies,
): Promise<RenderResult> {
  const problems = validateLayout(layout)
  if (problems.length > 0) {
    throw new Error(`Макет «${layout.id}» не проходит валидатор:\n  ${problems.join('\n  ')}`)
  }

  const assets = await ensureWasm()
  const { svg, dropped } = composeSvg(layout, content, size, fonts)
  const bytes = new Resvg(svg, { font: { fontBuffers: assets.fonts, loadSystemFonts: false } })
    .render()
    .asPng()

  return { bytes, dropped: dropped.map((drop) => `${drop.id}: ${drop.reason}`) }
}

async function ensureWasm(): Promise<Awaited<ReturnType<typeof loadAssets>>> {
  const assets = await loadAssets()
  if (wasmReady === undefined) wasmReady = initWasm(assets.wasm)
  await wasmReady
  return assets
}
