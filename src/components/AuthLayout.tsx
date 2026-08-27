import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { Logo } from '@/components/Logo'

/**
 * Раскладка экранов входа, регистрации и восстановления по артбордам D1: шапка гостя
 * и карточка по центру серого поля.
 *
 * Ширина карточки на артборде — 440 px, здесь это потолок: на 360 px (NFR-09) карточка
 * сжимается по ширине экрана, а не уезжает за край.
 */
export function AuthLayout({
  children,
  headerLink,
  headerText,
}: {
  children: ReactNode
  headerLink?: { label: string; to: string }
  headerText?: string
}) {
  return (
    <div className="bg-muted flex min-h-svh flex-col">
      <header className="bg-background border-border flex h-16 flex-none items-center justify-between border-b px-4 sm:px-10">
        <Link className="text-foreground" to="/">
          <Logo />
        </Link>
        {headerLink && (
          <span className="text-muted-foreground flex items-center gap-2.5 text-sm">
            <span className="hidden sm:inline">{headerText}</span>
            <Link className="text-primary font-medium hover:underline" to={headerLink.to}>
              {headerLink.label}
            </Link>
          </span>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center p-4 sm:p-10">
        <div className="bg-background border-border flex w-full max-w-[440px] flex-col gap-5 rounded-lg border p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

export function AuthHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground text-sm leading-5">{description}</p>
    </div>
  )
}
