import { generationPrice, MAX_OBJECTS_PER_GENERATION, OBJECT_PRICE } from '@shared/pricing.ts'
import { ACCEPTED_FORMATS_HUMAN, ACCEPTED_MIME_TYPES, MAX_PHOTOS } from '@shared/uploads.ts'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { AppLayout, Panel, PanelTitle } from '@/components/AppLayout'
import { ImageIcon, UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AiBadge,
  ChoiceCard,
  Notice,
  OutputParams,
  PhotoThumb,
  PriceRow,
  Stepper,
  SummaryRow,
} from '@/components/wizard'
import { useSession } from '@/features/auth'
import { useBalance } from '@/features/billing'
import {
  blockedBy,
  clearDraft,
  launchGeneration,
  LAST_STEP,
  STEPS,
  useInvalidateAfterLaunch,
  useWizard,
  type DraftPhoto,
} from '@/features/generation'
import {
  FREEFORM_CATEGORY,
  presetsOf,
  profileOf,
  titleOf,
  useTaxonomy,
} from '@/features/taxonomy'
import { plural } from '@/lib/plural'

/**
 * Мастер генерации — шесть шагов по артбордам захода D2 и состояниям
 * [V-06](../../docs/VISUALS.md#v-06): фото → товар → площадка → тип → как показать → запуск.
 *
 * **Мастер проходится гостем целиком.** Перехват стоит ровно на «Запустить генерацию»
 * (FR-12): списывать баллы не с кого и результат некуда сохранить. Настройки при этом не
 * теряются — черновик живёт в браузере и переживает регистрацию с подтверждением email.
 *
 * Контрола количества объектов на экранах нет: потолок в один объект за генерацию
 * (ТЗ §11) — политика продаж, и выбор из одного варианта был бы обманом.
 */

/**
 * Объектные адреса живут ровно столько, сколько показывается миниатюра.
 *
 * Адреса считаются при отрисовке, а не в эффекте: иначе первый кадр уходил бы с пустыми
 * картинками, а следом шла лишняя перерисовка. Эффект остаётся только ради уборки —
 * незакрытый объектный адрес держит файл в памяти вкладки до её закрытия.
 */
function usePhotoUrls(photos: DraftPhoto[]): Map<string, string> {
  const urls = useMemo(
    () => new Map(photos.map((photo) => [photo.id, URL.createObjectURL(photo.blob)])),
    [photos],
  )

  useEffect(
    () => () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    },
    [urls],
  )

  return urls
}

function Textarea({
  hint,
  label,
  onChange,
  placeholder,
  rows = 3,
  value,
}: {
  hint?: string
  label: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  value: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={value}
      />
      {hint && <span className="text-muted-foreground text-[13px] leading-[18px]">{hint}</span>}
    </label>
  )
}

export default function Wizard() {
  const navigate = useNavigate()
  const { session } = useSession()
  const user = session?.user
  const balance = useBalance(user?.id)
  const taxonomy = useTaxonomy()
  const invalidate = useInvalidateAfterLaunch(user?.id)
  const wizard = useWizard()
  const { draft } = wizard

  const [guestPrompt, setGuestPrompt] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const filePicker = useRef<HTMLInputElement>(null)

  const urls = usePhotoUrls(draft.photos)
  const data = taxonomy.data
  const price = generationPrice(draft.kind, MAX_OBJECTS_PER_GENERATION)
  const categoryTitle = titleOf(data?.categories ?? [], draft.categoryId)
  const marketplaceTitle = titleOf(data?.marketplaces ?? [], draft.marketplaceId)
  const presets = useMemo(() => presetsOf(data, draft.categoryId), [data, draft.categoryId])
  const presetTitle = titleOf(presets, draft.presetId)
  const profile = profileOf(data, draft.marketplaceId, draft.categoryId)
  const blocker = blockedBy(draft)

  const balanceValue = balance.data ?? 0
  // Пока баланс не прочитан, в шапке прочерк, а не ноль: «0 баллов» человек читает как
  // «баллы кончились», и это враньё в самый неудачный момент — перед запуском.
  const balanceLabel = balance.isSuccess ? `${balance.data} баллов` : '— баллов'
  const missing = Math.max(0, price - balanceValue)
  const enoughCredits = user === undefined || missing === 0

  const profileNote =
    profile?.backgroundHex === '#F2F3F5'
      ? `${marketplaceTitle} требует серый фон ${profile.backgroundHex} для категории «${categoryTitle}». Это параметр генерации, а не постобработки: фон рисуется вместе с кадром.`
      : profile?.aspectLabel === '1 : 1'
        ? `${marketplaceTitle} показывает эту категорию квадратом, а не вертикальным кадром.`
        : undefined

  async function handleLaunch() {
    setLaunchError(null)

    // FR-12: гостю предлагаем регистрацию, генерация не стартует. Настройки уже в
    // черновике — он вернётся сюда после подтверждения email.
    if (!user) {
      setGuestPrompt(true)
      return
    }

    setLaunching(true)
    const outcome = await launchGeneration({
      userId: user.id,
      photos: draft.photos,
      kind: draft.kind,
      marketplaceId: draft.marketplaceId!,
      categoryId: draft.categoryId!,
      presetId: draft.presetId,
      productTitle: draft.productTitle.trim(),
      productDescription: draft.productDescription.trim(),
      wishes: draft.wishes.trim(),
    })
    setLaunching(false)

    if (!outcome.ok) {
      setLaunchError(outcome.message)
      await invalidate()
      return
    }

    // Заявка принята — черновик отработал. Оставить его значило бы предложить человеку
    // повторить ту же генерацию при следующем заходе.
    await clearDraft()
    wizard.reset()
    await invalidate()
    void navigate(`/generation/${outcome.generationId}`)
  }

  function acceptFiles(files: FileList | null) {
    if (files) wizard.addPhotos(Array.from(files))
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    acceptFiles(event.dataTransfer.files)
  }

  if (!wizard.restored || taxonomy.isLoading) {
    return (
      <AppLayout active="wizard" balance={balanceLabel} email={user?.email}>
        <p aria-busy="true" className="text-muted-foreground text-sm">
          Готовим мастер…
        </p>
      </AppLayout>
    )
  }

  if (taxonomy.isError) {
    return (
      <AppLayout active="wizard" balance={balanceLabel} email={user?.email}>
        <Panel>
          <Notice tone="error">
            <span>Не удалось загрузить справочники генерации. Обновите страницу.</span>
          </Notice>
        </Panel>
      </AppLayout>
    )
  }

  const stepValues = [
    draft.photos.length > 0 ? `${draft.photos.length} из ${MAX_PHOTOS}` : null,
    draft.productTitle || null,
    marketplaceTitle,
    draft.kind === 'card' ? 'Карточка' : 'Фото',
    presetTitle,
    null,
  ]

  return (
    <AppLayout active="wizard" balance={balanceLabel} email={user?.email}>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Создать генерацию</h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Panel>
          <Stepper current={draft.step} labels={STEPS} onGoTo={wizard.goTo} values={stepValues} />
          <hr className="border-border" />

          {/* ------------------------------------------------------- 1. Фото (FR-02) */}
          {draft.step === 0 && (
            <>
              <PanelTitle
                hint="До 4 фотографий с разных сторон — так товар на выходе получается узнаваемым"
                title="Фото товара"
              />

              {wizard.rejected.length > 0 && (
                <Notice tone="error">
                  <span>
                    {wizard.rejected.length}{' '}
                    {plural(wizard.rejected.length, 'файл не подошёл', 'файла не подошли', 'файлов не подошло')}
                    {draft.photos.length > 0 ? ' — остальные загружены.' : '.'}
                  </span>
                  {wizard.rejected.map((refused) => (
                    <span key={refused.name}>
                      <b>{refused.name}</b> — {refused.reason}.
                    </span>
                  ))}
                </Notice>
              )}

              <input
                accept={ACCEPTED_MIME_TYPES.join(',')}
                className="sr-only"
                multiple
                onChange={(event) => {
                  acceptFiles(event.target.files)
                  event.target.value = ''
                }}
                ref={filePicker}
                type="file"
              />

              {draft.photos.length === 0 ? (
                <button
                  className={`border-border flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-primary bg-success-surface' : 'bg-muted hover:bg-background'}`}
                  onClick={() => filePicker.current?.click()}
                  onDragLeave={() => setDragging(false)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDrop={handleDrop}
                  type="button"
                >
                  <span className="bg-background border-border flex size-12 items-center justify-center rounded-full border">
                    <UploadIcon className="text-muted-foreground size-5" />
                  </span>
                  <span className="text-[15px] font-medium">
                    Перетащите фото сюда или нажмите, чтобы выбрать
                  </span>
                  <span className="text-muted-foreground max-w-[320px] text-[13px] leading-[18px]">
                    Обычное фото с телефона подойдёт: студия и модель не нужны.
                  </span>
                </button>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {draft.photos.map((photo) => (
                    <PhotoThumb
                      key={photo.id}
                      name={photo.name}
                      onRemove={() => wizard.removePhoto(photo.id)}
                      url={urls.get(photo.id) ?? ''}
                    />
                  ))}
                  {draft.photos.length < MAX_PHOTOS && (
                    <button
                      className="border-border text-muted-foreground hover:bg-muted flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-[13px]"
                      onClick={() => filePicker.current?.click()}
                      onDragLeave={() => setDragging(false)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleDrop}
                      type="button"
                    >
                      <UploadIcon className="size-5" />
                      Добавить
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-[13px]">
                  {ACCEPTED_FORMATS_HUMAN} · до 10 МБ каждый файл — как принимают маркетплейсы
                </span>
                {draft.photos.length > 0 && (
                  <button
                    className="text-muted-foreground hover:text-foreground text-[13px] underline-offset-2 hover:underline"
                    onClick={wizard.clearPhotos}
                    type="button"
                  >
                    Очистить
                  </button>
                )}
              </div>
            </>
          )}

          {/* --------------------------------- 2. Товар (FR-05, US-E2) */}
          {draft.step === 1 && (
            <>
              <PanelTitle
                hint={
                  wizard.recognizing
                    ? 'Смотрим, что на фото…'
                    : draft.recognized && draft.productTitle !== ''
                      ? 'Определили по фото — поправьте, если ошиблись'
                      : 'Укажите товар сами — дальше всё как обычно'
                }
                title={draft.recognized && draft.productTitle !== '' ? 'Это ваш товар?' : 'Что на фото?'}
              />

              {!wizard.recognizing && draft.recognized && draft.productTitle === '' && (
                <Notice tone="info">
                  <span>
                    Не удалось определить товар по фото. Укажите категорию и наименование сами —
                    на саму генерацию это не влияет.
                  </span>
                </Notice>
              )}

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Наименование
                  {draft.recognized && draft.productTitle !== '' && <AiBadge />}
                </span>
                <Input
                  onChange={(event) => wizard.update({ productTitle: event.target.value })}
                  placeholder="Например, куртка-бомбер"
                  value={draft.productTitle}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Категория
                  {draft.recognized && draft.categoryId !== null && <AiBadge />}
                </span>
                <select
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
                  onChange={(event) =>
                    wizard.update({ categoryId: event.target.value === '' ? null : event.target.value })
                  }
                  value={draft.categoryId ?? ''}
                >
                  <option value="">Выберите категорию</option>
                  {data?.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.title}
                    </option>
                  ))}
                </select>
              </label>

              <Textarea
                hint="Состав, цвет, размерный ряд, особенности — то, чего не видно на фото. Идёт в промпт генерации и в текст карточки."
                label="Описание товара"
                onChange={(value) => wizard.update({ productDescription: value })}
                placeholder="Состав, цвет, размерный ряд, особенности"
                value={draft.productDescription}
              />
            </>
          )}

          {/* ------------------------------------------- 3. Площадка (FR-25) */}
          {draft.step === 2 && (
            <>
              <PanelTitle
                hint="Требования площадок разные — подгоним кадр, размер и фон под выбранную"
                title="Куда пойдёт изображение"
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                {data?.marketplaces.map((marketplace) => (
                  <ChoiceCard
                    description={marketplace.note}
                    key={marketplace.id}
                    onSelect={() => wizard.update({ marketplaceId: marketplace.id })}
                    selected={draft.marketplaceId === marketplace.id}
                    title={marketplace.title}
                  />
                ))}
              </div>

              {profile && <OutputParams note={profileNote} profile={profile} />}

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                Публиковать за вас мы не умеем — готовим файл, который площадка примет.
              </p>
            </>
          )}

          {/* ------------------------------------------------ 4. Тип (FR-06) */}
          {draft.step === 3 && (
            <>
              <PanelTitle hint="Оба типа — один объект за генерацию" title="Что создаём?" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
                <ChoiceCard
                  aside={<span className="text-[13px] font-medium">{generationPrice('photo', 1)} баллов</span>}
                  description="Изображение товара в выбранном сценарии показа."
                  onSelect={() => wizard.update({ kind: 'photo' })}
                  selected={draft.kind === 'photo'}
                  title="Фото"
                />
                <ChoiceCard
                  aside={<span className="text-[13px] font-medium">{generationPrice('card', 1)} баллов</span>}
                  description="Изображение с вёрсткой поверх фото — название, свойства, размеры. Плюс заголовок и описание текстом."
                  onSelect={() => wizard.update({ kind: 'card' })}
                  selected={draft.kind === 'card'}
                  title="Карточка"
                />
              </div>

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                Карточка — <b className="text-foreground">одно</b> изображение, а не набор слайдов.
              </p>
            </>
          )}

          {/* ------------------------------ 5. Как показать (FR-08, FR-09) */}
          {draft.step === 4 && (
            <>
              <PanelTitle
                hint={
                  draft.categoryId === FREEFORM_CATEGORY
                    ? 'У категории «Прочее» готовых сценариев нет — опишите подачу словами'
                    : `${categoryTitle} — ${presets.length} готовых сценария`
                }
                title="Как показать товар"
              />

              {presets.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {presets.map((preset) => (
                    <ChoiceCard
                      description={preset.description}
                      key={preset.id}
                      onSelect={() =>
                        wizard.update({ presetId: draft.presetId === preset.id ? null : preset.id })
                      }
                      selected={draft.presetId === preset.id}
                      title={preset.title}
                    />
                  ))}
                </div>
              ) : (
                <Notice tone="info">
                  <span>
                    Для этой категории предсозданных сценариев нет. Опишите желаемую подачу в поле
                    ниже — этого достаточно.
                  </span>
                </Notice>
              )}

              <Textarea
                hint="Необязательно. Дополняет выбранный сценарий, а для категории «Прочее» заменяет его."
                label="Пожелания к генерации"
                onChange={(value) => wizard.update({ wishes: value })}
                placeholder="Например: тёплый вечерний свет, городская улица, модель в движении"
                value={draft.wishes}
              />
            </>
          )}

          {/* ---------------------------------- 6. Запуск (FR-11, US-E3) */}
          {draft.step === LAST_STEP && (
            <>
              <PanelTitle title="Проверьте и запускайте" />

              {!enoughCredits && (
                <Notice tone="error">
                  <span>
                    Не хватает <b>{missing} {plural(missing, 'балла', 'баллов', 'баллов')}</b>.
                    Генерация стоит {price}, на балансе — {balanceValue}. Баллы не списаны,
                    настройки сохранены.
                  </span>
                </Notice>
              )}

              {launchError !== null && (
                <Notice tone="error">
                  <span>{launchError}</span>
                </Notice>
              )}

              <dl className="flex flex-col gap-2.5">
                <SummaryRow label="Фото" value={`${draft.photos.length} ${plural(draft.photos.length, 'файл', 'файла', 'файлов')}`} />
                <SummaryRow label="Товар" value={draft.productTitle || null} />
                <SummaryRow label="Категория" value={categoryTitle} />
                <SummaryRow label="Описание" value={draft.productDescription || null} />
                <SummaryRow label="Площадка" value={marketplaceTitle} />
                <SummaryRow label="Тип" value={draft.kind === 'card' ? 'Карточка' : 'Фото'} />
                <SummaryRow label="Как показать" value={presetTitle} />
                <SummaryRow label="Пожелания" value={draft.wishes || null} />
              </dl>

              {profile && <OutputParams note={profileNote} profile={profile} />}

              <div className="bg-muted border-border flex flex-col gap-2 rounded-lg border p-4">
                <PriceRow label="Объект" value={`${OBJECT_PRICE} баллов`} />
                {draft.kind === 'card' && (
                  <PriceRow label="Надбавка за карточку" value={`+${price - OBJECT_PRICE} баллов`} />
                )}
                <hr className="border-border" />
                <PriceRow label="К списанию" tone="total" value={`${price} баллов`} />
                {user &&
                  (enoughCredits ? (
                    <PriceRow label="Баланс после списания" value={`${balanceValue - price} баллов`} />
                  ) : (
                    <PriceRow label="Не хватает" tone="short" value={`${missing} баллов`} />
                  ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                {!enoughCredits && (
                  <Button asChild className="flex-1" size="lg" variant="outline">
                    <Link to="/profile#packages">Пополнить баланс</Link>
                  </Button>
                )}
                <Button
                  className="flex-1"
                  disabled={launching || !enoughCredits}
                  onClick={() => void handleLaunch()}
                  size="lg"
                >
                  {launching ? 'Запускаем…' : `Запустить генерацию за ${price} баллов`}
                </Button>
              </div>

              <p className="text-muted-foreground text-[13px] leading-[18px]">
                Одна генерация — один объект: вся мощность вызова идёт на один результат.
              </p>
            </>
          )}

          {/* ----------------------------------------------------------- подвал шага */}
          {draft.step !== LAST_STEP && (
            <div className="border-border flex items-center justify-between gap-4 border-t pt-4">
              <span className="text-muted-foreground text-[13px]">
                {blocker ?? `Шаг ${draft.step + 1} из ${STEPS.length}`}
              </span>
              <div className="flex gap-2.5">
                {draft.step > 0 && (
                  <Button className="w-[110px]" onClick={wizard.back} variant="outline">
                    Назад
                  </Button>
                )}
                <Button className="w-[130px]" disabled={blocker !== null} onClick={wizard.next}>
                  Далее
                </Button>
              </div>
            </div>
          )}

          {draft.step === LAST_STEP && (
            <div className="border-border flex border-t pt-4">
              <Button onClick={wizard.back} variant="outline">
                Назад
              </Button>
            </div>
          )}
        </Panel>

        {/* --------------------------------------------------------- правая колонка */}
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelTitle title="Результаты" />
            <div className="border-border bg-muted flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
              <span className="bg-background border-border flex size-12 items-center justify-center rounded-full border">
                <ImageIcon className="text-muted-foreground size-5" />
              </span>
              <span className="text-[15px] font-medium">Здесь появятся результаты</span>
              <span className="text-muted-foreground max-w-[260px] text-[13px] leading-[18px]">
                Готовое изображение можно будет скачать и найти потом в каталоге.
              </span>
            </div>
          </Panel>

          <Panel>
            <PanelTitle title="Ваша генерация" />
            <dl className="flex flex-col gap-2.5">
              <SummaryRow
                label="Фото"
                value={draft.photos.length > 0 ? `${draft.photos.length} из ${MAX_PHOTOS}` : null}
              />
              <SummaryRow label="Товар" value={draft.productTitle || null} />
              <SummaryRow label="Категория" value={categoryTitle} />
              <SummaryRow label="Площадка" value={marketplaceTitle} />
              <SummaryRow label="Тип" value={draft.step >= 3 ? (draft.kind === 'card' ? 'Карточка' : 'Фото') : null} />
              <SummaryRow label="Как показать" value={presetTitle} />
            </dl>
            <hr className="border-border" />
            <PriceRow label="К списанию" tone="total" value={draft.step >= 3 ? `${price} баллов` : '—'} />
            <p className="text-muted-foreground text-[12px] leading-4">
              Одна генерация — один объект: вся мощность вызова идёт на один результат.
            </p>
          </Panel>
        </div>
      </div>

      {/* --------------------------------- перехват гостя (FR-12, US-E6) */}
      {guestPrompt && (
        <div
          aria-labelledby="guest-prompt-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
        >
          <div className="bg-background border-border flex w-full max-w-[460px] flex-col gap-5 rounded-lg border p-6 shadow-lg sm:p-8">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-semibold tracking-tight" id="guest-prompt-title">
                Нужен аккаунт, чтобы запустить
              </h2>
              <p className="text-muted-foreground text-sm leading-5">
                Настройки генерации сохранены. После регистрации вы вернётесь на этот шаг — фото,
                товар и сценарий останутся на месте.
              </p>
            </div>

            <Notice tone="success">
              <span>
                <b>120 стартовых баллов</b> после подтверждения email — это две пробные генерации.
              </span>
            </Notice>

            <div className="flex flex-col gap-2">
              <Button asChild size="lg">
                <Link to="/signup">Зарегистрироваться</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link state={{ from: '/generate' }} to="/signin">
                  У меня уже есть аккаунт
                </Link>
              </Button>
              <Button onClick={() => setGuestPrompt(false)} size="lg" variant="ghost">
                Вернуться к настройкам
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
