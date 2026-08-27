import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { CoinIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'

/**
 * Шапка приложения по артборду D1 «Профиль»: логотип, разделы, баланс и аватар.
 *
 * «Создать генерацию» и «Каталог» на артборде есть, а маршрутов под них — нет: они
 * приезжают на вехах M4 и M6. Рисовать их ссылками в никуда нельзя, поэтому до появления
 * экранов это неактивные пункты, а не `<Link>` на несуществующий адрес.
 */

function NavItem({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      aria-disabled={active ? undefined : true}
      className={
        active
          ? 'border-brand text-foreground border-b-2 py-2 text-sm font-medium'
          : 'text-muted-foreground border-b-2 border-transparent py-2 text-sm'
      }
    >
      {children}
    </span>
  )
}

export function AppLayout({
  balance,
  children,
  initials,
}: {
  balance: ReactNode
  children: ReactNode
  initials: string
}) {
  return (
    <div className="bg-muted flex min-h-svh flex-col">
      <header className="bg-background border-border flex h-16 flex-none items-center justify-between gap-4 border-b px-4 sm:px-10">
        <div className="flex items-center gap-6 sm:gap-10">
          <Link className="text-foreground" to="/profile">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            <NavItem>Создать генерацию</NavItem>
            <NavItem>Каталог</NavItem>
            <NavItem active>Профиль</NavItem>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <span className="bg-success-surface border-success-border text-success-foreground flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium">
            <CoinIcon className="size-3.5" />
            {balance}
          </span>
          <span className="bg-muted border-border text-muted-foreground flex size-8 items-center justify-center rounded-full border text-xs font-medium">
            {initials}
          </span>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5">{children}</div>
      </main>
    </div>
  )
}

export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="bg-background border-border flex flex-col gap-4 rounded-lg border p-5 shadow-sm sm:p-6">
      {children}
    </section>
  )
}

export function PanelTitle({ hint, title }: { hint?: string; title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-base font-medium">{title}</h2>
      {hint && <p className="text-muted-foreground text-[13px]">{hint}</p>}
    </div>
  )
}
