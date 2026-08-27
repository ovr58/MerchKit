import type { ReactNode } from 'react'

import { AlertCircleIcon } from '@/components/icons'

/**
 * Сообщение над формой — блок «Неверный email или пароль» с артборда `SignInError`.
 *
 * `role="alert"` обязателен: ошибка появляется после отправки формы, и человек, который
 * не видит экран, иначе не узнает, что что-то произошло (NFR-07).
 */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <div
      className="bg-danger-surface text-danger-foreground border-danger-border flex gap-2.5 rounded-md border p-3 text-[13px] leading-[18px]"
      role="alert"
    >
      <AlertCircleIcon className="mt-px size-[18px] flex-none" />
      <div>{children}</div>
    </div>
  )
}
