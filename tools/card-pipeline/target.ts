/**
 * Цель скриптов `card-pipeline`, которым нужна база: локальный стенд или стейдж.
 *
 * Без флага — как раньше: адрес и ключ из `supabase status`. С `--target staging` — из
 * переменных окружения (`node --env-file=.env …`): `VITE_SUPABASE_URL` и
 * `SUPABASE_SERVICE_ROLE_KEY`, имена — из `.env.example`. Значения в репозитории не лежат.
 */

import { execFileSync } from 'node:child_process'

export type Target = 'local' | 'staging'
export type Connection = { url: string; secret: string }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]'])

export function parseStatusEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = line.match(/^([A-Z_0-9]+)="(.*)"$/)
    if (match) env[match[1]] = match[2]
  }
  return env
}

function supabaseStatus(): Record<string, string> {
  return parseStatusEnv(
    execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }),
  )
}

/** Вынимает `--target <цель>` / `--target=<цель>` из аргументов; остальное отдаёт как есть. */
export function parseTarget(argv: string[]): { target: Target; args: string[] } {
  const args: string[] = []
  let target: Target = 'local'
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg !== '--target' && !arg.startsWith('--target=')) {
      args.push(arg)
      continue
    }
    const value = arg === '--target' ? argv[++i] : arg.slice('--target='.length)
    if (value !== 'staging') throw new Error(`Цель «${value ?? ''}» неизвестна. Есть одна: --target staging.`)
    target = 'staging'
  }
  return { target, args }
}

export function connection(
  target: Target,
  env: Record<string, string | undefined>,
  readStatus: () => Record<string, string> = supabaseStatus,
): Connection {
  if (target === 'local') {
    const status = readStatus()
    if (status.API_URL === undefined) throw new Error('Локальный Supabase не отвечает. Сначала `supabase start`.')
    return { url: status.API_URL, secret: (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string }
  }

  for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[name]) throw new Error(`Для --target staging нужна переменная ${name}. Запускайте через \`node --env-file=.env\`.`)
  }
  const url = (env.VITE_SUPABASE_URL as string).replace(/\/+$/, '')
  if (LOCAL_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`VITE_SUPABASE_URL указывает на локальный адрес (${url}), а цель — стейдж. Отказ.`)
  }
  return { url, secret: env.SUPABASE_SERVICE_ROLE_KEY as string }
}

/** Единая точка входа скриптов: цель из `process.argv`, подключение, остаток аргументов. */
export function connect(): Connection & { args: string[] } {
  const { target, args } = parseTarget(process.argv.slice(2))
  const result = connection(target, process.env)
  if (target === 'staging') console.log(`цель: стейдж, ${new URL(result.url).host}`)
  return { ...result, args }
}
