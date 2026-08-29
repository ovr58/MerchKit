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
  'FR-12 справочники читаются гостем: мастер проходится без входа',
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

// --- FR-03/FR-04: распознавание работает и до входа ---------------------------
const form = new FormData()
form.append('photo', new Blob([photoBytes()], { type: 'image/jpeg' }), 'photo-1.jpg')
const recognized = await fetch(`${FUNCTIONS}/recognize`, {
  method: 'POST',
  headers: { apikey: KEY },
  body: form,
})
const recognizedBody = await recognized.json().catch(() => ({}))
check(
  'FR-03 распознавание отвечает гостю категорией из справочника',
  recognized.status === 200 && typeof recognizedBody.categoryId === 'string',
  JSON.stringify(recognizedBody),
)

const tiny = new FormData()
tiny.append('photo', new Blob([Buffer.alloc(64)], { type: 'image/jpeg' }), 'photo-1.jpg')
const unrecognized = await (
  await fetch(`${FUNCTIONS}/recognize`, { method: 'POST', headers: { apikey: KEY }, body: tiny })
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
const size = file ? jpegSize(file.bytes) : null
check(
  // Числа сменились на M5: профиль описан порогом площадки и целевым кадром, достижимым
  // бакетом вендора. У пары Ozon × «Одежда и обувь» порог 900 × 1200, а бакет 1K даёт
  // 896 × 1200 — на четыре пикселя ниже, поэтому здесь остаётся 2K (миграция 20260829140000).
  'FR-25 файл соответствует профилю пары Ozon × «Одежда и обувь»: 3 : 4, 1792 × 2400, JPEG',
  size?.width === 1792 && size?.height === 2400 && file?.type === 'image/jpeg',
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
