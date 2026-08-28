/**
 * Сквозная проверка баллов против **живого** локального Supabase: подтверждение email,
 * пакеты пополнения, удаление аккаунта.
 *
 * Зачем отдельно от `npm run test:db`: pgTAP проверяет базу, а здесь проверяется путь
 * целиком — GoTrue, Edge Functions, PostgREST и RLS вместе. Накрутка через плюс-адресацию
 * была найдена на стейдже именно так: регистрацией, а не запросом в таблицу.
 *
 * Запуск: `npm run test:billing` при поднятом `supabase start`
 * и запущенном `supabase functions serve`.
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
const MAIL = `${env.INBUCKET_URL}/api/v1`
const KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY
const SECRET = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

const CONFIRM_RETURN = 'http://localhost:5173/auth/callback'

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

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
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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

const signupPath = `/signup?redirect_to=${encodeURIComponent(CONFIRM_RETURN)}`

/** Регистрация с подтверждением по ссылке из письма — ровно то, что делает человек. */
async function register(email, password) {
  const created = await auth(signupPath, { email, password })
  const link = await lastVerifyLinkFor(email)
  if (link) await fetch(link, { redirect: 'manual' })
  const signedIn = await auth('/token?grant_type=password', { email, password })
  return {
    id: created.body.id ?? created.body.user?.id,
    token: signedIn.body.access_token,
  }
}

/** Сколько строк журнала осталось без владельца. Виден такой счёт только service-role. */
const orphanedRows = async () => {
  const rows = await (
    await fetch(`${REST}/ledger?select=id&user_id=is.null`, {
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
    })
  ).json()
  return Array.isArray(rows) ? rows.length : -1
}

const balanceOf = async (token) => {
  const rows = await (await rest('profiles?select=balance', token)).json()
  return Array.isArray(rows) && rows.length === 1 ? rows[0].balance : null
}

const stamp = Date.now()
const password = 'password123'

// --- FR-19: стартовые баллы за подтверждение email ---------------------------
// Локальная почта Supabase режет письма лимитом в час, поэтому все адреса — разные ящики.
const mailbox = `seller.${stamp}`
const first = await register(`${mailbox}@gmail.com`, password)

check('FR-19 подтверждение email начислило 120 баллов', (await balanceOf(first.token)) === 120)

const history = await (
  await rest('ledger?select=kind,delta,balance_after&order=id', first.token)
).json()
check(
  'US-05 операция видна в истории баланса',
  history.length === 1 && history[0].kind === 'signup_bonus' && history[0].delta === 120,
  JSON.stringify(history),
)

// --- Накрутка, найденная на стейдже 2026-08-28 -------------------------------
// Тот же ящик, записанный иначе: точки в локальной части и «+хвост» Gmail игнорирует.
const twin = await register(`${mailbox.replace('.', '')}+promo@googlemail.com`, password)
check(
  'Плюс-адресация того же ящика второй раз 120 баллов не даёт',
  (await balanceOf(twin.token)) === 0,
)

// --- NFR-05: клиент не двигает баланс ----------------------------------------
const forgedBalance = await fetch(`${REST}/profiles?id=eq.${first.id}`, {
  method: 'PATCH',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${first.token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  body: JSON.stringify({ balance: 100000 }),
})
check(
  'NFR-05 клиентская попытка изменить баланс отклонена базой',
  forgedBalance.status >= 400 || (await balanceOf(first.token)) === 120,
  `HTTP ${forgedBalance.status}`,
)

const forgedLedger = await fetch(`${REST}/ledger`, {
  method: 'POST',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${first.token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    user_id: first.id,
    delta: 100000,
    kind: 'topup',
    idempotency_key: `forged-${stamp}`,
    balance_after: 100000,
  }),
})
check('NFR-05 клиент не может дописать строку в журнал', forgedLedger.status >= 400,
  `HTTP ${forgedLedger.status}`)

// --- FR-23 / US-05: пакеты пополнения ----------------------------------------
const packages = await (
  await rest('credit_packages?select=id,credits,price_rub&order=sort_order', first.token)
).json()
check(
  'FR-23 справочник пакетов доступен на чтение',
  packages.length === 3 && packages[0].credits === 300,
  JSON.stringify(packages),
)

const attempt = crypto.randomUUID()
const topUp = await callFunction('topup', first.token, {
  packageId: 'standard',
  idempotencyKey: attempt,
})
check(
  'FR-23 пакет зачислен мгновенно и без шага оплаты',
  topUp.status === 200 && topUp.body.balance === 1120,
  JSON.stringify(topUp.body),
)

const doubleClick = await callFunction('topup', first.token, {
  packageId: 'standard',
  idempotencyKey: attempt,
})
check(
  'NFR-03 двойной клик по кнопке пакета не зачисляет дважды',
  doubleClick.body.balance === 1120 && (await balanceOf(first.token)) === 1120,
  JSON.stringify(doubleClick.body),
)

// Второй клик по той же кнопке приходит со СВОИМ ключом попытки — клиент ротирует ключ
// после успеха. Именно так пакет зачислялся дважды до правки 2026-08-28.
const secondClick = await callFunction('topup', first.token, {
  packageId: 'standard',
  idempotencyKey: crypto.randomUUID(),
})
check(
  'Очередь кликов с разными ключами попытки не зачисляет пакет дважды',
  secondClick.body.balance === 1120 && (await balanceOf(first.token)) === 1120,
  JSON.stringify(secondClick.body),
)

const unknownPackage = await callFunction('topup', first.token, {
  packageId: 'unlimited',
  idempotencyKey: crypto.randomUUID(),
})
check('FR-23 несуществующий пакет отклонён', unknownPackage.status === 400)

const withoutToken = await fetch(`${FUNCTIONS}/topup`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ packageId: 'pro', idempotencyKey: crypto.randomUUID() }),
})
check(
  'NFR-05 пополнение без токена пользователя отклонено',
  withoutToken.status === 401,
  `HTTP ${withoutToken.status}`,
)

// --- Удаление аккаунта (152-ФЗ) и судьба журнала (ADR-0009) ------------------
// Удаляется тот аккаунт, у которого записи в журнале ЕСТЬ: у второго их нет, и проверять
// на нём «строка пережила удаление» было бы проверкой ни о чём.
const orphanedBefore = await orphanedRows()
const ownRows = await (await rest('ledger?select=id', first.token)).json()

const deleted = await callFunction('delete-account', first.token)
check('Удаление аккаунта выполняется самим пользователем', deleted.status === 200)

const gone = await auth('/token?grant_type=password', { email: `${mailbox}@gmail.com`, password })
check('После удаления вход невозможен', gone.status === 400, `HTTP ${gone.status}`)

const orphanedAfter = await orphanedRows()
check(
  'ADR-0009 строки журнала пережили удаление обезличенными, а не исчезли',
  ownRows.length === 2 && orphanedAfter === orphanedBefore + ownRows.length,
  `${orphanedBefore} → ${orphanedAfter} при ${ownRows.length} строках удалённого`,
)

// --- уборка ------------------------------------------------------------------
for (const id of [twin.id].filter(Boolean)) {
  await fetch(`${API}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length === 0 ? 0 : 1)
