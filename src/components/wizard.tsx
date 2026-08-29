import type { OutputProfile } from '@/features/taxonomy'
import { useEffect, useState, type ReactNode } from 'react'

import { AlertTriangleIcon, CheckIcon, CloseIcon, SparkIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Блоки мастера генерации по артбордам захода D2 (V-08, вторая страница канваса).
 *
 * Здесь только вёрстка и разметка доступности; данные и переходы живут в экранах и в
 * модуле `generation-wizard`. Расхождение с артбордом — дефект вёрстки, а не «дизайн
 * поменялся» (сквозное правило генплана).
 */

/* ------------------------------------------------------------------------- степпер */

export function Stepper({
  current,
  labels,
  onGoTo,
  values,
}: {
  current: number
  labels: readonly string[]
  onGoTo: (step: number) => void
  values: (string | null)[]
}) {
  return (
    <>
      {/* Десктоп: горизонтальная лента шагов. */}
      <ol className="hidden items-center gap-1 sm:flex">
        {labels.map((label, index) => {
          const done = index < current
          const active = index === current

          return (
            <li className="flex flex-1 items-center gap-1" key={label}>
              <button
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex min-h-9 flex-1 items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
                  active ? 'text-foreground font-medium' : 'text-muted-foreground',
                  done && 'hover:bg-muted',
                )}
                disabled={index > current}
                onClick={() => onGoTo(index)}
                type="button"
              >
                <span
                  className={cn(
                    'flex size-6 flex-none items-center justify-center rounded-full border text-xs font-semibold',
                    done && 'bg-primary text-primary-foreground border-primary',
                    active && 'border-primary text-primary border-2',
                    !done && !active && 'bg-muted border-border text-muted-foreground',
                  )}
                >
                  {done ? <CheckIcon className="size-3" /> : index + 1}
                </span>
                <span className="truncate">{label}</span>
              </button>
              {index < labels.length - 1 && (
                <span aria-hidden="true" className="bg-border h-px w-3 flex-none" />
              )}
            </li>
          )
        })}
      </ol>

      {/* Мобильный (NFR-09): вертикальный степпер — пройденные шаги свёрнуты в строку
          с выбранным значением, текущий раскрыт содержимым панели. */}
      <ol className="flex flex-col gap-2 sm:hidden">
        {labels.map((label, index) => {
          if (index > current) return null
          const done = index < current

          return (
            <li key={label}>
              {done ? (
                <button
                  className="border-border bg-background flex min-h-12 w-full items-center gap-3 rounded-lg border px-3.5 text-left"
                  onClick={() => onGoTo(index)}
                  type="button"
                >
                  <span className="bg-primary text-primary-foreground flex size-6 flex-none items-center justify-center rounded-full">
                    <CheckIcon className="size-3" />
                  </span>
                  <span className="flex-1 text-sm">{label}</span>
                  <span className="text-muted-foreground truncate text-[13px]">
                    {values[index] ?? ''}
                  </span>
                </button>
              ) : (
                <div className="flex min-h-12 items-center gap-3 px-1">
                  <span className="border-primary text-primary flex size-6 flex-none items-center justify-center rounded-full border-2 text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="flex-1 text-[15px] font-semibold">{label}</span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </>
  )
}

/* ------------------------------------------------------------------- сообщения и метки */

export function Notice({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'info' | 'error' | 'success'
}) {
  const styles = {
    info: 'bg-muted border-border text-muted-foreground',
    error: 'bg-danger-surface border-danger-border text-danger-foreground',
    success: 'bg-success-surface border-success-border text-success-foreground',
  }[tone]

  return (
    <div
      className={cn('flex gap-2.5 rounded-md border p-3 text-[13px] leading-[18px]', styles)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'error' && <AlertTriangleIcon className="mt-px size-[18px] flex-none" />}
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

export function AiBadge() {
  return (
    <span className="bg-muted text-muted-foreground border-border flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
      <SparkIcon className="size-3" />
      ИИ
    </span>
  )
}

export function StatusPill({ tone, children }: { tone: 'neutral' | 'success'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        tone === 'success'
          ? 'bg-success-surface border-success-border text-success-foreground'
          : 'bg-muted border-border text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------------- выбор карточкой */

export function ChoiceCard({
  aside,
  children,
  description,
  onSelect,
  selected,
  title,
}: {
  aside?: ReactNode
  children?: ReactNode
  description: string
  onSelect: () => void
  selected: boolean
  title: string
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        'flex flex-1 flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
        'focus-visible:ring-ring/50 focus-visible:border-ring outline-none focus-visible:ring-[3px]',
        selected ? 'border-primary bg-success-surface border-2' : 'border-border bg-background hover:bg-muted',
      )}
      onClick={onSelect}
      type="button"
    >
      {children}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[15px] font-medium">{title}</span>
        {aside}
      </div>
      <span className="text-muted-foreground text-[13px] leading-[18px]">{description}</span>
    </button>
  )
}

/* --------------------------------------------------- параметры конечного файла (FR-25) */

/**
 * Параметры конечного изображения для выбранной пары.
 *
 * **Это приёмочный критерий вехи, а не подсказка** (FR-25): человек обязан увидеть кадр,
 * разрешение, формат и фон ДО того, как с него спишут баллы. Изображение, не прошедшее
 * модерацию площадки, бесполезно — продавец заплатил за файл, который некуда загрузить.
 */
export function OutputParams({ note, profile }: { note?: string; profile: OutputProfile }) {
  const rows: [string, ReactNode][] = [
    ['Кадр', profile.aspectLabel],
    ['Размер', `${profile.width} × ${profile.height}`],
    ['Формат', `${profile.format.toUpperCase()}, ${profile.colorSpace}`],
    [
      'Фон',
      <span className="flex items-center gap-2" key="bg">
        <span
          aria-hidden="true"
          className="border-border size-3.5 flex-none rounded-sm border"
          style={{ background: profile.backgroundHex }}
        />
        {profile.backgroundTitle}
      </span>,
    ],
  ]

  return (
    <div className="bg-muted border-border flex flex-col gap-3 rounded-lg border p-4">
      <span className="text-[13px] font-medium">Каким получится файл</span>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {rows.map(([label, value]) => (
          <div className="flex flex-col gap-0.5" key={label}>
            <dt className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</dt>
            <dd className="text-[13px] font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="text-muted-foreground text-[12px] leading-4">{note}</p>}
    </div>
  )
}

/* -------------------------------------------------------------------- сводка и цена */

export function SummaryRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <dt className="text-muted-foreground flex-none">{label}</dt>
      <dd className={cn('truncate text-right', value === null && 'text-muted-foreground')}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

export function PriceRow({
  label,
  tone = 'plain',
  value,
}: {
  label: string
  tone?: 'plain' | 'total' | 'short'
  value: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={cn('text-[13px]', tone === 'plain' && 'text-muted-foreground')}>{label}</span>
      <span
        className={cn(
          'text-[13px] font-medium',
          tone === 'total' && 'text-base font-semibold',
          tone === 'short' && 'text-danger-foreground font-semibold',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------------ превью файла */

/**
 * Картинка из приватного бакета. Прямого адреса у файла нет — ссылка подписывается на
 * минуту и берётся заново при каждом показе (docs/SPEC.md §4).
 */
export function SignedImage({
  alt,
  className,
  resolve,
  storagePath,
}: {
  alt: string
  className?: string
  resolve: (storagePath: string) => Promise<string | null>
  storagePath: string
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void resolve(storagePath).then((signed) => {
      if (!cancelled) setUrl(signed)
    })
    return () => {
      cancelled = true
    }
  }, [resolve, storagePath])

  if (url === null) {
    return <div aria-busy="true" className={cn('bg-muted animate-pulse rounded-md', className)} />
  }

  return <img alt={alt} className={cn('rounded-md object-cover', className)} src={url} />
}

/* --------------------------------------------------------------------------- миниатюра */

export function PhotoThumb({
  name,
  onRemove,
  url,
}: {
  name: string
  onRemove: () => void
  url: string
}) {
  return (
    <div className="group border-border bg-muted relative aspect-[3/4] overflow-hidden rounded-lg border">
      <img alt={name} className="size-full object-cover" src={url} />
      <button
        aria-label={`Убрать фото ${name}`}
        className="bg-background/90 text-foreground border-border absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full border"
        onClick={onRemove}
        type="button"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </div>
  )
}
