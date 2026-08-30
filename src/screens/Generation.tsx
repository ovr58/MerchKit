import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { AppLayout, Panel, PanelTitle } from '@/components/AppLayout'
import { AlertTriangleIcon, CheckIcon, DownloadIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Notice,
  OutputParams,
  SignedImage,
  StatusPill,
  SummaryRow,
} from '@/components/wizard'
import { useSession } from '@/features/auth'
import { useBalance } from '@/features/billing'
import {
  downloadResult,
  restoreDraftFrom,
  signedResultUrl,
  useGeneration,
  type Generation as GenerationRow,
} from '@/features/generation'
import { profileOf, titleOf, useTaxonomy } from '@/features/taxonomy'
import { cn } from '@/lib/utils'

/**
 * Экраны `GenerationRunning`, `ResultsDone` и `ResultsFailed` захода D2 — одна страница на
 * все три состояния блока «Результаты» из [V-06](../../docs/VISUALS.md#v-06).
 *
 * **Статус читается из базы, а не из состояния вкладки** (NFR-02). Отсюда два свойства,
 * которых иначе не было бы: F5 во время генерации возвращает тот же экран с той же
 * стадией, а закрытая вкладка работу не отменяет — воркер живёт в собственном вызове.
 *
 * **Исходов ровно два** (решение 2026-08-29, V-07). Не получилось изображение или не
 * получились тексты карточки — в обоих случаях `failed`: полный возврат, ничего не отдано
 * и предложение повторить с теми же параметрами (US-E4).
 */

const STAGES = [
  'Заявка принята, баллы списаны',
  'Собран промпт по выбранному сценарию',
  'Провайдер рисует изображение',
  'Сохраняем результат в каталог',
] as const

function Stage({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      <span
        className={cn(
          'flex size-5 flex-none items-center justify-center rounded-full border',
          state === 'done' && 'bg-primary border-primary text-primary-foreground',
          state === 'active' && 'border-primary border-2',
          state === 'pending' && 'bg-muted border-border',
        )}
      >
        {state === 'done' && <CheckIcon className="size-2.5" />}
      </span>
      <span className={state === 'pending' ? 'text-muted-foreground' : undefined}>{label}</span>
    </li>
  )
}

function TextBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        <button
          className="text-muted-foreground hover:text-foreground text-[13px] underline-offset-2 hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true))
          }}
          type="button"
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
      <p className="border-border bg-background rounded-md border px-3 py-2.5 text-[13px] leading-[19px]">
        {value}
      </p>
    </div>
  )
}

export default function Generation() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useSession()
  const user = session?.user
  const balance = useBalance(user?.id)
  const taxonomy = useTaxonomy()
  // Прочерк, а не ноль, пока баланс едет: «0 баллов» читается как «баллы кончились».
  const balanceLabel = balance.isSuccess ? `${balance.data} баллов` : '— баллов'
  const generation = useGeneration(id)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  // US-E4: «повторить с теми же параметрами» — значит и с теми же фото. Черновик при
  // запуске очищается, поэтому исходники выкачиваются обратно из бакета.
  async function retry(generation: GenerationRow) {
    setRetrying(true)
    const restore = await restoreDraftFrom(generation)

    // Фото старше срока хранения уже убраны (веха M5, шаг 6) — мастер обязан объяснить
    // это сам, иначе человек увидит пустую загрузку и решит, что мы потеряли его файлы.
    void navigate('/generate', {
      state: restore.expired > 0 ? { expiredPhotos: restore.expired } : undefined,
    })
  }

  const resolve = useCallback((path: string) => signedResultUrl(path), [])

  const row = generation.data
  const running = row?.status === 'queued' || row?.status === 'running'
  const profile = profileOf(taxonomy.data, row?.marketplaceId ?? null, row?.categoryId ?? null)

  const heading = row
    ? row.status === 'failed'
      ? 'Генерация не удалась'
      : (row.title ?? row.productTitle)
    : 'Генерация'

  if (generation.isError) {
    return (
      <AppLayout active="catalog" balance={balanceLabel} email={user?.email}>
        <Panel>
          <Notice tone="error">
            <span>Генерация не найдена. Возможно, она принадлежит другому аккаунту.</span>
          </Notice>
          <Button asChild className="w-fit" variant="outline">
            <Link to="/catalog">В каталог</Link>
          </Button>
        </Panel>
      </AppLayout>
    )
  }

  return (
    <AppLayout active="catalog" balance={balanceLabel} email={user?.email}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
        {/* -------------------------------------------------------------- заявка */}
        <Panel>
          <PanelTitle title="Заявка" />
          {row && (
            <>
              <dl className="flex flex-col gap-2.5">
                <SummaryRow label="Товар" value={row.productTitle} />
                <SummaryRow
                  label="Категория"
                  value={titleOf(taxonomy.data?.categories ?? [], row.categoryId)}
                />
                <SummaryRow
                  label="Площадка"
                  value={titleOf(taxonomy.data?.marketplaces ?? [], row.marketplaceId)}
                />
                <SummaryRow label="Тип" value={row.kind === 'card' ? 'Карточка' : 'Фото'} />
                <SummaryRow
                  label="Как показать"
                  value={titleOf(taxonomy.data?.presets ?? [], row.presetId)}
                />
                <SummaryRow
                  label="Файл"
                  value={profile ? `${profile.aspectLabel} · ${profile.width} × ${profile.height}` : null}
                />
              </dl>

              <hr className="border-border" />

              <p className="text-[13px]">
                {row.status === 'failed'
                  ? `Списано ${row.price} · возврат ${row.price} · баланс ${balance.data ?? 0}`
                  : `Списано ${row.price} баллов · баланс ${balance.data ?? 0}`}
              </p>

              {!running && (
                <Button
                  className="w-full"
                  disabled={retrying}
                  onClick={() => (row.status === 'failed' ? void retry(row) : void navigate('/generate'))}
                  variant="outline"
                >
                  {row.status === 'failed' ? 'Изменить настройки' : 'Создать ещё одну'}
                </Button>
              )}
            </>
          )}
        </Panel>

        {/* ---------------------------------------------------------- результаты */}
        <Panel>
          <div className="flex items-center justify-between gap-2">
            <PanelTitle title="Результаты" />
            {row && (
              <StatusPill tone={row.status === 'done' ? 'success' : 'neutral'}>
                {row.status === 'done' ? 'Готово' : row.status === 'failed' ? 'Сбой' : 'Идёт генерация'}
              </StatusPill>
            )}
          </div>

          {/* --- идёт генерация (NFR-02) --- */}
          {running && (
            <>
              <div
                aria-busy="true"
                aria-live="polite"
                className="border-border bg-muted flex min-h-64 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-6"
              >
                <span className="border-brand border-t-border size-14 animate-spin rounded-full border-[3px]" />
                <span className="text-base font-medium">Провайдер рисует изображение</span>
              </div>

              <ol className="flex flex-col gap-3">
                {STAGES.map((label, index) => (
                  <Stage
                    key={label}
                    label={label}
                    state={index < 2 ? 'done' : index === 2 ? 'active' : 'pending'}
                  />
                ))}
              </ol>

              <Notice tone="info">
                <span>
                  Можно закрыть вкладку или обновить страницу — статус генерации сохранится и
                  вернётся сюда.
                </span>
              </Notice>
            </>
          )}

          {/* --- готово --- */}
          {row?.status === 'done' && (
            <>
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                {row.assets[0] && (
                  <SignedImage
                    alt={row.title ?? row.productTitle}
                    className="border-border w-full max-w-[288px] flex-none border"
                    resolve={resolve}
                    storagePath={row.assets[0].storagePath}
                  />
                )}

                <div className="flex flex-1 flex-col gap-4">
                  {row.cardTitle && <TextBlock label="Заголовок карточки" value={row.cardTitle} />}
                  {row.cardDescription && (
                    <TextBlock label="Описание" value={row.cardDescription} />
                  )}

                  {downloadFailed && (
                    <Notice tone="error">
                      <span>Файл не скачался. Попробуйте ещё раз — баллы за это не списываются.</span>
                    </Notice>
                  )}

                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <Button
                      className="flex-1"
                      onClick={() => {
                        const asset = row.assets[0]
                        if (!asset) return
                        void downloadResult(
                          asset.storagePath,
                          // Расширение — из формата самого файла, а не зашитое: вендор
                          // выбирает формат сам, и результат бывает PNG (миграция
                          // 20260829140000). Зашитый `.jpg` отдавал бы человеку PNG под
                          // чужим именем — ровно то, что он понесёт на площадку.
                          `${row.title ?? row.productTitle}.${asset.format}`,
                        ).then((ok) => setDownloadFailed(!ok))
                      }}
                      size="lg"
                    >
                      <DownloadIcon className="size-4" />
                      Скачать изображение
                    </Button>
                    <Button asChild className="flex-1" size="lg" variant="outline">
                      <Link to="/catalog">В каталог</Link>
                    </Button>
                  </div>
                </div>
              </div>

              {profile && (
                <OutputParams
                  note={`Файл готов под требования площадки для этой категории — загружается в карточку как есть.`}
                  profile={profile}
                />
              )}

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                Изображение скачивается в полном разрешении. Генерация уже в каталоге — открыть и
                скачать её снова можно бесплатно.
              </p>
            </>
          )}

          {/* --- сбой (US-E4) --- */}
          {row?.status === 'failed' && (
            <>
              <Notice tone="error">
                <span>
                  {row.failureReason ?? 'Генерация не удалась'}. Вернули все <b>{row.price} баллов</b>
                  {' '}— платить дважды за одну попытку не придётся.
                </span>
              </Notice>

              <div className="border-border bg-muted flex min-h-64 flex-col items-center justify-center gap-3.5 rounded-lg border border-dashed p-6 text-center">
                <span className="bg-danger-surface border-danger-border text-danger-foreground flex size-14 items-center justify-center rounded-full border">
                  <AlertTriangleIcon className="size-6" />
                </span>
                <span className="text-base font-medium">Результата нет</span>
                <span className="text-muted-foreground max-w-[420px] text-[13px] leading-[18px]">
                  Половину карточки не отдаём: если не получилось изображение или не получились
                  тексты — не получилась вся генерация. В каталог она не попадает и списка не
                  засоряет.
                </span>
                <Button
                  className="mt-1 w-full max-w-[320px]"
                  disabled={retrying}
                  onClick={() => void retry(row)}
                  size="lg"
                >
                  {retrying ? 'Возвращаем настройки…' : 'Повторить с теми же параметрами'}
                </Button>
                <span className="text-muted-foreground text-[13px]">
                  Повторный запуск стоит те же {row.price} баллов
                </span>
              </div>
            </>
          )}

          {generation.isLoading && (
            <p aria-busy="true" className="text-muted-foreground text-sm">
              Читаем статус генерации…
            </p>
          )}
        </Panel>
      </div>
    </AppLayout>
  )
}

export type { GenerationRow }
