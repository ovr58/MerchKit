/**
 * Шаг M7 B2.0: офлайн-предложения тегов для библиотеки макетов.
 *
 * Batch API предлагает категорию, площадку, сценарий и признак скрытых кистей по 34 образцам.
 * Он не пишет в `card_layouts`: предложения сначала подтверждаются пользователем в V-12, а
 * расхождения затем правятся одной строкой в базе, без повторного прогона модели.
 *
 *   npm run cards:layout-tags -- submit [layout-id…]
 *   npm run cards:layout-tags -- status
 *   npm run cards:layout-tags -- fetch
 */

import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import Anthropic from '@anthropic-ai/sdk'

import { validateTagProposal } from './layout-tags-lib.ts'
import type { TagProposal, TagReferences } from './layout-tags-lib.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SAMPLES = fileURLToPath(new URL('samples/', import.meta.url))
const STATE = fileURLToPath(new URL('.layout-tags.batch.json', import.meta.url))
const PROPOSALS = fileURLToPath(new URL('layout-tag-proposals.json', import.meta.url))

type Sample = { id: string; source: string }
type State = { batch: string; samples: Sample[]; references: TagReferences }
type BatchProposal = TagProposal & { rationale: unknown }

function client(): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID
  return new Anthropic(workspace === undefined ? {} : { defaultHeaders: { 'anthropic-workspace-id': workspace } })
}

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

async function references(): Promise<TagReferences> {
  const env = localEnv()
  const secret = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY
  const rest = async (path: string): Promise<unknown> => {
    const response = await fetch(`${env.API_URL}/rest/v1/${path}`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    })
    if (!response.ok) throw new Error(`GET ${path} → ${response.status}: ${await response.text()}`)
    return response.json()
  }

  const [categories, marketplaces, presets] = (await Promise.all([
    rest('categories?select=id,title&order=sort_order'),
    rest('marketplaces?select=id,title&order=sort_order'),
    rest('presets?select=id,category_id,title&order=category_id,sort_order'),
  ])) as [TagReferences['categories'], TagReferences['marketplaces'], TagReferences['presets']]
  return { categories, marketplaces, presets }
}

async function samples(): Promise<Sample[]> {
  const files = (await readdir(SAMPLES)).filter((name) => name.endsWith('.json')).sort()
  const result: Sample[] = []
  for (const file of files) {
    const parsed = JSON.parse(await readFile(`${SAMPLES}${file}`, 'utf8')) as {
      source?: unknown
      layout?: { id?: unknown }
    }
    if (typeof parsed.layout?.id !== 'string' || typeof parsed.source !== 'string') {
      throw new Error(`samples/${file} не содержит layout.id и source строками`)
    }
    result.push({ id: parsed.layout.id, source: parsed.source })
  }
  if (new Set(result.map((sample) => sample.id)).size !== result.length) {
    throw new Error('В samples/ два разбора с одинаковым layout.id')
  }
  return result
}

function imageMediaType(source: string): 'image/jpeg' | 'image/png' {
  if (/\.jpe?g$/i.test(source)) return 'image/jpeg'
  if (/\.png$/i.test(source)) return 'image/png'
  throw new Error(`Образец «${source}» не JPEG и не PNG`)
}

function instructions(reference: TagReferences): string {
  return [
    'Ты предлагаешь теги подбора для уже разобранного макета карточки товара.',
    'По изображению выбери категорию товара, площадку, сценарий показа и признак скрытых кистей.',
    'Кисти скрыты = кисти рук не видны, закрыты или явно не в фокусе; это снижает риск анатомического брака.',
    'Не придумывай идентификаторы: разрешены только значения из справочников ниже.',
    'Если площадку исходного образца нельзя установить надёжно, верни null. Если для категории нет сценария',
    'или изображение не даёт надёжного сценария, верни null. Ровно одно поле rationale кратко объясняет выбор.',
    'Ответ — только JSON без markdown: {"categoryId": string, "marketplaceId": string|null,',
    '"presetId": string|null, "handsHidden": boolean, "rationale": string}.',
    '',
    `<справочник>${JSON.stringify(reference)}</справочник>`,
  ].join('\n')
}

async function submit(only: string[]): Promise<void> {
  const all = await samples()
  const selected = only.length === 0 ? all : all.filter((sample) => only.includes(sample.id))
  const missing = only.filter((id) => !all.some((sample) => sample.id === id))
  if (selected.length === 0) throw new Error('Нет образцов для тегирования')
  if (missing.length > 0) throw new Error(`В samples/ нет макетов: ${missing.join(', ')}`)

  const lookup = await references()
  const system = instructions(lookup)
  const requests = await Promise.all(selected.map(async (sample) => ({
    custom_id: sample.id,
    params: {
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: { effort: 'high' as const },
      system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
      messages: [{
        role: 'user' as const,
        content: [{
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: imageMediaType(sample.source),
            data: (await readFile(`${ROOT}${sample.source}`)).toString('base64'),
          },
        }],
      }],
    },
  })))

  const batch = await client().messages.batches.create({ requests })
  await writeFile(STATE, `${JSON.stringify({ batch: batch.id, samples: selected, references: lookup }, null, 2)}\n`, 'utf8')
  console.log(`батч ${batch.id} отправлен: ${selected.length} макетов, статус ${batch.processing_status}`)
  console.log('дальше: npm run cards:layout-tags -- status')
}

async function state(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE, 'utf8')) as State
  } catch {
    throw new Error('Нет отправленного батча — сначала `npm run cards:layout-tags -- submit`')
  }
}

async function status(): Promise<void> {
  const found = await client().messages.batches.retrieve((await state()).batch)
  const counts = found.request_counts
  console.log(`батч ${found.id}: ${found.processing_status}`)
  console.log(`  в работе ${counts.processing} · готово ${counts.succeeded} · с ошибкой ${counts.errored}`)
  if (found.processing_status === 'ended') console.log('дальше: npm run cards:layout-tags -- fetch')
}

async function fetchResults(): Promise<void> {
  const current = await state()
  const found = await client().messages.batches.retrieve(current.batch)
  if (found.processing_status !== 'ended') throw new Error(`Батч ещё в статусе ${found.processing_status} — забирать рано`)

  const known = new Set(current.samples.map((sample) => sample.id))
  const proposals: Record<string, BatchProposal> = {}
  const failed: string[] = []
  for await (const result of await client().messages.batches.results(current.batch)) {
    if (!known.has(result.custom_id)) {
      failed.push(`${result.custom_id}: нет такого макета в состоянии батча`)
      continue
    }
    if (result.result.type !== 'succeeded') {
      failed.push(`${result.custom_id}: батч вернул ${result.result.type}`)
      continue
    }
    const text = result.result.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    let proposal: BatchProposal
    try {
      proposal = JSON.parse(text.trim()) as BatchProposal
    } catch {
      failed.push(`${result.custom_id}: ответ не разбирается как JSON`)
      continue
    }
    const problems = validateTagProposal(proposal, current.references)
    if (typeof proposal.rationale !== 'string' || proposal.rationale === '') problems.push('rationale должен быть непустой строкой')
    if (problems.length > 0) {
      failed.push(`${result.custom_id}: ${problems.join('; ')}`)
      continue
    }
    proposals[result.custom_id] = proposal
  }

  await writeFile(PROPOSALS, `${JSON.stringify(proposals, null, 2)}\n`, 'utf8')
  console.log(`сохранено предложений ${Object.keys(proposals).length} из ${current.samples.length}: ${PROPOSALS}`)
  for (const problem of failed) console.log(`  ✗ ${problem}`)
  console.log('дальше: подтвердить предложения в V-12; расхождения править строками card_layouts, не новым батчем')
}

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'submit':
    await submit(args)
    break
  case 'status':
    await status()
    break
  case 'fetch':
    await fetchResults()
    break
  default:
    console.log('команды: submit [layout-id…] · status · fetch')
    process.exitCode = 1
}
