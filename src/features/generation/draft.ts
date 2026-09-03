import type { GenerationKind } from '@shared/pricing.ts'

import { logger } from '@/lib/logger'

import { normalizeProductProperties, type ProductProperty } from './properties'

/**
 * Черновик мастера генерации, переживающий перезагрузку страницы.
 *
 * **Зачем это вообще нужно.** Человек собирает заявку не за один присест: подтверждает
 * email по ссылке из письма — иногда в другой вкладке, — закрывает вкладку, возвращается
 * назавтра. Между этими событиями приложение перезагружается, а обещание артборда прямое:
 * «фото, товар и сценарий останутся на месте». То же требование у US-E6, когда сессия
 * истекла посреди настройки.
 *
 * **Почему IndexedDB, а не localStorage.** В черновике лежат сами файлы: до четырёх фото
 * по десять мегабайт (FR-02). В localStorage помещаются только строки, и base64 от такого
 * набора выходит за квоту браузера в разы. IndexedDB хранит `Blob` как есть.
 *
 * **Почему не серверный черновик.** У гостя нет ни строки в базе, ни папки в бакете:
 * политики Storage стоят на `auth.uid()`. Заводить их ради настройки, которая может не
 * кончиться генерацией, — держать мусор за свой счёт.
 *
 * Хранилище может быть недоступно (приватное окно, отключённые данные сайта), поэтому
 * каждое обращение обёрнуто: черновик — удобство, а не условие работы мастера.
 */

/**
 * Шесть шагов мастера — решение захода D2, зафиксированное в
 * [V-06](../../../docs/VISUALS.md#v-06): фото → товар → площадка → тип → как показать →
 * запуск. Шага «количество объектов» среди них нет: потолок в один объект за генерацию
 * (ТЗ §11) превратил бы выбор в контрол из одного варианта, поэтому цена показана сразу.
 *
 * Живут рядом с черновиком, а не в `wizard.ts`: номер шага — его поле, и модуль данных
 * обязан уметь собрать черновик, не подтягивая состояние мастера.
 */
export const STEPS = ['Фото', 'Товар', 'Площадка', 'Тип', 'Как показать', 'Запуск'] as const

export const LAST_STEP = STEPS.length - 1

export type DraftPhoto = {
  id: string
  name: string
  type: string
  size: number
  blob: Blob
}

/**
 * Логотип продавца (шаг B3). Один файл на заявку, поэтому ключа строки у него нет —
 * в отличие от фото, которые переставляются и удаляются поштучно.
 */
export type DraftLogo = { name: string; size: number; blob: Blob }

export type WizardDraft = {
  step: number
  photos: DraftPhoto[]
  /** Не загружен — штатный случай: слой логотипа снимается правилом K-3 на сборке. */
  logo: DraftLogo | null
  productTitle: string
  productDescription: string
  categoryId: string | null
  marketplaceId: string | null
  kind: GenerationKind
  presetId: string | null
  wishes: string
  /** B1: порядок — важность, подтверждённая продавцом для макета ограниченной ёмкости. */
  productProperties: ProductProperty[]
  /** Распознавание уже отработало: повторно гонять провайдера при возврате незачем. */
  recognized: boolean
}

export const EMPTY_DRAFT: WizardDraft = {
  step: 0,
  photos: [],
  logo: null,
  productTitle: '',
  productDescription: '',
  categoryId: null,
  marketplaceId: null,
  kind: 'card',
  presetId: null,
  wishes: '',
  productProperties: [],
  recognized: false,
}

const DATABASE = 'merch-kit'
const STORE = 'wizard'
const KEY = 'draft'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступна'))
      return
    }

    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB не открылась'))
  })
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = run(database.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Черновик не прочитался'))
      }),
  )
}

export async function readDraft(): Promise<WizardDraft | null> {
  try {
    const stored = await transact<WizardDraft | undefined>('readonly', (store) => store.get(KEY))
    if (stored === undefined) return null

    // Черновики переживают релизы. Старые записи не знают о B1 и B3, поэтому перед выдачей
    // достраиваем новые поля и чистим значения, которые мог записать прежний клиент.
    return {
      ...EMPTY_DRAFT,
      ...stored,
      productProperties: normalizeProductProperties(stored.productProperties),
      logo: normalizeLogo(stored.logo),
    }
  } catch (error: unknown) {
    logger.warn('Черновик мастера не прочитан', { reason: String(error) })
    return null
  }
}

/**
 * Логотип из хранилища браузера — недоверенная граница, как и ответ модели у свойств.
 * Запись прежней версии клиента могла не знать поля вовсе, а `Blob` из чужой записи мог
 * прийти чем угодно: без файла загрузка нарисовала бы миниатюру из `undefined`.
 */
function normalizeLogo(value: unknown): DraftLogo | null {
  if (value === null || typeof value !== 'object') return null

  const { name, size, blob } = value as { name?: unknown; size?: unknown; blob?: unknown }
  if (!(blob instanceof Blob)) return null

  return {
    name: typeof name === 'string' ? name : 'logo.png',
    size: typeof size === 'number' ? size : blob.size,
    blob,
  }
}

export async function writeDraft(draft: WizardDraft): Promise<void> {
  try {
    await transact('readwrite', (store) => store.put(draft, KEY))
  } catch (error: unknown) {
    // Мастер продолжает работать: потеряется только восстановление после перезагрузки.
    logger.warn('Черновик мастера не сохранён', { reason: String(error) })
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await transact('readwrite', (store) => store.delete(KEY))
  } catch (error: unknown) {
    logger.warn('Черновик мастера не удалён', { reason: String(error) })
  }
}

