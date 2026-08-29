import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router'

import { CloseIcon, CoinIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Шапка приложения по артбордам D1 «Профиль» и D2 «Мастер генерации».
 *
 * Разделы стали настоящими ссылками на вехе M4: до неё «Создать генерацию» и «Каталог»
 * были неактивными пунктами, потому что маршрутов под них не существовало.
 *
 * **Шапка есть и у гостя.** Мастер проходится без входа целиком (FR-12), поэтому вместо
 * баланса и аватара гостю показываются вход и регистрация — как на артборде
 * `WizardLaunchGuest`.
 *
 * На узком экране разделы прячутся под кнопку меню (артборд `MobileWizard`). Прятать их
 * совсем нельзя: NFR-09 требует, чтобы сценарий проходился с телефона целиком, а без
 * навигации из мастера не попасть ни в каталог, ни в профиль.
 */

function MenuIcon(props: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={props.className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

export type Section = 'wizard' | 'catalog' | 'profile'

const SECTIONS: { label: string; section: Section; to: string }[] = [
  { label: 'Создать генерацию', section: 'wizard', to: '/generate' },
  { label: 'Каталог', section: 'catalog', to: '/catalog' },
  { label: 'Профиль', section: 'profile', to: '/profile' },
]

function NavItem({ active, label, to }: { active: boolean; label: string; to: string }) {
  return (
    <NavLink
      className={cn(
        'border-b-2 py-2 text-sm',
        active
          ? 'border-brand text-foreground font-medium'
          : 'text-muted-foreground hover:text-foreground border-transparent',
      )}
      to={to}
    >
      {label}
    </NavLink>
  )
}

export function AppLayout({
  active,
  balance,
  children,
  email,
}: {
  active: Section
  /** Баланс гостю не показывается: его не с чего считать. */
  balance?: ReactNode
  children: ReactNode
  email?: string
}) {
  const signedIn = email !== undefined
  const [menuOpen, setMenuOpen] = useState(false)
  const sections = SECTIONS.filter((item) => signedIn || item.section === 'wizard')

  return (
    <div className="bg-muted flex min-h-svh flex-col">
      <header className="bg-background border-border flex h-16 flex-none items-center justify-between gap-2 border-b px-4 sm:gap-4 sm:px-10">
        <div className="flex min-w-0 items-center gap-6 sm:gap-10">
          <Link className="text-foreground shrink-0" to={signedIn ? '/catalog' : '/generate'}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 md:flex">
            {sections.map((item) => (
              <NavItem
                active={active === item.section}
                key={item.section}
                label={item.label}
                to={item.to}
              />
            ))}
          </nav>
        </div>

        {signedIn ? (
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="bg-success-surface border-success-border text-success-foreground flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap">
              <CoinIcon className="size-3.5" />
              {balance}
            </span>
            {/* На узком экране аватар уступает место кнопке меню: разделы важнее инициалов. */}
            <span className="bg-muted border-border text-muted-foreground hidden size-8 items-center justify-center rounded-full border text-xs font-medium sm:flex">
              {email.slice(0, 2).toUpperCase()}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link to="/signin">Войти</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/signup">Регистрация</Link>
            </Button>
          </div>
        )}

        {/* Гостю меню не нужно: раздел у него ровно один — тот, на котором он стоит. */}
        {signedIn && (
          <button
            aria-controls="app-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            className="text-foreground -mr-2 flex size-11 items-center justify-center rounded-md md:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            {menuOpen ? <CloseIcon className="size-5" /> : <MenuIcon className="size-5" />}
          </button>
        )}
      </header>

      {menuOpen && (
        <nav
          className="bg-background border-border flex flex-col border-b px-4 py-2 md:hidden"
          id="app-menu"
        >
          {sections.map((item) => (
            <NavLink
              className={cn(
                'flex min-h-12 items-center rounded-md px-2 text-sm',
                active === item.section ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
              key={item.section}
              onClick={() => setMenuOpen(false)}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}

      <main className="flex-1 px-4 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-5">{children}</div>
      </main>
    </div>
  )
}

export function Panel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <section
      className="bg-background border-border flex scroll-mt-20 flex-col gap-4 rounded-lg border p-5 shadow-sm sm:p-6"
      id={id}
    >
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
