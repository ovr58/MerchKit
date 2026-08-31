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

import { icon, image, render } from './render.mts'
import type {
  CardContent,
  CardLayout,
} from '../../supabase/functions/_shared/card-layout/types.ts'

const SAMPLES = fileURLToPath(new URL('samples/', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Разбор образца в том виде, в каком его будет отдавать vision-модель на шаге A4. */
type Sample = {
  /**
   * Путь к оригиналу от корня репозитория. Явная ссылка, а не угадывание по имени: набор A6
   * лежит вложенными папками с русскими названиями, и связывать разбор с кадром порядком
   * файлов, как было на трёх образцах A3, дальше нечем.
   */
  source: string
  layout: CardLayout
  /** Иконки в разборе названы именем из базы, а не содержимым: содержимое подставляется здесь. */
  content: Omit<CardContent, 'frame' | 'cutout' | 'logo' | 'props'> & {
    props: { label?: string; value?: string; icon?: string }[]
  }
  notes: string[]
}

async function main(): Promise<void> {
  const files = (await readdir(SAMPLES)).filter((name) => name.endsWith('.json')).sort()

  for (const file of files) {
    const sample = JSON.parse(await readFile(`${SAMPLES}${file}`, 'utf8')) as Sample
    const original = `${ROOT}${sample.source}`
    const frame = await image(original)
    const size = { width: frame.width, height: frame.height }

    const props = await Promise.all(
      sample.content.props.map(async (prop) => ({
        label: prop.label,
        value: prop.value,
        icon: prop.icon === undefined ? undefined : await icon(prop.icon),
      })),
    )

    const base: CardContent = { ...sample.content, props }
    // Сборка ложится рядом с оригиналом — сравнивать глазами удобно только там.
    const stem = original.replace(/\.(png|jpe?g)$/i, '')

    await emit(`${stem}.rebuilt.png`, sample.layout, { ...base, frame }, size)
    await emit(`${stem}.layers.png`, sample.layout, base, size)

    console.log(`  ← ${sample.source} (${size.width} × ${size.height})`)
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

await main()
