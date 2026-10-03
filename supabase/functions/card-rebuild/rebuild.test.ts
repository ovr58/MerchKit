import { describe, expect, it } from 'vitest'

import { imageRef, storedContent, type StoredContent } from '../_shared/card-layout/filling.ts'
import { composeSvg } from '../_shared/card-layout/svg.ts'
import type { FontFamilies } from '../_shared/card-layout/svg.ts'
import type { CardLayout, Layer } from '../_shared/card-layout/types.ts'
import { createRebuildHandler, type RebuildDeps } from './rebuild.ts'

/**
 * Пересборка карточки (шаг B7.5): настоящий обработчик, подставные база, хранилище и квота.
 *
 * Растеризатор подменён композицией SVG: `resvg` — WebAssembly с `npm:`-импортом и в этом
 * прогоне не живёт. Поэтому «тот же PNG» здесь — тот же SVG-текст; растр от SVG детерминирован
 * самим `resvg`, и это проверяется на стенде (см. отчёт строки), а не здесь.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const GENERATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const RESULT_PATH = `${USER}/${GENERATION}/result-1.png`

const FONTS: FontFamilies = {
  display: 'Montserrat',
  heading: 'Montserrat',
  body: 'Montserrat',
  label: 'Montserrat',
  accent: 'Marck Script',
}

const style = {
  role: 'body' as const,
  size: 0.05,
  weight: 400,
  color: '#000000',
  align: 'left' as const,
  valign: 'top' as const,
  lineHeight: 1.2,
}

function textLayer(id: string, z: number, y: number, bind: Layer['bind']): Layer {
  return { id, type: 'text', z, box: { x: 0, y, w: 0.9, h: 0.1 }, style, bind } as Layer
}

const LAYOUT: CardLayout = {
  id: 'rebuild-test',
  title: 'Тестовый макет',
  canvas: { aspectW: 3, aspectH: 4, background: { kind: 'solid', color: '#ffffff' } },
  layers: [
    { id: 'frame', type: 'frame', z: 0, box: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover', bind: { kind: 'frame' } },
    textLayer('title', 1, 0.0, { kind: 'text', slot: 'title' }),
    textLayer('body', 2, 0.1, { kind: 'text', slot: 'body' }),
    textLayer('prop-0', 3, 0.2, { kind: 'prop', index: 0 }),
    textLayer('prop-1', 4, 0.3, { kind: 'prop', index: 1 }),
  ],
}

/** Настоящий PNG 1×1: `fromStored` читает формат и размер из байтов, как на сборке. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (char) => char.charCodeAt(0),
)

const FRAME_PATH = `${USER}/${GENERATION}/frame-1.png`

type World = {
  generation: { user_id: string; status: string; kind: string; card_title: string; card_description: string; product_properties: unknown }
  card: { layout: CardLayout; content: StoredContent; font_map: Partial<FontFamilies> }
  files: Map<string, Uint8Array>
  queries: string[]
  quotaKeys: string[]
  quotaLeft: number
  updates: Record<string, unknown>[]
  recorded: { content: StoredContent; fontMap: FontFamilies }[]
  rendered: { fonts: FontFamilies; width: number; height: number }[]
}

function storedCard(): StoredContent {
  return storedContent(
    {
      frames: [imageRef(PNG)],
      texts: { title: ['Старый заголовок'], body: ['Старое описание'] },
      props: [{ label: 'Материал', value: 'Хлопок' }],
      swatches: [],
    },
    { frames: [FRAME_PATH] },
  )
}

function world(patch: Partial<World['generation']> = {}): World {
  return {
    generation: {
      user_id: USER,
      status: 'done',
      kind: 'card',
      card_title: 'Старый заголовок',
      card_description: 'Старое описание',
      product_properties: [{ label: 'Материал', value: 'Хлопок' }],
      ...patch,
    },
    card: { layout: LAYOUT, content: storedCard(), font_map: FONTS },
    files: new Map([[`results/${FRAME_PATH}`, PNG]]),
    queries: [],
    quotaKeys: [],
    quotaLeft: 200,
    updates: [],
    recorded: [],
    rendered: [],
  }
}

function handlerFor(state: World, overflows: unknown[] = []) {
  const deps: RebuildDeps = {
    callerId: async (request) => request.headers.get('Authorization')?.replace('Bearer ', '') ?? null,
    select: async (query) => {
      state.queries.push(query)
      if (query.startsWith('generations?')) return [state.generation]
      if (query.startsWith('generation_cards?')) return [state.card]
      if (query.startsWith('generation_assets?')) {
        return [{ storage_path: RESULT_PATH, width: 600, height: 800 }]
      }
      if (query.startsWith('card_font_roles?')) {
        return Object.entries(FONTS).map(([role, family]) => ({ role, family }))
      }
      if (query.startsWith('card_font_families?')) return [{ family: 'Marck Script' }, { family: 'Montserrat' }]
      throw new Error(`Неожиданный запрос ${query}`)
    },
    consumeQuota: async (key) => {
      state.quotaKeys.push(key)
      if (state.quotaLeft <= 0) return false
      state.quotaLeft -= 1
      return true
    },
    download: async (bucket, path) => {
      const file = state.files.get(`${bucket}/${path}`)
      if (file === undefined) throw new Error(`Нет файла ${bucket}/${path}`)
      return file
    },
    upload: async (bucket, path, bytes) => {
      state.files.set(`${bucket}/${path}`, bytes)
    },
    recordAssembly: async (_id, content, fontMap) => {
      state.recorded.push({ content, fontMap })
      state.card = { ...state.card, content, font_map: fontMap }
    },
    updateGeneration: async (_id, _user, patch) => {
      state.updates.push(patch)
      state.generation = { ...state.generation, ...patch }
    },
    render: async (layout, content, size, fonts) => {
      state.rendered.push({ fonts, ...size })
      const { svg, dropped } = composeSvg(layout, content, size, fonts)
      return {
        bytes: new TextEncoder().encode(svg),
        dropped: dropped.map((drop) => `${drop.id}: ${drop.reason}`),
        overflows: overflows as never,
      }
    },
    dailyLimit: 200,
  }
  return createRebuildHandler(deps)
}

function post(body: unknown, user: string | null = USER): Request {
  return new Request('http://localhost/card-rebuild', {
    method: 'POST',
    headers: user === null ? {} : { Authorization: `Bearer ${user}` },
    body: JSON.stringify(body),
  })
}

const EDIT = {
  generationId: GENERATION,
  texts: { title: 'Новый заголовок', description: 'Новое описание' },
  properties: [
    { label: 'Материал', value: 'Лён' },
    { label: 'Сезон', value: 'Лето' },
    { label: 'Цвет', value: 'Белый' },
  ],
}

describe('card-rebuild — допуск (B7.5)', () => {
  it('без входа — 401', async () => {
    expect((await handlerFor(world())(post(EDIT, null))).status).toBe(401)
  })

  it('чужая генерация — 403, и ни квота, ни запись не тронуты', async () => {
    const state = world({ user_id: OTHER })
    const response = await handlerFor(state)(post(EDIT))

    expect(response.status).toBe(403)
    expect(state.quotaKeys).toEqual([])
    expect(state.recorded).toEqual([])
    expect(state.updates).toEqual([])
  })

  it('генерация «фото» — 400', async () => {
    const response = await handlerFor(world({ kind: 'photo' }))(post(EDIT))
    expect(response.status).toBe(400)
  })

  it('генерация не завершена — 400', async () => {
    const response = await handlerFor(world({ status: 'running' }))(post(EDIT))
    expect(response.status).toBe(400)
  })

  it('идентификатор не в форме uuid — 400, до запроса к базе', async () => {
    const state = world()
    const response = await handlerFor(state)(post({ generationId: 'x?select=*' }))

    expect(response.status).toBe(400)
    expect(state.queries).toEqual([])
  })
})

describe('card-rebuild — режим чтения (B7.5)', () => {
  it('отдаёт тексты, свойства, карту шрифтов и гарнитуры по всем ролям, без квоты и сборки', async () => {
    const state = world()
    const response = await handlerFor(state)(post({ generationId: GENERATION }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      rebuildable: true,
      texts: { title: 'Старый заголовок', description: 'Старое описание' },
      properties: [{ label: 'Материал', value: 'Хлопок' }],
      capacity: 2,
      fontMap: FONTS,
    })
    expect(Object.keys(body.fontOptions).sort()).toEqual(['accent', 'body', 'display', 'heading', 'label'])
    expect(body.fontOptions.accent).toEqual(['Marck Script', 'Montserrat'])
    expect(state.quotaKeys).toEqual([])
    expect(state.rendered).toEqual([])
  })

  it('карточка собрана до B7.4 (кадра нет) — rebuildable: false', async () => {
    const state = world()
    state.card = { ...state.card, content: {} as StoredContent }
    const body = await (await handlerFor(state)(post({ generationId: GENERATION }))).json()

    expect(body.rebuildable).toBe(false)
  })
})

describe('card-rebuild — режим пересборки (B7.5)', () => {
  it('неизвестная гарнитура — 400, квота не тратится', async () => {
    const state = world()
    const response = await handlerFor(state)(post({ ...EDIT, fontMap: { accent: 'Comic Sans' } }))

    expect(response.status).toBe(400)
    expect(state.quotaKeys).toEqual([])
    expect(state.rendered).toEqual([])
  })

  it('неизвестная роль — 400', async () => {
    const response = await handlerFor(world())(post({ ...EDIT, fontMap: { logo: 'Montserrat' } }))
    expect(response.status).toBe(400)
  })

  it('роль из прототипа объекта — 400, а не обрыв с 503', async () => {
    const response = await handlerFor(world())(post({ ...EDIT, fontMap: { constructor: 'Montserrat' } }))
    expect(response.status).toBe(400)
  })

  it('сохранённая со сборки карта важнее сегодняшнего отображения ролей', async () => {
    const state = world()
    state.card = { ...state.card, font_map: { ...FONTS, heading: 'Marck Script' } }

    const read = await (await handlerFor(state)(post({ generationId: GENERATION }))).json()
    expect(read.fontMap.heading).toBe('Marck Script')

    await handlerFor(state)(post(EDIT))
    expect(state.rendered[0].fonts.heading).toBe('Marck Script')
  })

  it('пустой заголовок — 400', async () => {
    const response = await handlerFor(world())(post({ ...EDIT, texts: { title: '  ', description: 'x' } }))
    expect(response.status).toBe(400)
  })

  it('исчерпанный потолок — 429, ничего не записано', async () => {
    const state = world()
    state.quotaLeft = 0
    const response = await handlerFor(state)(post(EDIT))

    expect(response.status).toBe(429)
    expect(state.quotaKeys).toEqual([`rebuild:user:${USER}`])
    expect(state.recorded).toEqual([])
  })

  it('режет свойства по ёмкости, возвращает cut и переполнения, пишет файл, снимок и тексты', async () => {
    const overflow = { layerId: 'title', kind: 'width', text: 'Новый заголовок', over: 0.2 }
    const state = world()
    const response = await handlerFor(state, [overflow])(
      post({ ...EDIT, fontMap: { accent: 'Montserrat' } }),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      storagePath: RESULT_PATH,
      cut: [{ label: 'Цвет', value: 'Белый' }],
      overflows: [overflow],
      capacity: 2,
    })

    // Размер — у заменяемого файла; шрифт — выбор человека поверх сохранённой карты.
    expect(state.rendered).toEqual([{ fonts: { ...FONTS, accent: 'Montserrat' }, width: 600, height: 800 }])
    expect(state.files.get(`results/${RESULT_PATH}`)).toBeDefined()

    expect(state.recorded).toHaveLength(1)
    expect(JSON.stringify(state.recorded[0].content)).not.toContain('data:')
    expect(state.recorded[0].content.texts).toEqual({
      title: ['Новый заголовок'],
      body: ['Новое описание'],
    })
    expect(state.recorded[0].content.props).toEqual([
      { label: 'Материал', value: 'Лён' },
      { label: 'Сезон', value: 'Лето' },
    ])
    expect(state.recorded[0].content.frames).toEqual([
      { bucket: 'results', path: FRAME_PATH, width: 1, height: 1 },
    ])

    // Полный список, как ввёл человек, — иначе форма при следующем открытии показала бы старое.
    expect(state.updates).toEqual([
      {
        card_title: 'Новый заголовок',
        card_description: 'Новое описание',
        product_properties: EDIT.properties,
      },
    ])
  })

  it('fontMap не задан — собирает сохранённой картой', async () => {
    const state = world()
    await handlerFor(state)(post(EDIT))

    expect(state.rendered[0].fonts).toEqual(FONTS)
  })

  it('ни баланс, ни журнал не затронуты: читаются и пишутся только таблицы карточки', async () => {
    const state = world()
    await handlerFor(state)(post(EDIT))

    const tables = new Set(state.queries.map((query) => query.split('?')[0]))
    expect([...tables].sort()).toEqual([
      'card_font_families',
      'card_font_roles',
      'generation_assets',
      'generation_cards',
      'generations',
    ])
    expect(Object.keys(state.updates[0]).sort()).toEqual(['card_description', 'card_title', 'product_properties'])
  })

  it('повтор с теми же текстами даёт то же самое: сборка из уже записанного снимка не дрейфует', async () => {
    const state = world()
    const handler = handlerFor(state)

    await handler(post(EDIT))
    const first = state.files.get(`results/${RESULT_PATH}`)!
    await handler(post(EDIT))
    const second = state.files.get(`results/${RESULT_PATH}`)!

    expect(second).toEqual(first)
    expect(state.recorded[1]).toEqual(state.recorded[0])
  })

  it('карточка без сохранённого кадра — 400, а не обрыв посреди сборки', async () => {
    const state = world()
    state.card = { ...state.card, content: {} as StoredContent }
    const response = await handlerFor(state)(post(EDIT))

    expect(response.status).toBe(400)
    expect(state.quotaKeys).toEqual([])
  })

  it('сбой хранилища — 503 с человеческим текстом, устройство сервера не светится', async () => {
    const state = world()
    const deps = handlerFor(state)
    state.files = new Map() // кадра в хранилище нет — сборка не может начаться
    const response = await deps(post(EDIT))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(JSON.stringify(body)).not.toContain('results/')
  })
})
