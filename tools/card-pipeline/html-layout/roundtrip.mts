/**
 * Round-trip сочинения карточки: скриншот Chromium против сборки по слоям (шаг B4 плана
 * `html-layout-authoring_2026-10-05.md`, ADR-0019 п. 6).
 *
 * Для каждой записанной карточки пробы: HTML → скриншот Chromium; HTML → сцена (`extract.mts`)
 * → слои (`toLayout`) → PNG по слоям (`render.mts`, тот же `composeSvg` + resvg, что у
 * сборки) → доля пикселей с разницей. Модель не вызывается: вход — только записанные HTML.
 *
 * **Порог записан в плане, а не подбирается здесь:** ≤ 2 % пикселей с разницей яркости > 32
 * после уменьшения обеих картинок до 256 px по ширине.
 *
 * Выкладка — `<прогон>/roundtrip/`: `<case>.html.png`, `<case>.layers.png`, `<case>.diff.png`
 * и `report.html`, где рядом лежит и голый кадр `frame.png` — смотреть глазами, число
 * разницы не доказательство.
 *
 * Запуск из корня MK:
 *   npm run cards:html-roundtrip -- <каталог прогона пробы>
 * (по умолчанию `bench/runs/html-2026-10-05`).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright'
import type { Browser } from 'playwright'

import { addStyle, dropForeignFontFaces, FONT_FACES, missingFonts } from '../../../supabase/functions/_shared/card-layout/html/extract-browser.ts'
import { toLayout } from '../../../supabase/functions/_shared/card-layout/html/to-layout.ts'
import type { SellerTexts } from '../../../supabase/functions/_shared/card-layout/html/to-layout.ts'
import type { FontFamilies } from '../../../supabase/functions/_shared/card-layout/svg.ts'
import { image, render } from '../render.mts'
import { extractScene, fontCss } from './extract.mts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const fontDir = fileURLToPath(new URL('../fonts/', import.meta.url))

/** Порог из плана (B4): доля пикселей и разница яркости после уменьшения до ширины. */
export const THRESHOLD = { share: 0.02, luma: 32, width: 256 }

type ProbeContent = {
  title: string
  canvas: { width: number; height: number }
  properties: { label: string; value: string }[]
  content: { texts: { title?: string[]; body?: string[] } } | null
}

type Row = { name: string; share: number; problems: string[]; dropped: string[] }

/** Скриншот `#card` с нашими шрифтами — тем же приёмом, что `extractScene` снимает сцену. */
async function screenshot(browser: Browser, htmlPath: string, canvas: { width: number; height: number }): Promise<Buffer> {
  const page = await browser.newPage({ viewport: canvas, deviceScaleFactor: 1 })
  try {
    await page.goto(pathToFileURL(htmlPath).href)
    await page.evaluate(dropForeignFontFaces)
    await page.evaluate(addStyle, fontCss)
    const missing = await page.evaluate(missingFonts, FONT_FACES)
    if (missing.length > 0) throw new Error(`шрифты не загрузились: ${missing.join(', ')}`)
    const card = await page.locator('#card').boundingBox()
    if (card === null) throw new Error(`${htmlPath}: нет #card`)
    return await page.screenshot({ clip: { x: card.x, y: card.y, ...canvas } })
  } finally {
    await page.close()
  }
}

/**
 * Разница двух PNG в Chromium: обе уменьшаются до `width` по ширине, считается доля пикселей
 * с разницей яркости больше `luma`. Картинка разницы — блёклый скриншот, разница — красным.
 */
async function difference(browser: Browser, a: Uint8Array, b: Uint8Array): Promise<{ share: number; png: Buffer }> {
  const page = await browser.newPage()
  try {
    const result = await page.evaluate(
      async ({ a, b, width, luma }) => {
        const load = (src: string) =>
          new Promise<HTMLImageElement>((done, fail) => {
            const img = new Image()
            img.onload = () => done(img)
            img.onerror = fail
            img.src = src
          })
        const [ia, ib] = await Promise.all([load(a), load(b)])
        const height = Math.round((ia.naturalHeight * width) / ia.naturalWidth)
        const pixels = (img: HTMLImageElement) => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d')!
          context.imageSmoothingQuality = 'high'
          context.drawImage(img, 0, 0, width, height)
          return context.getImageData(0, 0, width, height).data
        }
        const pa = pixels(ia)
        const pb = pixels(ib)
        const out = document.createElement('canvas')
        out.width = width
        out.height = height
        const context = out.getContext('2d')!
        const diff = context.createImageData(width, height)
        let differing = 0
        for (let at = 0; at < pa.length; at += 4) {
          const ya = 0.299 * pa[at] + 0.587 * pa[at + 1] + 0.114 * pa[at + 2]
          const yb = 0.299 * pb[at] + 0.587 * pb[at + 1] + 0.114 * pb[at + 2]
          const off = Math.abs(ya - yb) > luma
          if (off) differing++
          const faded = 170 + ya / 3
          diff.data[at] = off ? 230 : faded
          diff.data[at + 1] = off ? 0 : faded
          diff.data[at + 2] = off ? 0 : faded
          diff.data[at + 3] = 255
        }
        context.putImageData(diff, 0, 0)
        return { share: differing / (width * height), png: out.toDataURL('image/png') }
      },
      {
        a: `data:image/png;base64,${Buffer.from(a).toString('base64')}`,
        b: `data:image/png;base64,${Buffer.from(b).toString('base64')}`,
        width: THRESHOLD.width,
        luma: THRESHOLD.luma,
      },
    )
    return { share: result.share, png: Buffer.from(result.png.split(',')[1], 'base64') }
  } finally {
    await page.close()
  }
}

async function main(): Promise<void> {
  const runDir = resolve(process.argv[2] ?? join(ROOT, 'bench', 'runs', 'html-2026-10-05'))
  const outDir = join(runDir, 'roundtrip')
  await mkdir(outDir, { recursive: true })
  const families = JSON.parse(await readFile(join(fontDir, 'roles.json'), 'utf8')) as FontFamilies

  const cases = (await readdir(runDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && existsSync(join(runDir, entry.name, 'claude-sonnet-5-5.html')))
    .map((entry) => entry.name)
    .sort()

  const rows: Row[] = []
  const browser = await chromium.launch()
  try {
    for (const name of cases) {
      const dir = join(runDir, name)
      const htmlPath = join(dir, 'claude-sonnet-5-5.html')
      const probe = JSON.parse(await readFile(join(dir, 'content.json'), 'utf8')) as ProbeContent
      const canvas = probe.canvas
      const texts = probe.content?.texts ?? {}
      const seller: SellerTexts = {
        title: (texts.title ?? []).join(' '),
        body: (texts.body ?? []).join(' '),
        props: probe.properties.map(({ label, value }) => ({ label, value })),
        // Полное название проба давала модели вместе с остальными текстами (`html-probe.mts`).
        extra: [probe.title],
      }

      const html = await screenshot(browser, htmlPath, canvas)
      const scene = await extractScene(htmlPath, canvas)
      const { layout, content, problems } = toLayout(scene, canvas, seller, families)
      const { bytes, dropped } = await render(layout, { ...content, frames: [await image(join(dir, 'frame.png'))] }, canvas)
      const { share, png } = await difference(browser, html, bytes)

      await writeFile(join(outDir, `${name}.html.png`), html)
      await writeFile(join(outDir, `${name}.layers.png`), bytes)
      await writeFile(join(outDir, `${name}.diff.png`), png)
      await writeFile(join(outDir, `${name}.layout.json`), JSON.stringify({ layout, content, problems }, null, 2))
      rows.push({ name, share, problems, dropped })
    }
  } finally {
    await browser.close()
  }

  const verdict = (row: Row) => (row.share <= THRESHOLD.share ? 'ok' : 'выше порога')
  console.log(`карточка · % разницы · вердикт  (порог ≤ ${THRESHOLD.share * 100} %, яркость > ${THRESHOLD.luma}, ширина ${THRESHOLD.width} px)`)
  for (const row of rows) {
    console.log(`${row.name} · ${(row.share * 100).toFixed(2)} % · ${verdict(row)}`)
    for (const problem of row.problems) console.log(`    problems: ${problem}`)
    for (const drop of row.dropped) console.log(`    снят слой: ${drop}`)
  }
  const passed = rows.filter((row) => row.share <= THRESHOLD.share).length
  console.log(`итого: ${passed} из ${rows.length} ≤ порога`)

  await writeFile(join(outDir, 'report.html'), report(rows, verdict))
  console.log(`выкладка: ${outDir}`)
}

function report(rows: Row[], verdict: (row: Row) => string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const cards = rows
    .map(
      (row) => `<section><h2>${row.name} — ${(row.share * 100).toFixed(2)} % · ${verdict(row)}</h2>
${row.problems.length > 0 ? `<p class="bad">problems: ${row.problems.map(escape).join('; ')}</p>` : ''}
<div class="row">
<figure><img src="../${row.name}/frame.png"><figcaption>кадр (голый)</figcaption></figure>
<figure><img src="${row.name}.html.png"><figcaption>Chromium</figcaption></figure>
<figure><img src="${row.name}.layers.png"><figcaption>по слоям</figcaption></figure>
<figure><img src="${row.name}.diff.png"><figcaption>разница (красным — яркость > ${THRESHOLD.luma})</figcaption></figure>
</div></section>`,
    )
    .join('\n')
  return `<!doctype html><meta charset="utf-8"><title>Round-trip HTML → слои</title>
<style>body{font:14px system-ui;margin:16px}.row{display:flex;gap:12px}figure{margin:0;width:24%}img{width:100%;border:1px solid #ccc;image-rendering:auto}figcaption{font-size:12px;color:#555}.bad{color:#b00}</style>
<h1>Round-trip HTML → слои</h1>
<p>Порог: ≤ ${THRESHOLD.share * 100} % пикселей с разницей яркости > ${THRESHOLD.luma} после уменьшения до ${THRESHOLD.width} px по ширине.</p>
${cards}`
}

await main()
