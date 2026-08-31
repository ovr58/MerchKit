/**
 * Гейт фазы A: разобрать образец → собрать по своему же разбору → положить рядом с оригиналом
 * (шаг A3 плана `card-assembly-pipeline_2026-08-31.md`).
 *
 * **Что именно проверяется.** Не качество дизайна и не сходство шрифтов, а способность языка
 * макета выразить чужую композицию: те же слои, в тех же долях холста, в том же порядке. Не
 * выражается — язык переделывается, и дальше веха не идёт.
 *
 * **Две сборки на образец, потому что вопросов два.**
 * - `*.rebuilt.png` — наши слои поверх оригинала. Оригинал служит кадром вендора, поэтому его
 *   собственные надписи остаются на месте: если разбор верен, наш текст ложится на них и
 *   совпадает, если промахнулись — видно двоение. Это проверка **попадания**.
 * - `*.layers.png` — те же слои без кадра вообще, на фоне самого макета. Это проверка
 *   **полноты**: видно, что в разборе есть, а чего нет.
 *
 * Оба файла кладутся рядом с оригиналами в `docs/assets/cardsforsysprompt/`, как требует шаг.
 *
 * Запуск: `npm run cards:roundtrip`
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { icon, png, render } from './render.mts'
import type {
  CardContent,
  CardLayout,
} from '../../supabase/functions/_shared/card-layout/types.ts'

const SAMPLES = fileURLToPath(new URL('samples/', import.meta.url))
const ORIGINALS = fileURLToPath(new URL('../../docs/assets/cardsforsysprompt/', import.meta.url))

/** Разбор образца в том виде, в каком его будет отдавать vision-модель на шаге A4. */
type Sample = {
  layout: CardLayout
  /** Иконки в разборе названы именем из базы, а не содержимым: содержимое подставляется здесь. */
  content: Omit<CardContent, 'frame' | 'cutout' | 'logo' | 'props'> & {
    props: { label?: string; value?: string; icon?: string }[]
  }
  notes: string[]
}

async function main(): Promise<void> {
  const files = (await readdir(SAMPLES)).filter((name) => name.endsWith('.json')).sort()
  // Прогон кладёт результат в ту же папку, поэтому свои же файлы из списка исключаем —
  // иначе следующий прогон разберёт собственную сборку как образец.
  const originals = (await readdir(ORIGINALS)).filter(
    (name) => name.endsWith('.png') && !/\.(rebuilt|layers)\.png$/.test(name),
  )

  for (const file of files) {
    const sample = JSON.parse(await readFile(`${SAMPLES}${file}`, 'utf8')) as Sample
    const original = matchOriginal(originals, file)
    const frame = await png(`${ORIGINALS}${original}`)
    const size = { width: frame.width, height: frame.height }

    const props = await Promise.all(
      sample.content.props.map(async (prop) => ({
        label: prop.label,
        value: prop.value,
        icon: prop.icon === undefined ? undefined : await icon(prop.icon),
      })),
    )

    const base: CardContent = { ...sample.content, props }
    const stem = original.replace(/\.png$/, '')

    await emit(`${ORIGINALS}${stem}.rebuilt.png`, sample.layout, { ...base, frame }, size)
    await emit(`${ORIGINALS}${stem}.layers.png`, sample.layout, base, size)

    console.log(`  ← ${original} (${size.width} × ${size.height})`)
    for (const note of sample.notes) {
      console.log(`    примечание: ${note}`)
    }
  }
}

async function emit(
  path: string,
  layout: CardLayout,
  content: CardContent,
  size: { width: number; height: number },
): Promise<void> {
  const { bytes, dropped } = await render(layout, content, size)
  await writeFile(path, bytes)

  const name = path.slice(path.lastIndexOf('/') + 1)
  console.log(`${name} — ${(bytes.length / 1024).toFixed(0)} КБ`)
  for (const drop of dropped) {
    console.log(`    K-3 снял слой ${drop}`)
  }
}

/** Файлы образцов названы по-русски, разборы — по-английски; связь держим по порядку разбора. */
function matchOriginal(originals: string[], sampleFile: string): string {
  const order: Record<string, string> = {
    'dress-summer.json': 'женской одежды',
    'jacket-outventure.json': 'верхней одежды',
    'tshirt-marrengo.json': 'пример карточки одежды',
  }
  const needle = order[sampleFile]
  const found = originals.find((name) => name.includes(needle))

  if (found === undefined) {
    throw new Error(`для разбора ${sampleFile} нет оригинала (искали «${needle}»)`)
  }

  return found
}

await main()
