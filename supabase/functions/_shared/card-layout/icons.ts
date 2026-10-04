/**
 * Иконки базы по именам → картинки для композиции (шаги B5.8 и B5.9 плана
 * `card-assembly-pipeline_2026-08-31.md`). Общий код воркера и пересборки: арт-директор выбрал
 * иконку по имени на сборке, пересборка обязана получить ту же картинку тем же способом.
 */

import { selectFromDatabase } from '../edge.ts'
import type { ImageRef } from './types.ts'

/** Размер иконки — как у иконок оснастки (`render.mts`): иконка вписывается в бокс слоя, а не берёт
 *  размер из файла. */
const ICON_SIZE = 24

/**
 * Исходник SVG лежит в `bytea`: PostgREST отдаёт его строкой `\x<hex>`. Имя, которого нет среди
 * готовых иконок, в ответ не попадает — вызывающий (`directedContent`) оставит свойство без иконки.
 */
export async function readIcons(
  names: string[],
  select: (query: string) => Promise<unknown[]> = selectFromDatabase,
): Promise<Record<string, ImageRef>> {
  const list = names.map(encodeURIComponent).join(',')
  const rows = (await select(
    `card_icons?select=name,content&name=in.(${list})&status=eq.${encodeURIComponent('готово')}`,
  )) as { name: string; content: string }[]

  return Object.fromEntries(
    rows.map((row) => {
      const hex = row.content.slice(2)
      let binary = ''
      for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16))
      return [row.name, { dataUri: `data:image/svg+xml;base64,${btoa(binary)}`, width: ICON_SIZE, height: ICON_SIZE }]
    }),
  )
}
