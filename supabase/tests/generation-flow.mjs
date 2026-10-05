/**
 * Сквозная проверка US-01 против **живого** локального Supabase: от загрузки фото до
 * скачивания результата, на заглушке провайдера.
 *
 * Зачем отдельно от `npm run test:db`: pgTAP проверяет контракт базы, а здесь проверяется
 * путь целиком — Storage, Edge Functions, провайдер за интерфейсом, PostgREST и RLS вместе.
 * Соответствие файла профилю FR-25 иначе не проверить вовсе: размер кадра появляется только
 * тогда, когда файл реально сгенерирован и сохранён.
 *
 * Запуск: `npm run test:generation` при поднятом `supabase start`.
 * Ключи берутся из `supabase status` — в репозитории их нет и быть не должно.
 */

import { execFileSync } from 'node:child_process'

import { cardAssemblySize } from '../functions/_shared/card-size.ts'

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
  if (!env.API_URL) {
    throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
  }
  return env
}

const env = localEnv()
const API = `${env.API_URL}/auth/v1`
const REST = `${env.API_URL}/rest/v1`
const FUNCTIONS = `${env.API_URL}/functions/v1`
const STORAGE = `${env.API_URL}/storage/v1`
const MAIL = `${env.INBUCKET_URL}/api/v1`
const KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY
const SECRET = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY
// Воркер — внутренняя дорога, и он сверяет заголовок ровно с той переменной, которую
// рантайм ему инжектит (`SUPABASE_SERVICE_ROLE_KEY`). У локального Supabase админ-ключей
// два стиля — legacy-JWT и `sb_secret_…`, — и новый сюда не подойдёт. Это не придирка
// проверки, а нужное свойство: посторонний вызов воркера обязан отлетать.
const WORKER_KEY = env.SERVICE_ROLE_KEY

const CONFIRM_RETURN = 'http://localhost:5173/auth/callback'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ мелкие помощники */

async function auth(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const rest = (path, token) =>
  fetch(`${REST}/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } })

async function callFunction(name, token, body) {
  const res = await fetch(`${FUNCTIONS}/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function lastVerifyLinkFor(address) {
  const list = await (await fetch(`${MAIL}/messages?limit=50`)).json()
  const message = list.messages.find((m) => m.To.some((to) => to.Address === address))
  if (!message) return null
  const full = await (await fetch(`${MAIL}/message/${message.ID}`)).json()
  const found = (full.Text || full.HTML || '').match(/http:\/\/[^\s"<>]*verify[^\s"<>]*/)
  return found ? found[0].replace(/&amp;/g, '&') : null
}

async function register(email, password) {
  const created = await auth(
    `/signup?redirect_to=${encodeURIComponent(CONFIRM_RETURN)}`,
    { email, password },
  )
  const link = await lastVerifyLinkFor(email)
  if (link) await fetch(link, { redirect: 'manual' })
  const signedIn = await auth('/token?grant_type=password', { email, password })
  return { id: created.body.id ?? created.body.user?.id, token: signedIn.body.access_token }
}

const balanceOf = async (token) => {
  const rows = await (await rest('profiles?select=balance', token)).json()
  return Array.isArray(rows) && rows.length === 1 ? rows[0].balance : null
}

/**
 * Размер изображения из заголовка JPEG. Дублирует `readJpegSize` из Edge Functions
 * намеренно: проверка обязана читать файл своими глазами, а не тем же кодом, который его
 * написал. Совпадут — значит совпали две независимые реализации.
 */
function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] }
    }
    if (marker === 0xda) return null
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3])
  }
  return null
}

/** Размер изображения из заголовка PNG (IHDR) — своими глазами, по той же причине, что `jpegSize`. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((byte, at) => bytes[at] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Фото, которое стоит отправить: заглушке важен только размер, содержимое ей безразлично. */
const photoBytes = () => Buffer.alloc(8192, 0x42)

/** Крючок заглушки для `moderate` (stub.ts): первый байт 0x00 ни один настоящий формат не даёт. */
const moderationRejectedBytes = () => Buffer.concat([Buffer.from([0x00]), Buffer.alloc(8191, 0x42)])

async function uploadPhoto(user, name, bytes = photoBytes()) {
  const path = `${user.id}/${name}`
  const res = await fetch(`${STORAGE}/object/uploads/${path}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: bytes,
  })
  return { status: res.status, path }
}

/** Ждёт, пока генерация выйдет из работы. Долгая операция — статус живёт в базе (NFR-02). */
async function settle(token, generationId, timeoutMs = 40_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const rows = await (await rest(`generations?id=eq.${generationId}&select=*`, token)).json()
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (row && row.status !== 'queued' && row.status !== 'running') return row
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return null
}

/** Скачивание из каталога идёт подписанной ссылкой — прямого доступа к бакету нет. */
async function downloadResult(token, storagePath) {
  const signed = await fetch(`${STORAGE}/object/sign/results/${storagePath}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }),
  })
  if (!signed.ok) return null
  const { signedURL } = await signed.json()
  const file = await fetch(`${STORAGE}${signedURL.replace(/^\/storage\/v1/, '')}`)
  if (!file.ok) return null
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.headers.get('content-type') }
}

const launch = (token, overrides) =>
  callFunction('generate', token, {
    kind: 'card',
    marketplaceId: 'ozon',
    categoryId: 'clothing',
    presetId: 'clothing-model',
    productTitle: 'Куртка-бомбер',
    productDescription: 'Плащёвка на синтепоне, хаки, S–XXL',
    wishes: '',
    photoPaths: [],
    ...overrides,
  })

/* ================================================================= сквозной сценарий */

const stamp = Date.now()
const password = 'password123'

const seller = await register(`seller.${stamp}@example.com`, password)
check('FR-19 стартовые 120 баллов на месте', (await balanceOf(seller.token)) === 120)

// --- гость проходит мастер, но запустить не может (FR-12) ---------------------
const asGuest = await fetch(`${REST}/marketplace_output_profiles?select=*&marketplace_id=eq.ozon`, {
  headers: { apikey: KEY },
})
check(
  'FR-12 справочники читаются гостем: витрина и цены видны до регистрации',
  asGuest.status === 200 && (await asGuest.json()).length === 7,
)

const guestLaunch = await fetch(`${FUNCTIONS}/generate`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ kind: 'card', marketplaceId: 'ozon', categoryId: 'clothing', productTitle: 'Куртка' }),
})
check('FR-12 гость генерацию не запускает', guestLaunch.status === 401, `HTTP ${guestLaunch.status}`)

// --- US-E1 / FR-02: фото уезжают в свою папку приватного бакета ---------------
const uploaded = await uploadPhoto(seller, 'photo-1.jpg')
check('FR-02 фото загружается в приватный бакет', uploaded.status === 200, `HTTP ${uploaded.status}`)

const foreign = await fetch(`${STORAGE}/object/uploads/00000000-0000-4000-8000-000000000000/чужое.jpg`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${seller.token}`, 'Content-Type': 'image/jpeg' },
  body: photoBytes(),
})
check('NFR-04 в чужую папку файл не положить', foreign.status >= 400, `HTTP ${foreign.status}`)

// --- FR-03/FR-04: распознавание — только вошедшему ----------------------------
// Гварда на маршруте мастера для этого мало: `anon`-ключ публичен, и функцию можно позвать
// мимо интерфейса. Каждый ответ гостю — деньги вендору за того, кто ни разу не назвался
// (решение пользователя 2026-09-01, FR-12 переписан; см. шапку `recognize/index.ts`).
const photoForm = () => {
  const form = new FormData()
  form.append('photo', new Blob([photoBytes()], { type: 'image/jpeg' }), 'photo-1.jpg')
  return form
}

const asGuestRecognize = await fetch(`${FUNCTIONS}/recognize`, {
  method: 'POST',
  headers: { apikey: KEY },
  body: photoForm(),
})
check(
  'FR-12 распознавание не отвечает гостю: ответ гостю — деньги вендору',
  asGuestRecognize.status === 401,
  `HTTP ${asGuestRecognize.status}`,
)

const recognized = await fetch(`${FUNCTIONS}/recognize`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${seller.token}` },
  body: photoForm(),
})
const recognizedBody = await recognized.json().catch(() => ({}))
check(
  'FR-03 распознавание отвечает вошедшему категорией из справочника',
  recognized.status === 200 && typeof recognizedBody.categoryId === 'string',
  JSON.stringify(recognizedBody),
)

const tiny = new FormData()
tiny.append('photo', new Blob([Buffer.alloc(64)], { type: 'image/jpeg' }), 'photo-1.jpg')
const unrecognized = await (
  await fetch(`${FUNCTIONS}/recognize`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${seller.token}` },
    body: tiny,
  })
).json()
check(
  'US-E2 не распознал — не ошибка, а пустые поля',
  unrecognized.categoryId === null && unrecognized.productTitle === null,
)

// --- US-01: главный путь ------------------------------------------------------
const started = await launch(seller.token, { photoPaths: [uploaded.path] })
check(
  'US-01 заявка принята и вернула generationId',
  started.status === 200 && typeof started.body.generationId === 'string',
  JSON.stringify(started.body),
)
check('FR-11 сервер посчитал цену карточки сам: 55 баллов', started.body.price === 55)
check('V-07 баллы списаны при приёме заявки', (await balanceOf(seller.token)) === 65)

const done = await settle(seller.token, started.body.generationId)
check('US-01 генерация дошла до готового результата', done?.status === 'done', done?.status ?? 'нет ответа')
check('FR-16 у генерации есть название от ИИ', typeof done?.title === 'string' && done.title.length > 0, done?.title)
check(
  'FR-07 карточка несёт заголовок и описание',
  Boolean(done?.card_title) && Boolean(done?.card_description),
  done?.card_title,
)

const [asset] = await (
  await rest(`generation_assets?generation_id=eq.${started.body.generationId}&select=*`, seller.token)
).json()
check('FR-14 результат сохранён одним изображением', Boolean(asset))

const file = await downloadResult(seller.token, asset.storage_path)
const size = file ? pngSize(file.bytes) : null
// С M7 пользователю уходит не кадр вендора, а собранная карточка PNG — в размер сборки, который
// воркер берёт из профиля пары через `cardAssemblySize` (Q-2 шага B7.7): у Ozon × «Одежда и
// обувь» это порог площадки, а не целевой кадр 1792 × 2400.
const [clothingProfile] = await (
  await fetch(`${REST}/marketplace_output_profiles?marketplace_id=eq.ozon&category_id=eq.clothing&select=*`, {
    headers: { apikey: KEY },
  })
).json()
const cardSize = cardAssemblySize({
  width: clothingProfile.width,
  height: clothingProfile.height,
  minWidth: clothingProfile.min_width,
  minHeight: clothingProfile.min_height,
})
check(
  `FR-25 карточка соответствует профилю пары Ozon × «Одежда и обувь»: размер сборки ${cardSize.width} × ${cardSize.height}, PNG`,
  size?.width === cardSize.width && size?.height === cardSize.height && file?.type === 'image/png',
  `${size?.width} × ${size?.height}, ${file?.type}`,
)

const again = await downloadResult(seller.token, asset.storage_path)
check(
  'FR-17 повторное скачивание из каталога не списывает баллы',
  again !== null && (await balanceOf(seller.token)) === 65,
)

// --- FR-25 на исключении: Ozon Fresh показывает товар квадратом ---------------
const square = await launch(seller.token, {
  kind: 'photo',
  categoryId: 'food',
  presetId: 'food-studio',
  productTitle: 'Кофе в зёрнах',
})
const squareDone = await settle(seller.token, square.body.generationId)
const [squareAsset] = await (
  await rest(`generation_assets?generation_id=eq.${square.body.generationId}&select=*`, seller.token)
).json()
const squareFile = squareAsset ? await downloadResult(seller.token, squareAsset.storage_path) : null
const squareSize = squareFile ? jpegSize(squareFile.bytes) : null
check(
  'FR-25 исключение Ozon Fresh: «Еда и напитки» уходит квадратом 1024 × 1024',
  squareDone?.status === 'done' && squareSize?.width === 1024 && squareSize?.height === 1024,
  `${squareSize?.width} × ${squareSize?.height}`,
)

// --- US-E4: неуспех целиком ---------------------------------------------------
// Две удачные генерации подряд съели стартовые баллы, а впереди ещё два запуска по 55.
// Пополняемся тем же путём, что и пользователь (FR-23): иначе сценарий упрётся в US-E3
// и проверит совсем не то, что собирался.
const topped = await callFunction('topup', seller.token, {
  packageId: 'start',
  idempotencyKey: crypto.randomUUID(),
})
check('FR-23 пакет пополнения зачислен перед проверкой сбоев', topped.status === 200, JSON.stringify(topped.body))

const balanceBeforeFailure = await balanceOf(seller.token)
const broken = await launch(seller.token, { productTitle: 'СБОЙ Куртка-бомбер' })
const brokenDone = await settle(seller.token, broken.body.generationId)
check('US-E4 провайдер не ответил — генерация неуспешна', brokenDone?.status === 'failed', brokenDone?.status)
check(
  'FR-13 после неуспеха баланс равен балансу до запуска',
  (await balanceOf(seller.token)) === balanceBeforeFailure,
)
check('US-E4 пользователю показана понятная причина', Boolean(brokenDone?.failure_reason), brokenDone?.failure_reason)

// --- US-E4, отдельный случай: изображение есть, текстов карточки нет -----------
const balanceBeforeHalf = await balanceOf(seller.token)
const half = await launch(seller.token, { productTitle: 'СБОЙ-ТЕКСТЫ Куртка-бомбер' })
const halfDone = await settle(seller.token, half.body.generationId)
const halfAssets = await (
  await rest(`generation_assets?generation_id=eq.${half.body.generationId}&select=id`, seller.token)
).json()
check(
  'US-E4 «изображение есть, текстов нет» — это неуспех, а не половина результата',
  halfDone?.status === 'failed',
  halfDone?.status,
)
check('US-E4 возврат полный и в этом случае тоже', (await balanceOf(seller.token)) === balanceBeforeHalf)
check('US-E4 половина результата пользователю не отдана', halfAssets.length === 0)

const catalog = await (
  await rest('generations?select=id,status&status=eq.done&order=created_at.desc', seller.token)
).json()
check(
  'US-E4 неуспешные генерации не засоряют каталог как готовые',
  catalog.length === 2 && catalog.every((row) => row.status === 'done'),
  `в каталоге ${catalog.length}`,
)

// --- Модерация: тихий отказ до списания (решение шага 0 вехи M5) ---------------
const rejectedUpload = await uploadPhoto(seller, 'photo-moderation.jpg', moderationRejectedBytes())
const balanceBeforeModeration = await balanceOf(seller.token)
const catalogBeforeModeration = await (
  await rest('generations?select=id', seller.token)
).json()
const moderated = await launch(seller.token, { photoPaths: [rejectedUpload.path] })
check(
  'Модерация отклоняет заявку тем же по форме ответом, что и US-E3',
  moderated.status === 409 && moderated.body.code === 'moderation_rejected',
  JSON.stringify(moderated.body),
)
check(
  'Модерация: баллы не списаны',
  (await balanceOf(seller.token)) === balanceBeforeModeration,
)
const catalogAfterModeration = await (
  await rest('generations?select=id', seller.token)
).json()
check(
  'Модерация: заявка не создана вовсе, не только не оплачена',
  catalogAfterModeration.length === catalogBeforeModeration.length,
  `было ${catalogBeforeModeration.length}, стало ${catalogAfterModeration.length}`,
)

// --- US-E3: баллов не хватает --------------------------------------------------
const poor = await register(`poor.${stamp}@example.com`, password)
const drain = []
for (let attempt = 0; attempt < 2; attempt++) {
  const spent = await launch(poor.token, { kind: 'photo', presetId: 'clothing-studio' })
  drain.push(spent.status)
  if (spent.body.generationId) await settle(poor.token, spent.body.generationId)
}
const balanceBeforeRefusal = await balanceOf(poor.token)
const refused = await launch(poor.token)
check(
  'US-E3 заявка дороже баланса отклонена и баллов не тронула',
  refused.status === 409 && (await balanceOf(poor.token)) === balanceBeforeRefusal,
  `HTTP ${refused.status}, баланс ${balanceBeforeRefusal}, списания ${drain.join('/')}`,
)

// --- NFR-04: чужое не читается -------------------------------------------------
const neighbour = await (
  await rest(`generations?id=eq.${started.body.generationId}&select=id`, poor.token)
).json()
check('NFR-04 чужая генерация не читается по прямому идентификатору', neighbour.length === 0)

const stolen = await downloadResult(poor.token, asset.storage_path)
check('NFR-04 чужой файл результата не подписывается и не отдаётся', stolen === null)

// --- NFR-03: повторная доставка события статуса --------------------------------
const balanceBeforeReplay = await balanceOf(seller.token)
const replay = await fetch(`${FUNCTIONS}/generation-worker`, {
  method: 'POST',
  headers: { apikey: SECRET, Authorization: `Bearer ${WORKER_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ generationId: broken.body.generationId }),
})
check(
  'NFR-03 повторная доставка события не двигает баланс дважды',
  replay.status === 200 && (await balanceOf(seller.token)) === balanceBeforeReplay,
  `HTTP ${replay.status}`,
)

const outsider = await fetch(`${FUNCTIONS}/generation-worker`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${seller.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ generationId: started.body.generationId }),
})
check(
  'NFR-05 воркер не отзывается на токен пользователя: гонять провайдера за наш счёт нельзя',
  outsider.status === 401,
  `HTTP ${outsider.status}`,
)

// --- C3: сочинение карточки (ADR-0019, п. 6) -------------------------------------
// Выключатель — у функций, не у этого скрипта: `CARD_AUTHOR=on` передаётся обоим (функциям —
// файлом `--env-file`, скрипту — окружением), иначе проверяется только путь без сочинения.
// Заглушка провайдера сочиняет фикстуру B2 — кресло; у куртки из US-01 этих слов нет.
const cardOf = async (generationId) => {
  const rows = await (
    await fetch(`${REST}/generation_cards?generation_id=eq.${generationId}&select=origin,layout_id,layout`, {
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  ).json()
  return Array.isArray(rows) ? rows[0] : undefined
}
const jacketCard = await cardOf(started.body.generationId)

if (process.env.CARD_AUTHOR === 'on') {
  check(
    'C3 сочинение не словами продавца — откат: генерация done, снимок — макет библиотеки',
    done?.status === 'done' && jacketCard?.origin === 'library' && jacketCard?.layout?.id === jacketCard?.layout_id,
    `${done?.status} · ${jacketCard?.origin} · ${jacketCard?.layout?.id}`,
  )

  const author = await register(`author.${stamp}@example.com`, password)
  const authorPhoto = await uploadPhoto(author, 'photo-1.jpg')
  const chair = await launch(author.token, {
    categoryId: 'home',
    presetId: 'home-studio',
    productTitle: 'Кресло с ушами',
    productDescription: 'Кресло-крыло, обивка — три цветных блока, опоры — дерево.',
    productProperties: [
      { label: 'Тип товара', value: 'Кресло-крыло' },
      { label: 'Дизайн обивки', value: 'Три цветных блока' },
      { label: 'Материал опор', value: 'Дерево' },
    ],
    photoPaths: [authorPhoto.path],
  })
  const chairDone = await settle(author.token, chair.body.generationId)
  const chairCard = await cardOf(chair.body.generationId)
  check(
    'C3 сочинение словами продавца — карточка по транспилированному макету, origin = author',
    chairDone?.status === 'done' && chairCard?.origin === 'author' && chairCard?.layout?.id === 'html-author',
    `${chairDone?.status} · ${chairCard?.origin} · ${chairCard?.layout?.id} · генерация ${chair.body.generationId}`,
  )
  const [chairAsset] = await (
    await rest(`generation_assets?generation_id=eq.${chair.body.generationId}&select=*`, author.token)
  ).json()
  check('C3 карточка сочинения сохранена изображением', Boolean(chairAsset), chairAsset?.storage_path)

  // Посмотреть карточку глазами: `C3_PNG_OUT=<файл>` — сюда ляжет результат до уборки.
  if (process.env.C3_PNG_OUT && chairAsset) {
    const chairFile = await downloadResult(author.token, chairAsset.storage_path)
    if (chairFile) (await import('node:fs')).writeFileSync(process.env.C3_PNG_OUT, chairFile.bytes)
  }

  await fetch(`${API}/admin/users/${author.id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
} else {
  check(
    'C3 без CARD_AUTHOR=on снимок карточки — макет библиотеки',
    jacketCard?.origin === 'library' && jacketCard?.layout?.id === jacketCard?.layout_id,
    `${jacketCard?.origin} · ${jacketCard?.layout?.id}`,
  )
}

// --- уборка --------------------------------------------------------------------
for (const id of [seller.id, poor.id].filter(Boolean)) {
  await fetch(`${API}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length === 0 ? 0 : 1)
