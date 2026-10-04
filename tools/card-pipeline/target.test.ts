import { describe, expect, it } from 'vitest'

import { connection, parseTarget, parseStatusEnv } from './target.ts'

const localStatus = () => ({ API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'local-service', SECRET_KEY: 'local-secret' })
const neverLocal = () => {
  throw new Error('supabase status не должен вызываться')
}
const stagingEnv = {
  VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'staging-service',
}

describe('цель скриптов card-pipeline: выбор источника адреса и ключа', () => {
  it('без флага берёт локальный стенд, переменные окружения не читает', () => {
    const parsed = parseTarget(['push'])
    expect(parsed).toEqual({ target: 'local', args: ['push'] })
    expect(connection(parsed.target, stagingEnv, localStatus)).toEqual({
      url: 'http://127.0.0.1:54321',
      secret: 'local-secret',
    })
  })

  it('локальный ключ — SECRET_KEY, а при его отсутствии SERVICE_ROLE_KEY', () => {
    const read = () => ({ API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'local-service' })
    expect(connection('local', {}, read).secret).toBe('local-service')
  })

  it('--target staging берёт адрес и ключ из окружения, supabase status не трогает', () => {
    const parsed = parseTarget(['push', '--target', 'staging'])
    expect(parsed).toEqual({ target: 'staging', args: ['push'] })
    expect(connection(parsed.target, stagingEnv, neverLocal)).toEqual({
      url: 'https://abcdefgh.supabase.co',
      secret: 'staging-service',
    })
  })

  it('понимает форму --target=staging и флаг до команды', () => {
    expect(parseTarget(['--target=staging', 'pull'])).toEqual({ target: 'staging', args: ['pull'] })
  })

  it('отвергает неизвестную цель и флаг без значения', () => {
    expect(() => parseTarget(['--target', 'prod'])).toThrow(/staging/)
    expect(() => parseTarget(['--target'])).toThrow(/staging/)
  })

  it('на стейдже без переменных называет, какой не хватает', () => {
    expect(() => connection('staging', { SUPABASE_SERVICE_ROLE_KEY: 'k' }, neverLocal)).toThrow(/VITE_SUPABASE_URL/)
    expect(() => connection('staging', { VITE_SUPABASE_URL: 'https://a.supabase.co' }, neverLocal)).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    )
  })

  it('не пускает «стейдж» на локальный адрес: .env разработчика может смотреть на свой стенд', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://0.0.0.0:54321']) {
      expect(() => connection('staging', { ...stagingEnv, VITE_SUPABASE_URL: url }, neverLocal)).toThrow(/локальн/)
    }
  })

  it('разбор вывода supabase status: строки KEY="value", лишнее пропускается', () => {
    expect(parseStatusEnv('API_URL="http://x"\nsome noise\nSECRET_KEY="s"\n')).toEqual({ API_URL: 'http://x', SECRET_KEY: 's' })
  })

  it('локальный стенд не отвечает — прежнее сообщение', () => {
    expect(() => connection('local', {}, () => ({}))).toThrow('Локальный Supabase не отвечает. Сначала `supabase start`.')
  })
})
