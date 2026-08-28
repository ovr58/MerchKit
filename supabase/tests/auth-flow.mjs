/**
 * Сквозная проверка сценариев аккаунта против **живого** локального Supabase.
 *
 * Зачем отдельно от `npm test`: критерии US-02 и US-03 — про письма, ссылки из них и
 * поведение Auth, а не про код приложения. На моках такое проверять бессмысленно: мок
 * подтвердит только то, что мы сами в него записали. Скрипт ходит теми же вызовами, что и
 * модуль `auth`, и достаёт письма из локального почтового ящика.
 *
 * Запуск: `npm run test:flow` при поднятом `supabase start`.
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
const MAIL = `${env.INBUCKET_URL}/api/v1`
const KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY
const SECRET = env.SECRET_KEY ?? env.SERVICE_ROLE_KEY

/** Адреса возврата обязаны совпадать с `additional_redirect_urls` в `config.toml`. */
const CONFIRM_RETURN = 'http://localhost:5173/auth/callback'
const RECOVER_RETURN = 'http://localhost:5173/reset/new'

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

async function lastVerifyLinkFor(address) {
  const list = await (await fetch(`${MAIL}/messages?limit=50`)).json()
  const message = list.messages.find((m) => m.To.some((to) => to.Address === address))
  if (!message) return null
  const full = await (await fetch(`${MAIL}/message/${message.ID}`)).json()
  const found = (full.Text || full.HTML || '').match(/http:\/\/[^\s"<>]*verify[^\s"<>]*/)
  return found ? found[0].replace(/&amp;/g, '&') : null
}

const stamp = Date.now()
const user = `flow-${stamp}@example.com`
const stranger = `nobody-${stamp}@example.com`
const other = `other-${stamp}@example.com`
const password = 'password123'
const newPassword = 'password456'
const signupPath = `/signup?redirect_to=${encodeURIComponent(CONFIRM_RETURN)}`

// --- US-02: регистрация и подтверждение -------------------------------------
const signup = await auth(signupPath, { email: user, password })
check('US-02 регистрация не выдаёт сессию до подтверждения', signup.body.access_token == null)
check('US-02 письмо подтверждения отправлено', signup.body.confirmation_sent_at != null)

const beforeConfirm = await auth('/token?grant_type=password', { email: user, password })
check(
  'US-02 вход до подтверждения отклонён (ADR-0008)',
  beforeConfirm.status === 400 && beforeConfirm.body.error_code === 'email_not_confirmed',
  beforeConfirm.body.error_code,
)

const duplicate = await auth(signupPath, { email: user, password })
check(
  'US-02 повторная регистрация не заводит второй аккаунт',
  duplicate.body.error_code === 'over_email_send_rate_limit' ||
    duplicate.body.identities?.length === 0,
  duplicate.body.error_code ?? 'identities=[]',
)

const confirmLink = await lastVerifyLinkFor(user)
check('US-02 ссылка подтверждения нашлась в письме', confirmLink != null)

const confirmed = await fetch(confirmLink, { redirect: 'manual' })
const confirmRedirect = confirmed.headers.get('location') ?? ''
check(
  'US-02 ссылка ведёт на /auth/callback с токенами',
  confirmRedirect.startsWith(CONFIRM_RETURN) && confirmRedirect.includes('access_token'),
  confirmRedirect.slice(0, 55),
)

// --- US-03: вход ------------------------------------------------------------
const signedIn = await auth('/token?grant_type=password', { email: user, password })
check('US-03 вход после подтверждения выполняется', signedIn.body.access_token != null)

const wrongPassword = await auth('/token?grant_type=password', { email: user, password: 'nope12345' })
check('US-03 неверная пара не пускает', wrongPassword.status === 400)

const profile = await (await rest('profiles?select=balance', signedIn.body.access_token)).json()
check(
  'M3 профиль заведён триггером, подтверждение начислило 120 (FR-19)',
  profile.length === 1 && profile[0].balance === 120,
  JSON.stringify(profile),
)

// --- US-E7: нейтральный ответ ------------------------------------------------
const recoverPath = `/recover?redirect_to=${encodeURIComponent(RECOVER_RETURN)}`
const forKnown = await auth(recoverPath, { email: user })
const forUnknown = await auth(recoverPath, { email: stranger })
check(
  'US-E7 ответ одинаков для существующего и несуществующего адреса',
  forKnown.status === forUnknown.status &&
    JSON.stringify(forKnown.body) === JSON.stringify(forUnknown.body),
  `${forKnown.status} vs ${forUnknown.status}`,
)

// --- US-03: смена пароля по ссылке ------------------------------------------
const recoverLink = await lastVerifyLinkFor(user)
const recovered = await fetch(recoverLink, { redirect: 'manual' })
const recoverRedirect = recovered.headers.get('location') ?? ''
check(
  'US-03 ссылка восстановления ведёт на /reset/new',
  recoverRedirect.startsWith(RECOVER_RETURN),
  recoverRedirect.slice(0, 55),
)

const recoveryToken = new URLSearchParams(recoverRedirect.split('#')[1] ?? '').get('access_token')
const updated = await fetch(`${API}/user`, {
  method: 'PUT',
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${recoveryToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ password: newPassword }),
})
check('US-03 пароль сменён по ссылке', updated.status === 200, `HTTP ${updated.status}`)

const oldPair = await auth('/token?grant_type=password', { email: user, password })
check('US-03 старый пароль перестал работать', oldPair.status === 400)

const newPair = await auth('/token?grant_type=password', { email: user, password: newPassword })
check('US-03 новый пароль работает', newPair.body.access_token != null)

// --- NFR-04: изоляция через публичный API, а не только в pgTAP ---------------
const strangerSignup = await auth(signupPath, { email: other, password })
const strangerId = strangerSignup.body.id ?? strangerSignup.body.user?.id
const foreign = await (
  await rest(`profiles?select=balance&id=eq.${strangerId}`, newPair.body.access_token)
).json()
check('NFR-04 чужой профиль через API пуст', Array.isArray(foreign) && foreign.length === 0)

const anonymous = await (await rest('profiles?select=balance', KEY)).json()
check('NFR-04 анониму профили недоступны', !Array.isArray(anonymous) || anonymous.length === 0)

// --- уборка ------------------------------------------------------------------
for (const id of [newPair.body.user?.id, strangerId].filter(Boolean)) {
  await fetch(`${API}/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  })
}

const failed = results.filter((result) => !result.pass)
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`)
process.exit(failed.length === 0 ? 0 : 1)
