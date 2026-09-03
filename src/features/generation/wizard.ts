import { rejectLogo, rejectLogoSize } from '@shared/logo.ts'
import { MAX_PHOTOS, rejectPhoto } from '@shared/uploads.ts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { logger } from '@/lib/logger'

import { extractProductProperties, previewCard, recognizePhotos, type CardPreview } from './api'
import { productPropertiesPayload } from './properties'
import {
  clearDraft,
  EMPTY_DRAFT,
  LAST_STEP,
  readDraft,
  writeDraft,
  type DraftPhoto,
  type WizardDraft,
} from './draft'

/**
 * Состояние мастера генерации: черновик, переходы по шагам и распознавание.
 *
 * Сами шаги описаны в `draft.ts` (`STEPS`): номер шага — поле черновика, и модуль данных
 * обязан уметь собрать черновик, не подтягивая это состояние.
 */

export type RejectedPhoto = { name: string; reason: string }

export type Wizard = {
  draft: WizardDraft
  /** Черновик читается из IndexedDB асинхронно: до этого мастер рисовать нечем. */
  restored: boolean
  rejected: RejectedPhoto[]
  recognizing: boolean
  extractingProperties: boolean
  /** Модель вернула список (включая пустой) — отличает его от ещё не запрошенного. */
  propertiesExtracted: boolean
  /** Бесплатные распознавания на сегодня кончились — это не сбой, и говорить надо иначе. */
  recognitionLimited: boolean
  propertiesLimited: boolean
  propertiesFailed: boolean
  /** Почему знак не принят — текстом человеку. `null` — претензий нет (B3). */
  logoRejected: string | null
  /** Карточка, собранная на заглушках до оплаты (B6). `null` — ещё не собиралась. */
  preview: CardPreview | null
  previewing: boolean
  previewFailed: boolean
  /** Ввод изменился после сборки: показанная карточка больше не про эту заявку. */
  previewStale: boolean
  refreshPreview: () => void
  update: (patch: Partial<WizardDraft>) => void
  addPhotos: (files: File[]) => void
  removePhoto: (id: string) => void
  clearPhotos: () => void
  setLogo: (file: File | null) => void
  extractProperties: () => void
  goTo: (step: number) => void
  next: () => void
  back: () => void
  reset: () => void
}

/** Чего не хватает, чтобы уйти с текущего шага. `null` — можно дальше. */
export function blockedBy(draft: WizardDraft): string | null {
  switch (draft.step) {
    case 0:
      return draft.photos.length === 0 ? 'Добавьте хотя бы одно фото товара' : null
    case 1:
      if (draft.productTitle.trim() === '') return 'Заполните наименование и категорию'
      return draft.categoryId === null ? 'Заполните наименование и категорию' : null
    case 2:
      return draft.marketplaceId === null ? 'Выберите площадку' : null
    default:
      return null
  }
}

/**
 * Ввод, от которого зависит превью. Признак «картинка устарела» считается сравнением ключей,
 * а не флагом: флаг пришлось бы ставить в каждом месте, меняющем черновик, — и одно
 * пропущенное место означало бы устаревшее превью, выданное за актуальное.
 *
 * `null` — превью не о чем: карточка не выбрана или площадка с категорией ещё не заданы.
 */
function previewKey(draft: WizardDraft): string | null {
  if (draft.kind !== 'card' || draft.categoryId === null || draft.marketplaceId === null) return null

  return JSON.stringify([
    draft.categoryId,
    draft.marketplaceId,
    draft.presetId,
    draft.productTitle.trim(),
    draft.logo !== null,
    productPropertiesPayload(draft.productProperties),
  ])
}

export function useWizard(): Wizard {
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT)
  const [restored, setRestored] = useState(false)
  const [rejected, setRejected] = useState<RejectedPhoto[]>([])
  const [recognizing, setRecognizing] = useState(false)
  const [extractingProperties, setExtractingProperties] = useState(false)
  const [propertiesExtracted, setPropertiesExtracted] = useState(false)
  const [recognitionLimited, setRecognitionLimited] = useState(false)
  const [propertiesLimited, setPropertiesLimited] = useState(false)
  const [propertiesFailed, setPropertiesFailed] = useState(false)
  const [logoRejected, setLogoRejected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ key: string; value: CardPreview } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewFailedKey, setPreviewFailedKey] = useState<string | null>(null)
  const recognitionRun = useRef(0)
  const propertiesRun = useRef(0)
  const logoRun = useRef(0)
  const previewRun = useRef(0)
  const photoCount = draft.photos.length
  const previewInput = previewKey(draft)

  useEffect(() => {
    let cancelled = false

    void readDraft().then((stored) => {
      if (cancelled) return
      if (stored) setDraft(stored)
      setRestored(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Пишется каждое изменение, а не только переход между шагами: сессия истекает и вкладка
  // закрывается в произвольный момент, а обещание артборда — «настройки сохранены».
  useEffect(() => {
    if (!restored) return
    void writeDraft(draft)
  }, [draft, restored])

  const update = useCallback((patch: Partial<WizardDraft>) => {
    if (patch.productDescription !== undefined || patch.wishes !== undefined || patch.productProperties !== undefined) {
      // Ответ относится к исходному тексту и списку. Ручная правка во время запроса важнее
      // подсказки модели, поэтому делаем уже отправленный запрос неактуальным.
      propertiesRun.current += 1
      setExtractingProperties(false)
    }

    if (patch.productDescription !== undefined || patch.wishes !== undefined) {
      setPropertiesExtracted(false)
      setPropertiesLimited(false)
      setPropertiesFailed(false)
    }

    setDraft((current) => {
      const next = { ...current, ...patch }

      // Сценарии принадлежат категории: сменил категорию — прежний выбор недействителен
      // и был бы отклонён базой (FR-08). Лучше снять его здесь, чем после списания.
      if (patch.categoryId !== undefined && patch.categoryId !== current.categoryId) {
        next.presetId = null
      }

      return next
    })
  }, [])

  /**
   * Разбор идёт ДО обновления состояния, а не внутри него.
   *
   * Складывать отказы прямо в обновляющую функцию нельзя: React вправе вызвать её больше
   * одного раза (и в режиме разработки вызывает), и список отказов задваивался — человек
   * видел каждый непринятый файл дважды. Обновление состояния обязано быть чистым.
   */
  const addPhotos = useCallback(
    (files: File[]) => {
      const accepted: DraftPhoto[] = []
      const refused: RejectedPhoto[] = []
      let room = MAX_PHOTOS - photoCount

      for (const file of files) {
        const reason = rejectPhoto(file)

        if (reason !== null) {
          refused.push({ name: file.name, reason })
          continue
        }

        if (room === 0) {
          refused.push({
            name: file.name,
            reason: `за одну генерацию принимаем не больше ${MAX_PHOTOS} фото`,
          })
          continue
        }

        room -= 1
        accepted.push({
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type,
          size: file.size,
          blob: file,
        })
      }

      setRejected(refused)
      if (accepted.length === 0) return

      // Состав фото изменился — прежнее распознавание больше не про этот товар.
      setDraft((current) => ({
        ...current,
        photos: [...current.photos, ...accepted],
        recognized: false,
      }))
    },
    [photoCount],
  )

  const removePhoto = useCallback((id: string) => {
    setRejected([])
    setDraft((current) => ({
      ...current,
      photos: current.photos.filter((photo) => photo.id !== id),
      recognized: false,
    }))
  }, [])

  const clearPhotos = useCallback(() => {
    setRejected([])
    setDraft((current) => ({ ...current, photos: [], recognized: false }))
  }, [])

  /**
   * Принимает знак продавца (B3) или снимает уже принятый.
   *
   * Содержимое проверяется тем же кодом, что и на сервере (`@shared/logo.ts`), но здесь —
   * до отправки: человек узнаёт «фон непрозрачный» на шаге настройки, а не после списания
   * баллов. Размер файла отсекается раньше чтения байтов: втягивать в память стомегабайтный
   * снимок ради ответа «слишком большой» незачем.
   *
   * Чтение файла асинхронно, поэтому у него свой счётчик заходов: успей человек выбрать
   * второй файл, пока читается первый, прежний ответ перетёр бы новый выбор.
   */
  const setLogo = useCallback((file: File | null) => {
    const run = ++logoRun.current
    setLogoRejected(null)

    if (file === null) {
      setDraft((current) => ({ ...current, logo: null }))
      return
    }

    const tooBig = rejectLogoSize(file.size)
    if (tooBig !== null) {
      setLogoRejected(tooBig)
      return
    }

    void file
      .arrayBuffer()
      .then((buffer) => {
        if (run !== logoRun.current) return

        const reason = rejectLogo(new Uint8Array(buffer))
        if (reason !== null) {
          setLogoRejected(reason)
          return
        }

        setDraft((current) => ({
          ...current,
          logo: { name: file.name, size: file.size, blob: file },
        }))
      })
      .catch((error: unknown) => {
        if (run !== logoRun.current) return
        logger.warn('Знак не прочитался', { reason: String(error) })
        setLogoRejected('файл не прочитался. Попробуйте выбрать его ещё раз')
      })
  }, [])

  const extractProperties = useCallback(() => {
    const { productDescription, wishes } = draft
    if (productDescription.trim() === '' && wishes.trim() === '') return

    const run = ++propertiesRun.current
    setExtractingProperties(true)
    setPropertiesLimited(false)
    setPropertiesFailed(false)
    void (async (): Promise<void> => {
      try {
        const outcome = await extractProductProperties(productDescription, wishes)
        if (run !== propertiesRun.current) return

        setPropertiesLimited(outcome.limitReached)
        setPropertiesFailed(outcome.failed)
        setPropertiesExtracted(!outcome.limitReached && !outcome.failed)
        if (outcome.limitReached || outcome.failed) return

        setDraft((current) => ({ ...current, productProperties: outcome.properties }))
      } catch (error: unknown) {
        if (run !== propertiesRun.current) return
        logger.warn('Свойства товара не извлечены', { reason: String(error) })
        setPropertiesFailed(true)
      } finally {
        if (run === propertiesRun.current) setExtractingProperties(false)
      }
    })()
  }, [draft])

  /**
   * Собирает карточку на заглушках (B6). Бесплатно и без вендора, поэтому повторять можно
   * сколько угодно — но не на каждое нажатие клавиши: сборка стоит нашего процессорного
   * времени, и запускается она входом на шаг запуска или кнопкой, а не правкой поля.
   */
  const refreshPreview = useCallback(() => {
    const { categoryId, marketplaceId } = draft
    if (previewInput === null || categoryId === null || marketplaceId === null) return

    const run = ++previewRun.current
    setPreviewing(true)
    setPreviewFailedKey(null)

    void previewCard({
      categoryId,
      marketplaceId,
      presetId: draft.presetId,
      productTitle: draft.productTitle,
      productProperties: draft.productProperties,
      hasLogo: draft.logo !== null,
    })
      .then((value) => {
        // Пока собиралось превью, человек мог поправить свойства: ответ на прошлый список
        // перетёр бы то, что он уже изменил.
        if (run !== previewRun.current) return
        if (value === null) setPreviewFailedKey(previewInput)
        else setPreview({ key: previewInput, value })
      })
      .finally(() => {
        if (run === previewRun.current) setPreviewing(false)
      })
  }, [draft, previewInput])

  /**
   * Приход на шаг запуска — единственный повод собрать превью самому.
   *
   * Это отдельное действие человека, а не набор текста: правка свойства уже на шаге запуска
   * превью не пересобирает, иначе сборка уходила бы на каждое нажатие клавиши. Устаревшую
   * картинку шаг помечает и предлагает обновить кнопкой.
   */
  const previewOnArrival = useCallback(() => {
    if (previewInput === null || previewing) return
    if (preview?.key === previewInput || previewFailedKey === previewInput) return
    refreshPreview()
  }, [previewInput, previewing, preview, previewFailedKey, refreshPreview])

  const goTo = useCallback(
    (step: number) => {
      const target = Math.max(0, Math.min(LAST_STEP, step))
      setDraft((current) => ({ ...current, step: target }))
      if (target === LAST_STEP) previewOnArrival()
    },
    [previewOnArrival],
  )

  /**
   * Переход вперёд. С шага «Фото» он же запускает распознавание (FR-03, FR-04): человек
   * ждёт его на следующем экране, а не на этом — так «до 5 секунд» из NFR-01 приходятся
   * на заполнение полей, а не на пустой экран.
   *
   * Запрос уходит СНАРУЖИ обновления состояния по той же причине, что и разбор файлов:
   * обновляющую функцию React вправе вызвать дважды, и провайдера дёрнуло бы дважды. На
   * заглушке это лишняя секунда, с настоящим вендором — лишние деньги за каждый шаг.
   */
  const next = useCallback(() => {
    const recognizeNow = draft.step === 0 && !draft.recognized && draft.photos.length > 0
    const photos = draft.photos

    setDraft((current) => ({ ...current, step: Math.min(LAST_STEP, current.step + 1) }))
    if (draft.step + 1 === LAST_STEP) previewOnArrival()

    if (!recognizeNow) return

    const run = ++recognitionRun.current
    setRecognizing(true)

    void recognizePhotos(photos).then((guess) => {
      setRecognizing(false)
      // Пока провайдер думал, человек мог вернуться и поменять фото: ответ на прошлый
      // набор перетёр бы то, что он уже поправил руками.
      if (run !== recognitionRun.current) return

      setRecognitionLimited(guess.limitReached)

      setDraft((latest) => ({
        ...latest,
        recognized: true,
        categoryId: latest.categoryId ?? guess.categoryId,
        productTitle: latest.productTitle === '' ? (guess.productTitle ?? '') : latest.productTitle,
      }))
    })
  }, [draft.step, draft.recognized, draft.photos, previewOnArrival])

  const back = useCallback(() => {
    setRejected([])
    setDraft((current) => ({ ...current, step: Math.max(0, current.step - 1) }))
  }, [])

  const reset = useCallback(() => {
    recognitionRun.current += 1
    propertiesRun.current += 1
    logoRun.current += 1
    setRejected([])
    setLogoRejected(null)
    setExtractingProperties(false)
    setPropertiesExtracted(false)
    setPropertiesLimited(false)
    setPropertiesFailed(false)
    previewRun.current += 1
    setPreview(null)
    setPreviewing(false)
    setPreviewFailedKey(null)
    setDraft(EMPTY_DRAFT)
    void clearDraft()
  }, [])

  return {
    draft,
    restored,
    rejected,
    recognizing,
    extractingProperties,
    propertiesExtracted,
    recognitionLimited,
    propertiesLimited,
    propertiesFailed,
    logoRejected,
    preview: preview?.value ?? null,
    previewing,
    previewFailed: previewFailedKey !== null && previewFailedKey === previewInput,
    previewStale: preview !== null && previewInput !== null && preview.key !== previewInput,
    refreshPreview,
    update,
    addPhotos,
    removePhoto,
    clearPhotos,
    setLogo,
    extractProperties,
    goTo,
    next,
    back,
    reset,
  }
}
