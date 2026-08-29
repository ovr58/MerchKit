/**
 * Приёмочный стенд провайдера: прогон контрольной выборки через **боевой путь** продукта.
 *
 * Зачем через Edge Functions, а не вызовом модуля напрямую: проверять надо то, что увидит
 * пользователь. Между провайдером и результатом лежат профиль FR-25, сохранение в бакет и
 * переходы статуса — кандидат, красиво отвечающий в отладке и роняющий кадр по дороге,
 * продукту не годится. Заодно стенду не нужен Deno: он ходит по HTTP, как браузер.
 *
 * Кандидат переключается профилем провайдера в окружении Edge Functions, а не правкой кода
 * (docs/SPEC.md §5): стенд о вендоре не знает и знать не должен — иначе сравнение кандидатов
 * превратилось бы в сравнение веток стенда.
 *
 * Критерий узнаваемости, формат выборки и порядок сравнения — bench/README.md. Он же
 * единственный источник критерия: HTML-отчёт печатает его оттуда, чтобы формулировка,
 * зафиксированная до прогона, и формулировка перед глазами судьи не разъезжались.
 *
 * Запуск: `npm run bench -- --label <кандидат>` при поднятом `npx supabase start`.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const README = join(ROOT, 'bench', 'README.md')

/** NFR-01: распознавание укладывается в 5 с либо показывает честный индикатор. */
const RECOGNIZE_BUDGET_MS = 5000

/** Пакет пополнения на прогон: карточка стоит 55 баллов, 3000 хватает на всю выборку. */
const TOPUP_PACKAGE = 'pro'

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

/* ------------------------------------------------------------------------- аргументы */

function args(argv) {
  const parsed = { samples: join(ROOT, 'bench', 'samples'), only: null, label: null, out: null }

  for (let at = 0; at < argv.length; at += 2) {
    const key = argv[at]?.replace(/^--/, '')
    const value = argv[at + 1]
    if (key === 'only') parsed.only = new Set(value.split(',').map((id) => id.trim()))
    else if (key in parsed) parsed[key] = value
    else throw new Error(`Неизвестный аргумент: ${argv[at]}`)
  }

  // Без метки прогон не с чем сравнить, а вся ценность стенда — в сравнении кандидатов.
  if (!parsed.label) throw new Error('Не указан --label: имя кандидата в отчёте обязательно')
  return parsed
}

/* --------------------------------------------------------------- локальное окружение */

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

  if (!env.API_URL) throw new Error('Локальный Supabase не отвечает. Сначала `npx supabase start`.')
  return env
}

/* --------------------------------------------------------------------------- выборка */

function readSamples(dir, only) {
  if (!existsSync(dir)) throw new Error(`Каталог выборки не найден: ${dir}`)

  const samples = []
  for (const id of readdirSync(dir).sort()) {
    const path = join(dir, id)
    if (!statSync(path).isDirectory()) continue
    if (only && !only.has(id)) continue

    const manifest = join(path, 'sample.json')
    if (!existsSync(manifest)) {
      throw new Error(`В наборе ${id} нет sample.json (формат — bench/README.md)`)
    }

    const photos = readdirSync(path)
      .filter((name) => MIME[extname(name).toLowerCase()] !== undefined)
      .sort()
      .map((name) => join(path, name))

    if (photos.length === 0) throw new Error(`В наборе ${id} нет ни одного фото`)
    if (photos.length > 4) {
      throw new Error(`В наборе ${id} больше четырёх фото — FR-02 принимает до четырёх`)
    }

    samples.push({ id, dir: path, photos, ...JSON.parse(readFileSync(manifest, 'utf8')) })
  }

  if (samples.length === 0) {
    throw new Error(
      `Контрольная выборка пуста: ${dir}. Сравнивать кандидатов нечем — см. bench/samples/README.md`,
    )
  }
  return samples
}

/* -------------------------------------------------------------------------- Supabase */

const env = localEnv()
const API = `${env.API_URL}/auth/v1`
const REST = `${env.API_URL}/rest/v1`
const FUNCTIONS = `${env.API_URL}/functions/v1`
const STORAGE = `${env.API_URL}/storage/v1`
const MAIL = `${env.INBUCKET_URL}/api/v1`
const KEY = env.PUBLISHABLE_KEY ?? env.ANON_KEY

const rest = (path, token) =>
  fetch(`${REST}/${path}`, {
    headers: token ? { apikey: KEY, Authorization: `Bearer ${token}` } : { apikey: KEY },
  })

async function register() {
  const email = `bench.${Date.now()}@example.com`
  const password = 'password123'

  const created = await (
    await fetch(`${API}/signup`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  ).json()

  // Стартовые баллы приходят по подтверждению адреса (FR-19): без перехода по ссылке баланс
  // нулевой, и первая же заявка отлетит на US-E3 вместо прогона.
  const list = await (await fetch(`${MAIL}/messages?limit=50`)).json()
  const message = list.messages.find((m) => m.To.some((to) => to.Address === email))
  const full = message ? await (await fetch(`${MAIL}/message/${message.ID}`)).json() : null
  const link = (full?.Text || full?.HTML || '').match(/http:\/\/[^\s"<>]*verify[^\s"<>]*/)
  if (link) await fetch(link[0].replace(/&amp;/g, '&'), { redirect: 'manual' })

  const signedIn = await (
    await fetch(`${API}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  ).json()

  return { id: created.id ?? created.user?.id, token: signedIn.access_token }
}

async function topup(user) {
  const res = await fetch(`${FUNCTIONS}/topup`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ packageId: TOPUP_PACKAGE, idempotencyKey: crypto.randomUUID() }),
  })
  if (!res.ok) throw new Error(`Не удалось пополнить баланс стенда: HTTP ${res.status}`)
}

async function uploadPhoto(user, sampleId, file) {
  const path = `${user.id}/bench-${sampleId}-${basename(file)}`
  const res = await fetch(`${STORAGE}/object/uploads/${encodeURI(path)}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${user.token}`,
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: readFileSync(file),
  })
  if (!res.ok) throw new Error(`Фото ${file} не загрузилось: HTTP ${res.status}`)
  return path
}

/** Ждёт выхода из работы: генерация асинхронная, статус живёт в базе (SPEC §3, NFR-02). */
async function settle(token, generationId, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const rows = await (await rest(`generations?id=eq.${generationId}&select=*`, token)).json()
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (row && row.status !== 'queued' && row.status !== 'running') return row
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return null
}

async function download(token, storagePath) {
  const signed = await fetch(`${STORAGE}/object/sign/results/${encodeURI(storagePath)}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 120 }),
  })
  if (!signed.ok) return null

  const { signedURL } = await signed.json()
  const file = await fetch(`${STORAGE}${signedURL.replace(/^\/storage\/v1/, '')}`)
  if (!file.ok) return null
  return { bytes: Buffer.from(await file.arrayBuffer()), type: file.headers.get('content-type') }
}

/**
 * Размер изображения из заголовка файла. Читается своими глазами, а не тем кодом, который
 * файл написал: совпали два независимых чтения — значит профиль FR-25 действительно соблюдён.
 */
function imageSize(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          width: (bytes[at + 7] << 8) | bytes[at + 8],
          height: (bytes[at + 5] << 8) | bytes[at + 6],
          format: 'jpeg',
        }
      }
      if (marker === 0xda) return null
      at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3])
    }
    return null
  }

  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' }
  }
  return null
}

/**
 * Себестоимость рядом с `generationId` — шаг 4 вехи. Пока её там нет, стенд не выдумывает
 * колонок: он забирает то, что реально лежит в строке, и подхватит расход сам, как только
 * миграция шага 4 его туда положит.
 */
function costOf(row) {
  const found = {}
  for (const [key, value] of Object.entries(row ?? {})) {
    if (/cost|spend/i.test(key) && value !== null) found[key] = value
  }
  return Object.keys(found).length > 0 ? found : null
}

/* ---------------------------------------------------------------------------- прогон */

const options = args(process.argv.slice(2))
const samples = readSamples(options.samples, options.only)

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
const outDir = options.out ?? join(ROOT, 'bench', 'runs', `${options.label}-${stamp}`)
mkdirSync(join(outDir, 'in'), { recursive: true })
mkdirSync(join(outDir, 'out'), { recursive: true })

const categoryIds = new Set((await (await rest('categories?select=id')).json()).map((row) => row.id))
const profiles = await (await rest('marketplace_output_profiles?select=*')).json()

// Профиль пары ищется от частного к общему: у Ozon одежда и еда — исключения из его же
// умолчания (FR-25, справочник вехи M4).
const profileFor = (marketplaceId, categoryId) =>
  profiles.find((p) => p.marketplace_id === marketplaceId && p.category_id === categoryId) ??
  profiles.find((p) => p.marketplace_id === marketplaceId && p.category_id === null) ??
  null

const user = await register()
await topup(user)

const report = []

for (const sample of samples) {
  console.log(`— ${sample.id}`)

  const checks = []
  const check = (name, pass, detail = '') => checks.push({ name, pass, detail })
  const outputs = []

  // Копия входа ложится рядом с выходом: отчёт, в котором не видно, что подавали, судить
  // нечем — а выборка со временем правится.
  const inputs = sample.photos.map((file) => {
    const name = `${sample.id}-${basename(file)}`
    writeFileSync(join(outDir, 'in', name), readFileSync(file))
    return `in/${name}`
  })

  /* --- FR-03, FR-04: распознавание ------------------------------------------------ */

  const form = new FormData()
  for (const file of sample.photos) {
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    form.append('photo', new Blob([readFileSync(file)], { type }), basename(file))
  }

  // Распознавание идёт от имени пользователя стенда, а не гостем: у гостя лимит бесплатных
  // распознаваний в сутки (веха M5, шаг 5), и выборка из полутора десятков наборов упёрлась
  // бы в него на середине прогона. Качество распознавания от того, кто спрашивает, не зависит.
  const recognizeStarted = Date.now()
  const recognizeRes = await fetch(`${FUNCTIONS}/recognize`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${user.token}` },
    body: form,
  })
  const recognizeMs = Date.now() - recognizeStarted
  const recognized = await recognizeRes.json().catch(() => ({}))

  check(
    'ТЗ §5.1 категория из перечня или NULL',
    recognized.categoryId === null || categoryIds.has(recognized.categoryId),
    String(recognized.categoryId),
  )
  check(
    'FR-03 категория совпала с эталоном набора',
    recognized.categoryId === sample.categoryId,
    `получено ${recognized.categoryId}, ожидалось ${sample.categoryId}`,
  )
  check(
    'FR-04 наименование товара определено',
    typeof recognized.productTitle === 'string' && recognized.productTitle.trim() !== '',
    String(recognized.productTitle),
  )
  check('NFR-01 распознавание уложилось в 5 с', recognizeMs <= RECOGNIZE_BUDGET_MS, `${recognizeMs} мс`)

  /* --- US-01: генерация ------------------------------------------------------------ */

  const photoPaths = []
  for (const file of sample.photos) photoPaths.push(await uploadPhoto(user, sample.id, file))

  const generateStarted = Date.now()
  const started = await (
    await fetch(`${FUNCTIONS}/generate`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: sample.kind,
        marketplaceId: sample.marketplaceId,
        categoryId: sample.categoryId,
        presetId: sample.presetId ?? null,
        productTitle: sample.productTitle,
        productDescription: sample.productDescription ?? '',
        wishes: sample.wishes ?? '',
        photoPaths,
      }),
    })
  ).json().catch(() => ({}))

  let row = null
  let generateMs = null

  if (typeof started.generationId !== 'string') {
    check('US-01 заявка принята', false, JSON.stringify(started))
  } else {
    row = await settle(user.token, started.generationId)
    generateMs = Date.now() - generateStarted

    check(
      'US-01 генерация дошла до готового результата',
      row?.status === 'done',
      row?.failure_reason ?? row?.status ?? 'нет ответа',
    )
    check(
      'FR-16 у генерации есть осмысленное название',
      typeof row?.title === 'string' && row.title.trim() !== '' && !/^Генерация\s*№/i.test(row.title),
      row?.title ?? '—',
    )
    if (sample.kind === 'card') {
      check(
        'FR-07 карточка несёт заголовок и описание',
        Boolean(row?.card_title?.trim()) && Boolean(row?.card_description?.trim()),
        row?.card_title ?? '—',
      )
    }

    const assets = await (
      await rest(`generation_assets?generation_id=eq.${started.generationId}&select=*`, user.token)
    ).json()
    check('FR-14 результат сохранён изображением', Array.isArray(assets) && assets.length > 0)

    const profile = profileFor(sample.marketplaceId, sample.categoryId)
    for (const [index, asset] of (Array.isArray(assets) ? assets : []).entries()) {
      const file = await download(user.token, asset.storage_path)
      if (!file) {
        check(`FR-17 результат ${index + 1} скачивается`, false)
        continue
      }

      const name = `${sample.id}-${index + 1}${extname(asset.storage_path) || '.jpg'}`
      writeFileSync(join(outDir, 'out', name), file.bytes)

      const size = imageSize(file.bytes)
      outputs.push({ path: `out/${name}`, size, type: file.type })
      check(
        `FR-25 файл ${index + 1} совпал с профилем ${sample.marketplaceId} × ${sample.categoryId}`,
        Boolean(profile) &&
          size?.width === profile.width &&
          size?.height === profile.height &&
          size?.format === profile.format,
        `${size?.width} × ${size?.height} ${size?.format} против ${profile?.width} × ${profile?.height} ${profile?.format}`,
      )
    }
  }

  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }

  report.push({
    sample,
    recognized,
    recognizeMs,
    generateMs,
    row,
    inputs,
    outputs,
    checks,
    cost: costOf(row),
  })
}

/* ---------------------------------------------------------------------------- отчёты */

/** Критерий берётся из README, а не переписывается здесь: две копии формулировки разъедутся. */
function criterion() {
  const text = readFileSync(README, 'utf8')
  const from = text.indexOf('## Критерий узнаваемости')
  const to = text.indexOf('\n---', from)
  return from < 0 ? '(критерий не найден в bench/README.md)' : text.slice(from, to).trim()
}

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch],
  )

const failed = report.reduce((sum, item) => sum + item.checks.filter((c) => !c.pass).length, 0)

writeFileSync(
  join(outDir, 'report.json'),
  JSON.stringify(
    {
      label: options.label,
      startedAt: stamp,
      criterion: criterion(),
      samples: report.map((item) => ({
        id: item.sample.id,
        note: item.sample.note ?? '',
        expected: { categoryId: item.sample.categoryId, productTitle: item.sample.productTitle },
        recognized: item.recognized,
        recognizeMs: item.recognizeMs,
        generateMs: item.generateMs,
        status: item.row?.status ?? null,
        title: item.row?.title ?? null,
        cardTitle: item.row?.card_title ?? null,
        cardDescription: item.row?.card_description ?? null,
        cost: item.cost,
        inputs: item.inputs,
        outputs: item.outputs,
        checks: item.checks,
      })),
    },
    null,
    2,
  ),
)

writeFileSync(
  join(outDir, 'report.md'),
  [
    `# Прогон стенда — ${options.label}`,
    '',
    `Наборов: ${report.length} · машинных провалов: ${failed}`,
    '',
    '| Набор | Эталон | Распознано | recognize, мс | всего, мс | Машинные провалы | Узнаваемость |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.map((item) => {
      const fails = item.checks.filter((c) => !c.pass).map((c) => c.name).join('; ')
      return `| ${item.sample.id} | ${item.sample.categoryId} | ${item.recognized?.categoryId ?? '—'} / ${item.recognized?.productTitle ?? '—'} | ${item.recognizeMs} | ${item.generateMs ?? '—'} | ${fails || '—'} | _проставить глазами_ |`
    }),
    '',
    '> Узнаваемость — вердикт человека по критерию из `bench/README.md`; машинно она не проверяется.',
  ].join('\n'),
)

const sections = report
  .map(
    (item) => `<section class="sample" data-id="${esc(item.sample.id)}">
 <h2>${esc(item.sample.id)}${item.sample.note ? ` — ${esc(item.sample.note)}` : ''}</h2>
 <div class="row">
  <div class="col"><h3>Вход</h3>${item.inputs.map((src) => `<img src="${esc(src)}" alt="">`).join('')}</div>
  <div class="col"><h3>Выход</h3>${
    item.outputs.length > 0
      ? item.outputs.map((out) => `<img src="${esc(out.path)}" alt="">`).join('')
      : '<p class="fail">изображения нет</p>'
  }</div>
  <div class="col"><h3>Что вернул провайдер</h3>
   <dl>
    <dt>Категория</dt><dd>${esc(item.recognized?.categoryId ?? '—')} <small>эталон ${esc(item.sample.categoryId)}</small></dd>
    <dt>Наименование</dt><dd>${esc(item.recognized?.productTitle ?? '—')} <small>эталон ${esc(item.sample.productTitle)}</small></dd>
    <dt>Название генерации</dt><dd>${esc(item.row?.title ?? '—')}</dd>
    ${item.row?.card_title ? `<dt>Заголовок карточки</dt><dd>${esc(item.row.card_title)}</dd>` : ''}
    ${item.row?.card_description ? `<dt>Описание</dt><dd>${esc(item.row.card_description)}</dd>` : ''}
    <dt>Длительность</dt><dd>recognize ${item.recognizeMs} мс · всего ${item.generateMs ?? '—'} мс</dd>
    <dt>Себестоимость</dt><dd>${item.cost ? esc(JSON.stringify(item.cost)) : 'нет в БД (шаг 4 вехи)'}</dd>
   </dl>
   <ul class="checks">${item.checks
     .map(
       (c) =>
         `<li class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'} ${esc(c.name)}${c.detail ? ` — ${esc(c.detail)}` : ''}</li>`,
     )
     .join('')}</ul>
  </div>
 </div>
 <div class="verdict">
  <label><input type="radio" name="v-${esc(item.sample.id)}" value="узнаваем"> узнаваем</label>
  <label><input type="radio" name="v-${esc(item.sample.id)}" value="не узнаваем"> не узнаваем</label>
  <input type="text" name="n-${esc(item.sample.id)}" placeholder="чем именно не тот предмет" size="52">
 </div>
</section>`,
  )
  .join('\n')

writeFileSync(
  join(outDir, 'report.html'),
  `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Стенд — ${esc(options.label)}</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#fafafa;color:#18181b}
 h1{margin:0 0 4px}
 .meta{color:#71717a;margin:0 0 20px}
 .criterion,.sample{background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:16px 20px;margin-bottom:16px}
 .criterion{white-space:pre-wrap;margin-bottom:24px}
 .row{display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}
 .col{flex:1 1 320px;min-width:280px}
 .col h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#71717a}
 img{max-width:100%;border-radius:6px;border:1px solid #e4e4e7;display:block;margin-bottom:8px}
 .checks{margin:12px 0 0;padding:0;list-style:none;font-size:13px}
 .pass{color:#15803d}
 .fail{color:#b91c1c;font-weight:600}
 .verdict{margin-top:12px;padding-top:12px;border-top:1px solid #e4e4e7;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
 dl{margin:0;font-size:14px} dt{color:#71717a;font-size:12px;margin-top:8px} dd{margin:0}
 small{color:#a1a1aa}
 textarea{width:100%;min-height:140px;font:13px/1.4 ui-monospace,monospace;margin-top:8px}
</style>
<h1>Приёмочный стенд — ${esc(options.label)}</h1>
<p class="meta">Наборов: ${report.length} · машинных провалов: ${failed} · прогон ${esc(stamp)}</p>
<div class="criterion">${esc(criterion())}</div>
${sections}
<h2>Вердикты</h2>
<p>Проставленное глазами собирается сюда, отсюда уходит в ADR-0006. Сохраняется в браузере.</p>
<button id="collect">Собрать</button>
<textarea id="out"></textarea>
<script>
 const KEY = 'bench:' + ${JSON.stringify(`${options.label}-${stamp}`)};
 let state = {};
 try { state = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { state = {} }

 for (const el of document.querySelectorAll('.verdict input')) {
   const saved = state[el.name];
   if (saved !== undefined) {
     if (el.type === 'radio') el.checked = el.value === saved;
     else el.value = saved;
   }
   el.addEventListener('input', () => {
     state[el.name] = el.value;
     try { localStorage.setItem(KEY, JSON.stringify(state)) } catch {}
   });
 }

 document.getElementById('collect').addEventListener('click', () => {
   const rows = [...document.querySelectorAll('section.sample')].map((s) => ({
     id: s.dataset.id,
     verdict: s.querySelector('input[type=radio]:checked')?.value ?? null,
     note: s.querySelector('input[type=text]').value,
   }));
   document.getElementById('out').value =
     JSON.stringify({ label: ${JSON.stringify(options.label)}, verdicts: rows }, null, 2);
 });
</script>
</html>`,
)

console.log(`\nОтчёт: ${relative(ROOT, outDir)}`)
console.log(`Машинных провалов: ${failed}. Узнаваемость проставляется глазами в report.html.`)
