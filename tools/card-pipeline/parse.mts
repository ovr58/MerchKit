/**
 * Шаг A4 плана `card-assembly-pipeline_2026-08-31.md`: разбор образца в макет.
 *
 * **Почему Batch API, а не обычные вызовы.** Разбор офлайновый — ответа никто не ждёт, — а
 * батч стоит вдвое дешевле. Полный проход по набору A6 выходит в $4–6 вместо $8–11, и это
 * решает: дыры в языке макета находятся уже после разбора (на трёх образцах гейта A3 их
 * нашлось две), значит проходов будет несколько.
 *
 * **Почему напрямую через `@anthropic-ai/sdk`, минуя `ai-provider`.** Абстракция ADR-0005
 * держит вендора *продукта* (AITunnel) подальше от продуктового кода. Здесь другой вендор для
 * другой задачи, и в рантайм он не попадает: это инструмент разработчика, как `assets.mts`.
 *
 * **Язык макета не продублирован.** Задание модели собирается из самого `types.ts` и готового
 * разбора-примера: разъехаться с реализацией им нечем.
 *
 * Запуск (ключ берётся из `.env` штатным флагом Node 22):
 *   npm run cards:parse -- submit [слаг…]  — отправить батч (без слагов — весь набор)
 *   npm run cards:parse -- status          — узнать, готов ли
 *   npm run cards:parse -- fetch           — забрать, проверить валидатором, разложить
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import Anthropic from '@anthropic-ai/sdk'

import { validateLayout } from '../../supabase/functions/_shared/card-layout/validate.ts'
import type { CardLayout } from '../../supabase/functions/_shared/card-layout/types.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SAMPLES = fileURLToPath(new URL('samples/', import.meta.url))
const SET = 'bench/samples/wb-starter'
const STATE = fileURLToPath(new URL('.batch.json', import.meta.url))
const LANGUAGE = 'supabase/functions/_shared/card-layout/types.ts'
const EXAMPLE = 'jacket-outventure.json'

/**
 * Клиент API. Ключ берётся из окружения самим SDK; заголовок с рабочим пространством нужен
 * только identity-linked ключам — без него такой ключ отвечает `invalid_request_error`, а
 * обычному ключу заголовок не мешает.
 */
function client(): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID

  return new Anthropic(
    workspace === undefined ? {} : { defaultHeaders: { 'anthropic-workspace-id': workspace } },
  )
}

/** Образец набора: путь от корня репозитория и категория, восстановленная по папкам WB. */
type Sample = { slug: string; source: string; category: string }

/** Что лежит между отправкой батча и его разбором. Батч уже оплачен — терять его нельзя. */
type State = { batch: string; samples: Sample[] }

async function collect(): Promise<Sample[]> {
  const found: Sample[] = []

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(`${ROOT}${dir}`, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!/\.jpe?g$/i.test(entry.name)) continue

      // Метка времени в имени снимка уникальна по набору — она и служит слагом: короткий
      // ASCII-ключ рядом с русскими путями, стабильный между прогонами.
      const stamp = entry.name.match(/(\d{6})\.jpe?g$/i)
      if (stamp === null) throw new Error(`в имени «${entry.name}» нет метки времени`)

      found.push({
        slug: `wb-${stamp[1]}`,
        source: path,
        category: dir.slice(SET.length + 1).replace(/\//g, ' → '),
      })
    }
  }

  await walk(SET)
  return found.sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Задание модели: язык макета как есть плюс готовый разбор — образец формы ответа. */
async function instructions(): Promise<string> {
  const language = await readFile(`${ROOT}${LANGUAGE}`, 'utf8')
  const example = await readFile(`${SAMPLES}${EXAMPLE}`, 'utf8')

  return [
    'Ты разбираешь карточку товара с маркетплейса в макет на нашем языке описания.',
    '',
    'Язык макета — исходный файл целиком. Читай его как спецификацию: комментарии объясняют,',
    'почему поля именно такие, и это часть задания.',
    '',
    '<язык-макета>',
    language,
    '</язык-макета>',
    '',
    'Готовый разбор другого образца — образец формы ответа, а не содержания:',
    '',
    '<пример-разбора>',
    example,
    '</пример-разбора>',
    '',
    'Что вернуть: объект с ключами layout, content, notes — ровно как в примере, но БЕЗ ключа',
    'source (его проставит конвейер).',
    '',
    'Правила, нарушение которых делает разбор непригодным:',
    '- Геометрия только в долях холста [0, 1]. Пикселей в макете нет. Выход за [0, 1] законен',
    '  только там, где элемент намеренно уходит за обрез.',
    '- Словари закрытые. Тип слоя, режим наложения, эффект, роль шрифта, слот текста — только',
    '  значения из перечислений языка. Нет подходящего — не выдумывай, опиши в notes.',
    '- Шрифт опознаётся ролью, а не гарнитурой: по растру гарнитуру не восстановить.',
    '- Иконки называются именем из базы. Нет подходящего имени — дай осмысленное новое, оно',
    '  станет заявкой на пополнение базы.',
    '- z-порядок задаётся порядком слоёв и отражает реальное перекрытие на образце.',
    '- Слова языка, добавленные последними, легко не заметить — пользуйся ими, когда образец',
    '  того требует: `rotate` у слоя (вертикальные и наклонные надписи), прогоны внутри строки',
    '  (одна фраза двумя начертаниями — прогон без `text` это гнездо под привязанное значение),',
    '  индекс у привязки `frame` (второй и следующие снимки карточки), `radius` у слоёв с',
    '  картинкой (скруглённые углы кадра или фотовставки).',
    '- В notes словами перечисли: что в образце есть, а язык этого не выражает; что пришлось',
    '  приблизить; ассеты, которых нет в базе.',
    '',
    'Ответ — только JSON, без markdown-ограды и без пояснений вокруг.',
  ].join('\n')
}

async function submit(only: string[]): Promise<void> {
  const all = await collect()
  const samples = only.length === 0 ? all : all.filter((sample) => only.includes(sample.slug))

  if (samples.length === 0) {
    throw new Error(only.length === 0 ? `в ${SET} нет образцов` : `таких образцов нет: ${only.join(', ')}`)
  }

  const missing = only.filter((slug) => !all.some((sample) => sample.slug === slug))
  if (missing.length > 0) throw new Error(`в наборе нет образцов: ${missing.join(', ')}`)

  const system = await instructions()
  const api = client()

  const requests = await Promise.all(
    samples.map(async (sample) => ({
      custom_id: sample.slug,
      params: {
        model: 'claude-opus-5',
        max_tokens: 32000,
        // Эффорт high, а не max: форма ответа задана схемой, а проверка стоит дёшево и живёт
        // снаружи модели — валидатор и round-trip. Обдумывание сверх этого не окупается.
        output_config: { effort: 'high' as const },
        system: [
          // Задание одинаково для всех запросов — держим его в кэше префикса.
          { type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } },
        ],
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: (await readFile(`${ROOT}${sample.source}`)).toString('base64'),
                },
              },
              {
                type: 'text' as const,
                text: `Категория этого образца на площадке: ${sample.category}. Разбери его.`,
              },
            ],
          },
        ],
      },
    })),
  )

  const batch = await api.messages.batches.create({ requests })
  const state: State = { batch: batch.id, samples }
  await writeFile(STATE, `${JSON.stringify(state, null, 2)}\n`, 'utf8')

  console.log(`батч ${batch.id} отправлен: ${samples.length} образцов, статус ${batch.processing_status}`)
  console.log('дальше: npm run cards:parse -- status')
}

async function state(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE, 'utf8')) as State
  } catch {
    throw new Error('нет отправленного батча — сначала `npm run cards:parse -- submit`')
  }
}

async function status(): Promise<void> {
  const { batch } = await state()
  const found = await client().messages.batches.retrieve(batch)
  const counts = found.request_counts

  console.log(`батч ${batch}: ${found.processing_status}`)
  console.log(`  в работе ${counts.processing} · готово ${counts.succeeded} · с ошибкой ${counts.errored}`)
  if (found.processing_status === 'ended') console.log('дальше: npm run cards:parse -- fetch')
}

/**
 * Проверка содержимого — граница с недоверенным выводом модели.
 *
 * `validateLayout` стережёт макет, но `content` он не смотрит: в продукте содержимое приходит
 * из нашего же кода и по типам. Здесь оно приходит из ответа модели, и одного разбора хватило,
 * чтобы это стало важно — прогоны были положены в `props[].label` вместо макета, и сборщик
 * упал на `.split` посреди прогона по библиотеке. Отказ на границе лучше падения в середине.
 */
function problemsInContent(content: unknown): string[] {
  const problems: string[] = []
  const root = content as { texts?: unknown; props?: unknown; swatches?: unknown }

  for (const [slot, lines] of Object.entries((root.texts ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(lines)) {
      problems.push(`texts.${slot} — не список строк`)
      continue
    }
    if (lines.some((line) => typeof line !== 'string')) {
      problems.push(`texts.${slot} содержит не строку`)
    }
  }

  // Кадры, вырез и логотип в разборе появляться не должны: они приходят на сборке, а не из
  // образца. Три разбора из 31 положили сюда словесные описания сцены («кадр на модели:
  // кардиган…»), и сборщик получал строку там, где ждал картинку. Раньше это давало
  // href="undefined" — невидимую битую картинку без единого сообщения.
  for (const key of ['frames', 'cutout', 'logo'] as const) {
    if ((root as Record<string, unknown>)[key] !== undefined) {
      problems.push(`${key} в разборе не место — кадры, вырез и логотип подставляются на сборке`)
    }
  }

  const swatches = Array.isArray(root.swatches) ? root.swatches : []
  swatches.forEach((swatch, index) => {
    const shape = swatch as Record<string, unknown>
    if (typeof shape?.color !== 'string' && typeof shape?.dataUri !== 'string') {
      problems.push(`swatches[${index}] — ни цвет, ни картинка`)
    }
  })

  const props = Array.isArray(root.props) ? root.props : []
  props.forEach((prop, index) => {
    for (const part of ['label', 'value'] as const) {
      const value = (prop as Record<string, unknown>)[part]
      if (value !== undefined && typeof value !== 'string') {
        problems.push(
          `props[${index}].${part} — не строка (прогоны разного начертания живут в макете, не в содержимом)`,
        )
      }
    }
  })

  return problems
}

async function fetchResults(): Promise<void> {
  const { batch, samples } = await state()
  const api = client()
  const found = await api.messages.batches.retrieve(batch)

  if (found.processing_status !== 'ended') {
    throw new Error(`батч ещё в статусе ${found.processing_status} — забирать рано`)
  }

  const byslug = new Map(samples.map((sample) => [sample.slug, sample]))
  const failed: string[] = []
  let saved = 0

  // Результаты приходят в произвольном порядке — ключ custom_id, а не позиция.
  for await (const result of await api.messages.batches.results(batch)) {
    const sample = byslug.get(result.custom_id)
    if (sample === undefined) {
      failed.push(`${result.custom_id}: нет такого образца в состоянии батча`)
      continue
    }

    if (result.result.type !== 'succeeded') {
      failed.push(`${sample.slug}: батч вернул ${result.result.type}`)
      continue
    }

    const text = result.result.message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')

    let parsed: { layout: CardLayout }
    try {
      parsed = JSON.parse(text.trim())
    } catch {
      failed.push(`${sample.slug}: ответ не разбирается как JSON`)
      continue
    }

    // Валидатор продукта, а не своя проверка: разъехаться со сборщиком ей было бы нечем.
    const problems = validateLayout(parsed.layout)
    if (problems.length > 0) {
      failed.push(`${sample.slug}: макет не проходит валидатор — ${problems.join('; ')}`)
      continue
    }

    const contentProblems = problemsInContent((parsed as { content?: unknown }).content)
    if (contentProblems.length > 0) {
      failed.push(`${sample.slug}: содержимое не той формы — ${contentProblems.join('; ')}`)
      continue
    }

    const record = { source: sample.source, ...parsed }
    await writeFile(`${SAMPLES}${sample.slug}.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    saved += 1
    console.log(`  ✓ ${sample.slug} ← ${sample.category}`)
  }

  console.log(`\nразобрано ${saved} из ${samples.length}`)
  for (const problem of failed) console.log(`  ✗ ${problem}`)
  if (saved > 0) console.log('\nдальше — гейт: npm run cards:roundtrip')
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
    console.log('команды: submit [слаг…] · status · fetch')
    process.exitCode = 1
}
