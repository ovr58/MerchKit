/**
 * Кладёт ресурсы Edge-растеризатора в приватный Storage (M7 B0.1).
 *
 * Исходники не дублируются в миграции: wasm берётся из установленной зависимости, а шрифты —
 * из рабочей копии базы. Запускать после `supabase db reset` и `cards:assets push`.
 */

import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { connect } from './target.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const FONTS = `${here}fonts/`
const BUCKET = 'card-render-assets'

const { url, secret } = connect()

async function upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const response = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes,
  })
  if (!response.ok) throw new Error(`${path} не загружен: HTTP ${response.status}: ${await response.text()}`)
}

async function main(): Promise<void> {
  const fontNames = (await readdir(FONTS)).filter((name) => name.endsWith('.ttf')).sort()
  const files = await Promise.all(fontNames.map(async (name) => ({ name, bytes: await readFile(`${FONTS}${name}`) })))

  await Promise.all([
    upload(
      'resvg/index_bg.wasm',
      await readFile(new URL('../../node_modules/@resvg/resvg-wasm/index_bg.wasm', import.meta.url)),
      'application/wasm',
    ),
    upload('fonts/manifest.json', new TextEncoder().encode(JSON.stringify({ fonts: files.map(({ name }) => `fonts/${name}`) })), 'application/json'),
    ...files.map(({ name, bytes }) => upload(`fonts/${name}`, bytes, 'font/ttf')),
  ])

  console.log(`✓ ${BUCKET}: resvg.wasm и ${files.length} шрифтов загружены`)
}

await main()
