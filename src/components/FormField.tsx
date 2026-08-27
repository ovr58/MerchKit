import { useId, useState, type ReactNode } from 'react'

import { AlertCircleIcon, EyeIcon, EyeOffIcon } from '@/components/icons'
import { Input } from '@/components/ui/input'

/**
 * Поле формы по артбордам D1: подпись, ввод, ошибка под ним красным с иконкой.
 *
 * Ошибка связана с полем через `aria-describedby` и `aria-invalid`, а не только цветом
 * рамки: WCAG AA (NFR-07) требует, чтобы причина отказа доходила и до экранного диктора,
 * и до человека, который красный от серого не отличает.
 */
export function FormField({
  autoComplete,
  error,
  label,
  labelAside,
  name,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  autoComplete?: string
  error?: string | null
  label: string
  labelAside?: ReactNode
  name: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'email' | 'password'
  value: string
}) {
  const id = useId()
  const errorId = `${id}-error`
  const [revealed, setRevealed] = useState(false)

  const isPassword = type === 'password'
  const RevealIcon = revealed ? EyeOffIcon : EyeIcon

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium" htmlFor={id}>
          {label}
        </label>
        {labelAside}
      </div>

      <div className="relative">
        <Input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete={autoComplete}
          className={isPassword ? 'pr-10' : undefined}
          id={id}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={isPassword && revealed ? 'text' : type}
          value={value}
        />
        {isPassword && (
          <button
            aria-label={revealed ? 'Скрыть пароль' : 'Показать пароль'}
            className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md"
            onClick={() => setRevealed((shown) => !shown)}
            type="button"
          >
            <RevealIcon className="size-4" />
          </button>
        )}
      </div>

      {error && (
        <p className="text-destructive flex items-center gap-1.5 text-[13px]" id={errorId}>
          <AlertCircleIcon aria-hidden="true" className="size-3.5 flex-none" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
