/**
 * Растеризация SVG-композиции в Edge Function (M7 B0.1).
 *
 * Композиция остаётся общей в `svg.ts`; этот модуль знает только Edge Runtime и приватные
 * ресурсы `resvg`. После холодного старта функция рендера не делает сетевых запросов.
 */

import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2'

import { downloadFile } from '../edge.ts'
import { composeSvg, overflowsOf, textProbes } from './svg.ts'
import { validateLayout } from './validate.ts'
import { createRendererAssets } from './renderer-assets.ts'
import type { FontFamilies, Overflow } from './svg.ts'
import type { CardContent, CardLayout } from './types.ts'

const loadAssets = createRendererAssets(downloadFile)
let wasmReady: Promise<void> | undefined

export type RenderResult = { bytes: Uint8Array; dropped: string[] }

export type PreviewRenderResult = RenderResult & { overflows: Overflow[] }

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
  const bytes = withResvg(svg, assets.fonts, (resvg) => {
    const image = resvg.render()
    try {
      return image.asPng()
    } finally {
      image.free()
    }
  })

  return { bytes, dropped: dropped.map((drop) => `${drop.id}: ${drop.reason}`) }
}

/**
 * Шрифты растеризатора для оснастки замера (`card-bench`, шаг B4.0).
 *
 * Своего загрузчика ей заводить нельзя, и дело не в лишних мегабайтах: `initWasm` у
 * `@resvg/resvg-wasm` глобален для модуля, а специфик импорта у обоих один — второй вызов
 * пришёлся бы на уже поднятый экземпляр.
 */
export async function rendererFonts(): Promise<Uint8Array[]> {
  return (await ensureWasm()).fonts
}

async function ensureWasm(): Promise<Awaited<ReturnType<typeof loadAssets>>> {
  const assets = await loadAssets()
  if (wasmReady === undefined) wasmReady = initWasm(assets.wasm)
  await wasmReady
  return assets
}

/**
 * Превью до оплаты (шаг B6): тот же кадр плюс арифметика переполнения.
 *
 * Обмеряет строки тот же `resvg`, который их рисует, — по одному разбору на строку. Средняя
 * ширина знака была бы дешевле, но врёт на каждой второй гарнитуре, а цена ошибки здесь —
 * строка, вылезшая за плашку на оплаченном кадре. Замер 2026-09-03 в локальном рантайме
 * функций: обмер строки — 1–3 мс после прогрева, весь макет — десятки миллисекунд.
 */
export async function renderPreview(
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
  fonts: FontFamilies,
): Promise<PreviewRenderResult> {
  const rendered = await renderCard(layout, content, size, fonts)
  const assets = await ensureWasm()

  const overflows = overflowsOf(textProbes(layout, content, size, fonts), (probe) =>
    withResvg(probe, assets.fonts, (resvg) => resvg.getBBox()?.width ?? 0),
  )

  return { ...rendered, overflows }
}

/**
 * Разбор SVG и его шрифты живут в памяти WASM, а не в куче изолята, и держатся там, пока
 * объект не освобождён.
 *
 * Сама по себе утечка это не даёт: обёртки `resvg` зарегистрированы в `FinalizationRegistry`,
 * и сборщик мусора их однажды приберёт. Беда в том, что линейная память WASM для него
 * невидима — по куче в 8–10 МБ он не видит причин собираться, пока снаружи висят десятки
 * мегабайт. Изолят живёт между запросами (ради этого ресурсы и кэшируются), а превью
 * создаёт объект НА КАЖДУЮ строку текста, а не один на сборку, — то есть повод собраться
 * появляется на порядок реже, чем повод занять память.
 *
 * Поэтому освобождаем сами, не полагаясь на момент сборки мусора.
 */
function withResvg<T>(svg: string, fonts: Uint8Array[], use: (resvg: Resvg) => T): T {
  const resvg = new Resvg(svg, { font: { fontBuffers: fonts, loadSystemFonts: false } })
  try {
    return use(resvg)
  } finally {
    resvg.free()
  }
}
