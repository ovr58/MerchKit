/**
 * Кладёт ресурсы Edge-растеризатора в приватный Storage (M7 B0.1).
 *
 * Исходники не дублируются в миграции: wasm берётся из установленной зависимости, а шрифты —
 * из рабочей копии базы. Запускать после `supabase db reset` и `cards:assets push`.
 */

import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const FONTS = `${here}fonts/`
const BUCKET = 'card-render-assets'

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
  if (env.API_URL === undefined) throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  return env
}

const env = localEnv()
const secret = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

async function upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const response = await fetch(`${env.API_URL}/storage/v1/object/${BUCKET}/${path}`, {
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
