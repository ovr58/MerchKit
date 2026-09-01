import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * Поле ввода shadcn/ui. Высота 40 px и радиус 6 px — из утверждённого канваса D1
 * (docs/design/d1-account/gen.mjs), там все контролы одного размера.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        // `text-base` на мобильном — не вкусовщина: iOS Safari при фокусе в поле с кеглем
        // меньше 16 px увеличивает всю страницу и обратно её не уменьшает, человек
        // дозаполняет форму в приближении. С `sm` и выше кегль прежний.
        'border-input bg-background flex h-10 w-full min-w-0 rounded-md border px-3 py-1 text-base transition-colors outline-none sm:text-sm',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-brand focus-visible:ring-brand/25 focus-visible:ring-[3px]',
        'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25',
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  )
}

export { Input }
