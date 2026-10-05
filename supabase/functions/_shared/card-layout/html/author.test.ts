import { afterEach, describe, expect, it, vi } from 'vitest'

import scene from '../../../../../tools/card-pipeline/html-layout/fixtures/home-chair.scene.json'
import families from '../../../../../tools/card-pipeline/fonts/roles.json'
import { createStubProvider } from '../../ai-provider/stub.ts'
import type { AuthorSeller } from '../../ai-provider/types.ts'
import type { LayoutPage } from '../cutout.ts'
import type { FontFamilies } from '../svg.ts'
import type { ImageRef } from '../types.ts'
import { validateLayout } from '../validate.ts'
import { authorLayout } from './author.ts'
import type { HtmlScene } from './scene.ts'

/**
 * Сочинение карточки на заглушках (шаг C3, ADR-0019 п. 6): заглушка провайдера отдаёт фикстуру
 * B2, «коробка» — записанную сцену той же фикстуры. Приём — целиком; любой отказ — `library`
 * с причиной, без исключения наружу.
 */

const fixture = scene as HtmlScene
const canvas = { width: 896, height: 1200 }
const frame: ImageRef = { dataUri: 'data:image/png;base64,AAAA', width: 1536, height: 2048 }

/** Слова фикстуры есть в текстах продавца: «Кресло с ушами», свойства модулей. */
const chair: AuthorSeller = {
  title: 'Кресло с ушами',
  fullTitle: 'Кресло с ушами',
  description: 'Кресло-крыло, обивка — три цветных блока.',
  properties: [
    { label: 'Тип товара', value: 'Кресло-крыло' },
    { label: 'Дизайн обивки', value: 'Три цветных блока' },
    { label: 'Материал опор', value: 'Дерево' },
  ],
  wishes: '',
}

/** Слов фикстуры у продавца нет: перевод обязан дать проблемы «слова не из текстов продавца». */
const lamp: AuthorSeller = {
  title: 'Настольная лампа',
  fullTitle: 'Настольная лампа',
  description: 'Лампа с тканевым абажуром.',
  properties: [{ label: 'Цоколь', value: 'E27' }],
  wishes: '',
}

function attempt(overrides: Partial<Parameters<typeof authorLayout>[0]> = {}) {
  vi.stubGlobal('Deno', { env: { get: () => undefined } })
  const pages: LayoutPage[] = []
  return {
    pages,
    run: authorLayout({
      frame,
      references: [new Uint8Array([1])],
      seller: chair,
      marketplaceId: 'ozon',
      categoryId: 'home',
      canvas,
      families: families as FontFamilies,
      author: (input) => createStubProvider().authorCard(input),
      scene: async (page) => {
        pages.push(page)
        return structuredClone(fixture)
      },
      ...overrides,
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('C3: сочинение → сцена → слои', () => {
  it('принимает сочинение: макет проходит валидатор, кадр — первый в содержимом', async () => {
    const { run, pages } = attempt()
    const outcome = await run

    expect(outcome.origin).toBe('author')
    if (outcome.origin !== 'author') return
    expect(validateLayout(outcome.layout)).toEqual([])
    expect(outcome.content.frames).toEqual([frame])
    expect(outcome.layout.layers.some((layer) => layer.type === 'frame')).toBe(true)
    // На коробку уходит страница сочинения, холст карточки и размер кадра — не сам кадр.
    expect(pages).toHaveLength(1)
    expect(pages[0].html).toContain('<div id="card"')
    expect(pages[0].canvas).toEqual(canvas)
    expect(pages[0].frame).toEqual({ width: 1536, height: 2048 })
  })

  it('непустые problems перевода — откат на библиотеку с причиной', async () => {
    const outcome = await attempt({ seller: lamp }).run

    expect(outcome.origin).toBe('library')
    if (outcome.origin !== 'library') return
    expect(outcome.reason).toContain('слова не из текстов продавца')
  })

  it('слова полного названия проходят сверку слов: модель видела его в задании', async () => {
    const words = [chair.title, chair.description, ...chair.properties.flatMap(({ label, value }) => [label, value])]
    const outcome = await attempt({ seller: { ...lamp, fullTitle: words.join(' ') } }).run

    expect(outcome.origin).toBe('author')
  })

  it('отказ /layout (раннер вернул null) — откат на библиотеку', async () => {
    const outcome = await attempt({ scene: async () => null }).run

    expect(outcome).toEqual({ origin: 'library', reason: expect.stringContaining('сцена не снята') })
  })

  it('исключение провайдера (блока html нет, шлюз молчит) — откат, а не упавшая генерация', async () => {
    const outcome = await attempt({
      author: async () => {
        throw new Error('Шлюз: в ответе нет блока html')
      },
    }).run

    expect(outcome).toEqual({ origin: 'library', reason: expect.stringContaining('нет блока html') })
  })

  it('сцена чужой формы — откат, а не исключение перевода', async () => {
    const outcome = await attempt({ scene: async () => ({ canvas }) as unknown as HtmlScene }).run

    expect(outcome.origin).toBe('library')
  })

  it('сцена с элементами вне подмножества — откат', async () => {
    const outcome = await attempt({
      scene: async () => ({ ...structuredClone(fixture), rejected: [{ selector: 'video', reason: 'не из подмножества' }] }),
    }).run

    expect(outcome).toEqual({ origin: 'library', reason: expect.stringContaining('вне подмножества') })
  })
})
