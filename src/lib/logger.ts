/**
 * Логгер проекта (NFR-10). Единственное место, откуда приложение пишет в вывод:
 * `console.*` в остальном коде запрещён каноном.
 *
 * Что он даёт сверх `console`:
 *   - порог уровня: в проде `debug` и `info` не пишутся;
 *   - структурный контекст рядом с сообщением — сюда позже ляжет `generationId`;
 *   - вычистка секретов и персональных данных перед выводом.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

export type LogRecord = {
  level: LogLevel
  message: string
  context?: LogContext
}

export type LogSink = (record: LogRecord) => void

export type Logger = {
  debug: (message: string, context?: LogContext) => void
  info: (message: string, context?: LogContext) => void
  warn: (message: string, context?: LogContext) => void
  error: (message: string, context?: LogContext) => void
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** Ключи, значения которых не попадают в вывод ни при каких условиях. */
const REDACTED_KEY = /token|key|secret|password|authorization|email|phone/i

const REDACTED = '[скрыто]'

function redact(context: LogContext): LogContext {
  const safe: LogContext = {}
  for (const [key, value] of Object.entries(context)) {
    safe[key] = REDACTED_KEY.test(key) ? REDACTED : value
  }
  return safe
}

const consoleSink: LogSink = ({ level, message, context }) => {
  // Единственное место в клиентском коде, где вызывается console.
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  if (context) {
    write(message, context)
  } else {
    write(message)
  }
}

export function createLogger(options: { minLevel: LogLevel; sink?: LogSink }): Logger {
  const sink = options.sink ?? consoleSink
  const threshold = LEVEL_ORDER[options.minLevel]

  const log =
    (level: LogLevel) =>
    (message: string, context?: LogContext): void => {
      if (LEVEL_ORDER[level] < threshold) return
      sink({ level, message, context: context && redact(context) })
    }

  return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') }
}

export const logger: Logger = createLogger({
  minLevel: import.meta.env.PROD ? 'warn' : 'debug',
})
