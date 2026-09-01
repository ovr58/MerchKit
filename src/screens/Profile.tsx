import { affordableObjects, OBJECT_PRICE } from '@shared/pricing.ts'
import { useState } from 'react'
import { useNavigate } from 'react-router'

import { AppLayout, Panel, PanelTitle } from '@/components/AppLayout'
import { Callout } from '@/components/Callout'
import { ChangePasswordForm } from '@/components/ChangePasswordForm'
import { CreditPackages } from '@/components/CreditPackages'
import { LedgerHistory } from '@/components/LedgerHistory'
import { Button } from '@/components/ui/button'
import { deleteAccount, MESSAGES, signOut, useSession } from '@/features/auth'
import { useBalance } from '@/features/billing'
import { plural } from '@/lib/plural'

/**
 * Артборд D1 «Профиль — баланс и пакеты».
 *
 * Баланс, пакеты и история читаются из базы под RLS и ничего не имитируют: движение баллов
 * идёт только через журнал `ledger` (веха M3). Удаления аккаунта на артборде нет — оно
 * заведено сверх макета по 152-ФЗ, см. заметку к V-08 в docs/VISUALS.md.
 */
export default function Profile() {
  const navigate = useNavigate()
  const { session } = useSession()
  const user = session?.user
  const balance = useBalance(user?.id)
  const [changing, setChanging] = useState(false)
  const [changed, setChanged] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const email = user?.email ?? ''
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—'

  const balanceText = balance.isSuccess ? `${balance.data} баллов` : '— баллов'
  const affordable = affordableObjects(balance.data ?? 0)

  async function handleSignOut() {
    await signOut()
    void navigate('/signin', { replace: true })
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)

    const outcome = await deleteAccount()

    if (!outcome.ok) {
      setDeleting(false)
      setDeleteError(outcome.message)
      return
    }

    void navigate('/signin', { replace: true })
  }

  return (
    <AppLayout active="profile" balance={balanceText} email={email}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Профиль</h1>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <Panel>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <PanelTitle title="Баланс" />
                <div className="flex items-baseline gap-2" data-testid="balance">
                  <span className="text-[40px] leading-none font-semibold tracking-tight">
                    {balance.isSuccess ? balance.data : '—'}
                  </span>
                  <span className="text-muted-foreground text-base">баллов</span>
                </div>
                <p className="text-muted-foreground text-[13px]">
                  {balance.isError
                    ? 'Не удалось прочитать баланс. Обновите страницу.'
                    : `Хватит на ${affordable} ${plural(affordable, 'объект', 'объекта', 'объектов')} — один объект стоит ${OBJECT_PRICE} баллов`}
                </p>
              </div>

              <Button asChild className="w-full sm:w-[180px]" size="lg">
                <a href="#packages">Пополнить баланс</a>
              </Button>
            </div>
          </Panel>

          <CreditPackages userId={user?.id} />

          <LedgerHistory userId={user?.id} />
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

              <hr className="border-border my-1" />

              {deleteError !== null && <Callout>{deleteError}</Callout>}

              {confirmingDelete ? (
                <div className="flex flex-col gap-2">
                  {/* Предупреждение — часть решения ADR-0009, а не вежливость: ключ
                      идемпотентности переживает удаление, и стартовых баллов на тот же
                      ящик второй раз не будет. */}
                  <p className="text-muted-foreground text-[13px]">
                    Аккаунт и каталог генераций будут удалены навсегда. Стартовые баллы при
                    повторной регистрации на этот же почтовый ящик не начисляются.
                  </p>
                  <Button
                    disabled={deleting}
                    onClick={() => void handleDelete()}
                    size="lg"
                    variant="destructive"
                  >
                    {deleting ? 'Удаляем…' : 'Удалить навсегда'}
                  </Button>
                  <Button
                    disabled={deleting}
                    onClick={() => setConfirmingDelete(false)}
                    size="lg"
                    variant="ghost"
                  >
                    Отмена
                  </Button>
                </div>
              ) : (
                <Button
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteError(null)
                    setConfirmingDelete(true)
                  }}
                  size="lg"
                  variant="ghost"
                >
                  Удалить аккаунт
                </Button>
              )}
            </div>
          )}
        </Panel>
      </div>
    </AppLayout>
  )
}
