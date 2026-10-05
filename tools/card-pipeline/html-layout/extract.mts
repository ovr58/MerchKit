/**
 * Снятие сцены HTML в Chromium (шаг B2 плана `html-layout-authoring_2026-10-05.md`).
 *
 * Открывает страницу сочинения карточки в Chromium с нашими шрифтами, обходит потомков
 * `#card` и записывает для каждого элемента-слоя бокс в px, вычисленные стили и строки текста
 * (`HtmlScene`, `card-layout/html/scene.ts`). Что снимается и что отклоняется —
 * `SUBSET.md` рядом. В слои сцену переводит `toLayout` (B3), не этот файл.
 *
 * Код внутри страницы (снятие чужих шрифтов, ожидание своих, обход DOM `sceneInPage`) живёт в
 * `supabase/functions/_shared/card-layout/html/extract-browser.ts`: тот же текст исполняет
 * коробка выреза (`POST /layout`, шаг C2). Здесь — только запуск Chromium и шрифты из файлов.
 *
 * Запуск из корня MK:
 *   node --experimental-strip-types tools/card-pipeline/html-layout/extract.mts <html> <W>x<H>
 */

import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

import { addStyle, dropForeignFontFaces, FONT_FACES, missingFonts, sceneInPage } from '../../../supabase/functions/_shared/card-layout/html/extract-browser.ts'
import type { HtmlScene } from './scene.ts'

const fontDir = fileURLToPath(new URL('../fonts/', import.meta.url))

const fontCss = FONT_FACES.map(
  ([file, family, weight]) =>
    `@font-face{font-family:'${family}';font-weight:${weight};src:url('${pathToFileURL(join(fontDir, file)).href}') format('truetype')}`,
).join('\n')

export async function extractScene(
  htmlPath: string,
  canvas: { width: number; height: number },
): Promise<HtmlScene> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: canvas, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(htmlPath).href)
    await page.evaluate(dropForeignFontFaces)
    await page.evaluate(addStyle, fontCss)
    const missing = await page.evaluate(missingFonts, FONT_FACES)
    if (missing.length > 0) throw new Error(`шрифты не загрузились: ${missing.join(', ')}`)

    return await page.evaluate(sceneInPage, canvas)
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [htmlPath, size] = process.argv.slice(2)
  const match = /^(\d+)x(\d+)$/.exec(size ?? '')
  if (!htmlPath || !match) {
    console.error('Использование: extract.mts <html> <W>x<H>')
    process.exit(2)
  }
  const scene = await extractScene(htmlPath, { width: Number(match[1]), height: Number(match[2]) })
  console.log(JSON.stringify(scene, null, 2))
}
