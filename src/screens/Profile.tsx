import { useState } from 'react'
import { useNavigate } from 'react-router'

import { AppLayout, Panel, PanelTitle } from '@/components/AppLayout'
import { ChangePasswordForm } from '@/components/ChangePasswordForm'
import { Button } from '@/components/ui/button'
import { MESSAGES, signOut, useSession } from '@/features/auth'
import { useBalance } from '@/features/billing/balance'

/**
 * Артборд D1 «Профиль — баланс и пакеты».
 *
 * На вехе M2 работают аккаунт, баланс и выход. Пакеты пополнения и история операций на
 * артборде есть, но приезжают на M3 вместе с журналом `ledger` — до него это были бы
 * кнопки, которым нечего делать, поэтому здесь они помечены, а не имитированы.
 */
export default function Profile() {
  const navigate = useNavigate()
  const { session } = useSession()
  const user = session?.user
  const balance = useBalance(user?.id)
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)

  const email = user?.email ?? ''
  const initials = email.slice(0, 2).toUpperCase()
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—'

  const balanceText = balance.isSuccess ? `${balance.data} баллов` : '— баллов'

  async function handleSignOut() {
    await signOut()
    void navigate('/signin', { replace: true })
  }

  return (
    <AppLayout balance={balanceText} initials={initials}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Профиль</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelTitle title="Баланс" />
            <div className="flex items-baseline gap-2" data-testid="balance">
              <span className="text-[40px] leading-none font-semibold tracking-tight">
                {balance.isPending ? '—' : balance.isError ? '—' : balance.data}
              </span>
              <span className="text-muted-foreground text-base">баллов</span>
            </div>
            <p className="text-muted-foreground text-[13px]">
              {balance.isError
                ? 'Не удалось прочитать баланс. Обновите страницу.'
                : 'Стартовые баллы за подтверждение email начисляются на следующем этапе разработки.'}
            </p>
          </Panel>

          <Panel>
            <PanelTitle
              hint="Пополнение появится вместе с журналом операций: баллы нельзя двигать в обход него."
              title="Пакеты пополнения"
            />
            <p className="text-muted-foreground text-sm">Раздел готовится — веха M3.</p>
          </Panel>

          <Panel>
            <PanelTitle title="История операций" />
            <p className="text-muted-foreground text-sm">
              Первой записью станет начисление стартовых баллов — веха M3.
            </p>
          </Panel>
        </div>

        <Panel>
          <PanelTitle title="Аккаунт" />
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-[13px]">Email</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span>{email}</span>
                {/* Всегда «подтверждён»: неподтверждённый аккаунт до этого экрана не
                    доходит — вход отклоняет сам Auth (ADR-0008). */}
                <span className="bg-success-surface border-success-border text-success-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
                  Подтверждён
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground text-[13px]">Аккаунт создан</dt>
              <dd>{createdAt}</dd>
            </div>
          </dl>

          <hr className="border-border" />

          {changing ? (
            <ChangePasswordForm
              email={email}
              onCancel={() => setChanging(false)}
              onSuccess={() => {
                setChanging(false)
                setChanged(true)
              }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {changed && (
                <p
                  className="bg-success-surface border-success-border text-success-foreground rounded-md border px-3 py-2 text-[13px]"
                  role="status"
                >
                  {MESSAGES.passwordChanged}
                </p>
              )}
              <Button
                onClick={() => {
                  setChanged(false)
                  setChanging(true)
                }}
                size="lg"
                variant="outline"
              >
                Сменить пароль
              </Button>
              <Button onClick={() => void handleSignOut()} size="lg" variant="ghost">
                Выйти
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </AppLayout>
  )
}
