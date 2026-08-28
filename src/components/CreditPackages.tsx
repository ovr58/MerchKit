import { Panel, PanelTitle } from '@/components/AppLayout'
import { Callout } from '@/components/Callout'
import { Button } from '@/components/ui/button'
import { useCreditPackages, useTopUp, type CreditPackage } from '@/features/billing'

/**
 * Секция «Пакеты пополнения» артборда D1 `Profile`.
 *
 * Эквайринга в этой версии нет сознательно (FR-23): пакет зачисляется мгновенно и бесплатно,
 * и надпись об этом — часть утверждённого макета, а не заглушка.
 */

/** «390 ₽ · 1,30 ₽ за балл» — вторая строка карточки на артборде. */
function priceLine(pack: CreditPackage): string {
  const perCredit = (pack.priceRub / pack.credits).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return `${pack.priceRub.toLocaleString('ru-RU')} ₽ · ${perCredit} ₽ за балл`
}

function PackageCard({
  disabled,
  onChoose,
  pack,
}: {
  disabled: boolean
  onChoose: () => void
  pack: CreditPackage
}) {
  return (
    <div
      className={
        pack.isFeatured
          ? 'border-primary bg-success-surface flex flex-1 flex-col gap-3.5 rounded-lg border p-5'
          : 'border-border bg-background flex flex-1 flex-col gap-3.5 rounded-lg border p-5'
      }
    >
      <div className="flex min-h-[22px] items-center justify-between gap-2">
        <span className="text-sm font-semibold">{pack.title}</span>
        {pack.isFeatured && (
          <span className="bg-background border-success-border text-success-foreground rounded-[10px] border px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase">
            Выгоднее
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[28px] leading-none font-semibold tracking-tight">
            {pack.credits.toLocaleString('ru-RU')}
          </span>
          <span className="text-muted-foreground text-sm">баллов</span>
        </div>
        <div className="text-muted-foreground text-[13px]">{priceLine(pack)}</div>
      </div>

      <Button
        disabled={disabled}
        onClick={onChoose}
        size="lg"
        variant={pack.isFeatured ? 'default' : 'outline'}
      >
        Пополнить
      </Button>
    </div>
  )
}

export function CreditPackages({ userId }: { userId: string | undefined }) {
  const packages = useCreditPackages()
  const topUp = useTopUp(userId)

  return (
    <Panel id="packages">
      <PanelTitle
        hint="Баллы зачисляются сразу: оплата в этой версии не подключена"
        title="Пакеты пополнения"
      />

      {topUp.isError && <Callout>{topUp.error.message}</Callout>}

      {packages.isError && (
        <p className="text-muted-foreground text-sm">
          Не удалось загрузить пакеты. Обновите страницу.
        </p>
      )}

      {packages.isPending && <p className="text-muted-foreground text-sm">Загружаем пакеты…</p>}

      {packages.isSuccess && (
        <div className="flex flex-col items-stretch gap-4 sm:flex-row">
          {packages.data.map((pack) => (
            <PackageCard
              disabled={topUp.isPending}
              key={pack.id}
              onChoose={() => topUp.mutate(pack.id)}
              pack={pack}
            />
          ))}
        </div>
      )}
    </Panel>
  )
}
