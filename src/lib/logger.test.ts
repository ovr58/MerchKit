import { describe, expect, it } from 'vitest'

import { createLogger, type LogRecord } from '@/lib/logger'

function collectingLogger(minLevel: 'debug' | 'info' | 'warn' | 'error') {
  const records: LogRecord[] = []
  return { records, logger: createLogger({ minLevel, sink: (record) => records.push(record) }) }
}

describe('logger', () => {
  it('не пишет то, что ниже порога уровня', () => {
    const { records, logger } = collectingLogger('warn')

    logger.debug('отладка')
    logger.info('информация')
    logger.warn('предупреждение')
    logger.error('ошибка')

    expect(records.map((record) => record.level)).toEqual(['warn', 'error'])
  })

  it('вычищает секреты и персональные данные из контекста', () => {
    const { records, logger } = collectingLogger('debug')

    logger.info('вызов провайдера', {
      generationId: 'gen-42',
      apiKey: 'sk-aitunnel-секрет',
      email: 'user@example.com',
      durationMs: 1200,
    })

    expect(records[0]?.context).toEqual({
      generationId: 'gen-42',
      apiKey: '[скрыто]',
      email: '[скрыто]',
      durationMs: 1200,
    })
  })

  it('передаёт сообщение без контекста как есть', () => {
    const { records, logger } = collectingLogger('debug')

    logger.info('старт приложения')

    expect(records[0]).toEqual({ level: 'info', message: 'старт приложения', context: undefined })
  })
})
