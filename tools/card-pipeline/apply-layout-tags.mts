/** Applies user-confirmed B2.0 tag proposals to the local layout library. */

import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { validateTagProposal } from './layout-tags-lib.ts'
import type { TagProposal, TagReferences } from './layout-tags-lib.ts'

const PROPOSALS = fileURLToPath(new URL('layout-tag-proposals.json', import.meta.url))

function localEnv(): Record<string, string> {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_0-9]+)="(.*)"$/)
    if (match !== null) env[match[1]] = match[2]
  }
  if (env.API_URL === undefined) throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  return env
}

const env = localEnv()
const secret = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${env.API_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${text}`)
  return text === '' ? null : JSON.parse(text)
}

async function references(): Promise<TagReferences> {
  const [categories, marketplaces, presets] = (await Promise.all([
    rest('categories?select=id,title&order=sort_order'),
    rest('marketplaces?select=id,title&order=sort_order'),
    rest('presets?select=id,category_id,title&order=category_id,sort_order'),
  ])) as [TagReferences['categories'], TagReferences['marketplaces'], TagReferences['presets']]
  return { categories, marketplaces, presets }
}

const proposals = JSON.parse(await readFile(PROPOSALS, 'utf8')) as Record<string, TagProposal>
const lookup = await references()
const ids = Object.keys(proposals).sort()

if (ids.length !== 34) throw new Error(`Ожидалось 34 подтверждённых предложения, получено ${ids.length}`)

for (const id of ids) {
  const problems = validateTagProposal(proposals[id], lookup)
  if (problems.length > 0) throw new Error(`Предложение «${id}» не пройдёт ссылочную целостность: ${problems.join('; ')}`)
}

for (const id of ids) {
  const proposal = proposals[id]
  const rows = await rest(`card_layouts?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      category_id: proposal.categoryId,
      marketplace_id: proposal.marketplaceId,
      preset_id: proposal.presetId,
      hands_hidden: proposal.handsHidden,
    }),
  }) as Array<{
    category_id: unknown
    marketplace_id: unknown
    preset_id: unknown
    hands_hidden: unknown
  }>
  if (rows.length !== 1) throw new Error(`Макет «${id}»: обновлено ${rows.length} строк вместо одной`)
  const row = rows[0]
  if (
    row.category_id !== proposal.categoryId ||
    row.marketplace_id !== proposal.marketplaceId ||
    row.preset_id !== proposal.presetId ||
    row.hands_hidden !== proposal.handsHidden
  ) {
    throw new Error(`Макет «${id}»: база вернула не те подтверждённые теги`)
  }
}

console.log(`Подтверждённые B2.0 теги записаны: ${ids.length} макета`)
