import { MAX_PHOTOS, rejectPhoto } from '@shared/uploads.ts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { recognizePhotos } from './api'
import {
  clearDraft,
  EMPTY_DRAFT,
  readDraft,
  writeDraft,
  type DraftPhoto,
  type WizardDraft,
} from './draft'

/**
 * Состояние мастера генерации: шесть шагов, черновик и распознавание.
 *
 * Порядок шагов — решение захода D2, зафиксированное в [V-06](../../../docs/VISUALS.md#v-06):
 * фото → товар → площадка → тип → как показать → запуск. Шага «количество объектов» среди
 * них нет: потолок в один объект за генерацию (ТЗ §11) превратил бы выбор в контрол из
 * одного варианта, поэтому цена показана сразу.
 */

export const STEPS = ['Фото', 'Товар', 'Площадка', 'Тип', 'Как показать', 'Запуск'] as const

export const LAST_STEP = STEPS.length - 1

export type RejectedPhoto = { name: string; reason: string }

export type Wizard = {
  draft: WizardDraft
  /** Черновик читается из IndexedDB асинхронно: до этого мастер рисовать нечем. */
  restored: boolean
  rejected: RejectedPhoto[]
  recognizing: boolean
  update: (patch: Partial<WizardDraft>) => void
  addPhotos: (files: File[]) => void
  removePhoto: (id: string) => void
  clearPhotos: () => void
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

export function useWizard(): Wizard {
  const [draft, setDraft] = useState<WizardDraft>(EMPTY_DRAFT)
  const [restored, setRestored] = useState(false)
  const [rejected, setRejected] = useState<RejectedPhoto[]>([])
  const [recognizing, setRecognizing] = useState(false)
  const recognitionRun = useRef(0)
  const photoCount = draft.photos.length

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

  const goTo = useCallback((step: number) => {
    setDraft((current) => ({ ...current, step: Math.max(0, Math.min(LAST_STEP, step)) }))
  }, [])

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

    if (!recognizeNow) return

    const run = ++recognitionRun.current
    setRecognizing(true)

    void recognizePhotos(photos).then((guess) => {
      setRecognizing(false)
      // Пока провайдер думал, человек мог вернуться и поменять фото: ответ на прошлый
      // набор перетёр бы то, что он уже поправил руками.
      if (run !== recognitionRun.current) return

      setDraft((latest) => ({
        ...latest,
        recognized: true,
        categoryId: latest.categoryId ?? guess.categoryId,
        productTitle: latest.productTitle === '' ? (guess.productTitle ?? '') : latest.productTitle,
      }))
    })
  }, [draft.step, draft.recognized, draft.photos])

  const back = useCallback(() => {
    setRejected([])
    setDraft((current) => ({ ...current, step: Math.max(0, current.step - 1) }))
  }, [])

  const reset = useCallback(() => {
    recognitionRun.current += 1
    setRejected([])
    setDraft(EMPTY_DRAFT)
    void clearDraft()
  }, [])

  return {
    draft,
    restored,
    rejected,
    recognizing,
    update,
    addPhotos,
    removePhoto,
    clearPhotos,
    goTo,
    next,
    back,
    reset,
  }
}
