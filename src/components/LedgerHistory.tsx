import { Panel, PanelTitle } from '@/components/AppLayout'
import { useCreditPackages, useLedger, type LedgerEntry } from '@/features/billing'

/**
 * Секция «История операций» артборда D1 `Profile` — журнал `ledger` как он есть.
 *
 * Колонка «Баланс» берётся из самой строки журнала, а не досчитывается на клиенте: иначе
 * она врала бы на любой выборке, кроме полной (US-05).
 */

const COLUMNS = 'grid grid-cols-[88px_minmax(0,1fr)_72px_72px] gap-3 sm:grid-cols-[120px_minmax(0,1fr)_90px_90px] sm:gap-4'

/** Что человек увидит вместо `kind`. Названия пакетов подставляются из справочника. */
function describeOperation(entry: LedgerEntry, packageTitle: string | undefined): string {
  switch (entry.kind) {
    case 'signup_bonus':
      return 'Стартовые баллы за подтверждение email'
    case 'topup':
      return packageTitle === undefined ? 'Пополнение баланса' : `Пополнение — пакет «${packageTitle}»`
    case 'charge':
      return 'Списание за генерацию'
    case 'refund':
      return 'Возврат за неполученные объекты'
  }
}

export function LedgerHistory({ userId }: { userId: string | undefined }) {
  const history = useLedger(userId)
  const packages = useCreditPackages()

  const titleOf = (packageId: string | undefined): string | undefined =>
    packages.data?.find((pack) => pack.id === packageId)?.title

  return (
    <Panel>
      <PanelTitle title="История операций" />

      {history.isError && (
        <p className="text-muted-foreground text-sm">
          Не удалось загрузить историю операций. Обновите страницу.
        </p>
      )}

      {history.isPending && <p className="text-muted-foreground text-sm">Загружаем историю…</p>}

      {history.isSuccess &&
        (history.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Операций пока нет: первой станет начисление стартовых баллов.
          </p>
        ) : (
          <div className="flex flex-col overflow-x-auto">
            <div
              className={`${COLUMNS} text-muted-foreground pb-2.5 text-xs font-medium tracking-wide uppercase`}
            >
              <span>Дата</span>
              <span>Операция</span>
              <span className="text-right">Баллы</span>
              <span className="text-right">Баланс</span>
            </div>

            {history.data.map((entry) => (
              <div
                className={`${COLUMNS} border-border items-center border-t py-3 text-sm`}
                key={entry.id}
              >
                <span className="text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleDateString('ru-RU')}
                </span>
                <span>{describeOperation(entry, titleOf(entry.packageId))}</span>
                <span
                  className={
                    entry.delta > 0
                      ? 'text-success-foreground text-right font-medium'
                      : 'text-right font-medium'
                  }
                >
                  {/* Минус — типографский, как на артборде: дефис в колонке цифр читается
                      как перенос. */}
                  {entry.delta > 0 ? `+${entry.delta}` : `−${Math.abs(entry.delta)}`}
                </span>
                <span className="text-muted-foreground text-right">{entry.balanceAfter}</span>
              </div>
            ))}
          </div>
        ))}

      <p className="text-muted-foreground text-[13px]">
        Списания за генерации и возвраты по неудачным объектам появятся здесь же.
      </p>
    </Panel>
  )
}
