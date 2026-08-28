/**
 * Публичный интерфейс модуля `billing` (docs/SPEC.md §3): баланс, пакеты, история операций.
 * Внутри остаются запросы к таблицам и устройство журнала — экраны о них не знают и в
 * `profiles` / `ledger` напрямую не ходят.
 */

export { useBalance } from './balance'
export { useLedger, type LedgerEntry, type LedgerKind } from './history'
export { useCreditPackages, useTopUp, type CreditPackage } from './packages'
