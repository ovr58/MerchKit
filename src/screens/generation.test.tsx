import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Экран результата: правка текста готовой карточки (B7.6).
 *
 * Сервер подменён на границе `supabase-js`: проверяется то, что делает экран, — что форма
 * наполняется ответом `card-rebuild` в режиме чтения, что правка уходит телом пересборки, что
 * переполнения и отсечённые свойства названы словами и что картинка подписывается заново.
 * Пересборка и растр — задача сервера и стенда, не jsdom.
 */

const GENERATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const ROW = {
  id: GENERATION_ID,
  status: 'done',
  kind: 'card',
  marketplace_id: 'ozon',
  category_id: 'clothing',
  preset_id: null,
  product_title: 'Куртка-бомбер',
  product_description: '',
  wishes: '',
  product_properties: [],
  price: 130,
  title: 'Куртка',
  card_title: 'Старый заголовок',
  card_description: 'Старое описание',
  failure_reason: null,
  source_paths: [],
  created_at: '2026-10-03T10:00:00Z',
  generation_assets: [{ storage_path: 'u/g/result-1.png', width: 600, height: 800, format: 'png' }],
}

const EDIT = {
  rebuildable: true,
  texts: { title: 'Старый заголовок', description: 'Старое описание' },
  properties: [{ label: 'Материал', value: 'Хлопок' }],
  layoutTitle: 'Тестовый макет',
  capacity: 1,
  fontMap: { display: 'Montserrat', heading: 'Montserrat', body: 'Montserrat', label: 'Montserrat', accent: 'Marck Script' },
  fontOptions: {
    accent: ['Marck Script', 'Montserrat'],
    body: ['Marck Script', 'Montserrat'],
    display: ['Marck Script', 'Montserrat'],
    heading: ['Marck Script', 'Montserrat'],
    label: ['Marck Script', 'Montserrat'],
  },
}

const REBUILD = {
  storagePath: 'u/g/result-1.png',
  layoutTitle: 'Тестовый макет',
  capacity: 1,
  cut: [{ label: 'Цвет', value: 'Белый' }],
  overflows: [{ layerId: 'title', kind: 'width', text: 'Очень длинный заголовок', over: 0.2 }],
}

const invoke = vi.fn()
const createSignedUrl = vi.fn()
let row: Record<string, unknown> = ROW

vi.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    single: () => Promise.resolve({ data: row, error: null }),
  }

  return {
    supabase: {
      from: () => query,
      functions: { invoke: (name: string, options: unknown) => invoke(name, options) },
      storage: { from: () => ({ createSignedUrl: (path: string) => createSignedUrl(path) }) },
    },
  }
})

vi.mock('@/features/auth', () => ({
  useSession: () => ({ session: { user: { id: 'user-1', email: 'seller@example.com' } } }),
}))

vi.mock('@/features/billing', () => ({
  useBalance: () => ({ isSuccess: true, data: 120 }),
}))

vi.mock('@/features/taxonomy', () => ({
  useTaxonomy: () => ({ data: undefined }),
  profileOf: () => null,
  titleOf: () => '—',
}))

const { default: Generation } = await import('@/screens/Generation')

function renderScreen() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/generation/${GENERATION_ID}`]}>
        <Routes>
          <Route element={<Generation />} path="/generation/:id" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  invoke.mockReset()
  createSignedUrl.mockReset()
  let issued = 0
  createSignedUrl.mockImplementation(() =>
    Promise.resolve({ data: { signedUrl: `https://storage.test/result-1.png?token=${(issued += 1)}` }, error: null }),
  )
  row = ROW
})

async function openEditor() {
  const user = userEvent.setup()
  renderScreen()
  await user.click(await screen.findByRole('button', { name: 'Изменить текст' }))
  return user
}

describe('Экран результата: правка текста карточки (B7.6)', () => {
  it('«Редактировать» видна, отключена и подсказывает, что редактор появится позже', async () => {
    renderScreen()

    const button = await screen.findByRole('button', { name: 'Редактировать' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Редактор появится позже')
  })

  it('у генерации-фото кнопок правки нет', async () => {
    row = { ...ROW, kind: 'photo', card_title: null, card_description: null }
    renderScreen()

    await screen.findByText('Куртка')
    expect(screen.queryByRole('button', { name: 'Изменить текст' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull()
  })

  it('форма наполняется режимом чтения: тексты, свойства, выбор гарнитуры по каждой роли', async () => {
    invoke.mockResolvedValue({ data: EDIT, error: null })
    await openEditor()

    expect(await screen.findByLabelText('Заголовок карточки')).toHaveValue('Старый заголовок')
    expect(screen.getByLabelText('Описание')).toHaveValue('Старое описание')
    expect(screen.getByLabelText('Значение свойства 1')).toHaveValue('Хлопок')
    expect(screen.getByLabelText('Рукописный акцент')).toHaveValue('Marck Script')
    expect(screen.getByLabelText('Описание и абзацы')).toHaveValue('Montserrat')
    expect(screen.getAllByRole('combobox')).toHaveLength(5)

    // Читает функция, а не таблицы шрифтов: тело — один идентификатор, без текстов.
    expect(invoke).toHaveBeenCalledWith('card-rebuild', { body: { generationId: GENERATION_ID } })
  })

  it('«Пересобрать» отправляет правку и называет словами отсечённое и переполнения из ответа', async () => {
    invoke.mockImplementation((_name: string, options: { body: Record<string, unknown> }) =>
      Promise.resolve({ data: 'texts' in options.body ? REBUILD : EDIT, error: null }),
    )
    const user = await openEditor()

    const title = await screen.findByLabelText('Заголовок карточки')
    await user.clear(title)
    await user.type(title, 'Очень длинный заголовок')
    await user.selectOptions(screen.getByLabelText('Рукописный акцент'), 'Montserrat')
    await user.click(screen.getByRole('button', { name: 'Пересобрать' }))

    expect(await screen.findByText(/«Очень длинный заголовок» — на 20% длиннее/)).toBeInTheDocument()
    expect(screen.getByText(/Цвет/)).toBeInTheDocument()
    expect(screen.getByText(/ёмкость макета «Тестовый макет»: 1 модуль/)).toBeInTheDocument()

    expect(invoke).toHaveBeenLastCalledWith('card-rebuild', {
      body: {
        generationId: GENERATION_ID,
        texts: { title: 'Очень длинный заголовок', description: 'Старое описание' },
        properties: [{ label: 'Материал', value: 'Хлопок' }],
        fontMap: { ...EDIT.fontMap, accent: 'Montserrat' },
      },
    })
  })

  it('после пересборки картинка подписывается заново: адрес файла тот же, ссылка новая', async () => {
    invoke.mockImplementation((_name: string, options: { body: Record<string, unknown> }) =>
      Promise.resolve({ data: 'texts' in options.body ? REBUILD : EDIT, error: null }),
    )
    const user = await openEditor()
    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('button', { name: 'Пересобрать' }))

    await waitFor(() => expect(createSignedUrl).toHaveBeenCalledTimes(2))
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, 'u/g/result-1.png')
  })

  it('отказ сервера показывается его же словами, форма остаётся с правкой', async () => {
    const refusal = Object.assign(new Error('non-2xx'), {
      context: new Response(JSON.stringify({ error: 'Пересборки на сегодня закончились. Попробуйте завтра' }), {
        status: 429,
      }),
    })
    invoke.mockImplementation((_name: string, options: { body: Record<string, unknown> }) =>
      Promise.resolve('texts' in options.body ? { data: null, error: refusal } : { data: EDIT, error: null }),
    )
    const user = await openEditor()

    await user.click(await screen.findByRole('button', { name: 'Пересобрать' }))

    expect(await screen.findByText('Пересборки на сегодня закончились. Попробуйте завтра')).toBeInTheDocument()
    expect(screen.getByLabelText('Заголовок карточки')).toHaveValue('Старый заголовок')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('карточка собрана до появления правки — вместо формы объяснение', async () => {
    invoke.mockResolvedValue({ data: { ...EDIT, rebuildable: false }, error: null })
    await openEditor()

    expect(await screen.findByText(/собрали до появления правки/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Пересобрать' })).toBeNull()
  })
})
