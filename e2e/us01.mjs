/**
 * US-01 в настоящем браузере: гость проходит мастер, регистрируется без потери настроек,
 * запускает генерацию, переживает F5 и скачивает результат.
 *
 * **Зачем отдельно от `npm run test:generation`.** Тот скрипт проверяет путь по HTTP и
 * доказывает контракт сервера. Здесь проверяется ровно то, чего в нём нет и быть не может:
 * что настройки гостя переживают регистрацию с подтверждением email (FR-12, US-E6), что
 * перезагрузка во время генерации не теряет результат (NFR-02) и что мастер проходится на
 * узком экране (NFR-09). Это свойства интерфейса, и на уровне API они невидимы.
 *
 * Запуск: `npm run test:ui` при поднятом `supabase start` и `npm run dev`.
 */

import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const APP = process.env.APP_URL ?? 'http://localhost:5173'

function localEnv() {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const env = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_]+)="(.*)"$/)
    if (match) env[match[1]] = match[2]
  }
  if (!env.API_URL) throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  return env
}

const env = localEnv()
const MAIL = `${env.INBUCKET_URL}/api/v1`
const SECRET = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Фото, которое заглушка сочтёт разборчивым: ей важен только размер (≥ 4 КБ). */
function photo() {
  // Валидный однопиксельный JPEG плюс балласт в конце: декодер читает заголовок и
  // останавливается, а нам нужен файл, который браузер примет как image/jpeg.
  const head = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  )
  return Buffer.concat([head, Buffer.alloc(8192, 0x20)])
}

async function verifyLinkFor(address) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch(`${MAIL}/messages?limit=50`)).json()
    const message = list.messages.find((m) => m.To.some((to) => to.Address === address))
    if (message) {
      const full = await (await fetch(`${MAIL}/message/${message.ID}`)).json()
      const found = (full.Text || full.HTML || '').match(/http:\/\/[^\s"<>]*verify[^\s"<>]*/)
      if (found) return found[0].replace(/&amp;/g, '&')
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

const email = `ui.${Date.now()}@example.com`
const password = 'password123'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()

try {
  /* ------------------------------------------- гость проходит мастер целиком (FR-12) */

  await page.goto(`${APP}/generate`)
  await page.getByRole('heading', { name: 'Создать генерацию' }).waitFor()
  check('FR-12 мастер открывается гостю без входа', true)

  await page.setInputFiles('input[type=file]', {
    name: 'куртка.jpg',
    mimeType: 'image/jpeg',
    buffer: photo(),
  })
  await page.getByRole('button', { name: 'Убрать фото куртка.jpg' }).waitFor()
  check('FR-02 фото принято и показано миниатюрой', true)

  await page.getByRole('button', { name: 'Далее' }).click()

  // Шаг «Товар»: распознавание заполняет поля само (FR-03, FR-04).
  await page.getByText('Наименование', { exact: true }).waitFor()
  await page.waitForFunction(
    () => document.querySelector('select')?.value !== '',
    null,
    { timeout: 15000 },
  )
  const guessedTitle = await page.locator('input').first().inputValue()
  check('FR-03/FR-04 категория и наименование подставлены по фото', guessedTitle !== '', guessedTitle)

  // FR-05: определённое правится руками, и дальше идёт именно исправленное.
  await page.locator('input').first().fill('Куртка-бомбер')
  await page.locator('select').selectOption('clothing')
  await page.getByRole('button', { name: 'Далее' }).click()

  // Шаг «Площадка» (FR-25): параметры файла показаны ДО списания.
  await page.getByRole('heading', { name: 'Куда пойдёт изображение' }).waitFor()
  await page.getByRole('button', { name: /^Ozon/ }).click()
  const params = page.getByText('Каким получится файл')
  await params.waitFor()
  const shownSize = await page.getByText('1200 × 1600').first().isVisible()
  const shownGrey = await page.getByText('серый #F2F3F5').first().isVisible()
  check('FR-25 параметры пары показаны до списания, с исключением Ozon', shownSize && shownGrey)

  await page.getByRole('button', { name: 'Далее' }).click()
  await page.getByRole('heading', { name: 'Что создаём?' }).waitFor()
  await page.getByRole('button', { name: /^Карточка/ }).click()
  await page.getByRole('button', { name: 'Далее' }).click()

  await page.getByRole('heading', { name: 'Как показать товар' }).waitFor()
  await page.getByRole('button', { name: /^На модели/ }).click()
  await page.getByRole('button', { name: 'Далее' }).click()

  await page.getByRole('heading', { name: 'Проверьте и запускайте' }).waitFor()
  check('FR-11 цена показана до запуска', await page.getByText('55 баллов').first().isVisible())

  /* ------------------------------------- перехват гостя без потери настроек (US-E6) */

  await page.getByRole('button', { name: /Запустить генерацию/ }).click()
  await page.getByRole('dialog').waitFor()
  check('FR-12 гостю предложена регистрация, генерация не стартовала', true)

  await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByLabel('Подтверждение пароля').fill(password)
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  await page.getByText('Подтвердите email').waitFor({ timeout: 20000 })

  const link = await verifyLinkFor(email)
  if (!link) throw new Error('Письмо подтверждения не пришло')
  await page.goto(link)

  // Ссылка из письма приводит в мастер, а не на профиль: настройки на месте.
  await page.waitForURL('**/generate', { timeout: 20000 })
  await page.getByRole('heading', { name: 'Проверьте и запускайте' }).waitFor()

  // Фильтр по видимости обязателен: степпер отрисован дважды — горизонтальный для
  // десктопа и вертикальный для узкого экрана (NFR-09), и на широком мониторе второй
  // стоит в разметке первым, но скрыт. Проверяем то, что человек видит.
  const seen = async (text) => {
    try {
      await page
        .getByText(text)
        .locator('visible=true')
        .first()
        .waitFor({ state: 'visible', timeout: 10000 })
      return true
    } catch {
      return false
    }
  }

  const keptPhoto = await seen('1 файл')
  const keptProduct = await seen('Куртка-бомбер')
  const keptPreset = await seen('На модели')
  if (!(keptPhoto && keptProduct && keptPreset)) {
    await page.screenshot({ path: 'e2e-restore.png', fullPage: true })
  }
  check(
    'US-E6/FR-12 после подтверждения email мастер вернулся с теми же ответами',
    keptPhoto && keptProduct && keptPreset,
    `фото ${keptPhoto}, товар ${keptProduct}, сценарий ${keptPreset}`,
  )

  /* ---------------------------------------------- запуск, F5 и результат (NFR-02) */

  await page.getByRole('button', { name: /Запустить генерацию/ }).click()
  await page.waitForURL('**/generation/**', { timeout: 30000 })
  const generationUrl = page.url()
  check('US-01 заявка принята, открылся экран генерации', true)

  await page.getByText('Провайдер рисует изображение').first().waitFor({ timeout: 10000 })

  // NFR-02: перезагрузка во время работы не теряет ни статус, ни результат.
  await page.reload()
  let survived = true
  try {
    await page
      .getByText(/Провайдер рисует изображение|Готово/)
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    survived = false
  }
  check('NFR-02 перезагрузка во время генерации не теряет статус', survived)

  await page.getByText('Готово').waitFor({ timeout: 60000 })
  check('US-01 генерация дошла до результата', true)

  const hasImage = await page.locator('img[src^="http"]').first().isVisible()
  const hasCardTitle = await page.getByText('Заголовок карточки').isVisible()
  const hasCardText = await page.getByText('Описание', { exact: true }).isVisible()
  check('FR-07 карточка: изображение, заголовок и описание', hasImage && hasCardTitle && hasCardText)

  const download = page.waitForEvent('download', { timeout: 20000 })
  await page.getByRole('button', { name: 'Скачать изображение' }).click()
  const file = await download
  check('FR-14/FR-15 изображение скачивается', (await file.path()) !== null, file.suggestedFilename())

  /* ------------------------------------------------------------ каталог (FR-01, FR-17) */

  await page.getByRole('link', { name: 'В каталог' }).click()
  await page.getByRole('heading', { name: 'Каталог генераций' }).waitFor()
  let cards = 0
  try {
    await page.locator('a[href^="/generation/"]').first().waitFor({ timeout: 15000 })
    cards = await page.locator('a[href^="/generation/"]').count()
  } catch {
    cards = 0
  }
  check('FR-01 генерация появилась в каталоге', cards === 1, `карточек ${cards}`)

  const settledBalance = async () => {
    const pill = page.locator('header').getByText(/баллов/)
    await pill.waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForFunction(
      () => !(document.querySelector('header')?.textContent ?? '').includes('— баллов'),
      null,
      { timeout: 15000 },
    )
    return pill.textContent()
  }

  const balanceBefore = await settledBalance()
  await page.goto(generationUrl)
  const second = page.waitForEvent('download', { timeout: 20000 })
  await page.getByRole('button', { name: 'Скачать изображение' }).click()
  await second
  await page.goto(`${APP}/catalog`)
  const balanceAfter = await settledBalance()
  check(
    'FR-17 повторное скачивание из каталога не списывает баллы',
    balanceBefore === balanceAfter,
    `${balanceBefore} → ${balanceAfter}`,
  )

  /* --------------------------------------------------------------- узкий экран (NFR-09) */

  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto(`${APP}/catalog`)
  await page.getByRole('heading', { name: 'Каталог генераций' }).waitFor()
  const catalogOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  check('NFR-09 каталог на 360 px без горизонтальной прокрутки', !catalogOverflow)

  await page.goto(`${APP}/generate`)
  await page.getByRole('heading', { name: 'Создать генерацию' }).waitFor()
  const wizardOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  check('NFR-09 мастер на 360 px без горизонтальной прокрутки', !wizardOverflow)
} finally {
  await browser.close()

  // Уборка: подопытный аккаунт не должен оставаться в локальной базе.
  const users = await (
    await fetch(`${env.API_URL}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  ).json()
  const created = (users.users ?? []).find((user) => user.email === email)
  if (created) {
    await fetch(`${env.API_URL}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  }
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length === 0 ? 0 : 1)
