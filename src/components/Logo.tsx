import { BoxIcon } from '@/components/icons'

/** Знак и название из шапки артбордов D1. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap">
      <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
        <BoxIcon className="size-4" />
      </span>
      <span className="text-base font-semibold tracking-tight">Merch Kit</span>
    </span>
  )
}
