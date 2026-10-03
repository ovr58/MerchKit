/**
 * Механическая приёмка дословности (шаг C1 плана `card-assembly-pipeline_2026-08-31.md`):
 * заголовок и описание на карточке — ровно те слова, что вернул `composeCard`.
 *
 * **Зачем проверка, если текст «просто кладётся».** Между текстом заявки и пикселями три
 * места, где слово можно потерять молча: наполнение содержимого, подстановка в гнездо и
 * разбивка на прогоны. Карточка с обрезанным заголовком — тот брак, который продавец заметит
 * на площадке, а не у нас; поэтому проверяется то, что реально легло в кадр, а не то, что
 * собирались положить.
 *
 * **Растеризации здесь нет.** Проверка читает тот же `resolveLayout`, что и сборщик, и не
 * зовёт `resvg`: она обязана стоить ничего и не зависеть от рантайма.
 *
 * Регистр не сверяется намеренно: `transform: 'upper'` — стиль, он применяется при рисовании
 * и слов не меняет.
 */

import { resolveLayout } from './validate.ts'
import type { PlacedRun } from './validate.ts'
import type { CardContent, CardLayout, TextLine, TextSlot } from './types.ts'

/** Гнёзда, чей текст обязан дойти до кадра дословно. Остальные (подзаголовок, плашка,
 *  размеры, бренд) заполняет арт-директор (B5), и «исходного текста» у них нет. */
const VERBATIM_SLOTS = ['title', 'body'] as const satisfies readonly TextSlot[]

/** Исходные тексты гнёзд: строки одного гнезда склеиваются через пробел, как и на сборке. */
export type SourceTexts = Partial<Record<TextSlot, string[]>>

/**
 * Какие из гнёзд `title` и `body` легли в кадр не теми словами.
 *
 * `source` — то, что обязано оказаться в кадре. По умолчанию это сам `content.texts`, но
 * воркер передаёт тексты, как их вернул провайдер: иначе обрезка, случившаяся при наполнении
 * содержимого, прошла бы незамеченной — сверка с уже обрезанным не находит расхождения.
 *
 * Гнездо, которому не нашлось слоя в макете (или слой снят правилом K-3), не проверяется:
 * макет без описания — штатный случай, а пропажу самого текста ловит воркер до сборки.
 */
export function textMismatches(
  layout: CardLayout,
  content: CardContent,
  source: SourceTexts = content.texts,
): TextSlot[] {
  const { layers } = resolveLayout(layout, content)

  return VERBATIM_SLOTS.filter((slot) => {
    const expected = collapse((source[slot] ?? []).join(' '))

    return layers.some(({ layer, lines }) => {
      if (layer.type !== 'text' || layer.bind?.kind !== 'text' || layer.bind.slot !== slot) {
        return false
      }

      return collapse(filledRuns(layer.lines, lines ?? []).map((run) => run.text).join(' ')) !== expected
    })
  })
}

/** Пробельные символы любого вида — один пробел; края отрезаются. */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Прогоны слоя, пришедшие из привязки. Статические прогоны шаблона («Размер: …») — часть
 * макета, а не тексты заявки, и в сравнение не идут. Шаблона нет — вся раскладка из привязки.
 */
function filledRuns(template: TextLine[] | undefined, lines: PlacedRun[][]): PlacedRun[] {
  if (template === undefined || template.length === 0) return lines.flat()

  return lines.flatMap((runs, row) => {
    const line = template[row]
    return typeof line === 'string' || line === undefined ? [] : runs.filter((_, column) => line[column]?.text === undefined)
  })
}
