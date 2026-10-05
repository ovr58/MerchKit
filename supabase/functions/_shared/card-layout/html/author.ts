/**
 * Сочинение карточки в рантайме — шаг C3 плана `html-layout-authoring_2026-10-05.md`,
 * [ADR-0019](../../../../../docs/adr/0019-html-authoring-transpiled-to-layers.md), пп. 2–6:
 * `authorCard` (модель пишет HTML) → `POST /layout` (Chromium на коробке снимает сцену) →
 * `toLayout` (сцена → макет и содержимое) → приём.
 *
 * **Приём — целиком или откат.** Исход один из двух: `author` — макет и содержимое, по которым
 * воркер собирает карточку; `library` — причина одной строкой, и воркер собирает по макету
 * библиотеки, как без сочинения. Исключение наружу не уходит никогда: отказ сочинения не должен
 * стоить продавцу генерации (ADR-0019, п. 6 — «худший исход — сегодняшний»).
 *
 * Зависимости — провайдер и раннер сцены — приходят параметрами: тест гоняет настоящий код на
 * заглушке провайдера и записанной сцене, без сети и без Chromium.
 */

import type { AiProvider, AuthorSeller, ImageInput } from '../../ai-provider/types.ts'
import type { LayoutRunner } from '../cutout.ts'
import { imageBytes } from '../filling.ts'
import type { FontFamilies } from '../svg.ts'
import type { CardContent, CardLayout, ImageRef } from '../types.ts'
import { toLayout, type SellerTexts } from './to-layout.ts'

export type AuthorOutcome =
  | { origin: 'author'; layout: CardLayout; content: CardContent }
  | { origin: 'library'; reason: string }

/** Сколько проблем перевода показать в причине: журнал — одна строка, а не простыня. */
const REASON_PROBLEMS = 3

export async function authorLayout(args: {
  /** Кадр вендора: байты уходят модели, размер — коробке, сам он — первым кадром содержимого. */
  frame: ImageRef
  /** Не больше четырёх, первый — ведущий (`pickReferences`). */
  references: ImageInput[]
  seller: AuthorSeller
  /** Прочие тексты продавца (полное название): из них можно брать слова, привязки к ним нет. */
  extra: string[]
  marketplaceId: string
  categoryId: string
  canvas: { width: number; height: number }
  families: FontFamilies
  author: AiProvider['authorCard']
  scene: LayoutRunner
}): Promise<AuthorOutcome> {
  try {
    const { html } = await args.author({
      frame: imageBytes(args.frame),
      references: args.references,
      seller: args.seller,
      marketplaceId: args.marketplaceId,
      categoryId: args.categoryId,
      canvas: args.canvas,
    })

    const scene = await args.scene({
      html,
      canvas: args.canvas,
      frame: { width: args.frame.width, height: args.frame.height },
    })
    if (scene === null) return { origin: 'library', reason: 'сцена не снята (причина — строкой «Сцена:» выше)' }

    const texts: SellerTexts = {
      title: args.seller.title,
      body: args.seller.description,
      props: args.seller.properties.map(({ label, value }) => ({ label, value })),
      extra: [args.seller.wishes, ...args.extra],
    }
    const { layout, content, problems } = toLayout(scene, args.canvas, texts, args.families)

    if (problems.length > 0) {
      const shown = problems.slice(0, REASON_PROBLEMS).join('; ')
      const more = problems.length > REASON_PROBLEMS ? ` и ещё ${problems.length - REASON_PROBLEMS}` : ''
      return { origin: 'library', reason: `перевод: ${shown}${more}` }
    }

    return { origin: 'author', layout, content: { ...content, frames: [args.frame] } }
  } catch (error: unknown) {
    return { origin: 'library', reason: error instanceof Error ? error.message : String(error) }
  }
}
