import { useCallback } from 'react'
import { Link } from 'react-router'

import { AppLayout, Panel, PanelTitle } from '@/components/AppLayout'
import { ImageIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Notice, SignedImage } from '@/components/wizard'
import { useSession } from '@/features/auth'
import { useBalance } from '@/features/billing'
import { signedResultUrl, useCatalog, type Generation } from '@/features/generation'
import { titleOf, useTaxonomy } from '@/features/taxonomy'

/**
 * Каталог генераций — артборды `CatalogData` и `MobileCatalog` захода D2 (FR-01, US-04).
 *
 * **В списке только завершённые генерации.** Неуспешные не попадают сюда как готовые
 * (US-E4): за них вернули баллы, отдавать нечего, и место в списке они занимать не должны.
 *
 * Повторное скачивание материалов баллов не списывает (FR-17) — списывать негде: доступ к
 * своему файлу идёт подписанной ссылкой, а не новой генерацией.
 */

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function CatalogCard({
  generation,
  marketplace,
  resolve,
}: {
  generation: Generation
  marketplace: string | null
  resolve: (path: string) => Promise<string | null>
}) {
  const asset = generation.assets[0]

  return (
    <Link
      className="bg-background border-border focus-visible:ring-ring/50 flex flex-col gap-3 rounded-lg border p-3 shadow-sm outline-none transition-colors hover:shadow-md focus-visible:ring-[3px]"
      to={`/generation/${generation.id}`}
    >
      {asset ? (
        <SignedImage
          alt={generation.title ?? generation.productTitle}
          className="aspect-[3/4] w-full"
          resolve={resolve}
          storagePath={asset.storagePath}
        />
      ) : (
        <div className="bg-muted flex aspect-[3/4] items-center justify-center rounded-md">
          <ImageIcon className="text-muted-foreground size-6" />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="line-clamp-2 text-sm font-medium">
          {generation.title ?? generation.productTitle}
        </span>
        <span className="text-muted-foreground text-[12px]">
          {shortDate(generation.createdAt)} · {generation.kind === 'card' ? 'Карточка' : 'Фото'}
          {marketplace ? ` · ${marketplace}` : ''}
        </span>
      </div>
    </Link>
  )
}

export default function Catalog() {
  const { session } = useSession()
  const user = session?.user
  const balance = useBalance(user?.id)
  const taxonomy = useTaxonomy()
  // Прочерк, а не ноль, пока баланс едет: «0 баллов» читается как «баллы кончились».
  const balanceLabel = balance.isSuccess ? `${balance.data} баллов` : '— баллов'
  const catalog = useCatalog(user?.id)
  const resolve = useCallback((path: string) => signedResultUrl(path), [])

  const generations = catalog.data ?? []

  return (
    <AppLayout active="catalog" balance={balanceLabel} email={user?.email}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Каталог генераций</h1>
        <Button asChild className="w-full sm:w-[200px]" size="lg">
          <Link to="/generate">Создать генерацию</Link>
        </Button>
      </div>

      {catalog.isLoading && (
        <p aria-busy="true" className="text-muted-foreground text-sm">
          Загружаем каталог…
        </p>
      )}

      {catalog.isError && (
        <Panel>
          <Notice tone="error">
            <span>Не удалось загрузить каталог. Обновите страницу.</span>
          </Notice>
        </Panel>
      )}

      {catalog.isSuccess && generations.length === 0 && (
        <Panel>
          <PanelTitle
            hint="Загрузите фото товара — первая генерация займёт пару минут"
            title="Здесь пока пусто"
          />
          <div className="border-border bg-muted flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
            <span className="bg-background border-border flex size-12 items-center justify-center rounded-full border">
              <ImageIcon className="text-muted-foreground size-5" />
            </span>
            <span className="text-muted-foreground max-w-[320px] text-[13px] leading-[18px]">
              Готовые изображения и карточки будут складываться сюда. Скачать их повторно можно
              бесплатно.
            </span>
            <Button asChild className="mt-1 w-full max-w-[240px]" size="lg">
              <Link to="/generate">Создать генерацию</Link>
            </Button>
          </div>
        </Panel>
      )}

      {generations.length > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {generations.map((generation) => (
              <CatalogCard
                generation={generation}
                key={generation.id}
                marketplace={titleOf(taxonomy.data?.marketplaces ?? [], generation.marketplaceId)}
                resolve={resolve}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-[13px]">
            Материалы любой генерации скачиваются повторно без списания баллов.
          </p>
        </>
      )}
    </AppLayout>
  )
}
